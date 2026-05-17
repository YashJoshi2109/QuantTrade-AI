"""Ranking and signal-quality metrics for ML evaluation.

Supplements evaluate.py with cross-sectional ranking metrics:
  - Pearson IC, Spearman IC, ICIR (block-wise or daily cross-sectional)
  - Precision@K (K = 5, 10, 20)
  - Top/bottom decile returns and spread
  - Composite early-stopping score
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
from scipy import stats


@dataclass
class RankingMetrics:
    pearson_ic: float = 0.0
    spearman_ic: float = 0.0
    icir: float = 0.0
    precision_at_5: float = 0.0
    precision_at_10: float = 0.0
    precision_at_20: float = 0.0
    top_decile_return: float = 0.0
    bottom_decile_return: float = 0.0
    top_bottom_spread: float = 0.0
    n_samples: int = 0
    n_ic_periods: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def _safe_spearmanr(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 3:
        return 0.0
    ic, _ = stats.spearmanr(x, y)
    return float(ic) if not np.isnan(ic) else 0.0


def _safe_pearsonr(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 3:
        return 0.0
    try:
        r, _ = stats.pearsonr(x, y)
        return float(r) if not np.isnan(r) else 0.0
    except Exception:
        return 0.0


def compute_ranking_metrics(
    predictions: np.ndarray,
    actuals: np.ndarray,
    dates: np.ndarray | None = None,
    block_size: int = 50,
) -> RankingMetrics:
    """Compute cross-sectional ranking / signal-quality metrics.

    Args:
        predictions: flat array of model scores (continuous — log-return scale)
        actuals: flat array of actual log-returns to rank against
        dates: optional date array; enables daily cross-sectional ICIR
        block_size: samples per block when dates=None (block-wise ICIR)
    """
    predictions = np.asarray(predictions, dtype=float).flatten()
    actuals = np.asarray(actuals, dtype=float).flatten()
    mask = ~(np.isnan(predictions) | np.isnan(actuals))
    predictions, actuals = predictions[mask], actuals[mask]
    n = len(predictions)

    if n < 5:
        return RankingMetrics(n_samples=n)

    pearson_ic = _safe_pearsonr(predictions, actuals)
    spearman_ic = _safe_spearmanr(predictions, actuals)

    # ICIR — daily cross-sectional when dates provided and length matches, else block-wise
    ic_series: list[float] = []
    dates_arr_raw = np.asarray(dates) if dates is not None else None
    # dates must be pre-aligned to predictions length (same # of samples, same order)
    use_daily_ic = (
        dates_arr_raw is not None
        and len(dates_arr_raw) == len(mask)  # mask built from original (pre-NaN-drop) preds
    )
    if use_daily_ic:
        dates_arr = dates_arr_raw[mask]
        for d in np.unique(dates_arr):
            idx = dates_arr == d
            if idx.sum() >= 3:
                ic_series.append(_safe_spearmanr(predictions[idx], actuals[idx]))
    else:
        for i in range(0, n, block_size):
            p_block = predictions[i: i + block_size]
            a_block = actuals[i: i + block_size]
            if len(p_block) >= 5:
                ic_series.append(_safe_spearmanr(p_block, a_block))

    n_ic_periods = len(ic_series)
    if n_ic_periods >= 2:
        icir = float(np.mean(ic_series)) / (float(np.std(ic_series)) + 1e-10)
    elif n_ic_periods == 1:
        icir = float(ic_series[0])
    else:
        icir = 0.0

    # Precision@K — fraction of top-K predicted that had positive actual return
    sorted_idx = np.argsort(predictions)[::-1]

    def _prec(k: int) -> float:
        top_k = min(k, n)
        return float((actuals[sorted_idx[:top_k]] > 0).mean())

    # Top/bottom decile returns
    decile = max(1, n // 10)
    top_decile_return = float(actuals[sorted_idx[:decile]].mean())
    bottom_decile_return = float(actuals[sorted_idx[-decile:]].mean())

    return RankingMetrics(
        pearson_ic=round(pearson_ic, 6),
        spearman_ic=round(spearman_ic, 6),
        icir=round(icir, 6),
        precision_at_5=round(_prec(5), 4),
        precision_at_10=round(_prec(10), 4),
        precision_at_20=round(_prec(20), 4),
        top_decile_return=round(top_decile_return, 6),
        bottom_decile_return=round(bottom_decile_return, 6),
        top_bottom_spread=round(top_decile_return - bottom_decile_return, 6),
        n_samples=n,
        n_ic_periods=n_ic_periods,
    )


def compute_composite_score(
    da: float,
    spearman_ic: float,
    precision_at_10: float,
    *,
    da_weight: float = 0.30,
    ic_weight: float = 0.50,
    prec_weight: float = 0.20,
) -> float:
    """Composite early-stopping score.

    score = ic_weight * spearman_ic
          + da_weight * (DA - 0.5)
          + prec_weight * (precision@10 - 0.5)

    All components centered so random predictions → score ≈ 0.
    Spearman IC already in [-1, 1]; DA and P@10 centered at 0.5.
    """
    ic_term = float(np.clip(spearman_ic, -1.0, 1.0))
    da_term = float(np.clip(da - 0.5, -0.5, 0.5))
    prec_term = float(np.clip(precision_at_10 - 0.5, -0.5, 0.5))
    return ic_weight * ic_term + da_weight * da_term + prec_weight * prec_term
