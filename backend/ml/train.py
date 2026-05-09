"""Training loop — production LSTM training with proper validation.

Usage:
    python -m ml.train --config configs/train_default.yaml
    python -m ml.train --config configs/train_default.yaml --horizons 1
    python -m ml.train --symbols AAPL MSFT --epochs 20
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.config import TrainConfig
from ml.constants import DEFAULT_CONFIG_PATH, FEATURE_COLUMNS, SYMBOL_TIERS
from ml.dataset import build_datasets, precompute_features, build_datasets_from_cache
from ml.model import LSTMPredictor
from ml.evaluate import compute_metrics, print_report
from ml.baselines import run_all_baselines
from ml.calibration import build_calibration
from ml.checkpoint import save_checkpoint, checkpoint_filename
from ml.structured_logger import LogContext, StructuredLogger, reset_structured_logger

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ml.train")


# ── Device selection ───────────────────────────────────────────────────

def get_device() -> str:
    """Auto-detect best available device: CUDA > MPS > CPU."""
    num_threads = int(os.environ.get("OMP_NUM_THREADS", "2"))
    torch.set_num_threads(num_threads)
    if hasattr(torch, "set_num_interop_threads"):
        try:
            torch.set_num_interop_threads(max(1, num_threads // 2))
        except RuntimeError:
            pass  # Can't set after parallel work started (multi-horizon training)

    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ── Hybrid directional loss ────────────────────────────────────────────

class HybridDirectionalLoss(nn.Module):
    """alpha*MSE + (1-alpha)*BCE(sigmoid(pred*scale), direction).

    Optimizes return magnitude (MSE) AND directional accuracy (BCE) jointly.
    scale=20 maps predicted_return of ±0.05 to sigmoid ≈ 0.73/0.27 — enough separation
    for gradient signal without saturating the sigmoid on typical log-return values.
    """

    def __init__(self, alpha: float = 0.6, scale: float = 20.0):
        super().__init__()
        self.alpha = alpha
        self.scale = scale
        self.mse = nn.MSELoss()
        self.bce = nn.BCELoss()

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        mse_loss = self.mse(pred, target)
        direction = (target > 0).float()
        pred_prob = torch.sigmoid(pred * self.scale)
        bce_loss = self.bce(pred_prob, direction)
        return self.alpha * mse_loss + (1.0 - self.alpha) * bce_loss


# ── Early stopping ─────────────────────────────────────────────────────

class EarlyStopping:
    """Stop on val DA (higher = better). Breaks val-loss/DA mismatch where
    lowest MSE loss != best directional accuracy on test set."""

    def __init__(self, patience: int = 10, min_delta: float = 1e-4):
        self.patience = patience
        self.min_delta = min_delta
        self.best_da = -float("inf")
        self.counter = 0
        self.best_state: dict | None = None

    def step(self, val_da: float, model: nn.Module) -> bool:
        if val_da > self.best_da + self.min_delta:
            self.best_da = val_da
            self.counter = 0
            self.best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            return False
        self.counter += 1
        return self.counter >= self.patience

    def restore_best(self, model: nn.Module):
        if self.best_state is not None:
            model.load_state_dict(self.best_state)


# ── Training loop primitives ───────────────────────────────────────────

def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    scheduler: torch.optim.lr_scheduler._LRScheduler | None,
    criterion: nn.Module,
    grad_clip: float,
    device: str,
) -> float:
    model.train()
    total_loss = 0.0
    n_batches = 0
    for x, y in loader:
        x, y = x.to(device), y.to(device).unsqueeze(-1)
        optimizer.zero_grad()
        pred = model(x)
        loss = criterion(pred, y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
        optimizer.step()
        if scheduler is not None and isinstance(scheduler, torch.optim.lr_scheduler.OneCycleLR):
            scheduler.step()
        total_loss += float(loss.item())
        n_batches += 1
    return total_loss / max(n_batches, 1)


def evaluate_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: str,
) -> tuple[float, np.ndarray, np.ndarray]:
    """Returns (avg_loss, predictions, actuals)."""
    model.eval()
    total_loss = 0.0
    n_batches = 0
    preds_all, acts_all = [], []
    with torch.no_grad():
        for x, y in loader:
            x = x.to(device)
            y_cpu = y.numpy()
            y_gpu = y.to(device).unsqueeze(-1)
            pred = model(x)
            loss = criterion(pred, y_gpu)
            total_loss += float(loss.item())
            n_batches += 1
            preds_all.append(pred.squeeze(-1).cpu().numpy())
            acts_all.append(y_cpu)
    return (
        total_loss / max(n_batches, 1),
        np.concatenate(preds_all) if preds_all else np.array([]),
        np.concatenate(acts_all) if acts_all else np.array([]),
    )


# ── Full training pipeline ─────────────────────────────────────────────

def train_single_horizon(config: TrainConfig, horizon: int, cached_features=None) -> dict:
    """Train one model for one horizon. Returns metrics dict.

    Args:
        cached_features: PrecomputedFeatures from precompute_features().
            If provided, skips expensive download+feature computation.
    """
    device = get_device()
    symbols = config.resolve_symbols()
    logger.info(f"Training h={horizon} on {len(symbols)} symbols ({symbols[:5]}{'...' if len(symbols) > 5 else ''})")
    logger.info(f"Device: {device}")

    # Build datasets — use cache if available (avoids recomputing features per horizon)
    if cached_features is not None:
        train_ds, val_ds, test_ds, scaler = build_datasets_from_cache(
            cached=cached_features,
            horizon=horizon,
            target_mode=config.target_mode,
            scaler_type=config.scaler_type,
            seq_len=config.seq_len,
            val_days=config.val_days,
            test_days=config.test_days,
        )
    else:
        train_ds, val_ds, test_ds, scaler = build_datasets(
            symbols=symbols,
            horizon=horizon,
            target_mode=config.target_mode,
            scaler_type=config.scaler_type,
            seq_len=config.seq_len,
            val_days=config.val_days,
            test_days=config.test_days,
            data_period=config.data_period,
            cache_dir=config.cache_dir,
        )

    if len(train_ds) == 0:
        raise ValueError(f"Empty training dataset for h={horizon}")

    # DataLoaders — use num_workers=2 for CPU prefetching on CI runners
    dl_workers = 2 if device == "cpu" and len(train_ds) > 10000 else 0
    train_loader = DataLoader(train_ds, batch_size=config.batch_size, shuffle=True, num_workers=dl_workers, persistent_workers=dl_workers > 0)
    val_loader = DataLoader(val_ds, batch_size=config.batch_size, shuffle=False, num_workers=dl_workers, persistent_workers=dl_workers > 0)
    test_loader = DataLoader(test_ds, batch_size=config.batch_size, shuffle=False, num_workers=0)

    # Model
    model = LSTMPredictor(
        input_size=len(FEATURE_COLUMNS),
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
        num_heads=getattr(config, "num_attention_heads", 4),
        num_encoder_blocks=getattr(config, "num_encoder_blocks", 2),
    ).to(device)
    logger.info(f"Model: {sum(p.numel() for p in model.parameters()):,} parameters")

    # torch.compile for CPU op fusion (PyTorch 2.0+, ~10-20% speedup, ~30s compile)
    if hasattr(torch, "compile") and device == "cpu":
        try:
            model = torch.compile(model)
            logger.info("Model compiled with torch.compile()")
        except Exception as e:
            logger.warning(f"torch.compile failed, continuing without: {e}")

    # Loss
    if config.target_mode == "binary_direction":
        criterion = nn.BCEWithLogitsLoss()
    elif getattr(config, "use_hybrid_loss", False):
        criterion = HybridDirectionalLoss(
            alpha=getattr(config, "hybrid_loss_alpha", 0.6),
            scale=getattr(config, "hybrid_loss_scale", 20.0),
        )
    else:
        criterion = nn.MSELoss()

    # Optimizer
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )

    # Scheduler
    scheduler: torch.optim.lr_scheduler._LRScheduler | None = None
    if config.lr_scheduler == "one_cycle":
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer,
            max_lr=config.learning_rate,
            total_steps=config.epochs * max(len(train_loader), 1),
            pct_start=0.3,
        )
    elif config.lr_scheduler == "cosine":
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=config.epochs)
    elif config.lr_scheduler == "reduce_on_plateau":
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode="min", patience=5, factor=0.5
        )

    early_stopper = EarlyStopping(patience=config.early_stopping_patience)

    # Training loop
    for epoch in range(1, config.epochs + 1):
        train_loss = train_one_epoch(
            model, train_loader, optimizer, scheduler, criterion,
            config.grad_clip_norm, device,
        )
        val_loss, val_preds, val_acts = evaluate_epoch(model, val_loader, criterion, device)

        # Step plateau scheduler on val loss
        if isinstance(scheduler, torch.optim.lr_scheduler.ReduceLROnPlateau):
            scheduler.step(val_loss)
        elif isinstance(scheduler, torch.optim.lr_scheduler.CosineAnnealingLR):
            scheduler.step()

        val_metrics = compute_metrics(val_preds, val_acts, config.transaction_cost_bps)
        lr_now = optimizer.param_groups[0]["lr"]
        logger.info(
            f"[h={horizon}] Epoch {epoch:3d}/{config.epochs} | "
            f"train={train_loss:.6f} val={val_loss:.6f} | "
            f"DA={val_metrics.directional_accuracy:.1%} IC={val_metrics.information_coefficient:.3f} | "
            f"lr={lr_now:.2e}"
        )

        if early_stopper.step(val_metrics.directional_accuracy, model):
            logger.info(f"Early stopping at epoch {epoch} (best val DA={early_stopper.best_da:.1%})")
            break

    # Restore best weights
    early_stopper.restore_best(model)

    # Final evaluation on val + test
    _, val_preds, val_acts = evaluate_epoch(model, val_loader, criterion, device)
    _, test_preds, test_acts = evaluate_epoch(model, test_loader, criterion, device)

    val_metrics = compute_metrics(val_preds, val_acts, config.transaction_cost_bps)
    test_metrics = compute_metrics(test_preds, test_acts, config.transaction_cost_bps)

    print_report(val_metrics, f"h={horizon} Validation")
    print_report(test_metrics, f"h={horizon} Test")

    # Baselines
    logger.info("Running baselines for comparison...")
    baselines = run_all_baselines(train_ds, test_ds, config.transaction_cost_bps)
    for name, m in baselines.items():
        logger.info(
            f"  {name:20s}: DA={m.directional_accuracy:.1%} "
            f"IC={m.information_coefficient:.3f} "
            f"Sharpe={m.hypothetical_sharpe:.2f}"
        )

    # Build calibration from val predictions
    calibration = build_calibration(val_preds, val_acts, n_bins=10)

    # Save checkpoint
    ckpt_path = Path(config.checkpoint_dir) / checkpoint_filename(config.experiment_name, horizon)
    save_checkpoint(
        model=model,
        scaler=scaler,
        config=config,
        metrics=test_metrics.to_dict(),
        path=ckpt_path,
        calibration=calibration,
        trained_symbols=symbols,
        horizon=horizon,
    )

    return {
        "horizon": horizon,
        "val_metrics": val_metrics.to_dict(),
        "test_metrics": test_metrics.to_dict(),
        "baselines": {k: v.to_dict() for k, v in baselines.items()},
        "checkpoint_path": str(ckpt_path),
    }


def train(config: TrainConfig) -> list[dict]:
    """Train models for all horizons in config.

    Precomputes features ONCE then reuses across all horizons.
    This avoids 3× redundant download + feature computation.
    """
    # Initialize structured logging context from environment
    slog = reset_structured_logger(LogContext(
        run_id=os.environ.get("ML_RUN_ID", ""),
        shard_name=os.environ.get("ML_SHARD_NAME", ""),
        trigger_source=os.environ.get("ML_TRIGGER_SOURCE", "cli"),
    ))

    symbols = config.resolve_symbols()

    with slog.timed("feature_precompute") as feat_metrics:
        logger.info(f"Precomputing features for {len(symbols)} symbols (one-time)...")
        cached = precompute_features(
            symbols=symbols,
            data_period=config.data_period,
            cache_dir=config.cache_dir,
        )
        feat_metrics["symbols_requested"] = len(symbols)
        feat_metrics["symbols_valid"] = len(cached.symbols)
        logger.info(f"Feature precomputation complete: {len(cached.symbols)} symbols ready")

    if len(cached.symbols) == 0:
        logger.error(
            f"Feature precomputation returned 0 valid symbols out of {len(symbols)} requested. "
            f"This usually means yfinance is rate-limited or down. "
            f"Cached data will be used on next run if available."
        )
        slog.error("feature_precompute", "data", f"0/{len(symbols)} symbols had valid data")
        return [{"horizon": h, "error": "No valid symbols after feature precomputation"} for h in config.horizons]

    results = []
    for h in config.horizons:
        try:
            with slog.timed("train_horizon", horizon=h) as h_metrics:
                result = train_single_horizon(config, h, cached_features=cached)
                if "test_metrics" in result:
                    h_metrics["directional_accuracy"] = result["test_metrics"].get("directional_accuracy", 0)
                    h_metrics["information_coefficient"] = result["test_metrics"].get("information_coefficient", 0)
                results.append(result)
        except Exception as e:
            logger.exception(f"Training failed for h={h}: {e}")
            results.append({"horizon": h, "error": str(e)})

    # Log final summary
    successes = sum(1 for r in results if "error" not in r)
    slog.info("train_summary", "completed", metrics={
        "horizons_total": len(config.horizons),
        "horizons_success": successes,
        "horizons_failed": len(config.horizons) - successes,
        "symbols_trained": len(cached.symbols),
    })

    # Upload artifacts to S3 if credentials are available
    _upload_artifacts_to_s3(results, config, slog)

    return results


def _upload_artifacts_to_s3(results: list[dict], config: TrainConfig, slog: StructuredLogger):
    """Upload checkpoints and metrics to S3 after training. Best-effort — never fails the run."""
    run_id = os.environ.get("ML_RUN_ID", "")
    shard_name = os.environ.get("ML_SHARD_NAME", "local")

    # Skip if no AWS credentials configured
    has_creds = any(os.environ.get(k) for k in ("AWS_ACCESS_KEY_ID", "ML_S3_ACCESS_KEY", "S3_ACCESS_KEY"))
    if not has_creds:
        logger.info("S3 upload skipped — no AWS credentials configured")
        return

    try:
        from ml.s3_artifacts import upload_checkpoint as s3_upload_ckpt, upload_metrics, upload_shard_summary
    except ImportError:
        logger.warning("S3 upload skipped — boto3 not installed")
        return

    uploaded = 0
    for r in results:
        if "error" in r or "checkpoint_path" not in r:
            continue
        horizon = r["horizon"]
        ckpt_path = Path(r["checkpoint_path"])
        try:
            # Upload checkpoint
            if ckpt_path.exists():
                s3_upload_ckpt(ckpt_path, run_id, shard_name, config.symbol_tier or "manual", horizon)
                uploaded += 1
            # Upload metrics
            if "test_metrics" in r:
                upload_metrics(r["test_metrics"], run_id, shard_name, config.symbol_tier or "manual", horizon)
        except Exception as e:
            logger.warning(f"S3 upload failed for h={horizon}: {e}")

    # Upload shard summary
    if uploaded > 0:
        try:
            summary = {
                "run_id": run_id,
                "shard_name": shard_name,
                "symbol_tier": config.symbol_tier,
                "symbols_trained": len(config.resolve_symbols()),
                "horizons": [r.get("horizon") for r in results],
                "successes": sum(1 for r in results if "error" not in r),
                "failures": sum(1 for r in results if "error" in r),
            }
            upload_shard_summary(summary, run_id, shard_name)
        except Exception as e:
            logger.warning(f"S3 shard summary upload failed: {e}")

    slog.info("s3_upload", "completed" if uploaded > 0 else "skipped", metrics={"artifacts_uploaded": uploaded})


def _write_train_summary(
    results: list,
    config,
    run_id: str,
    shard_name: str,
    output_dir=None,
) -> None:
    """Write training results to train_summary.json for the CI callback step. Non-fatal."""
    import json
    from pathlib import Path

    if output_dir is None:
        output_dir = Path(__file__).parent  # backend/ml/

    summary = {
        "run_id": run_id,
        "shard_name": shard_name,
        "symbol_tier": getattr(config, "symbol_tier", None),
        "results": [
            {
                "horizon": r["horizon"],
                "test_metrics": r.get("test_metrics", {}),
                "status": "failed" if "error" in r else "completed",
                "error": r.get("error"),
            }
            for r in results
        ],
    }
    try:
        out_path = Path(output_dir) / "train_summary.json"
        out_path.write_text(json.dumps(summary, default=str))
        logger.info("Wrote train summary to %s (%d horizons)", out_path, len(results))
    except Exception as e:
        logger.warning("Failed to write train_summary.json: %s", e)


# ── CLI ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train LSTM predictors")
    parser.add_argument("--config", type=str, default=str(DEFAULT_CONFIG_PATH))
    parser.add_argument("--symbols", nargs="+", default=None, help="Override symbols (actual tickers like AAPL MSFT)")
    parser.add_argument("--symbol-tier", type=str, default=None, help="Symbol tier: tier_1 | tier_2 | tier_3 | all")
    parser.add_argument("--horizons", type=int, nargs="+", default=None, help="Override horizons")
    parser.add_argument("--epochs", type=int, default=None, help="Override epochs")
    parser.add_argument("--experiment", type=str, default=None, help="Override experiment name")
    args = parser.parse_args()

    config_path = Path(args.config)
    if config_path.exists():
        config = TrainConfig.from_yaml(config_path)
        logger.info(f"Loaded config: {config_path}")
    else:
        logger.warning(f"Config not found, using defaults: {config_path}")
        config = TrainConfig()

    # CLI overrides
    if args.symbols:
        config.symbols = args.symbols
    if args.symbol_tier:
        config.symbol_tier = args.symbol_tier
        config.symbols = []  # clear explicit symbols so tier is used
    if args.horizons:
        config.horizons = args.horizons
    if args.epochs:
        config.epochs = args.epochs
    if args.experiment:
        config.experiment_name = args.experiment

    logger.info(f"Config hash: {config.config_hash()}")
    logger.info(f"Horizons: {config.horizons}")

    resolved = config.resolve_symbols()
    if not resolved:
        logger.error(f"No symbols resolved for tier '{config.symbol_tier}'. Available tiers: {list(SYMBOL_TIERS.keys())}")
        sys.exit(1)

    logger.info(f"Symbol tier: {config.symbol_tier}")
    logger.info(f"Training on {len(resolved)} symbols ({resolved[:10]}{'...' if len(resolved) > 10 else ''})")

    results = train(config)

    # Summary
    print("\n" + "=" * 50)
    print("  TRAINING SUMMARY")
    print("=" * 50)
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
    print("=" * 50)

    # Write summary JSON for CI callback step (non-fatal)
    _run_id = os.environ.get("ML_RUN_ID", "")
    _shard_name = os.environ.get("ML_SHARD_NAME", "local")
    _write_train_summary(results, config, _run_id, _shard_name)

    # Exit non-zero if all horizons failed
    if all("error" in r for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
