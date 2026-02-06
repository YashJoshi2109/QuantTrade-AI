"""
Quote Snapshot model - Neon-backed cache for real-time quotes

Implementation Notes:
- Table: quote_snapshots
- Caches quotes from providers (yfinance, Finnhub) server-side
- TTL-based expiration: 60s market open, 600s (10min) market closed
- Symbol is unique constraint (one snapshot per symbol)
- payload stores full JSON response from provider

TTL Strategy:
- Market hours (9:30 AM - 4:00 PM ET): 60 seconds
- Pre/after hours: 300 seconds (5 min)
- Weekends/holidays: 600 seconds (10 min)
"""
from sqlalchemy import Column, String, DateTime, Integer, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.database import Base


class QuoteSnapshot(Base):
    """
    Cached quote snapshot for a symbol.
    Unique per symbol, updated on fetch if TTL expired.
    """
    __tablename__ = "quote_snapshots"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(10), unique=True, nullable=False, index=True)
    
    # Cached quote data
    payload = Column(JSONB, nullable=False, default={})
    
    # Cache metadata
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ttl_seconds = Column(Integer, default=60, nullable=False)  # Default 60s for market hours
    
    # Source tracking
    data_source = Column(String(50))  # 'yfinance', 'finnhub', 'alphavantage'
    
    __table_args__ = (
        Index('ix_quote_snapshot_symbol', 'symbol'),
        Index('ix_quote_snapshot_fetched', 'fetched_at'),
    )
    
    def is_expired(self) -> bool:
        """Check if cache has expired based on TTL"""
        from datetime import datetime, timezone
        if not self.fetched_at:
            return True
        now = datetime.now(timezone.utc)
        age_seconds = (now - self.fetched_at.replace(tzinfo=timezone.utc)).total_seconds()
        return age_seconds > self.ttl_seconds
    
    def to_dict(self) -> dict:
        """Convert to API response dict"""
        return {
            "symbol": self.symbol,
            "data": self.payload,
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
            "ttl_seconds": self.ttl_seconds,
            "data_source": self.data_source,
            "is_cached": True
        }
