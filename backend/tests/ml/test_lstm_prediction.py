"""
Tests for the LSTM prediction service.

Tests feature preparation, model inference shape, and the cached predict API.
Uses mocked yfinance data to avoid network calls.
"""

import asyncio
from unittest.mock import patch, MagicMock

import numpy as np
import pandas as pd
import pytest
import torch

from app.services.lstm_prediction_service import (
    LSTMPredictor,
    StockPredictor,
    PricePrediction,
    predict,
    _calculate_rsi,
    _calculate_macd,
    _calculate_bollinger,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _mock_history(rows: int = 100) -> pd.DataFrame:
    """Generate synthetic OHLCV data."""
    np.random.seed(42)
    # Fixed start date avoids weekend/timezone edge cases on CI
    dates = pd.bdate_range(start="2025-06-01", periods=rows)
    close = 150 + np.cumsum(np.random.randn(rows) * 0.5)
    return pd.DataFrame(
        {
            "Open": close - np.random.rand(rows),
            "High": close + np.random.rand(rows),
            "Low": close - np.random.rand(rows),
            "Close": close,
            "Volume": np.random.randint(1_000_000, 50_000_000, rows),
        },
        index=dates,
    )


def _mock_ticker(symbol: str):
    """Return a mock yfinance Ticker."""
    ticker = MagicMock()
    ticker.history.return_value = _mock_history()
    ticker.info = {
        "currentPrice": 155.0,
        "regularMarketPrice": 155.0,
    }
    return ticker


# ---------------------------------------------------------------------------
# Unit tests: technical indicator helpers
# ---------------------------------------------------------------------------


def test_calculate_rsi_shape():
    prices = pd.Series(np.random.randn(100).cumsum() + 100)
    rsi = _calculate_rsi(prices)
    assert len(rsi) == len(prices)
    # RSI should be bounded 0-100 (after warmup NaNs)
    valid = rsi.dropna()
    assert valid.min() >= 0
    assert valid.max() <= 100


def test_calculate_macd_returns_two_series():
    prices = pd.Series(np.random.randn(100).cumsum() + 100)
    macd, signal = _calculate_macd(prices)
    assert len(macd) == len(prices)
    assert len(signal) == len(prices)


def test_calculate_bollinger_returns_upper_lower():
    prices = pd.Series(np.random.randn(100).cumsum() + 100)
    upper, lower = _calculate_bollinger(prices)
    valid_upper = upper.dropna()
    valid_lower = lower.dropna()
    # Upper should be above lower
    assert (valid_upper > valid_lower).all()


# ---------------------------------------------------------------------------
# Unit tests: LSTM model
# ---------------------------------------------------------------------------


def test_lstm_predictor_forward_shape():
    model = LSTMPredictor(input_size=12, hidden_size=64, num_layers=2)
    model.eval()
    x = torch.randn(1, 30, 12)  # batch=1, seq=30, features=12
    with torch.no_grad():
        out = model(x)
    assert out.shape == (1, 1)


def test_lstm_predictor_different_sequence_lengths():
    model = LSTMPredictor(input_size=12)
    model.eval()
    for seq_len in [10, 30, 60, 100]:
        x = torch.randn(1, seq_len, 12)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 1), f"Failed for seq_len={seq_len}"


# ---------------------------------------------------------------------------
# Unit tests: StockPredictor
# ---------------------------------------------------------------------------


@patch("app.services.lstm_prediction_service.yf")
def test_prepare_features_shape(mock_yf):
    mock_yf.Ticker.return_value = _mock_ticker("AAPL")
    predictor = StockPredictor()
    features = predictor.prepare_features("AAPL")
    assert features.ndim == 2
    assert features.shape[1] == 12  # 12 feature columns
    assert not np.isnan(features).any()


@patch("app.services.lstm_prediction_service.yf")
def test_untrained_predictor_refuses_to_predict(mock_yf):
    """No checkpoint → no prediction (never random-weight output)."""
    from app.services.lstm_prediction_service import NoTrainedModelError

    mock_yf.Ticker.return_value = _mock_ticker("AAPL")
    predictor = StockPredictor()
    predictor._trained = False
    predictor._trained_models = {}
    with pytest.raises(NoTrainedModelError):
        predictor.predict("AAPL", timeframe_days=7)


def test_only_exact_trained_horizon_is_served():
    """A trained h=1 model must not be relabelled as 7_day / 30_day."""
    from app.services.lstm_prediction_service import NoTrainedModelError

    predictor = StockPredictor()
    predictor._trained = True
    predictor._trained_models = {1: object()}
    for h in (7, 30):
        with pytest.raises(NoTrainedModelError):
            predictor.predict("AAPL", timeframe_days=h)


# ---------------------------------------------------------------------------
# Integration test: cached predict API
# ---------------------------------------------------------------------------


@patch("app.services.lstm_prediction_service.yf")
def test_predict_api_without_model_returns_nothing(mock_yf):
    mock_yf.Ticker.return_value = _mock_ticker("AAPL")
    import app.services.lstm_prediction_service as svc

    svc._cache.clear()
    p = svc._get_predictor()
    p._trained, p._trained_models = False, {}
    result = asyncio.run(predict("AAPL", horizons=[1, 7]))
    assert result["symbol"] == "AAPL"
    assert result["predictions"] == []
    assert result["model_trained"] is False


@patch("app.services.lstm_prediction_service.yf")
def test_predict_api_uses_cache(mock_yf):
    mock_yf.Ticker.return_value = _mock_ticker("MSFT")

    from app.services.lstm_prediction_service import _cache
    _cache.clear()

    r1 = asyncio.run(predict("MSFT", horizons=[1]))
    r2 = asyncio.run(predict("MSFT", horizons=[1]))
    # Second call should use cache — same generated_at timestamp
    assert r1["generated_at"] == r2["generated_at"]
