"""
Model Index Engine — Database Models

Persistence layer for index snapshots, basket holdings, and score history.
"""

from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class ModelIndexSnapshot(Base):
    """Stores complete index snapshot at a point in time."""
    __tablename__ = "model_index_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    index_id = Column(String(50), nullable=False, index=True)
    index_name = Column(String(100))
    strategy_type = Column(String(50))
    regime = Column(String(30))
    regime_confidence = Column(Float)
    num_holdings = Column(Integer)
    avg_score = Column(Float)
    risk_score = Column(Float)
    risk_level = Column(String(20))
    portfolio_beta = Column(Float)
    portfolio_volatility = Column(Float)

    # Full snapshot as JSON blob (contains everything)
    snapshot_data = Column(Text, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    holdings = relationship("BasketHolding", back_populates="snapshot", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_model_index_snapshots_index_created", "index_id", "created_at"),
    )


class BasketHolding(Base):
    """Individual stock holding within a basket snapshot."""
    __tablename__ = "basket_holdings"

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(Integer, ForeignKey("model_index_snapshots.id"), nullable=False)
    ticker = Column(String(10), nullable=False, index=True)
    company_name = Column(String(255))
    sector = Column(String(100))
    weight = Column(Float)
    composite_score = Column(Float)
    regime_adjusted_score = Column(Float)
    confidence_score = Column(Float)
    grade = Column(String(5))
    role = Column(String(50))

    # Factor scores stored as JSON
    factor_scores = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    snapshot = relationship("ModelIndexSnapshot", back_populates="holdings")

    __table_args__ = (
        Index("ix_basket_holdings_snapshot_ticker", "snapshot_id", "ticker"),
    )


class FactorScoreHistory(Base):
    """Track factor score changes over time for trend analysis."""
    __tablename__ = "factor_score_history"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    index_type = Column(String(50))
    composite_score = Column(Float)
    regime_adjusted_score = Column(Float)
    confidence_score = Column(Float)
    grade = Column(String(5))
    regime = Column(String(30))

    # Individual factor scores as JSON
    factor_scores = Column(Text)

    scored_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_factor_score_history_ticker_scored", "ticker", "scored_at"),
    )
