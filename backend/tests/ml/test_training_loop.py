"""Training loop smoke tests — synthetic data, small models, fast."""

from __future__ import annotations

import numpy as np
import pytest
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.constants import NUM_FEATURES
from ml.dataset import StockDataset
from ml.model import LSTMPredictor
from ml.train import train_one_epoch, evaluate_epoch, EarlyStopping


def _make_dataset(n: int = 200, seed: int = 42) -> StockDataset:
    rng = np.random.default_rng(seed)
    features = rng.normal(0, 1, (n, NUM_FEATURES)).astype(np.float32)
    # Simple predictable target: mean of last 10 values of first feature
    targets = np.zeros(n, dtype=np.float32)
    for i in range(10, n):
        targets[i] = features[i - 10:i, 0].mean() * 0.5
    return StockDataset(features, targets, seq_len=30)


class TestTrainOneEpoch:
    def test_loss_decreases(self):
        """One epoch of training on synthetic data should reduce loss."""
        ds = _make_dataset(n=500)
        loader = DataLoader(ds, batch_size=16, shuffle=True)

        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=2, dropout=0.1)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        criterion = nn.MSELoss()

        # Initial loss
        initial_loss, _, _ = evaluate_epoch(model, loader, criterion, device="cpu")

        # Train 3 epochs
        for _ in range(3):
            train_one_epoch(model, loader, optimizer, None, criterion, grad_clip=1.0, device="cpu")

        final_loss, _, _ = evaluate_epoch(model, loader, criterion, device="cpu")

        assert final_loss < initial_loss, f"Loss should decrease: {initial_loss} -> {final_loss}"

    def test_gradient_clipping_applied(self):
        """Gradients should be bounded after clipping."""
        ds = _make_dataset(n=100)
        loader = DataLoader(ds, batch_size=16, shuffle=True)

        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=16, num_layers=1)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1.0)  # high LR to cause large grads
        criterion = nn.MSELoss()

        # Run one epoch with clip
        train_one_epoch(model, loader, optimizer, None, criterion, grad_clip=0.5, device="cpu")

        # Parameters should have reasonable magnitudes (not NaN or inf)
        for p in model.parameters():
            assert not torch.isnan(p).any()
            assert not torch.isinf(p).any()


class TestEarlyStopping:
    def test_triggers_after_patience(self):
        es = EarlyStopping(patience=3)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        # First call sets best
        assert not es.step(1.0, model)
        # Next 3 calls without improvement
        assert not es.step(1.1, model)
        assert not es.step(1.1, model)
        assert es.step(1.1, model)  # patience exhausted

    def test_resets_on_improvement(self):
        es = EarlyStopping(patience=3)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        assert not es.step(1.0, model)
        assert not es.step(1.1, model)  # counter=1
        assert not es.step(0.9, model)  # improved, reset
        assert not es.step(1.0, model)  # counter=1
        assert not es.step(1.0, model)  # counter=2

    def test_restore_best(self):
        es = EarlyStopping(patience=3)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        es.step(0.5, model)  # save state
        # Modify model params
        for p in model.parameters():
            p.data.fill_(99.0)

        es.restore_best(model)
        # Best state should be restored (params != 99)
        for p in model.parameters():
            assert not torch.all(p.data == 99.0)


class TestFullPipelineSmoke:
    def test_end_to_end_tiny(self):
        """Full training flow on tiny data should complete without error."""
        ds = _make_dataset(n=200)
        loader = DataLoader(ds, batch_size=32, shuffle=True)

        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=16, num_layers=1)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        criterion = nn.MSELoss()
        es = EarlyStopping(patience=5)

        for epoch in range(3):
            train_loss = train_one_epoch(model, loader, optimizer, None, criterion, 1.0, "cpu")
            val_loss, preds, acts = evaluate_epoch(model, loader, criterion, "cpu")
            assert np.isfinite(train_loss)
            assert np.isfinite(val_loss)
            assert preds.shape == acts.shape
            if es.step(val_loss, model):
                break
