"""Audit of the original backtest engine, written against its public API.

Every test here failed on ``main`` @ a9e065b (before the engine rewrite);
docs/BACKTESTING.md lists the failure each one demonstrated. The legacy
``/api/v1/backtest`` contract (field names the current UI reads) is kept, so
the same tests now run against the corrected engine underneath.
"""
from __future__ import annotations

import math
import sys
import types
from datetime import datetime

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bt_fixtures import make_ohlcv, random_walk
from app.services.backtest_engine import BacktestEngine


def _run(df, **kw):
    kw.setdefault("monte_carlo", False)
    return BacktestEngine().run_backtest_from_df(df.copy(), **kw)


def _cross_up_bars(close: pd.Series, fast: int, slow: int):
    f, s = close.rolling(fast).mean(), close.rolling(slow).mean()
    return list(close.index[(f > s) & (f.shift(1) <= s.shift(1))])


def _vshape(n_down=40, n_up=60, n_down2=40):
    return np.concatenate([np.linspace(120, 80, n_down), np.linspace(80, 130, n_up), np.linspace(130, 90, n_down2)])


# 1. Same-bar fills ---------------------------------------------------------

def test_entry_fills_at_open_of_bar_after_signal():
    df = make_ohlcv(_vshape(), gap=0.004)
    res = _run(df, strategy_name="ma_crossover", strategy_params={"fast_ma": 3, "slow_ma": 8},
               commission_rate=0.0, slippage_rate=0.001)
    crosses = _cross_up_bars(df["close"], 3, 8)
    assert res["trades"], "strategy should trade"
    t = res["trades"][0]
    entry = pd.Timestamp(t["entry_date"])
    signal_bar = crosses[0]
    assert entry > signal_bar, "a fill must come after the bar that produced the signal"
    nxt = df.index[df.index.get_loc(signal_bar) + 1]
    assert entry == nxt
    assert t["entry_price"] == pytest.approx(df.loc[nxt, "open"] * 1.001, rel=1e-6)


# 2. Look-ahead guard: changing the future must not change the past ---------

def test_future_bars_do_not_change_past_trades():
    df = random_walk(400, seed=3)
    k = 250
    alt = df.copy()
    rng = np.random.default_rng(99)
    alt.iloc[k:, :4] = alt.iloc[k:, :4].to_numpy() * rng.uniform(0.5, 1.5, (len(alt) - k, 1))
    alt["high"] = alt[["open", "high", "low", "close"]].max(axis=1)
    alt["low"] = alt[["open", "high", "low", "close"]].min(axis=1)
    kw = dict(strategy_name="macd_cross", commission_rate=0.001, slippage_rate=0.0005)
    a, b = _run(df, **kw), _run(alt, **kw)
    cut = df.index[k - 1]
    done_a = [t for t in a["trades"] if pd.Timestamp(t["exit_date"]) < cut]
    done_b = [t for t in b["trades"] if pd.Timestamp(t["exit_date"]) < cut]
    assert done_a == done_b and len(done_a) > 0
    assert a["equity_curve_raw"][:k] == b["equity_curve_raw"][:k]


# 3. Costs: trade P&L reconciles with equity; commission charged once -------

def test_trade_pnl_sums_to_equity_change():
    df = random_walk(500, seed=5)
    res = _run(df, strategy_name="macd_cross", commission_rate=0.002, slippage_rate=0.001)
    assert res["total_trades"] > 3
    total_pnl = sum(t["pnl"] for t in res["trades"])
    assert total_pnl == pytest.approx(res["final_equity"] - 10000.0, abs=0.05 * len(res["trades"]))


def test_commission_charged_once_per_side():
    df = make_ohlcv(_vshape(), gap=0.0)
    rate = 0.01
    res = _run(df, strategy_name="ma_crossover", strategy_params={"fast_ma": 3, "slow_ma": 8},
               commission_rate=rate, slippage_rate=0.0)
    t = res["trades"][0]
    expected = rate * t["quantity"] * (t["entry_price"] + t["exit_price"])
    assert t["commission"] == pytest.approx(expected, rel=1e-3)


# 4. Monte Carlo: shuffling an additive sum is order-invariant --------------

def test_monte_carlo_band_has_width():
    df = random_walk(700, seed=11, vol=0.02)
    res = BacktestEngine().run_backtest_from_df(df.copy(), strategy_name="macd_cross", monte_carlo=True,
                                                monte_carlo_sims=300)
    mc = res["monte_carlo"]
    assert mc is not None
    assert mc["p5_return"] < mc["p95_return"], "every simulation ended at the same equity"


# 5. Monthly returns are calendar months (YYYYMM) and compound to the total -

