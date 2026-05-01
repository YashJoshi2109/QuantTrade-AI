"""Tests for BM25 sparse encoder.

fastembed 0.8.x segfaults on Python 3.14, so BM25 is disabled by default
(BM25_ENABLED env var). Tests verify the dense-only fallback behaviour and
the enabled path via env override.
"""
import os
import pytest
from unittest.mock import MagicMock, patch
import numpy


def test_encode_sparse_dense_only_fallback():
    """encode_sparse() returns empty SparseVectors when BM25 is disabled (default)."""
    from qdrant_client.models import SparseVector
    from app.services.agentic.sparse_encoder import encode_sparse

    results = encode_sparse(["Apple supply chain", "MSFT Azure"])

    assert len(results) == 2
    assert all(isinstance(r, SparseVector) for r in results)
    # Dense-only fallback: empty indices and values
    assert results[0].indices == []
    assert results[0].values == []


def test_encode_sparse_empty_text():
    """encode_sparse([]) returns empty list."""
    from app.services.agentic.sparse_encoder import encode_sparse

    results = encode_sparse([])
    assert results == []


def test_encode_sparse_with_bm25_enabled():
    """When BM25_ENABLED=1, encode_sparse uses the BM25 model output."""
    from qdrant_client.models import SparseVector

    fake_emb = MagicMock()
    fake_emb.indices = numpy.array([0, 5, 12])
    fake_emb.values = numpy.array([0.9, 0.5, 0.3])

    with patch.dict(os.environ, {"BM25_ENABLED": "1"}):
        # Reload module to pick up new env var
        import importlib
        import app.services.agentic.sparse_encoder as enc_mod
        importlib.reload(enc_mod)

        with patch.object(enc_mod, "_bm25_model", return_value=MagicMock()) as mock_fn:
            mock_fn.return_value.embed = MagicMock(return_value=iter([fake_emb, fake_emb]))
            # Temporarily override BM25_ENABLED in the reloaded module
            enc_mod.BM25_ENABLED = True
            results = enc_mod.encode_sparse(["Apple supply chain", "MSFT Azure"])

    assert len(results) == 2
    assert isinstance(results[0], SparseVector)
    assert results[0].indices == [0, 5, 12]
    assert results[0].values == pytest.approx([0.9, 0.5, 0.3])
