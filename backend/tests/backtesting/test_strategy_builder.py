"""Strategy builder: rule validation and evaluation, presets, runner, robustness, jobs API."""
from __future__ import annotations

import copy
import time
from datetime import datetime

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from bt_fixtures import make_ohlcv, random_walk
from app.services.backtesting import robustness as R
from app.services.backtesting.data import PriceSeries
from app.services.backtesting.engine import BacktestTimeout
from app.services.backtesting.indicators import INDICATORS, IndicatorCache, compute
from app.services.backtesting.rules import PRESETS, StrategySpec, build_signals, grid_combos, warmup_bars
from app.services.backtesting.runner import Robustness, RunRequest, run_strategy

UNIVERSE = {s: random_walk(1500, seed=k + 1, start="2016-01-01", drift=0.0002 * (k + 1))
            for k, s in enumerate(["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "AAA", "BBB", "TQQQ"])}


def fake_loader(sym, start, end):
    df = UNIVERSE.get(sym)
    if df is None:
        return None
    df = df[(df.index >= pd.Timestamp(start)) & (df.index <= pd.Timestamp(end))]
    return PriceSeries(sym, df, "fixture", True, []) if len(df) else None


def _spec(**kw):
    base = {"symbols": ["SPY"], "start_date": "2018-01-01", "end_date": "2021-06-30",
            "entry": {"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": 10}}, "op": "crosses_above",
                                                  "right": {"indicator": "sma", "params": {"period": 30}}}]},
            "exit": {"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": 10}}, "op": "crosses_below",
                                                 "right": {"indicator": "sma", "params": {"period": 30}}}]}}
    base.update(kw)
    return StrategySpec(**base)


def _cache(syms=("SPY",), n=None):
    frames = {s: UNIVERSE[s] if n is None else UNIVERSE[s].iloc[:n] for s in syms}
    idx = None
    for f in frames.values():
        idx = f.index if idx is None else idx.union(f.index)
    return IndicatorCache(frames, idx)


# ── Rules ────────────────────────────────────────────────────────────────────

def test_cross_matches_manual_definition():
    spec = _spec()
    c = _cache()
    ent, ext = build_signals(spec, {}, c)
    close = UNIVERSE["SPY"]["close"]
    f, s = close.rolling(10).mean(), close.rolling(30).mean()
    manual = ((f > s) & (f.shift(1) <= s.shift(1))).to_numpy()
    assert (ent["SPY"] == manual).all() and ent["SPY"].sum() > 5


def test_highest_excludes_today_so_breakouts_are_reachable():
    df = UNIVERSE["SPY"]
    hi = compute("highest", {"period": 20}, df)
    assert hi.iloc[25] == df["high"].iloc[5:25].max()
    spec = _spec(entry={"logic": "all", "rules": [{"left": {"indicator": "close"}, "op": ">",
                                                    "right": {"indicator": "highest", "params": {"period": 20}}}]})
    ent, _ = build_signals(spec, {}, _cache())
    assert ent["SPY"].sum() > 0


def test_and_or_logic():
    r1 = {"left": {"indicator": "rsi", "params": {"period": 14}}, "op": "<", "right": {"value": 40}}
    r2 = {"left": {"indicator": "close"}, "op": ">", "right": {"indicator": "sma", "params": {"period": 50}}}
    c = _cache()
    a = build_signals(_spec(entry={"logic": "all", "rules": [r1, r2]}), {}, c)[0]["SPY"]
    o = build_signals(_spec(entry={"logic": "any", "rules": [r1, r2]}), {}, c)[0]["SPY"]
    x = build_signals(_spec(entry={"logic": "all", "rules": [r1]}), {}, c)[0]["SPY"]
    y = build_signals(_spec(entry={"logic": "all", "rules": [r2]}), {}, c)[0]["SPY"]
    assert (a == (x & y)).all() and (o == (x | y)).all()
    nested = _spec(entry={"logic": "any", "rules": [{"logic": "all", "rules": [r1, r2]}, r1]})
    assert (build_signals(nested, {}, c)[0]["SPY"] == ((x & y) | x)).all()


