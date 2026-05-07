"""Unit tests for citation filtering in agentic_stream."""
import json
from unittest.mock import MagicMock, patch


def test_citations_filtered_to_requested_ticker():
    """AMZN citations must be dropped when query is about WMT."""
    from app.api.agentic_stream import _filter_citations_by_tickers
    citations = [
        {"ticker": "AMZN", "title": "Amazon 10-K", "source_n": 1},
        {"ticker": "WMT", "title": "Walmart 10-K", "source_n": 2},
    ]
    result = _filter_citations_by_tickers(citations, ["WMT"])
    assert len(result) == 1
    assert result[0]["ticker"] == "WMT"


def test_citations_all_filtered_returns_empty():
    from app.api.agentic_stream import _filter_citations_by_tickers
    citations = [
        {"ticker": "AMZN", "title": "Amazon 10-K", "source_n": 1},
    ]
    result = _filter_citations_by_tickers(citations, ["WMT", "COST"])
    assert result == []


def test_citations_empty_tickers_returns_all():
    """When no tickers requested, return citations unchanged."""
    from app.api.agentic_stream import _filter_citations_by_tickers
    citations = [
        {"ticker": "AMZN", "title": "Amazon 10-K"},
        {"ticker": "WMT", "title": "Walmart 10-K"},
    ]
    result = _filter_citations_by_tickers(citations, [])
    assert len(result) == 2


def test_citations_case_insensitive_match():
    """Lowercase ticker in citation must match uppercase requested ticker."""
    from app.api.agentic_stream import _filter_citations_by_tickers
    citations = [{"ticker": "wmt", "title": "Walmart 10-K"}]
    result = _filter_citations_by_tickers(citations, ["WMT"])
    assert len(result) == 1
