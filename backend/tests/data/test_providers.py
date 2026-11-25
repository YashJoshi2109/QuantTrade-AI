"""Tests for abstract provider contracts and concrete stub implementations."""
from __future__ import annotations

from typing import List, Optional

import pandas as pd
import pytest

from data.providers.base import NewsProvider, OHLCVProvider, SECProvider


# ---------------------------------------------------------------------------
# Helpers: minimal concrete stubs
# ---------------------------------------------------------------------------

class StubOHLCVProvider(OHLCVProvider):
    name = "stub_ohlcv"

    def fetch_daily_bars(self, symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
        return pd.DataFrame({
            "symbol": [symbol],
            "date": [pd.Timestamp("2022-01-03")],
            "open": [100.0],
            "high": [102.0],
            "low": [99.0],
            "close": [101.0],
            "volume": [1_000_000.0],
            "source": ["stub"],
        })


class StubSECProvider(SECProvider):
    name = "stub_sec"

    def get_cik(self, symbol: str) -> Optional[str]:
        return "0000320193"

    def fetch_submissions(self, cik: str) -> dict:
        return {"cik": cik, "filings": {"recent": {}}}

    def fetch_company_facts(self, cik: str) -> dict:
        return {"cik": cik, "facts": {}}

    def fetch_recent_filings(self, cik: str, forms: List[str]) -> pd.DataFrame:
        return pd.DataFrame({
            "accessionNumber": ["0001234-22-000001"],
            "form": ["10-K"],
            "filingDate": [pd.Timestamp("2022-01-10")],
            "acceptedDatetime": [pd.Timestamp("2022-01-10 10:00:00")],
            "primaryDocument": ["form10k.htm"],
            "available_at": [pd.Timestamp("2022-01-10 10:00:00")],
        })

    def download_filing_text(self, cik: str, accession_number: str, primary_document: str) -> str:
        return "Sample filing text for testing."


class StubNewsProvider(NewsProvider):
    name = "stub_news"

    def fetch_articles(
        self,
        symbol: str,
        company_name: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        return pd.DataFrame({
            "date": [pd.Timestamp("2022-01-05")],
            "url": ["https://example.com/news/1"],
            "source": ["example.com"],
            "headline": [f"{company_name} reports strong earnings"],
            "tone": [2.5],
            "themes": [["EARNINGS"]],
        })


# ---------------------------------------------------------------------------
# Tests: cannot instantiate abstract bases
# ---------------------------------------------------------------------------

def test_ohlcv_provider_is_abstract():
    with pytest.raises(TypeError):
        OHLCVProvider()  # type: ignore[abstract]


def test_sec_provider_is_abstract():
    with pytest.raises(TypeError):
        SECProvider()  # type: ignore[abstract]


def test_news_provider_is_abstract():
    with pytest.raises(TypeError):
        NewsProvider()  # type: ignore[abstract]


# ---------------------------------------------------------------------------
# Tests: concrete stubs satisfy the interface
# ---------------------------------------------------------------------------

def test_stub_ohlcv_returns_correct_columns():
    provider = StubOHLCVProvider()
    df = provider.fetch_daily_bars("AAPL", "2022-01-01", "2022-12-31")
    expected_cols = {"symbol", "date", "open", "high", "low", "close", "volume", "source"}
    assert expected_cols.issubset(set(df.columns)), f"Missing columns: {expected_cols - set(df.columns)}"


def test_stub_ohlcv_date_is_timestamp():
    provider = StubOHLCVProvider()
    df = provider.fetch_daily_bars("MSFT", "2022-01-01", "2022-12-31")
    assert pd.api.types.is_datetime64_any_dtype(df["date"]), "date column must be datetime"


def test_stub_ohlcv_fetch_batch():
    provider = StubOHLCVProvider()
    df = provider.fetch_batch(["AAPL", "MSFT", "GOOG"], "2022-01-01", "2022-12-31")
    assert df["symbol"].nunique() == 3


def test_stub_sec_returns_dict_from_submissions():
    provider = StubSECProvider()
    result = provider.fetch_submissions("0000320193")
    assert isinstance(result, dict)


def test_stub_sec_returns_dict_from_company_facts():
    provider = StubSECProvider()
    result = provider.fetch_company_facts("0000320193")
    assert isinstance(result, dict)


def test_stub_sec_cik_is_string():
    provider = StubSECProvider()
    cik = provider.get_cik("AAPL")
    assert isinstance(cik, str)


def test_stub_sec_filings_df_has_available_at():
    provider = StubSECProvider()
    df = provider.fetch_recent_filings("0000320193", ["10-K"])
    assert "available_at" in df.columns


def test_stub_news_articles_no_future_dates():
    provider = StubNewsProvider()
    df = provider.fetch_articles("AAPL", "Apple Inc", "2022-01-01", "2022-03-31")
    assert not df.empty
    now = pd.Timestamp.now()
    assert (df["date"] <= now).all(), "Articles must not have future publication dates"


def test_stub_news_has_required_columns():
    provider = StubNewsProvider()
    df = provider.fetch_articles("MSFT", "Microsoft", "2022-01-01", "2022-03-31")
    required = {"date", "url", "source", "headline", "tone", "themes"}
    assert required.issubset(set(df.columns))
