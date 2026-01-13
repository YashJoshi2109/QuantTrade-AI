"""
Price bar model for storing OHLCV data
"""
from sqlalchemy import Column, String, DateTime, Float, Integer, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.db.database import Base


class PriceBar(Base):
    __tablename__ = "price_bars"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Integer, nullable=False)
    
    # Index for efficient queries
    __table_args__ = (
        Index('idx_symbol_timestamp', 'symbol_id', 'timestamp'),
    )
    
    symbol = relationship("Symbol", backref="price_bars")
