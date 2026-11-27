"""Portfolio risk analytics on aligned daily simple returns.

Formulas
* Sigma = sample covariance of daily returns (ddof=1) x 252 (annualised).
* portfolio vol sigma_p = sqrt(w' Sigma w).
* marginal contribution to risk MCR_i = (Sigma w)_i / sigma_p
  (d sigma_p / d w_i); component CCR_i = w_i MCR_i (sums to sigma_p);
  percentage PCR_i = CCR_i / sigma_p (sums to 1).
* diversification ratio = sum_i w_i sigma_i / sigma_p (1 = no diversification).
* effective number of positions = 1 / sum w_i^2; effective number of risk
  contributors = 1 / sum PCR_i^2.
* Herfindahl-Hirschman index (HHI) of weights / sector weights = sum share^2.
* PCA: eigen-decomposition of the correlation matrix; the first eigenvalue
  divided by the number of assets is the share of total standardised variance
  explained by one common factor.
* Factor regressions: OLS of daily returns on SPY (market) and on SPY plus a
  tech spread (QQQ - SPY) and, where mapped, a sector spread (sector ETF - SPY).
* Historical stress: buy-and-hold return of the weights between two fixed
  dates (close of the last session on/before each date) and the worst
  peak-to-trough fall of the portfolio inside the window.
* Hypothetical shock: linear factor model, asset move = beta_QQQ x shock.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from app.services.quant.risk import ols
from app.services.quant.stats import TRADING_DAYS

# Fixed calendar windows (closing peak -> closing trough of the named index).
STRESS_WINDOWS: List[Dict[str, str]] = [
    {"id": "q4_2018_selloff", "name": "Q4 2018 sell-off", "start": "2018-09-20", "end": "2018-12-24",
     "basis": "S&P 500 closing high (2018-09-20) to closing low (2018-12-24)"},
    {"id": "covid_crash_2020", "name": "2020 COVID crash", "start": "2020-02-19", "end": "2020-03-23",
     "basis": "S&P 500 closing high (2020-02-19) to closing low (2020-03-23)"},
    {"id": "tech_bear_2022", "name": "2021-22 tech bear market", "start": "2021-11-19", "end": "2022-12-28",
     "basis": "Nasdaq-100 closing high (2021-11-19) to closing low (2022-12-28)"},
    {"id": "tariff_shock_2025", "name": "2025 tariff shock", "start": "2025-02-19", "end": "2025-04-08",
     "basis": "S&P 500 closing high (2025-02-19) to closing low (2025-04-08)"},
]

# Yahoo-style sector names (and GICS names) -> SPDR sector ETF.
SECTOR_ETF = {
    "technology": "XLK", "information technology": "XLK",
    "communication services": "XLC",
    "consumer cyclical": "XLY", "consumer discretionary": "XLY",
    "consumer defensive": "XLP", "consumer staples": "XLP",
    "financial services": "XLF", "financials": "XLF", "financial": "XLF",
    "healthcare": "XLV", "health care": "XLV",
    "energy": "XLE", "industrials": "XLI", "utilities": "XLU",
    "real estate": "XLRE", "basic materials": "XLB", "materials": "XLB",
}


def risk_contributions(weights: Sequence[float], cov_annual: np.ndarray) -> Dict[str, object]:
    w = np.asarray(weights, float)
    S = np.asarray(cov_annual, float)
    var_p = float(w @ S @ w)
    vol_p = math.sqrt(var_p)
    mcr = S @ w / vol_p
    ccr = w * mcr
    pcr = ccr / vol_p
    vols = np.sqrt(np.diag(S))
    return {"portfolio_vol": vol_p, "mcr": mcr, "ccr": ccr, "pcr": pcr, "asset_vol": vols,
            "diversification_ratio": float(w @ vols / vol_p),
            "effective_n_weights": float(1 / np.sum(w ** 2)),
            "effective_n_risk": float(1 / np.sum(pcr ** 2))}


def hhi(shares: Sequence[float]) -> float:
    s = np.asarray(shares, float)
    return float(np.sum(s ** 2))


def pca_share(corr: np.ndarray) -> Dict[str, object]:
    evals, evecs = np.linalg.eigh(np.asarray(corr, float))
    order = np.argsort(evals)[::-1]
    evals, evecs = evals[order], evecs[:, order]
    v1 = evecs[:, 0]
    if v1.sum() < 0:
        v1 = -v1
    return {"eigenvalues": evals, "pc1_share": float(evals[0] / evals.sum()), "pc1_loadings": v1}


def factor_regression(y: np.ndarray, factors: Dict[str, np.ndarray], ppy: int = TRADING_DAYS) -> Dict[str, object]:
    names = list(factors)
    X = np.column_stack([np.ones(len(y))] + [np.asarray(factors[k], float) for k in names])
    fit = ols(np.asarray(y, float), X)
    return {
        "alpha_annual": float(fit["coef"][0] * ppy), "alpha_t": float(fit["t"][0]),
        "betas": {k: float(fit["coef"][i + 1]) for i, k in enumerate(names)},
        "t_stats": {k: float(fit["t"][i + 1]) for i, k in enumerate(names)},
        "r2": float(fit["r2"]), "n": int(fit["n"]),
    }


def _close_on_or_before(s: pd.Series, d: str) -> Optional[tuple]:
    s = s.dropna()
    pos = int(s.index.searchsorted(pd.Timestamp(d), side="right")) - 1
    if pos < 0:
        return None
    return s.index[pos], float(s.iloc[pos])


def historical_stress(closes: Dict[str, pd.Series], weights: Dict[str, float],
                      windows: Sequence[Dict[str, str]] = STRESS_WINDOWS,
                      references: Optional[Dict[str, pd.Series]] = None) -> List[Dict[str, object]]:
    """Buy-and-hold stress returns. An asset without a bar on/before the
    window start (not yet listed / no data) makes the portfolio figure
    unavailable; it is never silently re-weighted."""
    out = []
    for w in windows:
        row: Dict[str, object] = {"id": w["id"], "name": w["name"], "start": w["start"], "end": w["end"],
                                  "basis": w["basis"], "assets": {}, "missing": []}
        paths = {}
        for sym, s in closes.items():
            a = _close_on_or_before(s, w["start"])
            b = _close_on_or_before(s, w["end"])
            if a is None or b is None or (pd.Timestamp(w["start"]) - a[0]).days > 7:
                row["missing"].append(sym)
                continue
            row["assets"][sym] = {"return_pct": (b[1] / a[1] - 1) * 100,
                                  "start_bar": a[0].date().isoformat(), "end_bar": b[0].date().isoformat()}
            seg = s[(s.index >= a[0]) & (s.index <= b[0])].dropna()
            paths[sym] = seg / seg.iloc[0]
        if not row["missing"] and paths:
            df = pd.concat(paths, axis=1).ffill().dropna()
            val = sum(weights[k] * df[k] for k in paths)
            peak = np.maximum.accumulate(val.to_numpy())
            dd = val.to_numpy() / peak - 1
            row["portfolio_return_pct"] = (float(val.iloc[-1]) - 1) * 100
            row["portfolio_max_drawdown_pct"] = float(dd.min()) * 100
            row["worst_asset"] = min(row["assets"], key=lambda k: row["assets"][k]["return_pct"])
        else:
            row["portfolio_return_pct"] = None
            row["note"] = "portfolio figure unavailable: no price data at the window start for " + ", ".join(row["missing"])
        for name, s in (references or {}).items():
            a, b = _close_on_or_before(s, w["start"]), _close_on_or_before(s, w["end"])
            if a and b:
                row.setdefault("benchmarks", {})[name] = {"return_pct": (b[1] / a[1] - 1) * 100}
        out.append(row)
    return out
