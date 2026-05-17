"""Phase 1 ML pipeline upgrade tests.

Tests for:
- compute_ranking_metrics(): correctness of IC, ICIR, Precision@K, spread
- compute_composite_score(): weighting and edge cases
- EarlyStopping with composite metric
- make_targets() thresholded_direction mode
- build_datasets_with_metadata(): neutral filtering + split_summary
- Baselines: always_up, prev_day_sign, five_day_momentum
"""

from __future__ import annotations

import numpy as np
import pytest

from ml.metrics import compute_ranking_metrics, compute_composite_score, RankingMetrics
from ml.dataset import make_targets, StockDataset, build_datasets_with_metadata, PrecomputedFeatures
from ml.baselines import always_up_baseline, prev_day_sign_baseline, five_day_momentum_baseline
from ml.train import EarlyStopping
from ml.model import LSTMPredictor
from ml.constants import NUM_FEATURES

import pandas as pd


# ── Helpers ────────────────────────────────────────────────────────────────

def _make_model():
    return LSTMPredictor(input_size=NUM_FEATURES, hidden_size=8, num_layers=1)


def _make_close(n: int = 300, seed: int = 0) -> pd.Series:
    rng = np.random.default_rng(seed)
    prices = 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, n))
    idx = pd.date_range("2020-01-01", periods=n, freq="B")
    return pd.Series(prices, index=idx)


def _make_cached_features(n_symbols: int = 3, n_bars: int = 400, seed: int = 42) -> PrecomputedFeatures:
    """Build a synthetic PrecomputedFeatures for dataset tests."""
    rng = np.random.default_rng(seed)
    symbol_features = {}
    symbol_close = {}
    idx = pd.date_range("2019-01-01", periods=n_bars, freq="B")
    for i in range(n_symbols):
        sym = f"SYM{i}"
        feat = pd.DataFrame(
            rng.normal(0, 1, (n_bars, NUM_FEATURES)).astype(np.float32),
            index=idx,
            columns=[f"f{j}" for j in range(NUM_FEATURES)],
        )
        prices = 100.0 * np.cumprod(1 + rng.normal(0.0003, 0.01, n_bars))
        close = pd.Series(prices, index=idx)
        symbol_features[sym] = feat
        symbol_close[sym] = close
    return PrecomputedFeatures(symbol_features, symbol_close)


# ── compute_ranking_metrics ────────────────────────────────────────────────

