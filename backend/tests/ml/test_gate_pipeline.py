"""ml.gate_pipeline: no look-ahead in features, weighting, gate scorecard,
robustness rule, registry record, and an end-to-end smoke run on synthetic data."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from ml import gate_pipeline as g
from ml import phase9_ic as p9


def _ohlcv(n_sym: int = 24, n_days: int = 700, seed: int = 0, signal: float = 0.0) -> pd.DataFrame:
    """Random-walk prices. With *signal* > 0, a stock's next-20d drift depends on
    its past 60d momentum, which the model can legitimately learn."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2015-01-01", periods=n_days)
    rows = []
    for i in range(n_sym):
        r = rng.normal(0.0003, 0.015, n_days)
        lp = np.cumsum(r)
        if signal:
            for t in range(60, n_days):
                r[t] += signal * np.sign(lp[t - 1] - lp[t - 60]) * 0.002
            lp = np.cumsum(r)
        c = 50 * np.exp(lp)
        for d, cv in zip(dates, c):
            rows.append({"symbol": f"S{i:02d}", "date": d, "open": cv, "high": cv * 1.01,
                         "low": cv * 0.99, "close": cv, "volume": 1e6 * (1 + i % 3)})
    return pd.DataFrame(rows)


SECTORS = {f"S{i:02d}": ["Tech", "Energy", "Health", "Fin"][i % 4] for i in range(40)}


def _write_cache(tmp_path, df: pd.DataFrame):
    cache = tmp_path / "cache"
    cache.mkdir()
    for sym, d in df.groupby("symbol"):
        out = d.set_index("date")[["open", "high", "low", "close", "volume"]]
        out.columns = ["Open", "High", "Low", "Close", "Volume"]
        out.index.name = "Date"
        out.to_parquet(cache / f"{sym}_5y.parquet")
    spy = df.groupby("date")["close"].mean().to_frame("Close")
    spy.to_parquet(tmp_path / "SPY.parquet")
    (tmp_path / "sectors.json").write_text(json.dumps({k: {"sector": v} for k, v in SECTORS.items()}))
    return cache


# ── features: no look-ahead ──────────────────────────────────────────────────

def test_features_do_not_use_future_prices():
    df = _ohlcv(n_sym=8, n_days=400)
    cut = df["date"].sort_values().unique()[300]
    base = g.compute_features(df, SECTORS)
    shocked = df.copy()
    future = shocked["date"] > cut
    shocked.loc[future, ["open", "high", "low", "close"]] *= 3.0
    shocked.loc[future, "volume"] *= 10
    alt = g.compute_features(shocked, SECTORS)
    cols = g.BASE_FEATURES + g.EXTENDED_FEATURES
    a = base[base["date"] <= cut].set_index(["date", "symbol"])[cols]
    b = alt[alt["date"] <= cut].set_index(["date", "symbol"])[cols]
    pd.testing.assert_frame_equal(a, b)
    # the target is the only forward-looking column, and it does change
    t0 = base.set_index(["date", "symbol"])[g.TARGET_COL]
    t1 = alt.set_index(["date", "symbol"])[g.TARGET_COL]
    assert not np.allclose(t0.loc[t0.index.get_level_values(0) == cut].fillna(0),
                           t1.loc[t1.index.get_level_values(0) == cut].fillna(0))


def test_target_is_forward_log_return():
    df = _ohlcv(n_sym=3, n_days=80)
    f = g.compute_features(df, SECTORS)
    s = df[df.symbol == "S00"].set_index("date")["close"]
    expect = np.log(s.shift(-20) / s)
    got = f[f.symbol == "S00"].set_index("date")[g.TARGET_COL]
    pd.testing.assert_series_equal(got.dropna(), expect.dropna(), check_names=False)


def test_sector_relative_momentum_is_demeaned_within_sector():
    f = g.compute_features(_ohlcv(n_sym=8, n_days=120), SECTORS)
    d = f.dropna(subset=["sector_rel_mom_20d"])
    med = d.groupby([d["date"], d["symbol"].map(SECTORS)])["sector_rel_mom_20d"].median()
    assert np.allclose(med.to_numpy(), 0.0, atol=1e-12)


# ── portfolio weights / backtest ─────────────────────────────────────────────

def test_inverse_vol_weights_are_capped_and_sum_to_one():
    gi = pd.DataFrame({"vol": [0.05, 0.4, 0.4, 0.4, np.nan]}, index=list("ABCDE"))
    w = p9.portfolio_weights(gi, list("ABCDE"), "inverse_vol", "vol", max_weight=0.3)
    assert abs(w.sum() - 1) < 1e-9
    assert w.max() <= 0.3 + 1e-9
    assert w[0] == pytest.approx(0.3)          # lowest vol hits the cap
    assert w[4] == pytest.approx(w[1])         # missing vol -> median vol


def test_equal_weight_backtest_matches_phase9_cost_rule():
    dates = pd.bdate_range("2021-01-01", periods=60)
    rows = [{"date": d, "symbol": f"S{i}", "pred": float(i if k % 2 == 0 else -i), "actual": 0.0}
            for k, d in enumerate(dates[::20]) for i in range(4)]
    preds = pd.DataFrame(rows)
    spy = pd.Series(100.0, index=pd.bdate_range("2020-12-01", periods=120))
    bt = p9.backtest(preds, spy, {f"S{i}": f"X{i}" for i in range(4)}, top_k=2,
                     horizon=1, max_sector_weight=1.0, max_consecutive=99, cost_bps=10)
    # first rebalance: 2 sides x 10bp; then the whole book flips (2 of 2 names new)
    assert bt["period_returns"][0] == pytest.approx(-0.002)
    assert bt["period_returns"][1] == pytest.approx(-0.002)


