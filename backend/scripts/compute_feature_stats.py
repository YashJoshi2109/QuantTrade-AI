"""
Lightweight daily feature-statistics job.

For each default symbol, downloads recent price history using yfinance and
computes simple feature stats (mean/std) for:
- daily returns
- dollar volume

Writes one row per (symbol, feature) into ml_feature_stats so dashboards and
monitoring can visualize basic drift over time.
"""

from __future__ import annotations

from typing import List

import yfinance as yf
import pandas as pd

import os
import sys

# Ensure backend package is on sys.path when running as a script
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from app.config import settings  # type: ignore  # noqa: E402
from app.db.database import SessionLocal  # type: ignore  # noqa: E402
from app.models.ml_monitoring import MLFeatureStat  # type: ignore  # noqa: E402


SYMBOLS: List[str] = [s.strip() for s in settings.DEFAULT_SYMBOLS.split(",") if s.strip()]
LOOKBACK_DAYS = 120


def compute_stats_for_symbol(symbol: str) -> None:
    db = SessionLocal()
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=f"{LOOKBACK_DAYS}d")
        if hist is None or hist.empty:
            print(f"⚠️ No historical data for {symbol}; skipping.")
            return

        # Basic features: daily returns and dollar volume
        df = pd.DataFrame(hist[["Close", "Volume"]]).dropna()
        df["daily_return"] = df["Close"].pct_change()
        df["dollar_volume"] = df["Close"] * df["Volume"]
        df = df.dropna(subset=["daily_return", "dollar_volume"])
        if df.empty:
            print(f"⚠️ Not enough cleaned rows for {symbol}; skipping.")
            return

        window_start = df.index.min().date()
        window_end = df.index.max().date()

        features = {
            "daily_return": df["daily_return"],
            "dollar_volume": df["dollar_volume"],
        }

        for name, series in features.items():
            series = series.dropna()
            if series.empty:
                continue

            stat = MLFeatureStat(
                model_name="lstm_predictor",
                feature_name=name,
                window_start=window_start,
                window_end=window_end,
                mean=float(series.mean()),
                std=float(series.std()),
                psi=None,
                ks_p_value=None,
            )
            db.add(stat)

        db.commit()
        print(f"✅ Logged feature stats for {symbol}")
    finally:
        db.close()


def main() -> None:
    for symbol in SYMBOLS:
        compute_stats_for_symbol(symbol)


if __name__ == "__main__":
    main()

