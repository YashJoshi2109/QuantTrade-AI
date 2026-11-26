"""Tests for SEC EDGAR ingestion: CIK padding, PIT available_at, schema, retries."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call, patch

import pandas as pd
import pytest
import requests

from data.config import FreeDataConfig
from data.providers.sec.edgar import SECEdgarProvider

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_TICKER_MAP = {
    "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "1": {"cik_str": 789019, "ticker": "MSFT", "title": "Microsoft Corp."},
}

FAKE_SUBMISSIONS = {
    "cik": "0000320193",
    "filings": {
        "recent": {
            "accessionNumber": [
                "0000320193-22-000001",
                "0000320193-22-000002",
            ],
            "form": ["10-K", "10-Q"],
            "filingDate": ["2022-01-10", "2022-04-15"],
            "acceptanceDateTime": [  # real EDGAR key + format
                "2022-01-10T16:45:00.000Z",
                "2022-04-15T09:30:00.000Z",
            ],
            "primaryDocument": ["form10k.htm", "form10q.htm"],
            "reportDate": ["2021-09-25", "2021-12-25"],  # period_of_report — must NOT be used
        }
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_provider(tmp_path: Path) -> SECEdgarProvider:
    return SECEdgarProvider(
        user_agent="Test Agent test@example.com",
        rate_limit_delay=0.0,  # no delay in tests
        max_retries=3,
        submissions_dir=str(tmp_path / "submissions"),
        facts_dir=str(tmp_path / "facts"),
        filings_dir=str(tmp_path / "filings"),
    )


# ---------------------------------------------------------------------------
# test_cik_lookup_padded
# ---------------------------------------------------------------------------


def test_cik_lookup_padded(tmp_path: Path):
    """get_cik should return zero-padded 10-digit CIK."""
    provider = _make_provider(tmp_path)
    provider._ticker_map = FAKE_TICKER_MAP

    cik = provider.get_cik("AAPL")
    assert cik is not None
    assert len(cik) == 10
    assert cik == "0000320193"


def test_cik_lookup_case_insensitive(tmp_path: Path):
    provider = _make_provider(tmp_path)
    provider._ticker_map = FAKE_TICKER_MAP

    cik_lower = provider.get_cik("aapl")
    cik_upper = provider.get_cik("AAPL")
    assert cik_lower == cik_upper


def test_cik_not_found_returns_none(tmp_path: Path):
    provider = _make_provider(tmp_path)
    provider._ticker_map = FAKE_TICKER_MAP

    cik = provider.get_cik("UNKNOWNSYM")
    assert cik is None


# ---------------------------------------------------------------------------
# test_available_at_never_fiscal_end
# ---------------------------------------------------------------------------


def test_available_at_never_fiscal_end(tmp_path: Path):
    """available_at must not equal period_of_report (fiscal end date)."""
    provider = _make_provider(tmp_path)

    # Simulate fetch_submissions returning the fake data (already cached)
    sub_dir = tmp_path / "submissions"
    sub_dir.mkdir(parents=True, exist_ok=True)
    (sub_dir / "CIK0000320193.json").write_text(json.dumps(FAKE_SUBMISSIONS))

    df = provider.fetch_recent_filings("0000320193", ["10-K", "10-Q"])
    assert not df.empty

    fiscal_end_dates = {"2021-09-25", "2021-12-25"}
    available_at_strs = set(df["available_at"].dt.strftime("%Y-%m-%d").tolist())
    assert not available_at_strs.intersection(fiscal_end_dates), (
        f"available_at must not be fiscal period end date. "
        f"Got {available_at_strs} which overlaps {fiscal_end_dates}"
    )


# ---------------------------------------------------------------------------
# test_filings_df_schema
# ---------------------------------------------------------------------------


def test_filings_df_schema(tmp_path: Path):
    """fetch_recent_filings must return the required column set."""
    provider = _make_provider(tmp_path)
    sub_dir = tmp_path / "submissions"
    sub_dir.mkdir(parents=True, exist_ok=True)
    (sub_dir / "CIK0000320193.json").write_text(json.dumps(FAKE_SUBMISSIONS))

    df = provider.fetch_recent_filings("0000320193", ["10-K", "10-Q"])
    required = {
        "accessionNumber",
        "form",
        "filingDate",
        "acceptedDatetime",
        "primaryDocument",
        "available_at",
    }
    assert required.issubset(set(df.columns)), (
        f"Missing columns: {required - set(df.columns)}"
    )


# ---------------------------------------------------------------------------
# test_rate_limit_delay_applied
# ---------------------------------------------------------------------------


def test_rate_limit_delay_applied(tmp_path: Path):
    """_get_json should call time.sleep with rate_limit_delay before each request."""
    provider = _make_provider(tmp_path)
    provider.rate_limit_delay = 0.05

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"data": "test"}

    with patch("data.providers.sec.edgar.requests.get", return_value=mock_response) as mock_get, \
         patch("data.providers.sec.edgar.time.sleep") as mock_sleep:
        provider._get_json("https://data.sec.gov/test")
        mock_sleep.assert_called()
        # First sleep call should be rate_limit_delay
        first_sleep_arg = mock_sleep.call_args_list[0][0][0]
        assert first_sleep_arg == pytest.approx(0.05)


# ---------------------------------------------------------------------------
# test_retry_on_429
# ---------------------------------------------------------------------------


def test_retry_on_429(tmp_path: Path):
    """_get_json must retry after receiving HTTP 429."""
    provider = _make_provider(tmp_path)
    provider.max_retries = 3

    response_429 = MagicMock()
    response_429.status_code = 429

    response_ok = MagicMock()
    response_ok.status_code = 200
    response_ok.json.return_value = {"ok": True}

    side_effects = [response_429, response_ok]

    with patch("data.providers.sec.edgar.requests.get", side_effect=side_effects) as mock_get, \
         patch("data.providers.sec.edgar.time.sleep"):
        result = provider._get_json("https://data.sec.gov/test")
    assert result == {"ok": True}
    assert mock_get.call_count == 2


# ---------------------------------------------------------------------------
# test_raw_json_cached
# ---------------------------------------------------------------------------


def test_raw_json_cached(tmp_path: Path):
    """fetch_submissions should cache raw JSON to raw_sec_submissions/."""
    provider = _make_provider(tmp_path)

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = FAKE_SUBMISSIONS

    with patch("data.providers.sec.edgar.requests.get", return_value=mock_response), \
         patch("data.providers.sec.edgar.time.sleep"):
        provider.fetch_submissions("0000320193")

    cache_file = tmp_path / "submissions" / "CIK0000320193.json"
    assert cache_file.exists(), "Submissions JSON was not cached to disk"
    with open(cache_file) as f:
        cached = json.load(f)
    assert "filings" in cached


# ---------------------------------------------------------------------------
# acceptance timestamp is honoured (regression: key was misspelled)
# ---------------------------------------------------------------------------


def test_available_at_uses_acceptance_timestamp(tmp_path: Path):
    """available_at must come from acceptanceDateTime, not filing-date midnight."""
    provider = _make_provider(tmp_path)
    with patch.object(provider, "fetch_submissions", return_value=FAKE_SUBMISSIONS):
        df = provider.fetch_recent_filings("320193", ["10-K", "10-Q"])
    got = sorted(df["available_at"].tolist())
    assert got[0] == pd.Timestamp("2022-01-10 16:45:00")
    assert got[1] == pd.Timestamp("2022-04-15 09:30:00")
    # an after-close filing is NOT visible at the same day's midnight row
    assert not (df["available_at"] <= pd.Timestamp("2022-01-10")).any()


def test_available_at_without_acceptance_is_next_day(tmp_path: Path):
    """No acceptance timestamp -> conservatively available the day after filing."""
    provider = _make_provider(tmp_path)
    subs = {"filings": {"recent": {
        "accessionNumber": ["a-1"], "form": ["8-K"], "filingDate": ["2023-03-01"],
        "primaryDocument": ["x.htm"],
    }}}
    with patch.object(provider, "fetch_submissions", return_value=subs):
        df = provider.fetch_recent_filings("320193", ["8-K"])
    assert df["available_at"].iloc[0] == pd.Timestamp("2023-03-02")
