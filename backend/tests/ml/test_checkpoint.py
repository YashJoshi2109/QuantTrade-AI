"""Checkpoint save/load tests."""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest
import torch
from sklearn.preprocessing import StandardScaler

from ml.config import TrainConfig
from ml.constants import NUM_FEATURES
from ml.model import LSTMPredictor
from ml.checkpoint import (
    save_checkpoint, load_checkpoint, find_latest_checkpoint,
    checkpoint_filename, FeatureSchemaMismatch,
)


@pytest.fixture
def tmp_model_and_scaler():
    model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=2)
    scaler = StandardScaler()
    scaler.fit(np.random.randn(100, NUM_FEATURES))
    return model, scaler


class TestSaveLoadRoundtrip:
    def test_roundtrip(self, tmp_path, tmp_model_and_scaler):
        model, scaler = tmp_model_and_scaler
        config = TrainConfig()

        ckpt_path = tmp_path / "test.pt"
        save_checkpoint(
            model=model, scaler=scaler, config=config,
            metrics={"mae": 0.01, "directional_accuracy": 0.6},
            path=ckpt_path, horizon=1,
        )
        assert ckpt_path.exists()

        # Load
        loaded_model, loaded_scaler, metadata, calibration = load_checkpoint(ckpt_path)

        # Model output should match (both in eval mode to disable dropout)
        model.eval()
        loaded_model.eval()
        x = torch.randn(1, 30, NUM_FEATURES)
        with torch.no_grad():
            orig = model(x).item()
            loaded = loaded_model(x).item()
        assert abs(orig - loaded) < 1e-6

        # Scaler should produce same transform
        test_data = np.random.randn(10, NUM_FEATURES)
        assert np.allclose(scaler.transform(test_data), loaded_scaler.transform(test_data))

        # Metadata preserved
        assert metadata.target_horizon == 1
        assert metadata.metrics["mae"] == 0.01


class TestFindLatestCheckpoint:
    def test_returns_none_when_empty(self, tmp_path):
        assert find_latest_checkpoint(tmp_path) is None

    def test_finds_newest(self, tmp_path, tmp_model_and_scaler):
        model, scaler = tmp_model_and_scaler
        config = TrainConfig()

        # Save two checkpoints with a small delay
        p1 = tmp_path / "lstm_test_h1_20260101_000000.pt"
        save_checkpoint(model, scaler, config, {}, p1, horizon=1)
        time.sleep(0.05)
        p2 = tmp_path / "lstm_test_h1_20260102_000000.pt"
        save_checkpoint(model, scaler, config, {}, p2, horizon=1)

        latest = find_latest_checkpoint(tmp_path)
        assert latest == p2

    def test_horizon_filter(self, tmp_path, tmp_model_and_scaler):
        model, scaler = tmp_model_and_scaler
        config = TrainConfig()

        p1 = tmp_path / "lstm_test_h1_20260101_000000.pt"
        save_checkpoint(model, scaler, config, {}, p1, horizon=1)
        p7 = tmp_path / "lstm_test_h7_20260101_000001.pt"
        save_checkpoint(model, scaler, config, {}, p7, horizon=7)

        h1 = find_latest_checkpoint(tmp_path, horizon=1)
        h7 = find_latest_checkpoint(tmp_path, horizon=7)
        assert h1 == p1
        assert h7 == p7


class TestCheckpointFilename:
    def test_format(self):
        name = checkpoint_filename("nightly", 7)
        assert name.startswith("lstm_nightly_h7_")
        assert name.endswith(".pt")
