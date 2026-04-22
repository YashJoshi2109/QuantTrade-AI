"""
ML Training Pipeline metadata tables.

Stores training run orchestration, shard execution, artifact lineage,
and model version registry in Neon PostgreSQL.
"""

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, JSON, String, Text,
    ForeignKey, Index,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.sql import func
import uuid

from app.db.database import Base


class TrainingRun(Base):
    """Top-level training run — one per nightly trigger or manual invocation."""
    __tablename__ = "training_runs"

    run_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_type = Column(String(20), nullable=False)  # weekday | sunday | backfill | manual
    status = Column(String(20), nullable=False, default="pending")  # pending | running | completed | partial | failed
    config_hash = Column(String(64))
    config_snapshot = Column(JSON)
    trigger_source = Column(String(30))  # eventbridge | api | github_actions | cli
    git_sha = Column(String(40))
    scheduled_at = Column(DateTime(timezone=True))
    started_at = Column(DateTime(timezone=True))
    ended_at = Column(DateTime(timezone=True))
    total_symbols = Column(Integer, default=0)
    total_shards = Column(Integer, default=0)
    success_shards = Column(Integer, default=0)
    failed_shards = Column(Integer, default=0)
    summary_s3_uri = Column(Text)
    error_summary = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_training_runs_status", "status"),
        Index("idx_training_runs_type_date", "run_type", "created_at"),
    )


class TrainingShard(Base):
    """Individual training shard within a run — maps to one Batch job."""
    __tablename__ = "training_shards"

    shard_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("training_runs.run_id"), nullable=False)
    shard_index = Column(Integer, nullable=False)
    shard_name = Column(String(50))
    status = Column(String(20), nullable=False, default="pending")  # pending | running | completed | failed
    symbol_count = Column(Integer, default=0)
    symbols = Column(ARRAY(String))
    horizons = Column(ARRAY(Integer), default=[1, 7, 30])
    manifest_s3_uri = Column(Text)
    batch_job_id = Column(String(100))
    retry_count = Column(Integer, default=0)
    started_at = Column(DateTime(timezone=True))
    ended_at = Column(DateTime(timezone=True))
    runtime_seconds = Column(Integer)
    error_summary = Column(Text)
    error_type = Column(String(30))  # data | training | infra | timeout
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_training_shards_run", "run_id"),
        Index("idx_training_shards_status", "status"),
    )


class TrainingArtifact(Base):
    """Per-symbol per-horizon artifact produced by a training shard."""
    __tablename__ = "training_artifacts"

    artifact_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("training_runs.run_id"), nullable=False)
    shard_id = Column(UUID(as_uuid=True), ForeignKey("training_shards.shard_id"))
    symbol = Column(String(20), nullable=False)
    horizon = Column(Integer, nullable=False)
    checkpoint_s3_uri = Column(Text)
    metrics_s3_uri = Column(Text)
    feature_cache_s3_uri = Column(Text)
    model_version = Column(String(30))
    directional_accuracy = Column(Float)
    information_coefficient = Column(Float)
    hypothetical_sharpe = Column(Float)
    epochs_trained = Column(Integer)
    early_stopped = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_artifacts_run", "run_id"),
        Index("idx_artifacts_symbol_horizon", "symbol", "horizon"),
    )


class ModelVersion(Base):
    """Model version registry — tracks promotions from staging to production."""
    __tablename__ = "model_versions"

    model_version = Column(String(30), primary_key=True)
    run_id = Column(UUID(as_uuid=True), ForeignKey("training_runs.run_id"))
    git_sha = Column(String(40))
    feature_version = Column(String(20), default="v1")
    config_snapshot = Column(JSON)
    symbol_count = Column(Integer)
    horizons = Column(ARRAY(Integer))
    avg_directional_accuracy = Column(Float)
    avg_information_coefficient = Column(Float)
    promotion_status = Column(String(20), default="staging")  # staging | production | archived
    promoted_at = Column(DateTime(timezone=True))
    promoted_by = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_model_versions_status", "promotion_status"),
    )
