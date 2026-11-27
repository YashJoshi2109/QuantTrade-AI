"""Beta regression, cost of debt and WACC vs hand-computed values."""
import math

import numpy as np
import pandas as pd
import pytest

from app.services.valuation import wacc as W
from app.services.valuation.provenance import AssumptionLog, DataUnavailable, Datum


def test_ols_beta_textbook_example():
    # x = 1..5, y = 2,4,5,4,5: Sxx = 10, Sxy = 6 -> beta 0.6, alpha 2.2,
    # residuals -0.8, 0.6, 1.0, -0.6, -0.2 -> SSR 2.4, sigma^2 = 0.8, SE = sqrt(0.8/10), R^2 = 1 - 2.4/6
    o = W.ols_beta(np.array([2, 4, 5, 4, 5.0]), np.array([1, 2, 3, 4, 5.0]))
    assert o["beta"] == pytest.approx(0.6)
    assert o["alpha"] == pytest.approx(2.2)
    assert o["se_beta"] == pytest.approx(math.sqrt(0.08))
    assert o["r_squared"] == pytest.approx(0.6)
    assert o["t_stat"] == pytest.approx(0.6 / math.sqrt(0.08))
    assert o["n"] == 5


def test_ols_matches_numpy_polyfit():
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.02, 500)
    y = 0.0005 + 1.3 * x + rng.normal(0, 0.01, 500)
    o = W.ols_beta(y, x)
    slope, intercept = np.polyfit(x, y, 1)
    assert o["beta"] == pytest.approx(slope, rel=1e-10)
    assert o["alpha"] == pytest.approx(intercept, abs=1e-12)
    # classical SE from the covariance matrix of the polyfit
    _, cov = np.polyfit(x, y, 1, cov="unscaled")
    resid = y - (intercept + slope * x)
    s2 = (resid ** 2).sum() / (len(x) - 2)
    assert o["se_beta"] == pytest.approx(math.sqrt(s2 * cov[0, 0]), rel=1e-8)


def _prices_from_returns(rets, start="2020-01-03", freq="W-FRI"):
    idx = pd.date_range(start, periods=len(rets) + 1, freq=freq)
    return pd.Series(100 * np.cumprod(np.concatenate([[1.0], 1 + np.asarray(rets)])), index=idx)


def test_regress_beta_recovers_exact_beta_from_weekly_prices():
    rng = np.random.default_rng(1)
    m = rng.normal(0.002, 0.02, 270)
    s = 1.5 * m                                  # exact linear relation -> beta 1.5, SE 0
    br = W.regress_beta(_prices_from_returns(s), _prices_from_returns(m), frequency="weekly", years=5)
    assert br.beta == pytest.approx(1.5, rel=1e-9)
    assert br.se_beta == pytest.approx(0.0, abs=1e-9)
    assert br.r_squared == pytest.approx(1.0)
    assert br.n_obs >= 250
    assert br.blume_adjusted == pytest.approx(0.67 * 1.5 + 0.33)
    d = br.to_dict()
    assert d["frequency"] == "weekly" and d["window_start"] and d["window_end"]


def test_weekly_resampling_uses_friday_closes():
    idx = pd.bdate_range("2024-01-01", "2024-01-19")          # Mon 1 Jan .. Fri 19 Jan
    s = pd.Series(np.arange(len(idx), dtype=float) + 100, index=idx)
    r = W.period_returns(s, "weekly")
    # Friday closes: 5 Jan = 104, 12 Jan = 109, 19 Jan = 114
    assert list(r.round(10)) == [round(109 / 104 - 1, 10), round(114 / 109 - 1, 10)]


def test_regress_beta_refuses_short_history():
    m = np.full(30, 0.01)
    with pytest.raises(DataUnavailable):
        W.regress_beta(_prices_from_returns(m * 1.1 + 0.001), _prices_from_returns(m), years=5)


def test_cost_of_debt_average_debt_and_fallback():
    log = AssumptionLog()
    kd = W.cost_of_debt(Datum(4.5, "x"), Datum(100.0, "x"), Datum(80.0, "x"), 0.04, log)
    assert kd["pre_tax"] == pytest.approx(4.5 / 90.0)
    assert kd["method"] == "implied from filings"
    assert not log.items
    # interest missing -> explicit assumption rf + 1%
    kd2 = W.cost_of_debt(None, Datum(100.0, "x"), None, 0.04, log)
    assert kd2["pre_tax"] == pytest.approx(0.05)
    assert log.items[0].name == "pre_tax_cost_of_debt" and "risk-free + 1.0%" in log.items[0].rationale
    # implausible (>20%) -> fallback, flagged
    kd3 = W.cost_of_debt(Datum(50.0, "x"), Datum(100.0, "x"), None, 0.04, AssumptionLog())
    assert kd3["method"].startswith("assumption") and "implausible" in kd3["note"]


def test_wacc_hand_computed():
    # Ke = 4% + 1.2 * 5% = 10%; Kd after tax = 5% * 0.79 = 3.95%; weights 80/20
    # WACC = 0.8 * 10% + 0.2 * 3.95% = 8.79%
    w = W.compute_wacc(rf=Datum(0.04, "FRED"), beta=1.2, erp=0.05, market_cap=800.0, total_debt=200.0,
                       kd_pre_tax=0.05, marginal_tax=0.21)
    assert w["cost_of_equity"] == pytest.approx(0.10)
    assert w["after_tax_cost_of_debt"] == pytest.approx(0.0395)
    assert w["weight_equity"] == pytest.approx(0.8)
    assert w["wacc"] == pytest.approx(0.0879)
    p = W.wacc_payload(w)
    assert p["wacc_pct"] == 8.79 and p["cost_of_equity_pct"] == 10.0


def test_wacc_needs_market_cap():
    with pytest.raises(DataUnavailable):
        W.compute_wacc(rf=Datum(0.04, "x"), beta=1, erp=0.05, market_cap=None, total_debt=0, kd_pre_tax=None,
                       marginal_tax=0.21)