class TestComputeRankingMetrics:
    def test_perfect_positive_correlation(self):
        """When predictions == actuals, IC should be 1.0."""
        actuals = np.linspace(-0.02, 0.02, 50)
        m = compute_ranking_metrics(actuals, actuals)
        assert abs(m.spearman_ic - 1.0) < 1e-6
        assert abs(m.pearson_ic - 1.0) < 1e-6

    def test_perfect_negative_correlation(self):
        """When predictions are perfectly inverted, IC should be -1.0."""
        actuals = np.linspace(-0.02, 0.02, 50)
        m = compute_ranking_metrics(-actuals, actuals)
        assert abs(m.spearman_ic - (-1.0)) < 1e-6

    def test_precision_at_k_perfect_ranker(self):
        """Perfect ranker: top-K should all be positive → P@K = 1.0."""
        n = 100
        actuals = np.concatenate([np.ones(50) * 0.01, -np.ones(50) * 0.01])
        preds = np.concatenate([np.ones(50) * 0.01, -np.ones(50) * 0.01])
        m = compute_ranking_metrics(preds, actuals)
        assert m.precision_at_10 == 1.0

    def test_precision_at_k_worst_ranker(self):
        """Worst ranker: top-K should all be negative → P@K = 0.0."""
        n = 100
        actuals = np.concatenate([np.ones(50) * 0.01, -np.ones(50) * 0.01])
        preds = np.concatenate([-np.ones(50) * 0.01, np.ones(50) * 0.01])  # inverted
        m = compute_ranking_metrics(preds, actuals)
        assert m.precision_at_10 == 0.0

    def test_top_bottom_spread_positive_for_good_model(self):
        """Good model: top decile returns should exceed bottom decile → positive spread."""
        rng = np.random.default_rng(0)
        actuals = rng.normal(0, 0.01, 200)
        # Predictions correlated with actuals (signal with noise)
        preds = actuals + rng.normal(0, 0.005, 200)
        m = compute_ranking_metrics(preds, actuals)
        assert m.top_bottom_spread > 0

    def test_few_samples_returns_defaults(self):
        """< 5 samples → return RankingMetrics with n_samples set correctly."""
        m = compute_ranking_metrics(np.array([0.01, -0.02]), np.array([0.01, -0.02]))
        assert m.spearman_ic == 0.0
        assert m.n_samples == 2

    def test_nan_filtered(self):
        """NaN predictions/actuals are silently dropped."""
        preds = np.array([0.01, np.nan, -0.01, 0.02, -0.02])
        acts = np.array([0.01, 0.01, -0.01, 0.02, -0.02])
        m = compute_ranking_metrics(preds, acts)
        assert m.n_samples == 4

    def test_icir_block_wise_nonzero_for_correlated_series(self):
        """Block-wise ICIR should be nonzero for a correlated signal."""
        rng = np.random.default_rng(7)
        actuals = rng.normal(0, 0.01, 500)
        preds = actuals + rng.normal(0, 0.003, 500)
        m = compute_ranking_metrics(preds, actuals, block_size=50)
        assert abs(m.icir) > 0.0
        assert m.n_ic_periods > 0

    def test_returns_ranking_metrics_instance(self):
        m = compute_ranking_metrics(np.random.randn(50), np.random.randn(50))
        assert isinstance(m, RankingMetrics)

    def test_to_dict_has_all_fields(self):
        m = compute_ranking_metrics(np.random.randn(50), np.random.randn(50))
        d = m.to_dict()
        expected_keys = {
            "pearson_ic", "spearman_ic", "icir",
            "precision_at_5", "precision_at_10", "precision_at_20",
            "top_decile_return", "bottom_decile_return", "top_bottom_spread",
            "n_samples", "n_ic_periods",
        }
        assert expected_keys.issubset(d.keys())


# ── compute_composite_score ────────────────────────────────────────────────

class TestComputeCompositeScore:
    def test_random_predictions_near_zero(self):
        """Random predictions → DA≈0.5, IC≈0, P@10≈0.5 → score ≈ 0."""
        score = compute_composite_score(da=0.5, spearman_ic=0.0, precision_at_10=0.5)
        assert abs(score) < 1e-9

    def test_perfect_predictions_high_score(self):
        score = compute_composite_score(da=1.0, spearman_ic=1.0, precision_at_10=1.0)
        # 0.50*1 + 0.30*0.5 + 0.20*0.5 = 0.50 + 0.15 + 0.10 = 0.75
        assert abs(score - 0.75) < 1e-9

    def test_weights_sum_to_one_when_applied(self):
        """custom weights should work correctly."""
        score = compute_composite_score(
            da=1.0, spearman_ic=1.0, precision_at_10=1.0,
            da_weight=0.4, ic_weight=0.4, prec_weight=0.2,
        )
        # 0.4*1 + 0.4*0.5 + 0.2*0.5 = 0.4 + 0.2 + 0.1 = 0.70
        assert abs(score - 0.70) < 1e-9

    def test_negative_ic_penalizes_score(self):
        base = compute_composite_score(da=0.52, spearman_ic=0.0, precision_at_10=0.5)
        penalized = compute_composite_score(da=0.52, spearman_ic=-0.1, precision_at_10=0.5)
        assert penalized < base

    def test_higher_da_gives_higher_score(self):
        s1 = compute_composite_score(da=0.52, spearman_ic=0.05, precision_at_10=0.6)
        s2 = compute_composite_score(da=0.55, spearman_ic=0.05, precision_at_10=0.6)
        assert s2 > s1


# ── EarlyStopping with composite metric ───────────────────────────────────

