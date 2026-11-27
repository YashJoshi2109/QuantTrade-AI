"""
Marketwatch: multiple named, ordered watchlists per user (Kite-style).

  marketwatch_lists  one row per named list ("Watchlist 1", "Tech", ...), ordered by `position`
  marketwatch_items  one row per (list, symbol), ordered by `position` inside the list

The same symbol may sit in several lists. The user's default list (is_default)
mirrors the classic single watchlist (`watchlists` table, app.api.watchlist), so
the "add to watchlist" buttons elsewhere in the app keep landing in list 1; see
app.services.marketwatch for the mirror rules.

Created by Base.metadata.create_all on startup and by
scripts/create_marketwatch_tables.py (deploy). Holdings are never stored here:
the "Holdings" list is computed from the user's portfolios at read time.
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from app.db.database import Base


class MarketwatchList(Base):
    __tablename__ = "marketwatch_lists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(40), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_marketwatch_list_user_name"),
    )


class MarketwatchItem(Base):
    __tablename__ = "marketwatch_items"

    id = Column(Integer, primary_key=True, index=True)
    list_id = Column(Integer, ForeignKey("marketwatch_lists.id", ondelete="CASCADE"), nullable=False)
    symbol = Column(String(12), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("list_id", "symbol", name="uq_marketwatch_item_list_symbol"),
        Index("ix_marketwatch_items_list_position", "list_id", "position"),
    )
