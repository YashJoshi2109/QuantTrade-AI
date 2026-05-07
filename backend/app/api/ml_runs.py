"""
Internal ML Training Pipeline API — run management, shard control, artifact listing.

Endpoints prefixed with /internal/ml/ for operator use.
"""

import hmac
import logging
import os
import uuid
from typing import Optional, List

import boto3
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.api.auth import require_auth
from app.models.user import User
from app.services import ml_metadata_service as mds

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_auth)])
# Separate router for internal machine-to-machine endpoints (no user JWT required)
internal_router = APIRouter()

# ── Callback secret (env → Secrets Manager fallback) ──────────────────
_cached_callback_secret: str | None = None

def _get_callback_secret() -> str:
    global _cached_callback_secret
    if _cached_callback_secret:  # only use cache if non-empty
        return _cached_callback_secret
    val = os.environ.get("ML_CALLBACK_SECRET", "")
    if not val:
        try:
            import json as _json
            client = boto3.client("secretsmanager", region_name=os.environ.get("AWS_REGION", "us-east-2"))
            resp = client.get_secret_value(SecretId="quanttrade/ml-pipeline-hzDIpH")
            val = _json.loads(resp["SecretString"]).get("ML_CALLBACK_SECRET", "")
            if val:
                logger.info("ML_CALLBACK_SECRET loaded from Secrets Manager")
        except Exception as e:
            logger.warning("ML_CALLBACK_SECRET not in env and Secrets Manager failed: %s", e)
    if val:
        _cached_callback_secret = val  # only cache on success, retry next call if still empty
    return val


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


class ArtifactCallbackItem(BaseModel):
    symbol: str
    horizon: int
    directional_accuracy: Optional[float] = None
    information_coefficient: Optional[float] = None
    hypothetical_sharpe: Optional[float] = None
    checkpoint_s3_uri: Optional[str] = None
    metrics_s3_uri: Optional[str] = None


class BatchStartRequest(BaseModel):
    run_id: str
    shard_id: str
    shard_name: str = ""
    batch_job_id: str = ""
    symbol_count: int = 0
    run_type: str = "manual"
    horizons: List[int] = Field(default_factory=lambda: [1, 7, 30])
    shard_index: int = 0


class BatchCallbackRequest(BaseModel):
    run_id: str
    shard_id: str
    shard_name: str = ""
    status: str  # completed | failed
    runtime_seconds: Optional[int] = None
    error_type: Optional[str] = None
    error_summary: Optional[str] = None
    artifacts: List[ArtifactCallbackItem] = []


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


@internal_router.get("/internal/ml/runs/{run_id}/artifacts")
async def get_run_artifacts(run_id: str, request: Request, db: Session = Depends(get_db)):
    """List artifacts produced by a run."""
    expected_secret = _get_callback_secret()
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Callback secret not configured on server")
    if not provided_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")
    if not hmac.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=401, detail="Invalid callback secret")

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


# ── Model Version Lifecycle ──────────────────────────────────────────

