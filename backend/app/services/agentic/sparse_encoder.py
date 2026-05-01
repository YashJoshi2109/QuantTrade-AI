"""BM25 sparse text encoding via fastembed.

NOTE: fastembed 0.8.x segfaults on Python 3.14 (ONNX Runtime ABI mismatch).
BM25 is disabled until fastembed compatibility is restored.
Search runs dense-only in the meantime — set BM25_ENABLED=1 to re-enable.

Shared by:
  - ingestion/indexer.py  (upsert sparse vectors)
  - retrieval/hybrid_search.py  (encode query for sparse search)
"""
from __future__ import annotations

import logging
import os

from qdrant_client.models import SparseVector

logger = logging.getLogger(__name__)

BM25_MODEL_NAME  = "Qdrant/bm25"
BM25_ENABLED     = os.getenv("BM25_ENABLED", "0").lower() in ("1", "true", "yes")


def _bm25_model():
    """Return BM25 model if enabled and available."""
    if not BM25_ENABLED:
        return None
    try:
        from functools import lru_cache
        from fastembed import SparseTextEmbedding
        return SparseTextEmbedding(model_name=BM25_MODEL_NAME)
    except Exception as e:
        logger.warning("BM25 load failed: %s", e)
        return None


def encode_sparse(texts: list[str]) -> list[SparseVector]:
    """Encode texts as BM25 sparse vectors.

    Returns empty SparseVectors when BM25 is disabled (dense-only fallback).
    """
    if not texts or not BM25_ENABLED:
        return [SparseVector(indices=[], values=[]) for _ in texts]
    model = _bm25_model()
    if model is None:
        return [SparseVector(indices=[], values=[]) for _ in texts]
    embeddings = list(model.embed(texts))
    return [
        SparseVector(
            indices=emb.indices.tolist(),
            values=emb.values.tolist(),
        )
        for emb in embeddings
    ]
