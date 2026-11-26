"""Deterministic OHLCV fixtures for backtest tests (no network)."""
from __future__ import annotations

import numpy as np
import pandas as pd


def make_ohlcv(closes, start="2020-01-01", freq="B", gap=0.0, spread=0.01) -> pd.DataFrame:
    """Bars whose open is the previous close moved by ``gap`` and whose
    high/low bracket open and close by ``spread``."""
    closes = np.asarray(closes, dtype=float)
    idx = pd.date_range(start, periods=len(closes), freq=freq)
    opens = np.concatenate([[closes[0]], closes[:-1]]) * (1 + gap)
    hi = np.maximum(opens, closes) * (1 + spread)
    lo = np.minimum(opens, closes) * (1 - spread)
    return pd.DataFrame({"open": opens, "high": hi, "low": lo, "close": closes,
                         "volume": np.full(len(closes), 1e6)}, index=idx)


def random_walk(n=600, seed=1, drift=0.0004, vol=0.015, start_price=100.0, start="2018-01-01", freq="B"):
    rng = np.random.default_rng(seed)
    r = rng.normal(drift, vol, n)
    closes = start_price * np.exp(np.cumsum(r))
    opens = np.concatenate([[start_price], closes[:-1]]) * np.exp(rng.normal(0, vol / 3, n))
    hi = np.maximum(opens, closes) * (1 + np.abs(rng.normal(0, vol / 2, n)))
    lo = np.minimum(opens, closes) * (1 - np.abs(rng.normal(0, vol / 2, n)))
    idx = pd.date_range(start, periods=n, freq=freq)
    return pd.DataFrame({"open": opens, "high": hi, "low": lo, "close": closes, "volume": 1e6}, index=idx)
