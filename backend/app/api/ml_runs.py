"""
Internal ML Training Pipeline API — run management, shard control, artifact listing.

Endpoints prefixed with /internal/ml/ for operator use.
"""

import logging
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.api.auth import require_auth
from app.models.user import User
from app.services import ml_metadata_service as mds

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request/Response Models ────────────────────────────────────────────

class TriggerNightlyRequest(BaseModel):
    run_type: str = Field("manual", description="weekday | sunday | backfill | manual")
    symbol_tier: str = Field("tier_2", description="Symbol tier to train")
    epochs_override: Optional[int] = None
    horizons: Optional[List[int]] = None


class BackfillRequest(BaseModel):
    symbols: List[str] = Field(..., min_length=1)
    horizons: List[int] = Field(default=[1, 7, 30])
    run_type: str = "backfill"


class ShardPlanRequest(BaseModel):
    symbol_tier: str = Field("all", description="Symbol tier for shard planning")
    max_symbols_per_shard: int = Field(200, ge=10, le=500)
    max_runtime_seconds: int = Field(7200, ge=600, le=14400)


# ── Training Run Management ───────────────────────────────────────────

@router.post("/internal/ml/runs/nightly/trigger")
async def trigger_nightly_run(
    req: TriggerNightlyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Trigger a manual nightly training run."""
    run_id = uuid.uuid4()

    # Resolve symbol count
    from ml.constants import SYMBOL_TIERS
    symbols = SYMBOL_TIERS.get(req.symbol_tier, [])
    if not symbols:
        raise HTTPException(400, f"Unknown tier: {req.symbol_tier}")

    # Plan shards
    from ml.shard_planner import plan_shards
    plan = plan_shards(
        symbols=symbols,
        horizons=req.horizons or [1, 7, 30],
        run_id=str(run_id),
        run_type=req.run_type,
    )

    # Create run record
    run = mds.create_run(
        db,
        run_id=run_id,
        run_type=req.run_type,
        trigger_source="api",
        total_symbols=len(symbols),
        total_shards=len(plan.shards),
    )

    # Create shard records
    for shard in plan.shards:
        mds.create_shard(
            db,
            shard_id=uuid.UUID(shard.shard_id),
            run_id=run_id,
            shard_index=shard.shard_index,
            shard_name=shard.shard_name,
            symbol_count=shard.symbol_count,
            symbols=shard.symbols,
            horizons=shard.horizons,
        )

    return {
        "message": "Training run created",
        "run_id": str(run_id),
        "run_type": req.run_type,
        "total_symbols": len(symbols),
        "total_shards": len(plan.shards),
        "shards": [
            {"shard_name": s.shard_name, "symbol_count": s.symbol_count, "estimated_runtime_min": s.estimated_runtime_seconds // 60}
            for s in plan.shards
        ],
    }


@router.post("/internal/ml/runs/backfill")
async def trigger_backfill(
    req: BackfillRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Trigger a backfill training run for specific symbols."""
    run_id = uuid.uuid4()
    from ml.shard_planner import plan_shards

    plan = plan_shards(
        symbols=req.symbols,
        horizons=req.horizons,
        run_id=str(run_id),
        run_type=req.run_type,
    )

    run = mds.create_run(
        db,
        run_id=run_id,
        run_type="backfill",
        trigger_source="api",
        total_symbols=len(req.symbols),
        total_shards=len(plan.shards),
    )

    for shard in plan.shards:
        mds.create_shard(
            db,
            shard_id=uuid.UUID(shard.shard_id),
            run_id=run_id,
            shard_index=shard.shard_index,
            shard_name=shard.shard_name,
            symbol_count=shard.symbol_count,
            symbols=shard.symbols,
            horizons=shard.horizons,
        )

    return {
        "message": "Backfill run created",
        "run_id": str(run_id),
        "symbols": len(req.symbols),
        "shards": len(plan.shards),
    }


@router.get("/internal/ml/runs")
async def list_runs(
    status: Optional[str] = Query(None),
    run_type: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List training runs with optional filters."""
    runs = mds.list_runs(db, status=status, run_type=run_type, limit=limit, offset=offset)

    def _runtime(r) -> Optional[int]:
        if r.ended_at and r.started_at:
            return max(0, int((r.ended_at - r.started_at).total_seconds()))
        return None

    return {
        "runs": [
            {
                "run_id": str(r.run_id),
                "run_type": r.run_type,
                "status": r.status,
                "trigger_source": r.trigger_source,
                "total_symbols": r.total_symbols,
                "total_shards": r.total_shards,
                "success_shards": r.success_shards,
                "failed_shards": r.failed_shards,
                # Frontend-expected aliases
                "symbols_completed": r.success_shards,
                "symbols_failed": r.failed_shards,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "ended_at": r.ended_at.isoformat() if r.ended_at else None,
                "finished_at": r.ended_at.isoformat() if r.ended_at else None,
                "runtime_seconds": _runtime(r),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "error": r.error_summary,
            }
            for r in runs
        ],
        "total": len(runs),
    }


@router.get("/internal/ml/runs/{run_id}")
async def get_run(run_id: str, db: Session = Depends(get_db)):
    """Get detailed run summary with shard breakdown."""
    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(400, "Invalid run_id format")

    summary = mds.get_run_summary(db, uid)
    if not summary:
        raise HTTPException(404, "Run not found")
    return summary


@router.get("/internal/ml/runs/{run_id}/shards")
async def get_run_shards(run_id: str, db: Session = Depends(get_db)):
    """List shard status for a run."""
    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(400, "Invalid run_id format")

    shards = mds.get_shards_for_run(db, uid)
    return {
        "run_id": run_id,
        "shards": [
            {
                "shard_id": str(s.shard_id),
                "shard_name": s.shard_name,
                "shard_index": s.shard_index,
                "status": s.status,
                "symbol_count": s.symbol_count,
                "symbols_count": s.symbol_count,  # alias: frontend uses symbols_count
                "runtime_seconds": s.runtime_seconds,
                "retry_count": s.retry_count,
                "error_summary": s.error_summary,
                "error_type": s.error_type,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            }
            for s in shards
        ],
    }


@router.get("/internal/ml/runs/{run_id}/artifacts")
async def get_run_artifacts(run_id: str, db: Session = Depends(get_db)):
    """List artifacts produced by a run."""
    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(400, "Invalid run_id format")

    artifacts = mds.get_artifacts_for_run(db, uid)
    return {
        "run_id": run_id,
        "artifacts": [
            {
                "artifact_id": str(a.artifact_id),
                "symbol": a.symbol,
                "horizon": a.horizon,
                "directional_accuracy": a.directional_accuracy,
                "information_coefficient": a.information_coefficient,
                "hypothetical_sharpe": a.hypothetical_sharpe,
                "checkpoint_s3_uri": a.checkpoint_s3_uri,
                "model_version": a.model_version,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in artifacts
        ],
        "total": len(artifacts),
    }


@router.post("/internal/ml/runs/{run_id}/retry-failed-shards")
async def retry_failed_shards(
    run_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Re-submit failed shards for a run."""
    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(400, "Invalid run_id format")

    failed = mds.get_failed_shards(db, uid)
    if not failed:
        return {"message": "No failed shards to retry", "retried": 0}

    retried = []
    for shard in failed:
        shard.status = "pending"
        shard.retry_count += 1
        shard.error_summary = None
        shard.error_type = None
        db.commit()
        retried.append(str(shard.shard_id))

    return {
        "message": f"Retried {len(retried)} shards",
        "retried": len(retried),
        "shard_ids": retried,
    }


# ── Model Versions ───────────────────────────────────────────────────

@router.get("/internal/ml/models/versions")
async def list_model_versions(
    status: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List model versions with metrics."""
    versions = mds.list_model_versions(db, status=status, limit=limit)
    return {
        "versions": [
            {
                "model_version": v.model_version,
                "run_id": str(v.run_id) if v.run_id else None,
                "promotion_status": v.promotion_status,
                "symbol_count": v.symbol_count,
                "horizons": v.horizons,
                "avg_da": v.avg_directional_accuracy,
                "avg_ic": v.avg_information_coefficient,
                "promoted_at": v.promoted_at.isoformat() if v.promoted_at else None,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ],
    }


@router.get("/internal/ml/models/versions/{version}")
async def get_model_version(version: str, db: Session = Depends(get_db)):
    """Get detailed model version info."""
    from app.models.ml_training import ModelVersion as MV
    mv = db.query(MV).filter(MV.model_version == version).first()
    if not mv:
        raise HTTPException(404, "Model version not found")
    return {
        "model_version": mv.model_version,
        "run_id": str(mv.run_id) if mv.run_id else None,
        "git_sha": mv.git_sha,
        "feature_version": mv.feature_version,
        "config_snapshot": mv.config_snapshot,
        "symbol_count": mv.symbol_count,
        "horizons": mv.horizons,
        "avg_da": mv.avg_directional_accuracy,
        "avg_ic": mv.avg_information_coefficient,
        "promotion_status": mv.promotion_status,
        "promoted_at": mv.promoted_at.isoformat() if mv.promoted_at else None,
        "promoted_by": mv.promoted_by,
        "created_at": mv.created_at.isoformat() if mv.created_at else None,
    }


# ── Symbol History ───────────────────────────────────────────────────

@router.get("/internal/ml/symbols/{symbol}/history")
async def get_symbol_training_history(
    symbol: str,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get training history for a specific symbol."""
    artifacts = mds.get_symbol_history(db, symbol.upper(), limit=limit)
    return {
        "symbol": symbol.upper(),
        "history": [
            {
                "run_id": str(a.run_id),
                "horizon": a.horizon,
                "directional_accuracy": a.directional_accuracy,
                "information_coefficient": a.information_coefficient,
                "hypothetical_sharpe": a.hypothetical_sharpe,
                "model_version": a.model_version,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in artifacts
        ],
        "total": len(artifacts),
    }


# ── Shard Planning ───────────────────────────────────────────────────

@router.post("/internal/ml/shards/plan")
async def plan_shards_dryrun(req: ShardPlanRequest):
    """Dry-run shard planner — inspect generated shard assignments."""
    from ml.shard_planner import plan_shards_by_tier

    plan = plan_shards_by_tier(
        tier=req.symbol_tier,
        max_symbols_per_shard=req.max_symbols_per_shard,
        max_runtime_seconds=req.max_runtime_seconds,
    )

    return {
        "run_type": plan.run_type,
        "total_symbols": plan.total_symbols,
        "total_shards": len(plan.shards),
        "estimated_wall_clock_minutes": plan.total_estimated_runtime_seconds // 60,
        "shards": [
            {
                "shard_name": s.shard_name,
                "symbol_count": s.symbol_count,
                "estimated_runtime_minutes": s.estimated_runtime_seconds // 60,
                "symbols": s.symbols[:10],  # First 10 only for preview
                "symbols_truncated": s.symbol_count > 10,
            }
            for s in plan.shards
        ],
    }


# ── Health & Metrics ─────────────────────────────────────────────────

@router.get("/internal/ml/health")
async def ml_health(db: Session = Depends(get_db)):
    """Pipeline health summary."""
    from ml.constants import ALL_SYMBOLS, SYMBOL_TIERS

    runs = mds.list_runs(db, limit=5)
    latest = runs[0] if runs else None

    recent_failures = sum(1 for r in runs if r.status == "failed")

    if recent_failures >= 3 or (latest and latest.status == "failed"):
        pipeline_status = "degraded"
    else:
        pipeline_status = "healthy"

    return {
        "status": pipeline_status,
        "symbol_universe": len(ALL_SYMBOLS),
        "tiers": {k: len(v) for k, v in SYMBOL_TIERS.items()},
        "recent_runs": len(runs),
        "recent_failures": recent_failures,
        "last_run": latest.created_at.isoformat() if latest and latest.created_at else None,
        "active_runs": sum(1 for r in runs if r.status == "running"),
        "latest_run": {
            "run_id": str(latest.run_id) if latest else None,
            "status": latest.status if latest else None,
            "run_type": latest.run_type if latest else None,
            "created_at": latest.created_at.isoformat() if latest and latest.created_at else None,
        } if latest else None,
    }


@router.get("/internal/ml/metrics/summary")
async def ml_metrics_summary(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """Aggregate metrics for recent training runs."""
    raw = mds.get_metrics_summary(db, days=days)
    return {
        **raw,
        # Frontend-expected aliases
        "successful_runs": raw.get("completed_runs", 0),
        "avg_da": raw.get("avg_directional_accuracy", 0.0),
        "avg_ic": raw.get("avg_information_coefficient", 0.0),
        "avg_sharpe": None,
        "avg_runtime_seconds": None,
        "total_symbols_trained": raw.get("total_artifacts", 0),
    }


@router.get("/internal/ml/config/effective")
async def get_effective_config():
    """Return current effective training config."""
    from ml.config import TrainConfig
    from ml.constants import DEFAULT_CONFIG_PATH
    from dataclasses import asdict
    from pathlib import Path

    config_path = Path(DEFAULT_CONFIG_PATH)
    if config_path.exists():
        config = TrainConfig.from_yaml(config_path)
    else:
        config = TrainConfig()

    return {
        "config": asdict(config),
        "config_hash": config.config_hash(),
        "source": str(config_path) if config_path.exists() else "defaults",
    }
