"""Batch job entrypoint for ML training shards.

Designed to run inside AWS Batch or any container runtime.
Reads configuration from environment variables, downloads manifest from S3,
trains models, uploads artifacts, and updates metadata.

Exit codes:
    0 = success
    1 = data error (bad manifest, no valid symbols)
    2 = training error (model training failed)
    3 = infrastructure error (S3, Neon, etc.)

Usage:
    # With manifest from S3
    MANIFEST_S3_URI=s3://bucket/manifests/run/shard.json python -m ml.entrypoint

    # With tier (fallback for GH Actions bridge)
    ML_SYMBOL_TIER=tier_2 ML_RUN_ID=abc123 python -m ml.entrypoint
"""

from __future__ import annotations

import logging
import sys
import time
import uuid

from pathlib import Path

from ml.batch_config import BatchConfig
from ml.structured_logger import LogContext, reset_structured_logger

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ml.entrypoint")


def run_shard(config: BatchConfig) -> tuple[int, int]:
    """Execute a single training shard. Returns (exit_code, duration_seconds)."""
    from ml.config import TrainConfig
    from ml.constants import DEFAULT_CONFIG_PATH, SYMBOL_TIERS
    from ml.train import train

    # Initialize structured logging
    slog = reset_structured_logger(LogContext(
        run_id=config.run_id,
        shard_id=config.shard_id,
        shard_name=config.shard_name,
        trigger_source=config.trigger_source,
    ))

    slog.info("entrypoint", "started", extra={
        "config": config.summary(),
    })

    start_time = time.monotonic()

    try:
        # ── Load training config ──────────────────────────────────────
        config_path = Path(config.config_path)
        if not config_path.exists():
            config_path = DEFAULT_CONFIG_PATH

        if config_path.exists():
            train_config = TrainConfig.from_yaml(config_path)
        else:
            train_config = TrainConfig()

        # ── Resolve symbols ───────────────────────────────────────────
        symbols: list[str] = []

        if config.has_manifest:
            # Download manifest from S3
            try:
                from ml.s3_artifacts import download_json
                from ml.shard_planner import ShardManifest

                # Parse S3 URI to get key
                s3_uri = config.manifest_s3_uri
                if s3_uri.startswith("s3://"):
                    parts = s3_uri.replace("s3://", "").split("/", 1)
                    s3_key = parts[1] if len(parts) > 1 else ""
                else:
                    s3_key = s3_uri

                manifest_data = download_json(s3_key)
                manifest = ShardManifest.from_json(manifest_data)
                symbols = manifest.symbols
                if manifest.horizons:
                    train_config.horizons = manifest.horizons
                logger.info(f"Loaded manifest: {len(symbols)} symbols, horizons={train_config.horizons}")
            except Exception as e:
                slog.error("manifest_load", "infra", f"Failed to load manifest: {e}")
                return 3
        elif config.symbol_tier:
            symbols = SYMBOL_TIERS.get(config.symbol_tier, [])
            if not symbols:
                slog.error("symbol_resolution", "data", f"Unknown tier: {config.symbol_tier}")
                return 1
            logger.info(f"Resolved tier '{config.symbol_tier}': {len(symbols)} symbols")
        else:
            slog.error("symbol_resolution", "data", "No manifest or tier specified")
            return 1

        # Apply overrides
        train_config.symbols = symbols
        if config.epochs_override:
            train_config.epochs = config.epochs_override
        if config.parsed_horizons:
            train_config.horizons = config.parsed_horizons

        # ── Execute training ──────────────────────────────────────────
        logger.info(f"Starting training: {len(symbols)} symbols, horizons={train_config.horizons}, epochs={train_config.epochs}")
        results = train(train_config)

        # ── Evaluate results ──────────────────────────────────────────
        successes = [r for r in results if "error" not in r]
        failures = [r for r in results if "error" in r]

        duration_s = int(time.monotonic() - start_time)

        slog.info("entrypoint", "completed", duration_ms=duration_s * 1000, metrics={
            "symbols_count": len(symbols),
            "horizons_total": len(train_config.horizons),
            "horizons_success": len(successes),
            "horizons_failed": len(failures),
            "runtime_seconds": duration_s,
        })

        # ── Upload artifacts to S3 (if configured) ────────────────────
        if config.s3_bucket:
            try:
                _upload_artifacts(config, results, slog)
            except Exception as e:
                logger.warning(f"S3 upload failed (non-fatal): {e}")

        # ── Print summary ─────────────────────────────────────────────
        print("\n" + "=" * 60)
        print(f"  SHARD TRAINING COMPLETE — {config.shard_name}")
        print(f"  Run: {config.run_id[:8]}...")
        print(f"  Duration: {duration_s // 60}m {duration_s % 60}s")
        print(f"  Symbols: {len(symbols)}")
        print(f"  Horizons: {len(successes)}/{len(results)} succeeded")
        print("=" * 60)

        for r in results:
            if "error" in r:
                print(f"  h={r['horizon']}: FAILED — {r['error']}")
            else:
                m = r["test_metrics"]
                print(
                    f"  h={r['horizon']}: "
                    f"DA={m['directional_accuracy']:.1%} "
                    f"IC={m['information_coefficient']:.3f} "
                    f"Sharpe={m['hypothetical_sharpe']:.2f} "
                    f"-> {Path(r['checkpoint_path']).name}"
                )
        print("=" * 60)

        # Store for callback access from main()
        config._training_results = results

        if len(failures) == len(results):
            return 2, duration_s
        return 0, duration_s

    except Exception as e:
        duration_s = int(time.monotonic() - start_time)
        slog.error("entrypoint", "infra", str(e)[:500], duration_ms=duration_s * 1000)
        logger.exception(f"Shard execution failed: {e}")
        config._training_results = []
        return 3, duration_s


