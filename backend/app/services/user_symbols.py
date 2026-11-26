"""
Symbols a user follows: watchlist entries and open portfolio positions.

Sync SQLAlchemy helpers; call them from a sync route or via asyncio.to_thread.
"""
from __future__ import annotations

from typing import Dict, Set

from sqlalchemy.orm import Session


def watchlist_symbols(db: Session, user_id: int) -> Set[str]:
    from app.models.symbol import Symbol
    from app.models.watchlist import Watchlist

    rows = (
        db.query(Symbol.symbol)
        .join(Watchlist, Watchlist.symbol_id == Symbol.id)
        .filter(Watchlist.user_id == user_id)
        .all()
    )
    return {str(r[0]).upper() for r in rows if r[0]}


def portfolio_quantities(db: Session, user_id: int, *, tracked_only: bool = False) -> Dict[str, float]:
    """Open quantity per symbol, summed across the user's portfolios.

    ``positions`` is rebuilt from the transaction ledger after every write
    (app/api/portfolios.py), so it reflects current holdings.
    """
    from app.models.portfolio import Portfolio, Position
    from app.models.symbol import Symbol

    q = (
        db.query(Symbol.symbol, Position.quantity)
        .join(Position, Position.symbol_id == Symbol.id)
        .join(Portfolio, Portfolio.id == Position.portfolio_id)
        .filter(Portfolio.user_id == user_id, Position.quantity > 0)
    )
    if tracked_only:
        q = q.filter(Portfolio.is_paper_trading == 0)
    out: Dict[str, float] = {}
    for sym, qty in q.all():
        if not sym:
            continue
        s = str(sym).upper()
        out[s] = out.get(s, 0.0) + float(qty or 0.0)
    return out


def portfolio_symbols(db: Session, user_id: int) -> Set[str]:
    return set(portfolio_quantities(db, user_id))
