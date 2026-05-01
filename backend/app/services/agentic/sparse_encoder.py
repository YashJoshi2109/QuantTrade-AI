"""BM25 sparse text encoding via fastembed.

Shared by:
  - ingestion/indexer.py  (upsert sparse vectors)
  - retrieval/hybrid_search.py  (encode query for sparse search)
"""
from __future__ import annotations

import logging
from functools import lru_cache

from fastembed import SparseTextEmbedding
from qdrant_client.models import SparseVector

logger = logging.getLogger(__name__)

BM25_MODEL_NAME = "Qdrant/bm25"


@lru_cache(maxsize=1)
def _bm25_model() -> SparseTextEmbedding:
    """Lazy singleton BM25 model — downloads on first call (~50MB)."""
    logger.info("Loading BM25 model: %s", BM25_MODEL_NAME)
    return SparseTextEmbedding(model_name=BM25_MODEL_NAME)


def encode_sparse(texts: list[str]) -> list[SparseVector]:
    """Encode texts as BM25 sparse vectors compatible with Qdrant hybrid search.

    Returns one SparseVector per input text, preserving order.
    """
    if not texts:
        return []
    model = _bm25_model()
    embeddings = list(model.embed(texts))
    return [
        SparseVector(
            indices=emb.indices.tolist(),
            values=emb.values.tolist(),
        )
        for emb in embeddings
    ]
