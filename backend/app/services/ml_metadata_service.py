"""ML Training metadata CRUD for Neon PostgreSQL.

Provides read/write operations for training_runs, training_shards,
training_artifacts, and model_versions tables.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.ml_training import (
    TrainingRun, TrainingShard, TrainingArtifact, ModelVersion,
)

logger = logging.getLogger(__name__)


# ── Training Runs ─────────────────────────────────────────────────────

def create_run(
    db: Session,
    run_id: UUID,
    run_type: str,
    trigger_source: str,
    config_snapshot: dict | None = None,
    config_hash: str = "",
    git_sha: str = "",
    total_symbols: int = 0,
    total_shards: int = 0,
) -> TrainingRun:
    run = TrainingRun(
        run_id=run_id,
        run_type=run_type,
        status="running",
        trigger_source=trigger_source,
        config_snapshot=config_snapshot,
        config_hash=config_hash,
        git_sha=git_sha,
        started_at=datetime.now(timezone.utc),
        total_symbols=total_symbols,
        total_shards=total_shards,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def update_run_status(
    db: Session,
    run_id: UUID,
    status: str,
    success_shards: int = 0,
    failed_shards: int = 0,
    summary_s3_uri: str = "",
    error_summary: str = "",
) -> TrainingRun | None:
    run = db.query(TrainingRun).filter(TrainingRun.run_id == run_id).first()
    if not run:
        return None
    run.status = status
    run.success_shards = success_shards
    run.failed_shards = failed_shards
    if status in ("completed", "partial", "failed"):
        run.ended_at = datetime.now(timezone.utc)
    if summary_s3_uri:
        run.summary_s3_uri = summary_s3_uri
    if error_summary:
        run.error_summary = error_summary
    db.commit()
    db.refresh(run)
    return run


def get_run(db: Session, run_id: UUID) -> TrainingRun | None:
    return db.query(TrainingRun).filter(TrainingRun.run_id == run_id).first()


def list_runs(
    db: Session,
    status: str | None = None,
    run_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[TrainingRun]:
    q = db.query(TrainingRun)
    if status:
        q = q.filter(TrainingRun.status == status)
    if run_type:
        q = q.filter(TrainingRun.run_type == run_type)
    return q.order_by(desc(TrainingRun.created_at)).offset(offset).limit(limit).all()


# ── Training Shards ──────────────────────────────────────���────────────

def create_shard(
    db: Session,
    shard_id: UUID,
    run_id: UUID,
    shard_index: int,
    shard_name: str,
    symbol_count: int,
    symbols: list[str] | None = None,
    horizons: list[int] | None = None,
    manifest_s3_uri: str = "",
) -> TrainingShard:
    shard = TrainingShard(
        shard_id=shard_id,
        run_id=run_id,
        shard_index=shard_index,
        shard_name=shard_name,
        status="pending",
        symbol_count=symbol_count,
        symbols=symbols,
        horizons=horizons or [1, 7, 30],
        manifest_s3_uri=manifest_s3_uri,
    )
    db.add(shard)
    db.commit()
    db.refresh(shard)
    return shard


def update_shard_status(
    db: Session,
    shard_id: UUID,
    status: str,
    batch_job_id: str = "",
    runtime_seconds: int = 0,
    error_summary: str = "",
    error_type: str = "",
) -> TrainingShard | None:
    shard = db.query(TrainingShard).filter(TrainingShard.shard_id == shard_id).first()
    if not shard:
        return None
    shard.status = status
    if status == "running" and not shard.started_at:
        shard.started_at = datetime.now(timezone.utc)
    if status in ("completed", "failed"):
        shard.ended_at = datetime.now(timezone.utc)
        shard.runtime_seconds = runtime_seconds
    if batch_job_id:
        shard.batch_job_id = batch_job_id
    if error_summary:
        shard.error_summary = error_summary
        shard.error_type = error_type
    db.commit()
    db.refresh(shard)
    return shard


def get_shards_for_run(db: Session, run_id: UUID) -> list[TrainingShard]:
    return (
        db.query(TrainingShard)
        .filter(TrainingShard.run_id == run_id)
        .order_by(TrainingShard.shard_index)
        .all()
    )


def get_failed_shards(db: Session, run_id: UUID) -> list[TrainingShard]:
    return (
        db.query(TrainingShard)
        .filter(TrainingShard.run_id == run_id, TrainingShard.status == "failed")
        .all()
    )


# ── Training Artifacts ────────────────────────────────────────────────

def create_artifact(
    db: Session,
    run_id: UUID,
    shard_id: UUID | None,
    symbol: str,
    horizon: int,
    checkpoint_s3_uri: str = "",
    metrics_s3_uri: str = "",
    model_version: str = "",
    directional_accuracy: Optional[float] = None,
    information_coefficient: Optional[float] = None,
    hypothetical_sharpe: Optional[float] = None,
    epochs_trained: int = 0,
    early_stopped: bool = False,
) -> TrainingArtifact:
    artifact = TrainingArtifact(
        run_id=run_id,
        shard_id=shard_id,
        symbol=symbol,
        horizon=horizon,
        checkpoint_s3_uri=checkpoint_s3_uri,
        metrics_s3_uri=metrics_s3_uri,
        model_version=model_version,
        directional_accuracy=directional_accuracy,
        information_coefficient=information_coefficient,
        hypothetical_sharpe=hypothetical_sharpe,
        epochs_trained=epochs_trained,
        early_stopped=early_stopped,
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    return artifact


def get_artifacts_for_run(db: Session, run_id: UUID) -> list[TrainingArtifact]:
    return (
        db.query(TrainingArtifact)
        .filter(TrainingArtifact.run_id == run_id)
        .order_by(TrainingArtifact.symbol, TrainingArtifact.horizon)
        .all()
    )


def get_symbol_history(db: Session, symbol: str, limit: int = 20) -> list[TrainingArtifact]:
    return (
        db.query(TrainingArtifact)
        .filter(TrainingArtifact.symbol == symbol)
        .order_by(desc(TrainingArtifact.created_at))
        .limit(limit)
        .all()
    )


# ── Model Versions ───────────────────────────────────────────────────

def create_model_version(
    db: Session,
    model_version: str,
    run_id: UUID,
    git_sha: str = "",
    config_snapshot: dict | None = None,
    symbol_count: int = 0,
    horizons: list[int] | None = None,
    avg_da: float = 0.0,
    avg_ic: float = 0.0,
) -> ModelVersion:
    mv = ModelVersion(
        model_version=model_version,
        run_id=run_id,
        git_sha=git_sha,
        config_snapshot=config_snapshot,
        symbol_count=symbol_count,
        horizons=horizons,
        avg_directional_accuracy=avg_da,
        avg_information_coefficient=avg_ic,
        promotion_status="staging",
    )
    db.add(mv)
    db.commit()
    db.refresh(mv)
    return mv


def promote_model_version(
    db: Session,
    model_version: str,
    promoted_by: str = "system",
) -> ModelVersion | None:
    # Archive current production
    current_prod = (
        db.query(ModelVersion)
        .filter(ModelVersion.promotion_status == "production")
        .all()
    )
    for mv in current_prod:
        mv.promotion_status = "archived"

    # Promote new version
    mv = db.query(ModelVersion).filter(ModelVersion.model_version == model_version).first()
    if not mv:
        return None
    mv.promotion_status = "production"
    mv.promoted_at = datetime.now(timezone.utc)
    mv.promoted_by = promoted_by
    db.commit()
    db.refresh(mv)
    return mv


def get_production_model(db: Session) -> ModelVersion | None:
    return (
        db.query(ModelVersion)
        .filter(ModelVersion.promotion_status == "production")
        .first()
    )


def list_model_versions(
    db: Session,
    status: str | None = None,
    limit: int = 20,
) -> list[ModelVersion]:
    q = db.query(ModelVersion)
    if status:
        q = q.filter(ModelVersion.promotion_status == status)
    return q.order_by(desc(ModelVersion.created_at)).limit(limit).all()


# ── Aggregation Queries ──────────────────────────────────────────────

def get_run_summary(db: Session, run_id: UUID) -> dict:
    """Get comprehensive run summary with shard and artifact stats."""
    run = get_run(db, run_id)
    if not run:
        return {}

    shards = get_shards_for_run(db, run_id)
    artifacts = get_artifacts_for_run(db, run_id)

    avg_da = 0.0
    avg_ic = 0.0
    if artifacts:
        avg_da = sum(a.directional_accuracy or 0 for a in artifacts) / len(artifacts)
        avg_ic = sum(a.information_coefficient or 0 for a in artifacts) / len(artifacts)

    return {
        "run_id": str(run.run_id),
        "run_type": run.run_type,
        "status": run.status,
        "trigger_source": run.trigger_source,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "ended_at": run.ended_at.isoformat() if run.ended_at else None,
        "total_symbols": run.total_symbols,
        "total_shards": len(shards),
        "success_shards": sum(1 for s in shards if s.status == "completed"),
        "failed_shards": sum(1 for s in shards if s.status == "failed"),
        "total_artifacts": len(artifacts),
        "avg_directional_accuracy": round(avg_da, 4),
        "avg_information_coefficient": round(avg_ic, 4),
        "shards": [
            {
                "shard_id": str(s.shard_id),
                "shard_name": s.shard_name,
                "status": s.status,
                "symbol_count": s.symbol_count,
                "runtime_seconds": s.runtime_seconds,
                "error_summary": s.error_summary,
            }
            for s in shards
        ],
    }


def update_shard_from_callback(
    db: Session,
    shard_id: UUID,
    status: str,
    runtime_seconds: Optional[int] = None,
    error_type: Optional[str] = None,
    error_summary: Optional[str] = None,
) -> Optional[TrainingShard]:
    shard = db.query(TrainingShard).filter(TrainingShard.shard_id == shard_id).first()
    if not shard:
        return None
    shard.status = status
    if runtime_seconds is not None:
        shard.runtime_seconds = runtime_seconds
    if error_type:
        shard.error_type = error_type
    if error_summary:
        shard.error_summary = error_summary
    shard.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(shard)
    return shard


def get_metrics_summary(db: Session, days: int = 7) -> dict:
    """Aggregate metrics for recent runs."""
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    runs = (
        db.query(TrainingRun)
        .filter(TrainingRun.created_at >= cutoff)
        .all()
    )

    total_runs = len(runs)
    completed = sum(1 for r in runs if r.status == "completed")
    failed = sum(1 for r in runs if r.status == "failed")

    artifacts = (
        db.query(TrainingArtifact)
        .filter(TrainingArtifact.created_at >= cutoff)
        .all()
    )

    avg_da = 0.0
    avg_ic = 0.0
    if artifacts:
        avg_da = sum(a.directional_accuracy or 0 for a in artifacts) / len(artifacts)
        avg_ic = sum(a.information_coefficient or 0 for a in artifacts) / len(artifacts)

    return {
        "period_days": days,
        "total_runs": total_runs,
        "completed_runs": completed,
        "failed_runs": failed,
        "total_artifacts": len(artifacts),
        "avg_directional_accuracy": round(avg_da, 4),
        "avg_information_coefficient": round(avg_ic, 4),
    }
