"""
Monitoring tables for ML models (feature drift + prediction stats).
"""

from sqlalchemy import Column, Date, DateTime, Float, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db.database import Base


class MLFeatureStat(Base):
  __tablename__ = "ml_feature_stats"

  id = Column(Integer, primary_key=True, index=True)
  model_name = Column(String(100), nullable=False, index=True)
  feature_name = Column(String(100), nullable=False)
  window_start = Column(Date, nullable=False)
  window_end = Column(Date, nullable=False)
  mean = Column(Float, nullable=True)
  std = Column(Float, nullable=True)
  psi = Column(Float, nullable=True)  # population stability index
  ks_p_value = Column(Float, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())


class MLPredictionStat(Base):
  __tablename__ = "ml_prediction_stats"

  id = Column(Integer, primary_key=True, index=True)
  model_name = Column(String(100), nullable=False, index=True)
  symbol = Column(String(20), nullable=False, index=True)
  horizon_days = Column(Integer, nullable=False)
  as_of_date = Column(Date, nullable=False)
  avg_confidence = Column(Float, nullable=True)
  up_ratio = Column(Float, nullable=True)
  avg_expected_return = Column(Float, nullable=True)
  realized_return = Column(Float, nullable=True)
  extra = Column(JSONB, nullable=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())

