"""Qdrant indexer — collection setup, chunk upsert, and dedup check.

Collection schema uses NAMED vectors:
  "dense"  — Titan Embeddings v2 (1536d), COSINE, HNSW, for ANN search
  "bm25"   — BM25 sparse vectors via fastembed, for keyword search

NOTE: If the sec_filings_chunks collection was previously created with the old
unnamed-vector schema, drop it in Qdrant before restarting (no prod data yet).
"""
from __future__ import annotations

import logging
import os
import uuid
from functools import lru_cache
from typing import Dict, List, Optional, Sequence

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    HnswConfigDiff,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    SparseVector,
    SparseVectorParams,
    VectorParams,
)

from app.config import settings
from .chunker import Chunk

logger = logging.getLogger(__name__)

CHUNKS_COLLECTION  = "sec_filings_chunks"
PARENTS_COLLECTION = "sec_filings_parents"
VECTOR_DIM         = 1536
DENSE_VECTOR_NAME  = "dense"
SPARSE_VECTOR_NAME = "bm25"


@lru_cache(maxsize=1)
def _qdrant_client() -> QdrantClient:
    url     = settings.QDRANT_URL
    api_key = settings.QDRANT_API_KEY
    kwargs: dict = {"url": url}
    if api_key:
        kwargs["api_key"] = api_key
    return QdrantClient(**kwargs)


def ensure_collections_exist() -> None:
    """Create Qdrant collections if absent. Safe to call on every startup."""
    client = _qdrant_client()

    if not client.collection_exists(CHUNKS_COLLECTION):
        client.create_collection(
            CHUNKS_COLLECTION,
            vectors_config={
                DENSE_VECTOR_NAME: VectorParams(
                    size=VECTOR_DIM,
                    distance=Distance.COSINE,
                )
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: SparseVectorParams()
            },
            hnsw_config=HnswConfigDiff(m=16, ef_construct=100),
        )
        for field, schema in [
            ("ticker",       PayloadSchemaType.KEYWORD),
            ("filing_type",  PayloadSchemaType.KEYWORD),
            ("fiscal_year",  PayloadSchemaType.INTEGER),
            ("content_hash", PayloadSchemaType.KEYWORD),
            ("section",      PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                CHUNKS_COLLECTION, field_name=field, field_schema=schema
            )
        logger.info("Created collection: %s", CHUNKS_COLLECTION)

    if not client.collection_exists(PARENTS_COLLECTION):
        client.create_collection(
            PARENTS_COLLECTION,
            vectors_config={
                DENSE_VECTOR_NAME: VectorParams(
                    size=VECTOR_DIM,
                    distance=Distance.COSINE,
                )
            },
        )
        for field, schema in [
            ("ticker",      PayloadSchemaType.KEYWORD),
            ("filing_type", PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                PARENTS_COLLECTION, field_name=field, field_schema=schema
            )
        logger.info("Created collection: %s", PARENTS_COLLECTION)


def chunk_exists(content_hash: str) -> bool:
    """True if a chunk with this content_hash is already indexed."""
    client = _qdrant_client()
    results, _ = client.scroll(
        collection_name=CHUNKS_COLLECTION,
        scroll_filter=Filter(
            must=[FieldCondition(key="content_hash", match=MatchValue(value=content_hash))]
        ),
        limit=1,
        with_payload=False,
        with_vectors=False,
    )
    return len(results) > 0


def _chunk_to_payload(chunk: Chunk) -> dict:
    return {
        "chunk_id":        chunk.chunk_id,
        "parent_chunk_id": chunk.parent_chunk_id,
        "text":            chunk.text,
        "token_count":     chunk.token_count,
        "section":         chunk.section,
        "item_number":     chunk.item_number,
        "is_parent":       chunk.is_parent,
        "ticker":          chunk.ticker,
        "company_name":    chunk.company_name,
        "filing_type":     chunk.filing_type,
        "filed_date":      chunk.filed_date,
        "fiscal_year":     chunk.fiscal_year,
        "cik":             chunk.cik,
        "content_hash":    chunk.content_hash,
    }


UPSERT_BATCH_SIZE = 50  # points per Qdrant upsert call to stay under 32MB payload limit


def _batched_upsert(client, collection_name: str, points: list) -> None:
    """Upsert points in batches to avoid Qdrant 32MB payload limit."""
    for i in range(0, len(points), UPSERT_BATCH_SIZE):
        batch = points[i : i + UPSERT_BATCH_SIZE]
        client.upsert(collection_name=collection_name, points=batch)


def upsert_chunks(
    children: Sequence[Chunk],
    parents: Sequence[Chunk],
    child_vectors: Dict[str, List[float]],
    child_sparse_vectors: Optional[Dict[str, SparseVector]] = None,
) -> None:
    """Upsert child chunks (dense + optional sparse) and parent sections.

    Args:
        children:             Child Chunk objects (400-800 tokens, ANN searchable).
        parents:              Parent Chunk objects (up to 4096 tokens, ID-fetched).
        child_vectors:        chunk_id -> 1536-dim dense vector.
        child_sparse_vectors: chunk_id -> BM25 SparseVector. None = skip sparse.
    """
    client = _qdrant_client()

    if children:
        child_points = []
        for c in children:
            dense = child_vectors.get(c.chunk_id, [0.0] * VECTOR_DIM)
            if child_sparse_vectors and c.chunk_id in child_sparse_vectors:
                sv = child_sparse_vectors[c.chunk_id]
                # Only include sparse vector if it has actual indices (BM25 enabled)
                if sv.indices:
                    vector: dict = {
                        DENSE_VECTOR_NAME: dense,
                        SPARSE_VECTOR_NAME: sv,
                    }
                else:
                    vector = {DENSE_VECTOR_NAME: dense}
            else:
                vector = {DENSE_VECTOR_NAME: dense}
            child_points.append(
                PointStruct(
                    id=str(uuid.uuid5(uuid.NAMESPACE_DNS, c.chunk_id)),
                    vector=vector,
                    payload=_chunk_to_payload(c),
                )
            )
        _batched_upsert(client, CHUNKS_COLLECTION, child_points)
        logger.debug("Upserted %d child chunks", len(child_points))

    if parents:
        parent_points = [
            PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_DNS, p.chunk_id)),
                vector={DENSE_VECTOR_NAME: [0.0] * VECTOR_DIM},
                payload=_chunk_to_payload(p),
            )
            for p in parents
        ]
        _batched_upsert(client, PARENTS_COLLECTION, parent_points)
        logger.debug("Upserted %d parent sections", len(parent_points))
