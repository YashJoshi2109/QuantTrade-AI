"""
MLOps API endpoints — model management, monitoring, and pipeline control.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel

from app.db.database import get_db
from app.api.auth import require_auth
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_auth)])


# ── Model Registry ──────────────────────────────────────────────────────

@router.get("/mlops/models")
async def list_models():
    """List all registered models."""
    try:
        from ml.model_registry import model_registry
        models = model_registry.list_models()
        result = {}
        for name in models:
            try:
                versions = model_registry.list_versions(name)
                prod = model_registry.get_production_model(name)
                result[name] = {
                    "total_versions": len(versions),
                    "production_version": prod.version if prod else None,
                    "latest_version": versions[-1].version if versions else None,
                }
            except Exception as e:
                logger.warning("model_registry.list_versions(%s) failed: %s", name, e)
        return {"models": result}
    except Exception as e:
        logger.warning("model_registry unavailable: %s", e)
        return {"models": {}}


@router.get("/mlops/models/{model_name}")
async def get_model_versions(model_name: str):
    """Get all versions of a model."""
    from ml.model_registry import model_registry
    from dataclasses import asdict
    versions = model_registry.list_versions(model_name)
    if not versions:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")
    return {"model": model_name, "versions": [asdict(v) for v in versions]}


@router.get("/mlops/models/{model_name}/card")
async def get_model_card(model_name: str, version: int = Query(None)):
    """Get model card documentation."""
    from ml.model_registry import model_registry
    from dataclasses import asdict
    if version is None:
        prod = model_registry.get_production_model(model_name)
        version = prod.version if prod else 1
    card = model_registry.generate_model_card(model_name, version)
    if not card:
        raise HTTPException(status_code=404, detail="Model version not found")
    return asdict(card)


@router.post("/mlops/models/{model_name}/promote")
async def promote_model(
    model_name: str,
    version: int = Query(...),
    stage: str = Query("production"),
    user: User = Depends(require_auth),
):
    """Promote a model version to a stage."""
    from ml.model_registry import model_registry
    from dataclasses import asdict
    mv = model_registry.promote(model_name, version, stage)
    if not mv:
        raise HTTPException(status_code=404, detail="Model version not found")
    return {"message": f"Promoted {model_name} v{version} to {stage}", "model": asdict(mv)}


@router.post("/mlops/models/{model_name}/rollback")
async def rollback_model(
    model_name: str,
    user: User = Depends(require_auth),
):
    """Rollback to previous production version."""
    from ml.model_registry import model_registry
    from dataclasses import asdict
    mv = model_registry.rollback(model_name)
    if not mv:
        raise HTTPException(status_code=400, detail="No previous version to rollback to")
    return {"message": f"Rolled back {model_name} to v{mv.version}", "model": asdict(mv)}


# ── Experiments ─────────────────────────────────────────────────────────

@router.get("/mlops/experiments")
async def list_experiments(limit: int = Query(20, ge=1, le=100)):
    """List recent experiment runs."""
    from ml.experiment_tracker import experiment_tracker
    runs = experiment_tracker.list_runs(limit=limit)
    return {"experiments": runs, "total": len(runs)}


@router.get("/mlops/experiments/{run_id}")
async def get_experiment(run_id: str):
    """Get details of a specific experiment run."""
    from ml.experiment_tracker import experiment_tracker
    run = experiment_tracker.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return run


@router.get("/mlops/experiments/compare")
async def compare_experiments(
    run_ids: str = Query(..., description="Comma-separated run IDs"),
    metrics: Optional[str] = Query(None, description="Comma-separated metric keys"),
):
    """Compare metrics across experiment runs."""
    from ml.experiment_tracker import experiment_tracker
    ids = [r.strip() for r in run_ids.split(",")]
    metric_keys = [m.strip() for m in metrics.split(",")] if metrics else None
    return {"comparison": experiment_tracker.compare_runs(ids, metric_keys)}


# ── Monitoring ──────────────────────────────────────────────────────────

@router.get("/mlops/monitoring/drift/{symbol}")
async def get_drift_report(symbol: str):
    """Get latest drift report for a symbol."""
    from ml.drift_detector import drift_detector
    from dataclasses import asdict
    report = drift_detector.get_latest_report(symbol)
    if not report:
        return {"symbol": symbol, "status": "no_report", "message": "No drift report available. Run drift check first."}
    return asdict(report)


@router.get("/mlops/monitoring/predictions")
async def get_predictions(
    symbol: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
):
    """Get recent predictions with outcomes."""
    from ml.prediction_logger import prediction_logger
    predictions = prediction_logger.get_recent_predictions(symbol=symbol, limit=limit)
    stats = prediction_logger.get_stats()
    return {"predictions": predictions, "stats": stats}


@router.get("/mlops/monitoring/performance")
async def get_performance(
    model_name: str = Query("lstm_h1"),
    window_days: int = Query(30, ge=1, le=365),
):
    """Get model performance snapshot."""
    from ml.prediction_logger import prediction_logger
    from ml.performance_monitor import performance_monitor
    from dataclasses import asdict

    predictions = prediction_logger.get_recent_predictions(limit=500)
    snapshot = performance_monitor.evaluate(predictions, model_name, window_days)
    should_retrain, reason = performance_monitor.should_retrain(snapshot)

    return {
        "performance": asdict(snapshot),
        "should_retrain": should_retrain,
        "retrain_reason": reason,
    }


@router.get("/mlops/monitoring/alerts")
async def get_alerts(level: Optional[str] = Query(None)):
    """Get performance alerts."""
    from ml.performance_monitor import performance_monitor
    from dataclasses import asdict
    alerts = performance_monitor.get_alerts(level)
    return {"alerts": [asdict(a) for a in alerts]}


# ── Feature Store ───────────────────────────────────────────────────────

@router.get("/mlops/features/symbols")
async def list_feature_symbols():
    """List all symbols in the feature store."""
    from ml.feature_store import feature_store
    symbols = feature_store.list_symbols()
    return {"symbols": symbols, "total": len(symbols), "schema_version": feature_store.schema_version}


@router.get("/mlops/features/{symbol}")
async def get_feature_stats(symbol: str):
    """Get feature statistics for a symbol."""
    from ml.feature_store import feature_store
    stats = feature_store.get_baseline_stats(symbol)
    if not stats:
        raise HTTPException(status_code=404, detail=f"No features for {symbol}")
    return stats


@router.post("/mlops/features/refresh")
async def refresh_features(
    symbols: Optional[List[str]] = None,
    user: User = Depends(require_auth),
):
    """Trigger feature store refresh."""
    from ml.feature_store import feature_store
    from ml.constants import TIER_1_SYMBOLS
    syms = symbols or TIER_1_SYMBOLS[:5]
    results = feature_store.batch_compute(syms, force=True, max_workers=2)
    successful = sum(1 for v in results.values() if v is not None)
    return {"refreshed": successful, "total": len(syms), "symbols": list(results.keys())}


# ── Pipeline ────────────────────────────────────────────────────────────

@router.post("/mlops/pipeline/run")
async def run_pipeline(
    force: bool = Query(False),
    user: User = Depends(require_auth),
):
    """Trigger the ML training pipeline (async via Celery)."""
    try:
        from app.tasks.ml_tasks import ml_run_pipeline
        task = ml_run_pipeline.delay(force=force)
        return {"message": "Pipeline started", "task_id": task.id}
    except Exception as e:
        # Run synchronously if Celery not available
        from ml.pipeline import ml_pipeline
        from dataclasses import asdict
        result = ml_pipeline.run_full_pipeline(force_retrain=force)
        return {"message": "Pipeline completed (sync)", "result": asdict(result)}


@router.get("/mlops/overview")
async def mlops_overview():
    """Get a high-level MLOps dashboard summary. Each service is fault-isolated."""
    result = {
        "models": {"registered": 0, "production": {}},
        "experiments": {"total_runs": 0},
        "feature_store": {"symbols": 0, "schema_version": "v1"},
        "predictions": {"total": 0},
        "alerts": 0,
        "service_errors": [],
    }

    try:
        from ml.model_registry import model_registry
        models = model_registry.list_models()
        prod_models = {}
        for name in models:
            try:
                prod = model_registry.get_production_model(name)
                if prod:
                    prod_models[name] = {"version": prod.version, "stage": prod.stage, "metrics": prod.metrics}
            except Exception:
                pass
        result["models"] = {"registered": len(models), "production": prod_models}
    except Exception as e:
        logger.warning("model_registry unavailable: %s", e)
        result["service_errors"].append("model_registry")

    try:
        from ml.experiment_tracker import experiment_tracker
        result["experiments"] = {"total_runs": len(experiment_tracker.list_runs(limit=100))}
    except Exception as e:
        logger.warning("experiment_tracker unavailable: %s", e)
        result["service_errors"].append("experiment_tracker")

    try:
        from ml.feature_store import feature_store
        result["feature_store"] = {
            "symbols": len(feature_store.list_symbols()),
            "schema_version": feature_store.schema_version,
        }
    except Exception as e:
        logger.warning("feature_store unavailable: %s", e)
        result["service_errors"].append("feature_store")

    try:
        from ml.prediction_logger import prediction_logger
        result["predictions"] = prediction_logger.get_stats()
    except Exception as e:
        logger.warning("prediction_logger unavailable: %s", e)
        result["service_errors"].append("prediction_logger")

    try:
        from ml.performance_monitor import performance_monitor
        result["alerts"] = len(performance_monitor.get_alerts())
    except Exception as e:
        logger.warning("performance_monitor unavailable: %s", e)
        result["service_errors"].append("performance_monitor")

    return result
