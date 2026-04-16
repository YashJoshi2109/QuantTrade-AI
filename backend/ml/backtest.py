"""Walk-forward validation — rolling and expanding windows.

Gold standard for time-series model evaluation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

from ml.config import TrainConfig
from ml.evaluate import EvalMetrics

logger = logging.getLogger(__name__)


@dataclass
class WalkForwardFold:
    fold_id: int
    train_start_idx: int
    train_end_idx: int
    val_start_idx: int
    val_end_idx: int
    metrics: Optional[EvalMetrics] = None


def generate_folds(
    total_rows: int,
    train_days: int = 1260,
    val_days: int = 63,
    retrain_every: int = 252,
    expanding: bool = True,
) -> list[WalkForwardFold]:
    """Generate walk-forward folds over a date range.

    Args:
        total_rows: total number of rows in dataset
        train_days: size of training window (or min size if expanding)
        val_days: size of validation window per fold
        retrain_every: step size between fold starts
        expanding: if True, train window grows; if False, fixed rolling window

    Returns:
        List of WalkForwardFold objects
    """
    folds: list[WalkForwardFold] = []
    fold_id = 0

    # First fold: train on [0, train_days], val on [train_days, train_days+val_days]
    val_start = train_days
    while val_start + val_days <= total_rows:
        train_start = 0 if expanding else max(0, val_start - train_days)
        train_end = val_start
        val_end = val_start + val_days

        folds.append(WalkForwardFold(
            fold_id=fold_id,
            train_start_idx=train_start,
            train_end_idx=train_end,
            val_start_idx=val_start,
            val_end_idx=val_end,
        ))
        fold_id += 1
        val_start += retrain_every

    return folds


def aggregate_fold_metrics(folds: list[WalkForwardFold]) -> dict:
    """Aggregate metrics across folds: mean, std, min, max per metric."""
    valid = [f.metrics for f in folds if f.metrics is not None]
    if not valid:
        return {}

    fields = [
        "mae", "rmse", "directional_accuracy", "information_coefficient",
        "hit_rate", "hypothetical_sharpe", "cumulative_return", "max_drawdown",
    ]

    summary = {}
    for field_name in fields:
        values = [getattr(m, field_name) for m in valid]
        summary[field_name] = {
            "mean": float(np.mean(values)),
            "std": float(np.std(values)),
            "min": float(np.min(values)),
            "max": float(np.max(values)),
        }
    summary["n_folds"] = len(valid)
    return summary


def print_fold_summary(folds: list[WalkForwardFold]) -> None:
    """Print per-fold and aggregate metrics."""
    print("\n" + "=" * 70)
    print("  WALK-FORWARD VALIDATION RESULTS")
    print("=" * 70)
    print(f"  {'Fold':>4} {'Train':>10} {'Val':>10} {'DA':>7} {'IC':>7} {'Sharpe':>8}")
    print("  " + "-" * 50)
    for f in folds:
        if f.metrics is None:
            continue
        m = f.metrics
        print(
            f"  {f.fold_id:>4} "
            f"[{f.train_start_idx:>4}-{f.train_end_idx:>4}] "
            f"[{f.val_start_idx:>4}-{f.val_end_idx:>4}] "
            f"{m.directional_accuracy:>6.1%} "
            f"{m.information_coefficient:>7.3f} "
            f"{m.hypothetical_sharpe:>8.2f}"
        )
    print("=" * 70)

    summary = aggregate_fold_metrics(folds)
    if summary:
        print(f"  Aggregate ({summary['n_folds']} folds):")
        print(f"    DA:     {summary['directional_accuracy']['mean']:.1%} ± {summary['directional_accuracy']['std']:.1%}")
        print(f"    IC:     {summary['information_coefficient']['mean']:.3f} ± {summary['information_coefficient']['std']:.3f}")
        print(f"    Sharpe: {summary['hypothetical_sharpe']['mean']:.2f} ± {summary['hypothetical_sharpe']['std']:.2f}")
    print("=" * 70 + "\n")
