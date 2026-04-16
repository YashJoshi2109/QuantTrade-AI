"""
Client helpers for QuantTrade Stock Analysis / prediction services.

Uses the in-process LSTM prediction service (no external microservice needed).
Falls back gracefully when predictions are unavailable.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def _format_prediction_summary(symbol: str, payload: Dict) -> str:
    """Turn the prediction JSON into a compact, LLM-friendly summary."""
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
            f"confidence={conf:.2f}, range=[{range_low:.2f}, {range_high:.2f}]"
        )

    lines.append(
        "These are probabilistic scenarios based on historical price/volume and "
        "technical features; they are *not* guarantees or financial advice."
    )
    return "\n".join(lines)


def _run_prediction(symbol: str, horizons: List[int]) -> Optional[Dict]:
    """Run the in-process LSTM prediction, handling sync/async boundary."""
    try:
        from app.services.lstm_prediction_service import predict

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, predict(symbol, horizons))
                return future.result(timeout=15)
        else:
            return asyncio.run(predict(symbol, horizons))
    except Exception as exc:
        logger.warning("LSTM prediction failed for %s: %s", symbol, exc)
        return None


def fetch_stock_prediction(symbol: str) -> Optional[str]:
    """
    Generate LSTM prediction for a symbol and return a textual summary.
    Returns None if prediction fails.
    """
    data = _run_prediction(symbol, [1, 7, 30])
    if not data or not data.get("predictions"):
        return None
    return _format_prediction_summary(symbol, data)


def fetch_stock_prediction_payload(symbol: str, horizons: Optional[List[int]] = None) -> Optional[Dict]:
    """
    Fetch structured prediction payload from the in-process LSTM service.
    Returns None when unavailable.
    """
    return _run_prediction(symbol, horizons or [1, 7, 30])

