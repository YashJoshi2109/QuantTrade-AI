"""Statistical forecast API — GET /api/v1/forecast/{ticker}.

Serves the ARIMA/ETS/Theta ensemble + GARCH bands from
app.services.forecasting.engine. Results are cached until the next market close,
so each ticker is fitted at most once per trading day; concurrent requests for
the same ticker share a single fit.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, HTTPException

from app.services.forecasting.engine import DEFAULT_HORIZONS, FIT_WINDOW, MIN_HISTORY, forecast
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)
router = APIRouter()

_TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")
_locks: dict[str, asyncio.Lock] = {}
_CACHE_VERSION = "v1"


def _seconds_to_next_close(now: datetime | None = None) -> int:
    """TTL until ~30 min after the next 16:00 ET close (ET approximated as UTC-5)."""
    now = now or datetime.now(timezone.utc)
    et = now - timedelta(hours=5)
    nxt = et.replace(hour=16, minute=30, second=0, microsecond=0)
    if et >= nxt:
        nxt += timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return max(600, int((nxt - et).total_seconds()))


def _load_closes(ticker: str) -> pd.Series:
    """~3 years of adjusted daily closes (split/dividend adjusted — raw DB bars
    would turn a split into a fake -90% day and wreck the volatility model)."""
    import yfinance as yf

    # Yahoo uses dashes for share classes (BRK.B -> BRK-B)
    df = yf.download(ticker.replace(".", "-"), period="3y", interval="1d", auto_adjust=True, progress=False, threads=False)
    if df is None or df.empty:
        return pd.Series(dtype=float)
    close = df["Close"]
    if isinstance(close, pd.DataFrame):  # multi-index columns in newer yfinance
        close = close.iloc[:, 0]
    return close.dropna()


def _compute(ticker: str) -> dict:
    closes = _load_closes(ticker)
    need = MIN_HISTORY + max(DEFAULT_HORIZONS) + 10
    if len(closes) < need:
        raise ValueError(
            f"{ticker} has {len(closes)} daily closes; forecasting needs at least {need} "
            "(about 9 months of trading). Recent IPOs and illiquid listings are not forecast."
        )
    out = forecast(closes.iloc[-(FIT_WINDOW + 260):])
    out["ticker"] = ticker
    out["generated_at"] = datetime.now(timezone.utc).isoformat()
    return out


@router.get("/forecast/{ticker}")
async def get_forecast(ticker: str, refresh: bool = False):
    """Price forecast with calibrated 50/80/95% bands for 1, 5 and 20 trading days,
    plus walk-forward accuracy versus a random-walk (naive) baseline."""
    t = ticker.upper().strip()
    if not _TICKER_RE.match(t):
        raise HTTPException(status_code=400, detail="Invalid ticker")

    key = f"forecast:{_CACHE_VERSION}:{t}"
    if not refresh:
        cached = await cache_service.get(key)
        if cached:
            return cached

    lock = _locks.setdefault(t, asyncio.Lock())
    async with lock:
        if not refresh:  # another request may have filled it while we waited
            cached = await cache_service.get(key)
            if cached:
                return cached
        try:
            result = await asyncio.wait_for(asyncio.to_thread(_compute, t), timeout=90)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Forecast timed out — try again shortly")
        except Exception:
            logger.exception("forecast failed for %s", t)
            raise HTTPException(status_code=503, detail="Forecast temporarily unavailable")
        await cache_service.set(key, result, ttl=_seconds_to_next_close())
        return result