# ── scorecard / record ───────────────────────────────────────────────────────

def _fake_summary(n_pass_flags: dict) -> dict:
    bt = {"cumulative_return": 0.5, "spy_cumulative_return": 0.4, "sharpe": 1.0, "spy_sharpe": 0.9,
          "max_drawdown": -0.3, "spy_max_drawdown": -0.2, "max_symbol_frequency": 0.3,
          "max_symbol_return_contribution": 0.1, "max_sector_return_contribution": 0.2,
          "period": ["2021-01-04", "2024-10-01"]}
    m = {"variant": "v", "description": "d", "mean_ic": 0.031, "ic_hit_rate": 0.56,
         "ic_tstat_nonoverlap": 1.5, "regime_ic": {"correction": {"mean_ic": 0.1}, "trending_up": {"mean_ic": 0.01}},
         "backtest": bt, "spec": {}}
    m["gate"] = p9.evaluate_gate(m)
    m["scorecard"] = g.scorecard(m)
    return m


def test_scorecard_reports_value_threshold_and_matches_gate():
    m = _fake_summary({})
    sc = m["scorecard"]
    assert len(sc) == 10
    assert [r["passed"] for r in sc] == [m["gate"]["checks"][r["key"]] for r in sc]
    dd = next(r for r in sc if r["key"] == "maxdd_lte_spy_maxdd")
    assert dd["value"] == -0.3 and dd["passed"] is False
    assert m["gate"]["n_passed"] == 9


def test_record_is_not_ready_unless_every_rerun_passes():
    m = _fake_summary({})
    meta = {"generated_at": "2026-11-27T00:00:00", "source": "panel", "n_symbols": 1, "date_min": "a",
            "date_max": "b", "ohlcv_sha256_16": "x", "n_variants_tested": 5}
    rob_bad = {"n_runs": 9, "min_gates": 7, "max_gates": 9, "median_gates": 8, "runs_passing": 8, "all_pass": False}
    rec = g.registry_record(m, rob_bad, None, [m], meta)
    assert rec["verdict"] == "NOT_READY" and rec["robust"] is False and rec["deployed"] is False
    rob_ok = {**rob_bad, "min_gates": 8, "runs_passing": 9, "all_pass": True}
    rec = g.registry_record(m, rob_ok, None, [m], meta)
    assert rec["verdict"] == "READY" and rec["robust"] is True
    assert rec["deployed"] is False   # passing research never deploys by itself


def test_gate_thresholds_unchanged():
    assert p9.GATE_THRESHOLDS == {
        "promo_min_ic": 0.03, "promo_min_ic_hit_rate": 0.55, "promo_max_symbol_freq": 0.40,
        "promo_max_symbol_return_contribution": 0.20, "promo_max_sector_contribution": 0.35,
        "min_correction_ic": -0.05, "min_regime_positive_fraction": 0.60, "promote_threshold": 8,
    }


def test_publish_keeps_served_model_verdict(tmp_path):
    p = tmp_path / "status.json"
    p.write_text(json.dumps({"served_model": "lstm", "verdict": "NOT_READY", "gates_passed": None}))
    g.publish({"verdict": "READY", "gates_passed": 9}, p)
    st = json.loads(p.read_text())
    assert st["verdict"] == "NOT_READY" and st["gates_passed"] is None
    assert st["research_candidate"]["gates_passed"] == 9


# ── end to end ───────────────────────────────────────────────────────────────

def test_pipeline_smoke_end_to_end(tmp_path):
    df = _ohlcv(n_sym=30, n_days=620, signal=1.0, seed=3)
    cache = _write_cache(tmp_path, df)
    cfg = g.WFConfig(train_min=300, test_days=60, step=60, n_jobs=1, n_estimators=25)
    plan = {"seed_sets": [(42, 43, 44), (1, 2, 3)], "fold_offsets": [0, 20]}
    res = g.run_pipeline(source="cache", cache_dir=str(cache), sectors_path=str(tmp_path / "sectors.json"),
                         spy_path=str(tmp_path / "SPY.parquet"), out_dir=str(tmp_path / "out"),
                         cfg=cfg, robustness_plan=plan, top_k=5)
    out = tmp_path / "out"
    for name in ("gate_report.md", "gate_run.json", "registry_record.json"):
        assert (out / name).exists()
    rec = json.loads((out / "registry_record.json").read_text())
    assert rec["robustness"]["n_runs"] == 4
    assert rec["verdict"] in ("READY", "NOT_READY")
    assert rec["deployed"] is False
    assert len(rec["scorecard"]) == 10
    # SEC variants and the Phase 9 re-run need the research panel; cache source skips them
    assert set(rec["variants"]) == {"v2_ohlcv_ivol"}
    # planted momentum signal is found; shuffled predictions carry none
    best = res["best"]
    assert best["mean_ic"] > 0.05
    assert abs(best["placebo_ic"]) < 0.05


def test_pipeline_refuses_too_little_history(tmp_path):
    cache = _write_cache(tmp_path, _ohlcv(n_sym=12, n_days=200))
    with pytest.raises(ValueError, match="trading days of history"):
        g.run_pipeline(source="cache", cache_dir=str(cache), sectors_path=str(tmp_path / "sectors.json"),
                       spy_path=str(tmp_path / "SPY.parquet"), out_dir=str(tmp_path / "out"))
