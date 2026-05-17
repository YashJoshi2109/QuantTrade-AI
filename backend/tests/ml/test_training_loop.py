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
from ml.model import TransformerEncoderBlock
from ml.train import train_one_epoch, evaluate_epoch, EarlyStopping, HybridDirectionalLoss


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
        """Should stop when DA hasn't improved for `patience` consecutive steps."""
        es = EarlyStopping(patience=3, min_epochs=1)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        # First call sets best DA
        assert not es.step(0.52, model)
        # Three consecutive calls with no improvement trigger stop
        assert not es.step(0.51, model)
        assert not es.step(0.51, model)
        assert es.step(0.51, model)  # patience exhausted

    def test_resets_on_improvement(self):
        """Counter must reset when DA improves (higher = better)."""
        es = EarlyStopping(patience=3, min_epochs=1)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        assert not es.step(0.50, model)  # best_da=0.50, counter=0
        assert not es.step(0.48, model)  # no improvement → counter=1
        assert not es.step(0.53, model)  # improved → counter reset to 0
        assert not es.step(0.52, model)  # no improvement → counter=1
        assert not es.step(0.52, model)  # counter=2 (not yet patience=3)

    def test_restore_best(self):
        es = EarlyStopping(patience=3, min_epochs=1)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        es.step(0.55, model)  # save state at DA=0.55
        # Corrupt model params
        for p in model.parameters():
            p.data.fill_(99.0)

        es.restore_best(model)
        # Best state should be restored (params != 99)
        for p in model.parameters():
            assert not torch.all(p.data == 99.0)

    def test_best_da_tracked(self):
        """best_da should track the highest DA seen."""
        es = EarlyStopping(patience=5, min_epochs=1)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)
        es.step(0.51, model)
        es.step(0.55, model)
        es.step(0.53, model)
        assert abs(es.best_da - 0.55) < 1e-6

    def test_min_epochs_warmup_prevents_early_trigger(self):
        """Early stop must not fire during warmup period even with no DA improvement."""
        es = EarlyStopping(patience=2, min_epochs=4)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        # Epoch 1: sets best
        assert not es.step(0.55, model)
        # Epochs 2-4: no improvement, but in warmup — must not stop
        assert not es.step(0.50, model)
        assert not es.step(0.50, model)  # counter would be 2 = patience, but still warmup
        assert not es.step(0.50, model)  # epoch 4 = last warmup epoch — still no stop
        # Epoch 5: first post-warmup epoch, patience counter active
        assert not es.step(0.50, model)  # counter=1 (not yet patience=2)
        assert es.step(0.50, model)       # counter=2 = patience → stop

    def test_min_epochs_best_state_saved_during_warmup(self):
        """Best state is still tracked during warmup even though stopping is blocked."""
        es = EarlyStopping(patience=5, min_epochs=3)
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)

        es.step(0.60, model)  # epoch 1: best DA=0.60 saved during warmup
        for p in model.parameters():
            p.data.fill_(99.0)   # corrupt weights

        es.restore_best(model)
        for p in model.parameters():
            assert not torch.all(p.data == 99.0)  # restored from warmup-era best


class TestHybridDirectionalLoss:
    def test_loss_in_valid_range(self):
        """Hybrid loss should be finite and positive."""
        criterion = HybridDirectionalLoss(alpha=0.6, scale=20.0)
        pred = torch.randn(32, 1)
        target = torch.randn(32, 1) * 0.01  # realistic log-returns
        loss = criterion(pred, target)
        assert torch.isfinite(loss)
        assert loss.item() > 0

    def test_directional_gradient(self):
        """Gradient should flow through directional component."""
        criterion = HybridDirectionalLoss(alpha=0.6, scale=20.0)
        pred = torch.randn(16, 1, requires_grad=True)
        target = torch.randn(16, 1) * 0.01
        loss = criterion(pred, target)
        loss.backward()
        assert pred.grad is not None
        assert torch.isfinite(pred.grad).all()

    def test_alpha_zero_equals_bce(self):
        """alpha=0 → pure BCE loss with label smoothing (direction * 0.9 + 0.05)."""
        criterion_hybrid = HybridDirectionalLoss(alpha=0.0, scale=20.0)
        criterion_bce = nn.BCELoss()
        torch.manual_seed(0)
        pred = torch.randn(16, 1) * 0.05
        target = torch.randn(16, 1) * 0.01
        direction = (target > 0).float() * 0.9 + 0.05  # matches label smoothing in forward()
        expected = criterion_bce(torch.sigmoid(pred * 20.0), direction)
        got = criterion_hybrid(pred, target)
        assert abs(float(got) - float(expected)) < 1e-5

    def test_alpha_one_equals_mse(self):
        """alpha=1 → pure MSE loss."""
        criterion_hybrid = HybridDirectionalLoss(alpha=1.0, scale=20.0)
        criterion_mse = nn.MSELoss()
        pred = torch.randn(16, 1) * 0.05
        target = torch.randn(16, 1) * 0.01
        expected = criterion_mse(pred, target)
        got = criterion_hybrid(pred, target)
        assert abs(float(got) - float(expected)) < 1e-5