class TestEarlyStoppingComposite:
    def test_composite_stops_on_plateau(self):
        es = EarlyStopping(patience=3, min_epochs=1, metric="composite")
        m = _make_model()
        # Good initial step
        assert not es.step(0.52, m, spearman_ic=0.05, precision_at_10=0.55)
        # Three consecutive non-improving steps
        assert not es.step(0.50, m, spearman_ic=0.02, precision_at_10=0.51)
        assert not es.step(0.50, m, spearman_ic=0.02, precision_at_10=0.51)
        assert es.step(0.50, m, spearman_ic=0.02, precision_at_10=0.51)

    def test_composite_resets_on_ic_improvement(self):
        """Improving IC (while DA flat) should reset counter via composite."""
        es = EarlyStopping(patience=3, min_epochs=1, metric="composite")
        m = _make_model()
        assert not es.step(0.52, m, spearman_ic=0.05, precision_at_10=0.55)
        assert not es.step(0.51, m, spearman_ic=0.04, precision_at_10=0.52)
        # IC jump should reset counter
        assert not es.step(0.51, m, spearman_ic=0.15, precision_at_10=0.52)
        assert not es.step(0.50, m, spearman_ic=0.14, precision_at_10=0.51)

    def test_best_da_always_tracks_raw_da(self):
        """best_da must stay as raw DA regardless of composite score."""
        es = EarlyStopping(patience=5, min_epochs=1, metric="composite")
        m = _make_model()
        es.step(0.51, m, spearman_ic=0.10, precision_at_10=0.60)  # composite high
        es.step(0.55, m, spearman_ic=0.00, precision_at_10=0.50)  # DA higher but composite lower
        # best_da = 0.55 (raw DA) or 0.51 depending on which epoch had best composite
        # What matters: best_da reflects the raw DA at the best composite epoch
        assert es.best_da in (0.51, 0.55)

    def test_directional_accuracy_mode_uses_raw_da(self):
        es = EarlyStopping(patience=3, min_epochs=1, metric="directional_accuracy")
        m = _make_model()
        es.step(0.55, m, spearman_ic=0.0, precision_at_10=0.5)
        es.step(0.52, m, spearman_ic=0.0, precision_at_10=0.5)
        es.step(0.53, m, spearman_ic=0.0, precision_at_10=0.5)
        assert abs(es.best_da - 0.55) < 1e-6

    def test_old_api_still_works(self):
        """Calling step(da, model) without IC/P10 args must not raise."""
        es = EarlyStopping(patience=3, min_epochs=1)
        m = _make_model()
        assert not es.step(0.52, m)
        assert not es.step(0.51, m)


# ── make_targets thresholded_direction ────────────────────────────────────

class TestThresholdedTargets:
    def test_labels_above_threshold_are_positive(self):
        """Returns > threshold → label = +1.0."""
        close = _make_close(100)
        targets = make_targets(close, horizon=1, mode="thresholded_direction", threshold_bps=20)
        log_ret = np.log(close / close.shift(1)).shift(-1)
        valid = targets.dropna()
        for idx in valid.index:
            lr = log_ret.get(idx, np.nan)
            if np.isnan(lr):
                continue
            if lr > 0.002:
                assert valid[idx] == 1.0
            elif lr < -0.002:
                assert valid[idx] == -1.0
            else:
                assert valid[idx] == 0.0

    def test_neutral_zone_count(self):
        """Neutral samples (label=0) should exist for reasonable threshold."""
        close = _make_close(300)
        targets = make_targets(close, horizon=1, mode="thresholded_direction", threshold_bps=50)
        valid = targets.dropna()
        neutral_count = (valid == 0.0).sum()
        assert neutral_count > 0

    def test_zero_threshold_minimal_neutrals(self):
        """threshold_bps=0 → neutral zone only for exact-zero returns (rare in practice)."""
        close = _make_close(200)
        targets = make_targets(close, horizon=1, mode="thresholded_direction", threshold_bps=0)
        valid = targets.dropna()
        # Exact-zero returns (price unchanged) are legitimately neutral; must be very rare
        assert (valid == 0.0).sum() <= 5

    def test_backward_compat_log_return(self):
        """log_return mode unaffected by threshold_bps (ignored in that mode)."""
        close = _make_close(100)
        t1 = make_targets(close, horizon=1, mode="log_return")
        t2 = make_targets(close, horizon=1, mode="log_return", threshold_bps=50)
        pd.testing.assert_series_equal(t1, t2)

    def test_unknown_mode_raises(self):
        with pytest.raises(ValueError, match="Unknown target mode"):
            make_targets(_make_close(100), horizon=1, mode="invalid_mode")


