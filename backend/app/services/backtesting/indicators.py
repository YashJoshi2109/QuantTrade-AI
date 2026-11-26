"""Causal indicator library for the strategy builder.

Every indicator value at bar t uses bars <= t only. Window indicators that
compare price with a range (``highest``, ``lowest``) use the *prior* N bars
(shifted by one) so "close breaks the 20-day high" is reachable. A rolling max
that includes today could never be exceeded by today's close.

``momentum_rank`` is cross-sectional: on each date it ranks the universe by
N-bar return (1 = strongest), using only symbols that have a bar that day.
"""
from __future__ import annotations

from typing import Callable, Dict, Tuple

import numpy as np
import pandas as pd

from app.services.backtesting.limits import MAX_WINDOW

# name -> (param spec {name: (kind, default, lo, hi)}, description)
INDICATORS: Dict[str, Tuple[dict, str]] = {
    "close": ({}, "Close price"),
    "open": ({}, "Open price"),
    "high": ({}, "High price"),
    "low": ({}, "Low price"),
    "volume": ({}, "Volume"),
    "sma": ({"period": ("int", 20, 1, MAX_WINDOW)}, "Simple moving average of close"),
    "ema": ({"period": ("int", 20, 1, MAX_WINDOW)}, "Exponential moving average of close"),
    "rsi": ({"period": ("int", 14, 2, 100)}, "Wilder RSI (0-100)"),
    "macd": ({"fast": ("int", 12, 2, 100), "slow": ("int", 26, 3, 200), "signal": ("int", 9, 2, 50)}, "MACD line (EMA fast - EMA slow)"),
    "macd_signal": ({"fast": ("int", 12, 2, 100), "slow": ("int", 26, 3, 200), "signal": ("int", 9, 2, 50)}, "MACD signal line"),
    "macd_hist": ({"fast": ("int", 12, 2, 100), "slow": ("int", 26, 3, 200), "signal": ("int", 9, 2, 50)}, "MACD histogram"),
    "bb_upper": ({"period": ("int", 20, 2, MAX_WINDOW), "std": ("float", 2.0, 0.1, 5.0)}, "Upper Bollinger band"),
    "bb_mid": ({"period": ("int", 20, 2, MAX_WINDOW)}, "Bollinger mid band (SMA)"),
    "bb_lower": ({"period": ("int", 20, 2, MAX_WINDOW), "std": ("float", 2.0, 0.1, 5.0)}, "Lower Bollinger band"),
    "highest": ({"period": ("int", 20, 1, MAX_WINDOW)}, "Highest high of the prior N bars (excludes today)"),
    "lowest": ({"period": ("int", 20, 1, MAX_WINDOW)}, "Lowest low of the prior N bars (excludes today)"),
    "roc": ({"period": ("int", 20, 1, MAX_WINDOW)}, "N-bar rate of change, %"),
    "zscore": ({"period": ("int", 20, 2, MAX_WINDOW)}, "Z-score of close vs its N-bar mean"),
    "atr_pct": ({"period": ("int", 14, 1, 100)}, "Average true range as % of close"),
    "volume_sma": ({"period": ("int", 20, 1, MAX_WINDOW)}, "Average volume"),
    "momentum_rank": ({"period": ("int", 126, 1, MAX_WINDOW)}, "Cross-sectional rank by N-bar return (1 = strongest)"),
}


def window_of(name: str, params: dict) -> int:
    spec = INDICATORS[name][0]
    w = 1
    for k, (kind, _d, _lo, _hi) in spec.items():
        if kind == "int":
            w = max(w, int(params.get(k, spec[k][1])))
    if name.startswith("macd"):
        w = int(params.get("slow", 26)) * 3 + int(params.get("signal", 9))
    if name in ("ema", "rsi"):
        w = w * 3  # exponential smoothing: let early values settle
    return w + 1


def _rsi(close: pd.Series, period: int) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(dn != 0, 100.0).where(up.notna())


def _macd(close: pd.Series, fast: int, slow: int, signal: int):
    line = close.ewm(span=fast, adjust=False, min_periods=fast).mean() - close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return line, sig


def compute(name: str, params: dict, df: pd.DataFrame) -> pd.Series:
    """One indicator on one symbol's frame (rows may contain NaN gaps)."""
    p = {k: v[1] for k, v in INDICATORS[name][0].items()}
    p.update(params or {})
    bars = df.dropna(subset=["close"])
    c = bars["close"]
    if name in ("close", "open", "high", "low", "volume"):
        out = bars[name]
    elif name == "sma":
        out = c.rolling(p["period"], min_periods=p["period"]).mean()
    elif name == "ema":
        out = c.ewm(span=p["period"], adjust=False, min_periods=p["period"]).mean()
    elif name == "rsi":
        out = _rsi(c, p["period"])
    elif name in ("macd", "macd_signal", "macd_hist"):
        line, sig = _macd(c, p["fast"], p["slow"], p["signal"])
        out = {"macd": line, "macd_signal": sig, "macd_hist": line - sig}[name]
    elif name in ("bb_upper", "bb_mid", "bb_lower"):
        mid = c.rolling(p["period"], min_periods=p["period"]).mean()
        sd = c.rolling(p["period"], min_periods=p["period"]).std()
        out = {"bb_upper": mid + p.get("std", 2.0) * sd, "bb_mid": mid, "bb_lower": mid - p.get("std", 2.0) * sd}[name]
    elif name == "highest":
        out = bars["high"].rolling(p["period"], min_periods=p["period"]).max().shift(1)
    elif name == "lowest":
        out = bars["low"].rolling(p["period"], min_periods=p["period"]).min().shift(1)
    elif name == "roc":
        out = (c / c.shift(p["period"]) - 1) * 100
    elif name == "zscore":
        m = c.rolling(p["period"], min_periods=p["period"]).mean()
        s = c.rolling(p["period"], min_periods=p["period"]).std()
        out = (c - m) / s.replace(0, np.nan)
    elif name == "atr_pct":
        pc = c.shift(1)
        tr = pd.concat([bars["high"] - bars["low"], (bars["high"] - pc).abs(), (bars["low"] - pc).abs()], axis=1).max(axis=1)
        out = tr.ewm(alpha=1 / p["period"], adjust=False, min_periods=p["period"]).mean() / c * 100
    elif name == "volume_sma":
        out = bars["volume"].rolling(p["period"], min_periods=p["period"]).mean()
    else:
        raise ValueError(f"unknown indicator {name}")
    return out.reindex(df.index)


class IndicatorCache:
    """Per-run cache so a parameter sweep computes each indicator once."""

    def __init__(self, frames: Dict[str, pd.DataFrame], index: pd.DatetimeIndex):
        self.frames = {s: f.reindex(index) for s, f in frames.items()}
        self.index = index
        self._c: Dict[tuple, pd.Series] = {}

    def get(self, sym: str, name: str, params: dict) -> np.ndarray:
        key = (sym, name, tuple(sorted((params or {}).items())))
        if key not in self._c:
            if name == "momentum_rank":
                self._rank(params)
            else:
                self._c[key] = compute(name, params, self.frames[sym])
        return self._c[key].to_numpy(dtype=float)

    def _rank(self, params: dict):
        period = int(params.get("period", 126))
        rocs = pd.DataFrame({s: compute("roc", {"period": period}, f) for s, f in self.frames.items()})
        ranks = rocs.rank(axis=1, ascending=False, method="min")
        for s in self.frames:
            self._c[(s, "momentum_rank", tuple(sorted(params.items())))] = ranks[s]
