"""
Watchlist model for user portfolios

Implementation Notes:
- Table: watchlists with unique constraint on (user_id, symbol_id)
- symbol stored via FK to symbols table, normalized to uppercase
- Optional note field for user annotations
- Soft delete not implemented - hard delete used
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class Watchlist(Base):
    __tablename__ = "watchlists"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id", ondelete="CASCADE"), nullable=False, index=True)
    notes = Column(String(500), nullable=True)  # Optional user note
    source = Column(String(50), nullable=True)  # Optional: where user found this stock
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    symbol = relationship("Symbol", backref="watchlist_entries")
    user = relationship("User", back_populates="watchlists", foreign_keys=[user_id])
    
    # Unique constraint to prevent duplicate entries
    __table_args__ = (
        UniqueConstraint('user_id', 'symbol_id', name='uq_user_symbol'),
        Index('ix_watchlist_user_symbol', 'user_id', 'symbol_id'),
    )