@pytest.mark.parametrize("name", [k for k in INDICATORS if k != "momentum_rank"])
def test_every_indicator_is_causal(name):
    """Changing bars after k leaves every value up to k unchanged."""
    df = UNIVERSE["QQQ"]
    k = 900
    alt = df.copy()
    alt.iloc[k + 1:, :4] = alt.iloc[k + 1:, :4] * 1.7
    alt.iloc[k + 1:, 4] = alt.iloc[k + 1:, 4] * 3
    params = {p: d for p, (_t, d, _lo, _hi) in INDICATORS[name][0].items()}
    a, b = compute(name, params, df), compute(name, params, alt)
    np.testing.assert_allclose(a.iloc[: k + 1].to_numpy(), b.iloc[: k + 1].to_numpy(), equal_nan=True)


def test_momentum_rank_is_cross_sectional_and_causal():
    syms = ("SPY", "QQQ", "IWM")
    c = _cache(syms)
    ranks = np.vstack([c.get(s, "momentum_rank", {"period": 20}) for s in syms])
    valid = ~np.isnan(ranks).any(axis=0)
    assert set(np.unique(ranks[:, valid])) <= {1.0, 2.0, 3.0}
    c2 = _cache(syms, n=700)
    r2 = np.vstack([c2.get(s, "momentum_rank", {"period": 20}) for s in syms])
    np.testing.assert_array_equal(ranks[:, :700], r2)


def test_param_references_and_grid():
    spec = _spec(parameters={"fast": 10, "slow": 30}, param_grid={"fast": [5, 10], "slow": [30, 60]},
                 entry={"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": "$fast"}},
                                                    "op": "crosses_above", "right": {"indicator": "sma", "params": {"period": "$slow"}}}]})
    combos = grid_combos(spec)
    assert len(combos) == 4 and {"fast": 5, "slow": 60} in combos
    assert warmup_bars(spec) >= 61


@pytest.mark.parametrize("bad,msg", [
    ({"symbols": [f"S{i}" for i in range(11)]}, "at most 10"),
    ({"start_date": "1990-01-01", "end_date": "2021-01-01"}, "25 years"),
    ({"param_grid": {"a": list(range(1, 9)), "b": list(range(1, 10))}, "parameters": {}}, "limit is 60"),
    ({"entry": {"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": 5000}}, "op": ">", "right": {"value": 1}}]}}, "outside"),
    ({"entry": {"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": "$nope"}}, "op": ">", "right": {"value": 1}}]}}, "not defined"),
    ({"entry": {"logic": "all", "rules": [{"left": {"indicator": "wat"}, "op": ">", "right": {"value": 1}}]}}, "unknown indicator"),
    ({"entry": {"logic": "all", "rules": [{"left": {"indicator": "momentum_rank"}, "op": "<=", "right": {"value": 1}}]}}, "at least 2 symbols"),
    ({"entry": {"logic": "all", "rules": [{"logic": "all", "rules": [{"logic": "all", "rules": [{"logic": "all", "rules": [
        {"left": {"indicator": "close"}, "op": ">", "right": {"value": 1}}]}]}]}]}}, "nest"),
    ({"sizing": "pct_equity", "sizing_value": 3}, "fraction"),
    ({"commission_bps": 10_000}, "less than or equal"),
    ({"symbols": [f"S{i}" for i in range(10)], "start_date": "2000-01-01", "end_date": "2024-01-01",
      "parameters": {}, "param_grid": {"a": [1, 2, 3, 4, 5, 6], "b": [1, 2, 3, 4, 5]}}, "too much work"),
])
def test_spec_bounds(bad, msg):
    with pytest.raises(ValidationError) as e:
        _spec(**bad)
    assert msg in str(e.value)


@pytest.mark.parametrize("preset", PRESETS, ids=[p["id"] for p in PRESETS])
def test_presets_validate_and_run(preset):
    spec = {**copy.deepcopy(preset["spec"]), "start_date": "2019-01-01", "end_date": "2021-12-31"}
    req = RunRequest(spec=StrategySpec(**spec), robustness=Robustness(sweep=False, monte_carlo_sims=0))
    out = run_strategy(req, loader=fake_loader)
    assert out["metrics"]["bars"] > 500
    assert out["disclaimer"].startswith("Hypothetical results")


