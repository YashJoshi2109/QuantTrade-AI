"""Qdrant indexer — collection setup, chunk upsert, and dedup check."""
from __future__ import annotations

import logging
import os
import uuid
from functools import lru_cache
from typing import Dict, List, Sequence

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    HnswConfigDiff,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)

from .chunker import Chunk

logger = logging.getLogger(__name__)

# ── Collection names ──────────────────────────────────────────────────────────
CHUNKS_COLLECTION = "sec_filings_chunks"
PARENTS_COLLECTION = "sec_filings_parents"

# ── Vector dimensionality (Amazon Titan Embeddings v2) ────────────────────────
VECTOR_DIM = 1536


# ── Cached Qdrant client ──────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def _qdrant_client() -> QdrantClient:
    """Return a cached QdrantClient, configured from env vars."""
    url = os.environ.get("QDRANT_URL", "http://localhost:6333")
    api_key = os.environ.get("QDRANT_API_KEY")
    kwargs: dict = {"url": url}
    if api_key:
        kwargs["api_key"] = api_key
    return QdrantClient(**kwargs)


# ── Collection bootstrap ──────────────────────────────────────────────────────
def ensure_collections_exist() -> None:
    """Create both Qdrant collections if they don't already exist.

    Safe to call on every service startup — no-ops if collections exist.
    """
    client = _qdrant_client()

    # ── Child chunks collection (ANN searchable) ──────────────────────────────
    if not client.collection_exists(CHUNKS_COLLECTION):
        client.create_collection(
            CHUNKS_COLLECTION,
            vectors_config=VectorParams(
                size=VECTOR_DIM,
                distance=Distance.COSINE,
            ),
            hnsw_config=HnswConfigDiff(
                m=16,
                ef_construct=100,
            ),
        )
        # Payload indexes for fast filtered search
        client.create_payload_index(
            CHUNKS_COLLECTION,
            field_name="ticker",
            field_schema=PayloadSchemaType.KEYWORD,
        )
        client.create_payload_index(
            CHUNKS_COLLECTION,
            field_name="filing_type",
            field_schema=PayloadSchemaType.KEYWORD,
        )
        client.create_payload_index(
            CHUNKS_COLLECTION,
            field_name="fiscal_year",
            field_schema=PayloadSchemaType.INTEGER,
        )
        client.create_payload_index(
            CHUNKS_COLLECTION,
            field_name="content_hash",
            field_schema=PayloadSchemaType.KEYWORD,
        )
        logger.info("Created collection: %s", CHUNKS_COLLECTION)

    # ── Parent sections collection (fetched by ID, not by vector) ─────────────
    if not client.collection_exists(PARENTS_COLLECTION):
        client.create_collection(
            PARENTS_COLLECTION,
            vectors_config=VectorParams(
                size=VECTOR_DIM,
                distance=Distance.COSINE,
            ),
        )
        client.create_payload_index(
            PARENTS_COLLECTION,
            field_name="ticker",
            field_schema=PayloadSchemaType.KEYWORD,
        )
        client.create_payload_index(
            PARENTS_COLLECTION,
            field_name="filing_type",
            field_schema=PayloadSchemaType.KEYWORD,
        )
        logger.info("Created collection: %s", PARENTS_COLLECTION)


# ── Deduplication check ───────────────────────────────────────────────────────
def chunk_exists(content_hash: str) -> bool:
    """Return True if a chunk with this content_hash is already indexed.

    Uses scroll (filter-based) rather than vector search — O(1) payload lookup.
    """
    client = _qdrant_client()
    results, _ = client.scroll(
        collection_name=CHUNKS_COLLECTION,
        scroll_filter=Filter(
            must=[
                FieldCondition(
                    key="content_hash",
                    match=MatchValue(value=content_hash),
                )
            ]
        ),
        limit=1,
        with_payload=False,
        with_vectors=False,
    )
    return len(results) > 0


# ── Upsert ────────────────────────────────────────────────────────────────────
def _chunk_to_payload(chunk: Chunk) -> dict:
    return {
        "chunk_id":       chunk.chunk_id,
        "parent_chunk_id": chunk.parent_chunk_id,
        "text":           chunk.text,
        "token_count":    chunk.token_count,
        "section":        chunk.section,
        "item_number":    chunk.item_number,
        "is_parent":      chunk.is_parent,
        "ticker":         chunk.ticker,
        "company_name":   chunk.company_name,
        "filing_type":    chunk.filing_type,
        "filed_date":     chunk.filed_date,
        "fiscal_year":    chunk.fiscal_year,
        "cik":            chunk.cik,
        "content_hash":   chunk.content_hash,
    }


def upsert_chunks(
    children: Sequence[Chunk],
    parents: Sequence[Chunk],
    child_vectors: Dict[str, List[float]],
) -> None:
    """Upsert child chunks (with embeddings) and parent sections (placeholder vectors).

    Args:
        children:      Child Chunk objects (400-800 tokens, ANN searchable).
        parents:       Parent Chunk objects (up to 4096 tokens, fetched by ID).
        child_vectors: Mapping chunk_id -> embedding vector for each child.
    """
    client = _qdrant_client()

    # ── Child chunks ──────────────────────────────────────────────────────────
    if children:
        child_points = [
            PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_DNS, c.chunk_id)),
                vector=child_vectors.get(c.chunk_id, [0.0] * VECTOR_DIM),
                payload=_chunk_to_payload(c),
            )
            for c in children
        ]
        client.upsert(collection_name=CHUNKS_COLLECTION, points=child_points)
        logger.debug("Upserted %d child chunks to %s", len(child_points), CHUNKS_COLLECTION)

    # ── Parent sections ───────────────────────────────────────────────────────
    if parents:
        parent_points = [
            PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_DNS, p.chunk_id)),
                # Parents are never ANN-searched; zero vector is a safe placeholder.
                vector=[0.0] * VECTOR_DIM,
                payload=_chunk_to_payload(p),
            )
            for p in parents
        ]
        client.upsert(collection_name=PARENTS_COLLECTION, points=parent_points)
        logger.debug("Upserted %d parent sections to %s", len(parent_points), PARENTS_COLLECTION)
