"""Stage 5 — Parent-Child Expansion and Citation Assembly.

For each top-10 child chunk from the reranker:
  1. Compute the Qdrant point ID for its parent_chunk_id
  2. Batch-fetch all unique parents from sec_filings_parents
  3. Return full parent section text with structured citation

Falls back to child text when parent is not found.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass

from app.services.agentic.ingestion.indexer import PARENTS_COLLECTION, _qdrant_client
from .hybrid_search import SearchResult

logger = logging.getLogger(__name__)


@dataclass
class ChunkWithCitation:
    text:           str
    citation_label: str
    ticker:         str
    company_name:   str
    filing_type:    str
    filed_date:     str
    fiscal_year:    int
    section:        str
    score:          float


def _parent_qdrant_id(parent_chunk_id: str) -> str:
    """Compute the Qdrant point ID for a parent chunk (must match indexer.py)."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, parent_chunk_id))


def _build_citation(source_n: int, result: SearchResult) -> str:
    return (
        f"[Source {source_n}: {result.ticker} {result.filing_type} "
        f"{result.fiscal_year}, {result.section} | Filed: {result.filed_date}]"
    )


async def expand_to_parents(results: list[SearchResult]) -> list[ChunkWithCitation]:
    """Fetch parent sections and attach citations for each reranked child.

    Args:
        results: Top-N reranked SearchResult objects.

    Returns:
        ChunkWithCitation list, same length as results, same order.
        Text is the full parent section (up to 4096 tokens).
    """
    if not results:
        return []

    unique_parent_ids = list({r.parent_chunk_id for r in results if r.parent_chunk_id})
    qdrant_ids = [_parent_qdrant_id(pid) for pid in unique_parent_ids]

    loop = asyncio.get_running_loop()
    try:
        records = await loop.run_in_executor(
            None,
            lambda: _qdrant_client().retrieve(
                collection_name=PARENTS_COLLECTION,
                ids=qdrant_ids,
                with_payload=True,
                with_vectors=False,
            ),
        )
    except Exception as exc:
        logger.warning("Parent fetch failed (%s) — falling back to child text", exc)
        records = []

    parent_text_by_id: dict[str, str] = {}
    for rec in records:
        payload = rec.payload or {}
        pid = payload.get("chunk_id", "")
        if pid:
            parent_text_by_id[pid] = payload.get("text", "")

    chunks: list[ChunkWithCitation] = []
    for idx, result in enumerate(results, start=1):
        parent_text = parent_text_by_id.get(result.parent_chunk_id, "")
        text = parent_text if parent_text else result.text
        chunks.append(
            ChunkWithCitation(
                text=           text,
                citation_label= _build_citation(idx, result),
                ticker=         result.ticker,
                company_name=   result.company_name,
                filing_type=    result.filing_type,
                filed_date=     result.filed_date,
                fiscal_year=    result.fiscal_year,
                section=        result.section,
                score=          result.score,
            )
        )

    return chunks
