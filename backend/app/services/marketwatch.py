"""
Marketwatch storage rules (multiple named watchlists, app.models.marketwatch).

Default list <-> classic watchlist mirror
----------------------------------------
Other pages (Research, Copilot, the dashboard) add to the classic single
watchlist (`watchlists` table via /api/v1/watchlist). The user's default
marketwatch list is that same list:

* first read: the default list "Watchlist 1" is created and seeded from the
  classic rows (newest first, the order the old page showed them);
* every read: classic symbols missing from the default list are appended, so a
  classic add that happened while the mirror was unavailable still shows up;
* classic add / remove also write the default list (mirror_classic_*);
* marketwatch add / remove on the default list also write the classic table.

Removals are only ever mirrored by an explicit delete, never inferred, so a
symbol cannot silently come back or vanish.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.marketwatch import MarketwatchItem, MarketwatchList
from app.models.symbol import Symbol
from app.models.watchlist import Watchlist

logger = logging.getLogger(__name__)

DEFAULT_LIST_NAME = "Watchlist 1"
MAX_LISTS_PER_USER = 10
MAX_ITEMS_PER_LIST = 100


def user_lists(db: Session, user_id: int) -> List[MarketwatchList]:
    return (
        db.query(MarketwatchList)
        .filter(MarketwatchList.user_id == user_id)
        .order_by(MarketwatchList.position, MarketwatchList.id)
        .all()
    )


def default_list(db: Session, user_id: int) -> Optional[MarketwatchList]:
    return (
        db.query(MarketwatchList)
        .filter(MarketwatchList.user_id == user_id, MarketwatchList.is_default.is_(True))
        .first()
    )


def _classic_symbols(db: Session, user_id: int) -> List[str]:
    rows = (
        db.query(Symbol.symbol)
        .join(Watchlist, Watchlist.symbol_id == Symbol.id)
        .filter(Watchlist.user_id == user_id)
        .order_by(Watchlist.created_at.desc(), Watchlist.id.desc())
        .all()
    )
    return [r[0].upper() for r in rows if r[0]]


def next_item_position(db: Session, list_id: int) -> int:
    cur = db.query(func.max(MarketwatchItem.position)).filter(MarketwatchItem.list_id == list_id).scalar()
    return 0 if cur is None else int(cur) + 1


def list_symbols(db: Session, list_id: int) -> List[str]:
    rows = (
        db.query(MarketwatchItem.symbol)
        .filter(MarketwatchItem.list_id == list_id)
        .order_by(MarketwatchItem.position, MarketwatchItem.id)
        .all()
    )
    return [r[0] for r in rows]


def ensure_lists(db: Session, user_id: int) -> List[MarketwatchList]:
    """The user's lists, creating/syncing the default list from the classic watchlist."""
    classic = _classic_symbols(db, user_id)
    lists = user_lists(db, user_id)
    default = next((l for l in lists if l.is_default), None)
    changed = False
    if default is None:
        default = MarketwatchList(
            user_id=user_id,
            name=DEFAULT_LIST_NAME if all(l.name != DEFAULT_LIST_NAME for l in lists) else f"{DEFAULT_LIST_NAME} (default)",
            position=-1 if lists else 0,
            is_default=True,
        )
        db.add(default)
        db.flush()
        changed = True
    have = set(list_symbols(db, default.id))
    pos = next_item_position(db, default.id)
    for sym in classic:
        if sym in have or len(have) >= MAX_ITEMS_PER_LIST:
            continue
        db.add(MarketwatchItem(list_id=default.id, symbol=sym, position=pos))
        have.add(sym)
        pos += 1
        changed = True
    if changed:
        try:
            db.commit()
        except IntegrityError:
            # Two first reads raced (e.g. desktop + mobile tabs): the other one
            # created the default list / items. Its rows are authoritative.
            db.rollback()
        lists = user_lists(db, user_id)
    return lists


# ── classic -> default list ─────────────────────────────────────────────────

def mirror_classic_add(db: Session, user_id: int, symbol: str) -> None:
    """Best effort: called after a classic /watchlist add has committed."""
    try:
        d = default_list(db, user_id)
        if d is None:
            return  # seeded from the classic table on first marketwatch read
        sym = symbol.upper()
        exists = db.query(MarketwatchItem.id).filter(
            MarketwatchItem.list_id == d.id, MarketwatchItem.symbol == sym
        ).first()
        n = db.query(func.count(MarketwatchItem.id)).filter(MarketwatchItem.list_id == d.id).scalar() or 0
        if exists or n >= MAX_ITEMS_PER_LIST:
            return
        db.add(MarketwatchItem(list_id=d.id, symbol=sym, position=next_item_position(db, d.id)))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("marketwatch mirror (add %s) failed", symbol)


def mirror_classic_remove(db: Session, user_id: int, symbol: str) -> None:
    try:
        d = default_list(db, user_id)
        if d is None:
            return
        db.query(MarketwatchItem).filter(
            MarketwatchItem.list_id == d.id, MarketwatchItem.symbol == symbol.upper()
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("marketwatch mirror (remove %s) failed", symbol)


# ── default list -> classic ─────────────────────────────────────────────────

def classic_add(db: Session, user_id: int, symbol_id: int) -> None:
    """Add to the classic table inside the caller's transaction (no commit)."""
    exists = db.query(Watchlist.id).filter(Watchlist.user_id == user_id, Watchlist.symbol_id == symbol_id).first()
    if not exists:
        db.add(Watchlist(user_id=user_id, symbol_id=symbol_id, source="marketwatch"))


def classic_remove(db: Session, user_id: int, symbol: str) -> None:
    sym_row = db.query(Symbol.id).filter(Symbol.symbol == symbol.upper()).first()
    if sym_row:
        db.query(Watchlist).filter(
            Watchlist.user_id == user_id, Watchlist.symbol_id == sym_row[0]
        ).delete(synchronize_session=False)
