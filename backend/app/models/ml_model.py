"""
Simple registry table for ML models (versioning + metrics).
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db.database import Base


class MLModel(Base):
  __tablename__ = "ml_models"

  id = Column(Integer, primary_key=True, index=True)
  name = Column(String(100), nullable=False, index=True)
  version = Column(String(50), nullable=False)
  metrics = Column(JSONB, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  is_prod = Column(Boolean, nullable=False, server_default="false", index=True)

