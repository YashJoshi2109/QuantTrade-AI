"""Deterministic synthetic market for quant-engine tests (no network).

Market (SPY) daily returns ~ N(0.0004, 0.011) with a high-volatility crash
spell; each stock is r_i = a_i + beta_i * r_SPY + e_i with known parameters,
so estimators can be checked against the truth used to generate the data.
Earnings days carry a known injected abnormal return.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from app.services.backtesting.data import PriceSeries
from app.services.quant.data import EarningsEvents, QuantData, RiskFree

INDEX = pd.bdate_range("2017-01-02", "2026-11-20")
N = len(INDEX)

# symbol -> (alpha_daily, beta, idio_sd)
TRUTH = {
    "NVDA": (0.0010, 1.8, 0.020), "AAPL": (0.0003, 1.1, 0.010), "MSFT": (0.0003, 1.05, 0.009),
    "AMZN": (0.0002, 1.2, 0.013), "GOOGL": (0.0002, 1.1, 0.012), "TSLA": (0.0008, 1.9, 0.030),
    "TSM": (0.0004, 1.3, 0.014), "QQQ": (0.0001, 1.15, 0.004), "XLK": (0.0001, 1.2, 0.005),
    "XLY": (0.0, 1.05, 0.005), "XLC": (0.0, 1.0, 0.006),
}
SECTORS = {"NVDA": "Technology", "AAPL": "Technology", "MSFT": "Technology", "AMZN": "Consumer Cyclical",
           "GOOGL": "Communication Services", "TSLA": "Consumer Cyclical", "TSM": "Technology"}
EVENT_AR = 0.04          # injected abnormal return on day 0 (sign = surprise sign)


def _market() -> np.ndarray:
    rng = np.random.default_rng(2024)
    r = rng.normal(0.0004, 0.011, N)
    crash = (INDEX >= "2020-02-20") & (INDEX <= "2020-04-30")
    r[crash] = rng.normal(-0.004, 0.04, crash.sum())
    return r


MKT = _market()


def aapl_events() -> List[dict]:
    """12 quarterly events; 9 positive surprises (released after the close),
    3 negative (before the open)."""
    dates = pd.date_range("2023-11-02", periods=12, freq="91D")
    out = []
    for k, d in enumerate(dates):
        d = INDEX[INDEX.searchsorted(d)]
        pos = k % 4 != 1
        out.append({"date": d.date().isoformat(), "timing": "amc" if pos else "bmo",
                    "eps_actual": 1.10 if pos else 0.90, "eps_estimate": 1.00,
                    "surprise_pct": 10.0 if pos else -10.0})
    return out


def _returns(sym: str) -> np.ndarray:
    if sym == "SPY":
        return MKT.copy()
    a, b, sd = TRUTH[sym]
    rng = np.random.default_rng(sum(map(ord, sym)) * 7919)
    r = a + b * MKT + rng.normal(0, sd, N)
    if sym == "AAPL":
        for ev in aapl_events():
            pos = int(INDEX.searchsorted(pd.Timestamp(ev["date"]), side="right" if ev["timing"] == "amc" else "left"))
            r[pos] += EVENT_AR if ev["eps_actual"] > ev["eps_estimate"] else -EVENT_AR
    return r


def closes(sym: str) -> pd.Series:
    return pd.Series(100 * np.cumprod(1 + _returns(sym)), index=INDEX, name=sym)


class FakeQuantData(QuantData):
    def __init__(self, missing: Optional[set] = None, rf: bool = True, late_start: Optional[Dict[str, str]] = None):
        self.missing = missing or set()
        self.rf = rf
        self.late_start = late_start or {}
        self.calls: List[str] = []

    def prices(self, symbol: str, start: datetime, end: datetime) -> Optional[PriceSeries]:
        self.calls.append(symbol)
        if symbol in self.missing or (symbol not in TRUTH and symbol != "SPY"):
            return None
        c = closes(symbol)
        if symbol in self.late_start:
            c = c[c.index >= self.late_start[symbol]]
        c = c[(c.index >= pd.Timestamp(start).normalize()) & (c.index <= pd.Timestamp(end).normalize())]
        opens = np.concatenate([[c.iloc[0]], c.to_numpy()[:-1]])
        df = pd.DataFrame({"open": opens, "high": np.maximum(opens, c) * 1.005,
                           "low": np.minimum(opens, c) * 0.995, "close": c, "volume": 1e6}, index=c.index)
        return PriceSeries(symbol, df, "fixture", True, [])

    def risk_free(self, start, end):
        if not self.rf:
            return None
        idx = pd.bdate_range(pd.Timestamp(start) - pd.Timedelta(days=10), end)
        return RiskFree(pd.Series(4.0, index=idx), "fixture DTB3")

    def earnings_events(self, symbol: str, n: int) -> EarningsEvents:
        if symbol != "AAPL":
            return EarningsEvents([], None, ["fixture has no events"])
        return EarningsEvents(aapl_events()[-n:], "fixture earnings", [])

    def sector(self, symbol: str):
        s = SECTORS.get(symbol)
        return {"sector": s, "industry": None, "source": "fixture"} if s else None
