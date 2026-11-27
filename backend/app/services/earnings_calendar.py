"""
Earnings calendar: upcoming and recent company earnings reports.

Sources (both free, no new paid API):
  * Finnhub ``/calendar/earnings`` (FINNHUB_API_KEY, already configured in prod):
    date, hour (bmo/amc/dmh), EPS estimate/actual, revenue estimate/actual.
    One call covers a whole date window. Calls go through the shared Finnhub
    rate limiter (60/min) at low priority, so a busy minute skips the call
    instead of blocking.
  * Nasdaq public calendar JSON (``api.nasdaq.com/api/calendar/earnings``,
    keyless, same host as the IPO calendar in ``ipo_calendar.py``): one call per
    day; adds company name, market cap, report time and consensus EPS, and is the
    whole source when Finnhub is unavailable (no key, rate limited, error).

Rows from both sources are merged on (symbol, date). Finnhub wins for EPS and
revenue numbers; Nasdaq fills whatever Finnhub left empty. Missing values stay
``None`` (rendered "—"); nothing is ever defaulted to 0.

Caching: every upstream response is cached in Redis (in-memory fallback) through
``cache_service``. Past days are cached for 6 hours (actuals can still be
revised the same evening), today and future days for 1 hour.

No LLM is involved.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import weakref
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

NY = ZoneInfo("America/New_York")
MAX_WINDOW_DAYS = 31
NASDAQ_EARNINGS_URL = "https://api.nasdaq.com/api/calendar/earnings"
NASDAQ_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
TTL_PAST = 6 * 3600
TTL_FUTURE = 3600
TTL_EMPTY = 600  # an empty / failed upstream answer is retried sooner
NASDAQ_CONCURRENCY = 4

HOURS = ("bmo", "amc", "dmh")
HOUR_LABEL = {"bmo": "Before open", "amc": "After close", "dmh": "During market"}

# Market-cap tiers (USD), the usual retail-broker buckets.
CAP_TIERS: List[Tuple[str, str, float, float]] = [
    ("mega", "Mega cap ($200B+)", 200e9, math.inf),
    ("large", "Large cap ($10B–200B)", 10e9, 200e9),
    ("mid", "Mid cap ($2B–10B)", 2e9, 10e9),
    ("small", "Small cap ($300M–2B)", 300e6, 2e9),
    ("micro", "Micro cap (<$300M)", 0.0, 300e6),
]
CAP_TIER_IDS = tuple(t[0] for t in CAP_TIERS)


# ── small parsing helpers ────────────────────────────────────────────────────

def today_et(now: Optional[datetime] = None) -> date:
    """Calendar date in New York (earnings dates are US market dates)."""
    now = now or datetime.now(tz=NY)
    if now.tzinfo is None:
        return now.date()
    return now.astimezone(NY).date()


def _finite(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


_MONEY_RE = re.compile(r"^\(?-?\$?\s*([0-9][0-9,]*\.?[0-9]*)\)?$")


def parse_money(raw: Any) -> Optional[float]:
    """'$9.16' -> 9.16, '($0.84)' -> -0.84, '-$1.2' -> -1.2, 'N/A' / '' -> None."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return _finite(raw)
    s = str(raw).strip()
    if not s or s.upper() in {"N/A", "NA", "--", "-"}:
        return None
    m = _MONEY_RE.match(s.replace(" ", ""))
    if not m:
        return None
    try:
        v = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    if s.startswith("(") or s.startswith("-"):
        v = -v
    return v if math.isfinite(v) else None


def surprise_pct(actual: Optional[float], estimate: Optional[float]) -> Optional[float]:
    """(actual - estimate) / |estimate| in percent; None when either is unknown or estimate is 0."""
    if actual is None or estimate is None or estimate == 0:
        return None
    v = (actual - estimate) / abs(estimate) * 100.0
    return round(v, 2) if math.isfinite(v) else None


def cap_tier(market_cap: Optional[float]) -> Optional[str]:
    mc = _finite(market_cap)
    if mc is None or mc <= 0:
        return None
    for tier_id, _label, lo, hi in CAP_TIERS:
        if lo <= mc < hi:
            return tier_id
    return None


def _norm_hour(raw: Any) -> Optional[str]:
    s = str(raw or "").strip().lower()
    if s in HOURS:
        return s
    if s in {"time-pre-market", "pre-market", "before market open"}:
        return "bmo"
    if s in {"time-after-hours", "after-hours", "after market close"}:
        return "amc"
    return None


def _norm_symbol(raw: Any) -> str:
    return str(raw or "").strip().upper()


# ── source parsers ───────────────────────────────────────────────────────────

