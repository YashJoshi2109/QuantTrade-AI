"""Known-answer and no-look-ahead tests for the backtest engine."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from bt_fixtures import make_ohlcv, random_walk
from app.services.backtesting.engine import EngineConfig, run_engine
from app.services.backtesting.metrics import (
    alpha_beta, calendar_returns, compute_metrics, drawdown_stats, return_stats,
)
from app.services.backtesting.montecarlo import block_bootstrap, trade_bootstrap, trades_overlap


def _hold(n, first=0):
    e = np.zeros(n, dtype=bool)
    e[first] = True
    return e


def _never(n):
    return np.zeros(n, dtype=bool)


# ── Known answers ────────────────────────────────────────────────────────

@pytest.mark.parametrize("comm_bps,slip_bps", [(0, 0), (10, 5), (25, 0), (0, 30)])
def test_buy_and_hold_equals_asset_return_minus_costs(comm_bps, slip_bps):
    df = random_walk(300, seed=21)
    n = len(df)
    cfg = EngineConfig(initial_capital=10_000, commission_bps=comm_bps, slippage_bps=slip_bps)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, cfg)
    c, s = comm_bps / 1e4, slip_bps / 1e4
    buy = df["open"].iloc[1] * (1 + s)
    sell = df["close"].iloc[-1] * (1 - s)
    expected = 10_000 * (sell / buy) * (1 - c) / (1 + c)
    assert res.equity.iloc[-1] == pytest.approx(expected, rel=1e-10)
    assert len(res.trades) == 1
    t = res.trades[0]
    assert t.pnl == pytest.approx(expected - 10_000, rel=1e-9)
    assert t.entry_date == df.index[1].date().isoformat()
    assert t.signal_date == df.index[0].date().isoformat()


def test_short_and_hold_known_answer():
    df = random_walk(200, seed=4)
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(side="short"))
    o1, cT = df["open"].iloc[1], df["close"].iloc[-1]
    assert res.equity.iloc[-1] == pytest.approx(10_000 * (2 - cT / o1), rel=1e-10)
    assert res.trades[0].side == "SHORT"


def test_two_asset_static_weights_known_answer():
    a, b = random_walk(250, seed=1), random_walk(250, seed=2)
    n = len(a)
    cfg = EngineConfig(sizing="pct_equity", sizing_value=0.5)
    res = run_engine({"A": a, "B": b}, {"A": _hold(n), "B": _hold(n)}, {"A": _never(n), "B": _never(n)}, cfg)
    exp = 5_000 * a["close"].iloc[-1] / a["open"].iloc[1] + 5_000 * b["close"].iloc[-1] / b["open"].iloc[1]
    assert res.equity.iloc[-1] == pytest.approx(exp, rel=1e-10)


def test_monthly_rebalance_restores_target_weights():
    a = make_ohlcv(np.linspace(100, 200, 120), spread=0.0)
    b = make_ohlcv(np.full(120, 100.0), spread=0.0)
    n = len(a)
    cfg = EngineConfig(sizing="pct_equity", sizing_value=0.5, rebalance="monthly", close_at_end=False)
    res = run_engine({"A": a, "B": b}, {"A": _hold(n), "B": _hold(n)}, {"A": _never(n), "B": _never(n)}, cfg)
    resizes = [f for f in res.fills if f["action"] == "resize"]
    assert resizes, "monthly rebalance should trade"
    # after a resize fill at an open, A's value should be ~50% of equity at that open
    f = [x for x in resizes if x["symbol"] == "A"][0]
    i = a.index.get_loc(pd.Timestamp(f["date"]))
    a_val = f["qty"] * a["open"].iloc[i]
    eq_prev = res.equity.iloc[i - 1]
    assert a_val / eq_prev == pytest.approx(0.5, abs=0.02)


def test_gross_exposure_cap():
    frames = {k: random_walk(150, seed=s) for k, s in (("A", 1), ("B", 2), ("C", 3))}
    n = 150
    cfg = EngineConfig(sizing="pct_equity", sizing_value=0.5, max_gross_exposure=1.0)
    res = run_engine(frames, {k: _hold(n) for k in frames}, {k: _never(n) for k in frames}, cfg)
    assert res.gross_exposure.max() <= 1.0 + 0.05
    assert len(res.trades) == 2  # the third entry finds no capacity left


def test_fixed_dollar_sizing():
    df = random_walk(100, seed=9)
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(sizing="fixed_dollar", sizing_value=2_500))
    t = res.trades[0]
    assert t.quantity * t.entry_price == pytest.approx(2_500, rel=1e-9)


def test_vol_target_sizing_uses_trailing_vol():
    df = random_walk(200, seed=10, vol=0.03)
    n = len(df)
    e = np.zeros(n, dtype=bool)
    e[60] = True
    res = run_engine({"A": df}, {"A": e}, {"A": _never(n)}, EngineConfig(sizing="vol_target", sizing_value=0.10, vol_lookback=20))
    lr = np.log(df["close"]).diff()
    vol = lr.iloc[41:61].std() * math.sqrt(252)
    t = res.trades[0]
    eq_at_signal = res.equity.iloc[60]
    assert t.quantity * t.entry_price / eq_at_signal == pytest.approx(min(0.10 / vol, 1.0), rel=1e-6)


def test_long_only_cannot_spend_more_than_cash():
    df = random_walk(100, seed=12)
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(sizing="pct_equity", sizing_value=1.0, commission_bps=50))
    assert res.cash.min() >= -1e-6


# ── Stops ───────────────────────────────────────────────────────────────────

def test_stop_and_target_on_same_bar_assumes_stop_first():
    closes = [100.0] * 5 + [100.0] * 10
    df = make_ohlcv(closes, spread=0.0)
    b = df.index[3]
    df.loc[b, ["open", "high", "low", "close"]] = [100.0, 120.0, 80.0, 100.0]
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(stop_loss_pct=5, take_profit_pct=5))
    assert res.trades[0].exit_reason == "stop_loss"
    assert res.trades[0].exit_price == pytest.approx(95.0)


def test_take_profit_gap_fills_at_better_open():
    df = make_ohlcv([100.0] * 20, spread=0.0)
    b = df.index[4]
    df.loc[b, ["open", "high", "low", "close"]] = [130.0, 131.0, 129.0, 130.0]
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(take_profit_pct=10))
    t = res.trades[0]
    assert t.exit_reason == "take_profit_gap" and t.exit_price == pytest.approx(130.0)


def test_short_stop_is_above_entry():
    df = make_ohlcv([100.0] * 20, spread=0.0)
    df.loc[df.index[5], ["open", "high", "low", "close"]] = [100.0, 108.0, 99.0, 104.0]
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(side="short", stop_loss_pct=5))
    t = res.trades[0]
    assert t.exit_reason == "stop_loss" and t.exit_price == pytest.approx(105.0)
    assert t.pnl == pytest.approx(-5.0 * t.quantity)


def test_no_reentry_until_signal_resets_after_stop():
    df = make_ohlcv([100.0] * 30, spread=0.0)
    df.loc[df.index[4], "low"] = 90.0
    n = len(df)
    ent = np.ones(n, dtype=bool)
    res = run_engine({"A": df}, {"A": ent}, {"A": _never(n)}, EngineConfig(stop_loss_pct=5))
    assert len(res.trades) == 1  # entry stays true; no churn back in


def test_max_hold_bars_exit():
    df = random_walk(60, seed=3)
    n = len(df)
    res = run_engine({"A": df}, {"A": _hold(n)}, {"A": _never(n)}, EngineConfig(max_hold_bars=5))
    t = res.trades[0]
    assert t.exit_reason == "max_hold" and t.bars_held == 5


# ── No look-ahead ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(8))
def test_no_fill_uses_an_unseen_bar(seed):
    """Random signals on random data: each fill happens on a bar strictly after
    its signal, at a price inside that bar's range (before slippage)."""
    rng = np.random.default_rng(seed)
    frames = {s: random_walk(300, seed=seed * 10 + k) for k, s in enumerate(("A", "B", "C"))}
    n = 300
    ents = {s: rng.random(n) < 0.05 for s in frames}
    exts = {s: rng.random(n) < 0.05 for s in frames}
    cfg = EngineConfig(sizing="pct_equity", sizing_value=0.3, slippage_bps=0, stop_loss_pct=4,
                       trailing_stop_pct=6, take_profit_pct=8, side="long" if seed % 2 else "short")
    res = run_engine(frames, ents, exts, cfg)
    assert res.trades
    for t in res.trades:
        assert t.entry_date > t.signal_date
        if t.exit_signal_date:
            assert t.exit_date > t.exit_signal_date
        df = frames[t.symbol]
        for d, px in ((t.entry_date, t.entry_price), (t.exit_date, t.exit_price)):
            bar = df.loc[pd.Timestamp(d)]
            assert bar["low"] - 1e-9 <= px <= bar["high"] + 1e-9
        # the signal really was there at the signal bar
        i = df.index.get_loc(pd.Timestamp(t.signal_date))
        assert ents[t.symbol][i]


