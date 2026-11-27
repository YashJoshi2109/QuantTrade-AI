"""Strategy Lab vs an independent re-computation on real market data.

``tests/fixtures/bt_daily_adjusted.csv.gz`` holds yfinance ``auto_adjust=True``
(split + dividend adjusted) daily bars for SPY, AAPL and MSFT from
2020-11-02 to 2026-11-25, rounded to 4 decimals. Every expected number below
was produced by a separate, vectorised pandas implementation (own Wilder RSI,
own SMA cross, own next-open fill loop and own metric formulas: Sharpe and
Sortino on sqrt(252), sample std, peak-to-trough drawdown on equity, CAGR on
calendar days / 365.25), not by the app code. The app must agree with it.

Audit 2026-11-26 found the engine already matched on all of these except
exposure, which dropped the final bar (99.21% instead of 99.60% for a
one-year buy-and-hold).
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from app.services.backtesting.data import PriceSeries, drop_unfinished_bar
from app.services.backtesting.metrics import rolling_sharpe
from app.services.backtesting.runner import RunRequest, run_strategy

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "fixtures", "bt_daily_adjusted.csv.gz")


@pytest.fixture(scope="module")
def frames():
    fx = pd.read_csv(FIXTURE, compression="gzip")
    out = {}
    for sym, g in fx.groupby("symbol"):
        out[sym] = g.set_index(pd.to_datetime(g["date"]))[["open", "high", "low", "close", "volume"]].astype(float)
    return out


@pytest.fixture(scope="module")
def loader(frames):
    def load(sym, start, end):
        df = frames.get(sym)
        if df is None:
            return None
        df = df[(df.index >= pd.Timestamp(start)) & (df.index <= pd.Timestamp(end))]
        return PriceSeries(sym, df, "fixture", True, [])
    return load


def _ind(name, **p):
    return {"indicator": name, "params": p}


def _spec(kind, sym, start, end="2026-11-25", **kw):
    base = {"symbols": [sym], "start_date": start, "end_date": end, "benchmark": "SPY",
            "commission_bps": kw.pop("c", 0), "slippage_bps": kw.pop("sl", 0)}
    if kind == "bh":
        base["entry"] = {"logic": "all", "rules": [{"left": _ind("close"), "op": ">", "right": {"value": 0}}]}
    elif kind == "sma":
        base["entry"] = {"logic": "all", "rules": [{"left": _ind("sma", period=50), "op": "crosses_above", "right": _ind("sma", period=200)}]}
        base["exit"] = {"logic": "all", "rules": [{"left": _ind("sma", period=50), "op": "crosses_below", "right": _ind("sma", period=200)}]}
    elif kind == "rsi":
        base["entry"] = {"logic": "all", "rules": [{"left": _ind("rsi", period=14), "op": "<", "right": {"value": 30}}]}
        base["exit"] = {"logic": "any", "rules": [{"left": _ind("rsi", period=14), "op": ">", "right": {"value": 55}}]}
    base.update(kw)
    return base


def _run(loader, spec):
    req = RunRequest(spec=spec, robustness={"oos_split": None, "sweep": False, "monte_carlo_sims": 0})
    return run_strategy(req, loader=loader)


# Independent values (see module docstring). Percent metrics in percent.
CASES = {
    "spy_bh_1y": (("bh", "SPY", "2025-11-25"), {}, {
        "total_return_pct": 6.9067, "cagr_pct": 6.9116, "volatility_pct": 14.9181, "sharpe": 0.5239,
        "sortino": 0.7469, "max_drawdown_pct": -11.4595, "calmar": 0.6031, "total_trades": 1, "win_rate_pct": 100.0,
        "exposure_pct": 99.6032, "turnover_annual": 1.9266, "beta": 0.9988, "alpha_pct": -0.3799,
        "bench_total_return_pct": 7.3201, "bench_sharpe": 0.5495, "bench_mdd": -11.4595}),
    "spy_bh_5y": (("bh", "SPY", "2021-11-24"), {}, {
        "total_return_pct": 65.7387, "cagr_pct": 10.6284, "volatility_pct": 17.5567, "sharpe": 0.6655,
        "sortino": 0.963, "max_drawdown_pct": -24.4964, "calmar": 0.4339, "total_trades": 1, "win_rate_pct": 100.0,
        "exposure_pct": 99.9204, "turnover_annual": 0.4365, "beta": 0.9978, "alpha_pct": 0.3268,
        "bench_total_return_pct": 63.2319, "bench_sharpe": 0.6474, "bench_mdd": -24.4964}),
    "aapl_sma50_200_5y": (("sma", "AAPL", "2021-11-24"), {}, {
        "total_return_pct": 31.391, "cagr_pct": 5.6096, "volatility_pct": 18.6387, "sharpe": 0.388,
        "sortino": 0.5292, "max_drawdown_pct": -29.8666, "calmar": 0.1878, "total_trades": 4, "win_rate_pct": 50.0,
        "exposure_pct": 60.5096, "turnover_annual": 1.548, "beta": 0.3766, "alpha_pct": 2.945,
        "bench_total_return_pct": 63.2319, "bench_sharpe": 0.6474, "bench_mdd": -24.4964}),
    "msft_rsi_5y_costs_stop8": (("rsi", "MSFT", "2021-11-24"), {"c": 1, "sl": 5, "stop_loss_pct": 8}, {
        "total_return_pct": 11.0693, "cagr_pct": 2.121, "volatility_pct": 11.4809, "sharpe": 0.2406,
        "sortino": 0.3585, "max_drawdown_pct": -20.4812, "calmar": 0.1036, "total_trades": 8, "win_rate_pct": 62.5,
        "exposure_pct": 14.4904, "turnover_annual": 3.2493, "beta": 0.2382, "alpha_pct": 0.0506,
        "bench_total_return_pct": 63.2319, "bench_sharpe": 0.6474, "bench_mdd": -24.4964}),
}


@pytest.mark.parametrize("name", list(CASES))
def test_metrics_match_independent_recomputation(loader, name):
    (kind, sym, start), kw, want = CASES[name]
    out = _run(loader, _spec(kind, sym, start, **kw))
    m = out["metrics"]
    b = m["benchmark"]
    got = {k: m[k] for k in want if not k.startswith("bench_")}
    got.update({"bench_total_return_pct": b["total_return_pct"], "bench_sharpe": b["sharpe"],
                "bench_mdd": b["max_drawdown_pct"]})
    for k, v in want.items():
        # the app rounds to 3 dp (2 for exposure/win rate); allow that plus fixture float noise
        assert got[k] == pytest.approx(v, abs=2e-3 if k != "exposure_pct" else 1e-2), (name, k, got[k], v)
    assert out["execution"]["fills"] == "next_bar_open"


def test_buy_and_hold_exposure_counts_the_final_bar(loader):
    """Held through the last bar, liquidated at its close: that bar was exposed."""
    out = _run(loader, _spec("bh", "SPY", "2025-11-25"))
    n = out["metrics"]["bars"]
    assert out["metrics"]["exposure_pct"] == pytest.approx((n - 1) / n * 100, abs=0.01)


def test_risk_free_rate_moves_sharpe_and_sortino_only(loader):
    base = _run(loader, _spec("bh", "SPY", "2021-11-24"))["metrics"]
    rf = _run(loader, _spec("bh", "SPY", "2021-11-24", risk_free_rate_pct=4.0))["metrics"]
    assert rf["risk_free_rate_pct"] == 4.0 and base["risk_free_rate_pct"] == 0.0
    assert rf["sharpe"] == pytest.approx(0.4377, abs=2e-3)   # independent: mean(r - 4%/252)/sd * sqrt(252)
    assert rf["sortino"] == pytest.approx(0.6271, abs=2e-3)
    for k in ("total_return_pct", "cagr_pct", "volatility_pct", "max_drawdown_pct"):
        assert rf[k] == base[k]


def test_pro_metrics_match_independent_values(loader):
    out = _run(loader, _spec("bh", "SPY", "2021-11-24"))
    m = out["metrics"]
    assert m["var_95_daily_pct"] == pytest.approx(-1.6836, abs=2e-3)
    assert m["cvar_95_daily_pct"] == pytest.approx(-2.5371, abs=2e-3)
    assert m["best_month_pct"] == pytest.approx(10.5053, abs=2e-3)
    assert m["worst_month_pct"] == pytest.approx(-9.2446, abs=2e-3)
    assert m["positive_months_pct"] == pytest.approx(60.6557, abs=1e-2)
    assert m["exposure_adjusted_cagr_pct"] == pytest.approx(10.6369, abs=2e-3)
    # IR / tracking error / correlation are part of the payload for the UI
    for k in ("information_ratio", "tracking_error_pct", "correlation"):
        assert m[k] is not None
    pts = out["series"]["points"]
    assert out["series"]["rolling_sharpe_window"] == 126
    assert pts[0]["rolling_sharpe"] is None  # no full window yet
    assert pts[-1]["rolling_sharpe"] == pytest.approx(-0.4672, abs=2e-3)


def test_rolling_sharpe_is_nan_while_flat():
    idx = pd.bdate_range("2024-01-01", periods=300)
    eq = pd.Series(10_000.0, index=idx)
    eq.iloc[200:] = 10_000 * np.cumprod(1 + np.full(100, 0.001) * np.where(np.arange(100) % 2, 1, -0.5))
    rs = rolling_sharpe(eq, 252)
    assert rs.iloc[:200].isna().all()  # flat stretch: never 0 or inf
    assert np.isfinite(rs.iloc[-1])


def test_unfinished_bar_dropped_only_during_the_session():
    idx = pd.to_datetime(["2026-11-24", "2026-11-25"])
    df = pd.DataFrame({"open": [1, 1], "high": [1, 1], "low": [1, 1], "close": [1, 1], "volume": [0, 0]}, index=idx)
    during = datetime(2026, 11, 25, 17, 0, tzinfo=timezone.utc)      # 12:00 ET, session open
    after = datetime(2026, 11, 25, 21, 5, tzinfo=timezone.utc)       # 16:05 ET, closed
    out, warn = drop_unfinished_bar(df, during)
    assert len(out) == 1 and "unfinished" in warn
    out, warn = drop_unfinished_bar(df, after)
    assert len(out) == 2 and warn is None
    # Black Friday 2026 closes at 13:00 ET
    bf = pd.DataFrame({"open": [1], "high": [1], "low": [1], "close": [1], "volume": [0]}, index=pd.to_datetime(["2026-11-27"]))
    assert len(drop_unfinished_bar(bf, datetime(2026, 11, 27, 17, 30, tzinfo=timezone.utc))[0]) == 0   # 12:30 ET
    assert len(drop_unfinished_bar(bf, datetime(2026, 11, 27, 18, 30, tzinfo=timezone.utc))[0]) == 1   # 13:30 ET


def test_monte_carlo_mean_is_a_mean_not_the_median(loader):
    from app.services.backtest_engine import _legacy_mc
    from app.services.backtesting.montecarlo import block_bootstrap

    rng = np.random.default_rng(3)
    r = pd.Series(rng.standard_t(3, 500) * 0.01 + 0.0005, index=pd.bdate_range("2020-01-01", periods=500))
    bb = block_bootstrap(r, 10_000, sims=400, seed=7)  # _legacy_mc uses the default seed
    legacy = _legacy_mc(r, [], 10_000, 400, 252)
    assert legacy["median_return"] == bb["final_return_pct"]["p50"]
    assert legacy["mean_return"] == bb["mean_final_return_pct"]
    assert legacy["mean_return"] != legacy["median_return"]
