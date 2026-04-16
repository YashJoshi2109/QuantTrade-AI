"""Training loop — production LSTM training with proper validation.

Usage:
    python -m ml.train --config configs/train_default.yaml
    python -m ml.train --config configs/train_default.yaml --horizons 1
    python -m ml.train --symbols AAPL MSFT --epochs 20
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.config import TrainConfig
from ml.constants import DEFAULT_CONFIG_PATH, FEATURE_COLUMNS
from ml.dataset import build_datasets
from ml.model import LSTMPredictor
from ml.evaluate import compute_metrics, print_report
from ml.baselines import run_all_baselines
from ml.calibration import build_calibration
from ml.checkpoint import save_checkpoint, checkpoint_filename

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ml.train")


# ── Device selection ───────────────────────────────────────────────────

def get_device() -> str:
    """Auto-detect best available device: CUDA > MPS > CPU."""
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ── Early stopping ─────────────────────────────────────────────────────

class EarlyStopping:
    def __init__(self, patience: int = 10, min_delta: float = 1e-5):
        self.patience = patience
        self.min_delta = min_delta
        self.best_loss = float("inf")
        self.counter = 0
        self.best_state: dict | None = None

    def step(self, val_loss: float, model: nn.Module) -> bool:
        if val_loss < self.best_loss - self.min_delta:
            self.best_loss = val_loss
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

def train_single_horizon(config: TrainConfig, horizon: int) -> dict:
    """Train one model for one horizon. Returns metrics dict."""
    device = get_device()
    symbols = config.resolve_symbols()
    logger.info(f"Training h={horizon} on {len(symbols)} symbols ({symbols[:5]}{'...' if len(symbols) > 5 else ''})")
    logger.info(f"Device: {device}")

    # Build datasets
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

    train_loader = DataLoader(train_ds, batch_size=config.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=config.batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=config.batch_size, shuffle=False, num_workers=0)

    # Model
    model = LSTMPredictor(
        input_size=len(FEATURE_COLUMNS),
        hidden_size=config.hidden_size,
        num_layers=config.num_layers,
        dropout=config.dropout,
    ).to(device)
    logger.info(f"Model: {sum(p.numel() for p in model.parameters()):,} parameters")

    # Loss
    if config.target_mode == "binary_direction":
        criterion = nn.BCEWithLogitsLoss()
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

        if early_stopper.step(val_loss, model):
            logger.info(f"Early stopping at epoch {epoch}")
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
    """Train models for all horizons in config."""
    results = []
    for h in config.horizons:
        try:
            result = train_single_horizon(config, h)
            results.append(result)
        except Exception as e:
            logger.exception(f"Training failed for h={h}: {e}")
            results.append({"horizon": h, "error": str(e)})
    return results


# ── CLI ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train LSTM predictors")
    parser.add_argument("--config", type=str, default=str(DEFAULT_CONFIG_PATH))
    parser.add_argument("--symbols", nargs="+", default=None, help="Override symbols")
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
    if args.horizons:
        config.horizons = args.horizons
    if args.epochs:
        config.epochs = args.epochs
    if args.experiment:
        config.experiment_name = args.experiment

    logger.info(f"Config hash: {config.config_hash()}")
    logger.info(f"Horizons: {config.horizons}")

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

    # Exit non-zero if all horizons failed
    if all("error" in r for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