@pytest.mark.parametrize("k", [80, 150, 220])
def test_truncating_the_future_does_not_change_the_past(k):
    df = random_walk(300, seed=5)
    n = len(df)
    rng = np.random.default_rng(1)
    ent, ext = rng.random(n) < 0.08, rng.random(n) < 0.08
    cfg = EngineConfig(stop_loss_pct=3, trailing_stop_pct=5, commission_bps=5, slippage_bps=5, close_at_end=False)
    full = run_engine({"A": df}, {"A": ent}, {"A": ext}, cfg)
    cut = run_engine({"A": df.iloc[:k]}, {"A": ent[:k]}, {"A": ext[:k]}, cfg)
    np.testing.assert_allclose(full.equity.iloc[:k].to_numpy(), cut.equity.to_numpy(), rtol=1e-12)
    closed_before = [t.to_dict() for t in full.trades if t.exit_date < df.index[k - 1].date().isoformat()]
    assert closed_before == [t.to_dict() for t in cut.trades if t.exit_date < df.index[k - 1].date().isoformat()]


def test_symbol_cannot_trade_before_it_lists_or_after_data_ends():
    a = random_walk(200, seed=1)
    b = random_walk(200, seed=2).iloc[50:150]  # lists late, delists early
    n = 200
    ents = {"A": np.ones(n, dtype=bool), "B": np.ones(n, dtype=bool)}
    res = run_engine({"A": a, "B": b}, ents, {"A": _never(n), "B": _never(n)},
                     EngineConfig(sizing="pct_equity", sizing_value=0.5))
    tb = [t for t in res.trades if t.symbol == "B"]
    assert tb and tb[0].entry_date >= b.index[1].date().isoformat()