def test_monthly_returns_are_calendar_months():
    df = random_walk(300, seed=2)
    res = _run(df, strategy_name="macd_cross")
    months = res["monthly_returns"]
    keys = [m["month"] for m in months]
    expected = sorted({d.year * 100 + d.month for d in df.index[1:]} | {df.index[0].year * 100 + df.index[0].month})
    assert set(keys) <= set(expected) and len(keys) >= len(expected) - 1
    assert all(190001 < k < 300001 for k in keys)
    comp = np.prod([1 + m["return_pct"] / 100 for m in months]) - 1
    assert comp * 100 == pytest.approx(res["total_return"], abs=0.05)


# 6. Sortino uses downside deviation over all periods -----------------------

def test_sortino_is_downside_deviation_ratio():
    df = random_walk(500, seed=8)
    res = _run(df, strategy_name="macd_cross")
    eq = np.array(res["equity_curve_raw"], dtype=float)
    r = np.diff(eq) / eq[:-1]
    dd = math.sqrt(np.mean(np.minimum(r, 0) ** 2))
    expected = r.mean() / dd * math.sqrt(252)
    assert res["sortino_ratio"] == pytest.approx(expected, abs=0.02)


# 7. Stops: a gap through the stop fills at the open, not the stop ----------

def test_stop_loss_gap_fills_at_open():
    closes = list(np.linspace(100, 110, 30)) + [80, 79, 78] + list(np.linspace(78, 90, 20))
    df = make_ohlcv(closes, gap=0.0, spread=0.002)
    gap_day = df.index[30]
    df.loc[gap_day, "open"] = 82.0  # opens 25% below the prior close
    df.loc[gap_day, "high"] = 83.0
    res = _run(df, strategy_name="momentum_roc",
               strategy_params={"roc_period": 2, "entry_threshold": 0.1, "exit_threshold": -50},
               stop_loss_pct=5.0, commission_rate=0.0, slippage_rate=0.0)
    stopped = [t for t in res["trades"] if "stop" in t["exit_reason"]]
    assert stopped
    assert pd.Timestamp(stopped[0]["exit_date"]) == gap_day
    assert stopped[0]["exit_price"] <= 82.0 + 1e-9


# 8. Trailing stop: the same bar's high cannot raise the stop its low hits --

def test_trailing_stop_does_not_use_same_bar_high():
    closes = list(np.linspace(100, 101, 12))
    df = make_ohlcv(closes + [101.0] * 10, spread=0.001)
    # The engine enters after the first ROC signal. On bar 14 the range is
    # wide: high 111, low 105.0. With a 5% trail referenced to *prior* highs
    # (~101), the stop is ~96 and is not hit.
    b = df.index[14]
    df.loc[b, ["open", "high", "low", "close"]] = [101.0, 111.0, 105.0, 108.0]
    res = _run(df, strategy_name="momentum_roc",
               strategy_params={"roc_period": 2, "entry_threshold": 0.05, "exit_threshold": -50},
               trailing_stop_pct=5.0, commission_rate=0.0, slippage_rate=0.0)
    assert not [t for t in res["trades"] if t["exit_reason"].startswith("trailing") and pd.Timestamp(t["exit_date"]) == b]


# 9. Walk-forward: the out-of-sample window keeps its indicator warm-up -----

def test_walk_forward_oos_uses_warm_indicators():
    closes = np.concatenate([np.linspace(100, 140, 150), np.linspace(140, 100, 60), np.linspace(100, 150, 90)])
    df = make_ohlcv(closes)
    split = int(len(df) * 0.6)  # bar 180, inside the decline
    res = _run(df, strategy_name="ma_crossover", strategy_params={"fast_ma": 5, "slow_ma": 30},
               walk_forward=True, walk_forward_train_pct=0.6)
    first_cross = [c for c in _cross_up_bars(df["close"], 5, 30) if c >= df.index[split]][0]
    entries = [pd.Timestamp(t["entry_date"]) for t in res["trades"]]
    assert entries and entries[0] == df.index[df.index.get_loc(first_cross) + 1]


# 10. CAGR uses calendar time --------------------------------------------------

def test_cagr_uses_calendar_years_for_7_day_markets():
    closes = 100 * np.exp(np.linspace(0, math.log(2), 731))  # doubles over 2 calendar years
    df = make_ohlcv(closes, freq="D", spread=0.0)
    res = _run(df, strategy_name="momentum_roc",
               strategy_params={"roc_period": 1, "entry_threshold": -100, "exit_threshold": -1000},
               commission_rate=0.0, slippage_rate=0.0)
    years = (df.index[-1] - df.index[0]).days / 365.25
    expected = ((1 + res["total_return"] / 100) ** (1 / years) - 1) * 100
    assert res["cagr"] == pytest.approx(expected, abs=0.1)


