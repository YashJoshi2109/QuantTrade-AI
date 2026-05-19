"""Shared fixtures for data module tests."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pandas as pd
import pytest

from data.config import FreeDataConfig


# ---------------------------------------------------------------------------
# OHLCV fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_ohlcv_df() -> pd.DataFrame:
    """100 rows across 3 symbols × ~34 dates with all required OHLCV columns."""
    import numpy as np

    symbols = ["AAPL", "MSFT", "GOOG"]
    dates = pd.bdate_range("2022-01-03", periods=34)
    rows = []
    rng = np.random.default_rng(42)

    for sym in symbols:
        base = 100.0
        for d in dates:
            close = base * (1 + rng.normal(0, 0.01))
            rows.append({
                "symbol": sym,
                "date": d,
                "open": close * 0.999,
                "high": close * 1.005,
                "low": close * 0.995,
                "close": close,
                "volume": float(rng.integers(1_000_000, 10_000_000)),
                "source": "test",
            })
            base = close

    df = pd.DataFrame(rows)
    # Trim to exactly 100 rows (3 × 34 = 102; drop last 2)
    return df.iloc[:100].reset_index(drop=True)


# ---------------------------------------------------------------------------
# SEC filings fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_filings_df() -> pd.DataFrame:
    """20 rows: AAPL and MSFT with 10-K/10-Q/8-K filings."""
    rows = []
    base_date = pd.Timestamp("2022-01-10")
    symbols = ["AAPL", "MSFT"]
    forms = ["10-K", "10-Q", "8-K", "10-Q", "8-K",
             "10-K", "10-Q", "8-K", "10-Q", "8-K"]
    ciks = {"AAPL": "0000320193", "MSFT": "0000789019"}

    for i, (sym, form) in enumerate([(s, f) for s in symbols for f in forms]):
        filing_date = base_date + pd.Timedelta(days=i * 30)
        accepted = filing_date + pd.Timedelta(hours=6)
        rows.append({
            "symbol": sym,
            "cik": ciks[sym],
            "accessionNumber": f"0000{ciks[sym][4:]}-22-{i:06d}",
            "form": form,
            "filingDate": filing_date,
            "acceptedDatetime": accepted,
            "primaryDocument": f"doc_{i}.htm",
            "available_at": accepted,  # PIT-safe
        })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Sample filing text
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_filing_text() -> str:
    """Fake 10-K text with Risk Factors and MD&A sections."""
    return """
UNITED STATES SECURITIES AND EXCHANGE COMMISSION
Washington, D.C. 20549

FORM 10-K

Item 1. Business
The company operates in the technology sector and provides various software solutions.

Item 1A. Risk Factors
The company faces significant risks and uncertainties that may adversely affect its
business. These include but are not limited to: volatile market conditions, potential
losses from operations, uncertain regulatory environment, and possible litigation
lawsuits from competitors. The company has experienced losses in certain segments and
faces the risk of impairment charges. Adverse economic conditions could lead to
decreases in revenue and deterioration of profit margins.

Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations
The company achieved strong growth in the fiscal year, with revenues increasing 15%
year-over-year. Net income improved significantly as the company successfully expanded
its product portfolio. Management is focused on profitable growth and expects continued
improvement in operating margins. The company exceeded analyst estimates and achieved
record revenues in the second half of the year.

Item 8. Financial Statements
[Financial statements follow]
"""


# ---------------------------------------------------------------------------
# FreeDataConfig fixture with temp dirs
# ---------------------------------------------------------------------------

@pytest.fixture
def free_data_config(tmp_path: Path) -> FreeDataConfig:
    """FreeDataConfig pointing to pytest tmp_path directories."""
    return FreeDataConfig(
        use_stooq=True,
        use_yfinance=True,
        use_sec_edgar=True,
        use_gdelt=True,
        use_finnhub=False,
        raw_ohlcv_stooq=str(tmp_path / "raw/ohlcv/stooq"),
        raw_ohlcv_yfinance=str(tmp_path / "raw/ohlcv/yfinance"),
        raw_sec_submissions=str(tmp_path / "raw/sec/submissions"),
        raw_sec_companyfacts=str(tmp_path / "raw/sec/companyfacts"),
        raw_sec_filings=str(tmp_path / "raw/sec/filings"),
        raw_news_gdelt=str(tmp_path / "raw/news/gdelt"),
        processed_parquet=str(tmp_path / "processed/parquet"),
        ohlcv_symbols=["AAPL", "MSFT"],
        ohlcv_start_date="2022-01-01",
        ohlcv_end_date="2022-12-31",
    )
