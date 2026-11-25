"""Tests for OHLCV ingestion: normalisation, quality checks, parquet, fallback."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data.config import FreeDataConfig
from data.ingestion.ohlcv import OHLCVIngestion


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_good_df(symbol: str = "AAPL", n: int = 30) -> pd.DataFrame:
    """Return a clean OHLCV DataFrame with no quality issues."""
    import numpy as np

    rng = np.random.default_rng(0)
    dates = pd.bdate_range("2022-01-03", periods=n)
    closes = 100.0 * (1 + rng.normal(0, 0.005, n)).cumprod()
    return pd.DataFrame({
        "symbol": symbol,
        "date": dates,
        "open": closes * 0.999,
        "high": closes * 1.003,
        "low": closes * 0.997,
        "close": closes,
        "volume": rng.integers(1_000_000, 5_000_000, n).astype(float),
        "source": "test",
    })


# ---------------------------------------------------------------------------
# test_normalize_columns
# ---------------------------------------------------------------------------

def test_normalize_columns(free_data_config: FreeDataConfig):
    ingestion = OHLCVIngestion(free_data_config)
    df = _make_good_df()
    # Quality check should not raise even on well-formed data
    report = ingestion.run_quality_checks(df)
    assert "total_rows" in report
    # All expected columns present
    expected = {"symbol", "date", "open", "high", "low", "close", "volume", "source"}
    assert expected.issubset(set(df.columns))


# ---------------------------------------------------------------------------
# test_zero_prices_detected
# ---------------------------------------------------------------------------

def test_zero_prices_detected(free_data_config: FreeDataConfig):
    ingestion = OHLCVIngestion(free_data_config)
    df = _make_good_df()
    # Inject a zero close price
    df.loc[5, "close"] = 0.0
    report = ingestion.run_quality_checks(df)
    assert len(report["zero_negative_prices"]) >= 1


def test_negative_price_detected(free_data_config: FreeDataConfig):
    ingestion = OHLCVIngestion(free_data_config)
    df = _make_good_df()
    df.loc[3, "open"] = -5.0
    report = ingestion.run_quality_checks(df)
    assert len(report["zero_negative_prices"]) >= 1


# ---------------------------------------------------------------------------
# test_duplicate_bars_detected
# ---------------------------------------------------------------------------

def test_duplicate_bars_detected(free_data_config: FreeDataConfig):
    ingestion = OHLCVIngestion(free_data_config)
    df = _make_good_df()
    # Duplicate the first row (same symbol, same date)
    dup = df.iloc[[0]].copy()
    df_with_dup = pd.concat([df, dup], ignore_index=True)
    report = ingestion.run_quality_checks(df_with_dup)
    assert len(report["duplicate_bars"]) >= 1


# ---------------------------------------------------------------------------
# test_split_like_jump_detected
# ---------------------------------------------------------------------------

def test_split_like_jump_detected(free_data_config: FreeDataConfig):
    ingestion = OHLCVIngestion(free_data_config)
    df = _make_good_df()
    # Force a 50% one-day jump (split-like)
    df.loc[10, "close"] = df.loc[9, "close"] * 1.55
    report = ingestion.run_quality_checks(df)
    assert len(report["split_like_jumps"]) >= 1


# ---------------------------------------------------------------------------
# test_parquet_partitioned_by_symbol_year
# ---------------------------------------------------------------------------

def test_parquet_partitioned_by_symbol_year(free_data_config: FreeDataConfig, tmp_path: Path):
    ingestion = OHLCVIngestion(free_data_config)
    df = pd.concat([_make_good_df("AAPL"), _make_good_df("MSFT")], ignore_index=True)
    ingestion.save_parquet(df)
    parquet_base = Path(free_data_config.processed_parquet)
    # Check that symbol and year appear in the path
    parquet_files = list(parquet_base.rglob("*.parquet"))
    assert len(parquet_files) >= 2, "Expected at least 2 parquet partition files"
    paths_str = [str(p) for p in parquet_files]
    assert any("symbol=AAPL" in p for p in paths_str), "Expected AAPL partition"
    assert any("symbol=MSFT" in p for p in paths_str), "Expected MSFT partition"
    assert all("year=" in p for p in paths_str), "Expected year partition in all files"


# ---------------------------------------------------------------------------
# test_fallback_to_yfinance
# ---------------------------------------------------------------------------

def test_fallback_to_yfinance(free_data_config: FreeDataConfig):
    """If stooq returns empty, yfinance provider should be tried."""
    ingestion = OHLCVIngestion(free_data_config)

    mock_stooq = MagicMock()
    mock_stooq.name = "stooq"
    mock_stooq.fetch_daily_bars.return_value = pd.DataFrame()  # stooq fails

    mock_yf = MagicMock()
    mock_yf.name = "yfinance"
    mock_yf.fetch_daily_bars.return_value = _make_good_df("AAPL")  # yfinance succeeds

    ingestion.providers = [mock_stooq, mock_yf]

    result = ingestion.fetch_symbol("AAPL", "2022-01-01", "2022-12-31")
    assert not result.empty, "Expected yfinance data after stooq failed"
    mock_stooq.fetch_daily_bars.assert_called_once()
    mock_yf.fetch_daily_bars.assert_called_once()


# ---------------------------------------------------------------------------
# test_quality_report_saved
# ---------------------------------------------------------------------------

def test_quality_report_saved(free_data_config: FreeDataConfig):
    """run() must write ohlcv_data_quality_report.json."""
    ingestion = OHLCVIngestion(free_data_config)

    good_df = _make_good_df("AAPL", n=260)  # > MIN_BARS

    mock_stooq = MagicMock()
    mock_stooq.name = "stooq"
    mock_stooq.fetch_daily_bars.return_value = good_df

    ingestion.providers = [mock_stooq]

    ingestion.run(["AAPL"], "2022-01-01", "2022-12-31")

    report_path = Path(free_data_config.processed_parquet) / "ohlcv_data_quality_report.json"
    assert report_path.exists(), "Quality report JSON was not written"
    with open(report_path) as f:
        report = json.load(f)
    assert "total_rows" in report
    assert "duplicate_bars" in report