# ── Runner ───────────────────────────────────────────────────────────────────

def test_runner_buy_and_hold_known_answer_with_warmup():
    bh = [p for p in PRESETS if p["id"] == "buy_and_hold"][0]["spec"]
    spec = StrategySpec(**{**bh, "symbols": ["SPY"], "start_date": "2018-01-01", "end_date": "2020-12-31",
                           "commission_bps": 10, "slippage_bps": 5})
    out = run_strategy(RunRequest(spec=spec, robustness=Robustness(sweep=False, monte_carlo_sims=0, oos_split=None)),
                       loader=fake_loader)
    df = UNIVERSE["SPY"]
    win = df[(df.index >= "2018-01-01") & (df.index <= "2020-12-31")]
    buy, sell = win["open"].iloc[1] * 1.0005, win["close"].iloc[-1] * 0.9995
    expected = 10_000 * sell / buy * (1 - 0.001) / (1 + 0.001)
    assert out["metrics"]["final_equity"] == pytest.approx(expected, abs=0.01)
    assert out["trades"][0]["entry_date"] == win.index[1].date().isoformat()
    assert out["execution"]["first_bar"] == win.index[0].date().isoformat()


def test_runner_warmup_lets_slow_indicator_trade_on_day_one():
    spec = _spec(entry={"logic": "all", "rules": [{"left": {"indicator": "close"}, "op": ">",
                                                    "right": {"indicator": "sma", "params": {"period": 200}}}]}, exit=None,
                 start_date="2019-01-01")
    out = run_strategy(RunRequest(spec=spec, robustness=Robustness(sweep=False, monte_carlo_sims=0)), loader=fake_loader)
    close = UNIVERSE["SPY"]["close"]
    above = (close > close.rolling(200).mean())
    first_signal = above[above.index >= "2019-01-01"].idxmax()
    assert out["trades"][0]["signal_date"] == first_signal.date().isoformat()


def test_runner_sweep_robustness_and_walk_forward():
    spec = _spec(parameters={"fast": 10, "slow": 30}, param_grid={"fast": [5, 10, 20], "slow": [30, 60, 90]},
                 entry={"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": "$fast"}},
                                                    "op": "crosses_above", "right": {"indicator": "sma", "params": {"period": "$slow"}}}]},
                 exit={"logic": "all", "rules": [{"left": {"indicator": "sma", "params": {"period": "$fast"}},
                                                   "op": "crosses_below", "right": {"indicator": "sma", "params": {"period": "$slow"}}}]},
                 start_date="2017-01-01", end_date="2021-09-30")
    out = run_strategy(RunRequest(spec=spec, robustness=Robustness(walk_forward_folds=4, monte_carlo_sims=200)), loader=fake_loader)
    sw = out["robustness"]["sweep"]
    assert len(sw["grid"]) == 9 and all("out_of_sample" in g for g in sw["grid"])
    assert 0.0 <= sw["pbo"]["pbo"] <= 1.0 and sw["pbo"]["splits"] == 252
    assert 0.0 <= sw["deflated_sharpe"]["deflated_sharpe_probability"] <= 1.0
    wf = sw["walk_forward"]
    assert len(wf["folds"]) == 4
    for f in wf["folds"]:
        assert f["train"][1] < f["test"][0]
    assert out["robustness"]["split"]["out_of_sample"]["start"] == out["robustness"]["split"]["split_date"]
    bb = out["monte_carlo"]["block_bootstrap"]
    assert bb["final_return_pct"]["p5"] < bb["final_return_pct"]["p95"]


def test_runner_errors_and_budget():
    with pytest.raises(ValueError, match="No price data"):
        run_strategy(RunRequest(spec=_spec(symbols=["NOPE"])), loader=fake_loader)
    spec = _spec(parameters={"fast": 10, "slow": 30}, param_grid={"fast": [5, 10, 20], "slow": [30, 60, 90]})
    with pytest.raises(BacktestTimeout):
        run_strategy(RunRequest(spec=spec), loader=fake_loader, deadline=time.monotonic() - 1)