def test_trade_pnl_reconciles_with_equity_with_rebalancing():
    frames = {s: random_walk(400, seed=k) for k, s in enumerate(("A", "B", "C"))}
    n = 400
    rng = np.random.default_rng(3)
    ents = {s: rng.random(n) < 0.1 for s in frames}
    exts = {s: rng.random(n) < 0.03 for s in frames}
    cfg = EngineConfig(sizing="pct_equity", sizing_value=0.3, rebalance="weekly", commission_bps=10, slippage_bps=5)
    res = run_engine(frames, ents, exts, cfg)
    assert sum(t.pnl for t in res.trades) == pytest.approx(res.equity.iloc[-1] - 10_000, abs=1e-6)
    assert sum(t.commission for t in res.trades) == pytest.approx(res.total_commission, rel=1e-9)


def test_weekly_signal_frequency_only_decides_on_last_bar_of_week():
    df = random_walk(120, seed=6)
    n = len(df)
    rng = np.random.default_rng(2)
    res = run_engine({"A": df}, {"A": rng.random(n) < 0.3}, {"A": rng.random(n) < 0.3},
                     EngineConfig(signal_frequency="weekly"))
    for t in res.trades:
        d = pd.Timestamp(t.signal_date)
        nxt = df.index[df.index.get_loc(d) + 1]
        assert nxt.isocalendar().week != d.isocalendar().week


