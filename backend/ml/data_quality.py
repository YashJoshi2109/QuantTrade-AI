"""
Production data quality pipeline.
Runs continuous validation on incoming data and features.
"""
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime, timezone

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class QualityReport:
    symbol: str
    timestamp: str
    passed: bool
    checks: List[Dict[str, any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


def validate_ohlcv(df: pd.DataFrame, symbol: str, min_rows: int = 200) -> QualityReport:
    """Validate raw OHLCV data quality."""
    report = QualityReport(
        symbol=symbol,
        timestamp=datetime.now(timezone.utc).isoformat(),
        passed=True,
    )

    # Check minimum rows
    if len(df) < min_rows:
        report.errors.append(f"Insufficient rows: {len(df)} < {min_rows}")
        report.passed = False
        report.checks.append({"name": "min_rows", "passed": False, "value": len(df)})
    else:
        report.checks.append({"name": "min_rows", "passed": True, "value": len(df)})

    # Check for NaN values
    nan_counts = df[["Open", "High", "Low", "Close", "Volume"]].isna().sum()
    total_nans = nan_counts.sum()
    if total_nans > 0:
        report.warnings.append(f"NaN values found: {nan_counts.to_dict()}")
        report.checks.append({"name": "no_nans", "passed": total_nans == 0, "value": int(total_nans)})

    # Check OHLC ordering (High >= Low, Close within range)
    if len(df) > 0:
        invalid_hl = (df["High"] < df["Low"]).sum()
        if invalid_hl > 0:
            report.errors.append(f"{invalid_hl} rows with High < Low")
            report.passed = False
        report.checks.append({"name": "ohlc_order", "passed": invalid_hl == 0, "value": int(invalid_hl)})

    # Check for zero volume days
    zero_vol = (df["Volume"] == 0).sum()
    if zero_vol > len(df) * 0.1:
        report.warnings.append(f"{zero_vol} zero-volume days (>{10}%)")
    report.checks.append({"name": "zero_volume", "passed": zero_vol <= len(df) * 0.1, "value": int(zero_vol)})

    # Check for duplicate timestamps
    dupes = df.index.duplicated().sum()
    if dupes > 0:
        report.errors.append(f"{dupes} duplicate timestamps")
        report.passed = False
    report.checks.append({"name": "no_duplicates", "passed": dupes == 0, "value": int(dupes)})

    # Check for extreme price spikes (>20% daily change)
    if len(df) > 1:
        returns = df["Close"].pct_change().dropna()
        spikes = (returns.abs() > 0.20).sum()
        if spikes > len(df) * 0.01:
            report.warnings.append(f"{spikes} extreme price spikes (>20%)")
        report.checks.append({"name": "price_spikes", "passed": spikes <= len(df) * 0.01, "value": int(spikes)})

    # Check data freshness
    if hasattr(df.index, 'max'):
        latest = pd.Timestamp(df.index.max())
        if latest.tzinfo is None:
            latest = latest.tz_localize("UTC")
        age_days = (pd.Timestamp.now(tz="UTC") - latest).days
        if age_days > 5:  # Allow weekends
            report.warnings.append(f"Data is {age_days} days old")
        report.checks.append({"name": "freshness", "passed": age_days <= 5, "value": age_days})

    return report


def validate_features(df: pd.DataFrame, feature_columns: List[str], symbol: str) -> QualityReport:
    """Validate computed features quality."""
    report = QualityReport(
        symbol=symbol,
        timestamp=datetime.now(timezone.utc).isoformat(),
        passed=True,
    )

    # Check all columns present
    missing = [c for c in feature_columns if c not in df.columns]
    if missing:
        report.errors.append(f"Missing features: {missing}")
        report.passed = False
    report.checks.append({"name": "all_columns", "passed": len(missing) == 0, "value": len(missing)})

    # Check for inf values
    for col in feature_columns:
        if col in df.columns:
            inf_count = df[col].isin([np.inf, -np.inf]).sum()
            if inf_count > 0:
                report.errors.append(f"{col}: {inf_count} inf values")
                report.passed = False

    # Check for excessive NaN after computation
    nan_pct = df[feature_columns].isna().mean()
    high_nan = nan_pct[nan_pct > 0.05]
    if len(high_nan) > 0:
        for col, pct in high_nan.items():
            report.warnings.append(f"{col}: {pct:.1%} NaN")
    report.checks.append({"name": "low_nan_rate", "passed": len(high_nan) == 0, "value": len(high_nan)})

    # Check feature ranges (basic sanity)
    if "RSI_14" in df.columns:
        invalid_rsi = ((df["RSI_14"] < 0) | (df["RSI_14"] > 100)).sum()
        if invalid_rsi > 0:
            report.errors.append(f"RSI out of [0, 100]: {invalid_rsi} rows")
            report.passed = False
        report.checks.append({"name": "rsi_range", "passed": invalid_rsi == 0, "value": int(invalid_rsi)})

    return report
