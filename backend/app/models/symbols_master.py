"""
Symbols Master model - Comprehensive symbol database for search

Implementation Notes:
- Table: symbols_master
- Contains ALL tradeable symbols for autocomplete search
- Seeded from FinanceDatabase or similar CSV dataset
- Uses pg_trgm extension for trigram fuzzy search
- Indexed for fast prefix/substring/similarity search

Search Ranking Priority:
1. Exact symbol match (AAPL)
2. Symbol prefix (AA...)
3. Name prefix (Apple...)
4. Trigram similarity on name/symbol
5. Substring contains fallback

Indexes:
- btree on symbol (exact/prefix)
- trigram (GIN) on symbol and name (fuzzy search)
"""
from sqlalchemy import Column, String, DateTime, Integer, Index
from sqlalchemy.sql import func
from app.db.database import Base


class SymbolsMaster(Base):
    """
    Master symbol database for search autocomplete.
    Contains all tradeable US equities and ETFs.
    """
    __tablename__ = "symbols_master"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Symbol identification (uppercase normalized)
    symbol = Column(String(10), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    
    # Exchange and classification
    exchange = Column(String(50))  # NASDAQ, NYSE, AMEX, etc.
    asset_type = Column(String(50), default='Equity')  # Equity, ETF, ADR, etc.
    
    # Locale
    currency = Column(String(10), default='USD')
    country = Column(String(50), default='US')
    
    # Sector/Industry classification
    sector = Column(String(100))
    industry = Column(String(100))
    
    # Metadata
    is_active = Column(String(1), default='Y')  # Y/N for active trading
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    __table_args__ = (
        # Primary symbol index (btree for exact/prefix)
        Index('ix_symbols_master_symbol', 'symbol'),
        # Name index for prefix search
        Index('ix_symbols_master_name', 'name'),
        # Composite for common queries
        Index('ix_symbols_master_exchange', 'exchange'),
        Index('ix_symbols_master_sector', 'sector'),
        # Note: Trigram indexes created in migration SQL
    )
    
    def to_search_result(self, match_type: str = 'contains') -> dict:
        """Convert to search result dict"""
        return {
            "symbol": self.symbol,
            "name": self.name,
            "exchange": self.exchange,
            "asset_type": self.asset_type,
            "currency": self.currency,
            "country": self.country,
            "sector": self.sector,
            "industry": self.industry,
            "match_type": match_type
        }
