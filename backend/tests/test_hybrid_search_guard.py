"""Tests for RAG ticker existence pre-check."""
import pytest
from unittest.mock import MagicMock, patch


def test_ticker_has_filings_returns_true_when_chunks_exist():
    mock_client = MagicMock()
    mock_client.count.return_value = MagicMock(count=42)

    with patch(
        "app.services.agentic.retrieval.hybrid_search._qdrant_client",
        return_value=mock_client,
    ):
        from app.services.agentic.retrieval.hybrid_search import ticker_has_filings
        result = ticker_has_filings(["AAPL"])
    assert result is True


def test_ticker_has_filings_returns_false_when_no_chunks():
    mock_client = MagicMock()
    mock_client.count.return_value = MagicMock(count=0)

    with patch(
        "app.services.agentic.retrieval.hybrid_search._qdrant_client",
        return_value=mock_client,
    ):
        from app.services.agentic.retrieval.hybrid_search import ticker_has_filings
        result = ticker_has_filings(["WMT"])
    assert result is False


def test_ticker_has_filings_returns_true_if_any_ticker_has_chunks():
    mock_client = MagicMock()
    # First call returns 0, second returns 10
    mock_client.count.side_effect = [MagicMock(count=0), MagicMock(count=10)]

    with patch(
        "app.services.agentic.retrieval.hybrid_search._qdrant_client",
        return_value=mock_client,
    ):
        from app.services.agentic.retrieval.hybrid_search import ticker_has_filings
        result = ticker_has_filings(["WMT", "COST"])
    assert result is True
