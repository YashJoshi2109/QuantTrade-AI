"""Evaluation metrics for regression and portfolio performance."""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
from scipy import stats


@dataclass
class EvalMetrics:
    mae: float = 0.0
    rmse: float = 0.0
    directional_accuracy: float = 0.0  # % correct up/down
    information_coefficient: float = 0.0  # Spearman rank correlation
    hit_rate: float = 0.0  # % profitable if trading on signal
    hypothetical_sharpe: float = 0.0  # annualized
    cumulative_return: float = 0.0
    max_drawdown: float = 0.0
    n_samples: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def compute_metrics(
    predictions: np.ndarray,
    actuals: np.ndarray,
    transaction_cost_bps: float = 10.0,
) -> EvalMetrics:
    """Compute all evaluation metrics.

    predictions/actuals are log returns (or any regression target).
    """
    predictions = np.asarray(predictions).flatten()
    actuals = np.asarray(actuals).flatten()

    # Remove any NaN pairs
    mask = ~(np.isnan(predictions) | np.isnan(actuals))
    predictions = predictions[mask]
    actuals = actuals[mask]

    n = len(predictions)
    if n == 0:
        return EvalMetrics()

    # Regression metrics
    errors = predictions - actuals
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors ** 2)))

    # Directional accuracy
    pred_dir = np.sign(predictions)
    actual_dir = np.sign(actuals)
    # Exclude zero-return days from directional accuracy
    nonzero = actual_dir != 0
    if nonzero.sum() > 0:
        dir_acc = float((pred_dir[nonzero] == actual_dir[nonzero]).mean())
    else:
        dir_acc = 0.5

    # Information Coefficient (Spearman rank correlation)
    if n > 2:
        ic, _ = stats.spearmanr(predictions, actuals)
        ic = float(ic) if not np.isnan(ic) else 0.0
    else:
        ic = 0.0

    # Portfolio simulation: go long if predicted > 0, else flat
    # Transaction cost applied on signal changes
    tc = transaction_cost_bps / 10000
    position = (predictions > 0).astype(float)
    trades = np.abs(np.diff(position, prepend=0))
    daily_returns = position * actuals - trades * tc

    # Hit rate: % of days with position where return was positive
    with_pos = position > 0
    if with_pos.sum() > 0:
        hit_rate = float((daily_returns[with_pos] > 0).mean())
    else:
        hit_rate = 0.0

    # Sharpe (annualized)
    if len(daily_returns) > 1 and np.std(daily_returns) > 1e-10:
        sharpe = float(np.mean(daily_returns) / np.std(daily_returns) * np.sqrt(252))
    else:
        sharpe = 0.0

    # Cumulative return
    cum_ret = float(np.expm1(np.sum(daily_returns)))

    # Max drawdown
    equity = np.cumprod(1 + daily_returns)
    peak = np.maximum.accumulate(equity)
    drawdowns = (equity - peak) / peak
    max_dd = float(np.abs(drawdowns.min())) if len(drawdowns) > 0 else 0.0

    return EvalMetrics(
        mae=mae,
        rmse=rmse,
        directional_accuracy=dir_acc,
        information_coefficient=ic,
        hit_rate=hit_rate,
        hypothetical_sharpe=sharpe,
        cumulative_return=cum_ret,
        max_drawdown=max_dd,
        n_samples=n,
    )


def print_report(metrics: EvalMetrics, label: str = "Test") -> None:
    """Pretty-print metrics to stdout."""
    print(f"\n{'=' * 50}")
    print(f"  {label} Evaluation ({metrics.n_samples} samples)")
    print(f"{'=' * 50}")
    print(f"  MAE:                  {metrics.mae:.6f}")
    print(f"  RMSE:                 {metrics.rmse:.6f}")
    print(f"  Directional Accuracy: {metrics.directional_accuracy:.1%}")
    print(f"  Information Coeff:    {metrics.information_coefficient:.4f}")
    print(f"  Hit Rate:             {metrics.hit_rate:.1%}")
    print(f"  Hypothetical Sharpe:  {metrics.hypothetical_sharpe:.3f}")
    print(f"  Cumulative Return:    {metrics.cumulative_return:.2%}")
    print(f"  Max Drawdown:         {metrics.max_drawdown:.2%}")
    print(f"{'=' * 50}\n")