def parse_finnhub_earnings(payload: Any) -> List[dict]:
    """Normalize a Finnhub ``/calendar/earnings`` payload."""
    items = payload.get("earningsCalendar") if isinstance(payload, dict) else None
    out: List[dict] = []
    for r in items or []:
        if not isinstance(r, dict):
            continue
        sym = _norm_symbol(r.get("symbol"))
        d = str(r.get("date") or "").strip()
        if not sym or not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            continue
        q = r.get("quarter")
        y = r.get("year")
        out.append({
            "symbol": sym,
            "date": d,
            "hour": _norm_hour(r.get("hour")),
            "eps_estimate": _finite(r.get("epsEstimate")),
            "eps_actual": _finite(r.get("epsActual")),
            "revenue_estimate": _finite(r.get("revenueEstimate")),
            "revenue_actual": _finite(r.get("revenueActual")),
            "fiscal_period": f"Q{int(q)} {int(y)}" if _finite(q) and _finite(y) else None,
            "source": "finnhub",
        })
    return out


def parse_nasdaq_earnings(payload: Any, day: str) -> List[dict]:
    """Normalize one Nasdaq daily earnings payload (rows have no date; it is the query date)."""
    data = payload.get("data") if isinstance(payload, dict) else None
    rows = data.get("rows") if isinstance(data, dict) else None
    out: List[dict] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        sym = _norm_symbol(r.get("symbol"))
        if not sym:
            continue
        n_est = _finite(str(r.get("noOfEsts") or "").strip() or None)
        out.append({
            "symbol": sym,
            "date": day,
            "name": (str(r.get("name") or "").strip() or None),
            "hour": _norm_hour(r.get("time")),
            "eps_estimate": parse_money(r.get("epsForecast")),
            "eps_actual": parse_money(r.get("eps")),
            "nasdaq_surprise_pct": _finite(r.get("surprise")),
            "market_cap": parse_money(r.get("marketCap")),
            "fiscal_quarter_ending": (str(r.get("fiscalQuarterEnding") or "").strip() or None),
            "num_estimates": int(n_est) if n_est is not None else None,
            "last_year_eps": parse_money(r.get("lastYearEPS")),
            "source": "nasdaq",
        })
    return out


_ROW_KEYS = (
    "symbol", "date", "name", "hour", "eps_estimate", "eps_actual", "revenue_estimate",
    "revenue_actual", "market_cap", "fiscal_period", "fiscal_quarter_ending", "num_estimates",
    "last_year_eps",
)


def merge_earnings(finnhub_rows: Iterable[dict], nasdaq_rows: Iterable[dict]) -> List[dict]:
    """
    Merge both sources on (symbol, date). Finnhub values win; Nasdaq fills gaps.
    Adds eps/revenue surprise %, ``sources`` and ``status`` (reported | upcoming).
    Sorted by date, then report time (bmo, dmh, amc, unknown), then market cap desc.
    """
    merged: Dict[Tuple[str, str], dict] = {}

    def _take(row: dict, prefer: bool) -> None:
        key = (row["symbol"], row["date"])
        cur = merged.get(key)
        if cur is None:
            cur = {k: None for k in _ROW_KEYS}
            cur["symbol"], cur["date"] = key
            cur["sources"] = []
            merged[key] = cur
        for k in _ROW_KEYS:
            v = row.get(k)
            if v is None:
                continue
            if cur.get(k) is None or prefer:
                cur[k] = v
        if row.get("nasdaq_surprise_pct") is not None:
            cur["nasdaq_surprise_pct"] = row["nasdaq_surprise_pct"]
        if row.get("source") and row["source"] not in cur["sources"]:
            cur["sources"].append(row["source"])

    for r in nasdaq_rows:
        _take(r, prefer=False)
    for r in finnhub_rows:
        _take(r, prefer=True)

    out = []
    for r in merged.values():
        eps_s = surprise_pct(r["eps_actual"], r["eps_estimate"])
        if eps_s is None:
            eps_s = _finite(r.pop("nasdaq_surprise_pct", None)) if r["eps_actual"] is not None else None
        r.pop("nasdaq_surprise_pct", None)
        r["eps_surprise_pct"] = eps_s
        r["revenue_surprise_pct"] = surprise_pct(r["revenue_actual"], r["revenue_estimate"])
        r["status"] = "reported" if (r["eps_actual"] is not None or r["revenue_actual"] is not None) else "upcoming"
        out.append(r)

    hour_rank = {"bmo": 0, "dmh": 1, "amc": 2}
    out.sort(key=lambda r: (r["date"], hour_rank.get(r["hour"] or "", 3), -(r["market_cap"] or 0), r["symbol"]))
    return out


