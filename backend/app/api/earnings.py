"""
Earnings calendar API.

  GET /api/v1/earnings/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
        &scope=all|watchlist|portfolio&cap=mega|large|mid|small|micro&sector=Technology
      Upcoming and recent reports in the window (<= 31 days; default: this
      Mon-Sun week in New York). scope=watchlist|portfolio needs auth (401
      otherwise). Missing numbers are null, never 0.
  GET /api/v1/earnings/next/{symbol}
      Next scheduled report within 30 days, for the Research header badge.
  GET /api/v1/earnings/history/{symbol}
      Last <= 8 reported quarters: EPS actual vs consensus estimate and surprise %
      (Finnhub /stock/earnings, yfinance fallback; cached 12h). available=false when
      every source failed.

Data: app.services.earnings_calendar (Finnhub + Nasdaq, Redis-cached).
"""
from __future__ import annotations

import asyncio
import re
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.database import get_db
from app.models.user import User
from app.services import earnings_calendar as cal

router = APIRouter(prefix="/earnings", tags=["earnings"])

SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
MAX_ROWS = 3000
Scope = Literal["all", "watchlist", "portfolio"]


def _parse_day(raw: Optional[str], name: str) -> Optional[date]:
    if raw is None or raw == "":
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be YYYY-MM-DD")


def _enrich(db: Session, rows: List[dict], user: Optional[User], scope: str,
            cap: Optional[str], sector: Optional[str], today: date) -> dict:
    """Sync DB work (runs in a worker thread): sector/market cap from our tables + user scope."""
    from app.models.fundamentals import Fundamentals
    from app.models.symbol import Symbol
    from app.services.user_symbols import portfolio_symbols, watchlist_symbols

    syms = sorted({r["symbol"] for r in rows})
    meta: Dict[str, dict] = {}
    for i in range(0, len(syms), 500):
        chunk = syms[i:i + 500]
        q = (
            db.query(Symbol.symbol, Symbol.name, Symbol.sector, Symbol.market_cap,
                     Fundamentals.sector, Fundamentals.market_cap)
            .outerjoin(Fundamentals, Fundamentals.symbol_id == Symbol.id)
            .filter(Symbol.symbol.in_(chunk))
        )
        for s, name, sec, mc, f_sec, f_mc in q.all():
            meta[str(s).upper()] = {
                "name": name,
                "sector": (sec or f_sec or None),
                "market_cap": cal._finite(f_mc) or cal._finite(mc),
            }

    watch: Set[str] = set()
    held: Set[str] = set()
    if user is not None:
        watch = watchlist_symbols(db, user.id)
        held = portfolio_symbols(db, user.id)

    out: List[dict] = []
    sectors: Set[str] = set()
    for r in rows:
        m = meta.get(r["symbol"], {})
        mc = r.get("market_cap") or m.get("market_cap")
        row = {
            **{k: v for k, v in r.items() if k not in {"fiscal_quarter_ending"}},
            "name": r.get("name") or m.get("name"),
            "sector": m.get("sector"),
            "market_cap": mc,
            "cap_tier": cal.cap_tier(mc),
            "hour_label": cal.HOUR_LABEL.get(r.get("hour") or ""),
            "fiscal_period": r.get("fiscal_period") or r.get("fiscal_quarter_ending"),
            "in_watchlist": r["symbol"] in watch,
            "in_portfolio": r["symbol"] in held,
        }
        # A past report whose figures the sources have not published yet: it happened,
        # the numbers just show as "—".
        if row["status"] == "upcoming" and row["date"] < today.isoformat():
            row["status"] = "reported"
        if row["sector"]:
            sectors.add(row["sector"])
        if scope == "watchlist" and not row["in_watchlist"]:
            continue
        if scope == "portfolio" and not row["in_portfolio"]:
            continue
        if cap and row["cap_tier"] != cap:
            continue
        if sector and (row["sector"] or "").lower() != sector.lower():
            continue
        out.append(row)
    return {"rows": out, "sectors": sorted(sectors), "watchlist_count": len(watch), "portfolio_count": len(held)}


@router.get("/calendar")
async def earnings_calendar(
    start: Optional[str] = Query(None, description="YYYY-MM-DD (default: Monday of this week, New York)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD, inclusive (default: start + 6 days)"),
    scope: Scope = "all",
    cap: Optional[Literal["mega", "large", "mid", "small", "micro"]] = None,
    sector: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    if scope != "all" and user is None:
        raise HTTPException(status_code=401, detail="Sign in to filter by your watchlist or portfolio")
    today = cal.today_et()
    s = _parse_day(start, "start") or (today - timedelta(days=today.weekday()))
    e = _parse_day(end, "end") or (s + timedelta(days=6))
    if e < s:
        raise HTTPException(status_code=422, detail="end must be on or after start")
    if (e - s).days + 1 > cal.MAX_WINDOW_DAYS:
        raise HTTPException(status_code=422, detail=f"window is limited to {cal.MAX_WINDOW_DAYS} days")

    window = await cal.fetch_window(s, e, today=today)
    body = await asyncio.to_thread(_enrich, db, window["rows"], user, scope, cap,
                                    (sector or "").strip() or None, today)
    rows = body["rows"]
    truncated = len(rows) > MAX_ROWS
    return {
        "start": s.isoformat(),
        "end": e.isoformat(),
        "today": today.isoformat(),
        "scope": scope,
        "cap": cap,
        "sector": sector,
        "rows": rows[:MAX_ROWS],
        "total": len(rows),
        "truncated": truncated,
        "sectors": body["sectors"],
        "cap_tiers": [{"id": t[0], "label": t[1]} for t in cal.CAP_TIERS],
        "sources": window["sources"],
        "watchlist_count": body["watchlist_count"] if user else None,
        "portfolio_count": body["portfolio_count"] if user else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/next/{symbol}")
async def next_earnings(symbol: str):
    sym = (symbol or "").strip().upper()
    if not SYMBOL_RE.match(sym):
        raise HTTPException(status_code=422, detail="invalid symbol")
    today = cal.today_et()
    event = await cal.next_earnings(sym, today=today)
    return {"symbol": sym, "today": today.isoformat(), **cal.event_payload(event, today)}


@router.get("/history/{symbol}")
async def eps_history(symbol: str):
    sym = (symbol or "").strip().upper()
    if not SYMBOL_RE.match(sym):
        raise HTTPException(status_code=422, detail="invalid symbol")
    body = await cal.fetch_eps_history(sym)
    return {**body, "generated_at": datetime.now(timezone.utc).isoformat()}
