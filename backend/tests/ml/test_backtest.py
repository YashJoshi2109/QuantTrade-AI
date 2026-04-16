"""Walk-forward backtest fold generation tests."""

from __future__ import annotations

import pytest

from ml.backtest import generate_folds


class TestGenerateFolds:
    def test_count(self):
        """For 2000 rows, train=1260, val=63, step=252:
        First val starts at 1260, last val ends at 2000.
        Folds: val_start = 1260, 1512, 1764 — 3 folds."""
        folds = generate_folds(
            total_rows=2000,
            train_days=1260,
            val_days=63,
            retrain_every=252,
            expanding=True,
        )
        assert len(folds) == 3

    def test_no_overlap_val_train(self):
        folds = generate_folds(
            total_rows=2000,
            train_days=1260,
            val_days=63,
            retrain_every=252,
            expanding=True,
        )
        for f in folds:
            assert f.train_end_idx == f.val_start_idx
            assert f.val_start_idx < f.val_end_idx
            assert f.train_start_idx < f.train_end_idx

    def test_expanding_grows(self):
        folds = generate_folds(
            total_rows=3000,
            train_days=500,
            val_days=60,
            retrain_every=60,
            expanding=True,
        )
        assert len(folds) >= 3
        # Train set should grow
        train_sizes = [f.train_end_idx - f.train_start_idx for f in folds]
        # Each subsequent train size >= previous
        for i in range(1, len(train_sizes)):
            assert train_sizes[i] >= train_sizes[i - 1]

    def test_rolling_fixed_size(self):
        folds = generate_folds(
            total_rows=3000,
            train_days=500,
            val_days=60,
            retrain_every=60,
            expanding=False,
        )
        # Rolling: all train sizes should be equal (or the first few may be smaller)
        for f in folds:
            size = f.train_end_idx - f.train_start_idx
            assert size <= 500

    def test_stops_when_not_enough_data(self):
        """Folds should stop generating when there's insufficient data for val window."""
        folds = generate_folds(
            total_rows=1000,
            train_days=800,
            val_days=100,
            retrain_every=50,
            expanding=True,
        )
        # Last fold's val_end must fit within total_rows
        for f in folds:
            assert f.val_end_idx <= 1000
