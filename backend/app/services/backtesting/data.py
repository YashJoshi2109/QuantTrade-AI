"""Price data for backtests: split/dividend-adjusted OHLCV, validated.

Every frame returned here is *total-return adjusted* (splits and cash
dividends folded into open/high/low/close with one common factor per bar), so
a 4:1 split never shows up as a -75% day and stops, ranges and returns all live
on the same price scale.

Provider notes (the bugs the old loader had are documented in
docs/BACKTESTING.md):

* yfinance ``auto_adjust=True`` adjusts all four prices with the same factor.
* Alpaca bars default to ``adjustment="raw"``; we ask for ``"all"``.
* FMP's ``historical-price-full`` gives raw open/high/low/close plus
  ``adjClose``. Renaming ``adjClose`` to ``close`` (what the old loader did)
  mixes an adjusted close with raw highs/lows. We scale every price by
  ``adjClose / close`` instead.
* Finnhub's free candles are raw. We use them only as a last resort and flag
  them ``adjusted=False`` so the result carries a warning.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

OHLCV = ["open", "high", "low", "close", "volume"]


@dataclass
class PriceSeries:
    symbol: str
    df: pd.DataFrame
    source: str
    adjusted: bool
    warnings: List[str] = field(default_factory=list)


def validate_ohlcv(df: pd.DataFrame, symbol: str = "") -> tuple[pd.DataFrame, List[str]]:
    """Return a clean, sorted, de-duplicated OHLCV frame and a list of warnings.

    Drops rows with missing or non-positive prices, repairs high/low so that
    ``low <= min(open, close)`` and ``high >= max(open, close)`` (vendors
    occasionally ship inconsistent bars), and flags single-day moves above 60%
    that are usually an unadjusted split.
    """
    warnings: List[str] = []
    if df is None or df.empty:
        return pd.DataFrame(columns=OHLCV), warnings
    out = df.copy()
    out.index = pd.to_datetime(out.index)
    if getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_localize(None)
    out.index = out.index.normalize()
    out = out[~out.index.duplicated(keep="last")].sort_index()
    if "volume" not in out.columns:
        out["volume"] = 0.0
    out = out[OHLCV].apply(pd.to_numeric, errors="coerce")
    before = len(out)
    px = out[["open", "high", "low", "close"]]
    out = out[px.notna().all(axis=1) & (px > 0).all(axis=1)]
    if len(out) < before:
        warnings.append(f"{symbol}: dropped {before - len(out)} bars with missing or non-positive prices")
    hi = out[["open", "close", "high"]].max(axis=1)
    lo = out[["open", "close", "low"]].min(axis=1)
    # Adjusted vendor bars are often off by a rounding tick; only flag real repairs.
    gap = np.maximum((hi - out["high"]) / out["close"], (out["low"] - lo) / out["close"])
    if (gap > 0.005).any():
        warnings.append(f"{symbol}: repaired {int((gap > 0.005).sum())} bars where high/low did not contain open/close")
    out["high"], out["low"] = hi, lo
    out["volume"] = out["volume"].fillna(0.0)
    rets = out["close"].pct_change().abs()
    jumps = rets[rets > 0.6]
    if len(jumps):
        d = jumps.index[0].date().isoformat()
        warnings.append(
            f"{symbol}: {len(jumps)} daily move(s) above 60% (first {d}); check for an unadjusted split"
        )
    return out, warnings


def drop_unfinished_bar(df: pd.DataFrame, now: Optional[datetime] = None) -> tuple[pd.DataFrame, Optional[str]]:
    """Drop today's daily bar while today's US session is still running.

    Before the close, vendors return a partial bar for today whose "close" is
    just the latest trade. A backtest that ends today would then mark equity,
    evaluate signals and liquidate on a price that is not a close. Returns the
    frame and a warning when a bar was dropped.
    """
    if df is None or df.empty:
        return df, None
    from app.services import market_calendar as mc

    et = mc._to_et(now)
    today = et.date()
    last = df.index[-1]
    if last.date() != today or not mc.is_trading_day(today):
        return df, None
    if et.time() >= mc.close_time(today):
        return df, None
    return df.iloc[:-1], f"dropped today's unfinished bar ({today.isoformat()}); the session has not closed yet"


# ── Providers ──────────────────────────────────────────────────────────────

def fetch_yfinance(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    try:
        import yfinance as yf

        # yfinance's ``end`` is exclusive: add a day so the end date is included.
        data = yf.download(
            ticker,
            start=start.strftime("%Y-%m-%d"),
            end=(end + timedelta(days=1)).strftime("%Y-%m-%d"),
            progress=False,
            auto_adjust=True,
            threads=False,
        )
        if data is None or data.empty:
            return pd.DataFrame()
        if isinstance(data.columns, pd.MultiIndex):
            data.columns = [c[0] if isinstance(c, tuple) else c for c in data.columns]
        df = data.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
        if not set(["open", "high", "low", "close"]).issubset(df.columns):
            return pd.DataFrame()
        return df
    except Exception as e:  # network / parsing
        logger.info("backtest yfinance fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def fetch_alpaca(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    try:
        from app.services.alpaca_client import alpaca_client

        return alpaca_client.get_historical_bars(ticker, start, end, adjustment="all")
    except Exception as e:
        logger.info("backtest alpaca fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def adjust_fmp_rows(rows: List[dict]) -> pd.DataFrame:
    """Turn FMP ``historical`` rows into an adjusted OHLCV frame.

    Every price is multiplied by ``adjClose / close`` for that bar, so open,
    high, low and close share one adjustment factor.
    """
    df = pd.DataFrame(rows)
    if df.empty or "date" not in df.columns:
        return pd.DataFrame()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    if not {"open", "high", "low", "close"}.issubset(df.columns):
        return pd.DataFrame()
    if "adjClose" in df.columns:
        factor = (df["adjClose"] / df["close"]).replace([np.inf, -np.inf], np.nan).fillna(1.0)
        for col in ("open", "high", "low", "close"):
            df[col] = df[col] * factor
        if "volume" in df.columns:
            df["volume"] = df["volume"] / factor
    if "volume" not in df.columns:
        df["volume"] = 0.0
    return df[OHLCV]


def fetch_fmp(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    try:
        from app.config import settings

        if not settings.FMP_API_KEY:
            return pd.DataFrame()
        import requests

        resp = requests.get(
            f"https://financialmodelingprep.com/api/v3/historical-price-full/{ticker}",
            params={"apikey": settings.FMP_API_KEY, "from": start.strftime("%Y-%m-%d"), "to": end.strftime("%Y-%m-%d")},
            timeout=15,
        )
        data = resp.json()
        return adjust_fmp_rows(data.get("historical") or []) if isinstance(data, dict) else pd.DataFrame()
    except Exception as e:
        logger.info("backtest FMP fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def fetch_finnhub(ticker: str, start: datetime, end: datetime) -> pd.DataFrame:
    try:
        from app.config import settings

        if not settings.FINNHUB_API_KEY:
            return pd.DataFrame()
        import requests

        resp = requests.get(
            "https://finnhub.io/api/v1/stock/candle",
            params={"symbol": ticker, "resolution": "D", "from": int(start.timestamp()),
                    "to": int(end.timestamp()), "token": settings.FINNHUB_API_KEY},
            timeout=15,
        )
        data = resp.json()
        if data.get("s") != "ok" or not data.get("c"):
            return pd.DataFrame()
        df = pd.DataFrame({"open": data["o"], "high": data["h"], "low": data["l"], "close": data["c"], "volume": data["v"]})
        df.index = pd.to_datetime(data["t"], unit="s")
        return df
    except Exception as e:
        logger.info("backtest Finnhub fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


# (name, fetcher, adjusted?) in priority order. Tests replace this list.
PROVIDERS: List[tuple[str, Callable[[str, datetime, datetime], pd.DataFrame], bool]] = [
    ("yfinance", fetch_yfinance, True),
    ("alpaca", fetch_alpaca, True),
    ("fmp", fetch_fmp, True),
    ("finnhub", fetch_finnhub, False),
]

_CACHE: Dict[tuple, tuple[float, PriceSeries]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_S = 900
_CACHE_MAX = 64


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


def load_prices(ticker: str, start: datetime, end: datetime, min_bars: int = 20) -> Optional[PriceSeries]:
    """Fetch adjusted daily bars from the first provider that has enough data.

    Results are cached in-process for 15 minutes (bounded to 64 entries) so a
    parameter sweep or a re-run does not re-download.
    """
    sym = ticker.strip().upper()
    key = (sym, start.date().isoformat(), end.date().isoformat())
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and now - hit[0] < _CACHE_TTL_S:
            return hit[1]
    for name, fetch, adjusted in PROVIDERS:
        raw = fetch(sym, start, end)
        df, warns = validate_ohlcv(raw, sym)
        df, partial = drop_unfinished_bar(df)
        if partial:
            warns.append(f"{sym}: {partial}")
        if len(df) >= min_bars:
            df = df[(df.index >= pd.Timestamp(start).normalize()) & (df.index <= pd.Timestamp(end).normalize())]
            if len(df) < min_bars:
                continue
            if not adjusted:
                warns.append(f"{sym}: {name} bars are not split/dividend adjusted")
            ps = PriceSeries(sym, df, name, adjusted, warns)
            with _CACHE_LOCK:
                if len(_CACHE) >= _CACHE_MAX:
                    _CACHE.pop(min(_CACHE, key=lambda k: _CACHE[k][0]))
                _CACHE[key] = (now, ps)
            return ps
    return None
