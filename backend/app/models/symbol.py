"""
Symbol model for storing stock symbols and metadata

Implementation Notes:
- Supports universal search by symbol, name, exchange
- Fields: symbol, name, exchange, type, currency, country, sector, industry
- Indexed for fast prefix/substring search
"""
from sqlalchemy import Boolean, Column, Date, String, DateTime, Float, Integer, Index, true
from sqlalchemy.sql import func
from app.db.database import Base


class Symbol(Base):
    __tablename__ = "symbols"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(10), unique=True, index=True, nullable=False)
    name = Column(String(255), index=True)
    exchange = Column(String(50))  # NASDAQ, NYSE, etc.
    asset_type = Column(String(50), default='Equity')  # Equity, ETF, ADR, etc.
    currency = Column(String(10), default='USD')
    country = Column(String(50), default='US')
    sector = Column(String(100))
    industry = Column(String(100))
    market_cap = Column(Float)
    # Lifecycle (app.services.ticker_lifecycle). Retired symbols are never
    # deleted: watchlists, portfolios and history reference them. NULL is
    # treated as active (rows created before the columns existed).
    is_active = Column(Boolean, nullable=True, default=True, server_default=true())
    delisted_at = Column(Date, nullable=True)
    successor_symbol = Column(String(10), nullable=True)
    status_note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Composite index for search optimization
    __table_args__ = (
        Index('ix_symbol_name_search', 'symbol', 'name'),
    )


LIFECYCLE_COLUMNS = (
    ("is_active", "BOOLEAN DEFAULT TRUE"),
    ("delisted_at", "DATE"),
    ("successor_symbol", "VARCHAR(10)"),
    ("status_note", "VARCHAR(500)"),
)


def ensure_symbol_lifecycle_columns(engine) -> list:
    """Idempotently add the lifecycle columns to an existing ``symbols`` table.

    create_all() never alters an existing table. Called on startup and by
    scripts/add_symbol_lifecycle_columns.py (deploy). Returns the columns added.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if not insp.has_table("symbols"):
        return []
    have = {c["name"] for c in insp.get_columns("symbols")}
    added = []
    pg = engine.dialect.name == "postgresql"
    with engine.begin() as conn:
        for name, ddl in LIFECYCLE_COLUMNS:
            if name in have:
                continue
            if_not = "IF NOT EXISTS " if pg else ""
            conn.execute(text(f"ALTER TABLE symbols ADD COLUMN {if_not}{name} {ddl}"))
            added.append(name)
    return added