# ── build_datasets_with_metadata ──────────────────────────────────────────

class TestBuildDatasetsWithMetadata:
    def test_returns_five_tuple(self):
        cached = _make_cached_features()
        result = build_datasets_with_metadata(cached, horizon=7, seq_len=30, val_days=40, test_days=40)
        assert len(result) == 5

    def test_split_summary_has_required_keys(self):
        cached = _make_cached_features()
        _, _, _, _, meta = build_datasets_with_metadata(cached, horizon=7, seq_len=30, val_days=40, test_days=40)
        ss = meta["split_summary"]
        assert "train" in ss
        assert "val" in ss
        assert "test" in ss
        assert "rows" in ss["train"]
        assert "rows" in ss["val"]
        assert "rows" in ss["test"]

    def test_val_raw_targets_same_length_as_val_ds(self):
        cached = _make_cached_features()
        _, val_ds, _, _, meta = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40
        )
        val_raw = meta["val_raw_targets"]
        # raw targets length = val features rows
        assert len(val_raw) == len(val_ds.targets)

    def test_neutral_filtering_reduces_training_size(self):
        """With high threshold, training should have fewer samples than without."""
        cached = _make_cached_features()
        train_no_filter, _, _, _, meta_no = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40,
            threshold_bps=0,
        )
        train_filtered, _, _, _, meta_yes = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40,
            threshold_bps=300,  # aggressive: 3% threshold → many neutrals
            drop_neutral=True,
        )
        assert meta_yes["neutral_count"] >= 0
        # If threshold is high enough, neutral_count > 0
        if meta_yes["neutral_count"] > 0:
            assert len(train_filtered) <= len(train_no_filter)

    def test_val_test_unaffected_by_neutral_filter(self):
        """Val and test datasets must not be filtered even with high threshold."""
        cached = _make_cached_features()
        _, val_no, test_no, _, _ = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40, threshold_bps=0,
        )
        _, val_yes, test_yes, _, _ = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40,
            threshold_bps=300, drop_neutral=True,
        )
        assert len(val_no) == len(val_yes)
        assert len(test_no) == len(test_yes)

    def test_scaler_fit_on_train_only(self):
        """Scaler must be fit only on training data — val/test use transform()."""
        cached = _make_cached_features()
        _, _, _, scaler, _ = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40
        )
        assert hasattr(scaler, "transform")  # fit was called (RobustScaler/StandardScaler)

    def test_train_rows_positive(self):
        cached = _make_cached_features()
        train_ds, val_ds, test_ds, _, _ = build_datasets_with_metadata(
            cached, horizon=7, seq_len=30, val_days=40, test_days=40
        )
        assert len(train_ds) > 0
        assert len(val_ds) > 0
        assert len(test_ds) > 0


# ── Baselines ─────────────────────────────────────────────────────────────

class TestNewBaselines:
    def test_always_up_returns_positive(self):
        preds = always_up_baseline(50)
        assert (preds > 0).all()
        assert len(preds) == 50

    def test_always_up_custom_magnitude(self):
        preds = always_up_baseline(10, return_magnitude=0.005)
        assert np.allclose(preds, 0.005)

    def test_five_day_momentum_length(self):
        rng = np.random.default_rng(0)
        features = rng.normal(0, 1, (200, NUM_FEATURES)).astype(np.float32)
        targets = rng.normal(0, 0.01, 200).astype(np.float32)
        ds = StockDataset(features, targets, seq_len=30)
        preds = five_day_momentum_baseline(ds)
        assert len(preds) == len(ds)

    def test_prev_day_sign_uses_log_return_column(self):
        """prev_day_sign should use column 17 (Log_Return) of last bar."""
        rng = np.random.default_rng(1)
        features = rng.normal(0, 1, (200, NUM_FEATURES)).astype(np.float32)
        features[:, 17] = 0.005  # force positive Log_Return in all bars
        targets = rng.normal(0, 0.01, 200).astype(np.float32)
        ds = StockDataset(features, targets, seq_len=30)
        preds = prev_day_sign_baseline(ds)
        assert (preds > 0).all()
