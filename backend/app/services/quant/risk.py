"""Single-asset risk metrics against a benchmark.

Conventions
* Returns are SIMPLE daily returns of split/dividend-adjusted closes
  (total-return series), aligned with the benchmark by date (inner join).
* ``rf`` is a per-day risk-free return aligned to the same dates
  (annual % / 100 / 252, de-annualised arithmetically).
* Annualisation: means x 252, volatilities x sqrt(252).

Formulas (reported verbatim in tool outputs)
* beta      = cov(r_i - rf, r_m - rf) / var(r_m - rf)        (OLS slope, ddof=1)
* alpha     = Jensen's alpha: OLS intercept of (r_i - rf) on (r_m - rf), x 252
* downside beta (conditional) = OLS slope using only days with r_m - rf < 0
* downside beta (Estrada 2002 semi-beta) =
      E[min(r_i - mu_i, 0) min(r_m - mu_m, 0)] / E[min(r_m - mu_m, 0)^2]
* Sharpe    = mean(r - rf) / std(r - rf, ddof=1) x sqrt(252)
* Sortino   = mean(r - rf) / sqrt(mean(min(r - rf, 0)^2)) x sqrt(252)
              (target = rf, downside deviation over all days)
* max drawdown = min_t (W_t / max_{s<=t} W_s - 1), W = cumulative wealth
* historical VaR_95 = -Q_0.05(r) (linear interpolation), CVaR = -mean(r | r <= Q_0.05)
* parametric (normal) VaR_95 = -(mu + z_0.05 sigma), CVaR = -(mu - sigma phi(z_0.05)/0.05)
* Cornish-Fisher VaR_95 uses z_cf = z + (z^2-1)S/6 + (z^3-3z)K/24 - (2z^3-5z)S^2/36
  with sample skewness S and excess kurtosis K (bias-corrected).
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from scipy import stats as sst

from app.services.quant.stats import TRADING_DAYS

Z95 = float(sst.norm.ppf(0.05))  # -1.6448536269514729


def ols(y: np.ndarray, X: np.ndarray) -> Dict[str, object]:
    """OLS with an intercept column already in X. Returns coefficients, classic
    and White (HC0) standard errors, t-stats, two-sided p-values, R^2."""
    y = np.asarray(y, float)
    X = np.asarray(X, float)
    n, k = X.shape
    xtx_inv = np.linalg.inv(X.T @ X)
    b = xtx_inv @ X.T @ y
    e = y - X @ b
    dof = n - k
    s2 = float(e @ e) / dof
    se = np.sqrt(np.diag(xtx_inv) * s2)
    meat = (X * (e ** 2)[:, None]).T @ X
    se_w = np.sqrt(np.diag(xtx_inv @ meat @ xtx_inv))
    t = b / se
    p = 2 * sst.t.sf(np.abs(t), dof)
    tw = b / se_w
    pw = 2 * sst.t.sf(np.abs(tw), dof)
    sst_ = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - float(e @ e) / sst_ if sst_ > 0 else float("nan")
    return {"coef": b, "se": se, "t": t, "p": p, "se_white": se_w, "t_white": tw, "p_white": pw,
            "r2": r2, "n": n, "resid_std": math.sqrt(s2), "resid": e}


def beta_alpha(ri: np.ndarray, rm: np.ndarray, rf: Optional[np.ndarray] = None,
               ppy: int = TRADING_DAYS) -> Dict[str, Optional[float]]:
    ri, rm = np.asarray(ri, float), np.asarray(rm, float)
    rf = np.zeros_like(ri) if rf is None else np.asarray(rf, float)
    ei, em = ri - rf, rm - rf
    if len(ei) < 20:
        return {"beta": None}
    fit = ols(ei, np.column_stack([np.ones_like(em), em]))
    a, b = fit["coef"]
    return {
        "beta": float(b), "beta_se": float(fit["se"][1]), "beta_t": float(fit["t"][1]),
        "alpha_daily": float(a), "alpha_annual": float(a * ppy),
        "alpha_t": float(fit["t"][0]), "alpha_p_value": float(fit["p"][0]),
        "alpha_t_white": float(fit["t_white"][0]), "alpha_p_value_white": float(fit["p_white"][0]),
        "r2": float(fit["r2"]), "correlation": float(np.corrcoef(ei, em)[0, 1]),
        "idiosyncratic_vol_annual": float(fit["resid_std"] * math.sqrt(ppy)), "n": int(fit["n"]),
    }


def downside_beta(ri: np.ndarray, rm: np.ndarray, rf: Optional[np.ndarray] = None) -> Dict[str, Optional[float]]:
    ri, rm = np.asarray(ri, float), np.asarray(rm, float)
    rf = np.zeros_like(ri) if rf is None else np.asarray(rf, float)
    ei, em = ri - rf, rm - rf
    down, up = em < 0, em > 0
    out: Dict[str, Optional[float]] = {"down_days": int(down.sum()), "up_days": int(up.sum())}

    def slope(mask):
        if mask.sum() < 20:
            return None
        x, y = em[mask], ei[mask]
        v = float(np.var(x, ddof=1))
        return float(np.cov(y, x, ddof=1)[0, 1] / v) if v > 0 else None

    out["downside_beta"] = slope(down)
    out["upside_beta"] = slope(up)
    di = np.minimum(ri - ri.mean(), 0.0)
    dm = np.minimum(rm - rm.mean(), 0.0)
    den = float(np.mean(dm * dm))
    out["estrada_semi_beta"] = float(np.mean(di * dm) / den) if den > 0 else None
    return out


def rolling_beta(ri: pd.Series, rm: pd.Series, window: int) -> pd.Series:
    """beta_t = cov / var over the trailing `window` days ending at t (inclusive)."""
    cov = ri.rolling(window).cov(rm)
    var = rm.rolling(window).var()
    return cov / var


def sharpe(r_: np.ndarray, rf: Optional[np.ndarray] = None, ppy: int = TRADING_DAYS) -> Optional[float]:
    r_ = np.asarray(r_, float)
    e = r_ - (0.0 if rf is None else np.asarray(rf, float))
    sd = float(np.std(e, ddof=1)) if len(e) > 1 else 0.0
    return float(np.mean(e) / sd * math.sqrt(ppy)) if sd > 0 else None


def sortino(r_: np.ndarray, rf: Optional[np.ndarray] = None, ppy: int = TRADING_DAYS) -> Optional[float]:
    r_ = np.asarray(r_, float)
    e = r_ - (0.0 if rf is None else np.asarray(rf, float))
    dd = math.sqrt(float(np.mean(np.minimum(e, 0.0) ** 2))) if len(e) else 0.0
    return float(np.mean(e) / dd * math.sqrt(ppy)) if dd > 0 else None


def downside_deviation(r_: np.ndarray, rf: Optional[np.ndarray] = None, ppy: int = TRADING_DAYS) -> Optional[float]:
    e = np.asarray(r_, float) - (0.0 if rf is None else np.asarray(rf, float))
    return float(math.sqrt(float(np.mean(np.minimum(e, 0.0) ** 2))) * math.sqrt(ppy)) if len(e) else None


def max_drawdown(close: pd.Series) -> Dict[str, Optional[object]]:
    """Largest peak-to-trough fall of a (total-return) price series, with the
    peak, trough and recovery dates (recovery = first close back at or above
    the peak; None if it has not recovered by the last bar)."""
    p = close.dropna()
    if len(p) < 2:
        return {"max_drawdown_pct": None}
    v = p.to_numpy(float)
    peak = np.maximum.accumulate(v)
    dd = v / peak - 1.0
    t = int(np.argmin(dd))
    pk = int(np.argmax(v[: t + 1]))
    rec = None
    after = np.nonzero(v[t:] >= v[pk])[0]
    if len(after):
        rec = t + int(after[0])
    idx = p.index
    d = lambda i: idx[i].date().isoformat()  # noqa: E731
    return {
        "max_drawdown_pct": float(dd[t] * 100),
        "peak_date": d(pk), "peak_value": float(v[pk]),
        "trough_date": d(t), "trough_value": float(v[t]),
        "recovery_date": d(rec) if rec is not None else None,
        "recovered": rec is not None,
        "peak_to_trough_trading_days": t - pk,
        "trough_to_recovery_trading_days": (rec - t) if rec is not None else None,
        "current_drawdown_pct": float(dd[-1] * 100),
    }


def var_cvar(r_: np.ndarray, level: float = 0.95) -> Dict[str, Optional[float]]:
    """One-day VaR / CVaR at `level` as POSITIVE loss fractions."""
    x = np.asarray(r_, float)
    a = 1 - level
    if len(x) < 30:
        return {}
    q = float(np.percentile(x, a * 100))                 # numpy 'linear' method
    tail = x[x <= q]
    mu, sd = float(x.mean()), float(x.std(ddof=1))
    z = float(sst.norm.ppf(a))
    S = float(sst.skew(x, bias=False))
    K = float(sst.kurtosis(x, fisher=True, bias=False))
    zcf = z + (z ** 2 - 1) * S / 6 + (z ** 3 - 3 * z) * K / 24 - (2 * z ** 3 - 5 * z) * S ** 2 / 36
    jb = sst.jarque_bera(x)
    return {
        "level": level,
        "historical_var": -q, "historical_cvar": -float(tail.mean()), "tail_observations": int(len(tail)),
        "parametric_var": -(mu + z * sd), "parametric_cvar": -(mu - sd * float(sst.norm.pdf(z)) / a),
        "cornish_fisher_var": -(mu + zcf * sd),
        "mean_daily": mu, "std_daily": sd, "z": z, "z_cornish_fisher": zcf,
        "skewness": S, "excess_kurtosis": K,
        "jarque_bera_stat": float(jb.statistic), "jarque_bera_p_value": float(jb.pvalue),
        "worst_day": float(x.min()),
    }


def divergence_notes(m: Dict[str, object]) -> List[str]:
    """Deterministic explanations of material gaps between risk measures.
    Every number in a note is copied from ``m``; nothing is estimated here."""
    out: List[str] = []
    v = m.get("var_95") or {}
    hv, pv, cf = v.get("historical_var"), v.get("parametric_var"), v.get("cornish_fisher_var")
    if hv and pv:
        ratio = hv / pv
        if abs(ratio - 1) > 0.1:
            out.append(f"Historical 95% VaR is {ratio:.2f}x the normal (parametric) VaR: the empirical return "
                       f"distribution (skewness {v.get('skewness'):.2f}, excess kurtosis "
                       f"{v.get('excess_kurtosis'):.2f}) is not normal at the 5% quantile.")
        hc, pc = v.get("historical_cvar"), v.get("parametric_cvar")
        if hc and pc and hc / pc > 1.1:
            out.append(f"Historical CVaR ({hc * 100:.2f}%) exceeds the normal CVaR ({pc * 100:.2f}%): losses beyond "
                       "the VaR are larger than a normal distribution implies (fat left tail).")
    if v.get("jarque_bera_p_value") is not None and v["jarque_bera_p_value"] < 0.01:
        jp = v["jarque_bera_p_value"]
        out.append(f"Jarque-Bera p-value {'< 1e-6' if jp < 1e-6 else format(jp, '.3g')}: normality of daily returns is rejected, so "
                   "the parametric VaR and the Sharpe ratio (which treats upside and downside alike) are less reliable "
                   "than the historical figures.")
    b, db = m.get("beta"), m.get("downside_beta")
    if b and db is not None and abs(db - b) > 0.15 * abs(b):
        word = "higher" if db > b else "lower"
        out.append(f"Downside beta ({db:.2f}) is {word} than full-sample beta ({b:.2f}): sensitivity to the benchmark "
                   f"is asymmetric, {'larger' if db > b else 'smaller'} on down-market days.")
    rb = m.get("rolling_beta_252") or {}
    if rb.get("min") is not None and rb.get("max") is not None and rb["max"] - rb["min"] > 0.5:
        out.append(f"252-day rolling beta ranged from {rb['min']:.2f} ({rb.get('min_date')}) to {rb['max']:.2f} "
                   f"({rb.get('max_date')}): a single full-period beta hides material time variation.")
    sh, so = m.get("sharpe"), m.get("sortino")
    if sh and so and sh > 0:
        out.append(f"Sortino/Sharpe ratio = {so / sh:.2f} (about 1.41 if returns were symmetric around rf): "
                   + ("downside volatility is relatively low versus total volatility."
                      if so / sh > 1.5 else "downside volatility is a large share of total volatility."
                      if so / sh < 1.3 else "downside and total volatility are in roughly normal proportion."))
    ap = m.get("alpha_p_value")
    if ap is not None and ap >= 0.05:
        out.append(f"Jensen's alpha is not statistically significant (p = {ap:.2f}); it cannot be distinguished from "
                   "zero over this window.")
    return out
