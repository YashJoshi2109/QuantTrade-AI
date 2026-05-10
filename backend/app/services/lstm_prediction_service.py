"""
LSTM-based Stock Price Prediction Service.

Loads trained checkpoints from backend/ml/checkpoints/ if available.
Falls back to untrained LSTM + linear extrapolation when no checkpoint exists.

Uses ensemble of LSTM + linear extrapolation with 5-minute result caching.
Single source of truth for model architecture: ml.model.LSTMPredictor
Single source of truth for feature engineering: ml.dataset.compute_features
"""

from __future__ import annotations

import logging
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import yfinance as yf
from sklearn.preprocessing import MinMaxScaler

# Make ml/ package importable when this service is imported from backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class PricePrediction:
    """Single-horizon price prediction."""

    timeframe: str
    predicted_price: float
    current_price: float
    confidence: float
    direction: str  # UP, DOWN, NEUTRAL
    probability_up: float
    range_low: float
    range_high: float
    expected_return: float  # percentage
    model_source: str = "untrained"  # "trained" | "untrained" | "fallback"


# ---------------------------------------------------------------------------
# Try to import the trained ML pipeline; fall back gracefully if unavailable
# ---------------------------------------------------------------------------

_ML_AVAILABLE = False
try:
    from ml.model import LSTMPredictor as _TrainedLSTMPredictor
    from ml.dataset import compute_features as _compute_features_v2
    from ml.dataset import download_symbol as _download_symbol
    from ml.checkpoint import find_latest_checkpoint, load_checkpoint
    from ml.calibration import calibrated_confidence
    from ml.constants import FEATURE_COLUMNS as _FEATURE_COLUMNS_V2
    from ml.constants import DEFAULT_CHECKPOINT_DIR, DEFAULT_CACHE_DIR, NUM_FEATURES
    _ML_AVAILABLE = True
except Exception as exc:  # pragma: no cover — degrades gracefully
    logger.warning("ML pipeline not available, using legacy LSTMPredictor: %s", exc)


# ---------------------------------------------------------------------------
# LSTM Model — legacy definition for backward compatibility
# ---------------------------------------------------------------------------


class LSTMPredictor(nn.Module):
    """3-layer LSTM with attention for stock price prediction.

    Legacy class kept for backward compatibility with existing tests.
    New code should use ml.model.LSTMPredictor.
    """

    def __init__(self, input_size: int = 12, hidden_size: int = 128, num_layers: int = 3):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers

        self.lstm = nn.LSTM(
            input_size,
            hidden_size,
            num_layers,
            batch_first=True,
            dropout=0.2,
        )
        self.attention = nn.Linear(hidden_size, 1)
        self.fc1 = nn.Linear(hidden_size, 64)
        self.fc2 = nn.Linear(64, 1)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        lstm_out, _ = self.lstm(x)
        attention_weights = torch.softmax(
            self.attention(lstm_out).squeeze(-1), dim=1
        )
        context = torch.sum(lstm_out * attention_weights.unsqueeze(-1), dim=1)
        out = self.fc1(context)
        out = self.relu(out)
        out = self.dropout(out)
        out = self.fc2(out)
        return out


# ---------------------------------------------------------------------------
# Legacy feature helpers (kept for backward compatibility — tests import these)
# ---------------------------------------------------------------------------


def _calculate_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.where(delta > 0, 0).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))


def _calculate_macd(prices: pd.Series) -> tuple[pd.Series, pd.Series]:
    exp1 = prices.ewm(span=12, adjust=False).mean()
    exp2 = prices.ewm(span=26, adjust=False).mean()
    macd = exp1 - exp2
    signal = macd.ewm(span=9, adjust=False).mean()
    return macd, signal


def _calculate_bollinger(prices: pd.Series, period: int = 20) -> tuple[pd.Series, pd.Series]:
    sma = prices.rolling(window=period).mean()
    std = prices.rolling(window=period).std()
    return sma + (std * 2), sma - (std * 2)


# ---------------------------------------------------------------------------
# Stock Predictor (ensemble engine)
# ---------------------------------------------------------------------------