# ── fetching (cached) ────────────────────────────────────────────────────────

def _ttl_for(day: date, today: date, empty: bool) -> int:
    if empty:
        return TTL_EMPTY
    return TTL_PAST if day < today else TTL_FUTURE


def _finnhub_window_sync(start: str, end: str) -> Optional[List[dict]]:
    """Blocking Finnhub call (run via asyncio.to_thread). None = source unavailable."""
    from app.config import settings
    from app.services.finnhub_fetcher import FinnhubFetcher

    if not (settings.FINNHUB_API_KEY or "").strip():
        return None
    data = FinnhubFetcher.get_earnings_calendar(start, end)
    if not isinstance(data, dict) or "earningsCalendar" not in data:
        return None
    return parse_finnhub_earnings(data)


async def _nasdaq_day(client: httpx.AsyncClient, day: str) -> Optional[List[dict]]:
    try:
        r = await client.get(NASDAQ_EARNINGS_URL, params={"date": day})
        if r.status_code != 200:
            logger.info("Nasdaq earnings %s HTTP %s", day, r.status_code)
            return None
        return parse_nasdaq_earnings(r.json(), day)
    except Exception as exc:  # noqa: BLE001 - one bad day must not drop the rest
        logger.info("Nasdaq earnings %s failed: %s", day, exc)
        return None


def _days(start: date, end: date) -> List[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


# Single-flight per cache key, so concurrent cold requests make one upstream call.
# Locks are per event loop: the scheduler job runs each pass in its own asyncio.run().
_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Dict[str, asyncio.Lock]]" = weakref.WeakKeyDictionary()


def _lock(key: str) -> asyncio.Lock:
    per_loop = _locks.setdefault(asyncio.get_running_loop(), {})
    lk = per_loop.get(key)
    if lk is None:
        lk = per_loop[key] = asyncio.Lock()
    return lk


FinnhubFn = Callable[[str, str], Optional[List[dict]]]
NasdaqFn = Callable[[List[str]], Awaitable[Dict[str, Optional[List[dict]]]]]


async def _default_nasdaq_days(days: List[str]) -> Dict[str, Optional[List[dict]]]:
    sem = asyncio.Semaphore(NASDAQ_CONCURRENCY)
    async with httpx.AsyncClient(timeout=12.0, headers=NASDAQ_HEADERS) as client:
        async def one(d: str):
            async with sem:
                return d, await _nasdaq_day(client, d)
        pairs = await asyncio.gather(*(one(d) for d in days))
    return dict(pairs)


async def fetch_window(
    start: date,
    end: date,
    *,
    today: Optional[date] = None,
    finnhub_fn: Optional[FinnhubFn] = None,
    nasdaq_fn: Optional[NasdaqFn] = None,
) -> Dict[str, Any]:
    """
    Merged earnings rows for [start, end] (inclusive, at most MAX_WINDOW_DAYS days).
    Returns {"rows": [...], "sources": {"finnhub": bool, "nasdaq": bool}}. Never raises
    for upstream failures; an unavailable source just contributes nothing.
    """
    from app.services.redis_cache_service import cache_service

    if end < start:
        start, end = end, start
    if (end - start).days + 1 > MAX_WINDOW_DAYS:
        raise ValueError(f"window is limited to {MAX_WINDOW_DAYS} days")
    today = today or today_et()
    finnhub_fn = finnhub_fn or _finnhub_window_sync
    nasdaq_fn = nasdaq_fn or _default_nasdaq_days
    s_iso, e_iso = start.isoformat(), end.isoformat()

    # Finnhub: one call for the whole window.
    fh_key = f"qt:earn:fh:{s_iso}:{e_iso}"
    fh_rows = await cache_service.get(fh_key)
    if fh_rows is None:
        async with _lock(fh_key):
            fh_rows = await cache_service.get(fh_key)
            if fh_rows is None:
                try:
                    got = await asyncio.to_thread(finnhub_fn, s_iso, e_iso)
                except Exception:  # noqa: BLE001
                    logger.exception("Finnhub earnings window failed")
                    got = None
                if got is not None:
                    await cache_service.set(fh_key, got, _ttl_for(end, today, empty=not got))
                fh_rows = got
    finnhub_ok = fh_rows is not None

    # Nasdaq: one cached entry per day; fetch only the missing days.
    by_day: Dict[str, Optional[List[dict]]] = {}
    missing: List[str] = []
    for d in _days(start, end):
        cached = await cache_service.get(f"qt:earn:nq:{d.isoformat()}")
        if cached is None:
            missing.append(d.isoformat())
        else:
            by_day[d.isoformat()] = cached
    if missing:
        async with _lock("qt:earn:nq"):
            still = []
            for d in missing:
                cached = await cache_service.get(f"qt:earn:nq:{d}")
                if cached is None:
                    still.append(d)
                else:
                    by_day[d] = cached
            if still:
                try:
                    fetched = await nasdaq_fn(still)
                except Exception:  # noqa: BLE001
                    logger.exception("Nasdaq earnings fetch failed")
                    fetched = {}
                for d in still:
                    rows = fetched.get(d)
                    by_day[d] = rows
                    if rows is not None:
                        day = date.fromisoformat(d)
                        # Weekends legitimately have no rows: cache those like any other day.
                        empty = not rows and day.weekday() < 5
                        await cache_service.set(f"qt:earn:nq:{d}", rows, _ttl_for(day, today, empty))
    nasdaq_ok = any(v is not None for v in by_day.values())
    nq_rows = [r for rows in by_day.values() if rows for r in rows]

    return {
        "rows": merge_earnings(fh_rows or [], nq_rows),
        "sources": {"finnhub": finnhub_ok, "nasdaq": nasdaq_ok},
    }


