"""
Helpers for logging basic prediction statistics into Postgres.

The main prediction logic may live in a separate service (rag/prediction_server.py)
or directly in the backend. This module provides small, composable functions
that backend endpoints can call after generating predictions.
"""

from __future__ import annotations

from datetime import date
from typing import List, Mapping

from sqlalchemy.orm import Session

from app.models.ml_monitoring import MLPredictionStat


def log_prediction_batch(
    db: Session,
    *,
    model_name: str,
    symbol: str,
    horizon_days: int,
    as_of: date,
    predictions: List[Mapping],
) -> None:
    """
    Store aggregate statistics for a batch of predictions.

    ``predictions`` is expected to be a list of dicts compatible with the
    ``PricePrediction`` dataclass from rag/predictive_rag.py, i.e. keys:
    - confidence
    - direction
    - expected_return
    """
    if not predictions:
        return

    n = len(predictions)
    avg_conf = sum(float(p.get("confidence", 0.0)) for p in predictions) / n
    up_ratio = (
        sum(1 for p in predictions if p.get("direction") == "UP") / n
    )
    avg_expected = (
        sum(float(p.get("expected_return", 0.0)) for p in predictions) / n
    )

    stat = MLPredictionStat(
        model_name=model_name,
        symbol=symbol,
        horizon_days=horizon_days,
        as_of_date=as_of,
        avg_confidence=avg_conf,
        up_ratio=up_ratio,
        avg_expected_return=avg_expected,
        realized_return=None,
        extra=None,
    )

    db.add(stat)
    db.commit()

