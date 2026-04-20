"""
Model Performance Monitor — continuous monitoring of production model quality.

Tracks:
- Directional accuracy over rolling windows
- Confidence calibration
- Prediction distribution shifts
- Latency trends
- Automated alert thresholds
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict

logger = logging.getLogger(__name__)


@dataclass
class PerformanceAlert:
    level: str  # info, warning, critical
    metric: str
    message: str
    value: float
    threshold: float
    timestamp: str


@dataclass
class PerformanceSnapshot:
    timestamp: str
    model_name: str
    window_days: int
    total_predictions: int
    evaluated_predictions: int
    directional_accuracy: float
    avg_confidence: float
    avg_latency_ms: float
    confidence_calibration: float  # gap between confidence and accuracy
    alerts: List[PerformanceAlert] = field(default_factory=list)


class PerformanceMonitor:
    """Monitor model performance in production."""

    def __init__(self):
        self.alert_thresholds = {
            "directional_accuracy_min": 0.52,  # below random = bad
            "avg_latency_max_ms": 500,
            "confidence_calibration_max_gap": 0.15,
            "min_predictions_for_alert": 20,
        }
        self._alerts: List[PerformanceAlert] = []

    def evaluate(
        self,
        predictions: List[Dict],
        model_name: str,
        window_days: int = 30,
    ) -> PerformanceSnapshot:
        """Evaluate model performance over a window of predictions."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)

        # Filter to window
        recent = []
        for p in predictions:
            ts = p.get("timestamp", "")
            try:
                if datetime.fromisoformat(ts.replace("Z", "+00:00")) >= cutoff:
                    recent.append(p)
            except (ValueError, TypeError):
                continue

        total = len(recent)
        evaluated = [p for p in recent if p.get("is_correct") is not None]

        # Metrics
        if evaluated:
            correct = sum(1 for p in evaluated if p["is_correct"])
            da = correct / len(evaluated)
        else:
            da = 0.0

        avg_conf = sum(p.get("confidence", 0) for p in recent) / max(total, 1)
        avg_lat = sum(p.get("latency_ms", 0) for p in recent) / max(total, 1)
        cal_gap = abs(avg_conf - da) if evaluated else 0.0

        # Generate alerts
        alerts = []
        if len(evaluated) >= self.alert_thresholds["min_predictions_for_alert"]:
            if da < self.alert_thresholds["directional_accuracy_min"]:
                alerts.append(PerformanceAlert(
                    level="critical",
                    metric="directional_accuracy",
                    message=f"Directional accuracy ({da:.1%}) below threshold ({self.alert_thresholds['directional_accuracy_min']:.1%}). Model may need retraining.",
                    value=da,
                    threshold=self.alert_thresholds["directional_accuracy_min"],
                    timestamp=datetime.now(timezone.utc).isoformat(),
                ))

        if avg_lat > self.alert_thresholds["avg_latency_max_ms"]:
            alerts.append(PerformanceAlert(
                level="warning",
                metric="latency",
                message=f"Average latency ({avg_lat:.0f}ms) exceeds threshold ({self.alert_thresholds['avg_latency_max_ms']}ms).",
                value=avg_lat,
                threshold=self.alert_thresholds["avg_latency_max_ms"],
                timestamp=datetime.now(timezone.utc).isoformat(),
            ))

        if cal_gap > self.alert_thresholds["confidence_calibration_max_gap"] and evaluated:
            alerts.append(PerformanceAlert(
                level="warning",
                metric="calibration",
                message=f"Confidence calibration gap ({cal_gap:.1%}) exceeds threshold. Model is {'overconfident' if avg_conf > da else 'underconfident'}.",
                value=cal_gap,
                threshold=self.alert_thresholds["confidence_calibration_max_gap"],
                timestamp=datetime.now(timezone.utc).isoformat(),
            ))

        self._alerts.extend(alerts)

        return PerformanceSnapshot(
            timestamp=datetime.now(timezone.utc).isoformat(),
            model_name=model_name,
            window_days=window_days,
            total_predictions=total,
            evaluated_predictions=len(evaluated),
            directional_accuracy=round(da, 4),
            avg_confidence=round(avg_conf, 4),
            avg_latency_ms=round(avg_lat, 2),
            confidence_calibration=round(cal_gap, 4),
            alerts=alerts,
        )

    def should_retrain(self, snapshot: PerformanceSnapshot) -> Tuple[bool, str]:
        """Determine if model needs retraining based on performance."""
        if snapshot.evaluated_predictions < self.alert_thresholds["min_predictions_for_alert"]:
            return False, "Insufficient evaluated predictions"

        if snapshot.directional_accuracy < self.alert_thresholds["directional_accuracy_min"]:
            return True, f"Directional accuracy ({snapshot.directional_accuracy:.1%}) below minimum"

        if snapshot.confidence_calibration > 0.20:
            return True, f"Severe calibration gap ({snapshot.confidence_calibration:.1%})"

        return False, "Performance within acceptable range"

    def get_alerts(self, level: Optional[str] = None) -> List[PerformanceAlert]:
        """Get recent alerts, optionally filtered by level."""
        if level:
            return [a for a in self._alerts if a.level == level]
        return list(self._alerts)

    def clear_alerts(self):
        self._alerts.clear()


# Module-level singleton
performance_monitor = PerformanceMonitor()
