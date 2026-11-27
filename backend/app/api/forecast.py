"""Statistical forecast API — GET /api/v1/forecast/{ticker}.

Serves app.services.forecasting.engine: SARIMAX with exogenous regressors known
at forecast time, baselines (random walk, drift, ARIMA, ETS, ensemble) and
GJR-GARCH bands, each horizon judged against the random walk in a walk-forward
test.

Cost control (2-vCPU host, 768M container, one uvicorn worker):
- Fits run in worker threads (``asyncio.to_thread``), at most two at once.
- The walk-forward evaluation (~7s locally) is cached for a week per ticker;
  the daily forecast reuses it and only refits the final models (<1s).
- The evaluation has its own time budget (FORECAST_EVAL_BUDGET_S). When it
  runs out, the result covers fewer tests, says so, and is cached for a day.
- Forecasts are cached until the next market close; concurrent requests for
  the same ticker share one fit.
- Daily updates do not re-estimate: the SARIMAX/ARIMA Kalman state is
  persisted in Redis (params + last state, a few KB) and only new bars are
  filtered. Parameters are re-estimated every 30 bars, when the order is
  re-selected, or when the one-step-error drift check fails.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException

from app.services.forecasting.engine import HISTORY_DAYS, MIN_HISTORY, forecast
from app.services.forecasting.evaluation import EVAL_VERSION
from app.services.forecasting.models import STATE_VERSION
from app.services.forecasting.summary import summarize_forecast
from app.services.model_status import EXPERIMENTAL_LABEL, annotate_forecast
from app.services import provider_meter
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)
router = APIRouter()

_TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")
_locks: dict[str, asyncio.Lock] = {}
_CACHE_VERSION = "v3"  # v3: SARIMAX + per-horizon walk-forward eval, 60-day horizon
_EVAL_TTL_S = 7 * 86400
_EVAL_PARTIAL_TTL_S = 86400
_STATE_TTL_S = 45 * 86400
# Fits are CPU-bound and hold the GIL; on the 2-vCPU host more than two at once
# just slows every other request.
_FIT_SLOTS = threading.BoundedSemaphore(2)
_REQUEST_TIMEOUT_S = 90

# Sector ETF used as an exogenous regressor. Unmapped tickers simply go without.
SECTOR_ETF = {
    **dict.fromkeys(("AAPL", "MSFT", "NVDA", "AVGO", "AMD", "ORCL", "CRM", "INTC", "PLTR", "ADBE",
                     "CSCO", "QCOM", "TXN", "MU", "IBM", "NOW", "AMAT"), "XLK"),
    **dict.fromkeys(("GOOGL", "GOOG", "META", "NFLX", "DIS", "T", "VZ", "CMCSA"), "XLC"),
    **dict.fromkeys(("AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG"), "XLY"),
    **dict.fromkeys(("JPM", "V", "MA", "BRK.B", "BAC", "WFC", "GS", "MS", "C", "COIN", "SOFI",
                     "AXP", "SCHW", "BLK"), "XLF"),
    **dict.fromkeys(("LLY", "UNH", "JNJ", "PFE", "MRK", "ABBV", "TMO", "ABT"), "XLV"),
    **dict.fromkeys(("XOM", "CVX", "COP", "SLB", "EOG", "OXY"), "XLE"),
    **dict.fromkeys(("COST", "WMT", "PG", "KO", "PEP", "PM"), "XLP"),
    **dict.fromkeys(("BA", "CAT", "GE", "HON", "UPS", "RTX", "LMT", "DE"), "XLI"),
}
# Funds have no earnings and are their own market proxy.
_FUNDS = {"SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "XLK", "XLC", "XLY", "XLF", "XLV", "XLE",
          "XLP", "XLI", "XLU", "XLB", "XLRE", "GLD", "TLT"}


def eval_budget_s() -> float:
    try:
        return max(5.0, float(os.environ.get("FORECAST_EVAL_BUDGET_S", "45")))
    except ValueError:
        return 45.0


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


def _download(symbols: list[str]) -> dict[str, pd.Series]:
    """~5 years of split/dividend-adjusted daily closes from Yahoo (free).
    Raw DB bars would turn a split into a fake -90% day."""
    import yfinance as yf

    out: dict[str, pd.Series] = {}
    for s in symbols:
        df = yf.download(s.replace(".", "-"), period="5y", interval="1d", auto_adjust=True,
                         progress=False, threads=False)
        if df is None or df.empty:
            continue
        close = df["Close"]
        if isinstance(close, pd.DataFrame):  # multi-index columns in newer yfinance
            close = close.iloc[:, 0]
        out[s] = close.dropna()
    return out


def _load_closes(ticker: str) -> pd.Series:
    return _download([ticker]).get(ticker, pd.Series(dtype=float))


# Shared market series (SPY, VIX, 10y yield, sector ETFs), cached in-process
# until the next close: a handful of 1,260-row float series.
_series_cache: dict[str, tuple[float, pd.Series]] = {}
_series_lock = threading.Lock()


def _market_series(symbol: str) -> Optional[pd.Series]:
    now = time.time()
    with _series_lock:
        hit = _series_cache.get(symbol)
        if hit and hit[0] > now:
            return hit[1]
    s = _download([symbol]).get(symbol)
    if s is not None and len(s):
        with _series_lock:
            _series_cache[symbol] = (now + _seconds_to_next_close(), s)
    return s


def _load_exog(ticker: str) -> Optional[pd.DataFrame]:
    """Raw exogenous inputs (closes/levels). Missing sources are dropped, not fatal."""
    wanted = {"vix": "^VIX", "tnx": "^TNX"}
    if ticker != "SPY":
        wanted["mkt"] = "SPY"
    etf = SECTOR_ETF.get(ticker)
    if etf and etf != ticker:
        wanted["sector"] = etf
    cols = {}
    for name, sym in wanted.items():
        try:
            s = _market_series(sym)
            if s is not None and len(s) > 100:
                cols[name] = s
        except Exception as e:  # provider hiccup: forecast without that regressor
            logger.warning("exog %s unavailable: %s", sym, e)
    return pd.DataFrame(cols) if cols else None


def _load_earnings(ticker: str) -> Optional[list]:
    """Past and scheduled earnings timestamps; None when unavailable (funds, errors)."""
    if ticker in _FUNDS:
        return None
    try:
        import yfinance as yf

        df = yf.Ticker(ticker.replace(".", "-")).get_earnings_dates(limit=28)
        if df is None or df.empty:
            return None
        return list(df.index)
    except Exception as e:
        logger.info("earnings dates unavailable for %s: %s", ticker, e)
        return None


def _compute(ticker: str, evaluation: Optional[dict], state: Optional[dict] = None) -> dict:
    with _FIT_SLOTS:
        return _compute_unlimited(ticker, evaluation, state)


def forecast_history_problem(ticker: str, closes: pd.Series) -> Optional[str]:
    """Why a series must not be forecast, or None when it is usable.

    PARA (2026-11-27) was forecast from a series that jumped $0.03 -> $3.04
    overnight (unadjusted reverse split on a reassigned ticker): 479.8%
    annualised vol and a 3-month range of $0.03-$253. Refuse instead.
    """
    from app.services.bar_hygiene import SPLIT_JUMP_RATIO, split_breaks
    from app.services.ticker_lifecycle import REUSED, retirement

    r = retirement(ticker)
    if r is not None and r.inactive:
        succ = f" Its successor trades as {r.successor}." if r.successor else ""
        return f"{ticker} no longer trades ({r.note}).{succ} No forecast is produced."
    if r is not None and r.kind == REUSED:
        return (f"{ticker} was reassigned to {r.current_name or 'a different company'}, so its price history "
                "mixes two issuers. No forecast is produced until it has enough clean history of its own.")
    window = closes.iloc[-HISTORY_DAYS:]
    breaks = split_breaks(list(window.astype(float)))
    if breaks:
        i = breaks[-1]
        when = str(window.index[i])[:10]
        ratio = float(window.iloc[i]) / float(window.iloc[i - 1])
        move = f"{ratio:.1f}x" if ratio >= 1 else f"1/{1 / ratio:.1f}x"
        return (f"{ticker}'s daily closes jump {move} on {when} (more than {SPLIT_JUMP_RATIO:g}x in one session): "
                "most likely an unadjusted split or ticker change. A forecast fitted across that jump would be "
                "meaningless, so none is produced.")
    return None


def _compute_unlimited(ticker: str, evaluation: Optional[dict], state: Optional[dict] = None) -> dict:
    closes = _load_closes(ticker)
    closes = closes[pd.to_numeric(closes, errors="coerce") > 0]
    problem = forecast_history_problem(ticker, closes)
    if problem:
        raise ValueError(problem)
    if len(closes) < MIN_HISTORY:
        raise ValueError(
            f"{ticker} has {len(closes)} daily closes; forecasting needs at least {MIN_HISTORY} "
            "(about 20 months of trading) to test the models first. Recent IPOs and illiquid "
            "listings are not forecast."
        )
    raw = _load_exog(ticker)
    earnings = _load_earnings(ticker)
    if evaluation is not None and evaluation.get("version") != EVAL_VERSION:
        evaluation = None
    deadline = time.monotonic() + eval_budget_s()
    out = forecast(closes.iloc[-HISTORY_DAYS:], raw=raw, earnings_stamps=earnings,
                   evaluation=evaluation, deadline=deadline, state=state)
    out["ticker"] = ticker
    out["generated_at"] = datetime.now(timezone.utc).isoformat()
    out["exog_sources"] = sorted(raw.columns) if raw is not None else []
    out["earnings_dates"] = earnings is not None
    return annotate_forecast(out)


def _eval_key(t: str) -> str:
    return f"forecast:eval:v{EVAL_VERSION}:{t}"


def _state_key(t: str) -> str:
    """Serving state: fitted params + last Kalman state (a few KB, no model objects)."""
    return f"forecast:state:v{STATE_VERSION}:{t}"


async def _get_or_compute(t: str, refresh: bool = False) -> dict:
    """Cached forecast for a validated ticker; concurrent callers share one fit."""
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
        evaluation = await cache_service.get(_eval_key(t))
        state = await cache_service.get(_state_key(t))
        t0 = time.perf_counter()
        try:
            result = await asyncio.wait_for(asyncio.to_thread(_compute, t, evaluation, state),
                                            timeout=_REQUEST_TIMEOUT_S)
        except ValueError:
            # Short / missing history for this ticker: the service worked.
            provider_meter.meter.record("forecast_compute", True, (time.perf_counter() - t0) * 1000)
            raise
        except Exception as e:
            provider_meter.meter.record("forecast_compute", False, (time.perf_counter() - t0) * 1000,
                                        error=type(e).__name__)
            raise
        provider_meter.meter.record("forecast_compute", True, (time.perf_counter() - t0) * 1000)
        ev = result.pop("_evaluation", None)
        new_state = result.pop("_state", None)
        if new_state is not None:
            await cache_service.set(_state_key(t), new_state, ttl=_STATE_TTL_S)
        if ev is not None and evaluation is None:
            ttl = _EVAL_PARTIAL_TTL_S if ev.get("budget_hit") else _EVAL_TTL_S
            await cache_service.set(_eval_key(t), ev, ttl=ttl)
        await cache_service.set(key, result, ttl=_seconds_to_next_close())
        return result


@router.get("/forecast/{ticker}")
async def get_forecast(ticker: str, refresh: bool = False):
    """Price forecast ranges (50/80/95%) for 1, 5, 20 and 60 trading days, with
    walk-forward accuracy of every model versus the random walk."""
    t = ticker.upper().strip()
    if not _TICKER_RE.match(t):
        raise HTTPException(status_code=400, detail="Invalid ticker")
    try:
        return await _get_or_compute(t, refresh)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Forecast timed out — try again shortly")
    except Exception:
        logger.exception("forecast failed for %s", t)
        raise HTTPException(status_code=503, detail="Forecast temporarily unavailable")


# ── Compact summaries for lists (watchlist, portfolio, screener) ─────────────
# Cache-only: a list page must never trigger one fit per row in the request.
# Misses are reported as "pending" and up to _SUMMARY_WARM_MAX of them are
# computed in the background (one at a time, behind the same fit slots), so a
# later poll finds them.

_SUMMARY_MAX_TICKERS = 50
_SUMMARY_WARM_MAX = 3
_bg_tasks: set = set()


def _forecast_key(t: str) -> str:
    return f"forecast:{_CACHE_VERSION}:{t}"


async def _warm_quietly(tickers: list[str]) -> None:
    for t in tickers:
        try:
            await _get_or_compute(t)
        except Exception as e:  # 422 (short history) etc. — the next poll stays pending/unavailable
            logger.info("background forecast for %s failed: %s", t, e)


@router.get("/forecasts/summary")
async def get_forecast_summaries(tickers: str, warm: bool = True):
    """Compact forecast summaries for up to 50 tickers, from cache only.

    Each item is {ticker, status: ready|pending|invalid, summary}. ``summary``
    follows app.services.forecasting.summary (ranges always; midpoint and
    P(up) only where the horizon beat ARIMA(0,1,0) in walk-forward tests).
    """
    seen: list[str] = []
    for raw in tickers.split(","):
        t = raw.upper().strip()
        if t and t not in seen:
            seen.append(t)
    if not seen:
        raise HTTPException(status_code=400, detail="tickers is required")
    if len(seen) > _SUMMARY_MAX_TICKERS:
        raise HTTPException(status_code=400, detail=f"At most {_SUMMARY_MAX_TICKERS} tickers")

    items, missing = [], []
    for t in seen:
        if not _TICKER_RE.match(t):
            items.append({"ticker": t, "status": "invalid", "summary": None})
            continue
        cached = await cache_service.get(_forecast_key(t))
        summary = summarize_forecast(cached, t) if cached else None
        if summary:
            items.append({"ticker": t, "status": "ready", "summary": summary})
        else:
            items.append({"ticker": t, "status": "pending", "summary": None})
            lock = _locks.get(t)
            if not (lock and lock.locked()):
                missing.append(t)

    if warm and missing:
        task = asyncio.create_task(_warm_quietly(missing[:_SUMMARY_WARM_MAX]))
        _bg_tasks.add(task)
        task.add_done_callback(_bg_tasks.discard)

    return {
        "items": items,
        "label": EXPERIMENTAL_LABEL,
        "benchmark": "ARIMA(0,1,0)",
        "note": ("Statistical ranges, not signals. Midpoint and P(up) appear only for horizons that "
                 "beat the ARIMA(0,1,0) random walk in walk-forward tests."),
    }


# ── Cache warming ──────────────────────────────────────────────────────────
# Pre-compute the most viewed tickers right after each close so users nearly
# always hit the cache.

WARM_TICKERS = (
    "SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
    "AVGO", "AMD", "NFLX", "PLTR", "JPM", "V", "MA", "BRK.B", "LLY", "UNH",
    "XOM", "COST", "WMT", "ORCL", "CRM", "INTC", "DIS", "BA", "COIN", "SOFI",
)
_WARM_PAUSE_S = 3.0  # between fits, so interactive requests get the CPU


async def warm_forecasts(tickers=WARM_TICKERS, pause: float = _WARM_PAUSE_S) -> int:
    """Fill the cache for tickers that are missing it. Returns how many were fitted."""
    fitted = 0
    for t in tickers:
        key = f"forecast:{_CACHE_VERSION}:{t}"
        try:
            if await cache_service.get(key):
                continue
            await _get_or_compute(t)
            fitted += 1
        except Exception as e:  # one bad ticker must not stop the rest
            logger.warning("forecast warm failed for %s: %s", t, e)
        await asyncio.sleep(pause)
    return fitted


async def forecast_warm_loop(initial_delay: float = 120.0) -> None:
    """Warm once after startup, then ~15 min after each cache expiry (post-close)."""
    await asyncio.sleep(initial_delay)
    while True:
        try:
            n = await warm_forecasts()
            logger.info("forecast cache warmed: %d fitted", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("forecast warm loop error")
        await asyncio.sleep(_seconds_to_next_close() + 900)
