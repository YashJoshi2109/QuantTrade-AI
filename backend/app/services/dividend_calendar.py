"""
Dividend calendar and projected dividend income.

Sources (free, already used by the repo; no new paid API):
  * Nasdaq public dividend calendar JSON
    (``api.nasdaq.com/api/calendar/dividends?date=YYYY-MM-DD``, keyless, same host as
    the IPO calendar): every stock going ex-dividend that day with pay date, record
    date, per-payment amount and indicated annual dividend.
  * yfinance (already a backend dependency): per-symbol dividend history (ex-date,
    amount) and the announced next ex-date / pay date. Used for the income projection
    of a user's holdings.

Projection (``project_income``) is plain arithmetic, no model:
  * payment frequency = median gap between the most recent ex-dates
    (monthly / quarterly / semi-annual / annual; anything else is "irregular" and not
    projected);
  * amount per payment = the latest regular payment (a one-off special dividend, more
    than 1.5x or under 0.5x the median of the previous payments, is ignored);
  * future ex-dates = the announced next ex-date (if any) or the last ex-date, stepped
    forward by the frequency;
  * pay date = ex-date + the announced ex-to-pay lag, else + 21 days (marked estimated);
  * income = shares held now x amount per payment, bucketed by pay month for the
    current month and the next 11.
A dividend whose last ex-date is long overdue is treated as suspended and not projected.
Missing values stay ``None`` ("—" in the UI), never 0.

No LLM is involved.
"""
from __future__ import annotations

import asyncio
import logging
import math
import statistics
import weakref
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

NY = ZoneInfo("America/New_York")
MAX_WINDOW_DAYS = 31
NASDAQ_DIVIDENDS_URL = "https://api.nasdaq.com/api/calendar/dividends"
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
TTL_PAST = 12 * 3600
TTL_FUTURE = 3 * 3600
TTL_EMPTY = 600
TTL_HISTORY = 12 * 3600
NASDAQ_CONCURRENCY = 4
HISTORY_CONCURRENCY = 6
MAX_HOLDINGS = 60
DEFAULT_PAY_LAG_DAYS = 21

FREQUENCIES: Dict[int, str] = {12: "Monthly", 4: "Quarterly", 2: "Semi-annual", 1: "Annual"}


def today_et(now: Optional[datetime] = None) -> date:
    now = now or datetime.now(tz=NY)
    if now.tzinfo is None:
        return now.date()
    return now.astimezone(NY).date()


