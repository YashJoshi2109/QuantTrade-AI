"""
Paid-AI usage accounting (one row per provider call) and a small persistent
cache for deterministic AI results (SEC insights, OG image URLs, ...).

Written by app.services.ai_guard; read by the admin / per-user usage endpoints.
"""
from sqlalchemy import Boolean, Column, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.db.database import Base


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    user_id = Column(Integer, nullable=True, index=True)  # NULL = system/background job
    feature = Column(String(64), nullable=False)
    provider = Column(String(32), nullable=False)
    model = Column(String(120), nullable=False)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    units = Column(Float, nullable=False, default=0.0)  # images / megapixels / characters / searches
    cost_usd = Column(Float, nullable=False, default=0.0)
    status = Column(String(16), nullable=False, default="ok")  # ok | error | cutoff
    is_system = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_ai_usage_events_ts_feature", "ts", "feature"),
    )


class AIResultCache(Base):
    __tablename__ = "ai_result_cache"

    key = Column(String(200), primary_key=True)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