def _upload_artifacts(config: BatchConfig, results: list[dict], slog) -> None:
    """Upload training artifacts to S3."""
    try:
        from ml import s3_artifacts
    except ImportError:
        logger.warning("boto3 not available, skipping S3 upload")
        return

    for r in results:
        if "error" in r or "checkpoint_path" not in r:
            continue

        horizon = r["horizon"]
        ckpt_path = Path(r["checkpoint_path"])

        if ckpt_path.exists():
            try:
                s3_artifacts.upload_checkpoint(
                    ckpt_path,
                    run_id=config.run_id,
                    shard_id=config.shard_id or "local",
                    symbol="universal",  # Universal model covering all shard symbols
                    horizon=horizon,
                )
            except Exception as e:
                logger.warning(f"Failed to upload checkpoint h={horizon}: {e}")

        if "test_metrics" in r:
            try:
                s3_artifacts.upload_metrics(
                    r["test_metrics"],
                    run_id=config.run_id,
                    shard_id=config.shard_id or "local",
                    symbol="universal",
                    horizon=horizon,
                )
            except Exception as e:
                logger.warning(f"Failed to upload metrics h={horizon}: {e}")

    # Upload shard summary
    try:
        summary = {
            "run_id": config.run_id,
            "shard_id": config.shard_id,
            "shard_name": config.shard_name,
            "results": [
                {
                    "horizon": r["horizon"],
                    "status": "success" if "error" not in r else "failed",
                    "metrics": r.get("test_metrics", {}),
                    "error": r.get("error"),
                }
                for r in results
            ],
        }
        s3_artifacts.upload_shard_summary(summary, config.run_id, config.shard_id or "local")
    except Exception as e:
        logger.warning(f"Failed to upload shard summary: {e}")


def _post_callback(config: BatchConfig, results: list[dict], exit_code: int, runtime_seconds: int = 0) -> None:
    """POST training results to FastAPI callback endpoint. Non-fatal."""
    import os as _os
    import urllib.request
    import json as _json

    api_base = _os.environ.get("FASTAPI_INTERNAL_URL", "https://api.quanttrade.us")
    secret = _os.environ.get("ML_CALLBACK_SECRET", "")
    if not secret:
        logger.warning("ML_CALLBACK_SECRET not set — skipping callback")
        return

    status = "completed" if exit_code == 0 else "failed"
    artifacts = []
    for r in results:
        if "error" not in r and "test_metrics" in r:
            m = r["test_metrics"]
            artifacts.append({
                "symbol": r.get("symbol", "universal"),
                "horizon": r["horizon"],
                "directional_accuracy": m.get("directional_accuracy"),
                "information_coefficient": m.get("information_coefficient"),
                "hypothetical_sharpe": m.get("hypothetical_sharpe"),
                "checkpoint_s3_uri": f"s3://{config.s3_bucket}/checkpoints/{config.run_id}/{config.shard_id or 'local'}/universal/h{r['horizon']}/model.pt",
                "metrics_s3_uri": f"s3://{config.s3_bucket}/metrics/{config.run_id}/{config.shard_id or 'local'}/universal/h{r['horizon']}/metrics.json",
            })

    payload = {
        "run_id": config.run_id,
        "shard_id": config.shard_id or str(uuid.uuid4()),
        "shard_name": config.shard_name,
        "status": status,
        "runtime_seconds": runtime_seconds,
        "error_type": None if exit_code == 0 else "training",
        "error_summary": None,
        "artifacts": artifacts,
    }

    try:
        data = _json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{api_base}/api/v1/internal/ml/batch-callback",
            data=data,
            headers={
                "Content-Type": "application/json",
                "X-ML-Callback-Secret": secret,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            logger.info("Callback accepted: HTTP %d", resp.status)
    except Exception as e:
        logger.warning("Callback POST failed (non-fatal): %s", e)


def main():
    """Main entrypoint for batch execution."""
    config = BatchConfig.from_env()

    # Fill in defaults if not provided
    if not config.run_id:
        config.run_id = str(uuid.uuid4())
        logger.info(f"Generated run_id: {config.run_id}")
    if not config.shard_id:
        config.shard_id = str(uuid.uuid4())

    # Validate
    errors = config.validate()
    if errors:
        for e in errors:
            logger.error(f"Config error: {e}")
        # If only missing tier, try to recover from CLI
        if not config.manifest_s3_uri and not config.symbol_tier:
            logger.info("No manifest or tier — defaulting to tier_1 for local testing")
            config.symbol_tier = "tier_1"
        else:
            sys.exit(1)

    logger.info(f"Batch config: {config.summary()}")
    exit_code, duration_s = run_shard(config)
    results = getattr(config, "_training_results", [])
    _post_callback(config, results, exit_code, runtime_seconds=duration_s)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
