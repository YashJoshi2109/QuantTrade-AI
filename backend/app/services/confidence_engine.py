"""
Confidence Scoring Engine for QuantTrade AI Copilot.

Computes a composite confidence score (0-100) from:
- Technical signal strength
- Regime prediction probability
- Sentiment alignment
- Model agreement (quant vs fundamental)
- Data freshness / availability
"""
from typing import Dict, Any, Optional


def _score_data_completeness(data: Dict[str, Any]) -> float:
    """Score 0-100 based on how many data sources are present."""
    checks = [
        "quote" in data and data["quote"],
        "indicators" in data and data["indicators"],
        "fundamentals" in data and data["fundamentals"],
        "risk" in data and data["risk"],
        "technical_signal" in data and data["technical_signal"],
        "regime" in data and data["regime"],
        "sentiment" in data and data["sentiment"],
        "company" in data and data["company"],
    ]
    present = sum(1 for c in checks if c)
    return (present / len(checks)) * 100


def _score_technical_conviction(data: Dict[str, Any]) -> float:
    """Score 0-100 based on technical signal clarity."""
    ts = data.get("technical_signal", {})
    confidence = ts.get("confidence", 50)
    bullish_pct = ts.get("bullish_pct", 50)
    # How far from 50/50 split → conviction
    deviation = abs(bullish_pct - 50) * 2  # 0-100 scale
    return min(100, (confidence + deviation) / 2)


def _score_regime_clarity(data: Dict[str, Any]) -> float:
    """Score 0-100 based on regime prediction confidence."""
    regime = data.get("regime", {})
    return regime.get("confidence", 33.3)


def _score_sentiment_alignment(data: Dict[str, Any]) -> float:
    """Score based on how aligned sentiment, technicals, and regime are."""
    ts = data.get("technical_signal", {})
    regime = data.get("regime", {})
    sentiment = data.get("sentiment", {})

    trend = ts.get("trend", "neutral")
    regime_label = regime.get("regime", "NEUTRAL").lower()
    sent_overall = sentiment.get("overall", "neutral")

    # Map to direction: 1=bullish, -1=bearish, 0=neutral
    direction_map = {
        "bullish": 1, "positive": 1,
        "bearish": -1, "negative": -1,
    }
    signals = [
        direction_map.get(trend, 0),
        direction_map.get(regime_label, 0),
        direction_map.get(sent_overall, 0),
    ]

    non_zero = [s for s in signals if s != 0]
    if not non_zero:
        return 50.0  # all neutral, moderate confidence

    # All agree → high score, mixed → low
    agreement = sum(non_zero) / len(non_zero)  # -1 to 1
    return 50 + abs(agreement) * 50  # 50-100


def _score_prediction_conviction(data: Dict[str, Any]) -> float:
    """Score 0-100 based on LSTM prediction confidence and direction clarity."""
    prediction = data.get("prediction", {})
    if not prediction:
        return 50.0  # neutral when no prediction available

    # Handle both nested {"summary": ...} and flat prediction payloads
    if isinstance(prediction, dict) and "summary" in prediction:
        # Text summary only — moderate confidence since model ran
        return 60.0

    preds = prediction.get("predictions", [])
    if not preds:
        return 50.0

    # Average confidence across horizons
    confidences = [p.get("confidence", 0.5) for p in preds]
    avg_conf = sum(confidences) / len(confidences)

    # Direction agreement bonus: all horizons agree = higher score
    directions = [p.get("direction", "NEUTRAL") for p in preds]
    unique_dirs = set(d for d in directions if d != "NEUTRAL")
    if len(unique_dirs) == 1:
        agreement_bonus = 15  # all agree
    elif len(unique_dirs) == 0:
        agreement_bonus = 0  # all neutral
    else:
        agreement_bonus = -10  # conflicting signals

    return min(100, max(0, avg_conf * 100 + agreement_bonus))


def compute_confidence(structured_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute composite confidence score from all available analysis data.

    Returns dict with:
    - overall: 0-100 composite score
    - components: breakdown by category
    - grade: letter grade (A-F)
    - label: human-readable label
    """
    if not structured_data:
        return {
            "overall": 0,
            "components": {},
            "grade": "F",
            "label": "No data available",
        }

    components = {
        "data_completeness": _score_data_completeness(structured_data),
        "technical_conviction": _score_technical_conviction(structured_data),
        "regime_clarity": _score_regime_clarity(structured_data),
        "signal_alignment": _score_sentiment_alignment(structured_data),
        "prediction_conviction": _score_prediction_conviction(structured_data),
    }

    # Weighted composite (rebalanced to include LSTM prediction)
    weights = {
        "data_completeness": 0.10,
        "technical_conviction": 0.25,
        "regime_clarity": 0.25,
        "signal_alignment": 0.25,
        "prediction_conviction": 0.15,
    }

    overall = sum(components[k] * weights[k] for k in components)
    overall = round(min(100, max(0, overall)), 1)

    # Grade
    if overall >= 85:
        grade, label = "A", "Very High Confidence"
    elif overall >= 70:
        grade, label = "B", "High Confidence"
    elif overall >= 55:
        grade, label = "C", "Moderate Confidence"
    elif overall >= 40:
        grade, label = "D", "Low Confidence"
    else:
        grade, label = "F", "Insufficient Data"

    return {
        "overall": overall,
        "components": {k: round(v, 1) for k, v in components.items()},
        "grade": grade,
        "label": label,
    }


def determine_time_horizon(structured_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Determine recommended time horizons based on analysis signals.
    Returns short/medium/long term outlook.
    """
    ts = structured_data.get("technical_signal", {})
    regime = structured_data.get("regime", {})
    sentiment = structured_data.get("sentiment", {})
    monte_carlo = structured_data.get("monte_carlo", {})

    trend = ts.get("trend", "neutral")
    regime_label = regime.get("regime", "NEUTRAL")

    # Short-term (1-7 days): driven by momentum + sentiment
    short_direction = trend
    short_confidence = ts.get("confidence", 50)

    # Medium-term (1-3 months): driven by regime + Monte Carlo
    mc_30 = monte_carlo.get("forecast_30d", {})
    medium_direction = regime_label.lower()
    medium_confidence = regime.get("confidence", 33)

    # Long-term (6-12 months): fundamental + sentiment
    sent_overall = sentiment.get("overall", "neutral")
    long_direction = sent_overall if sent_overall != "neutral" else medium_direction
    long_confidence = max(
        sentiment.get("score", 0) * 50 + 50,
        medium_confidence * 0.7,
    )

    return {
        "short_term": {
            "horizon": "1-7 days",
            "direction": short_direction,
            "confidence": round(short_confidence, 1),
        },
        "medium_term": {
            "horizon": "1-3 months",
            "direction": medium_direction,
            "confidence": round(medium_confidence, 1),
        },
        "long_term": {
            "horizon": "6-12 months",
            "direction": long_direction,
            "confidence": round(min(100, long_confidence), 1),
        },
    }