class StockPredictor:
    """Ensemble prediction engine.

    If a trained checkpoint is found:
        - Loads trained model + persisted scaler per horizon
        - Uses ml.dataset.compute_features (20 features) + scaler.transform() at inference
        - Confidence comes from historical OOS calibration table

    Otherwise (fallback):
        - Uses untrained LSTMPredictor (random Xavier weights)
        - Uses legacy 12-feature pipeline with scaler.fit_transform() per call
        - Confidence from LSTM/linear agreement heuristic
    """

    _FEATURE_COLS = [
        "Close", "Volume", "SMA_20", "SMA_50",
        "RSI", "MACD", "Signal", "BB_upper", "BB_lower",
        "Volume_SMA", "Price_Change", "Volume_Change",
    ]

    def __init__(self) -> None:
        self._trained_models: Dict[int, Any] = {}
        self._trained_scalers: Dict[int, Any] = {}
        self._trained_calibrations: Dict[int, Any] = {}
        self._trained = False

        if _ML_AVAILABLE:
            self._load_all_checkpoints()

        fallback_input_size = NUM_FEATURES if _ML_AVAILABLE else len(self._FEATURE_COLS)
        if not self._trained:
            logger.warning("No trained LSTM checkpoints found — using untrained fallback.")
            self.lstm_model = LSTMPredictor(input_size=fallback_input_size)
            self.lstm_model.eval()
            self.scaler = MinMaxScaler()
        else:
            # Legacy scaler for 12-feature prepare_features() path; trained 20-feature
            # path uses _trained_scalers[h] loaded from checkpoint.
            self.lstm_model = LSTMPredictor(input_size=fallback_input_size)
            self.lstm_model.eval()
            self.scaler = MinMaxScaler()

    def _get_checkpoint_path(self, horizon: int) -> Optional[str]:
        """Get best checkpoint: registry production model > latest checkpoint."""
        # Try model registry first
        try:
            from ml.model_registry import model_registry
            prod_model = model_registry.get_production_model(f"lstm_h{horizon}")
            if prod_model and prod_model.checkpoint_path:
                if os.path.exists(prod_model.checkpoint_path):
                    return prod_model.checkpoint_path
        except Exception:
            pass

        # Fall back to latest checkpoint
        try:
            ckpt = find_latest_checkpoint(DEFAULT_CHECKPOINT_DIR, horizon=horizon)
            return str(ckpt) if ckpt else None
        except Exception:
            return None

    def _load_all_checkpoints(self) -> None:
        """Attempt to load trained models for each horizon."""
        for h in (1, 7, 30):
            try:
                ckpt_path_str = self._get_checkpoint_path(h)
                if ckpt_path_str is None:
                    continue
                ckpt_path = Path(ckpt_path_str)
                model, scaler, metadata, calibration = load_checkpoint(ckpt_path, device="cpu")
                self._trained_models[h] = model
                self._trained_scalers[h] = scaler
                self._trained_calibrations[h] = calibration
                self._trained = True
                logger.info("Loaded trained LSTM checkpoint for h=%d: %s", h, ckpt_path.name)
            except Exception as exc:
                logger.warning("Failed to load checkpoint for h=%d: %s", h, exc)

    @property
    def is_trained(self) -> bool:
        return self._trained

    # ── Legacy feature path (fallback) ─────────────────────────────────
    def prepare_features(self, symbol: str, lookback_days: int = 60) -> np.ndarray:
        """Legacy feature preparation — used only in untrained fallback mode."""
        stock = yf.Ticker(symbol)
        df = stock.history(period=f"{lookback_days}d")
        if df is None or df.empty:
            df = stock.history(period="1y")
        if df is None or df.empty:
            raise ValueError(f"No price data available for {symbol}")

        df["SMA_20"] = df["Close"].rolling(window=20).mean()
        df["SMA_50"] = df["Close"].rolling(window=50).mean()
        df["RSI"] = _calculate_rsi(df["Close"])
        df["MACD"], df["Signal"] = _calculate_macd(df["Close"])
        df["BB_upper"], df["BB_lower"] = _calculate_bollinger(df["Close"])
        df["Volume_SMA"] = df["Volume"].rolling(window=20).mean()
        df["Price_Change"] = df["Close"].pct_change()
        df["Volume_Change"] = df["Volume"].pct_change()

        df = df[self._FEATURE_COLS].dropna()
        if df.empty:
            raise ValueError(f"Insufficient feature rows for {symbol}")

        return self.scaler.fit_transform(df.values)

    # ── Trained feature path ───────────────────────────────────────────
    def _prepare_features_trained(self, symbol: str, horizon: int) -> tuple[np.ndarray, float]:
        """Use ml.dataset.compute_features + persisted scaler.transform()."""
        raw_df = _download_symbol(symbol, period="2y", cache_dir=DEFAULT_CACHE_DIR)
        if raw_df is None or raw_df.empty:
            raise ValueError(f"No price data available for {symbol}")

        spy_df = _download_symbol("SPY", period="2y", cache_dir=DEFAULT_CACHE_DIR)
        feat_df = _compute_features_v2(raw_df, spy_df if not spy_df.empty else None)
        if feat_df.empty:
            raise ValueError(f"Insufficient feature rows for {symbol}")

        scaler = self._trained_scalers[horizon]
        features = scaler.transform(feat_df.values)
        current_price = float(raw_df["Close"].iloc[-1])
        return features, current_price

    # ── Prediction ─────────────────────────────────────────────────────
    def predict(self, symbol: str, timeframe_days: int = 1) -> PricePrediction:
        """Generate a single-horizon price prediction."""
        # Pick the closest available trained horizon
        horizon_key = self._closest_horizon(timeframe_days) if self._trained else None

        if horizon_key is not None:
            return self._predict_trained(symbol, timeframe_days, horizon_key)
        return self._predict_fallback(symbol, timeframe_days)

    def _closest_horizon(self, horizon: int) -> Optional[int]:
        if not self._trained_models:
            return None
        return min(self._trained_models.keys(), key=lambda h: abs(h - horizon))

    def _predict_trained(self, symbol: str, timeframe_days: int, horizon_key: int) -> PricePrediction:
        t0 = time.time()
        features, current_price = self._prepare_features_trained(symbol, horizon_key)

        seq_len = 60
        if len(features) < seq_len:
            seq_len = len(features)

        X = torch.FloatTensor(features[-seq_len:]).unsqueeze(0)
        model = self._trained_models[horizon_key]

        with torch.no_grad():
            # Trained model predicts log return at horizon_key days
            raw_pred = model(X).item()

        predicted_change = float(np.expm1(raw_pred))  # log return -> simple return
        predicted_price = current_price * (1 + predicted_change)

        # Calibrated confidence from OOS performance
        calibration = self._trained_calibrations.get(horizon_key)
        if calibration is not None:
            confidence = calibrated_confidence(raw_pred, calibration)
        else:
            confidence = 0.6

        expected_return = predicted_change * 100

        # Direction + probability
        if expected_return > 0.5:
            direction = "UP"
            probability_up = min(0.95, 0.5 + confidence * 0.5)
        elif expected_return < -0.5:
            direction = "DOWN"
            probability_up = max(0.05, 0.5 - confidence * 0.5)
        else:
            direction = "NEUTRAL"
            probability_up = 0.5

        # Range from ATR estimate (last ATR column — index 13 in new feature set)
        try:
            recent_close = features[-30:, 0]  # scaled close
            vol_proxy = float(np.std(recent_close)) * 0.03  # rough volatility
        except Exception:
            vol_proxy = 0.02
        range_low = predicted_price * (1 - vol_proxy * 2)
        range_high = predicted_price * (1 + vol_proxy * 2)

        latency_ms = (time.time() - t0) * 1000

        # Log prediction for monitoring / drift detection
        try:
            from ml.prediction_logger import prediction_logger
            prediction_logger.log_prediction(
                symbol=symbol,
                horizon=horizon_key,
                model_name=f"lstm_h{horizon_key}",
                model_version=1,
                predicted_return=expected_return,
                predicted_direction="up" if expected_return > 0 else "down",
                confidence=confidence,
                current_price=current_price,
                predicted_price=predicted_price,
                latency_ms=latency_ms,
            )
        except Exception:
            pass

        return PricePrediction(
            timeframe=f"{timeframe_days}_day",
            predicted_price=round(predicted_price, 2),
            current_price=round(current_price, 2),
            confidence=round(confidence, 3),
            direction=direction,
            probability_up=round(probability_up, 3),
            range_low=round(range_low, 2),
            range_high=round(range_high, 2),
            expected_return=round(expected_return, 2),
            model_source="trained",
        )

    def _predict_fallback(self, symbol: str, timeframe_days: int) -> PricePrediction:
        """Untrained ensemble fallback — preserves legacy behavior."""
        features = self.prepare_features(symbol)

        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        if not current_price:
            current_price = float(features[-1, 0])

        seq_len = min(60, len(features))
        X = torch.FloatTensor(features[-seq_len:]).unsqueeze(0)

        with torch.no_grad():
            lstm_pred = self.lstm_model(X).item()
            linear_pred = self._linear_forecast(features, timeframe_days)
            predicted_change = lstm_pred * 0.6 + linear_pred * 0.4

        predicted_price = current_price * (1 + predicted_change)

        denom = max(abs(lstm_pred), abs(linear_pred), 1e-8)
        model_agreement = 1 - abs(lstm_pred - linear_pred) / denom
        confidence = min(0.95, max(0.3, model_agreement))

        volatility = features[-30:, 0].std() if len(features) >= 30 else 0.02
        range_low = predicted_price - (current_price * volatility * 2)
        range_high = predicted_price + (current_price * volatility * 2)

        expected_return = ((predicted_price - current_price) / current_price) * 100 if current_price else 0

        if expected_return > 1:
            direction = "UP"
            probability_up = min(0.95, 0.5 + (expected_return / 100 * 5))
        elif expected_return < -1:
            direction = "DOWN"
            probability_up = max(0.05, 0.5 + (expected_return / 100 * 5))
        else:
            direction = "NEUTRAL"
            probability_up = 0.5

        return PricePrediction(
            timeframe=f"{timeframe_days}_day",
            predicted_price=round(predicted_price, 2),
            current_price=round(current_price, 2),
            confidence=round(confidence, 3),
            direction=direction,
            probability_up=round(probability_up, 3),
            range_low=round(range_low, 2),
            range_high=round(range_high, 2),
            expected_return=round(expected_return, 2),
            model_source="untrained",
        )

    @staticmethod
    def _linear_forecast(features: np.ndarray, days: int) -> float:
        window = min(10, len(features))
        recent_trend = (features[-1, 0] - features[-window, 0]) / window
        return recent_trend * days


