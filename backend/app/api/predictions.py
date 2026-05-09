"""Prediction serving endpoint.

GET /api/v1/predictions/{symbol}?horizon=1|7

Loads the latest local checkpoint for the requested horizon, computes features
via FeatureStore, runs LSTM inference, and returns a structured prediction.
Results are cached in memory for 1 hour to avoid redundant computation.
"""

import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from fastapi import APIRouter, HTTPException, Query

from ml.checkpoint import find_latest_checkpoint, load_checkpoint
from ml.constants import DEFAULT_CHECKPOINT_DIR, DEFAULT_SEQ_LEN, DEFAULT_HORIZONS
from ml.feature_store import feature_store

logger = logging.getLogger(__name__)

router = APIRouter()

# ── In-memory prediction cache ────────────────────────────────────────
# Keys: (symbol, horizon) → {"result": dict, "expires_at": float}
_prediction_cache: dict[tuple[str, int], dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour

# ── Model cache — keep loaded checkpoints in memory across requests ───
# Keys: horizon → (model, scaler, metadata, calibration, path_mtime)
_model_cache: dict[int, tuple[Any, Any, Any, Any, float]] = {}


def _load_model_for_horizon(horizon: int):
    """Load (or return cached) model for the given horizon.

    Returns (model, scaler, metadata, calibration) or raises HTTPException.
    Reloads if the checkpoint file has been updated since last load.
    """
    checkpoint_path = find_latest_checkpoint(DEFAULT_CHECKPOINT_DIR, horizon=horizon)
    if checkpoint_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"No checkpoint found for horizon={horizon}. "
                   f"Run training first or check {DEFAULT_CHECKPOINT_DIR}.",
        )

    current_mtime = checkpoint_path.stat().st_mtime
    cached = _model_cache.get(horizon)
    if cached is not None:
        model, scaler, metadata, calibration, cached_mtime = cached
        if cached_mtime == current_mtime:
            return model, scaler, metadata, calibration

    logger.info("Loading checkpoint for h%d: %s", horizon, checkpoint_path.name)
    try:
        model, scaler, metadata, calibration = load_checkpoint(
            checkpoint_path, device="cpu", strict_features=True
        )
    except Exception as exc:
        logger.error("Failed to load checkpoint %s: %s", checkpoint_path, exc)
        raise HTTPException(
            status_code=503,
            detail=f"Checkpoint load failed for horizon={horizon}: {exc}",
        )

    _model_cache[horizon] = (model, scaler, metadata, calibration, current_mtime)
    return model, scaler, metadata, calibration


def _model_version_from_path(checkpoint_path: Path) -> str:
    """Extract a model version string from the checkpoint filename.

    Files are named like: lstm_prod_300_h1_20260508_230517.pt
    Returns e.g. 'v20260508_2305'.
    """
    stem = checkpoint_path.stem  # e.g. lstm_prod_300_h1_20260508_230517
    parts = stem.split("_")
    # Look for a date-like part (8 digits)
    date_part = next((p for p in parts if len(p) == 8 and p.isdigit()), None)
    time_part = next((p for p in parts if len(p) == 6 and p.isdigit()), None)
    if date_part and time_part:
        return f"v{date_part}_{time_part[:4]}"
    return f"v{stem[-14:]}" if len(stem) >= 14 else f"v{stem}"


def _run_inference(symbol: str, horizon: int) -> dict:
    """Core inference logic — blocking, runs in FastAPI thread pool."""
    # Load model
    checkpoint_path = find_latest_checkpoint(DEFAULT_CHECKPOINT_DIR, horizon=horizon)
    if checkpoint_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"No checkpoint found for horizon={horizon}.",
        )
    model, scaler, metadata, calibration = _load_model_for_horizon(horizon)

    # Fetch features
    seq_len = metadata.seq_len if metadata.seq_len else DEFAULT_SEQ_LEN
    features_df = feature_store.get_features(symbol, lookback=seq_len)
    if features_df is None or len(features_df) < seq_len:
        raise HTTPException(
            status_code=503,
            detail=f"Feature data unavailable for {symbol}. "
                   f"Got {len(features_df) if features_df is not None else 0} rows, need {seq_len}.",
        )

    # Select and order feature columns
    feature_cols = metadata.feature_columns or list(features_df.columns)
    try:
        X_raw = features_df[feature_cols].values[-seq_len:]  # (seq_len, n_features)
    except KeyError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Feature column mismatch for {symbol}: {exc}",
        )

    # Scale features using checkpoint scaler
    try:
        X_scaled = scaler.transform(X_raw)  # (seq_len, n_features)
    except Exception as exc:
        logger.error("Scaler failed for %s: %s", symbol, exc)
        raise HTTPException(status_code=503, detail=f"Feature scaling failed: {exc}")

    # Build tensor: (1, seq_len, n_features)
    X_tensor = torch.tensor(X_scaled, dtype=torch.float32).unsqueeze(0)

    # Inference
    with torch.no_grad():
        raw_output = model(X_tensor)  # (1, 1)
    predicted_return = float(raw_output.squeeze().item())

    # Direction and confidence
    predicted_direction = "up" if predicted_return >= 0 else "down"

    # Confidence: sigmoid of |predicted_return| scaled to [0.5, 1.0]
    # A raw log-return of 0 → 0.5 confidence; ±0.05 → ~0.62; ±0.10 → ~0.75
    confidence = float(1 / (1 + np.exp(-abs(predicted_return) * 20)))
    confidence = round(max(0.5, min(0.99, confidence)), 4)

    version = _model_version_from_path(checkpoint_path)
    computed_at = datetime.now(timezone.utc).isoformat()

    return {
        "symbol": symbol.upper(),
        "horizon": horizon,
        "predicted_return": round(predicted_return, 6),
        "predicted_direction": predicted_direction,
        "confidence": confidence,
        "model_version": version,
        "computed_at": computed_at,
    }


@router.get("/predictions/{symbol}")
def get_prediction(
    symbol: str,
    horizon: int = Query(default=1, description="Forecast horizon in days: 1 or 7"),
):
    """Return LSTM prediction for a single symbol at the given horizon.

    - **symbol**: stock ticker (e.g. AAPL, MSFT)
    - **horizon**: 1 or 7 days
    """
    symbol = symbol.upper().strip()

    if horizon not in DEFAULT_HORIZONS:
        raise HTTPException(
            status_code=422,
            detail=f"horizon must be one of {DEFAULT_HORIZONS}, got {horizon}.",
        )

    cache_key = (symbol, horizon)
    now = time.monotonic()
    cached = _prediction_cache.get(cache_key)
    if cached is not None and cached["expires_at"] > now:
        logger.debug("Cache hit for %s h%d", symbol, horizon)
        return cached["result"]

    result = _run_inference(symbol, horizon)

    _prediction_cache[cache_key] = {
        "result": result,
        "expires_at": now + _CACHE_TTL_SECONDS,
    }
    return result
