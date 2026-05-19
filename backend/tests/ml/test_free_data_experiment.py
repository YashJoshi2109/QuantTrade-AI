"""Tests for ml/free_data_experiment.py — Milestone 8."""
from __future__ import annotations

import json
import numpy as np
import pandas as pd
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


# ── Fixtures ───────────────────────────────────────────────────────────────────

def _make_panel(n_symbols: int = 10, n_dates: int = 300, seed: int = 0) -> pd.DataFrame:
    """Synthetic PIT panel with OHLCV, SEC recency, SEC sentiment, news, and target columns."""
    rng = np.random.RandomState(seed)
    dates = pd.bdate_range("2020-01-02", periods=n_dates)
    symbols = [f"SYM{i:03d}" for i in range(n_symbols)]

    rows = []
    for d in dates:
        for sym in symbols:
            row = {
                "symbol": sym,
                "date": d,
                # OHLCV features
                "momentum_5d": rng.randn(),
                "momentum_20d": rng.randn(),
                "volume_zscore": rng.randn(),
                "rsi_14": rng.uniform(20, 80),
                # SEC recency features
                "sec_days_since_10k": rng.uniform(0, 365),
                "sec_days_since_10q": rng.uniform(0, 90),
                "sec_filings_count_30d": rng.randint(0, 5),
                # SEC sentiment features
                "sec_negative_word_ratio": rng.uniform(0, 0.1),
                "sec_filing_sentiment_score": rng.randn() * 0.1,
                "sec_mdna_text_length": rng.uniform(1000, 50000),
                # News features
                "news_count_7d": rng.randint(0, 20),
                "news_avg_tone_7d": rng.uniform(-5, 5),
                "news_neg_ratio_7d": rng.uniform(0, 1),
                # Target
                "target_h20": rng.randn() * 0.05,
            }
            rows.append(row)
    return pd.DataFrame(rows)


def _make_spy_close(n_dates: int = 400) -> pd.Series:
    rng = np.random.RandomState(99)
    dates = pd.bdate_range("2019-06-01", periods=n_dates)
    prices = 300.0 * np.cumprod(1 + rng.randn(n_dates) * 0.01)
    return pd.Series(prices, index=dates, name="SPY")


class _FakeCfg:
    wf_train_days = 100
    wf_test_days = 30
    wf_retrain_every = 30
    top_k_long = 5
    transaction_cost_bps = 10.0
    slippage_bps = 5.0
    promo_min_ic = 0.03
    promo_min_ic_hit_rate = 0.55


# ── select_features ────────────────────────────────────────────────────────────

def test_select_features_ohlcv_only():
    from ml.free_data_experiment import select_features
    all_cols = ["momentum_5d", "sec_days_since_10k", "news_count_7d", "volume_zscore"]
    selected = select_features("ohlcv_only", all_cols)
    assert "momentum_5d" in selected
    assert "volume_zscore" in selected
    assert "sec_days_since_10k" not in selected
    assert "news_count_7d" not in selected


def test_select_features_ohlcv_sec_recency():
    from ml.free_data_experiment import select_features
    all_cols = ["momentum_5d", "sec_days_since_10k", "sec_filings_count_30d", "news_count_7d"]
    selected = select_features("ohlcv_sec_recency", all_cols)
    assert "momentum_5d" in selected
    assert "sec_days_since_10k" in selected
    assert "sec_filings_count_30d" in selected
    assert "news_count_7d" not in selected


def test_select_features_ohlcv_news():
    from ml.free_data_experiment import select_features
    all_cols = ["momentum_5d", "sec_days_since_10k", "news_count_7d", "news_avg_tone_7d"]
    selected = select_features("ohlcv_news", all_cols)
    assert "momentum_5d" in selected
    assert "news_count_7d" in selected
    assert "news_avg_tone_7d" in selected
    assert "sec_days_since_10k" not in selected


def test_select_features_ohlcv_sec_news_includes_all():
    from ml.free_data_experiment import select_features
    all_cols = [
        "momentum_5d", "sec_days_since_10k", "sec_negative_word_ratio",
        "news_count_7d", "sec_filings_count_30d",
    ]
    selected = select_features("ohlcv_sec_news", all_cols)
    assert set(selected) == set(all_cols)


def test_select_features_unknown_raises():
    from ml.free_data_experiment import select_features
    with pytest.raises(ValueError):
        select_features("nonexistent_variant", ["a", "b"])


# ── run_wf_for_panel ───────────────────────────────────────────────────────────

def test_run_wf_returns_folds():
    from ml.free_data_experiment import run_wf_for_panel
    panel = _make_panel(n_symbols=8, n_dates=250)
    feat_cols = ["momentum_5d", "momentum_20d", "volume_zscore"]
    folds, preds, actuals = run_wf_for_panel(
        panel, feat_cols, "target_h20",
        wf_train_days=100, wf_test_days=30, wf_retrain_every=30,
    )
    assert len(folds) >= 1
    assert isinstance(preds, dict)
    assert isinstance(actuals, dict)
    assert len(preds) > 0


