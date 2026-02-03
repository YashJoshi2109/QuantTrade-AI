"""
Real-time quote model for sub-second stock price updates
Optimized for high-frequency updates with Redis caching layer
"""
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class RealtimeQuote(Base):
    """
    Store latest real-time quotes
    This table is updated frequently (sub-second to seconds)
    Use with Redis cache for millisecond-level access
    """
    __tablename__ = "realtime_quotes"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False, unique=True, index=True)
    
    # Current price data
    last_price = Column(Float, nullable=False)
    bid_price = Column(Float)
    ask_price = Column(Float)
    bid_size = Column(Integer)
    ask_size = Column(Integer)
    
    # Daily metrics
    open_price = Column(Float)
    high_price = Column(Float)
    low_price = Column(Float)
    previous_close = Column(Float)
    
    # Volume
    volume = Column(Integer)
    avg_volume = Column(Integer)
    
    # Change metrics
    change = Column(Float)
    change_percent = Column(Float)
    
    # Extended hours (if available)
    premarket_price = Column(Float)
    premarket_change = Column(Float)
    afterhours_price = Column(Float)
    afterhours_change = Column(Float)
    
    # Market status
    market_status = Column(String(20))  # OPEN, CLOSED, PRE, POST
    
    # Timestamps
    quote_timestamp = Column(DateTime(timezone=True), nullable=False)  # Exchange timestamp
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Data source tracking
    data_source = Column(String(50))  # finviz, alphavantage, yfinance, websocket
    latency_ms = Column(Integer)  # Time from exchange to our system
    
    # Relationship
    symbol = relationship("Symbol", backref="realtime_quote", uselist=False)


class MarketIndex(Base):
    """Store major market indices (S&P 500, NASDAQ, DOW)"""
    __tablename__ = "market_indices"
    
    id = Column(Integer, primary_key=True, index=True)
    index_symbol = Column(String(20), unique=True, nullable=False, index=True)  # ^GSPC, ^IXIC, ^DJI
    index_name = Column(String(100))  # S&P 500, NASDAQ Composite, Dow Jones
    
    # Current values
    last_price = Column(Float, nullable=False)
    open_price = Column(Float)
    high_price = Column(Float)
    low_price = Column(Float)
    previous_close = Column(Float)
    
    # Change
    change = Column(Float)
    change_percent = Column(Float)
    
    # Timestamps
    quote_timestamp = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class QuoteHistory(Base):
    """
    Historical tick data for intraday analysis
    Store only critical ticks to save space (every minute or on significant price moves)
    """
    __tablename__ = "quote_history"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False)
    
    # Tick data
    timestamp = Column(DateTime(timezone=True), nullable=False)
    price = Column(Float, nullable=False)
    volume = Column(Integer)
    bid = Column(Float)
    ask = Column(Float)
    
    # Indexes for fast queries
    __table_args__ = (
        Index('idx_symbol_timestamp', 'symbol_id', 'timestamp'),
    )
    
    # Relationship
    symbol = relationship("Symbol", backref="quote_history")