class TestTransformerEncoderBlock:
    def test_shape_preserved(self):
        """Block must preserve (batch, seq_len, hidden_size) shape."""
        block = TransformerEncoderBlock(hidden_size=32, num_heads=4, ffn_dim=128, dropout=0.0)
        block.eval()
        x = torch.randn(4, 60, 32)
        with torch.no_grad():
            out = block(x)
        assert out.shape == (4, 60, 32)

    def test_both_add_norm_layers_present(self):
        """Block must have norm1 (after MHA) and norm2 (after FFN)."""
        block = TransformerEncoderBlock(hidden_size=32, num_heads=4, ffn_dim=128, dropout=0.0)
        assert isinstance(block.norm1, nn.LayerNorm)
        assert isinstance(block.norm2, nn.LayerNorm)

    def test_ffn_has_correct_expansion(self):
        """FFN must expand hidden_size → ffn_dim → hidden_size."""
        block = TransformerEncoderBlock(hidden_size=32, num_heads=4, ffn_dim=128, dropout=0.0)
        assert block.ffn[0].in_features == 32
        assert block.ffn[0].out_features == 128
        assert block.ffn[3].in_features == 128
        assert block.ffn[3].out_features == 32

    def test_no_nan_output(self):
        block = TransformerEncoderBlock(hidden_size=16, num_heads=4, ffn_dim=64, dropout=0.0)
        block.eval()
        x = torch.randn(2, 30, 16)
        with torch.no_grad():
            out = block(x)
        assert not torch.isnan(out).any()
        assert not torch.isinf(out).any()


class TestImprovedModelArchitecture:
    def test_forward_shape(self):
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=2)
        model.eval()
        x = torch.randn(4, 60, NUM_FEATURES)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (4, 1)

    def test_input_projection_present(self):
        """Model must have input_proj (Linear + LayerNorm)."""
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=1)
        assert hasattr(model, "input_proj")
        assert isinstance(model.input_proj[0], nn.Linear)
        assert isinstance(model.input_proj[1], nn.LayerNorm)

    def test_encoder_blocks_present(self):
        """Model must have stacked TransformerEncoderBlocks."""
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=1, num_encoder_blocks=2)
        assert hasattr(model, "encoder_blocks")
        assert isinstance(model.encoder_blocks, nn.ModuleList)
        assert len(model.encoder_blocks) == 2
        assert all(isinstance(b, TransformerEncoderBlock) for b in model.encoder_blocks)

    def test_num_encoder_blocks_configurable(self):
        """Different block counts should produce correct ModuleList sizes."""
        for n in [1, 2, 3]:
            m = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=16, num_layers=1, num_encoder_blocks=n)
            assert len(m.encoder_blocks) == n

    def test_each_block_has_ffn_and_both_norms(self):
        """Each block must have FFN + norm1 + norm2 (both Add&Norm layers)."""
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=1, num_encoder_blocks=2)
        for block in model.encoder_blocks:
            assert isinstance(block.norm1, nn.LayerNorm)
            assert isinstance(block.norm2, nn.LayerNorm)
            assert isinstance(block.ffn, nn.Sequential)

    def test_ffn_uses_4x_expansion(self):
        """FFN hidden dim should be 4× the model hidden_size."""
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=1)
        for block in model.encoder_blocks:
            assert block.ffn[0].out_features == 4 * 32  # 128

    def test_num_heads_auto_corrected(self):
        """num_heads that doesn't divide hidden_size must be auto-corrected."""
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1, num_heads=3)
        for block in model.encoder_blocks:
            assert block.mha.num_heads in (1, 2, 4, 8)

    def test_no_nan_output(self):
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=32, num_layers=2, dropout=0.0)
        model.eval()
        x = torch.randn(8, 60, NUM_FEATURES)
        with torch.no_grad():
            out = model(x)
        assert not torch.isnan(out).any()
        assert not torch.isinf(out).any()

    def test_different_sequence_lengths(self):
        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=16, num_layers=1)
        model.eval()
        for seq_len in [10, 30, 60, 120]:
            x = torch.randn(2, seq_len, NUM_FEATURES)
            with torch.no_grad():
                out = model(x)
            assert out.shape == (2, 1), f"Bad shape for seq_len={seq_len}"


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
            # Pass a plausible DA value (0.5 base ± small perturbation)
            val_da = 0.5 + float(np.clip(np.random.randn() * 0.02, -0.05, 0.05))
            if es.step(val_da, model):
                break

    def test_hybrid_loss_end_to_end(self):
        """Hybrid loss should train without errors."""
        ds = _make_dataset(n=200)
        loader = DataLoader(ds, batch_size=32, shuffle=True)

        model = LSTMPredictor(input_size=NUM_FEATURES, hidden_size=16, num_layers=1)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        criterion = HybridDirectionalLoss(alpha=0.6, scale=20.0)

        for _ in range(2):
            loss = train_one_epoch(model, loader, optimizer, None, criterion, 1.0, "cpu")
            assert np.isfinite(loss)