def next_event_map(rows: Iterable[dict], today: date) -> Dict[str, dict]:
    """Earliest event on/after ``today`` per symbol."""
    out: Dict[str, dict] = {}
    for r in rows:
        if r["date"] < today.isoformat():
            continue
        cur = out.get(r["symbol"])
        if cur is None or r["date"] < cur["date"]:
            out[r["symbol"]] = r
    return out


def days_until(event_date: str, today: date) -> Optional[int]:
    try:
        return (date.fromisoformat(event_date) - today).days
    except (TypeError, ValueError):
        return None


def _finnhub_symbol_sync(symbol: str, start: str, end: str) -> Optional[List[dict]]:
    from app.config import settings
    from app.services.finnhub_fetcher import FinnhubFetcher

    if not (settings.FINNHUB_API_KEY or "").strip():
        return None
    data = FinnhubFetcher.get_earnings_calendar(start, end, symbol=symbol)
    if not isinstance(data, dict) or "earningsCalendar" not in data:
        return None
    return parse_finnhub_earnings(data)


async def next_earnings(
    symbol: str,
    *,
    today: Optional[date] = None,
    horizon_days: int = 30,
    symbol_fn: Optional[Callable[[str, str, str], Optional[List[dict]]]] = None,
    window_fn: Optional[Callable[..., Awaitable[Dict[str, Any]]]] = None,
) -> Optional[dict]:
    """
    Next scheduled earnings for one symbol within ``horizon_days`` (None if unknown).
    Finnhub's per-symbol query first (precise, includes the hour), then the shared
    market-wide window (which the /earnings page and the alerts job also warm).
    """
    from app.services.redis_cache_service import cache_service

    symbol = _norm_symbol(symbol)
    today = today or today_et()
    end = today + timedelta(days=min(horizon_days, MAX_WINDOW_DAYS - 1))
    symbol_fn = symbol_fn or _finnhub_symbol_sync
    window_fn = window_fn or fetch_window

    key = f"qt:earn:next:{symbol}:{today.isoformat()}"
    cached = await cache_service.get(key)
    if isinstance(cached, dict):
        return cached.get("event")

    event: Optional[dict] = None
    try:
        rows = await asyncio.to_thread(symbol_fn, symbol, today.isoformat(), end.isoformat())
    except Exception:  # noqa: BLE001
        logger.exception("Finnhub next earnings failed for %s", symbol)
        rows = None
    if rows:
        event = next_event_map(merge_earnings(rows, []), today).get(symbol)
    if event is None:
        window = await window_fn(today, end, today=today)
        event = next_event_map(window["rows"], today).get(symbol)
    # Cache the answer (including "none known") for an hour.
    await cache_service.set(key, {"event": event}, TTL_FUTURE)
    return event


def event_payload(event: Optional[dict], today: date) -> dict:
    if not event:
        return {"date": None, "hour": None, "hour_label": None, "days_until": None,
                "eps_estimate": None, "revenue_estimate": None, "fiscal_period": None}
    hour = event.get("hour")
    return {
        "date": event["date"],
        "hour": hour,
        "hour_label": HOUR_LABEL.get(hour or ""),
        "days_until": days_until(event["date"], today),
        "eps_estimate": event.get("eps_estimate"),
        "revenue_estimate": event.get("revenue_estimate"),
        "fiscal_period": event.get("fiscal_period") or event.get("fiscal_quarter_ending"),
    }


