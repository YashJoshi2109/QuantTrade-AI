"""Unit tests for ml.phase9_ic — purging, PIT lag, transforms, selection, gate."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ml import phase9_ic as p9


# ── fixtures ─────────────────────────────────────────────────────────────────

def _panel(n_sym: int = 30, n_days: int = 120, signal: float = 0.0, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2020-01-01", periods=n_days)
    rows = []
    for i in range(n_sym):
        f = rng.normal(size=n_days)
        y = signal * f + rng.normal(scale=1.0, size=n_days) * 0.05
        for d, fv, yv in zip(dates, f, y):
            rows.append({"symbol": f"S{i:02d}", "date": d, "momentum_5d": fv,
                         "sec_days_since_8k": float(i), p9.TARGET_COL: yv})
    return pd.DataFrame(rows)


SECTORS = {f"S{i:02d}": ("Tech" if i % 2 else "Energy") for i in range(30)}


# ── folds / purging ──────────────────────────────────────────────────────────

def test_purged_folds_leave_horizon_plus_embargo_gap():
    folds = p9.generate_folds(1000, train_min=500, test_days=50, step=50, horizon=20, embargo=5)
    assert folds
    for f in folds:
        # last training label looks 20d ahead; it must end before the test window
        assert f["train_end"] + 20 + 5 < f["test_start"]
        assert f["test_end"] - f["test_start"] == 49


def test_unpurged_folds_touch_test_window():
    folds = p9.generate_folds(1000, train_min=500, test_days=50, step=50, purge=False)
    assert all(f["train_end"] == f["test_start"] - 1 for f in folds)


def test_folds_never_exceed_data():
    folds = p9.generate_folds(600, train_min=500, test_days=63, step=63)
    assert all(f["test_end"] < 600 for f in folds)


# ── PIT lag + transforms ─────────────────────────────────────────────────────

def test_lag_by_symbol_shifts_within_symbol_only():
    df = pd.DataFrame({
        "symbol": ["A", "A", "B", "B"],
        "date": pd.to_datetime(["2020-01-01", "2020-01-02"] * 2),
        "sec_x": [1.0, 2.0, 10.0, 20.0],
    })
    out = p9.lag_by_symbol(df, ["sec_x"], 1).set_index(["symbol", "date"])["sec_x"]
    assert np.isnan(out[("A", pd.Timestamp("2020-01-01"))])
    assert out[("A", pd.Timestamp("2020-01-02"))] == 1.0
    assert np.isnan(out[("B", pd.Timestamp("2020-01-01"))])  # no bleed from A
    assert out[("B", pd.Timestamp("2020-01-02"))] == 10.0


def test_rank_gauss_is_per_date_and_keeps_nan():
    df = pd.DataFrame({"date": pd.to_datetime(["2020-01-01"] * 4 + ["2020-01-02"] * 2),
                       "x": [1.0, 2.0, 3.0, np.nan, 100.0, -100.0]})
    out = p9.rank_gauss(df, ["x"])
    d1 = out["x"].iloc[:3].to_numpy()
    assert d1[0] < d1[1] < d1[2] and abs(d1[1]) < 1e-9
    assert np.isnan(out["x"].iloc[3])
    assert out["x"].iloc[4] > 0 > out["x"].iloc[5]


def test_sector_neutral_target_demeans_within_sector_and_date():
    df = pd.DataFrame({"date": pd.to_datetime(["2020-01-01"] * 4),
                       "symbol": ["S00", "S02", "S01", "S03"],
                       p9.TARGET_COL: [0.1, 0.3, -0.2, 0.0]})
    y = p9.make_target(df, "sector_neutral", SECTORS)
    np.testing.assert_allclose(y.to_numpy(), [-0.1, 0.1, -0.1, 0.1])
    r = p9.make_target(df, "rank", SECTORS)
    assert r.between(-0.5, 0.5).all()
    with pytest.raises(ValueError):
        p9.make_target(df, "bogus", SECTORS)


def test_clean_panel_drops_implausible_targets():
    df = _panel(n_sym=3, n_days=5)
    df.loc[0, p9.TARGET_COL] = 2.5
    df.loc[1, p9.TARGET_COL] = np.nan
    out, n = p9.clean_panel(df)
    assert n == 2 and len(out) == len(df) - 2


# ── IC utilities ─────────────────────────────────────────────────────────────

def test_daily_spearman_perfect_and_inverse():
    df = pd.DataFrame({"date": pd.to_datetime(["2020-01-01"] * 12),
                       "p": np.arange(12.0), "a": np.arange(12.0) ** 3})
    assert p9.daily_spearman(df, "p", "a").iloc[0] == pytest.approx(1.0)
    df["a"] = -df["a"]
    assert p9.daily_spearman(df, "p", "a").iloc[0] == pytest.approx(-1.0)


def test_nonoverlap_tstat_uses_subsample():
    ic = pd.Series([0.05, 0.06, 0.04] * 40)
    assert p9.nonoverlap_tstat(ic, horizon=20) > 0
    assert p9.nonoverlap_tstat(pd.Series([0.1]), horizon=20) == 0.0


def test_screen_features_keeps_informative_feature():
    df = _panel(signal=1.0, n_days=200)
    df["noise"] = np.random.default_rng(1).normal(size=len(df))
    keep = p9.screen_features(df, ["momentum_5d", "noise"], p9.TARGET_COL, min_keep=1)
    assert "momentum_5d" in keep


# ── selection rules ──────────────────────────────────────────────────────────

def test_select_top_k_sector_and_streak_caps():
    ranked = [f"S{i:02d}" for i in range(30)]
    chosen = p9.select_top_k(ranked, SECTORS, top_k=4, max_sector_weight=0.5,
                             streak={"S00": 3}, max_consecutive=3)
    assert "S00" not in chosen
    secs = [SECTORS[s] for s in chosen]
    assert secs.count("Tech") <= 2 and secs.count("Energy") <= 2


def test_select_top_k_phase5_frequency_caps():
    ranked = [f"S{i:02d}" for i in range(30)]
    history = [{"S00", "S01"}] * 6
    chosen = p9.select_top_k(ranked, SECTORS, top_k=4, max_sector_weight=1.0, streak={},
                             max_consecutive=99, history=history, rolling_periods=6,
                             max_rolling_slots=3, max_frequency=0.40)
    assert "S00" not in chosen and "S01" not in chosen and len(chosen) == 4


# ── end-to-end on synthetic data ─────────────────────────────────────────────

def _spy(dates) -> pd.Series:
    return pd.Series(np.linspace(100, 130, len(dates)), index=pd.DatetimeIndex(dates))


def test_run_variant_and_summarize_detect_planted_signal():
    panel = _panel(signal=1.0, n_days=160)
    spec = p9.VariantSpec("t", ("momentum_5d",), target="sector_neutral", rank_features=True)
    run = p9.run_variant(panel, spec, SECTORS, train_min=60, test_days=20, step=20, n_jobs=1)
    assert run.folds and not run.preds.empty
    # purge: no test date may be inside any fold's training window
    s = p9.summarize(run, _spy(sorted(panel["date"].unique())), SECTORS)
    assert s["mean_ic"] > 0.5
    assert s["eligible"] is True
    assert s["gate"]["checks"]["mean_wf_ic_gt_threshold"]


def test_eligibility_excludes_leaky_variants():
    o = ("momentum_5d",)
    s = ("momentum_5d", "sec_days_since_8k")
    assert not p9.VariantSpec("a", o, purge=False).eligible
    assert not p9.VariantSpec("b", s, sec_lag_days=0).eligible
    assert p9.VariantSpec("c", s).eligible
    assert p9.VariantSpec("d", o, sec_lag_days=0).eligible  # no SEC cols -> lag irrelevant


def test_choose_best_ignores_ineligible():
    good = {"variant": "g", "eligible": True, "backtest": {"cumulative_return": 0.1}}
    leaky = {"variant": "l", "eligible": False, "backtest": {"cumulative_return": 9.9}}
    assert p9.choose_best([good, leaky])["variant"] == "g"


def test_gate_uses_unchanged_thresholds():
    assert p9.GATE_THRESHOLDS["promo_min_ic"] == 0.03
    assert p9.GATE_THRESHOLDS["promo_min_ic_hit_rate"] == 0.55
    assert p9.GATE_THRESHOLDS["promo_max_symbol_freq"] == 0.40
    assert p9.GATE_THRESHOLDS["promote_threshold"] == 8
    m = {"mean_ic": 0.029, "ic_hit_rate": 0.56,
         "regime_ic": {"correction": {"mean_ic": -0.04}, "range_bound": {"mean_ic": 0.01},
                       "high_vol": {"mean_ic": 0.02}},  # 2/3 positive >= 60%
         "backtest": {"cumulative_return": 0.5, "spy_cumulative_return": 0.4, "sharpe": 1.0,
                      "spy_sharpe": 0.9, "max_drawdown": -0.1, "spy_max_drawdown": -0.2,
                      "max_symbol_frequency": 0.40, "max_symbol_return_contribution": 0.2,
                      "max_sector_return_contribution": 0.35}}
    g = p9.evaluate_gate(m)
    assert not g["checks"]["mean_wf_ic_gt_threshold"]  # 0.029 is not > 0.03
    assert g["n_passed"] == 9 and g["production_candidate"]


def test_promotion_status_shape():
    best = {"variant": "x", "mean_ic": 0.01, "ic_hit_rate": 0.5,
            "gate": {"n_passed": 6, "production_candidate": False,
                     "checks": {k: (i < 6) for i, k in enumerate(p9.GATE_LABELS)}}}
    st = p9.promotion_status(best, [best], {"generated_at": "now"})
    assert st["verdict"] == "NOT_READY" and st["gates_passed"] == 6
    assert len(st["failed_gates"]) == 4
