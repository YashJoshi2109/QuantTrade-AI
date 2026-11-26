"""
Portfolios API: holdings tracking + simulated paper trading.

All routes require auth and only ever touch the caller's own portfolios
(another user's id returns 404, never 403, so ids cannot be probed).

  GET    /api/v1/portfolios                         list with headline numbers
  POST   /api/v1/portfolios                         create {name, kind, starting_cash?}
  GET    /api/v1/portfolios/{id}                    holdings, cost basis, P&L, allocation
  PATCH  /api/v1/portfolios/{id}                    rename
  DELETE /api/v1/portfolios/{id}
  GET    /api/v1/portfolios/{id}/transactions
  POST   /api/v1/portfolios/{id}/transactions       tracked only: record a real-world trade/dividend
  DELETE /api/v1/portfolios/{id}/transactions/{tid} tracked only
  POST   /api/v1/portfolios/{id}/orders             paper only: SIMULATED market order
  POST   /api/v1/portfolios/{id}/reset              paper only: wipe trades, restore cash
  GET    /api/v1/portfolios/{id}/export?type=holdings|transactions   CSV
  GET    /api/v1/portfolios/{id}/history?range=1M|3M|YTD|1Y|ALL      equity curve vs SPY, TWR, drawdown
  POST   /api/v1/portfolios/{id}/history/backfill   rebuild daily snapshots from ledger + stored closes
  POST   /api/v1/portfolios/{id}/import/preview     tracked only: validate a trade CSV, write nothing
  POST   /api/v1/portfolios/{id}/import/commit      tracked only: validate again, then write all rows or none

Paper trading is a simulation. Orders fill instantly at the last price from
the market-data cache; the client cannot choose the fill price. Nothing in this
module (or the ledger/pricing services it uses) imports a brokerage client, and
tests/test_portfolios_api.py asserts that stays true.

Transactions are the source of truth (app.services.portfolio_ledger). After
every write the `positions` rows and paper cash balance are rebuilt from the
ledger so legacy readers of those tables stay consistent.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Literal, Optional

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.api.auth import require_auth
from app.db.database import get_db
from app.models.portfolio import Portfolio, PortfolioSnapshot, Position, Transaction, TransactionType
from app.models.symbol import Symbol
from app.models.user import User
from app.services.portfolio_ledger import (
    KIND_PAPER,
    KIND_TRACKED,
    LedgerError,
    LedgerState,
    LedgerTxn,
    first_invalid,
    replay,
    summarize,
)
from app.services import portfolio_history
from app.services.portfolio_import import ImportFormatError, dedupe_key, parse_csv
from app.services.portfolio_pricing import fetch_quotes, to_quote

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolios", tags=["portfolios"])

MAX_PORTFOLIOS_PER_USER = 10
MAX_TRANSACTIONS_PER_PORTFOLIO = 5000
DEFAULT_PAPER_CASH = 100_000.0
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
SIMULATED_NOTICE = "Simulated paper trade. No real order was placed with any broker."


# ── helpers ──────────────────────────────────────────────────────────────────

def _kind(p: Portfolio) -> str:
    return KIND_PAPER if int(p.is_paper_trading or 0) == 1 else KIND_TRACKED


def _owned(db: Session, user: User, portfolio_id: int) -> Portfolio:
    p = (
        db.query(Portfolio)
        .filter(Portfolio.id == portfolio_id, Portfolio.user_id == user.id)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


def _norm_symbol(raw: str) -> str:
    sym = (raw or "").strip().upper()
    if not SYMBOL_RE.match(sym):
        raise HTTPException(status_code=400, detail=f"Invalid symbol: {raw!r}")
    return sym


def _symbol_row(db: Session, sym: str) -> Symbol:
    row = db.query(Symbol).filter(Symbol.symbol == sym).first()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Symbol '{sym}' not found. Try syncing it first.",
        )
    return row


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ledger_rows(db: Session, portfolio_id: int):
    return (
        db.query(Transaction, Symbol.symbol)
        .join(Symbol, Symbol.id == Transaction.symbol_id)
        .filter(Transaction.portfolio_id == portfolio_id)
        .all()
    )


def _to_ledger(txn: Transaction, sym: str) -> LedgerTxn:
    ttype = txn.transaction_type.value if hasattr(txn.transaction_type, "value") else str(txn.transaction_type)
    return LedgerTxn(
        id=txn.id,
        symbol=sym,
        type=ttype,
        quantity=float(txn.quantity or 0),
        price=float(txn.price or 0),
        fees=float(txn.fees or 0),
        date=_as_utc(txn.transaction_date),
        amount=float(txn.total_amount or 0) if ttype == "DIVIDEND" else 0.0,
    )


def _replay_portfolio(p: Portfolio, txns: List[LedgerTxn]) -> LedgerState:
    paper = _kind(p) == KIND_PAPER
    return replay(
        txns,
        starting_cash=float(p.initial_cash or 0) if paper else 0.0,
        enforce_cash=paper,
    )


def _persist_derived(db: Session, p: Portfolio, state: LedgerState, symbol_ids: Dict[str, int]) -> None:
    """Rebuild positions + cash + per-sell realized P&L from the replayed ledger."""
    db.query(Position).filter(Position.portfolio_id == p.id).delete(synchronize_session=False)
    for lot in state.open_lots():
        sid = symbol_ids.get(lot.symbol)
        if sid is None:
            continue
        db.add(Position(
            portfolio_id=p.id,
            symbol_id=sid,
            quantity=lot.quantity,
            avg_cost_basis=lot.avg_cost,
        ))
    if state.sell_pnl:
        for txn in db.query(Transaction).filter(Transaction.id.in_(list(state.sell_pnl))).all():
            txn.realized_pnl = round(state.sell_pnl[txn.id], 4)
    p.cash_balance = round(state.cash, 4) if _kind(p) == KIND_PAPER else 0.0
    p.updated_at = datetime.now(timezone.utc)


def _load_quotes(db: Session, symbols: List[str]) -> Dict[str, dict]:
    """Bridge from this sync handler (worker thread) to the async quote cache."""
    if not symbols:
        return {}
    try:
        return anyio.from_thread.run(fetch_quotes, db, symbols)
    except Exception:
        logger.exception("portfolio quote fetch failed for %s", symbols[:10])
        return {}


def _build_summary(db: Session, p: Portfolio, rows=None, quotes: Optional[Dict[str, dict]] = None) -> dict:
    rows = rows if rows is not None else _ledger_rows(db, p.id)
    txns = [_to_ledger(t, s) for t, s in rows]
    try:
        state = _replay_portfolio(p, txns)
    except LedgerError as e:  # pragma: no cover - writes are validated, so only legacy rows hit this
        logger.warning("portfolio %s ledger inconsistent: %s", p.id, e)
        state = replay(txns, starting_cash=float(p.initial_cash or 0) if _kind(p) == KIND_PAPER else 0.0)
    syms = [lot.symbol for lot in state.open_lots()]
    if quotes is None:
        quotes = _load_quotes(db, syms)
    meta = {s.symbol: s for s in db.query(Symbol).filter(Symbol.symbol.in_(syms)).all()} if syms else {}
    body = summarize(
        state,
        {s: to_quote(quotes.get(s)) for s in syms},
        kind=_kind(p),
        starting_cash=float(p.initial_cash or 0),
        sectors={s: (m.sector or None) for s, m in meta.items()},
        names={s: m.name for s, m in meta.items()},
    )
    body.update({
        "id": p.id,
        "name": p.name,
        "currency": p.currency or "USD",
        "transaction_count": len(txns),
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    })
    return body


def _txn_out(t: Transaction, sym: str) -> dict:
    ttype = t.transaction_type.value if hasattr(t.transaction_type, "value") else str(t.transaction_type)
    return {
        "id": t.id,
        "symbol": sym,
        "type": ttype,
        "quantity": round(float(t.quantity or 0), 6),
        "price": round(float(t.price or 0), 4),
        "fees": round(float(t.fees or 0), 2),
        "amount": round(float(t.total_amount or 0), 2),
        "realized_pnl": None if t.realized_pnl is None else round(float(t.realized_pnl), 2),
        "notes": t.notes,
        "date": _as_utc(t.transaction_date),
    }


def _check_capacity(db: Session, p: Portfolio) -> None:
    n = db.query(Transaction).filter(Transaction.portfolio_id == p.id).count()
    if n >= MAX_TRANSACTIONS_PER_PORTFOLIO:
        raise HTTPException(status_code=409, detail="Transaction limit reached for this portfolio")


def _commit_with_ledger(db: Session, p: Portfolio, new_txn: Optional[Transaction], new_sym: Optional[str],
                        exclude_id: Optional[int] = None, affected_from: Optional[datetime] = None) -> LedgerState:
    """Validate the would-be ledger (with `new_txn` added and/or `exclude_id`
    removed), then write it and the derived rows in one commit. Nothing is
    written on LedgerError."""
    rows = [(t, s) for t, s in _ledger_rows(db, p.id) if t.id != exclude_id]
    txns = [_to_ledger(t, s) for t, s in rows]
    if new_txn is not None:
        txns.append(_to_ledger(new_txn, new_sym))
    try:
        state = _replay_portfolio(p, txns)
    except LedgerError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if new_txn is not None:
        db.add(new_txn)
        db.flush()
        # replay keyed the new SELL as id=None; re-run cheaply to capture its P&L by id
        state = _replay_portfolio(p, [_to_ledger(t, s) for t, s in rows] + [_to_ledger(new_txn, new_sym)])
    symbol_ids = {s: t.symbol_id for t, s in rows}
    if new_txn is not None:
        symbol_ids[new_sym] = new_txn.symbol_id
    if exclude_id is not None:
        db.query(Transaction).filter(
            Transaction.id == exclude_id, Transaction.portfolio_id == p.id
        ).delete(synchronize_session=False)
    _persist_derived(db, p, state, symbol_ids)
    if affected_from is not None:
        portfolio_history.invalidate_from(db, p.id, affected_from)
    db.commit()
    return state


# ── schemas ──────────────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    kind: Literal["tracked", "paper"] = "tracked"
    starting_cash: Optional[float] = Field(None, ge=1_000, le=10_000_000)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class PortfolioUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class TransactionCreate(BaseModel):
    symbol: str
    type: Literal["BUY", "SELL", "DIVIDEND"]
    quantity: float = Field(0, ge=0, le=1_000_000_000)
    price: float = Field(0, ge=0, le=10_000_000)
    amount: Optional[float] = Field(None, gt=0, le=1_000_000_000)  # DIVIDEND cash received
    fees: float = Field(0, ge=0, le=1_000_000)
    trade_date: date
    notes: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def _check(self):
        if self.type in ("BUY", "SELL"):
            if self.quantity <= 0 or self.price <= 0:
                raise ValueError("quantity and price must be greater than 0")
        elif not self.amount:
            raise ValueError("amount is required for a dividend")
        if self.trade_date > (datetime.now(timezone.utc) + timedelta(days=1)).date():
            raise ValueError("trade_date cannot be in the future")
        if self.trade_date < date(1970, 1, 1):
            raise ValueError("trade_date is too far in the past")
        return self


class OrderCreate(BaseModel):
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: float = Field(..., gt=0, le=1_000_000)


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("")
def list_portfolios(db: Session = Depends(get_db), user: User = Depends(require_auth)):
    ports = db.query(Portfolio).filter(Portfolio.user_id == user.id).order_by(Portfolio.id).all()
    rows_by = {p.id: _ledger_rows(db, p.id) for p in ports}
    all_syms = sorted({s for rows in rows_by.values() for _, s in rows})
    quotes = _load_quotes(db, all_syms)
    out = []
    for p in ports:
        s = _build_summary(db, p, rows=rows_by[p.id], quotes=quotes)
        s["holding_count"] = len(s.pop("holdings"))
        s.pop("allocation", None)
        out.append(s)
    return {"portfolios": out, "limit": MAX_PORTFOLIOS_PER_USER}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_portfolio(body: PortfolioCreate, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    if db.query(Portfolio).filter(Portfolio.user_id == user.id).count() >= MAX_PORTFOLIOS_PER_USER:
        raise HTTPException(status_code=409, detail=f"You can have at most {MAX_PORTFOLIOS_PER_USER} portfolios")
    paper = body.kind == KIND_PAPER
    cash = float(body.starting_cash or DEFAULT_PAPER_CASH) if paper else 0.0
    p = Portfolio(
        user_id=user.id,
        name=body.name,
        description="Simulated paper-trading account" if paper else None,
        initial_cash=cash,
        cash_balance=cash,
        currency="USD",
        is_paper_trading=1 if paper else 0,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _build_summary(db, p, rows=[], quotes={})


@router.get("/{portfolio_id}")
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    return _build_summary(db, _owned(db, user, portfolio_id))


@router.patch("/{portfolio_id}")
def rename_portfolio(portfolio_id: int, body: PortfolioUpdate, db: Session = Depends(get_db),
                     user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    p.name = body.name
    db.commit()
    return {"id": p.id, "name": p.name}


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    db.query(Transaction).filter(Transaction.portfolio_id == p.id).delete(synchronize_session=False)
    db.query(Position).filter(Position.portfolio_id == p.id).delete(synchronize_session=False)
    db.query(PortfolioSnapshot).filter(PortfolioSnapshot.portfolio_id == p.id).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{portfolio_id}/transactions")
def list_transactions(portfolio_id: int, limit: int = Query(500, ge=1, le=MAX_TRANSACTIONS_PER_PORTFOLIO),
                      db: Session = Depends(get_db), user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    rows = (
        db.query(Transaction, Symbol.symbol)
        .join(Symbol, Symbol.id == Transaction.symbol_id)
        .filter(Transaction.portfolio_id == p.id)
        .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
        .limit(limit)
        .all()
    )
    return {"transactions": [_txn_out(t, s) for t, s in rows], "simulated": _kind(p) == KIND_PAPER}


@router.post("/{portfolio_id}/transactions", status_code=status.HTTP_201_CREATED)
def add_transaction(portfolio_id: int, body: TransactionCreate, db: Session = Depends(get_db),
                    user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    if _kind(p) == KIND_PAPER:
        raise HTTPException(
            status_code=400,
            detail="Paper portfolios only accept simulated orders at the live price (POST /orders)",
        )
    _check_capacity(db, p)
    sym = _norm_symbol(body.symbol)
    srow = _symbol_row(db, sym)
    when = datetime.combine(body.trade_date, time(21, 0), tzinfo=timezone.utc)  # ~US close
    if body.type == "DIVIDEND":
        qty, price, amount = 0.0, 0.0, float(body.amount)
    else:
        qty, price = round(body.quantity, 6), float(body.price)
        amount = qty * price + body.fees if body.type == "BUY" else qty * price - body.fees
    txn = Transaction(
        portfolio_id=p.id,
        symbol_id=srow.id,
        transaction_type=TransactionType[body.type],
        quantity=qty,
        price=price,
        fees=float(body.fees),
        total_amount=round(amount, 4),
        notes=(body.notes or "").strip() or None,
        transaction_date=when,
    )
    _commit_with_ledger(db, p, txn, sym, affected_from=when)
    db.refresh(txn)
    return _txn_out(txn, sym)


@router.delete("/{portfolio_id}/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(portfolio_id: int, txn_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    if _kind(p) == KIND_PAPER:
        raise HTTPException(status_code=400, detail="Paper trades cannot be edited; reset the portfolio instead")
    txn = db.query(Transaction).filter(Transaction.id == txn_id, Transaction.portfolio_id == p.id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    try:
        _commit_with_ledger(db, p, None, None, exclude_id=txn.id, affected_from=_as_utc(txn.transaction_date))
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=409, detail=f"Deleting this would break later trades: {e.detail}")
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{portfolio_id}/orders", status_code=status.HTTP_201_CREATED)
def place_paper_order(portfolio_id: int, body: OrderCreate, db: Session = Depends(get_db),
                      user: User = Depends(require_auth)):
    """SIMULATED market order. Fills at the server-side last price; never routed to a broker."""
    p = _owned(db, user, portfolio_id)
    if _kind(p) != KIND_PAPER:
        raise HTTPException(status_code=400, detail="Orders are only available on paper (simulated) portfolios")
    _check_capacity(db, p)
    sym = _norm_symbol(body.symbol)
    srow = _symbol_row(db, sym)
    q = _load_quotes(db, [sym]).get(sym)
    if not q or not q.get("price"):
        raise HTTPException(status_code=503, detail=f"No live price for {sym} right now. Try again shortly.")
    price = float(q["price"])
    qty = round(body.quantity, 6)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="quantity must be greater than 0")
    gross = qty * price
    txn = Transaction(
        portfolio_id=p.id,
        symbol_id=srow.id,
        transaction_type=TransactionType[body.side],
        quantity=qty,
        price=price,
        fees=0.0,
        total_amount=round(gross, 4),
        notes="Simulated paper order",
        transaction_date=datetime.now(timezone.utc),
    )
    state = _commit_with_ledger(db, p, txn, sym, affected_from=txn.transaction_date)
    db.refresh(txn)
    return {
        "simulated": True,
        "notice": SIMULATED_NOTICE,
        "order": {
            **_txn_out(txn, sym),
            "status": "filled",
            "fill_price": round(price, 4),
            "quote_source": q.get("data_source"),
            "quote_time": q.get("market_time") or q.get("timestamp"),
        },
        "cash": round(state.cash, 2),
    }


@router.post("/{portfolio_id}/reset")
def reset_paper_portfolio(portfolio_id: int, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    if _kind(p) != KIND_PAPER:
        raise HTTPException(status_code=400, detail="Only paper portfolios can be reset")
    db.query(Transaction).filter(Transaction.portfolio_id == p.id).delete(synchronize_session=False)
    db.query(Position).filter(Position.portfolio_id == p.id).delete(synchronize_session=False)
    p.cash_balance = float(p.initial_cash or 0)
    portfolio_history.invalidate_from(db, p.id, None)
    db.commit()
    return _build_summary(db, p, rows=[], quotes={})


_CSV_DANGEROUS = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(v) -> str:
    """Neutralise spreadsheet formula injection in user-supplied text cells."""
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return f"{v}"
    s = str(v)
    return "'" + s if s.startswith(_CSV_DANGEROUS) else s


@router.get("/{portfolio_id}/export")
def export_portfolio(portfolio_id: int, type: Literal["holdings", "transactions"] = "holdings",
                     db: Session = Depends(get_db), user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    if type == "holdings":
        s = _build_summary(db, p)
        cols = ["symbol", "name", "sector", "quantity", "avg_cost", "cost_basis", "price",
                "market_value", "unrealized_pnl", "unrealized_pnl_percent", "day_change",
                "weight", "realized_pnl", "dividends"]
        w.writerow(cols)
        for h in s["holdings"]:
            w.writerow([_csv_cell(h.get(c)) for c in cols])
        if s["simulated"]:
            w.writerow(["CASH", "", "Cash", "", "", "", "", s["cash"], "", "", "", "", "", ""])
    else:
        rows = (
            db.query(Transaction, Symbol.symbol)
            .join(Symbol, Symbol.id == Transaction.symbol_id)
            .filter(Transaction.portfolio_id == p.id)
            .order_by(Transaction.transaction_date.asc(), Transaction.id.asc())
            .all()
        )
        cols = ["date", "symbol", "type", "quantity", "price", "fees", "amount", "realized_pnl", "notes"]
        w.writerow(cols)
        for t, sym in rows:
            o = _txn_out(t, sym)
            o["date"] = o["date"].date().isoformat()
            w.writerow([_csv_cell(o.get(c)) for c in cols])
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", p.name).strip("_")[:40] or "portfolio"
    fname = f"{safe_name}_{type}_{date.today().isoformat()}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"', "Cache-Control": "no-store"},
    )


# ── performance history ──────────────────────────────────────────────────────

@router.get("/{portfolio_id}/history")
def portfolio_history_route(portfolio_id: int, range: Literal["1M", "3M", "YTD", "1Y", "ALL"] = "1Y",
                            db: Session = Depends(get_db), user: User = Depends(require_auth)):
    """Equity curve vs SPY (both as % from the range start), time-weighted return
    and max drawdown. Built from daily snapshots; missing or stale snapshots are
    rebuilt from the ledger and the daily closes already stored (no provider calls)."""
    p = _owned(db, user, portfolio_id)
    return portfolio_history.history(db, p, range)


@router.post("/{portfolio_id}/history/backfill")
def backfill_history(portfolio_id: int, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    return {"portfolio_id": p.id, **portfolio_history.backfill_portfolio(db, p)}


# ── CSV trade import (tracked portfolios) ────────────────────────────────────

IMPORT_ID_BASE = 10 ** 12  # temporary ledger ids for file rows: sort after saved rows, map back to lines


class ImportBody(BaseModel):
    csv: str = Field(..., min_length=1, max_length=600_000)


def _import_plan(db: Session, p: Portfolio, text: str) -> dict:
    """Parse + validate a CSV against the symbols table and the full ledger."""
    if _kind(p) == KIND_PAPER:
        raise HTTPException(status_code=400,
                            detail="CSV import is only for tracked portfolios; paper trades are simulated orders")
    try:
        rows = parse_csv(text)
    except ImportFormatError as e:
        raise HTTPException(status_code=400, detail=str(e))

    syms = sorted({r.symbol for r in rows if r.symbol})
    known = {s.symbol: s.id for s in db.query(Symbol).filter(Symbol.symbol.in_(syms)).all()} if syms else {}
    existing = _ledger_rows(db, p.id)
    seen = set()
    for t, s in existing:
        lt = _to_ledger(t, s)
        seen.add(dedupe_key(lt.date.date().isoformat(), s, lt.type, lt.quantity, lt.price, lt.amount))
    for r in rows:
        if r.symbol and r.symbol not in known and not any("symbol" in e for e in r.errors):
            r.errors.append(f"unknown symbol {r.symbol} (add it once with Add transaction, then import)")
        if r.ok:
            k = dedupe_key(r.date, r.symbol, r.type, r.quantity, r.price, r.amount)
            if k in seen:
                r.warnings.append("looks like a duplicate of a transaction already in this portfolio or file")
            seen.add(k)

    if len(existing) + len(rows) > MAX_TRANSACTIONS_PER_PORTFOLIO:
        raise HTTPException(status_code=409,
                            detail=f"Import would exceed {MAX_TRANSACTIONS_PER_PORTFOLIO} transactions for this portfolio")

    ledger_error = None
    ok_rows = [r for r in rows if r.ok]
    if ok_rows:
        # Same replay validation as a single transaction, over the whole
        # would-be ledger oldest first, so a sell before its buy is caught.
        # Rows that already failed are left out, so every problem shows at once.
        txns = [_to_ledger(t, s) for t, s in existing] + [
            LedgerTxn(id=IMPORT_ID_BASE + r.row, symbol=r.symbol, type=r.type,
                      quantity=float(r.quantity or 0), price=float(r.price or 0), fees=float(r.fees or 0),
                      date=datetime.combine(date.fromisoformat(r.date), time(21, 0), tzinfo=timezone.utc),
                      amount=float(r.amount or 0) if r.type == "DIVIDEND" else 0.0)
            for r in ok_rows
        ]
        bad = first_invalid(txns)
        if bad is not None:
            t, msg = bad
            if t.id is not None and t.id >= IMPORT_ID_BASE:
                next(r for r in rows if r.row == t.id - IMPORT_ID_BASE).errors.append(msg)
            else:
                ledger_error = f"An existing transaction would break: {msg}"

    errors = sum(1 for r in rows if not r.ok)
    return {
        "rows": rows,
        "known": known,
        "summary": {
            "total": len(rows),
            "valid": len(rows) - errors,
            "errors": errors,
            "warnings": sum(1 for r in rows if r.warnings),
            "buys": sum(1 for r in rows if r.type == "BUY"),
            "sells": sum(1 for r in rows if r.type == "SELL"),
            "dividends": sum(1 for r in rows if r.type == "DIVIDEND"),
            "symbols": syms,
        },
        "ledger_error": ledger_error,
        "can_commit": errors == 0 and ledger_error is None,
    }


def _plan_out(plan: dict) -> dict:
    return {
        "rows": [r.out() for r in plan["rows"]],
        "summary": plan["summary"],
        "ledger_error": plan["ledger_error"],
        "can_commit": plan["can_commit"],
    }


@router.post("/{portfolio_id}/import/preview")
def import_preview(portfolio_id: int, body: ImportBody, db: Session = Depends(get_db),
                   user: User = Depends(require_auth)):
    p = _owned(db, user, portfolio_id)
    return _plan_out(_import_plan(db, p, body.csv))


@router.post("/{portfolio_id}/import/commit", status_code=status.HTTP_201_CREATED)
def import_commit(portfolio_id: int, body: ImportBody, db: Session = Depends(get_db),
                  user: User = Depends(require_auth)):
    """All-or-nothing: any invalid row (or oversell) rejects the whole file."""
    p = _owned(db, user, portfolio_id)
    plan = _import_plan(db, p, body.csv)
    if not plan["can_commit"]:
        raise HTTPException(status_code=400, detail={"message": "Fix the rows marked as errors and try again",
                                                     **_plan_out(plan)})
    known = plan["known"]
    new: List[Transaction] = []
    for r in plan["rows"]:
        when = datetime.combine(date.fromisoformat(r.date), time(21, 0), tzinfo=timezone.utc)
        if r.type == "DIVIDEND":
            qty, price, amount = 0.0, 0.0, float(r.amount)
        else:
            qty, price = float(r.quantity), float(r.price)
            amount = qty * price + r.fees if r.type == "BUY" else qty * price - r.fees
        txn = Transaction(
            portfolio_id=p.id,
            symbol_id=known[r.symbol],
            transaction_type=TransactionType[r.type],
            quantity=qty,
            price=price,
            fees=float(r.fees or 0),
            total_amount=round(amount, 4),
            notes=r.notes or "Imported from CSV",
            transaction_date=when,
        )
        db.add(txn)
        new.append(txn)
    db.flush()
    rows = _ledger_rows(db, p.id)
    try:
        state = _replay_portfolio(p, [_to_ledger(t, s) for t, s in rows])
    except LedgerError as e:  # pragma: no cover - the plan already replayed this exact ledger
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    _persist_derived(db, p, state, {s: t.symbol_id for t, s in rows})
    portfolio_history.invalidate_from(db, p.id, min(t.transaction_date for t in new))
    db.commit()
    return {"imported": len(new), "summary": plan["summary"]}
