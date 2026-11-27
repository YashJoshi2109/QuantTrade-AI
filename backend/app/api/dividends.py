"""
Dividend calendar + projected dividend income.

  GET /api/v1/dividends/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&scope=all|watchlist|portfolio
      Stocks going ex-dividend in the window (<= 31 days; default this Mon-Sun, New
      York): ex-date, pay date, record date, amount, indicated annual dividend,
      frequency, and yield (annual / last price in our DB, "—" when unknown).
      scope=watchlist|portfolio needs auth.
  GET /api/v1/dividends/income[?portfolio_id=N]
      Auth. Projected dividend income for the next 12 months by pay month, from the
      user's tracked (non-paper) portfolios, or one owned portfolio.

Data + math: app.services.dividend_calendar (Nasdaq calendar, yfinance history).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.auth import get_current_user, require_auth
from app.db.database import get_db
from app.models.user import User
from app.services import dividend_calendar as dc

router = APIRouter(prefix="/dividends", tags=["dividends"])

MAX_ROWS = 3000
MAX_SANE_YIELD_PCT = 40.0  # above this the price or amount is almost certainly stale / special


def _parse_day(raw: Optional[str], name: str) -> Optional[date]:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be YYYY-MM-DD")


def _last_prices(db: Session, symbols: List[str]) -> Dict[str, dict]:
    """name + last known price per symbol from our tables (fundamentals, else latest daily bar)."""
    from sqlalchemy import func

    from app.models.fundamentals import Fundamentals
    from app.models.price import PriceBar
    from app.models.symbol import Symbol

    out: Dict[str, dict] = {}
    for i in range(0, len(symbols), 500):
        chunk = symbols[i:i + 500]
        rows = (
            db.query(Symbol.id, Symbol.symbol, Symbol.name, Symbol.sector, Fundamentals.price)
            .outerjoin(Fundamentals, Fundamentals.symbol_id == Symbol.id)
            .filter(Symbol.symbol.in_(chunk))
            .all()
        )
        need_bar: Dict[int, str] = {}
        for sid, sym, name, sector, price in rows:
            p = dc._finite(price)
            out[str(sym).upper()] = {"name": name, "sector": sector, "price": p if p and p > 0 else None}
            if not p or p <= 0:
                need_bar[sid] = str(sym).upper()
        if need_bar:
            latest = (
                db.query(PriceBar.symbol_id, func.max(PriceBar.timestamp).label("ts"))
                .filter(PriceBar.symbol_id.in_(list(need_bar)))
                .group_by(PriceBar.symbol_id)
                .subquery()
            )
            for sid, close in (
                db.query(PriceBar.symbol_id, PriceBar.close)
                .join(latest, (PriceBar.symbol_id == latest.c.symbol_id) & (PriceBar.timestamp == latest.c.ts))
                .all()
            ):
                c = dc._finite(close)
                if c and c > 0:
                    out[need_bar[sid]]["price"] = c
    return out


def yield_pct(annual: Optional[float], price: Optional[float]) -> Optional[float]:
    if not annual or not price or annual <= 0 or price <= 0:
        return None
    y = annual / price * 100.0
    return round(y, 2) if 0 < y <= MAX_SANE_YIELD_PCT else None


def _enrich_calendar(db: Session, rows: List[dict], user: Optional[User], scope: str) -> dict:
    from app.services.user_symbols import portfolio_symbols, watchlist_symbols

    meta = _last_prices(db, sorted({r["symbol"] for r in rows}))
    watch: Set[str] = set()
    held: Set[str] = set()
    if user is not None:
        watch = watchlist_symbols(db, user.id)
        held = portfolio_symbols(db, user.id)
    out = []
    for r in rows:
        m = meta.get(r["symbol"], {})
        annual = r.get("annual_dividend")
        if annual is None and r.get("amount") and r.get("frequency"):
            annual = round(r["amount"] * r["frequency"], 6)
        row = {
            **r,
            "name": r.get("name") or m.get("name"),
            "sector": m.get("sector"),
            "price": m.get("price"),
            "annual_dividend": annual,
            "yield_pct": yield_pct(annual, m.get("price")),
            "in_watchlist": r["symbol"] in watch,
            "in_portfolio": r["symbol"] in held,
        }
        if scope == "watchlist" and not row["in_watchlist"]:
            continue
        if scope == "portfolio" and not row["in_portfolio"]:
            continue
        out.append(row)
    return {"rows": out, "watchlist_count": len(watch), "portfolio_count": len(held)}


@router.get("/calendar")
async def dividend_calendar(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    scope: Literal["all", "watchlist", "portfolio"] = "all",
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    if scope != "all" and user is None:
        raise HTTPException(status_code=401, detail="Sign in to filter by your watchlist or portfolio")
    today = dc.today_et()
    s = _parse_day(start, "start") or (today - timedelta(days=today.weekday()))
    e = _parse_day(end, "end") or (s + timedelta(days=6))
    if e < s:
        raise HTTPException(status_code=422, detail="end must be on or after start")
    if (e - s).days + 1 > dc.MAX_WINDOW_DAYS:
        raise HTTPException(status_code=422, detail=f"window is limited to {dc.MAX_WINDOW_DAYS} days")
    window = await dc.fetch_window(s, e, today=today)
    body = await asyncio.to_thread(_enrich_calendar, db, window["rows"], user, scope)
    rows = body["rows"]
    return {
        "start": s.isoformat(),
        "end": e.isoformat(),
        "today": today.isoformat(),
        "scope": scope,
        "rows": rows[:MAX_ROWS],
        "total": len(rows),
        "truncated": len(rows) > MAX_ROWS,
        "source_ok": window["source_ok"],
        "watchlist_count": body["watchlist_count"] if user else None,
        "portfolio_count": body["portfolio_count"] if user else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _income_inputs(db: Session, user: User, portfolio_id: Optional[int]) -> dict:
    from app.models.portfolio import Portfolio, Position
    from app.models.symbol import Symbol
    from app.services.user_symbols import portfolio_quantities

    owned = (
        db.query(Portfolio)
        .filter(Portfolio.user_id == user.id)
        .order_by(Portfolio.id)
        .all()
    )
    tracked = [p for p in owned if int(p.is_paper_trading or 0) == 0]
    if portfolio_id is not None:
        sel = next((p for p in owned if p.id == portfolio_id), None)
        if sel is None:
            raise HTTPException(status_code=404, detail="Portfolio not found")
        holdings: Dict[str, float] = {}
        for sym, qty in (
            db.query(Symbol.symbol, Position.quantity)
            .join(Position, Position.symbol_id == Symbol.id)
            .filter(Position.portfolio_id == sel.id, Position.quantity > 0)
            .all()
        ):
            holdings[str(sym).upper()] = holdings.get(str(sym).upper(), 0.0) + float(qty or 0)
    else:
        holdings = portfolio_quantities(db, user.id, tracked_only=True)
    meta = _last_prices(db, sorted(holdings))
    return {
        "holdings": holdings,
        "meta": meta,
        "portfolios": [
            {"id": p.id, "name": p.name, "kind": "paper" if int(p.is_paper_trading or 0) == 1 else "tracked"}
            for p in owned
        ],
        "has_tracked": bool(tracked),
    }


@router.get("/income")
async def projected_income(
    portfolio_id: Optional[int] = Query(None, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    inputs = await asyncio.to_thread(_income_inputs, db, user, portfolio_id)
    holdings = inputs["holdings"]
    today = dc.today_et()
    histories = await dc.fetch_histories(holdings.keys()) if holdings else {}
    body = dc.project_income(holdings, histories, today)
    meta = inputs["meta"]
    market_value = 0.0
    priced = True
    for h in body["holdings"]:
        m = meta.get(h["symbol"], {})
        h["name"] = m.get("name")
        h["price"] = m.get("price")
        h["yield_pct"] = yield_pct(h["annual_per_share"], m.get("price"))
        if m.get("price"):
            market_value += m["price"] * h["shares"]
        else:
            priced = False
    total = body["total_12m"]
    body.update({
        "today": today.isoformat(),
        "portfolio_id": portfolio_id,
        "portfolios": inputs["portfolios"],
        "has_tracked_portfolio": inputs["has_tracked"],
        "holding_count": len(holdings),
        # Only when every holding has a price; a partial sum would overstate the yield.
        "portfolio_yield_pct": round(total / market_value * 100, 2)
        if total is not None and priced and market_value > 0 else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })
    return body
