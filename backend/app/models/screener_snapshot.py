"""
One denormalised row per symbol for the stock screener (/api/v1/screener).

Built by app.services.screener_service.rebuild_snapshot from data already in the
DB: symbols, fundamentals (unit-normalised), SEC financial_statements, daily
price_bars and cached quote_snapshots. Screener filters, sorts and paginates on
this table with plain SQL, so a request never touches per-symbol data (no N+1).

Units: *_pct columns and dividend_yield_pct are percentage points (12.5 == 12.5%),
debt_to_equity is a plain ratio (0.66), market_cap is USD. A metric we don't have,
or one that failed a sanity bound (see flags), is NULL, never 0.
"""
from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text

from app.db.database import Base


class ScreenerSnapshot(Base):
    __tablename__ = "screener_snapshots"

    id = Column(Integer, primary_key=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id", ondelete="CASCADE"), nullable=False, unique=True)
    symbol = Column(String(10), nullable=False)
    name = Column(String(255))
    sector = Column(String(100))
    industry = Column(String(100))
    exchange = Column(String(50))
    asset_type = Column(String(50))

    price = Column(Float)
    change_1d_pct = Column(Float)
    change_1m_pct = Column(Float)
    market_cap = Column(Float)

    pe_ratio = Column(Float)
    ps_ratio = Column(Float)
    dividend_yield_pct = Column(Float)
    revenue_growth_yoy_pct = Column(Float)
    profit_margin_pct = Column(Float)
    roe_pct = Column(Float)
    debt_to_equity = Column(Float)

    rsi_14 = Column(Float)
    sma_50 = Column(Float)
    sma_200 = Column(Float)
    price_vs_sma50_pct = Column(Float)
    price_vs_sma200_pct = Column(Float)

    flags = Column(Text)                # comma-separated, e.g. "roe_outlier,negative_earnings"
    price_as_of = Column(DateTime(timezone=True))
    computed_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_screener_snapshots_sector", "sector"),
        Index("ix_screener_snapshots_market_cap", "market_cap"),
        Index("ix_screener_snapshots_symbol", "symbol"),
    )
