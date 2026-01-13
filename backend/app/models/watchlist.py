"""
Watchlist model for user portfolios
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class Watchlist(Base):
    __tablename__ = "watchlists"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)  # Optional user relationship
    legacy_user_id = Column(String(100), index=True, nullable=True)  # For backwards compatibility
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notes = Column(String(500), nullable=True)
    
    symbol = relationship("Symbol", backref="watchlist_entries")
    user = relationship("User", back_populates="watchlists", foreign_keys=[user_id])