def test_runner_multi_asset_rotation_respects_gross_cap():
    p = [p for p in PRESETS if p["id"] == "momentum_rotation"][0]["spec"]
    spec = StrategySpec(**{**p, "start_date": "2018-01-01", "end_date": "2021-12-31"})
    out = run_strategy(RunRequest(spec=spec, robustness=Robustness(sweep=False, monte_carlo_sims=0)), loader=fake_loader)
    assert out["metrics"]["avg_gross_exposure_pct"] <= 100.5
    held = {t["symbol"] for t in out["trades"]}
    assert len(held) >= 3
    assert any("Survivorship" in w for w in out["warnings"])
    # monthly decisions: every signal date is the last bar of its month
    idx = UNIVERSE["SPY"].index
    for t in out["trades"]:
        d = pd.Timestamp(t["signal_date"])
        nxt = idx[idx.get_loc(d) + 1]
        assert nxt.month != d.month


# ── Robustness math ─────────────────────────────────────────────────────────

def test_pbo_high_for_noise_low_for_real_edge():
    rng = np.random.default_rng(0)
    noise = rng.normal(0, 0.01, (2000, 20))
    assert R.pbo_cscv(noise)["pbo"] > 0.3
    edge = noise.copy()
    edge[:, 0] += 0.003  # one variant really is better, everywhere
    assert R.pbo_cscv(edge)["pbo"] < 0.05


def test_deflated_sharpe_penalises_many_trials():
    rng = np.random.default_rng(1)
    trials = rng.normal(0, 0.01, (1000, 50))
    srs = [R.sharpe(trials[:, j]) for j in range(50)]
    best = int(np.argmax(srs))
    many = R.deflated_sharpe(trials[:, best], srs)
    single = R.deflated_sharpe(trials[:, best], [srs[best]])
    assert many["deflated_sharpe_probability"] < single["deflated_sharpe_probability"]
    assert many["deflated_sharpe_probability"] < 0.5
    strong = rng.normal(0.002, 0.01, 1000)
    assert R.deflated_sharpe(strong, [R.sharpe(strong)])["deflated_sharpe_probability"] > 0.99


def test_walk_forward_selects_on_train_only():
    idx = pd.bdate_range("2015-01-01", periods=1000)
    good_early = np.r_[np.full(500, 0.002), np.full(500, -0.002)]
    good_late = -good_early
    noise = np.random.default_rng(2).normal(0, 0.001, (1000, 2))
    rets = pd.DataFrame({0: good_early + noise[:, 0], 1: good_late + noise[:, 1]}, index=idx)
    out = R.analyse_sweep([{"v": 0}, {"v": 1}], rets, 252, oos_frac=0.5, wf_folds=4)
    picks = [f["params"]["v"] for f in out["walk_forward"]["folds"]]
    assert picks[0] == 0  # first fold trains only on the early regime
    assert out["oos_split"]["selected"] == 0 and out["oos_split"]["out_of_sample"]["sharpe"] < 0


def test_folds_never_overlap():
    for mode in ("anchored", "rolling"):
        folds = R.walk_forward_folds(1000, 5, mode)
        for a, b, c, d in folds:
            assert a < b <= c < d
        assert folds[-1][3] == 1000


# ── Jobs API ─────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    from app.api import backtest_v2 as api
    from app.api.auth import create_access_token
    from app.services.backtesting import jobs, runner

    monkeypatch.setattr(api, "manager", jobs.JobManager(workers=1, budget_s=30))
    orig = runner.run_strategy
    monkeypatch.setattr(api, "run_strategy", lambda req, **kw: orig(req, loader=fake_loader, **kw))
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    c = TestClient(app)
    c.a = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.b = {"Authorization": f"Bearer {create_access_token(2)}"}
    return c


def _body(**kw):
    s = _spec(**kw).model_dump()
    return {"spec": s, "robustness": {"monte_carlo_sims": 100}}


