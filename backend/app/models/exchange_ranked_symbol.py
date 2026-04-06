"""
ExchangeRankedSymbol — ranked stock universe per exchange
Priority score: 0.35*market_cap + 0.35*dollar_volume + 0.15*index_membership
              + 0.10*analyst_coverage + 0.05*user_interest
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Index
from datetime import datetime
from app.db.database import Base


class ExchangeRankedSymbol(Base):
    __tablename__ = "exchange_ranked_symbols"

    id = Column(Integer, primary_key=True, index=True)

    # Identity
    symbol = Column(String(32), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    exchange = Column(String(32), nullable=False, index=True)   # e.g. "NYSE", "NSE"
    exchange_key = Column(String(32), nullable=False, index=True)  # e.g. "us", "india"
    country = Column(String(64), nullable=True)
    currency = Column(String(8), nullable=True)
    sector = Column(String(64), nullable=True)
    industry = Column(String(128), nullable=True)

    # Rank inputs
    market_cap = Column(Float, nullable=True)          # USD
    dollar_volume = Column(Float, nullable=True)       # daily dollar volume USD
    index_membership_weight = Column(Float, default=0.0)  # 1.0 if in major index, else 0
    analyst_coverage = Column(Float, default=0.0)     # normalized 0-1
    user_interest = Column(Float, default=0.0)        # normalized 0-1

    # Computed rank
    priority_score = Column(Float, nullable=True, index=True)
    rank_in_exchange = Column(Integer, nullable=True, index=True)

    # Live snapshot (updated by quote jobs)
    price = Column(Float, nullable=True)
    change_percent = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)

    # Meta
    is_active = Column(Boolean, default=True)
    last_profile_fetch = Column(DateTime, nullable=True)
    last_quote_fetch = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_ers_exchange_rank", "exchange_key", "rank_in_exchange"),
        Index("ix_ers_symbol_exchange", "symbol", "exchange_key", unique=True),
    )

    def __repr__(self):
        return f"<ExchangeRankedSymbol {self.symbol} [{self.exchange_key}] rank={self.rank_in_exchange}>"