# ── per-symbol EPS history (snapshot mini chart) ─────────────────────────────
#
# Finnhub /stock/earnings: reported EPS vs consensus per fiscal quarter (the free
# tier returns the last 4). yfinance ``get_earnings_dates`` is the fallback (up to
# ~8 past reports, keyed by report date rather than fiscal period end).

TTL_EPS_HISTORY = 12 * 3600
EPS_HISTORY_MAX = 8


def parse_finnhub_surprises(payload: Any) -> List[dict]:
    """Finnhub /stock/earnings rows -> quarters (oldest first). Rows without an actual are skipped."""
    out: Dict[str, dict] = {}
    for it in payload if isinstance(payload, list) else []:
        if not isinstance(it, dict):
            continue
        period = str(it.get("period") or "")[:10]
        try:
            date.fromisoformat(period)
        except ValueError:
            continue
        actual = _finite(it.get("actual"))
        if actual is None:
            continue
        est = _finite(it.get("estimate"))
        q, y = it.get("quarter"), it.get("year")
        label = f"Q{int(q)} {int(y)}" if isinstance(q, (int, float)) and isinstance(y, (int, float)) else period
        out[period] = {"period": period, "label": label, "eps_actual": actual, "eps_estimate": est,
                       "surprise_pct": surprise_pct(actual, est)}
    return [out[k] for k in sorted(out)]


def _finnhub_surprises_sync(symbol: str) -> Optional[List[dict]]:
    from app.config import settings
    from app.services.finnhub_fetcher import FinnhubFetcher

    if not (settings.FINNHUB_API_KEY or "").strip():
        return None
    return parse_finnhub_surprises(FinnhubFetcher.get_earnings_surprises(symbol, EPS_HISTORY_MAX))


def _yf_eps_history_sync(symbol: str) -> Optional[List[dict]]:
    """yfinance past earnings: report date, EPS estimate, reported EPS. None on failure."""
    import yfinance as yf

    try:
        df = yf.Ticker(symbol).get_earnings_dates(limit=16)
    except Exception as exc:  # noqa: BLE001
        logger.info("yfinance earnings dates %s failed: %s", symbol, exc)
        return None
    if df is None or not hasattr(df, "iterrows"):
        return []
    out: Dict[str, dict] = {}
    try:
        for ts, row in df.iterrows():
            actual = _finite(row.get("Reported EPS"))
            d = ts.date() if hasattr(ts, "date") else None
            if actual is None or d is None:
                continue
            est = _finite(row.get("EPS Estimate"))
            out[d.isoformat()] = {"period": d.isoformat(), "label": d.strftime("%b %Y"),
                                  "eps_actual": actual, "eps_estimate": est,
                                  "surprise_pct": surprise_pct(actual, est)}
    except Exception as exc:  # noqa: BLE001
        logger.info("yfinance earnings dates %s parse failed: %s", symbol, exc)
        return None
    return [out[k] for k in sorted(out)]


async def fetch_eps_history(
    symbol: str,
    *,
    finnhub_fn: Optional[Callable[[str], Optional[List[dict]]]] = None,
    yf_fn: Optional[Callable[[str], Optional[List[dict]]]] = None,
) -> dict:
    """Last <= 8 reported quarters (oldest first) with the source used. Failures are not cached."""
    from app.services.redis_cache_service import cache_service

    symbol = _norm_symbol(symbol)
    key = f"qt:earn:hist:{symbol}"
    cached = await cache_service.get(key)
    if isinstance(cached, dict):
        return cached
    finnhub_fn = finnhub_fn or _finnhub_surprises_sync
    yf_fn = yf_fn or _yf_eps_history_sync

    async def run(fn):
        try:
            return await asyncio.to_thread(fn, symbol)
        except Exception:  # noqa: BLE001
            logger.exception("EPS history lookup failed for %s", symbol)
            return None

    fh = await run(finnhub_fn)
    quarters, source = (fh, "finnhub") if fh else (None, None)
    yf_rows = None
    if not quarters or len(quarters) < EPS_HISTORY_MAX:  # Finnhub free tier: only 4
        yf_rows = await run(yf_fn)
        if yf_rows and len(yf_rows) > len(quarters or []):
            quarters, source = yf_rows, "yfinance"
    if fh is None and yf_rows is None:
        return {"symbol": symbol, "available": False, "quarters": [], "source": None}
    body = {"symbol": symbol, "available": True, "quarters": (quarters or [])[-EPS_HISTORY_MAX:], "source": source}
    await cache_service.set(key, body, TTL_EPS_HISTORY if quarters else TTL_EMPTY)
    return body
