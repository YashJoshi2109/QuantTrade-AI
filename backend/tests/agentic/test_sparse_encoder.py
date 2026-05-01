"""Tests for BM25 sparse encoder."""
import pytest
from unittest.mock import MagicMock, patch
import numpy


def test_encode_sparse_returns_sparse_vectors():
    """encode_sparse() returns one SparseVector per input text."""
    from qdrant_client.models import SparseVector

    fake_emb = MagicMock()
    fake_emb.indices = numpy.array([0, 5, 12])
    fake_emb.values = numpy.array([0.9, 0.5, 0.3])

    with patch(
        "app.services.agentic.sparse_encoder._bm25_model"
    ) as mock_model_fn:
        mock_model = MagicMock()
        mock_model.embed.return_value = iter([fake_emb, fake_emb])
        mock_model_fn.return_value = mock_model

        from app.services.agentic.sparse_encoder import encode_sparse

        results = encode_sparse(["Apple supply chain", "MSFT Azure"])

    assert len(results) == 2
    assert isinstance(results[0], SparseVector)
    assert results[0].indices == [0, 5, 12]
    assert results[0].values == pytest.approx([0.9, 0.5, 0.3])


def test_encode_sparse_empty_text():
    """encode_sparse([]) returns empty list without calling model."""
    with patch("app.services.agentic.sparse_encoder._bm25_model") as mock_model_fn:
        mock_model = MagicMock()
        mock_model.embed.return_value = iter([])
        mock_model_fn.return_value = mock_model

        from app.services.agentic.sparse_encoder import encode_sparse

        results = encode_sparse([])

    assert results == []
    mock_model.embed.assert_not_called()
