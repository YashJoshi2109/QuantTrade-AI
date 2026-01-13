"""
News article model
"""
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class NewsArticle(Base):
    __tablename__ = "news_articles"
    
    id = Column(Integer, primary_key=True, index=True)
    symbol_id = Column(Integer, ForeignKey("symbols.id"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text)
    source = Column(String(100))
    url = Column(String(1000))
    published_at = Column(DateTime(timezone=True), nullable=False, index=True)
    sentiment = Column(String(20))  # 'Bullish', 'Bearish', 'Neutral'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    symbol = relationship("Symbol", backref="news_articles")
    
    __table_args__ = (
        Index('idx_symbol_published', 'symbol_id', 'published_at'),
    )
