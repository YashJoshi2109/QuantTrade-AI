"""
Portfolio models for tracking user holdings, transactions, and performance
"""
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, Enum, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base
import enum


class TransactionType(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    SPLIT = "SPLIT"


class Portfolio(Base):
    """User portfolio/account"""
    __tablename__ = "portfolios"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False, default="Default Portfolio")
    description = Column(String(500))
    
    # Portfolio settings
    cash_balance = Column(Float, default=0.0)
    initial_cash = Column(Float, default=0.0)
    currency = Column(String(3), default="USD")
    is_paper_trading = Column(Integer, default=1)  # 1 = paper, 0 = real
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    user = relationship("User", backref="portfolios")
    positions = relationship("Position", back_populates="portfolio", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="portfolio", cascade="all, delete-orphan")


class Position(Base):
    """Current holdings in a portfolio"""
    __tablename__ = "positions"
    
    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False)
    
    # Position details
    quantity = Column(Float, nullable=False, default=0.0)
    avg_cost_basis = Column(Float, nullable=False)  # Average price paid per share
    current_price = Column(Float)  # Last known price
    
    # Calculated fields (updated on sync)
    market_value = Column(Float)  # quantity * current_price
    unrealized_pnl = Column(Float)  # (current_price - avg_cost_basis) * quantity
    unrealized_pnl_percent = Column(Float)
    
    # Timestamps
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    last_updated = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Indexes
    __table_args__ = (
        Index('idx_portfolio_symbol', 'portfolio_id', 'symbol_id', unique=True),
    )
    
    # Relationships
    portfolio = relationship("Portfolio", back_populates="positions")
    symbol = relationship("Symbol", backref="positions")


class Transaction(Base):
    """Transaction history for portfolios"""
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False)
    
    # Transaction details
    transaction_type = Column(Enum(TransactionType), nullable=False)
    quantity = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    total_amount = Column(Float, nullable=False)  # quantity * price (+ fees)
    fees = Column(Float, default=0.0)
    
    # Metadata
    notes = Column(String(500))
    transaction_date = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # For realized P&L tracking
    realized_pnl = Column(Float)  # For SELL transactions
    
    # Indexes
    __table_args__ = (
        Index('idx_portfolio_date', 'portfolio_id', 'transaction_date'),
        Index('idx_symbol_transactions', 'symbol_id', 'transaction_date'),
    )
    
    # Relationships
    portfolio = relationship("Portfolio", back_populates="transactions")
    symbol = relationship("Symbol", backref="transactions")


class PortfolioSnapshot(Base):
    """Daily snapshots of portfolio performance"""
    __tablename__ = "portfolio_snapshots"
    
    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False)
    
    # Snapshot date
    snapshot_date = Column(DateTime(timezone=True), nullable=False)
    
    # Portfolio values
    total_value = Column(Float, nullable=False)
    cash_balance = Column(Float, nullable=False)
    invested_value = Column(Float, nullable=False)
    
    # Performance metrics
    total_pnl = Column(Float)
    total_pnl_percent = Column(Float)
    daily_return = Column(Float)
    daily_return_percent = Column(Float)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Indexes
    __table_args__ = (
        Index('idx_portfolio_snapshot_date', 'portfolio_id', 'snapshot_date', unique=True),
    )
    
    # Relationships
    portfolio = relationship("Portfolio", backref="snapshots")
