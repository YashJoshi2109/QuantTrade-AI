"""Risk metrics vs hand-computed / textbook values (no network)."""
import math

import numpy as np
import pandas as pd
import pytest

from app.services.quant import risk as rk


def test_beta_alpha_exact_linear_relation():
    rng = np.random.default_rng(1)
    rm = rng.normal(0.0005, 0.01, 500)
    rf = np.full(500, 0.0001)
    # r_i - rf = 0.0002 + 2 (r_m - rf) exactly -> beta 2, alpha 0.0002 x 252 = 5.04%
    ri = rf + 0.0002 + 2 * (rm - rf)
    ri[::7] += 1e-9  # avoid an exactly singular residual variance
    out = rk.beta_alpha(ri, rm, rf)
    assert out["beta"] == pytest.approx(2.0, abs=1e-6)
    assert out["alpha_annual"] == pytest.approx(0.0002 * 252, abs=1e-6)
    assert out["r2"] == pytest.approx(1.0, abs=1e-9)


def test_beta_matches_cov_over_var_and_ols_se():
    rng = np.random.default_rng(2)
    rm = rng.normal(0, 0.01, 1000)
    ri = 0.5 * rm + rng.normal(0, 0.01, 1000)
    out = rk.beta_alpha(ri, rm)
    assert out["beta"] == pytest.approx(np.cov(ri, rm, ddof=1)[0, 1] / np.var(rm, ddof=1), rel=1e-10)
    import statsmodels.api as sm
    fit = sm.OLS(ri, sm.add_constant(rm)).fit()
    assert out["beta_se"] == pytest.approx(fit.bse[1], rel=1e-10)
    assert out["alpha_p_value"] == pytest.approx(fit.pvalues[0], rel=1e-8)
    hc0 = sm.OLS(ri, sm.add_constant(rm)).fit(cov_type="HC0")
    assert out["alpha_t_white"] == pytest.approx(hc0.tvalues[0], rel=1e-8)


def test_downside_and_upside_beta_asymmetric_construction():
    rng = np.random.default_rng(3)
    rm = rng.normal(0, 0.01, 2000)
    ri = np.where(rm < 0, 2.0 * rm, 1.0 * rm)
    out = rk.downside_beta(ri, rm)
    assert out["downside_beta"] == pytest.approx(2.0, abs=1e-9)
    assert out["upside_beta"] == pytest.approx(1.0, abs=1e-9)
    assert out["down_days"] + out["up_days"] == 2000


def test_rolling_beta_constant_relation():
    rng = np.random.default_rng(4)
    m = pd.Series(rng.normal(0, 0.01, 400))
    i = 1.5 * m
    rb = rk.rolling_beta(i, m, 60)
    assert rb.iloc[:59].isna().all()
    np.testing.assert_allclose(rb.iloc[59:].to_numpy(), 1.5, rtol=1e-9)


def test_sharpe_sortino_by_hand():
    r = np.array([0.01, -0.02, 0.03, 0.0, 0.01])
    # mean = 0.006; std(ddof=1) = sqrt(((.004)^2+(.026)^2+(.024)^2+(.006)^2+(.004)^2)/4) = sqrt(0.00133/4)
    sd = math.sqrt((0.004 ** 2 + 0.026 ** 2 + 0.024 ** 2 + 0.006 ** 2 + 0.004 ** 2) / 4)
    assert rk.sharpe(r) == pytest.approx(0.006 / sd * math.sqrt(252), rel=1e-12)
    # downside deviation = sqrt((0.02^2) / 5) = 0.0089443
    assert rk.sortino(r) == pytest.approx(0.006 / math.sqrt(0.0004 / 5) * math.sqrt(252), rel=1e-12)
    rf = np.full(5, 0.001)
    assert rk.sharpe(r, rf) == pytest.approx(0.005 / sd * math.sqrt(252), rel=1e-12)


def test_max_drawdown_dates_and_recovery():
    idx = pd.bdate_range("2024-01-01", periods=8)
    p = pd.Series([100, 120, 90, 95, 130, 80, 100, 140.0], index=idx)
    dd = rk.max_drawdown(p)
    assert dd["max_drawdown_pct"] == pytest.approx((80 / 130 - 1) * 100)   # -38.4615%
    assert dd["peak_date"] == "2024-01-05" and dd["trough_date"] == "2024-01-08"
    assert dd["recovery_date"] == "2024-01-10" and dd["recovered"] is True
    assert dd["peak_to_trough_trading_days"] == 1 and dd["trough_to_recovery_trading_days"] == 2
    nr = rk.max_drawdown(pd.Series([100, 50, 60.0], index=idx[:3]))
    assert nr["recovered"] is False and nr["recovery_date"] is None
    assert nr["current_drawdown_pct"] == pytest.approx(-40.0)


def test_historical_var_cvar_by_hand():
    x = np.arange(1, 101) / 1000 - 0.05          # -0.049 ... 0.05
    v = rk.var_cvar(x, 0.95)
    # np.percentile linear: position 0.05 * 99 = 4.95 -> -0.045 + 0.95 * 0.001 = -0.04405
    assert v["historical_var"] == pytest.approx(0.04405, abs=1e-12)
    # values <= -0.04405: -0.049..-0.045, mean -0.047
    assert v["historical_cvar"] == pytest.approx(0.047, abs=1e-12)
    assert v["tail_observations"] == 5


def test_parametric_var_textbook_normal_values():
    z = np.random.default_rng(5).normal(size=5000)
    x = (z - z.mean()) / z.std(ddof=1) * 0.02     # mean exactly 0, sd exactly 2%
    v = rk.var_cvar(x, 0.95)
    assert v["z"] == pytest.approx(-1.6448536269514729)
    assert v["parametric_var"] == pytest.approx(0.02 * 1.6448536269514729, rel=1e-10)      # 3.2897%
    # CVaR = sigma * phi(1.6449) / 0.05 = 0.02 * 0.10313564 / 0.05 = 4.1254%
    assert v["parametric_cvar"] == pytest.approx(0.02 * 0.10313564037 / 0.05, rel=1e-9)
    # Cornish-Fisher with S = K = 0 equals the normal VaR
    y = np.concatenate([x, -x])
    vy = rk.var_cvar(y, 0.95)
    assert vy["skewness"] == pytest.approx(0.0, abs=1e-12)


def test_cornish_fisher_widens_var_for_fat_tails():
    t = np.random.default_rng(6).standard_t(3, 20000) * 0.01
    v = rk.var_cvar(t, 0.99)
    assert v["excess_kurtosis"] > 3
    assert v["historical_var"] > v["parametric_var"]


def test_divergence_notes_use_reported_numbers():
    m = {"beta": 1.5, "downside_beta": 1.9, "sharpe": 1.0, "sortino": 1.6, "alpha_p_value": 0.3,
         "var_95": {"historical_var": 0.05, "parametric_var": 0.04, "historical_cvar": 0.08, "parametric_cvar": 0.05,
                    "skewness": -0.5, "excess_kurtosis": 4.0, "jarque_bera_p_value": 1e-9},
         "rolling_beta_252": {"min": 1.0, "max": 2.2, "min_date": "2022-01-03", "max_date": "2024-05-01"}}
    notes = " ".join(rk.divergence_notes(m))
    assert "1.25x" in notes and "1.90" in notes and "1.50" in notes and "p = 0.30" in notes
    assert "1.00 (2022-01-03) to 2.20 (2024-05-01)" in notes