# ── Metrics ─────────────────────────────────────────────────────────────────

def test_cagr_doubling_in_one_calendar_year():
    idx = pd.date_range("2020-01-01", "2020-12-31", freq="D")
    eq = pd.Series(np.linspace(100, 200, len(idx)), index=idx)
    m = compute_metrics(eq, 100.0, [])
    yrs = (idx[-1] - idx[0]).days / 365.25
    assert m["cagr_pct"] == pytest.approx((2 ** (1 / yrs) - 1) * 100, abs=1e-3)
    assert m["periods_per_year"] == 365


def test_sharpe_and_sortino_known_answer():
    r = pd.Series([0.01, -0.02, 0.03, 0.0, -0.01] * 20)
    st = return_stats(r, 252)
    a = r.to_numpy()
    assert st["sharpe"] == pytest.approx(a.mean() / a.std(ddof=1) * math.sqrt(252), abs=1e-3)
    assert st["sortino"] == pytest.approx(a.mean() / math.sqrt(np.mean(np.minimum(a, 0) ** 2)) * math.sqrt(252), abs=1e-3)


def test_drawdown_depth_and_duration():
    idx = pd.date_range("2021-01-01", periods=8, freq="D")
    eq = pd.Series([100, 110, 99, 88, 95, 111, 105, 120], index=idx, dtype=float)
    d = drawdown_stats(eq)
    assert d["max_drawdown_pct"] == pytest.approx(-20.0)
    assert d["max_drawdown_duration_bars"] == 4  # 110 on day 1 -> recovered day 5
    assert d["max_drawdown_recovered"]


def test_alpha_zero_beta_one_against_itself():
    df = random_walk(300, seed=3)
    r = df["close"].pct_change().dropna()
    ab = alpha_beta(r, r, 252)
    assert ab["beta"] == pytest.approx(1.0) and abs(ab["alpha_pct"]) < 1e-9


def test_calendar_months_compound_to_total():
    df = random_walk(400, seed=4)
    eq = df["close"] / df["close"].iloc[0] * 1000
    monthly, yearly = calendar_returns(eq, 1000.0)
    total = eq.iloc[-1] / 1000 - 1
    assert np.prod([1 + m["return_pct"] / 100 for m in monthly]) - 1 == pytest.approx(total, abs=1e-4)
    assert np.prod([1 + y["return_pct"] / 100 for y in yearly]) - 1 == pytest.approx(total, abs=1e-4)


def test_exposure_and_turnover():
    df = random_walk(252, seed=8)
    n = len(df)
    e = np.zeros(n, dtype=bool)
    e[125] = True
    res = run_engine({"A": df}, {"A": e}, {"A": _never(n)}, EngineConfig())
    m = compute_metrics(res.equity, 10_000, res.trades, res.gross_exposure, res.traded_notional, res.total_commission)
    assert m["exposure_pct"] == pytest.approx((n - 127) / n * 100, abs=1.0)
    assert m["turnover_annual"] > 1.0


# ── Monte Carlo ──────────────────────────────────────────────────────────────

def test_block_bootstrap_is_seeded_and_ordered():
    df = random_walk(500, seed=2)
    r = df["close"].pct_change().dropna()
    a = block_bootstrap(r, 10_000, sims=200, seed=1)
    b = block_bootstrap(r, 10_000, sims=200, seed=1)
    assert a == b
    fr = a["final_return_pct"]
    assert fr["p5"] < fr["p50"] < fr["p95"]
    band = a["bands"][-1]
    assert band["p5"] < band["p50"] < band["p95"]


def test_trade_bootstrap_skips_overlapping_trades():
    frames = {s: random_walk(300, seed=k) for k, s in enumerate(("A", "B"))}
    n = 300
    rng = np.random.default_rng(0)
    res = run_engine(frames, {s: rng.random(n) < 0.1 for s in frames}, {s: rng.random(n) < 0.1 for s in frames},
                     EngineConfig(sizing_value=0.5))
    assert trades_overlap(res.trades)
    tb = trade_bootstrap(res.trades, 10_000)
    assert tb["skipped"] is True
