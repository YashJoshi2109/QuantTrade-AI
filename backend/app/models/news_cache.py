"""
News Cache model - Neon-backed cache for news articles

Implementation Notes:
- Table: news_cache
- URL is unique constraint (deduplicate articles)
- Stores OpenGraph image_url extracted from article HTML if missing
- payload stores full JSON response from provider
- TTL: 30-60 minutes for news freshness

Image Extraction:
- If upstream has no image_url, server-side fetches article HTML
- Extracts og:image meta tag and stores
- Fallback to first <img> in article body
"""
from sqlalchemy import Column, String, DateTime, Integer, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.database import Base


class NewsCache(Base):
    """
    Cached news article with image extraction.
    Unique per URL to prevent duplicates.
    """
    __tablename__ = "news_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Article identification
    url = Column(String(2000), unique=True, nullable=False, index=True)
    
    # Core article data
    title = Column(String(500), nullable=False)
    source = Column(String(100))
    published_at = Column(DateTime(timezone=True), index=True)
    summary = Column(Text)
    
    # Image (extracted from OG or article body)
    image_url = Column(String(2000))
    
    # Related symbols
    symbols = Column(JSONB, default=[])  # ['AAPL', 'MSFT']
    
    # Sentiment analysis result
    sentiment = Column(String(20))  # 'Bullish', 'Bearish', 'Neutral'
    
    # Full payload from provider
    payload = Column(JSONB, default={})
    
    # Cache metadata
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    image_extracted = Column(DateTime(timezone=True))  # When image was extracted
    
    __table_args__ = (
        Index('ix_news_cache_url', 'url'),
        Index('ix_news_cache_published', 'published_at'),
        Index('ix_news_cache_fetched', 'fetched_at'),
    )
    
    def to_dict(self) -> dict:
        """Convert to API response dict"""
        return {
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "source": self.source,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "summary": self.summary,
            "image_url": self.image_url,
            "thumbnail": self.image_url,  # Alias for frontend compatibility
            "symbols": self.symbols or [],
            "related_tickers": self.symbols or [],  # Alias for frontend compatibility
            "sentiment": self.sentiment,
        }