def test_run_wf_fold_schema():
    from ml.free_data_experiment import run_wf_for_panel
    panel = _make_panel(n_symbols=8, n_dates=250)
    folds, _, _ = run_wf_for_panel(
        panel, ["momentum_5d"], "target_h20",
        wf_train_days=100, wf_test_days=30, wf_retrain_every=30,
    )
    for fold in folds:
        assert "mean_ic" in fold
        assert "ic_hit_rate" in fold
        assert "n_train_rows" in fold
        assert "train_start" in fold
        assert "test_end" in fold


def test_run_wf_insufficient_dates_returns_empty():
    from ml.free_data_experiment import run_wf_for_panel
    panel = _make_panel(n_symbols=5, n_dates=50)  # too few dates
    folds, preds, actuals = run_wf_for_panel(
        panel, ["momentum_5d"], "target_h20",
        wf_train_days=100, wf_test_days=30, wf_retrain_every=30,
    )
    assert folds == []
    assert preds == {}
    assert actuals == {}


def test_run_wf_preds_not_in_future():
    """All prediction dates must be within test windows, never in train windows."""
    from ml.free_data_experiment import run_wf_for_panel
    panel = _make_panel(n_symbols=8, n_dates=250)
    folds, preds, actuals = run_wf_for_panel(
        panel, ["momentum_5d", "momentum_20d"], "target_h20",
        wf_train_days=100, wf_test_days=30, wf_retrain_every=30,
    )
    if folds:
        first_test_start = pd.Timestamp(folds[0]["test_start"])
        for d_str in preds:
            assert pd.Timestamp(d_str) >= first_test_start


# ── run_backtest ───────────────────────────────────────────────────────────────

def _make_preds_actuals(n_dates: int = 20, n_syms: int = 10):
    rng = np.random.RandomState(42)
    dates = [str(pd.Timestamp("2022-01-03") + pd.Timedelta(days=i))[:10] for i in range(n_dates)]
    preds, actuals = {}, {}
    for d in dates:
        syms = [f"S{j}" for j in range(n_syms)]
        preds[d] = {s: float(rng.randn()) for s in syms}
        actuals[d] = {s: float(rng.randn() * 0.02) for s in syms}
    return preds, actuals


def test_backtest_returns_expected_keys():
    from ml.free_data_experiment import run_backtest
    preds, actuals = _make_preds_actuals()
    result = run_backtest(preds, actuals, top_k=5)
    assert "cumulative_return" in result
    assert "sharpe" in result
    assert "max_drawdown" in result
    assert "max_symbol_frequency" in result


def test_backtest_max_symbol_freq_bounded():
    from ml.free_data_experiment import run_backtest
    preds, actuals = _make_preds_actuals(n_dates=50, n_syms=10)
    result = run_backtest(preds, actuals, top_k=3)
    assert 0.0 <= result["max_symbol_frequency"] <= 1.0


def test_backtest_max_drawdown_nonpositive():
    from ml.free_data_experiment import run_backtest
    preds, actuals = _make_preds_actuals(n_dates=50, n_syms=15)
    result = run_backtest(preds, actuals, top_k=5)
    assert result["max_drawdown"] <= 0.0


def test_backtest_empty_returns_zeros():
    from ml.free_data_experiment import run_backtest
    result = run_backtest({}, {})
    assert result["cumulative_return"] == 0.0
    assert result["sharpe"] == 0.0


# ── compute_regime_ic ──────────────────────────────────────────────────────────

def test_regime_ic_returns_known_regimes():
    from ml.free_data_experiment import compute_regime_ic
    preds, actuals = _make_preds_actuals(n_dates=40, n_syms=15)
    spy_close = _make_spy_close(n_dates=200)
    result = compute_regime_ic(preds, actuals, spy_close)
    valid_regimes = {"correction", "high_vol", "trending_up", "trending_down", "range_bound"}
    for regime in result:
        assert regime in valid_regimes


def test_regime_ic_schema():
    from ml.free_data_experiment import compute_regime_ic
    preds, actuals = _make_preds_actuals(n_dates=40, n_syms=10)
    spy_close = _make_spy_close(n_dates=200)
    result = compute_regime_ic(preds, actuals, spy_close)
    for regime_data in result.values():
        assert "n_days" in regime_data
        assert "mean_ic" in regime_data
        assert "ic_hit_rate" in regime_data
        assert 0.0 <= regime_data["ic_hit_rate"] <= 1.0


# ── check_gate ─────────────────────────────────────────────────────────────────

def test_gate_production_requires_ic_above_threshold():
    from ml.free_data_experiment import check_gate
    folds = [{"mean_ic": 0.005, "ic_hit_rate": 0.60}]
    backtest = {
        "cumulative_return": 0.30, "sharpe": 1.5, "max_drawdown": -0.10,
        "max_symbol_frequency": 0.30, "spy_cumulative_return": 0.20,
        "spy_sharpe": 1.0, "spy_max_drawdown": -0.15,
    }
    gate = check_gate("test", folds, backtest, {})
    assert gate["production_candidate"] is False  # IC < 0.03


