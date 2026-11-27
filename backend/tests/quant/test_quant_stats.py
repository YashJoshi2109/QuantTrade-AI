"""Time-series statistics vs hand-computed / textbook values (no network)."""
import math

import numpy as np
import pytest

from app.services.quant import stats as st


def test_realised_vol_matches_hand_computation():
    x = np.array([0.01, -0.02, 0.015, 0.0, -0.005])
    # mean = 0; squares sum = 1e-4 + 4e-4 + 2.25e-4 + 0 + 0.25e-4 = 7.5e-4; /4 = 1.875e-4
    assert st.realised_vol(x) == pytest.approx(math.sqrt(1.875e-4) * math.sqrt(252), rel=1e-12)
    rv = st.rolling_vol(x, 3)
    assert np.isnan(rv[:2]).all()
    # last window [0.015, 0.0, -0.005]: mean 0.003333, ss = 1.3444e-4 + 1.1111e-5 + 6.9444e-5 = 2.1667e-4, /2
    w = np.array([0.015, 0.0, -0.005])
    assert rv[-1] == pytest.approx(np.std(w, ddof=1) * math.sqrt(252), rel=1e-12)
    assert rv[-1] == pytest.approx(math.sqrt(2.1666666e-4 / 2 * 252), rel=1e-6)


def test_rs_statistic_by_hand():
    # x = [1, 2, 3, 4]: deviations [-1.5,-.5,.5,1.5], cumsum [-1.5,-2,-1.5,0] -> R = 2
    # population std = sqrt(5/4) = 1.118034 -> R/S = 1.788854
    assert st.rs_statistic([1, 2, 3, 4]) == pytest.approx(2 / math.sqrt(1.25), rel=1e-12)


def test_expected_rs_anis_lloyd_peters():
    # n = 2: every chunk has R/S = 1 exactly; Anis-Lloyd gives 1, the Peters factor (n-1/2)/n = 0.75
    assert st.expected_rs(2) == pytest.approx(0.75, rel=1e-12)
    # large-n branch is continuous with the gamma branch at n = 340/341
    assert st.expected_rs(341) == pytest.approx(st.expected_rs(340) * 1.0, rel=0.01)


def test_hurst_white_noise_near_half_and_random_walk_dfa_near_one_and_half():
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.01, 4000)
    h = st.hurst_rs(x)
    assert abs(h["h_corrected"] - 0.5) < 0.06
    assert h["h"] > h["h_corrected"]                      # raw R/S is biased upward in finite samples
    assert abs(st.hurst_dfa(x)["alpha"] - 0.5) < 0.06
    # DFA of an integrated (random-walk) series: textbook alpha = 1.5
    assert abs(st.hurst_dfa(np.cumsum(x))["alpha"] - 1.5) < 0.08


def _arfima(d, n, seed, burn=2000):
    """Fractionally integrated noise (ARFIMA(0,d,0)); theoretical H = d + 0.5."""
    from scipy.special import gammaln
    k = np.arange(burn)
    psi = np.exp(gammaln(k + d) - gammaln(k + 1) - gammaln(d))
    e = np.random.default_rng(seed).normal(size=n + burn)
    return np.convolve(e, psi)[burn:burn + n]


def test_hurst_detects_long_memory_and_null_is_reproducible():
    x = _arfima(0.3, 3000, seed=3)                           # H = 0.8
    null = st.hurst_null(x, sims=60, seed=7)
    a = st.hurst_dfa(x)["alpha"]
    h = st.hurst_rs(x)["h_corrected"]
    assert 0.68 < a < 0.92 and 0.65 < h < 0.92
    assert a > null["dfa_p97_5"] and h > null["h_corrected_p97_5"]
    assert st.empirical_two_sided_p(a, null["_dfa_samples"]) == pytest.approx(1 / 61)
    assert st.hurst_null(x, sims=60, seed=7)["dfa_mean"] == null["dfa_mean"]