def _finite(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(str(v).replace("$", "").replace(",", "").strip()) if isinstance(v, str) else float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _us_date(raw: Any) -> Optional[str]:
    """Nasdaq dates are MM/DD/YYYY; returns YYYY-MM-DD or None ('N/A', '', garbage)."""
    s = str(raw or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def frequency_from_ratio(amount: Optional[float], annual: Optional[float]) -> Optional[int]:
    """Payments per year implied by indicated annual / per-payment amount (1, 2, 4, 12)."""
    if not amount or not annual or amount <= 0 or annual <= 0:
        return None
    ratio = annual / amount
    for n in (12, 4, 2, 1):
        if abs(ratio - n) <= max(0.15 * n, 0.25):
            return n
    return None


def frequency_from_dates(ex_dates: List[date]) -> Optional[int]:
    """Payments per year from the median gap between the most recent ex-dates."""
    ds = sorted(set(ex_dates))[-7:]
    if len(ds) < 2:
        return None
    gaps = [(b - a).days for a, b in zip(ds, ds[1:])]
    g = statistics.median(gaps)
    if g <= 0:
        return None
    if g <= 45:
        return 12
    if 70 <= g <= 135:
        return 4
    if 150 <= g <= 250:
        return 2
    if 300 <= g <= 420:
        return 1
    return None


# ── calendar ─────────────────────────────────────────────────────────────────

def parse_nasdaq_dividends(payload: Any) -> List[dict]:
    data = payload.get("data") if isinstance(payload, dict) else None
    cal = data.get("calendar") if isinstance(data, dict) else None
    rows = cal.get("rows") if isinstance(cal, dict) else None
    out: List[dict] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        sym = str(r.get("symbol") or "").strip().upper()
        ex = _us_date(r.get("dividend_Ex_Date"))
        if not sym or not ex:
            continue
        amount = _finite(r.get("dividend_Rate"))
        annual = _finite(r.get("indicated_Annual_Dividend"))
        if amount is not None and amount <= 0:
            amount = None
        if annual is not None and annual <= 0:
            annual = None  # Nasdaq reports 0 when unknown
        freq = frequency_from_ratio(amount, annual)
        out.append({
            "symbol": sym,
            "name": (str(r.get("companyName") or "").strip() or None),
            "ex_date": ex,
            "pay_date": _us_date(r.get("payment_Date")),
            "record_date": _us_date(r.get("record_Date")),
            "declared_date": _us_date(r.get("announcement_Date")),
            "amount": amount,
            "annual_dividend": annual,
            "frequency": freq,
            "frequency_label": FREQUENCIES.get(freq) if freq else None,
        })
    out.sort(key=lambda r: (r["ex_date"], r["symbol"]))
    return out


async def _nasdaq_day(client: httpx.AsyncClient, day: str) -> Optional[List[dict]]:
    try:
        r = await client.get(NASDAQ_DIVIDENDS_URL, params={"date": day})
        if r.status_code != 200:
            logger.info("Nasdaq dividends %s HTTP %s", day, r.status_code)
            return None
        return parse_nasdaq_dividends(r.json())
    except Exception as exc:  # noqa: BLE001 - one bad day must not drop the rest
        logger.info("Nasdaq dividends %s failed: %s", day, exc)
        return None


async def _default_nasdaq_days(days: List[str]) -> Dict[str, Optional[List[dict]]]:
    sem = asyncio.Semaphore(NASDAQ_CONCURRENCY)
    async with httpx.AsyncClient(timeout=12.0, headers=NASDAQ_HEADERS) as client:
        async def one(d: str):
            async with sem:
                return d, await _nasdaq_day(client, d)
        pairs = await asyncio.gather(*(one(d) for d in days))
    return dict(pairs)


_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Dict[str, asyncio.Lock]]" = weakref.WeakKeyDictionary()


def _lock(key: str) -> asyncio.Lock:
    per_loop = _locks.setdefault(asyncio.get_running_loop(), {})
    lk = per_loop.get(key)
    if lk is None:
        lk = per_loop[key] = asyncio.Lock()
    return lk


NasdaqFn = Callable[[List[str]], Awaitable[Dict[str, Optional[List[dict]]]]]


async def fetch_window(start: date, end: date, *, today: Optional[date] = None,
                       nasdaq_fn: Optional[NasdaqFn] = None) -> Dict[str, Any]:
    """Ex-dividend rows with ex-date in [start, end] (<= MAX_WINDOW_DAYS). Never raises on upstream errors."""
    from app.services.redis_cache_service import cache_service

    if end < start:
        start, end = end, start
    if (end - start).days + 1 > MAX_WINDOW_DAYS:
        raise ValueError(f"window is limited to {MAX_WINDOW_DAYS} days")
    today = today or today_et()
    nasdaq_fn = nasdaq_fn or _default_nasdaq_days

    by_day: Dict[str, Optional[List[dict]]] = {}
    missing: List[str] = []
    days = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    for d in days:
        cached = await cache_service.get(f"qt:div:nq:{d}")
        if cached is None:
            missing.append(d)
        else:
            by_day[d] = cached
    if missing:
        async with _lock("qt:div:nq"):
            still = []
            for d in missing:
                cached = await cache_service.get(f"qt:div:nq:{d}")
                if cached is None:
                    still.append(d)
                else:
                    by_day[d] = cached
            if still:
                try:
                    fetched = await nasdaq_fn(still)
                except Exception:  # noqa: BLE001
                    logger.exception("Nasdaq dividends fetch failed")
                    fetched = {}
                for d in still:
                    rows = fetched.get(d)
                    by_day[d] = rows
                    if rows is not None:
                        day = date.fromisoformat(d)
                        empty = not rows and day.weekday() < 5
                        ttl = TTL_EMPTY if empty else (TTL_PAST if day < today else TTL_FUTURE)
                        await cache_service.set(f"qt:div:nq:{d}", rows, ttl)
    ok = any(v is not None for v in by_day.values())
    rows = [r for d in days for r in (by_day.get(d) or [])]
    return {"rows": rows, "source_ok": ok}


# ── history (yfinance) ───────────────────────────────────────────────────────

def _yf_history_sync(symbol: str) -> Optional[dict]:
    """Blocking yfinance lookup: last ~3 years of cash dividends + announced next dates.
    None when yfinance fails (network); {"dividends": []} when the stock pays none."""
    import yfinance as yf

    try:
        t = yf.Ticker(symbol)
        s = t.dividends
    except Exception as exc:  # noqa: BLE001
        logger.info("yfinance dividends %s failed: %s", symbol, exc)
        return None
    # Some yfinance versions return a one-column DataFrame instead of a Series.
    if hasattr(s, "columns"):
        s = s["Dividends"] if "Dividends" in s.columns else (s.iloc[:, 0] if len(s.columns) else None)
    if s is None:
        return {"dividends": [], "next_ex_date": None, "next_pay_date": None}
    cutoff = datetime.now().date() - timedelta(days=3 * 366)
    divs: List[Tuple[str, float]] = []
    try:
        for ts, amt in s.items():
            d = ts.date() if hasattr(ts, "date") else None
            a = _finite(amt)
            if d and d >= cutoff and a and a > 0:
                divs.append((d.isoformat(), a))
    except Exception as exc:  # noqa: BLE001
        logger.info("yfinance dividends %s parse failed: %s", symbol, exc)
    nxt_ex = nxt_pay = None
    if divs:
        try:
            cal = t.calendar or {}
            ex = cal.get("Ex-Dividend Date") if isinstance(cal, dict) else None
            pay = cal.get("Dividend Date") if isinstance(cal, dict) else None
            nxt_ex = ex.isoformat() if isinstance(ex, date) else None
            nxt_pay = pay.isoformat() if isinstance(pay, date) else None
        except Exception as exc:  # noqa: BLE001 - calendar is optional (ETFs have none)
            logger.debug("yfinance calendar %s failed: %s", symbol, exc)
    return {"dividends": sorted(divs), "next_ex_date": nxt_ex, "next_pay_date": nxt_pay}


HistoryFn = Callable[[str], Optional[dict]]


async def fetch_histories(symbols: Iterable[str], *, history_fn: Optional[HistoryFn] = None) -> Dict[str, Optional[dict]]:
    """Dividend history per symbol, Redis-cached 12h. A failed lookup maps to None (not cached)."""
    from app.services.redis_cache_service import cache_service

    history_fn = history_fn or _yf_history_sync
    syms = sorted({s.upper() for s in symbols})[:MAX_HOLDINGS]
    out: Dict[str, Optional[dict]] = {}
    todo: List[str] = []
    for s in syms:
        cached = await cache_service.get(f"qt:div:hist:{s}")
        if cached is None:
            todo.append(s)
        else:
            out[s] = cached
    sem = asyncio.Semaphore(HISTORY_CONCURRENCY)

    async def one(s: str):
        async with sem:
            try:
                h = await asyncio.to_thread(history_fn, s)
            except Exception:  # noqa: BLE001
                logger.exception("dividend history failed for %s", s)
                h = None
            if h is not None:
                await cache_service.set(f"qt:div:hist:{s}", h, TTL_HISTORY)
            out[s] = h

    await asyncio.gather(*(one(s) for s in todo))
    return out


# ── projection ───────────────────────────────────────────────────────────────

@dataclass
class HoldingProjection:
    symbol: str
    shares: float
    frequency: Optional[int] = None
    amount_per_share: Optional[float] = None
    last_ex_date: Optional[str] = None
    next_ex_date: Optional[str] = None
    next_pay_date: Optional[str] = None
    projected_income: Optional[float] = None
    payments: List[dict] = field(default_factory=list)
    status: str = "projected"  # projected | no_dividend | irregular | suspended | unavailable
    note: Optional[str] = None


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def month_keys(today: date, count: int = 12) -> List[str]:
    first = date(today.year, today.month, 1)
    return [_add_months(first, i).strftime("%Y-%m") for i in range(count)]


def regular_amount(amounts: List[float]) -> Optional[float]:
    """Latest regular payment; a one-off special (>1.5x or <0.5x the median of the
    previous up to 4 payments) falls back to that median."""
    if not amounts:
        return None
    last = amounts[-1]
    prev = amounts[-5:-1]
    if not prev:
        return last
    med = statistics.median(prev)
    if med > 0 and (last > 1.5 * med or last < 0.5 * med):
        return med
    return last


def project_holding(symbol: str, shares: float, history: Optional[dict], today: date,
                    months: List[str]) -> HoldingProjection:
    hp = HoldingProjection(symbol=symbol, shares=shares)
    if history is None:
        hp.status, hp.note = "unavailable", "Dividend data unavailable right now"
        return hp
    divs = [(date.fromisoformat(d), float(a)) for d, a in (history.get("dividends") or [])]
    if not divs:
        hp.status, hp.note = "no_dividend", "No dividends in the last 3 years"
        return hp
    divs.sort()
    ex_dates = [d for d, _ in divs]
    hp.last_ex_date = ex_dates[-1].isoformat()
    freq = frequency_from_dates(ex_dates)
    if freq is None:
        hp.status, hp.note = "irregular", "Irregular or one-off dividends: not projected"
        return hp
    period = 365.25 / freq
    if (today - ex_dates[-1]).days > period * 1.5 + 30:
        hp.status, hp.note = "suspended", "No recent dividend: may be suspended"
        hp.frequency = freq
        return hp
    amount = regular_amount([a for _, a in divs])
    hp.frequency, hp.amount_per_share = freq, amount

    nxt_ex = history.get("next_ex_date")
    nxt_pay = history.get("next_pay_date")
    anchor_ex = ex_dates[-1]
    announced: Optional[date] = None
    if nxt_ex:
        try:
            announced = date.fromisoformat(nxt_ex)
        except ValueError:
            announced = None
    lag = DEFAULT_PAY_LAG_DAYS
    lag_known = False
    if announced and nxt_pay:
        try:
            lg = (date.fromisoformat(nxt_pay) - announced).days
            if 0 <= lg <= 90:
                lag, lag_known = lg, True
        except ValueError:
            pass

    # Candidate ex-dates: the last one (its pay date may still be ahead), the announced
    # next one, then step forward by the frequency.
    cands: List[Tuple[date, bool]] = [(anchor_ex, announced == anchor_ex)]
    base = anchor_ex
    if announced and announced > anchor_ex + timedelta(days=period * 0.4):
        cands.append((announced, True))
        base = announced
    k = 1
    horizon_end = date.fromisoformat(months[-1] + "-01")
    horizon_end = _add_months(horizon_end, 1)
    while True:
        ex = base + timedelta(days=round(k * period))
        if ex >= horizon_end:
            break
        cands.append((ex, False))
        k += 1

    total = 0.0
    month_set = set(months)
    for ex, is_announced in cands:
        if is_announced and nxt_pay and lag_known:
            pay = date.fromisoformat(nxt_pay)
            estimated = False
        else:
            pay = ex + timedelta(days=lag)
            estimated = True
        if pay < today or pay.strftime("%Y-%m") not in month_set:
            continue
        income = round(shares * amount, 2)
        hp.payments.append({
            "symbol": symbol,
            "ex_date": ex.isoformat(),
            "pay_date": pay.isoformat(),
            "amount_per_share": amount,
            "shares": shares,
            "income": income,
            "estimated": estimated or not is_announced,
            "announced": is_announced,
        })
        total += income
    future_ex = [p for p in hp.payments if p["ex_date"] >= today.isoformat()]
    if future_ex:
        hp.next_ex_date = future_ex[0]["ex_date"]
    if hp.payments:
        hp.next_pay_date = hp.payments[0]["pay_date"]
    hp.projected_income = round(total, 2)
    return hp


def project_income(holdings: Dict[str, float], histories: Dict[str, Optional[dict]], today: date,
                   months_ahead: int = 12) -> dict:
    """Projected dividend income by pay month for the current month and the next 11."""
    months = month_keys(today, months_ahead)
    per: List[HoldingProjection] = []
    for sym, shares in sorted(holdings.items()):
        if shares <= 0:
            continue
        per.append(project_holding(sym, shares, histories.get(sym), today, months))
    buckets: Dict[str, dict] = {m: {"month": m, "total": 0.0, "payments": []} for m in months}
    for hp in per:
        for p in hp.payments:
            b = buckets[p["pay_date"][:7]]
            b["payments"].append(p)
            b["total"] = round(b["total"] + p["income"], 2)
    for b in buckets.values():
        b["payments"].sort(key=lambda p: (p["pay_date"], p["symbol"]))
    projected = [hp for hp in per if hp.status == "projected"]
    total = round(sum(hp.projected_income or 0.0 for hp in projected), 2)
    return {
        "months": [buckets[m] for m in months],
        "total_12m": total if projected else None,
        "holdings": [hp.__dict__ | {"frequency_label": FREQUENCIES.get(hp.frequency) if hp.frequency else None,
                                    "annual_per_share": round(hp.amount_per_share * hp.frequency, 6)
                                    if hp.amount_per_share is not None and hp.frequency else None}
                     for hp in per],
        "assumptions": {
            "pay_lag_days_default": DEFAULT_PAY_LAG_DAYS,
            "shares": "current holdings held constant",
            "amount": "latest regular per-share dividend, held flat (no growth assumed)",
        },
    }