def test_gate_high_ic_scores_well():
    from ml.free_data_experiment import check_gate
    folds = [{"mean_ic": 0.04, "ic_hit_rate": 0.60}]
    backtest = {
        "cumulative_return": 0.50, "sharpe": 2.0, "max_drawdown": -0.10,
        "max_symbol_frequency": 0.35, "spy_cumulative_return": 0.20,
        "spy_sharpe": 1.0, "spy_max_drawdown": -0.15,
    }
    regime_ic = {
        "range_bound": {"mean_ic": 0.04, "ic_hit_rate": 0.60, "n_days": 100},
        "high_vol": {"mean_ic": 0.02, "ic_hit_rate": 0.55, "n_days": 30},
        "trending_up": {"mean_ic": 0.03, "ic_hit_rate": 0.57, "n_days": 50},
    }
    gate = check_gate("test", folds, backtest, regime_ic)
    assert gate["gate_score"] >= 5


def test_gate_has_10_conditions():
    from ml.free_data_experiment import check_gate
    folds = [{"mean_ic": 0.02, "ic_hit_rate": 0.50}]
    backtest = {
        "cumulative_return": 0.10, "sharpe": 0.5, "max_drawdown": -0.20,
        "max_symbol_frequency": 0.50, "spy_cumulative_return": 0.15,
        "spy_sharpe": 0.8, "spy_max_drawdown": -0.12,
    }
    gate = check_gate("test", folds, backtest, {})
    assert len(gate["gates"]) == 10


# ── run_experiment ─────────────────────────────────────────────────────────────

def test_run_experiment_returns_all_variants(tmp_path):
    from ml.free_data_experiment import run_experiment
    panel = _make_panel(n_symbols=8, n_dates=250)
    cfg = _FakeCfg()
    results = run_experiment(panel, cfg, spy_close=None, output_dir=str(tmp_path))
    # Should attempt all 5 variants
    names = [vr.name for vr in results.variant_results]
    assert "ohlcv_only" in names
    assert "ohlcv_sec_recency" in names
    assert "ohlcv_sec_news" in names


def test_run_experiment_saves_summary_json(tmp_path):
    from ml.free_data_experiment import run_experiment
    panel = _make_panel(n_symbols=8, n_dates=250)
    cfg = _FakeCfg()
    run_experiment(panel, cfg, spy_close=None, output_dir=str(tmp_path))
    summary_path = tmp_path / "free_data_ingestion_summary.json"
    assert summary_path.exists()
    data = json.loads(summary_path.read_text())
    assert "overall_decision" in data
    assert "variants" in data
    assert len(data["variants"]) >= 1


def test_run_experiment_saves_report_md(tmp_path):
    from ml.free_data_experiment import run_experiment
    panel = _make_panel(n_symbols=8, n_dates=250)
    cfg = _FakeCfg()
    run_experiment(panel, cfg, spy_close=None, output_dir=str(tmp_path))
    report_path = tmp_path / "h20_free_data_model_report.md"
    assert report_path.exists()
    content = report_path.read_text()
    assert "h=20 Free-Data Model Report" in content
    assert "Variant Comparison" in content
    assert "Gate Scorecards" in content


def test_run_experiment_decision_string_populated(tmp_path):
    from ml.free_data_experiment import run_experiment
    panel = _make_panel(n_symbols=8, n_dates=250)
    cfg = _FakeCfg()
    results = run_experiment(panel, cfg, spy_close=None, output_dir=str(tmp_path))
    assert results.overall_decision != ""
    assert results.best_variant != ""


def test_run_experiment_with_spy(tmp_path):
    from ml.free_data_experiment import run_experiment
    panel = _make_panel(n_symbols=8, n_dates=250)
    spy = _make_spy_close(n_dates=500)
    cfg = _FakeCfg()
    results = run_experiment(panel, cfg, spy_close=spy, output_dir=str(tmp_path))
    # Should not crash; SPY bench values populated for best variant
    if results.variant_results:
        bt = results.variant_results[0].backtest
        # spy fields might be None if dates don't overlap, but key must exist
        assert "spy_cumulative_return" in bt


def test_target_column_not_in_features(tmp_path):
    """Target col excluded from all_feature_cols before select_features is called.
    In run_experiment, all_feature_cols = [c for c in panel.cols if c not in (symbol, date, target)].
    Verify that select_features on feature-only cols never leaks target back in."""
    from ml.free_data_experiment import select_features
    # Simulate what run_experiment does: strip symbol/date/target before calling select_features
    all_cols_raw = ["momentum_5d", "sec_days_since_10k", "news_count_7d", "target_h20"]
    all_feature_cols = [c for c in all_cols_raw if c not in ("symbol", "date", "target_h20")]
    for variant in ("ohlcv_only", "ohlcv_sec_news"):
        selected = select_features(variant, all_feature_cols)
        assert "target_h20" not in selected
