"""
Client helpers for QuantTrade Stock Analysis / prediction services.

This module is intentionally light: it talks to the prediction service
running from ``rag/prediction_server.py`` and formats a short textual
summary that can be injected into the RAG chatbot context.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional

import requests


PREDICTION_SERVICE_URL = os.getenv("PREDICTION_SERVICE_URL", "http://localhost:8001")


def _format_prediction_summary(symbol: str, payload: Dict) -> str:
    """
    Turn the prediction JSON into a compact, LLM-friendly summary.
    """
    preds: List[Dict] = payload.get("predictions", [])
    if not preds:
        return ""

    lines: List[str] = [f"QuantTrade Stock Analysis for {symbol} (model-based scenarios):"]
    for p in preds:
        tf = p.get("timeframe", "")
        direction = p.get("direction", "")
        exp_ret = p.get("expected_return", 0.0)
        conf = p.get("confidence", 0.0)
        range_low = p.get("range_low", 0.0)
        range_high = p.get("range_high", 0.0)
        lines.append(
            f"- {tf}: direction={direction}, expected_return={exp_ret:.2f}%, "
            f"confidence={conf:.2f}, range≈[{range_low:.2f}, {range_high:.2f}]"
        )

    lines.append(
        "These are probabilistic scenarios based on historical price/volume and "
        "technical features; they are *not* guarantees or financial advice."
    )
    return "\n".join(lines)


def fetch_stock_prediction(symbol: str) -> Optional[str]:
    """
    Call the prediction service for a symbol and return a textual summary.

    Returns None if the service is unavailable or returns an error.
    """
    url = f"{PREDICTION_SERVICE_URL.rstrip('/')}/api/v1/predict"
    try:
        resp = requests.post(
            url,
            json={"symbol": symbol, "horizons": [1, 7, 30]},
            timeout=10,
        )
        # Even on non-200, try to surface a human-readable reason so the UI
        # can show *why* analysis is unavailable instead of hiding the card.
        try:
            data = resp.json()
        except Exception:
            data = {}

        if resp.status_code != 200:
            detail = data.get("detail") if isinstance(data, dict) else None
            msg = detail or f"Prediction service returned HTTP {resp.status_code}."
            return (
                f"Model-based scenarios are temporarily unavailable for {symbol}: {msg} "
                "The copilot will continue using filings, news, and other data sources."
            )

        return _format_prediction_summary(symbol, data)
    except Exception:
        return None

