"""Confidence calibration from historical out-of-sample performance.

Maps raw prediction magnitude to historically-grounded confidence [0, 1].
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class CalibrationTable:
    """Bins of prediction magnitude -> historical accuracy."""
    bin_edges: list[float] = field(default_factory=list)
    directional_accuracy: list[float] = field(default_factory=list)
    mean_absolute_error: list[float] = field(default_factory=list)
    sample_counts: list[int] = field(default_factory=list)


def build_calibration(
    oos_predictions: np.ndarray,
    oos_actuals: np.ndarray,
    n_bins: int = 10,
) -> CalibrationTable:
    """Build calibration table from out-of-sample walk-forward or val results.

    Bins predictions by absolute magnitude, then computes directional accuracy
    and MAE per bin. Higher-magnitude predictions that are historically more
    accurate get higher confidence.
    """
    preds = np.asarray(oos_predictions).flatten()
    actuals = np.asarray(oos_actuals).flatten()

    mask = ~(np.isnan(preds) | np.isnan(actuals))
    preds, actuals = preds[mask], actuals[mask]

    if len(preds) < n_bins * 5:
        # Not enough data for meaningful calibration
        return CalibrationTable(
            bin_edges=[0.0, float("inf")],
            directional_accuracy=[0.5],
            mean_absolute_error=[float(np.mean(np.abs(preds - actuals))) if len(preds) > 0 else 0],
            sample_counts=[len(preds)],
        )

    abs_preds = np.abs(preds)
    # Use quantile-based bins for even sample distribution
    bin_edges = np.quantile(abs_preds, np.linspace(0, 1, n_bins + 1)).tolist()
    # Remove duplicates
    bin_edges = sorted(set(bin_edges))
    if len(bin_edges) < 2:
        bin_edges = [0.0, float(np.max(abs_preds) + 1e-10)]

    da_list, mae_list, count_list = [], [], []

    for i in range(len(bin_edges) - 1):
        lo, hi = bin_edges[i], bin_edges[i + 1]
        if i == len(bin_edges) - 2:
            mask_bin = (abs_preds >= lo) & (abs_preds <= hi)
        else:
            mask_bin = (abs_preds >= lo) & (abs_preds < hi)

        if mask_bin.sum() == 0:
            da_list.append(0.5)
            mae_list.append(0.0)
            count_list.append(0)
            continue

        bin_preds = preds[mask_bin]
        bin_actuals = actuals[mask_bin]

        # Directional accuracy
        pred_dir = np.sign(bin_preds)
        actual_dir = np.sign(bin_actuals)
        nonzero = actual_dir != 0
        da = float((pred_dir[nonzero] == actual_dir[nonzero]).mean()) if nonzero.sum() > 0 else 0.5

        mae = float(np.mean(np.abs(bin_preds - bin_actuals)))

        da_list.append(da)
        mae_list.append(mae)
        count_list.append(int(mask_bin.sum()))

    return CalibrationTable(
        bin_edges=bin_edges,
        directional_accuracy=da_list,
        mean_absolute_error=mae_list,
        sample_counts=count_list,
    )


def calibrated_confidence(
    raw_prediction: float,
    table: CalibrationTable,
    min_confidence: float = 0.1,
    max_confidence: float = 0.95,
) -> float:
    """Map a raw prediction to calibrated confidence [0, 1].

    Uses the calibration table's directional accuracy for the bin
    that contains abs(raw_prediction). Clamps to [min, max].
    """
    if not table.bin_edges or not table.directional_accuracy:
        return 0.5

    abs_pred = abs(raw_prediction)

    # Find which bin this prediction falls into
    for i in range(len(table.bin_edges) - 1):
        if abs_pred < table.bin_edges[i + 1] or i == len(table.bin_edges) - 2:
            da = table.directional_accuracy[i]
            # Scale DA [0.5, 1.0] -> confidence [min, max]
            # DA < 0.5 means model is anti-predictive, still low confidence
            confidence = min_confidence + (max_confidence - min_confidence) * max(0, (da - 0.5) * 2)
            return round(min(max_confidence, max(min_confidence, confidence)), 3)

    return 0.5
