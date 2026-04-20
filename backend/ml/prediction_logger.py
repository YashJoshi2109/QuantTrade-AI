"""
Prediction Logger — tracks all ML predictions for monitoring and evaluation.

Logs every prediction with:
- Input features (hashed for privacy)
- Model version used
- Predicted vs actual (when available)
- Latency
- Confidence

Enables:
- Model performance monitoring in production
- Automated retraining triggers
- A/B testing comparison
"""
import logging
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, List
from dataclasses import dataclass, asdict, field
from collections import defaultdict

logger = logging.getLogger(__name__)

PREDICTIONS_DIR = Path(__file__).parent / "prediction_logs"
PREDICTIONS_DIR.mkdir(exist_ok=True)


@dataclass
class PredictionLog:
    prediction_id: str
    timestamp: str
    symbol: str
    horizon: int  # days
    model_name: str
    model_version: int
    predicted_return: float
    predicted_direction: str  # up, down
    confidence: float
    current_price: float
    predicted_price: float
    latency_ms: float
    features_hash: str = ""
    realized_return: Optional[float] = None
    realized_at: Optional[str] = None
    is_correct: Optional[bool] = None


class PredictionLogger:
    """Log and analyze model predictions."""

    def __init__(self):
        self._buffer: List[Dict] = []
        self._stats: Dict[str, Dict] = defaultdict(lambda: {
            "total": 0, "correct": 0, "total_confidence": 0.0,
            "total_latency": 0.0,
        })

    def log_prediction(
        self,
        symbol: str,
        horizon: int,
        model_name: str,
        model_version: int,
        predicted_return: float,
        predicted_direction: str,
        confidence: float,
        current_price: float,
        predicted_price: float,
        latency_ms: float,
        features_hash: str = "",
    ) -> str:
        """Log a prediction. Returns prediction_id."""
        import uuid
        pred_id = f"{symbol}_{horizon}d_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"

        log = PredictionLog(
            prediction_id=pred_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            symbol=symbol,
            horizon=horizon,
            model_name=model_name,
            model_version=model_version,
            predicted_return=predicted_return,
            predicted_direction=predicted_direction,
            confidence=confidence,
            current_price=current_price,
            predicted_price=predicted_price,
            latency_ms=latency_ms,
            features_hash=features_hash,
        )

        self._buffer.append(asdict(log))
        self._stats[model_name]["total"] += 1
        self._stats[model_name]["total_confidence"] += confidence
        self._stats[model_name]["total_latency"] += latency_ms

        # Flush buffer every 100 predictions
        if len(self._buffer) >= 100:
            self._flush()

        return pred_id

    def record_outcome(self, prediction_id: str, realized_return: float):
        """Record the actual outcome for a prediction."""
        # Search buffer first
        for entry in self._buffer:
            if entry["prediction_id"] == prediction_id:
                entry["realized_return"] = realized_return
                entry["realized_at"] = datetime.now(timezone.utc).isoformat()
                predicted_dir = entry["predicted_direction"]
                actual_dir = "up" if realized_return > 0 else "down"
                entry["is_correct"] = predicted_dir == actual_dir

                model = entry["model_name"]
                if entry["is_correct"]:
                    self._stats[model]["correct"] += 1
                return

        # Search persisted logs
        for log_file in sorted(PREDICTIONS_DIR.glob("*.jsonl"), reverse=True):
            lines = log_file.read_text().strip().split("\n")
            updated = False
            new_lines = []
            for line in lines:
                entry = json.loads(line)
                if entry["prediction_id"] == prediction_id:
                    entry["realized_return"] = realized_return
                    entry["realized_at"] = datetime.now(timezone.utc).isoformat()
                    actual_dir = "up" if realized_return > 0 else "down"
                    entry["is_correct"] = entry["predicted_direction"] == actual_dir
                    updated = True
                new_lines.append(json.dumps(entry))
            if updated:
                log_file.write_text("\n".join(new_lines) + "\n")
                return

    def get_stats(self, model_name: Optional[str] = None) -> Dict:
        """Get prediction statistics."""
        if model_name:
            s = self._stats[model_name]
            total = s["total"]
            return {
                "model": model_name,
                "total_predictions": total,
                "correct_predictions": s["correct"],
                "accuracy": s["correct"] / max(total, 1),
                "avg_confidence": s["total_confidence"] / max(total, 1),
                "avg_latency_ms": s["total_latency"] / max(total, 1),
            }
        return {name: self.get_stats(name) for name in self._stats}

    def get_recent_predictions(self, symbol: Optional[str] = None, limit: int = 50) -> List[Dict]:
        """Get recent predictions, optionally filtered by symbol."""
        results = []
        # Buffer first
        for entry in reversed(self._buffer):
            if symbol and entry["symbol"] != symbol:
                continue
            results.append(entry)
            if len(results) >= limit:
                return results

        # Then persisted
        for log_file in sorted(PREDICTIONS_DIR.glob("*.jsonl"), reverse=True):
            for line in reversed(log_file.read_text().strip().split("\n")):
                if not line.strip():
                    continue
                entry = json.loads(line)
                if symbol and entry["symbol"] != symbol:
                    continue
                results.append(entry)
                if len(results) >= limit:
                    return results

        return results

    def _flush(self):
        """Persist buffer to disk."""
        if not self._buffer:
            return
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        log_file = PREDICTIONS_DIR / f"predictions_{date_str}.jsonl"
        with open(log_file, "a") as f:
            for entry in self._buffer:
                f.write(json.dumps(entry, default=str) + "\n")
        count = len(self._buffer)
        self._buffer.clear()
        logger.debug(f"Flushed {count} predictions to {log_file}")

    def flush(self):
        """Public flush for graceful shutdown."""
        self._flush()


# Module-level singleton
prediction_logger = PredictionLogger()
