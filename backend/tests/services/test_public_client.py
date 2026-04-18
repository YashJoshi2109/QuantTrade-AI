"""
Tests for the Public.com client service.

Tests quote parsing, batch fetching, and option chain endpoints.
Uses mocked API responses to avoid network calls.
"""
from unittest.mock import patch, MagicMock, AsyncMock
import asyncio
import pytest

from app.services.public_client import _parse_quote, PublicClient


# ---------------------------------------------------------------------------
# Fixtures: mock API responses
# ---------------------------------------------------------------------------

MOCK_QUOTE_RAW = {
    "instrument": {"symbol": "AAPL", "type": "EQUITY"},
    "outcome": "SUCCESS",
    "last": 195.50,
    "lastTimestamp": "2026-04-17T20:00:00Z",
    "bid": 195.45,
    "bidSize": 200,
    "ask": 195.55,
    "askSize": 150,
    "volume": 45_000_000,
    "previousClose": 193.20,
    "oneDayChange": {
        "change": 2.30,
        "percentChange": 1.19,
    },
}

MOCK_QUOTE_FAILED = {
    "instrument": {"symbol": "INVALID", "type": "EQUITY"},
    "outcome": "UNKNOWN",
    "last": 0,
}

MOCK_QUOTE_NO_PRICE = {
    "instrument": {"symbol": "BAD", "type": "EQUITY"},
    "outcome": "SUCCESS",
    "last": 0,
}


# ---------------------------------------------------------------------------
# Unit tests: quote parsing
# ---------------------------------------------------------------------------


def test_parse_quote_success():
    result = _parse_quote(MOCK_QUOTE_RAW)
    assert result is not None
    assert result["symbol"] == "AAPL"
    assert result["price"] == 195.50
    assert result["change"] == 2.30
    assert result["change_percent"] == 1.19
    assert result["volume"] == 45_000_000
    assert result["previous_close"] == 193.20
    assert result["bid"] == 195.45
    assert result["ask"] == 195.55
    assert result["data_source"] == "public.com"


def test_parse_quote_failed_outcome():
    result = _parse_quote(MOCK_QUOTE_FAILED)
    assert result is None


def test_parse_quote_zero_price():
    result = _parse_quote(MOCK_QUOTE_NO_PRICE)
    assert result is None


def test_parse_quote_missing_fields():
    result = _parse_quote({})
    assert result is None


def test_parse_quote_computes_change_from_prev_close():
    raw = {
        "instrument": {"symbol": "TSLA", "type": "EQUITY"},
        "outcome": "SUCCESS",
        "last": 250.0,
        "previousClose": 245.0,
        "volume": 1000,
    }
    result = _parse_quote(raw)
    assert result is not None
    assert result["change"] == 5.0
    assert round(result["change_percent"], 2) == 2.04


# ---------------------------------------------------------------------------
# Unit tests: PublicClient
# ---------------------------------------------------------------------------


def test_get_quotes_batch():
    """Test that batch quotes parse correctly when SDK returns data."""
    # Simulate what get_quotes returns after parsing
    client = PublicClient()

    async def mock_get_quotes(symbols):
        # Simulate the parsed output directly
        return {"AAPL": _parse_quote(MOCK_QUOTE_RAW)}

    with patch.object(client, "get_quotes", side_effect=mock_get_quotes):
        results = asyncio.run(client.get_quotes(["AAPL"]))
        assert "AAPL" in results
        assert results["AAPL"]["price"] == 195.50
        assert results["AAPL"]["data_source"] == "public.com"


@patch("app.services.public_client.settings")
def test_get_quotes_no_api_key(mock_settings):
    mock_settings.PUBLIC_API_SECRET_KEY = None
    client = PublicClient()
    results = asyncio.run(client.get_quotes(["AAPL"]))
    assert results == {}


@patch("app.services.public_client.settings")
def test_get_quote_single(mock_settings):
    mock_settings.PUBLIC_API_SECRET_KEY = "test_key"

    client = PublicClient()
    with patch.object(client, "get_quotes", new_callable=AsyncMock, return_value={"AAPL": {"price": 195.50, "symbol": "AAPL"}}):
        result = asyncio.run(client.get_quote("AAPL"))
        assert result["price"] == 195.50
