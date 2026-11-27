"""Time-series statistics of daily returns.

Conventions
* ``x`` is a 1-D array of daily LOG returns ln(P_t / P_{t-1}) of a split- and
  dividend-adjusted close, unless a function says otherwise.
* Annualisation uses 252 trading days.
* Every function is deterministic (fixed seeds where resampling is used).

References
* Realised volatility: sample standard deviation (ddof=1) x sqrt(252).
* R/S Hurst: Hurst (1951); small-sample expected R/S by Anis & Lloyd (1976)
  with the Peters (1994) correction; see Weron (2002), "Estimating long-range
  dependence: finite sample properties and confidence intervals".
* DFA: Peng et al. (1994), first-order (linear) detrending.
* ACF / Ljung-Box: Box & Jenkins; Ljung & Box (1978).
* Variance ratio: Lo & MacKinlay (1988), overlapping estimator with the
  heteroskedasticity-robust z*(q).
* Regimes: Gaussian hidden Markov model fitted by Baum-Welch (EM) with a
  deterministic initialisation; Hamilton (1989), Rabiner (1989).
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy import stats as sst
from scipy.special import gammaln

TRADING_DAYS = 252


def r(v, n: int = 6) -> Optional[float]:
    """Round to n decimals; None for None / NaN / inf."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, n) if math.isfinite(f) else None


def log_returns(close: Sequence[float]) -> np.ndarray:
    p = np.asarray(close, dtype=float)
    return np.diff(np.log(p))


def simple_returns(close: Sequence[float]) -> np.ndarray:
    p = np.asarray(close, dtype=float)
    return p[1:] / p[:-1] - 1.0


# ── realised volatility ──────────────────────────────────────────────────────

def realised_vol(x: np.ndarray, ppy: int = TRADING_DAYS) -> Optional[float]:
    """Annualised realised volatility = std(x, ddof=1) * sqrt(ppy)."""
    x = np.asarray(x, dtype=float)
    if len(x) < 2:
        return None
    return float(np.std(x, ddof=1) * math.sqrt(ppy))


def rolling_vol(x: np.ndarray, window: int, ppy: int = TRADING_DAYS) -> np.ndarray:
    """Rolling annualised vol; element i uses x[i-window+1 .. i] (NaN before)."""
    x = np.asarray(x, dtype=float)
    out = np.full(len(x), np.nan)
    if len(x) < window or window < 2:
        return out
    c1 = np.concatenate([[0.0], np.cumsum(x)])
    c2 = np.concatenate([[0.0], np.cumsum(x * x)])
    s1 = c1[window:] - c1[:-window]
    s2 = c2[window:] - c2[:-window]
    var = (s2 - s1 * s1 / window) / (window - 1)
    out[window - 1:] = np.sqrt(np.maximum(var, 0.0) * ppy)
    return out


# ── Hurst exponent: rescaled range ───────────────────────────────────────────

