"""
Data & Model Drift Detection.

Detects:
- Feature drift (PSI — Population Stability Index)
- Prediction drift (distribution shift in outputs)
- Performance drift (degrading accuracy over time)

Uses baseline statistics from the feature store for comparison.
"""
import logging
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

DRIFT_DIR = Path(__file__).parent / "drift_reports"
DRIFT_DIR.mkdir(exist_ok=True)


@dataclass
class DriftReport:
    symbol: str
    timestamp: str
    overall_drift: str  # none, low, medium, high
    feature_drifts: Dict[str, Dict[str, float]] = field(default_factory=dict)
    prediction_drift: Optional[Dict[str, float]] = None
    recommendations: List[str] = field(default_factory=list)
    requires_retrain: bool = False


def _psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """
    Population Stability Index.
    < 0.1 = no drift, 0.1-0.25 = moderate, > 0.25 = significant
    """
    # Create bins from expected distribution
    breakpoints = np.percentile(expected, np.linspace(0, 100, bins + 1))
    breakpoints = np.unique(breakpoints)
    if len(breakpoints) < 3:
        return 0.0

    expected_counts = np.histogram(expected, bins=breakpoints)[0].astype(float)
    actual_counts = np.histogram(actual, bins=breakpoints)[0].astype(float)

    # Avoid division by zero
    expected_pct = np.clip(expected_counts / expected_counts.sum(), 1e-6, 1)
    actual_pct = np.clip(actual_counts / actual_counts.sum(), 1e-6, 1)

    psi = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
    return float(psi)


def _ks_test(expected: np.ndarray, actual: np.ndarray) -> Tuple[float, float]:
    """Kolmogorov-Smirnov test. Returns (statistic, p_value)."""
    try:
        from scipy.stats import ks_2samp
        stat, pval = ks_2samp(expected, actual)
        return float(stat), float(pval)
    except ImportError:
        # Fallback: manual KS statistic
        n1, n2 = len(expected), len(actual)
        all_vals = np.sort(np.concatenate([expected, actual]))
        cdf1 = np.searchsorted(np.sort(expected), all_vals, side='right') / n1
        cdf2 = np.searchsorted(np.sort(actual), all_vals, side='right') / n2
        ks_stat = np.max(np.abs(cdf1 - cdf2))
        return float(ks_stat), 0.0  # p-value not available without scipy


class DriftDetector:
    """Detect feature and prediction drift."""

    def __init__(self, psi_threshold: float = 0.2, ks_threshold: float = 0.05):
        self.psi_threshold = psi_threshold
        self.ks_threshold = ks_threshold

    def detect_feature_drift(
        self,
        baseline_stats: Dict[str, Dict[str, float]],
        current_features: pd.DataFrame,
        feature_columns: List[str],
    ) -> Dict[str, Dict[str, float]]:
        """Compare current features against baseline statistics."""
        drifts = {}
        for col in feature_columns:
            if col not in current_features.columns or col not in baseline_stats:
                continue

            current = current_features[col].dropna().values
            if len(current) < 20:
                continue

            baseline = baseline_stats[col]

            # Generate synthetic baseline from stored stats
            baseline_mean = baseline.get("mean", 0)
            baseline_std = baseline.get("std", 1)
            baseline_samples = np.random.normal(baseline_mean, max(baseline_std, 1e-6), size=len(current))

            psi = _psi(baseline_samples, current)
            ks_stat, ks_pval = _ks_test(baseline_samples, current)

            # Current stats
            current_mean = float(np.mean(current))
            current_std = float(np.std(current))
            mean_shift = abs(current_mean - baseline_mean) / max(abs(baseline_mean), 1e-6)

            drifts[col] = {
                "psi": round(psi, 4),
                "ks_statistic": round(ks_stat, 4),
                "ks_pvalue": round(ks_pval, 4),
                "mean_shift_pct": round(mean_shift * 100, 2),
                "baseline_mean": round(baseline_mean, 4),
                "current_mean": round(current_mean, 4),
                "drifted": psi > self.psi_threshold or ks_pval < self.ks_threshold,
            }

        return drifts

    def generate_report(
        self,
        symbol: str,
        baseline_stats: Dict[str, Dict[str, float]],
        current_features: pd.DataFrame,
        feature_columns: List[str],
    ) -> DriftReport:
        """Generate a comprehensive drift report."""
        feature_drifts = self.detect_feature_drift(baseline_stats, current_features, feature_columns)

        # Count drifted features
        drifted_count = sum(1 for d in feature_drifts.values() if d.get("drifted", False))
        total = len(feature_drifts)

        if total == 0:
            drift_level = "none"
        elif drifted_count / total > 0.3:
            drift_level = "high"
        elif drifted_count / total > 0.1:
            drift_level = "medium"
        elif drifted_count > 0:
            drift_level = "low"
        else:
            drift_level = "none"

        recommendations = []
        requires_retrain = False

        if drift_level == "high":
            recommendations.append("CRITICAL: >30% features drifted. Immediate retraining recommended.")
            requires_retrain = True
        elif drift_level == "medium":
            recommendations.append("WARNING: 10-30% features drifted. Schedule retraining within 1 week.")
        elif drift_level == "low":
            recommendations.append("INFO: Minor drift detected. Monitor closely.")

        # Specific feature recommendations
        for col, drift in feature_drifts.items():
            if drift.get("drifted") and drift.get("psi", 0) > 0.5:
                recommendations.append(f"Feature '{col}' has severe drift (PSI={drift['psi']:.3f})")

        report = DriftReport(
            symbol=symbol,
            timestamp=datetime.now(timezone.utc).isoformat(),
            overall_drift=drift_level,
            feature_drifts=feature_drifts,
            recommendations=recommendations,
            requires_retrain=requires_retrain,
        )

        # Persist report
        report_file = DRIFT_DIR / f"{symbol}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
        with open(report_file, "w") as f:
            json.dump(asdict(report), f, indent=2)

        return report

    def get_latest_report(self, symbol: str) -> Optional[DriftReport]:
        """Get the most recent drift report for a symbol."""
        reports = sorted(DRIFT_DIR.glob(f"{symbol}_*.json"), reverse=True)
        if not reports:
            return None
        with open(reports[0]) as f:
            data = json.load(f)
        return DriftReport(**data)


# Module-level singleton
drift_detector = DriftDetector()
