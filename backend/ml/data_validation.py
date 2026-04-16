"""Data quality validation for ML training.

Run before feature computation to catch bad data early.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd


@dataclass
class ValidationReport:
    symbol: str
    total_rows: int = 0
    duplicate_timestamps: int = 0
    missing_weekdays: int = 0
    zero_volume_days: int = 0
    nan_count_by_column: dict[str, int] = field(default_factory=dict)
    price_spike_days: int = 0  # >20% single-day move
    insufficient_history: bool = False
    is_valid: bool = True
    rejection_reason: Optional[str] = None

    def __str__(self) -> str:
        status = "PASS" if self.is_valid else f"FAIL: {self.rejection_reason}"
        return f"[{self.symbol}] {self.total_rows} rows — {status}"


def validate_ohlcv(df: pd.DataFrame, symbol: str, min_rows: int = 500) -> ValidationReport:
    """Validate raw OHLCV DataFrame before feature computation."""
    report = ValidationReport(symbol=symbol)

    if df.empty:
        report.is_valid = False
        report.rejection_reason = "Empty DataFrame"
        return report

    report.total_rows = len(df)

    # Duplicate timestamps
    if hasattr(df.index, 'duplicated'):
        report.duplicate_timestamps = int(df.index.duplicated().sum())

    # Missing business days
    if hasattr(df.index, 'freq') or len(df) > 1:
        try:
            bdays = pd.bdate_range(df.index.min(), df.index.max())
            report.missing_weekdays = len(bdays) - len(df.index.intersection(bdays))
        except Exception:
            pass

    # Zero volume
    if "volume" in df.columns:
        report.zero_volume_days = int((df["volume"] == 0).sum())
    elif "Volume" in df.columns:
        report.zero_volume_days = int((df["Volume"] == 0).sum())

    # Price spikes (>20% daily move)
    close_col = "close" if "close" in df.columns else "Close"
    if close_col in df.columns:
        pct = df[close_col].pct_change().abs()
        report.price_spike_days = int((pct > 0.20).sum())

    # NaN counts
    report.nan_count_by_column = {
        col: int(df[col].isna().sum()) for col in df.columns if df[col].isna().any()
    }

    # Insufficient history
    if report.total_rows < min_rows:
        report.insufficient_history = True

    # Rejection logic
    if report.total_rows < min_rows:
        report.is_valid = False
        report.rejection_reason = f"Only {report.total_rows} rows (need {min_rows})"
    elif report.total_rows > 0 and report.zero_volume_days / report.total_rows > 0.05:
        report.is_valid = False
        report.rejection_reason = f"{report.zero_volume_days} zero-volume days ({report.zero_volume_days / report.total_rows:.0%})"
    elif report.total_rows > 0 and report.missing_weekdays / max(report.total_rows, 1) > 0.10:
        report.is_valid = False
        report.rejection_reason = f"{report.missing_weekdays} missing weekdays"

    return report


def validate_features(df: pd.DataFrame, symbol: str) -> ValidationReport:
    """Validate computed feature DataFrame for NaN/inf after dropna."""
    report = ValidationReport(symbol=symbol, total_rows=len(df))

    if df.empty:
        report.is_valid = False
        report.rejection_reason = "Empty feature DataFrame"
        return report

    # Check for inf
    inf_cols = [col for col in df.columns if np.isinf(df[col]).any()]
    if inf_cols:
        report.is_valid = False
        report.rejection_reason = f"Inf values in: {inf_cols}"
        return report

    # NaN counts after feature computation
    report.nan_count_by_column = {
        col: int(df[col].isna().sum()) for col in df.columns if df[col].isna().any()
    }

    total_nans = sum(report.nan_count_by_column.values())
    if total_nans > 0:
        report.is_valid = False
        report.rejection_reason = f"{total_nans} NaN values remain after feature computation"

    return report


def filter_valid_symbols(reports: dict[str, ValidationReport]) -> list[str]:
    """Return symbols that pass validation."""
    return [sym for sym, r in reports.items() if r.is_valid]