# ---------------------------------------------------------------------------
# Cached prediction API (called by stock_analysis_client)
# ---------------------------------------------------------------------------

_predictor: Optional[StockPredictor] = None
_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL = 300  # 5 minutes


def _get_predictor() -> StockPredictor:
    global _predictor
    if _predictor is None:
        _predictor = StockPredictor()
    return _predictor


async def predict(symbol: str, horizons: Optional[List[int]] = None) -> Dict[str, Any]:
    """Generate LSTM predictions for a symbol across multiple horizons."""
    if horizons is None:
        horizons = [1, 7, 30]

    cache_key = f"{symbol}:{'_'.join(str(h) for h in sorted(horizons))}"
    now = time.time()

    if cache_key in _cache:
        cached_at, cached_result = _cache[cache_key]
        if now - cached_at < _CACHE_TTL:
            return cached_result

    predictor = _get_predictor()
    predictions = []

    for h in horizons:
        try:
            pred = predictor.predict(symbol, timeframe_days=h)
            predictions.append(asdict(pred))
        except Exception as exc:
            logger.warning("LSTM prediction failed for %s/%dd: %s", symbol, h, exc)

    result = {
        "symbol": symbol,
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "predictions": predictions,
        "model_trained": predictor.is_trained,
    }

    _cache[cache_key] = (now, result)

    if len(_cache) > 500:
        _cache.clear()

    return result
