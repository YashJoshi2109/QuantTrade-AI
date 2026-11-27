"""
Marketwatch API: multiple named watchlists (Kite-style) + a computed Holdings list.
Auth required; users only ever see their own lists (another user's id is a 404).

  GET    /api/v1/marketwatch                               lists with their ordered symbols
  POST   /api/v1/marketwatch/lists                         create {name}
  PATCH  /api/v1/marketwatch/lists/{id}                    rename {name}
  DELETE /api/v1/marketwatch/lists/{id}                    (not the default list)
  PUT    /api/v1/marketwatch/lists/order                   {ids: [...]} full permutation
  POST   /api/v1/marketwatch/lists/{id}/items              add {symbol}
  DELETE /api/v1/marketwatch/lists/{id}/items/{symbol}
  PUT    /api/v1/marketwatch/lists/{id}/items/order        {symbols: [...]} full permutation
  GET    /api/v1/marketwatch/holdings                      every open holding across the user's portfolios
  GET    /api/v1/marketwatch/sparklines?symbols=A,B         recent stored daily closes (row sparklines)

Prices are not stored or returned by the list routes: the UI reads them from the
canonical batch quote (/api/v1/quotes, QuoteCacheService), the same cache the
Holdings route, the Portfolio page and price alerts use, so P&L agrees everywhere.

Read-only market data. Nothing here places, routes or simulates an order.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import require_auth
from app.db.database import get_db
from app.models.marketwatch import MarketwatchItem, MarketwatchList
from app.models.symbol import Symbol
from app.models.user import User
from app.services import marketwatch as mw

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/marketwatch", tags=["marketwatch"])

SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


def _norm_symbol(raw: str) -> str:
    s = (raw or "").strip().upper()
    if not SYMBOL_RE.match(s):
        raise HTTPException(status_code=400, detail=f"Invalid symbol '{raw}'")
    return s


class ListName(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join((v or "").split())
        if not v:
            raise ValueError("name is required")
        return v


class ItemAdd(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=12)


class ListOrder(BaseModel):
    ids: List[int] = Field(..., max_length=mw.MAX_LISTS_PER_USER)


class ItemOrder(BaseModel):
    symbols: List[str] = Field(..., max_length=mw.MAX_ITEMS_PER_LIST)


def _owned(db: Session, user: User, list_id: int) -> MarketwatchList:
    row = db.query(MarketwatchList).filter(
        MarketwatchList.id == list_id, MarketwatchList.user_id == user.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return row


def _list_out(lst: MarketwatchList, items: List[MarketwatchItem], names: Dict[str, dict]) -> dict:
    return {
        "id": lst.id,
        "name": lst.name,
        "position": lst.position,
        "is_default": bool(lst.is_default),
        "items": [
            {
                "symbol": it.symbol,
                "name": (names.get(it.symbol) or {}).get("name"),
                "exchange": (names.get(it.symbol) or {}).get("exchange"),
                "position": it.position,
            }
            for it in items
        ],
    }


def _payload(db: Session, lists: List[MarketwatchList]) -> dict:
    ids = [l.id for l in lists]
    items = (
        db.query(MarketwatchItem)
        .filter(MarketwatchItem.list_id.in_(ids))
        .order_by(MarketwatchItem.position, MarketwatchItem.id)
        .all()
        if ids
        else []
    )
    by_list: Dict[int, List[MarketwatchItem]] = {i: [] for i in ids}
    for it in items:
        by_list[it.list_id].append(it)
    syms = sorted({it.symbol for it in items})
    names = {
        s.symbol: {"name": s.name, "exchange": getattr(s, "exchange", None)}
        for s in (db.query(Symbol).filter(Symbol.symbol.in_(syms)).all() if syms else [])
    }
    return {
        "lists": [_list_out(l, by_list[l.id], names) for l in lists],
        "limits": {"lists": mw.MAX_LISTS_PER_USER, "items_per_list": mw.MAX_ITEMS_PER_LIST},
    }


# ── lists ────────────────────────────────────────────────────────────────────

@router.get("")
def get_marketwatch(db: Session = Depends(get_db), user: User = Depends(require_auth)):
    return _payload(db, mw.ensure_lists(db, user.id))


@router.post("/lists", status_code=status.HTTP_201_CREATED)
def create_list(body: ListName, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    lists = mw.ensure_lists(db, user.id)
    if len(lists) >= mw.MAX_LISTS_PER_USER:
        raise HTTPException(status_code=409, detail=f"You can have up to {mw.MAX_LISTS_PER_USER} watchlists")
    if any(l.name.lower() == body.name.lower() for l in lists):
        raise HTTPException(status_code=409, detail=f"A watchlist named '{body.name}' already exists")
    row = MarketwatchList(
        user_id=user.id, name=body.name, is_default=False,
        position=(max(l.position for l in lists) + 1) if lists else 0,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"A watchlist named '{body.name}' already exists")
    db.refresh(row)
    return _list_out(row, [], {})


@router.put("/lists/order")
def reorder_lists(body: ListOrder, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    lists = mw.user_lists(db, user.id)
    if sorted(body.ids) != sorted(l.id for l in lists) or len(set(body.ids)) != len(body.ids):
        raise HTTPException(status_code=400, detail="ids must list each of your watchlists exactly once")
    by_id = {l.id: l for l in lists}
    for pos, lid in enumerate(body.ids):
        by_id[lid].position = pos
    db.commit()
    return _payload(db, mw.user_lists(db, user.id))


@router.patch("/lists/{list_id}")
def rename_list(list_id: int, body: ListName, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    row = _owned(db, user, list_id)
    clash = db.query(MarketwatchList.id).filter(
        MarketwatchList.user_id == user.id, MarketwatchList.id != row.id,
        func.lower(MarketwatchList.name) == body.name.lower(),
    ).first()
    if clash:
        raise HTTPException(status_code=409, detail=f"A watchlist named '{body.name}' already exists")
    row.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"A watchlist named '{body.name}' already exists")
    return {"id": row.id, "name": row.name}


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_list(list_id: int, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    row = _owned(db, user, list_id)
    if row.is_default:
        raise HTTPException(status_code=400, detail="The default watchlist cannot be deleted; rename it or clear it instead")
    db.query(MarketwatchItem).filter(MarketwatchItem.list_id == row.id).delete(synchronize_session=False)
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── items ────────────────────────────────────────────────────────────────────

@router.post("/lists/{list_id}/items", status_code=status.HTTP_201_CREATED)
def add_item(list_id: int, body: ItemAdd, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    row = _owned(db, user, list_id)
    sym = _norm_symbol(body.symbol)
    db_sym = db.query(Symbol).filter(Symbol.symbol == sym).first()
    if not db_sym:
        raise HTTPException(status_code=404, detail=f"Symbol '{sym}' not found. Try syncing it first.")
    if db.query(MarketwatchItem.id).filter(MarketwatchItem.list_id == row.id, MarketwatchItem.symbol == sym).first():
        raise HTTPException(status_code=409, detail=f"{sym} is already in {row.name}")
    n = db.query(MarketwatchItem).filter(MarketwatchItem.list_id == row.id).count()
    if n >= mw.MAX_ITEMS_PER_LIST:
        raise HTTPException(status_code=409, detail=f"{row.name} is full ({mw.MAX_ITEMS_PER_LIST} symbols)")
    item = MarketwatchItem(list_id=row.id, symbol=sym, position=mw.next_item_position(db, row.id))
    db.add(item)
    if row.is_default:
        mw.classic_add(db, user.id, db_sym.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"{sym} is already in {row.name}")
    return {
        "list_id": row.id,
        "symbol": sym,
        "name": db_sym.name,
        "exchange": getattr(db_sym, "exchange", None),
        "position": item.position,
    }


@router.delete("/lists/{list_id}/items/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(list_id: int, symbol: str, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    row = _owned(db, user, list_id)
    sym = _norm_symbol(symbol)
    n = db.query(MarketwatchItem).filter(
        MarketwatchItem.list_id == row.id, MarketwatchItem.symbol == sym
    ).delete(synchronize_session=False)
    if not n:
        raise HTTPException(status_code=404, detail=f"{sym} is not in {row.name}")
    if row.is_default:
        mw.classic_remove(db, user.id, sym)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/lists/{list_id}/items/order")
def reorder_items(list_id: int, body: ItemOrder, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    row = _owned(db, user, list_id)
    want = [s.strip().upper() for s in body.symbols]
    items = db.query(MarketwatchItem).filter(MarketwatchItem.list_id == row.id).all()
    if sorted(want) != sorted(i.symbol for i in items) or len(set(want)) != len(want):
        raise HTTPException(status_code=400, detail="symbols must list each symbol in the watchlist exactly once")
    by_sym = {i.symbol: i for i in items}
    for pos, s in enumerate(want):
        by_sym[s].position = pos
    db.commit()
    return {"id": row.id, "symbols": want}


# ── sparklines (stored daily closes only; no provider call) ─────────────────

SPARK_MAX_SYMBOLS = 50
SPARK_POINTS = 30


@router.get("/sparklines")
def sparklines(symbols: str = "", db: Session = Depends(get_db), user: User = Depends(require_auth)):
    """Last ~30 stored daily closes per symbol, oldest first, for the mobile row sparklines.

    Reads price_bars only (cheap, no provider fan-out). A symbol with fewer than
    two stored bars returns an empty list and the row shows no line.
    """
    from app.models.price import PriceBar

    want: List[str] = []
    for raw in symbols.split(","):
        s = raw.strip().upper()
        if s and SYMBOL_RE.match(s) and s not in want:
            want.append(s)
    if len(want) > SPARK_MAX_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"At most {SPARK_MAX_SYMBOLS} symbols per request")
    out: Dict[str, List[float]] = {s: [] for s in want}
    if not want:
        return {"sparklines": out}
    ids = {r.id: r.symbol for r in db.query(Symbol.id, Symbol.symbol).filter(Symbol.symbol.in_(want)).all()}
    for sid, sym in ids.items():
        rows = (
            db.query(PriceBar.close)
            .filter(PriceBar.symbol_id == sid)
            .order_by(PriceBar.timestamp.desc())
            .limit(SPARK_POINTS)
            .all()
        )
        closes = [float(r[0]) for r in reversed(rows) if r[0] is not None and r[0] > 0]
        out[sym.upper()] = closes if len(closes) >= 2 else []
    return {"sparklines": out}


# ── holdings (computed from portfolios, never stored here) ───────────────────

@router.get("/holdings")
def holdings(db: Session = Depends(get_db), user: User = Depends(require_auth)):
    """Open holdings across every portfolio, valued by the Portfolio page's own code.

    Each row is one (portfolio, symbol) position, so a tracked account and a
    simulated paper account are never blended into one made-up average.
    """
    from app.api import portfolios as papi
    from app.models.portfolio import Portfolio

    ports = (
        db.query(Portfolio).filter(Portfolio.user_id == user.id)
        .order_by(Portfolio.created_at, Portfolio.id).all()
    )
    rows_by_port = {p.id: papi._ledger_rows(db, p.id) for p in ports}
    # One quote fetch for every held symbol, shared by every portfolio summary.
    syms = sorted({s for rows in rows_by_port.values() for _, s in rows})
    quotes = papi._load_quotes(db, syms)
    out_rows: List[dict] = []
    out_ports: List[dict] = []
    stale: set = set()
    for p in ports:
        summary = papi._build_summary(db, p, rows=rows_by_port[p.id], quotes=quotes)
        stale.update(summary.get("stale_quotes") or [])
        out_ports.append({
            "id": p.id,
            "name": p.name,
            "kind": summary.get("kind"),
            "simulated": bool(summary.get("simulated")),
            "market_value": summary.get("market_value"),
            "cost_basis": summary.get("cost_basis"),
            "unrealized_pnl": summary.get("unrealized_pnl"),
            "day_change": summary.get("day_change"),
            "holding_count": len(summary.get("holdings") or []),
        })
        for h in summary.get("holdings") or []:
            out_rows.append({
                **{k: h.get(k) for k in (
                    "symbol", "name", "quantity", "avg_cost", "cost_basis", "price", "change_percent",
                    "market_value", "unrealized_pnl", "unrealized_pnl_percent", "day_change",
                )},
                "portfolio_id": p.id,
                "portfolio_name": p.name,
                "simulated": bool(summary.get("simulated")),
            })
    return {"holdings": out_rows, "portfolios": out_ports, "stale_quotes": sorted(stale)}