def _window_sizes(n: int, min_size: int = 10, max_frac: float = 0.25, count: int = 14) -> List[int]:
    hi = max(min_size, int(n * max_frac))
    if hi <= min_size:
        return [min_size] if n >= 2 * min_size else []
    sizes = np.unique(np.floor(np.logspace(math.log10(min_size), math.log10(hi), count)).astype(int))
    return [int(s) for s in sizes if s >= min_size and n // s >= 2]


def rs_statistic(chunk: np.ndarray) -> float:
    """R/S of one chunk: range of the cumulative mean-adjusted sum divided by
    the population standard deviation (ddof=0) of the chunk."""
    c = np.asarray(chunk, dtype=float)
    y = np.cumsum(c - c.mean())
    rng = y.max() - y.min()
    s = c.std(ddof=0)
    return float(rng / s) if s > 0 else float("nan")


def _rs_avg(x: np.ndarray, n: int) -> float:
    k = len(x) // n
    m = x[: k * n].reshape(k, n)
    dev = m - m.mean(axis=1, keepdims=True)
    y = np.cumsum(dev, axis=1)
    rng = y.max(axis=1) - y.min(axis=1)
    s = m.std(axis=1, ddof=0)
    ok = s > 0
    return float(np.mean(rng[ok] / s[ok])) if ok.any() else float("nan")


def expected_rs(n: int) -> float:
    """Anis-Lloyd expected R/S of n iid normal observations, with the Peters
    (n-1/2)/n factor (Weron 2002, eq. 4)."""
    i = np.arange(1, n)
    tail = float(np.sum(np.sqrt((n - i) / i)))
    if n <= 340:
        g = math.exp(gammaln((n - 1) / 2) - gammaln(n / 2)) / math.sqrt(math.pi)
    else:
        g = 1.0 / math.sqrt(n * math.pi / 2)
    return (n - 0.5) / n * g * tail


def _slope(xs: np.ndarray, ys: np.ndarray) -> tuple[float, float, float]:
    """OLS slope, its standard error and R^2 of ys on xs."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    xm = xs - xs.mean()
    sxx = float(np.sum(xm * xm))
    b = float(np.sum(xm * (ys - ys.mean())) / sxx)
    resid = ys - ys.mean() - b * xm
    n = len(xs)
    se = math.sqrt(float(np.sum(resid ** 2)) / (n - 2) / sxx) if n > 2 else float("nan")
    sst_ = float(np.sum((ys - ys.mean()) ** 2))
    r2 = 1 - float(np.sum(resid ** 2)) / sst_ if sst_ > 0 else float("nan")
    return b, se, r2


def hurst_rs(x: np.ndarray, sizes: Optional[List[int]] = None) -> Dict[str, object]:
    """Classical R/S Hurst exponent: slope of log(mean R/S) on log(n) over
    non-overlapping chunks (any remainder at the end is dropped).

    Also returns the Anis-Lloyd-Peters corrected H = 0.5 + slope of
    (log R/S - log E[R/S]) on log n, which removes most of the small-sample
    upward bias of the raw estimate."""
    x = np.asarray(x, dtype=float)
    sizes = sizes or _window_sizes(len(x))
    if len(sizes) < 3:
        return {"h": None, "h_corrected": None, "sizes": sizes}
    rs = np.array([_rs_avg(x, n) for n in sizes])
    ok = np.isfinite(rs) & (rs > 0)
    ln_n = np.log(np.array(sizes, float))[ok]
    ln_rs = np.log(rs[ok])
    h, se, r2 = _slope(ln_n, ln_rs)
    ers = np.log(np.array([expected_rs(n) for n in np.array(sizes)[ok]]))
    hc, sec, _ = _slope(ln_n, ln_rs - ers)
    return {"h": h, "h_se": se, "r2": r2, "h_corrected": 0.5 + hc, "h_corrected_se": sec,
            "sizes": [int(s) for s in np.array(sizes)[ok]]}


# ── Hurst exponent: detrended fluctuation analysis ───────────────────────────

def dfa_fluctuation(x: np.ndarray, s: int) -> float:
    """DFA-1 fluctuation F(s): profile Y = cumsum(x - mean); split Y into
    non-overlapping segments of length s; remove a least-squares line from
    each; F(s) = sqrt(mean squared residual over all segments)."""
    y = np.cumsum(np.asarray(x, float) - np.mean(x))
    k = len(y) // s
    seg = y[: k * s].reshape(k, s)
    t = np.arange(s, dtype=float)
    tm = t - t.mean()
    sxx = float(np.sum(tm * tm))
    slope = (seg - seg.mean(axis=1, keepdims=True)) @ tm / sxx
    fit = seg.mean(axis=1, keepdims=True) + slope[:, None] * tm[None, :]
    return float(math.sqrt(np.mean((seg - fit) ** 2)))


def hurst_dfa(x: np.ndarray, sizes: Optional[List[int]] = None) -> Dict[str, object]:
    """DFA scaling exponent alpha = slope of log F(s) on log s.
    For a returns series alpha ~ 0.5 is uncorrelated, > 0.5 persistent,
    < 0.5 anti-persistent; for a random-walk LEVEL series alpha ~ 1.5."""
    x = np.asarray(x, dtype=float)
    sizes = sizes or _window_sizes(len(x))
    if len(sizes) < 3:
        return {"alpha": None, "sizes": sizes}
    f = np.array([dfa_fluctuation(x, s) for s in sizes])
    ok = np.isfinite(f) & (f > 0)
    a, se, r2 = _slope(np.log(np.array(sizes, float))[ok], np.log(f[ok]))
    return {"alpha": a, "alpha_se": se, "r2": r2, "sizes": [int(s) for s in np.array(sizes)[ok]]}


def hurst_null(x: np.ndarray, sims: int = 100, seed: int = 12345) -> Dict[str, Optional[float]]:
    """Null distribution of the estimators for THIS sample size: the same
    returns randomly shuffled (destroys serial dependence, keeps the marginal
    distribution). Seeded, so the result is reproducible."""
    x = np.asarray(x, dtype=float)
    sizes = _window_sizes(len(x))
    if len(sizes) < 3:
        return {}
    rng = np.random.default_rng(seed)
    hc, da = [], []
    for _ in range(sims):
        p = rng.permutation(x)
        hc.append(hurst_rs(p, sizes)["h_corrected"])
        da.append(hurst_dfa(p, sizes)["alpha"])
    hc, da = np.array(hc, float), np.array(da, float)
    return {"sims": sims, "seed": seed,
            "h_corrected_mean": float(hc.mean()), "h_corrected_p2_5": float(np.percentile(hc, 2.5)),
            "h_corrected_p97_5": float(np.percentile(hc, 97.5)),
            "dfa_mean": float(da.mean()), "dfa_p2_5": float(np.percentile(da, 2.5)),
            "dfa_p97_5": float(np.percentile(da, 97.5)),
            "_h_samples": hc, "_dfa_samples": da}


def empirical_two_sided_p(value: float, samples: np.ndarray) -> float:
    """Two-sided permutation p-value of value against null samples, with the
    +1 correction (Phipson & Smyth 2010)."""
    s = np.asarray(samples, float)
    c = float(np.mean(s))
    extreme = np.sum(np.abs(s - c) >= abs(value - c))
    return float((extreme + 1) / (len(s) + 1))


# ── autocorrelation ──────────────────────────────────────────────────────────

def acf(x: np.ndarray, nlags: int) -> np.ndarray:
    """Sample autocorrelation r_k = sum_{t>k}(x_t-m)(x_{t-k}-m) / sum(x_t-m)^2,
    k = 0..nlags (the standard biased estimator, as in statsmodels)."""
    x = np.asarray(x, float)
    d = x - x.mean()
    den = float(np.sum(d * d))
    out = np.ones(nlags + 1)
    for k in range(1, nlags + 1):
        out[k] = float(np.sum(d[k:] * d[:-k]) / den) if den > 0 else float("nan")
    return out


def ljung_box(x: np.ndarray, lags: Sequence[int]) -> List[Dict[str, float]]:
    """Ljung-Box Q(m) = N(N+2) sum_{k=1..m} r_k^2 / (N-k), ~ chi2(m) under no
    autocorrelation up to lag m."""
    x = np.asarray(x, float)
    n = len(x)
    m_max = max(lags)
    rk = acf(x, m_max)
    out = []
    for m in lags:
        q = n * (n + 2) * float(np.sum(rk[1:m + 1] ** 2 / (n - np.arange(1, m + 1))))
        out.append({"lag": int(m), "q_stat": q, "p_value": float(sst.chi2.sf(q, m))})
    return out


# ── variance ratio ───────────────────────────────────────────────────────────

def variance_ratio(x: np.ndarray, q: int) -> Dict[str, float]:
    """Lo-MacKinlay (1988) overlapping variance ratio of q-period returns.

    With T one-period log returns x_1..x_T and mu = mean(x):
      sigma_a^2 = sum (x_t - mu)^2 / (T - 1)
      sigma_c^2 = sum_{t=q..T} (sum_{j=0..q-1} x_{t-j} - q mu)^2 / m,
                  m = q (T - q + 1) (1 - q / T)
      VR(q) = sigma_c^2 / sigma_a^2
    z(q)  = (VR - 1) / sqrt(2 (2q - 1)(q - 1) / (3 q T))          (iid)
    z*(q) = (VR - 1) / sqrt(theta),  theta = sum_{j=1..q-1} [2(q-j)/q]^2 delta_j,
      delta_j = T * sum_{t>j}(x_t-mu)^2 (x_{t-j}-mu)^2 / [sum (x_t-mu)^2]^2
    z* is robust to heteroskedasticity (volatility clustering).
    VR > 1: positive serial correlation (momentum); VR < 1: mean reversion."""
    x = np.asarray(x, float)
    T = len(x)
    if q < 2 or T < 2 * q + 2:
        raise ValueError("series too short for this q")
    mu = x.mean()
    d = x - mu
    sa2 = float(np.sum(d * d) / (T - 1))
    c = np.concatenate([[0.0], np.cumsum(x)])
    qsum = c[q:] - c[:-q]                       # T - q + 1 overlapping q-sums
    m = q * (T - q + 1) * (1 - q / T)
    sc2 = float(np.sum((qsum - q * mu) ** 2) / m)
    vr = sc2 / sa2
    z = (vr - 1) / math.sqrt(2 * (2 * q - 1) * (q - 1) / (3 * q * T))
    d2 = d * d
    den = float(np.sum(d2)) ** 2
    theta = 0.0
    for j in range(1, q):
        delta = T * float(np.sum(d2[j:] * d2[:-j])) / den
        theta += (2 * (q - j) / q) ** 2 * delta
    zs = (vr - 1) / math.sqrt(theta / T) if theta > 0 else float("nan")
    return {"q": int(q), "vr": vr, "z": z, "p_value": float(2 * sst.norm.sf(abs(z))),
            "z_robust": zs, "p_value_robust": float(2 * sst.norm.sf(abs(zs)))}


# ── regimes: Gaussian hidden Markov model ────────────────────────────────────

def _norm_pdf(x: np.ndarray, mu: np.ndarray, var: np.ndarray) -> np.ndarray:
    return np.exp(-0.5 * (x[:, None] - mu[None, :]) ** 2 / var[None, :]) / np.sqrt(2 * np.pi * var[None, :])


def _forward_backward(x, pi, A, mu, var):
    n, k = len(x), len(pi)
    B = _norm_pdf(x, mu, var) + 1e-300
    alpha = np.zeros((n, k))
    c = np.zeros(n)
    a = pi * B[0]
    c[0] = a.sum()
    alpha[0] = a / c[0]
    for t in range(1, n):
        a = (alpha[t - 1] @ A) * B[t]
        c[t] = a.sum()
        alpha[t] = a / c[t]
    beta = np.ones((n, k))
    for t in range(n - 2, -1, -1):
        beta[t] = (A @ (B[t + 1] * beta[t + 1])) / c[t + 1]
    gamma = alpha * beta
    gamma /= gamma.sum(axis=1, keepdims=True)
    xi = np.zeros((k, k))
    for t in range(n - 1):
        m = alpha[t][:, None] * A * (B[t + 1] * beta[t + 1])[None, :] / c[t + 1]
        xi += m
    return alpha, gamma, xi, float(np.sum(np.log(c)))


def fit_gaussian_hmm(x: np.ndarray, k: int = 2, max_iter: int = 300, tol: float = 1e-7) -> Dict[str, object]:
    """K-state Gaussian HMM on daily returns by Baum-Welch.

    Deterministic initialisation: observations are ranked by |x| and split
    into K equal groups; state j starts with the overall mean and the mean
    square of group j, persistence 0.95. States are ordered by variance
    (state 0 = calmest). ``filtered`` probabilities use data up to t only
    (no look-ahead); ``smoothed`` use the whole sample."""
    x = np.asarray(x, float)
    n = len(x)
    if n < 50 * k:
        raise ValueError("series too short for an HMM")
    order = np.argsort(np.abs(x))
    groups = np.array_split(order, k)
    var = np.array([max(float(np.mean(x[g] ** 2)), 1e-10) for g in groups])
    mu = np.full(k, float(x.mean()))
    A = np.full((k, k), 0.05 / (k - 1))
    np.fill_diagonal(A, 0.95)
    pi = np.full(k, 1.0 / k)
    ll_prev = -np.inf
    it = 0
    for it in range(1, max_iter + 1):
        alpha, gamma, xi, ll = _forward_backward(x, pi, A, mu, var)
        pi = gamma[0]
        A = xi / xi.sum(axis=1, keepdims=True)
        w = gamma.sum(axis=0)
        mu = (gamma * x[:, None]).sum(axis=0) / w
        var = np.maximum((gamma * (x[:, None] - mu[None, :]) ** 2).sum(axis=0) / w, 1e-10)
        if abs(ll - ll_prev) < tol * max(1.0, abs(ll)):
            break
        ll_prev = ll
    alpha, gamma, xi, ll = _forward_backward(x, pi, A, mu, var)
    idx = np.argsort(var)
    mu, var, A = mu[idx], var[idx], A[np.ix_(idx, idx)]
    alpha, gamma = alpha[:, idx], gamma[:, idx]
    n_params = (k - 1) + k * (k - 1) + 2 * k
    # stationary distribution: left eigenvector of A for eigenvalue 1
    evals, evecs = np.linalg.eig(A.T)
    st = np.real(evecs[:, np.argmin(np.abs(evals - 1))])
    st = st / st.sum()
    return {"k": k, "mu": mu, "var": var, "A": A, "stationary": st, "loglik": ll,
            "bic": -2 * ll + n_params * math.log(n), "aic": -2 * ll + 2 * n_params,
            "iterations": it, "filtered": alpha, "smoothed": gamma}


def regime_segments(states: np.ndarray) -> List[tuple]:
    """(start_index, end_index_inclusive, state) runs of a label sequence."""
    out = []
    s = 0
    for i in range(1, len(states) + 1):
        if i == len(states) or states[i] != states[s]:
            out.append((s, i - 1, int(states[s])))
            s = i
    return out
