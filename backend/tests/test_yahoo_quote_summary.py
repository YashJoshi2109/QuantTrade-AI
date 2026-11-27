"""/api/v1/market/yahoo-quote-summary: the Research profile's Yahoo fallback."""
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import market

INFO = {"symbol": "NVDA", "longName": "NVIDIA Corporation", "regularMarketPrice": 149.3,
        "marketCap": 3605147156480, "trailingPE": 16.04, "sector": "Technology",
        "longBusinessSummary": "NVIDIA Corporation ...", "companyOfficers": [{"name": "Jensen Huang"}],
        "earningsTimestamp": 1795380000}


def _client():
    app = FastAPI()
    app.include_router(market.router, prefix="/api/v1")
    market._qs_cache.clear()
    return TestClient(app)


def test_returns_quote_summary_module_shape():
    with patch("yfinance.Ticker", return_value=MagicMock(info=INFO)):
        body = _client().get("/api/v1/market/yahoo-quote-summary/nvda").json()
    res = body["quoteSummary"]["result"][0]
    assert res["price"]["longName"] == "NVIDIA Corporation"
    assert res["summaryDetail"]["trailingPE"] == 16.04
    assert res["assetProfile"]["companyOfficers"][0]["name"] == "Jensen Huang"
    assert res["calendarEvents"]["earnings"]["earningsDate"][0]["fmt"]


def test_unknown_symbol_is_404_and_bad_symbol_400():
    c = _client()
    with patch("yfinance.Ticker", return_value=MagicMock(info={})):
        assert c.get("/api/v1/market/yahoo-quote-summary/ZZZZZ").status_code == 404
    assert c.get("/api/v1/market/yahoo-quote-summary/a b;c").status_code == 400
