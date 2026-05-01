"""Stage 3 — Hybrid Search + RRF Fusion.

Runs three parallel Qdrant queries per query variant:
  1. Dense  — Titan v2 semantic similarity, metadata-filtered
  2. Sparse — BM25 keyword matching
  3. Section-targeted — Dense, section-filtered, cross-company

All results merged via Reciprocal Rank Fusion: score = Sigma 1/(60 + rank).
Top 50 unique chunks returned to reranker.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue, SparseVector

from app.services.agentic.bedrock_client import embed_query
from app.services.agentic.ingestion.indexer import (
    CHUNKS_COLLECTION,
    DENSE_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
    _qdrant_client,
)
from app.services.agentic.sparse_encoder import encode_sparse
from .query_analysis import QueryAnalysisResult

logger = logging.getLogger(__name__)

RRF_K = 60


@dataclass
class SearchResult:
    chunk_id:        str
    parent_chunk_id: str
    text:            str
    score:           float
    ticker:          str
    company_name:    str
    filing_type:     str
    filed_date:      str
    fiscal_year:     int
    section:         str
    item_number:     str


def _build_metadata_filter(
    tickers: list[str],
    filing_types: list[str],
    date_from: str | None,
    section: str | None = None,
) -> Filter | None:
    conditions = []
    if tickers:
        conditions.append(FieldCondition(key="ticker", match=MatchAny(any=tickers)))
    if filing_types:
        conditions.append(FieldCondition(key="filing_type", match=MatchAny(any=filing_types)))
    if section:
        conditions.append(FieldCondition(key="section", match=MatchValue(value=section)))
    return Filter(must=conditions) if conditions else None


def _point_to_result(point) -> SearchResult:
    p = point.payload or {}
    return SearchResult(
        chunk_id=        p.get("chunk_id", str(point.id)),
        parent_chunk_id= p.get("parent_chunk_id", ""),
        text=            p.get("text", ""),
        score=           point.score,
        ticker=          p.get("ticker", ""),
        company_name=    p.get("company_name", ""),
        filing_type=     p.get("filing_type", ""),
        filed_date=      p.get("filed_date", ""),
        fiscal_year=     int(p.get("fiscal_year", 0)),
        section=         p.get("section", ""),
        item_number=     p.get("item_number", ""),
    )


def rrf_fusion(
    all_ranked_lists: list[list[SearchResult]],
    k: int = RRF_K,
) -> list[SearchResult]:
    """Merge multiple ranked result lists via Reciprocal Rank Fusion.

    score = Sigma 1 / (k + rank)  where rank is 1-indexed.
    Returns results sorted by descending RRF score, deduplicated by chunk_id.
    """
    scores:  dict[str, float]        = {}
    chunks:  dict[str, SearchResult] = {}

    for ranked_list in all_ranked_lists:
        for rank_0, result in enumerate(ranked_list):
            cid = result.chunk_id
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank_0 + 1)
            chunks[cid] = result

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [
        SearchResult(**{**vars(chunks[cid]), "score": scores[cid]})
        for cid in sorted_ids
    ]


def _dense_search(
    query_vec: list[float],
    metadata_filter: Filter | None,
    limit: int,
) -> list[SearchResult]:
    """Synchronous dense ANN search (called via run_in_executor)."""
    client = _qdrant_client()
    resp = client.query_points(
        collection_name=CHUNKS_COLLECTION,
        query=query_vec,
        using=DENSE_VECTOR_NAME,
        query_filter=metadata_filter,
        limit=limit,
        with_payload=True,
    )
    return [_point_to_result(p) for p in resp.points]


def _sparse_search(
    sparse_vec: SparseVector,
    metadata_filter: Filter | None,
    limit: int,
) -> list[SearchResult]:
    """Synchronous BM25 sparse search (called via run_in_executor)."""
    client = _qdrant_client()
    resp = client.query_points(
        collection_name=CHUNKS_COLLECTION,
        query=sparse_vec,
        using=SPARSE_VECTOR_NAME,
        query_filter=metadata_filter,
        limit=limit,
        with_payload=True,
    )
    return [_point_to_result(p) for p in resp.points]


async def hybrid_search(
    query_result: QueryAnalysisResult,
    hyde_embedding: list[float] | None,
    top_k: int = 50,
) -> list[SearchResult]:
    """Run dense + sparse + section-targeted searches and RRF-fuse results."""
    loop = asyncio.get_running_loop()
    all_ranked_lists: list[list[SearchResult]] = []

    tasks = []
    for variant in query_result.query_variants:
        tasks.append(_search_one_variant(
            variant, query_result, hyde_embedding, top_k, loop,
        ))

    variant_results = await asyncio.gather(*tasks, return_exceptions=True)

    for vr in variant_results:
        if isinstance(vr, Exception):
            logger.warning("Search variant failed: %s", vr)
            continue
        all_ranked_lists.extend(vr)

    if not all_ranked_lists:
        return []

    merged = rrf_fusion(all_ranked_lists)
    return merged[:top_k]


async def _search_one_variant(
    variant: str,
    qr: QueryAnalysisResult,
    hyde_embedding: list[float] | None,
    top_k: int,
    loop: asyncio.AbstractEventLoop,
) -> list[list[SearchResult]]:
    """Run the 3 search types for a single query variant. Returns list of ranked lists."""
    dense_vec = await loop.run_in_executor(None, embed_query, variant)
    if hyde_embedding:
        dense_vec = [(a + b) / 2 for a, b in zip(dense_vec, hyde_embedding)]

    sparse_vecs = await loop.run_in_executor(None, encode_sparse, [variant])
    sparse_vec  = sparse_vecs[0] if sparse_vecs else None

    meta_filter = _build_metadata_filter(
        tickers=qr.tickers,
        filing_types=qr.filing_types,
        date_from=qr.date_from,
    )

    section_filter = None
    if qr.sections:
        section_filter = _build_metadata_filter(
            tickers=[],
            filing_types=qr.filing_types,
            date_from=qr.date_from,
            section=qr.sections[0],
        )

    coros = [
        loop.run_in_executor(None, _dense_search, dense_vec, meta_filter, top_k),
        loop.run_in_executor(None, _dense_search, dense_vec, section_filter, top_k // 2),
    ]
    if sparse_vec is not None:
        coros.append(
            loop.run_in_executor(None, _sparse_search, sparse_vec, meta_filter, top_k)
        )

    results = await asyncio.gather(*coros, return_exceptions=True)

    ranked_lists = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning("Qdrant search failed: %s", r)
        elif r:
            ranked_lists.append(r)

    return ranked_lists
