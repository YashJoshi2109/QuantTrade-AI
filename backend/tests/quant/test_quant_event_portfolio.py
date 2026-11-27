"""Event-study and portfolio math vs hand-computed / textbook values."""
import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sst

from app.services.quant import event_study as es
from app.services.quant import portfolio as pf


# ── event study ──────────────────────────────────────────────────────────────

def test_day_zero_timing_rules():
    idx = pd.bdate_range("2024-01-01", periods=10)           # Mon 1 .. Fri 12
    assert idx[es.day_zero(idx, "2024-01-03", "amc")] == pd.Timestamp("2024-01-04")
    assert idx[es.day_zero(idx, "2024-01-03", "bmo")] == pd.Timestamp("2024-01-03")
    assert idx[es.day_zero(idx, "2024-01-03", None)] == pd.Timestamp("2024-01-03")
    # Saturday announcement -> Monday
    assert idx[es.day_zero(idx, "2024-01-06", "bmo")] == pd.Timestamp("2024-01-08")


def _synthetic(n=900, seed=1, a=0.0002, b=1.3, sd=0.002):
    rng = np.random.default_rng(seed)
    rm = rng.normal(0.0004, 0.01, n)
    ri = a + b * rm + rng.normal(0, sd, n)
    return rm, ri


def test_market_model_event_recovers_injected_abnormal_return():
    rm, ri = _synthetic()
    tau0 = 700
    ri = ri.copy()
    ri[tau0] += 0.05
    res = es.market_model_event(ri, rm, tau0, -2, 2, 120, 10)
    assert res["beta"] == pytest.approx(1.3, abs=0.05)
    assert res["ar"][2] == pytest.approx(0.05, abs=0.006)            # day 0 is the 3rd day of [-2,+2]
    assert res["car"] == pytest.approx(0.05, abs=0.012)
    # estimation window ends gap days before the window: [tau0-2-10-120, tau0-2-10-1]
    assert res["estimation_start_pos"] == tau0 - 132 and res["estimation_end_pos"] == tau0 - 13
    # Var(CAR) >= L2 * sigma_e^2 (estimation error adds variance)
    assert res["var_car"] >= 5 * res["sigma_e"] ** 2


def test_market_model_matches_hand_ols_and_clm_variance():
    rm, ri = _synthetic(seed=4)
    tau0, L1 = 500, 120
    res = es.market_model_event(ri, rm, tau0, -1, 1, L1, 5)
    e0, e1 = tau0 - 1 - 5 - L1, tau0 - 1 - 5
    b = np.cov(ri[e0:e1], rm[e0:e1], ddof=1)[0, 1] / np.var(rm[e0:e1], ddof=1)
    a = ri[e0:e1].mean() - b * rm[e0:e1].mean()
    assert res["beta"] == pytest.approx(b, rel=1e-10) and res["alpha"] == pytest.approx(a, abs=1e-12)
    ar = ri[tau0 - 1:tau0 + 2] - (a + b * rm[tau0 - 1:tau0 + 2])
    assert res["car"] == pytest.approx(ar.sum(), abs=1e-12)
    # CLM (4.4.14): Var(AR_t) = s^2 [1 + 1/L1 + (Rm_t - mean)^2 / sum (Rm - mean)^2], plus covariances
    s2 = np.sum((ri[e0:e1] - a - b * rm[e0:e1]) ** 2) / (L1 - 2)
    mbar = rm[e0:e1].mean()
    sxx = np.sum((rm[e0:e1] - mbar) ** 2)
    w = rm[tau0 - 1:tau0 + 2] - mbar
    V = s2 * (np.eye(3) + 1 / L1 + np.outer(w, w) / sxx)
    assert res["var_car"] == pytest.approx(V.sum(), rel=1e-10)


def test_group_tests_vs_scipy_and_exact_sign_test():
    cars = [0.02, 0.01, -0.005, 0.03, 0.015, 0.012]
    var = [0.0001] * 6
    scar = [c / 0.01 for c in cars]
    g = es.group_tests(cars, var, scar, 120)
    ref = sst.ttest_1samp(cars, 0.0)
    assert g["t_stat"] == pytest.approx(ref.statistic, rel=1e-12)
    assert g["p_two_sided"] == pytest.approx(ref.pvalue, rel=1e-10)
    assert g["p_greater"] == pytest.approx(ref.pvalue / 2, rel=1e-10)
    # 5 of 6 positive: P(X >= 5) = (6 + 1) / 64 = 0.109375
    assert g["positive"] == 5 and g["sign_test_p_greater"] == pytest.approx(7 / 64)
    assert g["sign_test_p_two_sided"] == pytest.approx(14 / 64)
    # J1 = mean / sqrt(sum var / N^2) = mean / (0.01 / sqrt(6))
    assert g["j1"] == pytest.approx(np.mean(cars) / (0.01 / math.sqrt(6)))
    assert g["j2"] == pytest.approx(math.sqrt(6 * 116 / 118) * np.mean(scar))
    # all 12 positive: one-sided p = 0.5^12
    g12 = es.group_tests([0.01] * 11 + [0.02], [1e-4] * 12, [1.0] * 12, 120)
    assert g12["sign_test_p_greater"] == pytest.approx(0.5 ** 12)


