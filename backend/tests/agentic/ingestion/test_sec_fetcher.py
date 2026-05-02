"""Tests for SEC EDGAR filing fetcher."""
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from app.services.agentic.ingestion.sec_fetcher import (
    get_cik_for_ticker,
    fetch_filings_for_ticker,
    Filing,
    SUPPORTED_FILING_TYPES,
)


def test_get_cik_for_ticker_returns_string():
    """get_cik_for_ticker returns a zero-padded 10-digit CIK string."""
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "hits": {"hits": [{"_source": {"entity_id": "320193"}}]}
    }
    mock_response.raise_for_status = MagicMock()

    with patch("app.services.agentic.ingestion.sec_fetcher.requests.get",
               return_value=mock_response):
        cik = get_cik_for_ticker("AAPL")
    assert cik == "0000320193"
    assert len(cik) == 10


def test_get_cik_for_ticker_returns_none_on_miss():
    """get_cik_for_ticker returns None when ticker not found."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"hits": {"hits": []}}
    mock_response.raise_for_status = MagicMock()

    with patch("app.services.agentic.ingestion.sec_fetcher.requests.get",
               return_value=mock_response):
        cik = get_cik_for_ticker("FAKEFAKE")
    assert cik is None


def test_fetch_filings_for_ticker_returns_filing_list():
    """fetch_filings_for_ticker returns list of Filing objects."""
    # Use a date 6 months ago so it always falls within years_back=1
    recent_date = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
    mock_submissions = {
        "filings": {
            "recent": {
                "accessionNumber": ["0000320193-24-000123"],
                "form": ["10-K"],
                "filingDate": [recent_date],
                "primaryDocument": ["aapl-20240928.htm"],
            }
        }
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_submissions
    mock_resp.raise_for_status = MagicMock()

    with patch("app.services.agentic.ingestion.sec_fetcher.requests.get",
               return_value=mock_resp), \
         patch("app.services.agentic.ingestion.sec_fetcher.get_cik_for_ticker",
               return_value="0000320193"):
        filings = fetch_filings_for_ticker("AAPL", years_back=1)

    assert len(filings) >= 1
    assert isinstance(filings[0], Filing)
    assert filings[0].filing_type == "10-K"
    assert filings[0].ticker == "AAPL"


def test_supported_filing_types_includes_key_forms():
    assert "10-K" in SUPPORTED_FILING_TYPES
    assert "10-Q" in SUPPORTED_FILING_TYPES
    assert "8-K"  in SUPPORTED_FILING_TYPES
