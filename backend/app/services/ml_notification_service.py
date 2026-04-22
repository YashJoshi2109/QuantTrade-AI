"""ML Prediction → User Notification dispatcher.

Creates Notification records when ML predictions meet signal criteria
for stocks in users' watchlists.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.community import Notification
from app.models.watchlist import Watchlist

logger = logging.getLogger(__name__)


def dispatch_prediction_alerts(
    db: Session,
    symbol: str,
    direction: str,
    confidence: float,
    predicted_return: float,
    horizon: int,
    model_source: str = "trained",
) -> int:
    """Create notifications for users watching this symbol when prediction is high-confidence.

    Only dispatches when:
    - confidence >= 0.65 (strong signal)
    - model_source is "trained" (not fallback)
    - direction is "UP" or "DOWN" (not NEUTRAL)

    Returns number of notifications created.
    """
    if confidence < 0.65 or model_source != "trained" or direction == "NEUTRAL":
        return 0

    # Find users watching this symbol
    watchers = (
        db.query(Watchlist.user_id)
        .filter(Watchlist.symbol_id.isnot(None))
        .join(Watchlist.symbol)
        .filter(Watchlist.symbol.has(symbol=symbol))
        .distinct()
        .all()
    )

    if not watchers:
        return 0

    direction_emoji = "📈" if direction == "UP" else "📉"
    horizon_label = f"{horizon}-day"
    return_pct = f"{abs(predicted_return * 100):.1f}%"

    count = 0
    for (user_id,) in watchers:
        notification = Notification(
            user_id=user_id,
            type="price_alert",
            title=f"{direction_emoji} {symbol} — {direction} signal ({horizon_label})",
            body=f"ML model predicts {return_pct} {direction.lower()} move with {confidence:.0%} confidence.",
            action_url=f"/research?symbol={symbol}",
        )
        db.add(notification)
        count += 1

    if count > 0:
        db.commit()
        logger.info(f"Dispatched {count} prediction alerts for {symbol} ({direction}, {confidence:.0%})")

    return count


def dispatch_drift_alert(
    db: Session,
    symbol: str,
    drift_level: str,
    drifted_features: list[str],
) -> int:
    """Notify admins when feature drift is detected."""
    if drift_level not in ("medium", "high"):
        return 0

    # For now, create a single admin notification (user_id=1 as admin placeholder)
    notification = Notification(
        user_id=1,
        type="system",
        title=f"Feature drift detected: {symbol} ({drift_level})",
        body=f"Drifted features: {', '.join(drifted_features[:5])}. Consider retraining.",
        action_url="/mlops",
    )
    db.add(notification)
    db.commit()
    logger.info(f"Drift alert for {symbol}: {drift_level} ({len(drifted_features)} features)")
    return 1
