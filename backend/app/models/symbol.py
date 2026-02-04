"""
Symbol model for storing stock symbols and metadata

Implementation Notes:
- Supports universal search by symbol, name, exchange
- Fields: symbol, name, exchange, type, currency, country, sector, industry
- Indexed for fast prefix/substring search
"""
from sqlalchemy import Column, String, DateTime, Float, Integer, Index
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Composite index for search optimization
    __table_args__ = (
        Index('ix_symbol_name_search', 'symbol', 'name'),
    )