def test_run_event_study_splits_by_surprise():
    idx = pd.bdate_range("2021-01-01", periods=900)
    rm, ri = _synthetic(n=900, seed=7)
    events = []
    for k, pos in enumerate(range(300, 860, 60)):
        pos_s = k % 3 != 0
        ri[pos] += 0.04 if pos_s else -0.04
        # return at position pos is the move INTO idx[pos+1]; day0 for "bmo" on that date
        events.append({"date": idx[pos + 1].date().isoformat(), "timing": "bmo",
                       "eps_actual": 1.1 if pos_s else 0.9, "eps_estimate": 1.0})
    stock = pd.Series(100 * np.cumprod(np.concatenate([[1], 1 + ri])), index=idx.append(pd.bdate_range(idx[-1] + pd.Timedelta(days=1), periods=1)))
    market = pd.Series(100 * np.cumprod(np.concatenate([[1], 1 + rm])), index=stock.index)
    out = es.run_event_study(stock, market, events, -2, 2, 120, 10)
    assert len(out["events"]) == len(events) and not out["skipped"]
    assert out["positive_surprise"]["mean_car"] == pytest.approx(0.04, abs=0.01)
    assert out["negative_or_zero_surprise"]["mean_car"] == pytest.approx(-0.04, abs=0.01)
    assert out["positive_surprise"]["p_greater"] < 0.01
    assert out["positive_minus_negative"]["mean_difference"] == pytest.approx(0.08, abs=0.015)
    assert out["aar_by_day"]["0"]["aar"] != 0
    # an event too early for its estimation window is skipped with a reason
    early = es.run_event_study(stock, market, [{"date": idx[50].date().isoformat(), "timing": "bmo"}])
    assert early["events"] == [] and "estimation days" in early["skipped"][0]["reason"]


# ── portfolio ────────────────────────────────────────────────────────────────

def test_risk_contributions_two_asset_textbook():
    s1, s2, rho = 0.2, 0.3, 0.5
    cov = np.array([[s1 ** 2, rho * s1 * s2], [rho * s1 * s2, s2 ** 2]])
    rc = pf.risk_contributions([0.5, 0.5], cov)
    # var_p = .25*.04 + .25*.09 + 2*.25*.03 = .0475
    assert rc["portfolio_vol"] == pytest.approx(math.sqrt(0.0475))
    # (Sigma w) = [.035, .06]; MCR = that / sigma_p
    assert rc["mcr"][0] == pytest.approx(0.035 / math.sqrt(0.0475))
    assert rc["pcr"][0] == pytest.approx(0.5 * 0.035 / 0.0475)             # 0.368421
    assert rc["pcr"][1] == pytest.approx(0.5 * 0.06 / 0.0475)              # 0.631579
    assert rc["ccr"].sum() == pytest.approx(rc["portfolio_vol"])
    assert rc["diversification_ratio"] == pytest.approx(0.25 / math.sqrt(0.0475))   # 1.147079
    assert rc["effective_n_weights"] == pytest.approx(2.0)
    assert pf.hhi([0.5, 0.3, 0.2]) == pytest.approx(0.38)


def test_pca_share_two_assets():
    p = pf.pca_share(np.array([[1, 0.6], [0.6, 1]]))
    assert p["pc1_share"] == pytest.approx(0.8)                            # (1 + rho) / 2
    np.testing.assert_allclose(p["pc1_loadings"], [1 / math.sqrt(2)] * 2)


def test_factor_regression_recovers_betas():
    rng = np.random.default_rng(8)
    m = rng.normal(0, 0.01, 2000)
    t = rng.normal(0, 0.005, 2000)
    y = 0.0001 + 1.1 * m + 0.8 * t + rng.normal(0, 0.001, 2000)
    f = pf.factor_regression(y, {"SPY": m, "TECH": t})
    assert f["betas"]["SPY"] == pytest.approx(1.1, abs=0.01)
    assert f["betas"]["TECH"] == pytest.approx(0.8, abs=0.02)
    assert f["alpha_annual"] == pytest.approx(0.0252, abs=0.01)


def test_historical_stress_buy_and_hold_and_missing_data():
    idx = pd.bdate_range("2020-02-03", "2020-04-30")
    a = pd.Series(np.linspace(100, 50, len(idx)), index=idx)
    b = pd.Series(np.linspace(100, 100, len(idx)), index=idx)
    late = pd.Series(100.0, index=idx[idx >= "2020-03-02"])
    win = [{"id": "w", "name": "w", "start": "2020-02-19", "end": "2020-03-23", "basis": "test"}]
    rows = pf.historical_stress({"A": a, "B": b}, {"A": 0.5, "B": 0.5}, win)
    ra = a.loc["2020-03-23"] / a.loc["2020-02-19"] - 1
    assert rows[0]["assets"]["A"]["return_pct"] == pytest.approx(ra * 100)
    assert rows[0]["portfolio_return_pct"] == pytest.approx(0.5 * ra * 100)
    assert rows[0]["portfolio_max_drawdown_pct"] == pytest.approx(0.5 * ra * 100 / (1), rel=0.05)
    miss = pf.historical_stress({"A": a, "L": late}, {"A": 0.5, "L": 0.5}, win)
    assert miss[0]["portfolio_return_pct"] is None and miss[0]["missing"] == ["L"]
