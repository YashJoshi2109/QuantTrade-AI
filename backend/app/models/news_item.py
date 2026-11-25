"""
news_items — one row per de-duplicated news cluster (news intelligence feed).

Why a new table instead of extending news_articles: news_articles is keyed to a
single symbol (symbol_id NOT NULL FK, one row per symbol per article), while a
cluster is market-wide, multi-ticker and multi-source. create_all() never
ALTERs existing tables, so new columns on news_articles would silently not
exist in prod. A fresh table is created by the normal create_all path.

Retention: 14 days (pipeline prunes hourly).
"""
from sqlalchemy import JSON, Column, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.db.database import Base
from app.models.community import PortableARRAY


class NewsItem(Base):
    __tablename__ = "news_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cluster_id = Column(String(32), nullable=False, unique=True, index=True)
    title = Column(String(600), nullable=False)
    summary = Column(Text)
    url = Column(String(2000))
    url_hash = Column(String(32), index=True)
    title_hash = Column(String(32), index=True)
    source = Column(String(120))          # publisher of the representative article
    source_feed = Column(String(40), index=True)  # poller that first saw it (finnhub, sec_8k, ...)
    sources = Column(JSON)                # [{source, feed, url, title, published_at}]
    sources_count = Column(Integer, nullable=False, default=1)
    published_at = Column(DateTime(timezone=True), nullable=False)
    ingested_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    classified_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    tickers = Column(PortableARRAY(String(16)))
    categories = Column(PortableARRAY(String(32)))
    primary_category = Column(String(32), index=True)
    sentiment_label = Column(String(16), index=True)
    sentiment_score = Column(Float)
    sentiment_confidence = Column(Float)
    impact = Column(Integer, index=True)
    ai = Column(JSON)
    image_url = Column(String(2000))

    __table_args__ = (
        Index("ix_news_items_published_desc", published_at.desc()),
        Index("ix_news_items_impact_published", "impact", "published_at"),
        # GIN on Postgres for `tickers @> ARRAY[...]` / `categories @> ...`
        Index("ix_news_items_tickers", "tickers", postgresql_using="gin"),
        Index("ix_news_items_categories", "categories", postgresql_using="gin"),
    )