def _wait(client, jid, headers, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        j = client.get(f"/api/v1/backtest/v2/jobs/{jid}", headers=headers).json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_jobs_require_auth(client):
    assert client.post("/api/v1/backtest/v2/jobs", json=_body()).status_code == 401


def test_job_lifecycle_and_isolation(client):
    r = client.post("/api/v1/backtest/v2/jobs", json=_body(), headers=client.a)
    assert r.status_code == 202, r.text
    jid = r.json()["id"]
    assert client.get(f"/api/v1/backtest/v2/jobs/{jid}", headers=client.b).status_code == 404
    j = _wait(client, jid, client.a)
    assert j["status"] == "done" and j["progress"] == 1.0
    assert j["result"]["disclaimer"].startswith("Hypothetical")
    assert j["result"]["series"]["points"][0]["benchmark"] is not None


def test_one_active_job_per_user(client, monkeypatch):
    from app.api import backtest_v2 as api

    gate = {"go": False}

    def slow(req, **kw):
        while not gate["go"]:
            time.sleep(0.01)
        return {"ok": True}

    monkeypatch.setattr(api, "run_strategy", slow)
    r1 = client.post("/api/v1/backtest/v2/jobs", json=_body(), headers=client.a)
    r2 = client.post("/api/v1/backtest/v2/jobs", json=_body(), headers=client.a)
    assert r1.status_code == 202 and r2.status_code == 409
    assert client.delete(f"/api/v1/backtest/v2/jobs/{r1.json()['id']}", headers=client.a).status_code == 200
    gate["go"] = True


def test_validate_and_meta(client):
    m = client.get("/api/v1/backtest/v2/meta").json()
    assert {p["id"] for p in m["presets"]} >= {"golden_cross", "momentum_rotation", "buy_and_hold"}
    assert m["limits"]["max_symbols"] == 10
    bad = _body()
    bad["spec"]["symbols"] = [f"X{i}" for i in range(20)]
    assert client.post("/api/v1/backtest/v2/validate", json=bad).status_code == 422
    ok = client.post("/api/v1/backtest/v2/validate", json=_body()).json()
    assert ok["rules_text"]["entry"] == "SMA(10) crosses above SMA(30)"


# ── "within N bars" conditions + the RSI/MACD preset ─────────────────────────

def _independent_rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def test_within_extends_a_cross_over_the_next_n_bars_only():
    df = UNIVERSE["SPY"]
    cache = IndicatorCache({"SPY": df}, df.index)
    rule = {"left": {"indicator": "sma", "params": {"period": 10}}, "op": "crosses_above",
            "right": {"indicator": "sma", "params": {"period": 30}}}
    base = _spec(entry={"logic": "all", "rules": [rule]}, exit=None)
    wide = _spec(entry={"logic": "all", "rules": [{**rule, "within": 3}]}, exit=None)
    e0 = build_signals(base, {}, cache)[0]["SPY"]
    e3 = build_signals(wide, {}, cache)[0]["SPY"]
    expected = pd.Series(e0.astype(float)).rolling(4, min_periods=1).max().to_numpy() > 0
    assert e0.sum() > 0 and (e3 == expected).all()
    # past bars only: a cross never shows up before it happens
    first = int(np.argmax(e0))
    assert not e3[:first].any()


def test_rsi_macd_preset_matches_an_independent_calculation():
    preset = [p for p in PRESETS if p["id"] == "rsi_macd_trend"][0]["spec"]
    df = UNIVERSE["TQQQ"]
    spec = StrategySpec(**{**copy.deepcopy(preset), "start_date": "2016-01-01", "end_date": "2021-12-31"})
    cache = IndicatorCache({"TQQQ": df}, df.index)
    entries = build_signals(spec, spec.parameters, cache)[0]["TQQQ"]

    c = df["close"]
    rsi = _independent_rsi(c)
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig = macd.ewm(span=9, adjust=False).mean()
    bounce = (rsi > 30) & (rsi.shift(1) <= 30)
    golden = (macd > sig) & (macd.shift(1) <= sig.shift(1))
    trend = (c.rolling(50).mean() > c.rolling(100).mean()) & (c.rolling(100).mean() > c.rolling(200).mean())
    win = lambda s: s.astype(float).rolling(6, min_periods=1).max() > 0
    expected = (win(bounce) & win(golden) & trend).to_numpy()
    # allow for indicator warm-up differences on the first 250 bars
    assert (entries[250:] == expected[250:]).mean() > 0.995