@router.post("/internal/ml/models/versions/{version}/promote")
async def promote_db_model_version(
    version: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Promote a model version to production (archives current prod)."""
    promoted_by = getattr(user, "username", None) or getattr(user, "email", "api")
    mv = mds.promote_model_version(db, version, promoted_by=promoted_by)
    if not mv:
        raise HTTPException(404, f"Model version '{version}' not found")
    return {
        "message": f"Version {version} promoted to production",
        "model_version": mv.model_version,
        "promotion_status": mv.promotion_status,
        "promoted_by": mv.promoted_by,
    }


@router.post("/internal/ml/models/versions/{version}/archive")
async def archive_db_model_version(
    version: str,
    db: Session = Depends(get_db),
):
    """Archive a model version (remove from staging/production)."""
    from app.models.ml_training import ModelVersion as MV
    mv = db.query(MV).filter(MV.model_version == version).first()
    if not mv:
        raise HTTPException(404, f"Model version '{version}' not found")
    mv.promotion_status = "archived"
    db.commit()
    db.refresh(mv)
    return {
        "message": f"Version {version} archived",
        "model_version": mv.model_version,
        "promotion_status": mv.promotion_status,
    }


# ── Symbol History ───────────────────────────────────────────────────

@router.get("/internal/ml/symbols/{symbol}/history")
async def get_symbol_training_history(
    symbol: str,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get training history for a specific symbol. Falls back to universal model when no per-symbol artifacts."""
    sym = symbol.upper()
    artifacts = mds.get_symbol_history(db, sym, limit=limit)

    # Universal model covers all symbols — fall back so any ticker search returns data
    universal = False
    if not artifacts:
        artifacts = mds.get_symbol_history(db, "universal", limit=limit)
        universal = True

    return {
        "symbol": sym,
        "universal_model": universal,
        "note": f"No per-symbol artifacts for {sym}. Showing universal model metrics (covers all trained symbols)." if universal else None,
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


# ── Internal Machine-to-Machine Endpoints (no user JWT) ─────────────

def _emit_cloudwatch_metric(metric_name: str, value: float = 1.0, unit: str = "Count") -> None:
    """Fire-and-forget CloudWatch metric. Non-fatal if AWS unavailable."""
    try:
        cw = boto3.client("cloudwatch", region_name=os.environ.get("AWS_REGION", "us-east-2"))
        cw.put_metric_data(
            Namespace="QuantTrade/ML",
            MetricData=[{
                "MetricName": metric_name,
                "Value": value,
                "Unit": unit,
                "Dimensions": [{"Name": "Environment", "Value": "production"}],
            }],
        )
    except Exception as e:
        logger.warning("CloudWatch metric failed (non-fatal): %s", e)


@internal_router.post("/internal/ml/batch-start")
async def batch_job_start(
    req: BatchStartRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by Batch container at startup. Upserts run/shard records in Neon for live dashboard."""
    from app.models.ml_training import TrainingShard
    expected_secret = _get_callback_secret()
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret:
        logger.error("ML_CALLBACK_SECRET not configured — batch-start callback rejected (503)")
        raise HTTPException(status_code=503, detail="Callback secret not configured on server")
    if not provided_secret or not hmac.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        run_uid = uuid.UUID(req.run_id)
        shard_uid = uuid.UUID(req.shard_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    # Upsert run — create if SFN bypassed the trigger endpoint
    run = mds.get_run(db, run_uid)
    if not run:
        run = mds.create_run(
            db,
            run_id=run_uid,
            run_type=req.run_type,
            trigger_source="sfn",
            total_symbols=req.symbol_count,
            total_shards=1,
        )
    elif req.symbol_count > 0 and not run.total_symbols:
        run.total_symbols = req.symbol_count
        db.commit()

    # Upsert shard
    shard = db.query(TrainingShard).filter(TrainingShard.shard_id == shard_uid).first()
    if not shard:
        shard = mds.create_shard(
            db,
            shard_id=shard_uid,
            run_id=run_uid,
            shard_index=req.shard_index,
            shard_name=req.shard_name,
            symbol_count=req.symbol_count,
            horizons=req.horizons,
        )

    mds.update_shard_status(db, shard_id=shard_uid, status="running", batch_job_id=req.batch_job_id)

    logger.info("Batch start: run=%s shard=%s job=%s symbols=%d",
                req.run_id[:8], req.shard_id[:8], req.batch_job_id[:8] if req.batch_job_id else "?", req.symbol_count)
    return {"status": "accepted", "run_id": req.run_id, "shard_id": req.shard_id}


@internal_router.post("/internal/ml/batch-callback")
async def batch_job_callback(
    req: BatchCallbackRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by Batch container after training. Updates Neon + emits CloudWatch metric."""
    expected_secret = _get_callback_secret()
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Callback secret not configured on server")
    if not provided_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")
    if not hmac.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        run_uid = uuid.UUID(req.run_id)
        shard_uid = uuid.UUID(req.shard_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    # Upsert run and shard in case batch-start callback was missed
    from app.models.ml_training import TrainingShard as _TrainingShard
    if not mds.get_run(db, run_uid):
        mds.create_run(db, run_id=run_uid, run_type=req.shard_name or "batch",
                       trigger_source="sfn", total_symbols=0, total_shards=1)
        logger.info("Batch callback: auto-created missing run %s", req.run_id[:8])
    if not db.query(_TrainingShard).filter(_TrainingShard.shard_id == shard_uid).first():
        mds.create_shard(db, shard_id=shard_uid, run_id=run_uid, shard_index=0,
                         shard_name=req.shard_name, symbol_count=0, horizons=[1, 7, 30])
        logger.info("Batch callback: auto-created missing shard %s", req.shard_id[:8])

    mds.update_shard_from_callback(
        db,
        shard_id=shard_uid,
        status=req.status,
        runtime_seconds=req.runtime_seconds,
        error_type=req.error_type,
        error_summary=req.error_summary,
    )

    artifacts_written = 0
    for art in req.artifacts:
        try:
            mds.create_artifact(
                db,
                run_id=run_uid,
                shard_id=shard_uid,
                symbol=art.symbol,
                horizon=art.horizon,
                directional_accuracy=art.directional_accuracy,
                information_coefficient=art.information_coefficient,
                hypothetical_sharpe=art.hypothetical_sharpe,
                checkpoint_s3_uri=art.checkpoint_s3_uri,
                metrics_s3_uri=art.metrics_s3_uri,
            )
            artifacts_written += 1
        except Exception as e:
            logger.warning("Failed to write artifact %s h=%s: %s", art.symbol, art.horizon, e)

    metric_name = "ShardSuccess" if req.status == "completed" else "ShardFailure"
    _emit_cloudwatch_metric(metric_name)

    logger.info("Batch callback: run=%s shard=%s status=%s artifacts=%d",
                req.run_id[:8], req.shard_id[:8], req.status, artifacts_written)

    return {
        "status": "accepted",
        "run_id": req.run_id,
        "shard_id": req.shard_id,
        "artifacts_written": artifacts_written,
    }


class FinalizeRunRequest(BaseModel):
    status: str  # completed | partial_failure | failed
    success_shards: int = 0
    failed_shards: int = 0
    total_shards: int = 0


@internal_router.post("/internal/ml/runs/{run_id}/finalize")
async def finalize_run(
    run_id: str,
    req: FinalizeRunRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by ml-result-aggregator Lambda after all shards complete."""
    expected_secret = _get_callback_secret()
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Callback secret not configured on server")
    if not provided_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")
    if not hmac.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id")

    run = mds.update_run_status(
        db,
        run_id=uid,
        status=req.status,
        success_shards=req.success_shards,
        failed_shards=req.failed_shards,
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return {"status": "accepted", "run_id": run_id, "new_status": req.status}


class PromoteRunRequest(BaseModel):
    model_version: str
    avg_da: float
    avg_ic: float
    promotion_status: str = "production"  # "production" | "staging"


@internal_router.post("/internal/ml/runs/{run_id}/promote")
async def promote_run_model(
    run_id: str,
    req: PromoteRunRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Called by ml-auto-promote Lambda to register new model version (staging or production)."""
    expected_secret = _get_callback_secret()
    provided_secret = request.headers.get("X-ML-Callback-Secret", "")
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Callback secret not configured on server")
    if not provided_secret:
        raise HTTPException(status_code=401, detail="Invalid callback secret")
    if not hmac.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=401, detail="Invalid callback secret")

    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id")

    from app.models.ml_training import ModelVersion as MV, TrainingRun
    from datetime import datetime, timezone

    # Fetch symbol count from the training run
    run = db.query(TrainingRun).filter(TrainingRun.run_id == uid).first()
    symbol_count = (run.total_symbols or 0) if run else 0

    # Only demote current production when promoting a new production version
    if req.promotion_status == "production":
        current_prod = db.query(MV).filter(MV.promotion_status == "production").first()
        if current_prod:
            current_prod.promotion_status = "archived"
            db.commit()

    new_mv = MV(
        model_version=req.model_version,
        run_id=uid,
        promotion_status=req.promotion_status,
        avg_directional_accuracy=req.avg_da,
        avg_information_coefficient=req.avg_ic,
        horizons=[1, 7, 30],
        symbol_count=symbol_count,
        promoted_at=datetime.now(timezone.utc),
        promoted_by="auto-promote-lambda",
    )
    db.add(new_mv)
    db.commit()

    logger.info(
        "Registered model %s as %s (DA=%.3f IC=%.3f symbols=%d)",
        req.model_version, req.promotion_status, req.avg_da, req.avg_ic, symbol_count,
    )
    return {"status": "accepted", "model_version": req.model_version, "promotion_status": req.promotion_status}


@router.post("/internal/ml/runs/{run_id}/register-staging")
async def register_staging_for_run(
    run_id: str,
    db: Session = Depends(get_db),
    user=Depends(require_auth),
):
    """
    Manually register a completed training run as a staging model version.
    Used when the auto-promote Lambda ran but thresholds were not met — allows
    admins to make the trained model visible in the Models tab without promotion.
    """
    from app.models.ml_training import ModelVersion as MV, TrainingRun, TrainingArtifact
    from datetime import datetime, timezone

    try:
        uid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id")

    run = db.query(TrainingRun).filter(TrainingRun.run_id == uid).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status not in ("completed", "partial_failure"):
        raise HTTPException(status_code=400, detail=f"Run status is '{run.status}' — only completed runs can be staged")

    # Check if a version already exists for this run
    existing = db.query(MV).filter(MV.run_id == uid).first()
    if existing:
        return {
            "status": "already_registered",
            "model_version": existing.model_version,
            "promotion_status": existing.promotion_status,
        }

    artifacts = db.query(TrainingArtifact).filter(TrainingArtifact.run_id == uid).all()
    das = [a.directional_accuracy for a in artifacts if a.directional_accuracy is not None]
    ics = [a.information_coefficient for a in artifacts if a.information_coefficient is not None]
    avg_da = sum(das) / len(das) if das else 0.0
    avg_ic = sum(ics) / len(ics) if ics else 0.0

    now = datetime.now(timezone.utc)
    version = f"v{now.strftime('%Y%m%d_%H%M')}"
    promoted_by = getattr(user, "username", None) or getattr(user, "email", "admin")

    new_mv = MV(
        model_version=version,
        run_id=uid,
        promotion_status="staging",
        avg_directional_accuracy=avg_da,
        avg_information_coefficient=avg_ic,
        horizons=sorted({a.horizon for a in artifacts}) or [1, 7, 30],
        symbol_count=run.total_symbols or 0,
        promoted_at=now,
        promoted_by=promoted_by,
    )
    db.add(new_mv)
    db.commit()

    logger.info("Manually staged run %s as %s by %s (DA=%.3f IC=%.3f)", run_id[:8], version, promoted_by, avg_da, avg_ic)
    return {"status": "staged", "model_version": version, "avg_da": avg_da, "avg_ic": avg_ic}


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


@router.get("/internal/ml/dashboard")
async def ml_dashboard(db: Session = Depends(get_db)):
    """Unified dashboard snapshot: model counts, run stats, latest run — all from Neon DB."""
    import asyncio
    from datetime import datetime, timezone

    # Metrics summary (7-day window)
    raw = mds.get_metrics_summary(db, days=7)
    total_runs = raw.get("total_runs", 0)
    completed_runs = raw.get("completed_runs", 0)
    success_rate = (completed_runs / total_runs * 100) if total_runs > 0 else 0.0

    # Production model versions
    prod_versions = mds.list_model_versions(db, status="production", limit=10)
    symbols_covered = sum(getattr(v, "symbol_count", 0) or 0 for v in prod_versions)
    avg_da_vals = [v.avg_directional_accuracy for v in prod_versions if v.avg_directional_accuracy]
    avg_ic_vals = [v.avg_information_coefficient for v in prod_versions if v.avg_information_coefficient]
    avg_da = (sum(avg_da_vals) / len(avg_da_vals)) if avg_da_vals else None
    avg_ic = (sum(avg_ic_vals) / len(avg_ic_vals)) if avg_ic_vals else None

    # Latest run
    runs = mds.list_runs(db, limit=1)
    latest = runs[0] if runs else None

    # Fall back to latest completed run's symbol count when no production models
    if not symbols_covered and latest:
        symbols_covered = latest.total_symbols or 0

    return {
        "models_production": len(prod_versions),
        "runs_7d": total_runs,
        "success_rate": round(success_rate, 1),
        "symbols_covered": symbols_covered,
        "avg_da": round(avg_da, 4) if avg_da is not None else None,
        "avg_ic": round(avg_ic, 4) if avg_ic is not None else None,
        "latest_run": {
            "run_id": str(latest.run_id),
            "status": latest.status,
            "run_type": latest.run_type,
            "total_symbols": latest.total_symbols or 0,
            "total_shards": latest.total_shards or 0,
            "success_shards": latest.success_shards or 0,
            "failed_shards": latest.failed_shards or 0,
            "started_at": latest.started_at.isoformat() if latest.started_at else None,
            "ended_at": latest.ended_at.isoformat() if latest.ended_at else None,
        } if latest else None,
        "prod_models": [
            {
                "model_version": v.model_version,
                "avg_da": v.avg_directional_accuracy,
                "avg_ic": v.avg_information_coefficient,
                "promoted_at": v.promoted_at.isoformat() if v.promoted_at else None,
            }
            for v in prod_versions
        ],
    }


@router.get("/internal/ml/stream")
async def ml_stream(request: Request):
    """Server-Sent Events stream: Neon DB + AWS Batch + Step Functions + CloudWatch logs."""
    import asyncio
    import json
    from datetime import datetime, timezone
    from fastapi.responses import StreamingResponse
    from app.db.database import SessionLocal

    AWS_REGION = os.environ.get("AWS_REGION", "us-east-2")
    BATCH_QUEUE = "ml-training-queue-production"
    SFN_ARN = "arn:aws:states:us-east-2:688282503628:stateMachine:ml-nightly-pipeline-production"
    CW_LOG_GROUP = "/aws/batch/ml-training-production"
    KEY_PATTERNS = [
        "horizon", "phase", "epoch", "Epoch", "callback",
        "ERROR", "RuntimeError", "FAILED", "completed", "status",
        "DA=", "IC=", "Training h=", "Device:", "Model:",
    ]

    async def _fetch_batch():
        """Fetch Batch job counts per status."""
        counts = {"runnable": 0, "starting": 0, "running": 0, "succeeded": 0, "failed": 0}
        try:
            def _call():
                client = boto3.client("batch", region_name=AWS_REGION)
                result = {}
                for status in ("RUNNABLE", "STARTING", "RUNNING", "SUCCEEDED", "FAILED"):
                    resp = client.list_jobs(jobQueue=BATCH_QUEUE, jobStatus=status, maxResults=100)
                    result[status.lower()] = len(resp.get("jobSummaryList", []))
                return result
            data = await asyncio.to_thread(_call)
            counts.update(data)
        except Exception as e:
            logger.warning("Batch list_jobs failed (non-fatal): %s", e)
        return counts

    async def _fetch_sfn():
        """Fetch latest Step Functions execution."""
        try:
            def _call():
                client = boto3.client("stepfunctions", region_name=AWS_REGION)
                resp = client.list_executions(stateMachineArn=SFN_ARN, maxResults=1)
                execs = resp.get("executions", [])
                if not execs:
                    return {"name": "", "status": "IDLE", "start_date": None}
                ex = execs[0]
                return {
                    "name": ex.get("name", ""),
                    "status": ex.get("status", ""),
                    "start_date": ex.get("startDate").isoformat() if ex.get("startDate") else None,
                }
            return await asyncio.to_thread(_call)
        except Exception as e:
            logger.warning("SFN list_executions failed (non-fatal): %s", e)
            return {"name": "", "status": "ERROR", "start_date": None, "error": str(e)[:120]}

    async def _fetch_logs(batch_job_id: str):
        """Fetch last 30 CloudWatch log events for a Batch job, filtered by key patterns."""
        try:
            def _call():
                batch_client = boto3.client("batch", region_name=AWS_REGION)
                logs_client = boto3.client("logs", region_name=AWS_REGION)

                # Resolve actual log stream name from job descriptor
                jobs_resp = batch_client.describe_jobs(jobs=[batch_job_id])
                jobs_list = jobs_resp.get("jobs", [])
                if not jobs_list:
                    return []
                log_stream = jobs_list[0].get("container", {}).get("logStreamName", "")
                if not log_stream:
                    return []

                resp = logs_client.get_log_events(
                    logGroupName=CW_LOG_GROUP,
                    logStreamName=log_stream,
                    limit=30,
                    startFromHead=False,
                )
                return [
                    {"ts": e["timestamp"], "msg": e["message"]}
                    for e in resp.get("events", [])
                    if any(p in e.get("message", "") for p in KEY_PATTERNS)
                ]
            return await asyncio.to_thread(_call)
        except Exception as e:
            logger.warning("CloudWatch get_log_events failed (non-fatal): %s", e)
            return []

    async def event_generator():
        while True:
            if await request.is_disconnected():
                break

            # Open a fresh DB session per tick
            db = SessionLocal()
            try:
                # Neon DB queries
                runs = mds.list_runs(db, status="running", limit=1)
                latest_run = runs[0] if runs else None

                if not latest_run:
                    # Fall back to most recent run of any status
                    all_runs = mds.list_runs(db, limit=1)
                    latest_run = all_runs[0] if all_runs else None

                run_payload = None
                shards_payload = []
                running_shard_job_id = None

                if latest_run:
                    run_payload = {
                        "run_id": str(latest_run.run_id),
                        "status": latest_run.status,
                        "total_symbols": latest_run.total_symbols or 0,
                        "total_shards": latest_run.total_shards or 0,
                        "success_shards": latest_run.success_shards or 0,
                        "failed_shards": latest_run.failed_shards or 0,
                        "started_at": latest_run.started_at.isoformat() if latest_run.started_at else None,
                    }
                    shards = mds.get_shards_for_run(db, latest_run.run_id)
                    shards_payload = [
                        {
                            "shard_id": str(s.shard_id),
                            "shard_name": s.shard_name,
                            "status": s.status,
                            "batch_job_id": s.batch_job_id if hasattr(s, "batch_job_id") else None,
                            "runtime_seconds": s.runtime_seconds,
                        }
                        for s in shards
                    ]
                    # Find a running shard with a batch_job_id for log tailing
                    for s in shards:
                        job_id = s.batch_job_id if hasattr(s, "batch_job_id") else None
                        if s.status == "running" and job_id:
                            running_shard_job_id = job_id
                            break

                # Production models
                prod_versions = mds.list_model_versions(db, status="production", limit=5)
                models_payload = [
                    {
                        "model_version": v.model_version,
                        "avg_da": v.avg_directional_accuracy,
                        "avg_ic": v.avg_information_coefficient,
                        "promoted_at": v.promoted_at.isoformat() if v.promoted_at else None,
                    }
                    for v in prod_versions
                ]
                # Staging models (for pipeline flow Lambda status)
                staging_versions = mds.list_model_versions(db, status="staging", limit=5)
                staging_payload = [
                    {
                        "model_version": v.model_version,
                        "avg_da": v.avg_directional_accuracy,
                        "avg_ic": v.avg_information_coefficient,
                        "promoted_at": v.promoted_at.isoformat() if v.promoted_at else None,
                        "symbol_count": v.symbol_count,
                    }
                    for v in staging_versions
                ]
            except Exception as e:
                logger.warning("DB query in SSE tick failed (non-fatal): %s", e)
                run_payload = None
                shards_payload = []
                running_shard_job_id = None
                models_payload = []
                staging_payload = []
            finally:
                db.close()

            # AWS calls (parallel)
            batch_task = asyncio.create_task(_fetch_batch())
            sfn_task = asyncio.create_task(_fetch_sfn())
            async def _empty_logs():
                return []

            logs_task = asyncio.create_task(
                _fetch_logs(running_shard_job_id) if running_shard_job_id else _empty_logs()
            )

            batch_data, sfn_data, logs_data = await asyncio.gather(
                batch_task, sfn_task, logs_task, return_exceptions=True
            )

            payload = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "run": run_payload,
                "shards": shards_payload,
                "batch": batch_data if isinstance(batch_data, dict) else {"runnable": 0, "starting": 0, "running": 0, "succeeded": 0, "failed": 0},
                "sfn": sfn_data if isinstance(sfn_data, dict) else None,
                "logs": logs_data if isinstance(logs_data, list) else [],
                "models": models_payload,
                "staging": staging_payload,
            }

            yield f"data: {json.dumps(payload)}\n\n"

            # Sleep 8 seconds, checking for disconnect
            for _ in range(8):
                if await request.is_disconnected():
                    return
                await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
