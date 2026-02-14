"""
Track per-user sec-api.io usage so we can enforce strict daily quotas.
"""

from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Integer, String, UniqueConstraint

from app.db.database import Base


class SecAPIUsage(Base):
    __tablename__ = "sec_api_usage"

    id = Column(Integer, primary_key=True, index=True)
    # Nullable for anonymous users (session-based)
    user_id = Column(Integer, nullable=True, index=True)
    # Optional: which plan/tier was applied when counting this usage
    tier = Column(String(32), nullable=True)
    request_date = Column(Date, nullable=False, index=True)
    request_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "request_date", name="uq_sec_api_usage_user_date"),
    )

