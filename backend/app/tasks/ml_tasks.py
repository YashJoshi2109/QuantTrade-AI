"""
Celery tasks for MLOps pipeline operations.
"""
import logging
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="ml_drift_check")
def ml_drift_check():
    """Check for feature drift on key symbols. Runs every 6 hours."""
    try:
        from ml.feature_store import feature_store
        from ml.drift_detector import drift_detector
        from ml.constants import FEATURE_COLUMNS, TIER_1_SYMBOLS

        results = {}
        retrain_needed = False

        for sym in TIER_1_SYMBOLS[:5]:
            baseline = feature_store.get_baseline_stats(sym)
            current = feature_store.get_features(sym, lookback=60)
            if baseline and current is not None:
                stats = baseline.get("stats", {})
                report = drift_detector.generate_report(sym, stats, current, list(FEATURE_COLUMNS))
                results[sym] = report.overall_drift
                if report.requires_retrain:
                    retrain_needed = True

        if retrain_needed:
            logger.warning("DRIFT ALERT: Retraining recommended based on feature drift")
            # Could trigger ml_pipeline.run_full_pipeline() here

        return {"status": "completed", "drift_results": results, "retrain_needed": retrain_needed}

    except Exception as e:
        logger.error(f"Drift check failed: {e}")
        return {"status": "error", "error": str(e)}


@celery_app.task(name="ml_performance_check")
def ml_performance_check():
    """Check model performance against thresholds. Runs daily."""
    try:
        from ml.prediction_logger import prediction_logger
        from ml.performance_monitor import performance_monitor

        stats = prediction_logger.get_stats()
        alerts = []

        for model_name in stats:
            predictions = prediction_logger.get_recent_predictions(limit=200)
            snapshot = performance_monitor.evaluate(predictions, model_name, window_days=7)

            should_retrain, reason = performance_monitor.should_retrain(snapshot)
            if should_retrain:
                alerts.append({"model": model_name, "reason": reason})
                logger.warning(f"PERFORMANCE ALERT: {model_name} — {reason}")

        return {
            "status": "completed",
            "models_checked": len(stats),
            "alerts": alerts,
        }

    except Exception as e:
        logger.error(f"Performance check failed: {e}")
        return {"status": "error", "error": str(e)}


@celery_app.task(name="ml_run_pipeline", bind=True, max_retries=1)
def ml_run_pipeline(self, symbols=None, horizons=None, force=False):
    """
    Run the full ML training pipeline.
    Triggered manually or by drift/performance alerts.
    """
    try:
        from ml.pipeline import ml_pipeline

        result = ml_pipeline.run_full_pipeline(
            symbols=symbols,
            horizons=horizons,
            force_retrain=force,
        )

        return {
            "status": result.status,
            "pipeline_id": result.pipeline_id,
            "summary": result.summary,
            "errors": result.errors,
        }

    except Exception as e:
        logger.error(f"ML pipeline failed: {e}")
        raise self.retry(exc=e, countdown=600)


@celery_app.task(name="ml_feature_refresh")
def ml_feature_refresh(symbols=None):
    """Refresh feature store for given symbols (or all)."""
    try:
        from ml.feature_store import feature_store
        from ml.constants import TIER_1_SYMBOLS

        symbols = symbols or TIER_1_SYMBOLS
        results = feature_store.batch_compute(symbols, force=True)
        successful = sum(1 for v in results.values() if v is not None)

        return {"status": "completed", "refreshed": successful, "total": len(symbols)}

    except Exception as e:
        logger.error(f"Feature refresh failed: {e}")
        return {"status": "error", "error": str(e)}