# 11-14. API-level: benchmark alignment, adjusted data, input bounds ----------

@pytest.fixture
def api(monkeypatch):
    from app.api import backtest as mod
    from app.db.database import get_db

    app = FastAPI()
    app.include_router(mod.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: None
    return mod, TestClient(app)


def test_alpha_beta_align_benchmark_by_date(api, monkeypatch):
    mod, _ = api
    px = random_walk(500, seed=4, vol=0.012, start="2019-01-01")
    bench = px.drop(px.index[::7])  # different calendar: 1 in 7 days missing
    monkeypatch.setattr(mod, "_fetch_price_data", lambda t, s, e: px.copy())
    monkeypatch.setattr(mod, "_fetch_benchmark", lambda t, s, e: bench.copy())
    res = mod._run_single_backtest(
        db=None, ticker="TEST", start_date=datetime(2019, 1, 1), end_date=datetime(2020, 12, 31),
        strategy="momentum_roc", initial_capital=10000,
        strategy_params={"roc_period": 1, "entry_threshold": -100, "exit_threshold": -1000},
        commission_rate=0.0, slippage_rate=0.0, monte_carlo=False,
    )
    # Holding the benchmark itself: beta must be ~1.
    assert res["beta"] == pytest.approx(1.0, abs=0.08)


def test_alpaca_requests_split_and_dividend_adjusted_bars(monkeypatch):
    captured = {}

    class FakeReq:
        def __init__(self, **kw):
            captured.update(kw)

    class FakeTF:
        Minute = Hour = Day = Week = Month = "D"

        def __init__(self, *a):
            pass

    req_mod = types.ModuleType("alpaca.data.requests")
    req_mod.StockBarsRequest = FakeReq
    tf_mod = types.ModuleType("alpaca.data.timeframe")
    tf_mod.TimeFrame = FakeTF
    for name, m in {"alpaca": types.ModuleType("alpaca"), "alpaca.data": types.ModuleType("alpaca.data"),
                    "alpaca.data.requests": req_mod, "alpaca.data.timeframe": tf_mod}.items():
        monkeypatch.setitem(sys.modules, name, m)

    from app.services import alpaca_client as ac

    class FakeClient:
        def get_stock_bars(self, req):
            return types.SimpleNamespace(df=pd.DataFrame())

    monkeypatch.setattr(ac, "_get_stock_client", lambda: FakeClient())
    from app.api import backtest as mod

    mod._fetch_alpaca_candles("AAPL", datetime(2020, 1, 1), datetime(2021, 1, 1))
    assert captured.get("adjustment") == "all"


def test_fmp_prices_share_one_adjustment_factor(monkeypatch):
    from app.api import backtest as mod
    from app.config import settings

    monkeypatch.setattr(settings, "FMP_API_KEY", "x", raising=False)
    rows = []
    for i, d in enumerate(pd.date_range("2020-08-24", periods=30, freq="B")):
        raw = 400.0 if i < 5 else 100.0  # 4:1 split after five bars
        rows.append({"date": d.strftime("%Y-%m-%d"), "open": raw, "high": raw * 1.01, "low": raw * 0.99,
                     "close": raw, "adjClose": 100.0, "volume": 1000})

    class R:
        def json(self):
            return {"historical": list(reversed(rows))}

    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: R())
    df = mod._fetch_fmp_candles("AAPL", datetime(2020, 8, 1), datetime(2020, 10, 30))
    assert not df.empty
    assert (df["open"] / df["close"]).sub(1).abs().max() < 1e-9
    assert (df["high"] >= df["close"]).all() and (df["low"] <= df["close"]).all()


@pytest.mark.parametrize("patch", [
    {"monte_carlo_sims": 10_000_000},
    {"start_date": "1960-01-01", "end_date": "2024-01-01"},
    {"strategy_params": {"slow_ma": 1_000_000}},
    {"initial_capital": -5},
    {"commission_rate": 0.5},
])
def test_request_bounds_are_enforced(api, monkeypatch, patch):
    mod, client = api
    px = random_walk(300, seed=1)
    monkeypatch.setattr(mod, "_fetch_price_data", lambda t, s, e: px.copy())
    monkeypatch.setattr(mod, "_fetch_benchmark", lambda t, s, e: px.copy())
    body = {"symbol": "TEST", "start_date": "2018-01-01", "end_date": "2019-02-01", "strategy": "ma_crossover",
            "monte_carlo": False, **patch}
    r = client.post("/api/v1/backtest", json=body)
    assert r.status_code == 422, r.text
