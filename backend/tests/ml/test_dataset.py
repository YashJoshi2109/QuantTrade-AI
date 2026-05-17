"""Dataset and feature engineering tests — synthetic data, no network."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ml.constants import FEATURE_COLUMNS, NUM_FEATURES
from ml.dataset import (
    compute_features,
    make_targets,
    make_scaler,
    StockDataset,
)


def _synthetic_ohlcv(n: int = 500, seed: int = 42) -> pd.DataFrame:
    """Generate deterministic OHLCV data for testing."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2020-01-01", periods=n, freq="B")
    # Geometric Brownian motion
    returns = rng.normal(0.0003, 0.015, n)
    close = 100 * np.exp(np.cumsum(returns))
    high = close * (1 + np.abs(rng.normal(0, 0.005, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.005, n)))
    open_ = close * (1 + rng.normal(0, 0.003, n))
    volume = rng.integers(1_000_000, 10_000_000, n).astype(float)
    return pd.DataFrame({
        "Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume,
    }, index=dates)


class TestComputeFeatures:
    def test_output_columns_match_constants(self):
        df = _synthetic_ohlcv(500)
        feat = compute_features(df)
        assert list(feat.columns) == FEATURE_COLUMNS
        assert feat.shape[1] == NUM_FEATURES == 24

    def test_no_nan_after_compute(self):
        df = _synthetic_ohlcv(500)
        feat = compute_features(df)
        assert not feat.isna().any().any(), "Features should have no NaN after dropna"

    def test_no_lookahead_bias(self):
        """Features at time t must only use data at time <= t."""
        df = _synthetic_ohlcv(500)
        feat_full = compute_features(df)

        # Compute features on truncated data — should match
        midpoint = len(df) // 2
        feat_truncated = compute_features(df.iloc[:midpoint])

        # Overlapping indices should have IDENTICAL values
        common_idx = feat_full.index.intersection(feat_truncated.index)
        assert len(common_idx) > 0
        for col in FEATURE_COLUMNS:
            if col == "Returns_vs_SPY":
                continue  # depends on SPY data
            diff = (feat_full.loc[common_idx, col] - feat_truncated.loc[common_idx, col]).abs()
            assert diff.max() < 1e-6, f"Lookahead bias in {col}: max diff {diff.max()}"

    def test_spy_optional(self):
        """Returns_vs_SPY should be 0 when no SPY data provided."""
        df = _synthetic_ohlcv(500)
        feat = compute_features(df, spy_df=None)
        assert (feat["Returns_vs_SPY"] == 0).all()

    def test_minimum_rows_required(self):
        df = _synthetic_ohlcv(50)  # too short for 252-day warmup
        feat = compute_features(df)
        # Should return empty or very small — 252-day features need warmup
        assert len(feat) < len(df)


class TestMakeTargets:
    def test_log_return_alignment(self):
        df = _synthetic_ohlcv(100)
        close = df["Close"]
        tgt = make_targets(close, horizon=1, mode="log_return")

        # Manually compute expected target at index 10
        expected = np.log(close.iloc[11] / close.iloc[10])
        assert abs(tgt.iloc[10] - expected) < 1e-10

    def test_horizon_shift(self):
        df = _synthetic_ohlcv(100)
        close = df["Close"]
        tgt = make_targets(close, horizon=5, mode="log_return")
        # Last 5 rows should be NaN
        assert tgt.iloc[-5:].isna().all()
        # Earlier rows should be valid
        assert not tgt.iloc[-10:-5].isna().any()

    def test_binary_direction(self):
        df = _synthetic_ohlcv(100)
        close = df["Close"]
        tgt = make_targets(close, horizon=1, mode="binary_direction")
        non_null = tgt.dropna()
        # Binary: only 0 or 1
        assert set(non_null.unique()).issubset({0.0, 1.0})


class TestStockDataset:
    def test_shapes(self):
        features = np.random.randn(200, NUM_FEATURES).astype(np.float32)
        targets = np.random.randn(200).astype(np.float32)
        ds = StockDataset(features, targets, seq_len=60)

        assert len(ds) == 200 - 60
        x, y = ds[0]
        assert x.shape == (60, NUM_FEATURES)
        assert y.shape == ()  # scalar

    def test_target_alignment(self):
        """Target at window starting at idx i should be targets[i + seq_len - 1]."""
        features = np.arange(100 * NUM_FEATURES).reshape(100, NUM_FEATURES).astype(np.float32)
        targets = np.arange(100).astype(np.float32)
        ds = StockDataset(features, targets, seq_len=10)

        x, y = ds[5]  # window idx 5 → spans features[5:15]
        assert float(y) == 14.0  # targets[5 + 10 - 1] = targets[14]


class TestScalerFactory:
    def test_standard(self):
        s = make_scaler("standard")
        from sklearn.preprocessing import StandardScaler
        assert isinstance(s, StandardScaler)

    def test_minmax(self):
        s = make_scaler("minmax")
        from sklearn.preprocessing import MinMaxScaler
        assert isinstance(s, MinMaxScaler)

    def test_robust(self):
        s = make_scaler("robust")
        from sklearn.preprocessing import RobustScaler
        assert isinstance(s, RobustScaler)

    def test_unknown_raises(self):
        with pytest.raises(ValueError):
            make_scaler("unknown")
