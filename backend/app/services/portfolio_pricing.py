"""
Last-price lookup for portfolio valuation and simulated (paper) fills.

Uses the existing multi-provider QuoteCacheService (DB-cached snapshots, free
providers first). Read-only market data: this module never talks to a broker.
"""
from __future__ import annotations

from typing import Dict, Iterable

from sqlalchemy.orm import Session

from app.services.portfolio_ledger import Quote


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


async def fetch_quotes(db: Session, symbols: Iterable[str]) -> Dict[str, dict]:
    """Raw quote dicts keyed by upper-case symbol (unavailable ones omitted)."""
    from app.services.quote_cache import QuoteCacheService

    syms = sorted({s.upper() for s in symbols if s})
    if not syms:
        return {}
    raw = await QuoteCacheService(db).get_quotes(syms)
    out: Dict[str, dict] = {}
    for sym in syms:
        q = raw.get(sym) or {}
        if q.get("unavailable"):
            continue
        price = _num(q.get("price") or q.get("last_price") or q.get("current_price"))
        if price is None or price <= 0:
            continue
        out[sym] = {**q, "price": price}
    return out


def to_quote(q: dict | None) -> Quote:
    if not q:
        return Quote(price=None)
    return Quote(
        price=_num(q.get("price")),
        change_percent=_num(q.get("change_percent")),
        previous_close=_num(q.get("previous_close")),
    )
