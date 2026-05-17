"""
ML Pipeline Orchestrator — end-to-end ML lifecycle management.

Pipeline stages:
  1. Data Fetch → Feature Store
  2. Data Validation → Quality Reports
  3. Feature Computation → Feature Store
  4. Model Training → Experiment Tracker
  5. Evaluation → Metrics
  6. Drift Detection → Drift Reports
  7. Model Registration → Model Registry
  8. Promotion → Staging → Production

Can be triggered by:
  - Celery scheduled task (nightly)
  - Manual API call
  - Drift-triggered retraining
"""
import logging
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    pipeline_id: str
    status: str  # completed, failed, partial
    started_at: str
    completed_at: Optional[str] = None
    stages: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


class MLPipeline:
    """Orchestrate the full ML training and deployment pipeline."""

    def run_full_pipeline(
        self,
        symbols: Optional[List[str]] = None,
        horizons: Optional[List[int]] = None,
        force_retrain: bool = False,
        config_path: str = "configs/train_default.yaml",
    ) -> PipelineResult:
        """
        Run the complete ML pipeline.

        Steps:
        1. Fetch data + compute features (Feature Store)
        2. Validate data quality
        3. Check for drift (skip training if no drift and not forced)
        4. Train models for each horizon
        5. Evaluate against baselines
        6. Register models
        7. Auto-promote if metrics beat production
        """
        import uuid
        from ml.reproducibility import set_global_seed, get_reproducibility_info
        from ml.feature_store import feature_store
        from ml.data_quality import validate_features
        from ml.drift_detector import drift_detector
        from ml.experiment_tracker import experiment_tracker
        from ml.model_registry import model_registry
        from ml.constants import FEATURE_COLUMNS, TIER_1_SYMBOLS

        pipeline_id = f"pipeline_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        result = PipelineResult(
            pipeline_id=pipeline_id,
            status="running",
            started_at=datetime.now(timezone.utc).isoformat(),
        )

        symbols = symbols or TIER_1_SYMBOLS
        horizons = horizons or [7]
        set_global_seed(42)

        logger.info(f"Pipeline {pipeline_id}: starting with {len(symbols)} symbols, horizons={horizons}")

        # ── Stage 1: Feature Store ──────────────────────────────
        try:
            t0 = time.time()
            store_results = feature_store.batch_compute(symbols, period="5y", force=force_retrain)
            successful = sum(1 for v in store_results.values() if v is not None)
            result.stages["feature_store"] = {
                "status": "completed",
                "symbols_requested": len(symbols),
                "symbols_computed": successful,
                "duration_s": round(time.time() - t0, 2),
            }
            logger.info(f"Stage 1 (Feature Store): {successful}/{len(symbols)} symbols computed")
        except Exception as e:
            result.stages["feature_store"] = {"status": "failed", "error": str(e)}
            result.errors.append(f"Feature store failed: {e}")
            result.status = "failed"
            result.completed_at = datetime.now(timezone.utc).isoformat()
            return result

        # ── Stage 2: Data Validation ────────────────────────────
        try:
            t0 = time.time()
            quality_pass = 0
            quality_fail = 0
            for sym in symbols:
                features = feature_store.get_features(sym, lookback=9999)
                if features is not None:
                    report = validate_features(features, list(FEATURE_COLUMNS), sym)
                    if report.passed:
                        quality_pass += 1
                    else:
                        quality_fail += 1
                        logger.warning(f"Quality check failed for {sym}: {report.errors}")
            result.stages["data_validation"] = {
                "status": "completed",
                "passed": quality_pass,
                "failed": quality_fail,
                "duration_s": round(time.time() - t0, 2),
            }
        except Exception as e:
            result.stages["data_validation"] = {"status": "failed", "error": str(e)}
            result.errors.append(f"Data validation failed: {e}")

        # ── Stage 3: Drift Detection ───────────────────────────
        try:
            t0 = time.time()
            drift_reports = {}
            needs_retrain = force_retrain
            for sym in symbols[:5]:  # Check drift on a sample
                baseline = feature_store.get_baseline_stats(sym)
                current = feature_store.get_features(sym, lookback=60)
                if baseline and current is not None:
                    stats = baseline.get("stats", {})
                    report = drift_detector.generate_report(sym, stats, current, list(FEATURE_COLUMNS))
                    drift_reports[sym] = report.overall_drift
                    if report.requires_retrain:
                        needs_retrain = True

            result.stages["drift_detection"] = {
                "status": "completed",
                "symbols_checked": len(drift_reports),
                "drift_levels": drift_reports,
                "retrain_triggered": needs_retrain,
                "duration_s": round(time.time() - t0, 2),
            }

            if not needs_retrain:
                logger.info("No significant drift detected and force_retrain=False. Skipping training.")
                result.stages["training"] = {"status": "skipped", "reason": "no_drift"}
                result.status = "completed"
                result.completed_at = datetime.now(timezone.utc).isoformat()
                result.summary = {"action": "no_retrain", "drift": drift_reports}
                return result

        except Exception as e:
            result.stages["drift_detection"] = {"status": "failed", "error": str(e)}
            needs_retrain = True  # Train anyway if drift check fails

        # ── Stage 4: Model Training ────────────────────────────
        try:
            t0 = time.time()
            from ml.train import train_single_horizon
            from ml.config import TrainConfig

            # Load config — use TrainConfig.from_yaml when file exists,
            # otherwise fall back to defaults with overridden symbols.
            try:
                config = TrainConfig.from_yaml(config_path)
            except FileNotFoundError:
                logger.warning(f"Config {config_path} not found, using defaults")
                config = TrainConfig()

            # Override symbols from pipeline call
            config.symbols = list(symbols)

            training_results = {}
            for horizon in horizons:
                run = experiment_tracker.start_run(
                    name=f"lstm_h{horizon}_{datetime.now(timezone.utc).strftime('%Y%m%d')}",
                    config={
                        "horizon": horizon,
                        "symbols": symbols,
                        "config": config.config_hash(),
                        "env": get_reproducibility_info(),
                    },
                    tags={"horizon": str(horizon), "pipeline": pipeline_id},
                )

                try:
                    metrics = train_single_horizon(config, horizon)
                    experiment_tracker.log_metrics(metrics)

                    # Find the checkpoint that was just created
                    from ml.checkpoint import find_latest_checkpoint
                    ckpt = find_latest_checkpoint(horizon=horizon)
                    ckpt_str = str(ckpt) if ckpt else None

                    if ckpt_str:
                        experiment_tracker.log_artifact(ckpt_str)

                        # Register in model registry
                        mv = model_registry.register_model(
                            name=f"lstm_h{horizon}",
                            checkpoint_path=ckpt_str,
                            metrics=metrics,
                            config={"config_hash": config.config_hash()},
                            experiment_run_id=run.id,
                            horizon=horizon,
                            description=f"LSTM {horizon}-day prediction, trained {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
                        )
                        training_results[f"h{horizon}"] = {
                            "status": "completed",
                            "metrics": metrics,
                            "model_version": mv.version,
                            "checkpoint": ckpt_str,
                        }
                    else:
                        training_results[f"h{horizon}"] = {
                            "status": "completed",
                            "metrics": metrics,
                            "checkpoint": None,
                        }

                    experiment_tracker.end_run(status="completed")

                except Exception as e:
                    experiment_tracker.fail_run(str(e))
                    training_results[f"h{horizon}"] = {"status": "failed", "error": str(e)}
                    result.errors.append(f"Training h{horizon} failed: {e}")

            result.stages["training"] = {
                "status": "completed",
                "horizons": training_results,
                "duration_s": round(time.time() - t0, 2),
            }

        except Exception as e:
            result.stages["training"] = {"status": "failed", "error": str(e)}
            result.errors.append(f"Training stage failed: {e}")

        # ── Stage 5: Auto-Promote ──────────────────────────────
        try:
            for horizon in horizons:
                model_name = f"lstm_h{horizon}"
                versions = model_registry.list_versions(model_name)
                if len(versions) >= 1:
                    latest = versions[-1]
                    current_prod = model_registry.get_production_model(model_name)

                    should_promote = False
                    if current_prod is None:
                        should_promote = True  # First model, auto-promote
                    elif latest.metrics.get("directional_accuracy", 0) > current_prod.metrics.get("directional_accuracy", 0):
                        should_promote = True  # Better than current

                    if should_promote and latest.stage != "production":
                        model_registry.promote(model_name, latest.version, "production")
                        logger.info(f"Auto-promoted {model_name} v{latest.version} to production")

            result.stages["promotion"] = {"status": "completed"}
        except Exception as e:
            result.stages["promotion"] = {"status": "failed", "error": str(e)}

        result.status = "completed" if not result.errors else "partial"
        result.completed_at = datetime.now(timezone.utc).isoformat()
        result.summary = {
            "symbols": len(symbols),
            "horizons": horizons,
            "stages_completed": sum(1 for s in result.stages.values() if s.get("status") == "completed"),
            "stages_failed": sum(1 for s in result.stages.values() if s.get("status") == "failed"),
            "errors": len(result.errors),
        }

        logger.info(f"Pipeline {pipeline_id} completed: {result.summary}")
        return result


# Module-level singleton
ml_pipeline = MLPipeline()