def test_short_memory_ar1_does_not_look_like_long_memory_at_large_scales():
    # documented caveat: AR(1) correlation decays fast, DFA over scales >= 10 stays near 0.5
    rng = np.random.default_rng(3)
    e = rng.normal(0, 1, 3000)
    ar = np.zeros_like(e)
    for t in range(1, len(e)):
        ar[t] = 0.4 * ar[t - 1] + e[t]
    assert abs(st.hurst_dfa(ar)["alpha"] - 0.5) < 0.1


def test_acf_by_hand_and_vs_statsmodels():
    # x = [1,2,3,4]: r1 = (0.75 - 0.25 + 0.75) / 5 = 0.25
    assert st.acf(np.array([1.0, 2, 3, 4]), 1)[1] == pytest.approx(0.25)
    from statsmodels.tsa.stattools import acf as sm_acf
    from statsmodels.stats.diagnostic import acorr_ljungbox
    rng = np.random.default_rng(11)
    x = rng.normal(size=500)
    np.testing.assert_allclose(st.acf(x, 10), sm_acf(x, nlags=10, fft=False), rtol=1e-10, atol=1e-12)
    lb = st.ljung_box(x, [5, 10])
    ref = acorr_ljungbox(x, lags=[5, 10], return_df=True)
    for row, (_, ref_row) in zip(lb, ref.iterrows()):
        assert row["q_stat"] == pytest.approx(ref_row["lb_stat"], rel=1e-10)
        assert row["p_value"] == pytest.approx(ref_row["lb_pvalue"], rel=1e-8)


def _vr_reference(x, q):
    """Independent loop implementation of Lo-MacKinlay (1988) eqs."""
    T = len(x)
    mu = sum(x) / T
    sa = sum((v - mu) ** 2 for v in x) / (T - 1)
    m = q * (T - q + 1) * (1 - q / T)
    sc = sum((sum(x[t - q + 1:t + 1]) - q * mu) ** 2 for t in range(q - 1, T)) / m
    return sc / sa


def test_variance_ratio_formula_and_ar1_value():
    rng = np.random.default_rng(5)
    x = rng.normal(size=300)
    for q in (2, 5):
        assert st.variance_ratio(x, q)["vr"] == pytest.approx(_vr_reference(list(x), q), rel=1e-10)
    # iid: not significant
    big = rng.normal(size=5000)
    assert st.variance_ratio(big, 2)["p_value_robust"] > 0.01
    # AR(1) phi = 0.3: population VR(2) = 1 + rho_1 = 1.3
    e = rng.normal(size=20000)
    ar = np.zeros_like(e)
    for t in range(1, len(e)):
        ar[t] = 0.3 * ar[t - 1] + e[t]
    v = st.variance_ratio(ar, 2)
    assert v["vr"] == pytest.approx(1.3, abs=0.03)
    assert v["p_value_robust"] < 1e-6
    # under homoskedasticity z and z* agree closely
    assert v["z_robust"] == pytest.approx(v["z"], rel=0.1)


def test_hmm_recovers_two_volatility_regimes():
    rng = np.random.default_rng(9)
    x = np.concatenate([rng.normal(0, 0.008, 600), rng.normal(0, 0.03, 300), rng.normal(0, 0.008, 400)])
    f = st.fit_gaussian_hmm(x, 2)
    vols = np.sqrt(f["var"])
    assert vols[0] == pytest.approx(0.008, rel=0.12)
    assert vols[1] == pytest.approx(0.03, rel=0.12)
    labels = f["smoothed"].argmax(axis=1)
    assert (labels[650:850] == 1).mean() > 0.9 and (labels[:550] == 0).mean() > 0.9
    assert f["filtered"][-1].argmax() == 0
    assert f["A"][0, 0] > 0.98 and f["stationary"].sum() == pytest.approx(1.0)
    segs = st.regime_segments(np.array([0, 0, 1, 1, 1, 0]))
    assert segs == [(0, 1, 0), (2, 4, 1), (5, 5, 0)]
    # BIC prefers 2 states over 3 for 2-regime data
    assert f["bic"] < st.fit_gaussian_hmm(x, 3)["bic"] + 50
