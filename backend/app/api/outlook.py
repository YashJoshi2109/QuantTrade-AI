"""Outlook API: what option markets imply about the future, and planning tools.

Educational only. Nothing here places or simulates orders.

- GET  /api/v1/outlook/{symbol}/implied        implied move, ranges and IV per expiry
- GET  /api/v1/outlook/{symbol}/probability    risk-neutral P(above/below a price) by a date
- GET  /api/v1/outlook/{symbol}/earnings       earnings implied move vs past realized moves
- GET  /api/v1/outlook/{symbol}/perception     market-implied range vs our statistical forecast
- GET  /api/v1/outlook/calendar                upcoming earnings / ex-dividend / macro events
- POST /api/v1/outlook/hedge                   protective put vs collar vs trimming, at expiry
- GET  /api/v1/outlook/scenarios               historical shock definitions
- POST /api/v1/outlook/scenario                portfolio P&L under a shock

Option data comes from the existing /api/v1/options chain (Public.com, yfinance
fallback); the math is in app/services/outlook.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.outlook import earnings_moves, hedge as hedge_math, options_math as om, scenario as sc
from app.services.redis_cache_service import cache_service
from app.services.ticker_lifecycle import is_retired

logger = logging.getLogger(__name__)
router = APIRouter()

SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")
DISCLAIMER = ("Educational tool, not investment advice. Option-implied figures are risk-neutral: they reflect "
              "what option prices imply, including the premium paid for protection, not real-world odds. "
              "No orders are placed.")
MAX_EXPIRIES = 10
METHOD_TEXT = {
    "smile": "Breeden-Litzenberger on the implied-volatility smile fitted to out-of-the-money option mids",
    "atm_last": ("Lognormal at the at-the-money volatility of last trades (no live two-sided quotes, "
                 "e.g. outside market hours)"),
    "straddle_flat": "Lognormal at the volatility implied by the at-the-money straddle (too few priced strikes)",
}
CHAIN_TTL_S = 300
EXP_TTL_S = 3600
_chain_slots: Dict[int, asyncio.Semaphore] = {}


def _slots() -> asyncio.Semaphore:
    """At most four chain fetches at once, per event loop."""
    loop_id = id(asyncio.get_running_loop())
    sem = _chain_slots.get(loop_id)
    if sem is None:
        _chain_slots.clear()
        sem = _chain_slots[loop_id] = asyncio.Semaphore(4)
    return sem


def _sym(raw: str) -> str:
    s = (raw or "").strip().upper()
    if not SYMBOL_RE.match(s):
        raise HTTPException(status_code=422, detail="invalid symbol")
    return s


def _today_et() -> date:
    from app.services.earnings_calendar import today_et

    return today_et()


def _rate() -> float:
    from app.services.option_greeks import risk_free_rate

    return risk_free_rate()


# ── data loaders (monkeypatched in tests) ────────────────────────────────────

_exp_locks: Dict[Tuple[int, str], asyncio.Lock] = {}


async def load_expirations(symbol: str) -> List[str]:
    """Listed expiries. Concurrent panels asking for the same symbol share one
    provider call (yfinance answers parallel bursts with empty lists), and an
    empty answer is retried once before it is believed."""
    key = f"outlook:exp:{symbol}"
    hit = await cache_service.get(key)
    if isinstance(hit, list):
        return hit
    from app.api import options

    lock = _exp_locks.setdefault((id(asyncio.get_running_loop()), symbol), asyncio.Lock())
    async with lock:
        hit = await cache_service.get(key)
        if isinstance(hit, list):
            return hit
        exps: List[str] = []
        for attempt in range(2):
            try:
                resp = await options.get_option_expirations(symbol)
                exps = sorted({str(e)[:10] for e in resp.expirations})
            except HTTPException:
                exps = []
            except Exception:  # noqa: BLE001
                logger.info("expirations failed for %s", symbol)
                exps = []
            if exps:
                break
            if attempt == 0:
                await asyncio.sleep(0.6)
        if exps:
            await cache_service.set(key, exps, EXP_TTL_S)
    return exps


async def load_chain(symbol: str, expiration: str) -> Optional[dict]:
    """{"calls", "puts", "spot", "source"} or None."""
    key = f"outlook:chain:{symbol}:{expiration}"
    hit = await cache_service.get(key)
    if isinstance(hit, dict):
        return hit
    from app.api import options

    async with _slots():
        try:
            resp = await options.get_option_chain(symbol, expiration)
        except HTTPException:
            return None
        except Exception:  # noqa: BLE001
            logger.exception("outlook chain failed %s %s", symbol, expiration)
            return None
    spot = resp.underlying_price
    if not spot:
        spot = await options._spot_price(symbol)
    out = {"calls": resp.calls, "puts": resp.puts, "spot": spot, "source": resp.source}
    if spot and (resp.calls or resp.puts):
        await cache_service.set(key, out, CHAIN_TTL_S)
    return out


async def load_closes(symbol: str, start: Optional[str] = None, end: Optional[str] = None,
                      period: str = "2y") -> Dict[date, float]:
    def run() -> Dict[date, float]:
        import pandas as pd
        import yfinance as yf

        kw: Dict[str, Any] = {"interval": "1d", "auto_adjust": True, "progress": False, "threads": False}
        if start:
            kw.update(start=start, end=end)
        else:
            kw.update(period=period)
        df = yf.download(symbol.replace(".", "-"), **kw)
        if df is None or df.empty:
            return {}
        close = df["Close"]
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
        return {ts.date(): float(v) for ts, v in close.dropna().items() if float(v) > 0}

    try:
        return await asyncio.to_thread(run)
    except Exception as exc:  # noqa: BLE001
        logger.info("closes %s failed: %s", symbol, exc)
        return {}


async def load_earnings_stamps(symbol: str) -> List[Any]:
    from app.api.forecast import _load_earnings

    try:
        return await asyncio.to_thread(_load_earnings, symbol) or []
    except Exception:  # noqa: BLE001
        return []


async def load_next_earnings(symbol: str, horizon_days: int = 45) -> Optional[dict]:
    from app.services import earnings_calendar as cal

    try:
        return await cal.next_earnings(symbol, horizon_days=horizon_days)
    except Exception:  # noqa: BLE001
        logger.info("next earnings failed for %s", symbol)
        return None


async def load_dividend_histories(symbols: List[str]) -> Dict[str, Optional[dict]]:
    from app.services import dividend_calendar as dc

    try:
        return await dc.fetch_histories(symbols)
    except Exception:  # noqa: BLE001
        return {}


async def load_macro(start: date, end: date) -> List[dict]:
    from app.api import monitor_extended

    try:
        resp = await monitor_extended.get_economic_calendar_range(start=start.isoformat(), end=end.isoformat())
    except Exception:  # noqa: BLE001
        return []
    out = []
    for e in resp.events:
        if e.impact != "high" or (e.country_code or "").upper() != "US" or not e.date:
            continue
        out.append({"date": e.date[:10], "time": e.time, "name": e.event_name, "forecast": e.forecast,
                    "prior": e.prior, "unit": e.unit})
    return out


async def load_forecast(symbol: str) -> Optional[dict]:
    from app.api.forecast import _get_or_compute

    try:
        return await asyncio.wait_for(_get_or_compute(symbol), timeout=75)
    except Exception as exc:  # noqa: BLE001 - 422 (short history), timeout, provider failure
        logger.info("forecast unavailable for %s: %s", symbol, exc)
        return None


async def load_quotes(symbols: List[str]) -> Dict[str, Tuple[float, str]]:
    """{symbol: (price, source)}: the canonical portfolio quotes, else the last
    adjusted daily close (so the planner still works when the quote store is down)."""
    out: Dict[str, Tuple[float, str]] = {}
    try:
        from app.db.database import SessionLocal
        from app.services.portfolio_pricing import fetch_quotes

        db = SessionLocal()
        try:
            q = await fetch_quotes(db, symbols)
        finally:
            db.close()
        out = {s: (float(v["price"]), "quote") for s, v in q.items() if v.get("price")}
    except Exception as exc:  # noqa: BLE001
        logger.info("scenario quotes failed: %s", exc)
    missing = [s for s in symbols if s not in out]
    if missing:
        closes = await asyncio.gather(*(load_closes(s, period="5d") for s in missing))
        for s, c in zip(missing, closes):
            if c:
                out[s] = (c[max(c)], "last_close")
    return out


# ── helpers ──────────────────────────────────────────────────────────────────

def select_expiries(exps: List[str], today: date, limit: int = 8) -> List[str]:
    """The next four expiries, then one monthly (3rd-Friday window) per later month."""
    future = [e for e in exps if date.fromisoformat(e) > today]
    picked = future[:4]
    months = set()
    for e in future[4:]:
        if len(picked) >= limit:
            break
        d = date.fromisoformat(e)
        if (d.year, d.month) in months:
            continue
        same_month = [x for x in future if x[:7] == e[:7]]
        monthly = next((x for x in same_month if 15 <= date.fromisoformat(x).day <= 21), same_month[-1])
        if monthly not in picked:
            picked.append(monthly)
        months.add((d.year, d.month))
    return sorted(picked)[:limit]


async def analyse(symbol: str, expiration: str, spot: Optional[float] = None) -> Optional[dict]:
    chain = await load_chain(symbol, expiration)
    if not chain or not chain.get("spot"):
        return None
    try:
        a = om.analyse_expiry(chain["calls"], chain["puts"], float(spot or chain["spot"]), expiration, _rate())
    except Exception:  # noqa: BLE001 - one malformed chain must not fail the page
        logger.exception("outlook analysis failed %s %s", symbol, expiration)
        return None
    if a is not None:
        a["source"] = chain.get("source")
    return a


SPOT_MISMATCH = 0.005


def parity_spot(analyses: List[Optional[dict]]) -> Optional[float]:
    """Underlying price implied by the option quotes themselves: F e^{-rT} at the
    nearest expiry whose forward came from put-call parity on liquid mids."""
    ok = [a for a in analyses if a and a["forward_method"] == "put_call_parity" and a["quote_basis"] == "mid"
          and a["t_years"] > 0]
    if not ok:
        return None
    a = min(ok, key=lambda x: x["t_years"])
    return a["forward"] * math.exp(-_rate() * a["t_years"])


async def analyse_consistent(symbol: str, expirations: List[str]) -> Tuple[List[Optional[dict]], dict]:
    """Analyse expiries against one underlying price the option quotes agree with.

    A quoted price can be out of step with the option book (a stale last trade,
    an extended-hours print, a holiday). Probabilities "above spot" and move
    percentages are then measured from the wrong level. When the parity-implied
    price differs from the quote by more than 0.5%, every expiry is re-measured
    from the parity price and the response says so.
    """
    analyses = list(await asyncio.gather(*(analyse(symbol, e) for e in expirations)))
    quoted = next((a["spot"] for a in analyses if a), None)
    implied = parity_spot(analyses)
    meta = {"quoted_spot": quoted, "parity_spot": round(implied, 4) if implied else None, "spot_basis": "quote"}
    if quoted and implied and abs(implied / quoted - 1.0) > SPOT_MISMATCH:
        analyses = list(await asyncio.gather(*(analyse(symbol, e, implied) for e in expirations)))
        meta["spot_basis"] = "option_parity"
    return analyses, meta


def _is_trading_day(d: date) -> bool:
    from app.services import market_calendar as mc

    try:
        return bool(mc.is_trading_day(d))
    except Exception:  # noqa: BLE001
        return d.weekday() < 5


def trading_days_between(start: date, end: date) -> int:
    """Trading sessions after ``start`` up to and including ``end``."""
    from app.services import market_calendar as mc

    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if mc.is_trading_day(d):
            n += 1
    return n


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/outlook/scenarios")
async def list_scenarios():
    return {"scenarios": sc.HISTORICAL, "disclaimer": DISCLAIMER}


@router.get("/outlook/calendar")
async def event_calendar(
    symbols: str = Query("SPY,QQQ,AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA", max_length=200),
    days: int = Query(30, ge=7, le=42),
):
    syms = []
    for raw in symbols.split(","):
        s = raw.strip().upper()
        if s and SYMBOL_RE.match(s) and s not in syms and not is_retired(s):
            syms.append(s)
    syms = syms[:12]
    if not syms:
        raise HTTPException(status_code=422, detail="no valid symbols")
    today = _today_et()
    end = today + timedelta(days=days)
    key = f"outlook:cal:v1:{','.join(sorted(syms))}:{days}:{today.isoformat()}"
    hit = await cache_service.get(key)
    if isinstance(hit, dict):
        return hit

    exp_lists = dict(zip(syms, await asyncio.gather(*(load_expirations(s) for s in syms))))

    async def implied_for(sym: str, event_day: date, after_close: bool) -> Optional[dict]:
        exps = exp_lists.get(sym) or []
        if sym not in exp_lists:
            exps = await load_expirations(sym)
        after = next((e for e in exps if (date.fromisoformat(e) > event_day if after_close
                                          else date.fromisoformat(e) >= event_day)), None)
        if after is None:
            return None
        before = next((e for e in reversed(exps) if date.fromisoformat(e) > today and
                       (date.fromisoformat(e) <= event_day if after_close else date.fromisoformat(e) < event_day)),
                      None)
        a_after, a_before = await asyncio.gather(analyse(sym, after),
                                                 analyse(sym, before) if before else _none())
        if a_after is None:
            return None
        st = a_after.get("straddle") or {}
        return {
            "expiration": after,
            "move_pct": st.get("move_pct"),
            "one_sigma_pct": a_after["one_sigma_pct"],
            "event_move_pct": om.event_move_pct(a_before, a_after),
            "quality": a_after["quality"],
        }

    earn_syms = [s for s in syms if s not in _ETF_LIKE]
    earn, divs, macro = await asyncio.gather(
        asyncio.gather(*(load_next_earnings(s, days) for s in earn_syms)),
        load_dividend_histories(syms),
        load_macro(today, end),
    )
    events: List[dict] = []
    tasks = []
    for esym, ev in zip(earn_syms, earn):
        if not ev or not ev.get("date"):
            continue
        ev = {**ev, "symbol": esym}
        d = date.fromisoformat(ev["date"][:10])
        if not (today <= d <= end):
            continue
        amc = (ev.get("hour") or "").lower() == "amc"
        row = {"type": "earnings", "symbol": ev.get("symbol"), "date": d.isoformat(), "hour": ev.get("hour"),
               "title": f"{ev.get('symbol')} earnings", "detail": ev.get("fiscal_period"),
               "eps_estimate": ev.get("eps_estimate"), "implied": None}
        events.append(row)
        tasks.append((row, implied_for(row["symbol"], d, amc)))

    spot_cache: Dict[str, Optional[float]] = {}
    for sym, h in (divs or {}).items():
        if not h or not h.get("next_ex_date") or not h.get("dividends"):
            continue
        d = date.fromisoformat(h["next_ex_date"][:10])
        if not (today <= d <= end):
            continue
        amount = _regular(h["dividends"])
        row = {"type": "dividend", "symbol": sym, "date": d.isoformat(), "title": f"{sym} ex-dividend",
               "amount": amount, "pay_date": h.get("next_pay_date"), "amount_pct": None, "implied": None}
        if not _is_trading_day(d):
            # shown as reported, never moved: the provider's date may be off by a day
            row["date_note"] = "Reported date is not a trading day; check the company's announcement"
        events.append(row)
        spot_cache.setdefault(sym, None)

    macro_dates = sorted({m["date"] for m in macro})[:8]
    for m in macro:
        if m["date"] not in macro_dates:
            continue
        row = {"type": "macro", "symbol": "SPY", "date": m["date"], "title": m["name"], "time": m["time"],
               "forecast": m.get("forecast"), "prior": m.get("prior"), "unit": m.get("unit"), "implied": None}
        events.append(row)
    macro_implied = {}
    for d in macro_dates:
        macro_implied[d] = implied_for("SPY", date.fromisoformat(d), False)

    results = await asyncio.gather(*(t for _, t in tasks), *macro_implied.values(), return_exceptions=True)
    for (row, _), res in zip(tasks, results[:len(tasks)]):
        row["implied"] = res if isinstance(res, dict) else None
    for d, res in zip(macro_implied.keys(), results[len(tasks):]):
        for row in events:
            if row["type"] == "macro" and row["date"] == d:
                row["implied"] = res if isinstance(res, dict) else None

    if spot_cache:
        for sym in spot_cache:
            exps = exp_lists.get(sym) or []
            chain = await load_chain(sym, exps[0]) if exps else None
            spot_cache[sym] = chain.get("spot") if chain else None
        for row in events:
            if row["type"] == "dividend" and row.get("amount") and spot_cache.get(row["symbol"]):
                row["amount_pct"] = round(row["amount"] / spot_cache[row["symbol"]] * 100, 3)

    events.sort(key=lambda r: (r["date"], {"macro": 0, "earnings": 1, "dividend": 2}[r["type"]], r["symbol"] or ""))
    body = {"today": today.isoformat(), "end": end.isoformat(), "symbols": syms, "events": events,
            "macro_available": bool(macro), "disclaimer": DISCLAIMER,
            "generated_at": datetime.now(timezone.utc).isoformat()}
    await cache_service.set(key, body, 900)
    return body


_ETF_LIKE = {"SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "GLD", "TLT", "XLK", "XLF", "XLE", "XLV"}


async def _none():
    return None


def _regular(divs: List[List[Any]]) -> Optional[float]:
    from app.services.dividend_calendar import regular_amount

    amounts = [float(a) for _, a in divs if a]
    v = regular_amount(amounts)
    return round(v, 4) if v else None


@router.get("/outlook/{symbol}/implied")
async def implied_outlook(symbol: str, max_expiries: int = Query(8, ge=1, le=MAX_EXPIRIES)):
    sym = _sym(symbol)
    exps = await load_expirations(sym)
    if not exps:
        raise HTTPException(status_code=404, detail=f"No listed options found for {sym}")
    today = _today_et()
    chosen = select_expiries(exps, today, max_expiries)
    analyses, spot_meta = await analyse_consistent(sym, chosen)
    rows = [om.public(a) for a in analyses if a]
    if not rows:
        raise HTTPException(status_code=503, detail=f"Option quotes for {sym} are unavailable right now")
    return {
        "symbol": sym,
        "spot": rows[0]["spot"],
        **spot_meta,
        "risk_free_rate": _rate(),
        "expirations": exps,
        "expiries": rows,
        "source": analyses[0].get("source") if analyses[0] else rows[0].get("source"),
        "disclaimer": DISCLAIMER,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/outlook/{symbol}/probability")
async def probability(symbol: str, target: float = Query(..., gt=0), expiration: str = Query(...)):
    sym = _sym(symbol)
    try:
        exp_d = date.fromisoformat(expiration[:10])
    except ValueError:
        raise HTTPException(status_code=422, detail="expiration must be YYYY-MM-DD")
    exps = await load_expirations(sym)
    if not exps:
        raise HTTPException(status_code=404, detail=f"No listed options found for {sym}")
    # The user may pick any date: use the first listed expiry on or after it.
    use = next((e for e in exps if date.fromisoformat(e) >= exp_d), None)
    if use is None:
        raise HTTPException(status_code=422, detail="date is beyond the last listed expiry")
    # the nearest expiry anchors the parity price when the quote is out of step
    near = next((e for e in exps if date.fromisoformat(e) > _today_et()), use)
    pair = [near] if near == use else [near, use]
    analyses, spot_meta = await analyse_consistent(sym, pair)
    a = analyses[-1]
    if a is None:
        raise HTTPException(status_code=503, detail=f"Option quotes for {sym} {use} are unavailable right now")
    if not (a["spot"] * 0.05 <= target <= a["spot"] * 20):
        raise HTTPException(status_code=422, detail="target is too far from the current price")
    return {
        "symbol": sym,
        "requested_date": exp_d.isoformat(),
        "expiration": use,
        "probability": om.probability(a, target),
        **spot_meta,
        "expiry": om.public(a, curve_points=80),
        "method": METHOD_TEXT.get(a["smile_method"], ""),
        "disclaimer": DISCLAIMER,
    }


@router.get("/outlook/{symbol}/earnings")
async def earnings_outlook(symbol: str):
    sym = _sym(symbol)
    today = _today_et()
    key = f"outlook:earn:v1:{sym}:{today.isoformat()}"
    hit = await cache_service.get(key)
    if isinstance(hit, dict):
        return hit
    nxt, stamps, closes, exps = await asyncio.gather(
        load_next_earnings(sym, 60), load_earnings_stamps(sym), load_closes(sym, period="4y"), load_expirations(sym))
    moves = earnings_moves.realized_moves(closes, stamps, today, limit=12)
    summary = earnings_moves.summarize(moves)

    implied = None
    if nxt and nxt.get("date") and exps:
        d = date.fromisoformat(nxt["date"][:10])
        amc = (nxt.get("hour") or "").lower() == "amc"
        after = next((e for e in exps if (date.fromisoformat(e) > d if amc else date.fromisoformat(e) >= d)), None)
        before = next((e for e in reversed(exps) if date.fromisoformat(e) > today and
                       (date.fromisoformat(e) <= d if amc else date.fromisoformat(e) < d)), None)
        if after:
            a_after, a_before = await asyncio.gather(analyse(sym, after), analyse(sym, before) if before else _none())
            if a_after:
                st = a_after.get("straddle") or {}
                implied = {
                    "expiration": after,
                    "pre_event_expiration": before if a_before else None,
                    "straddle_move_pct": st.get("move_pct"),
                    "one_sigma_pct": a_after["one_sigma_pct"],
                    "event_move_pct": om.event_move_pct(a_before, a_after),
                    "atm_iv": a_after["atm_iv"],
                    "pre_event_atm_iv": a_before["atm_iv"] if a_before else None,
                    "quality": a_after["quality"],
                }
    ratio = None
    if implied and summary["avg_abs_move_pct"]:
        ref = implied["event_move_pct"] or implied["straddle_move_pct"]
        if ref:
            ratio = round(ref / summary["avg_abs_move_pct"], 3)
    body = {
        "symbol": sym,
        "today": today.isoformat(),
        "next_earnings": nxt,
        "implied": implied,
        "history": moves,
        "summary": summary,
        "implied_vs_realized": ratio,
        "notes": ("Straddle move covers every trading day to that expiry, not just the report. The event move "
                  "strips out ordinary days using the expiry before the report (term-structure method) and is "
                  "the figure comparable with past one-day reactions."),
        "disclaimer": DISCLAIMER,
    }
    await cache_service.set(key, body, 1800)
    return body


@router.get("/outlook/{symbol}/perception")
async def perception(symbol: str):
    sym = _sym(symbol)
    exps = await load_expirations(sym)
    today = _today_et()
    forecast_task = asyncio.create_task(load_forecast(sym))
    rows: List[dict] = []
    if exps:
        near = [e for e in exps if 0 < (date.fromisoformat(e) - today).days <= 92]
        chosen = select_expiries(near, today, 6)
        analyses, spot_meta = await analyse_consistent(sym, chosen)
    else:
        analyses, spot_meta = [], {"quoted_spot": None, "parity_spot": None, "spot_basis": "quote"}
    fc = await forecast_task
    path = {int(p["h"]): p for p in (fc or {}).get("path", [])}
    as_of = date.fromisoformat(fc["as_of"]) if fc and fc.get("as_of") else today
    for a in analyses:
        if not a:
            continue
        exp_d = date.fromisoformat(a["expiration"])
        k = trading_days_between(as_of, exp_d)
        model = None
        p = path.get(k)
        if p:
            model = {"trading_days": k, "date": p["date"], "point": p["point"],
                     "exp_return_pct": p["exp_return_pct"], "prob_up": p["prob_up"],
                     "range_80": p["bands"].get("80"), "range_50": p["bands"].get("50"),
                     "range_95": p["bands"].get("95")}
        rows.append({
            "expiration": a["expiration"],
            "days": a["days"],
            "trading_days": k,
            "market": {"range_80": a["range_80"], "range_68": a["range_68"], "median": a["median"],
                       "prob_above_spot": a["prob_above_spot"], "atm_iv": a["atm_iv"],
                       "straddle_move_pct": (a.get("straddle") or {}).get("move_pct"), "quality": a["quality"]},
            "model": model,
        })
    if not rows and not fc:
        raise HTTPException(status_code=503, detail=f"Neither option quotes nor a forecast are available for {sym}")
    model_meta = None
    if fc:
        model_meta = {"name": (fc.get("model") or {}).get("name"), "as_of": fc.get("as_of"),
                      "last_close": fc.get("last_close"), "vol_annualized_pct": fc.get("vol_annualized_pct"),
                      "beats_naive": fc.get("beats_naive"), "horizon_max": max(path) if path else None,
                      "disclaimer": fc.get("disclaimer")}
    return {
        "symbol": sym,
        "spot": next((a["spot"] for a in analyses if a), None),
        **spot_meta,
        "rows": rows,
        "model": model_meta,
        "labels": {
            "market": "Market-implied (risk-neutral, from option prices)",
            "model": "QuantTrade statistical forecast (SARIMAX + GJR-GARCH, walk-forward tested)",
        },
        "disclaimer": DISCLAIMER,
    }


class HedgeBody(BaseModel):
    symbol: str = Field(..., max_length=12)
    shares: float = Field(..., gt=0, le=1e8)
    expiration: Optional[str] = None
    put_strike: Optional[float] = Field(None, gt=0)
    call_strike: Optional[float] = Field(None, gt=0)
    reduce_pct: float = Field(50.0, ge=0, le=100)


def _premium(contracts: List[dict], strike: float) -> Tuple[Optional[float], Optional[str]]:
    c = next((x for x in contracts if x.get("strike") and abs(float(x["strike"]) - strike) < 1e-6), None)
    if not c:
        return None, None
    mid = om.liquid_mid(c)
    if mid is not None:
        return round(mid, 4), "mid"
    last = om.traded_last(c)
    if last is not None:
        return round(last, 4), "last"
    return None, None


def _nearest(strikes: List[float], target: float, below: bool) -> Optional[float]:
    side = [k for k in strikes if (k <= target if below else k >= target)]
    if not side:
        return None
    return max(side) if below else min(side)


@router.post("/outlook/hedge")
async def hedge_planner(body: HedgeBody):
    sym = _sym(body.symbol)
    exps = await load_expirations(sym)
    today = _today_et()
    future = [e for e in exps if date.fromisoformat(e) > today]
    if not future:
        raise HTTPException(status_code=404, detail=f"No listed options found for {sym}")
    exp = body.expiration[:10] if body.expiration else None
    if exp:
        try:
            exp_d = date.fromisoformat(exp)
        except ValueError:
            raise HTTPException(status_code=422, detail="expiration must be YYYY-MM-DD")
        exp = next((e for e in future if date.fromisoformat(e) >= exp_d), future[-1])
    else:  # default: about a month out
        exp = next((e for e in future if (date.fromisoformat(e) - today).days >= 28), future[-1])
    chain = await load_chain(sym, exp)
    if not chain or not chain.get("spot"):
        raise HTTPException(status_code=503, detail=f"Option quotes for {sym} {exp} are unavailable right now")
    spot = float(chain["spot"])
    calls, puts = chain["calls"], chain["puts"]
    quoted_spot, spot_basis = spot, "quote"
    try:
        first = om.analyse_expiry(calls, puts, spot, exp, _rate())
    except Exception:  # noqa: BLE001
        first = None
    implied_spot = parity_spot([first])
    if implied_spot and abs(implied_spot / spot - 1.0) > SPOT_MISMATCH:
        spot, spot_basis = implied_spot, "option_parity"
    put_strikes = sorted({float(c["strike"]) for c in puts if c.get("strike") and _premium(puts, float(c["strike"]))[0]})
    call_strikes = sorted({float(c["strike"]) for c in calls if c.get("strike") and _premium(calls, float(c["strike"]))[0]})
    if not put_strikes:
        raise HTTPException(status_code=503, detail=f"No priced puts for {sym} {exp}")
    kp = body.put_strike or _nearest(put_strikes, spot * 0.95, True) or put_strikes[0]
    kc = body.call_strike or _nearest(call_strikes, spot * 1.05, False)
    p, p_basis = _premium(puts, kp)
    c, c_basis = _premium(calls, kc) if kc else (None, None)
    if p is None:
        raise HTTPException(status_code=422, detail=f"No usable quote for the {kp:g} put")
    if kc and c is None:
        raise HTTPException(status_code=422, detail=f"No usable quote for the {kc:g} call")
    a = om.analyse_expiry(calls, puts, spot, exp, _rate())
    prob_below = None
    if a:
        dist = a["_dist"]
        prob_below = lambda x: 1.0 - om._interp_above(dist, x)  # noqa: E731
    try:
        out = hedge_math.plan(spot=spot, shares=body.shares, put_strike=kp, put_premium=p,
                              call_strike=kc, call_premium=c, reduce_fraction=body.reduce_pct / 100.0,
                              prob_below=prob_below)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    strikes = sorted(set(put_strikes) | set(call_strikes))
    lo, hi = spot * 0.6, spot * 1.4
    out.update({
        "symbol": sym,
        "expiration": exp,
        "days": (date.fromisoformat(exp) - today).days,
        "expirations": future[:24],
        "put": {"strike": kp, "premium": p, "basis": p_basis},
        "call": {"strike": kc, "premium": c, "basis": c_basis} if kc else None,
        "put_strikes": [k for k in put_strikes if lo <= k <= hi],
        "call_strikes": [k for k in call_strikes if lo <= k <= hi],
        "strikes": [k for k in strikes if lo <= k <= hi],
        "source": chain.get("source"),
        "quoted_spot": round(quoted_spot, 4),
        "spot_basis": spot_basis,
        "assumptions": "Held to expiry; premiums at mid (or last trade where marked); no fees, taxes, "
                       "dividends or early assignment; 1 option contract = 100 shares.",
        "disclaimer": DISCLAIMER,
    })
    return out


class Holding(BaseModel):
    symbol: str = Field(..., max_length=12)
    shares: float = Field(..., gt=0, le=1e9)


class ScenarioBody(BaseModel):
    holdings: List[Holding] = Field(..., min_length=1, max_length=40)
    scenario_id: Optional[str] = None
    market_move_pct: Optional[float] = Field(None, ge=-95, le=200)
    overrides: Optional[Dict[str, float]] = None  # symbol -> % move


@router.post("/outlook/scenario")
async def scenario(body: ScenarioBody):
    syms = []
    shares: Dict[str, float] = {}
    for h in body.holdings:
        s = _sym(h.symbol)
        shares[s] = shares.get(s, 0.0) + h.shares
        if s not in syms:
            syms.append(s)
    if body.scenario_id is None and body.market_move_pct is None:
        raise HTTPException(status_code=422, detail="give scenario_id or market_move_pct")
    hist = sc.HISTORICAL_BY_ID.get(body.scenario_id) if body.scenario_id else None
    if body.scenario_id and hist is None:
        raise HTTPException(status_code=422, detail="unknown scenario")

    quotes = await load_quotes(syms)
    prices = {s: q[0] for s, q in quotes.items()}
    year = await asyncio.gather(*(load_closes(s, period="1y") for s in ["SPY", *syms]))
    spy_y = year[0]
    betas: Dict[str, Optional[float]] = {}
    for s, closes in zip(syms, year[1:]):
        betas[s] = sc.beta(*_paired_returns(closes, spy_y)) if s != "SPY" else 1.0

    symbol_returns: Dict[str, float] = {}
    if hist:
        start, end = date.fromisoformat(hist["start"]), date.fromisoformat(hist["end"])
        s_str, e_str = (start - timedelta(days=10)).isoformat(), (end + timedelta(days=10)).isoformat()
        windows = await asyncio.gather(*(load_closes(s, s_str, e_str) for s in ["SPY", *syms]))
        market = sc.window_return(windows[0], start, end)
        if market is None:
            raise HTTPException(status_code=503, detail="Historical SPY prices are unavailable right now")
        for s, w in zip(syms, windows[1:]):
            r = sc.window_return(w, start, end)
            if r is not None:
                symbol_returns[s] = r
    else:
        market = float(body.market_move_pct) / 100.0

    overrides = {k.upper(): float(v) / 100.0 for k, v in (body.overrides or {}).items()
                 if SYMBOL_RE.match(k.upper()) and math.isfinite(float(v))}
    out = sc.apply([{"symbol": s, "shares": shares[s], "price": prices.get(s)} for s in syms],
                   market_return=market, symbol_returns=symbol_returns, betas=betas, overrides=overrides)
    out.update({
        "scenario": hist or {"id": "custom", "label": f"Market {market * 100:+.1f}%"},
        "price_sources": {s: q[1] for s, q in quotes.items()},
        "methods": {
            "actual": "Measured return of this symbol over the episode",
            "beta": "Beta x SPY move (beta from the last year of daily returns)",
            "assumed_beta_1": "Not enough history for a beta: moved with the market",
            "override": "Your own shock for this symbol",
            "no_price": "No current price, so no value to stress",
        },
        "disclaimer": DISCLAIMER,
    })
    return out


def _paired_returns(a: Dict[date, float], m: Dict[date, float]) -> Tuple[List[float], List[float]]:
    days = sorted(set(a) & set(m))
    ra, rm = [], []
    for d0, d1 in zip(days, days[1:]):
        ra.append(a[d1] / a[d0] - 1.0)
        rm.append(m[d1] / m[d0] - 1.0)
    return ra, rm
