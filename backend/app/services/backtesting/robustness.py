"""Overfitting diagnostics for parameter sweeps.

* **In-sample / out-of-sample split**: the sweep picks the best combination
  using only the in-sample window. Its out-of-sample result is what a user
  would have got by trusting that pick.
* **Walk-forward optimisation**: K folds. Each fold picks the best combination
  on its training window and is scored on the next test window. The stitched
  test windows form one out-of-sample equity curve that never used its own
  data for selection.
* **Probability of backtest overfitting (PBO)** by combinatorially symmetric
  cross-validation (Bailey, Borwein, Lopez de Prado & Zhu, 2017). The
  returns matrix is split into S blocks. For every half/half split, the
  in-sample winner is ranked out of sample. PBO is the share of splits where
  that winner lands in the bottom half.
* **Deflated Sharpe ratio** (Bailey & Lopez de Prado, 2014): the probability
  that the best Sharpe is above zero once you account for the number of
  trials, their Sharpe dispersion, and the skew and kurtosis of returns.

All selection uses daily returns from full-period runs of each combination.
Indicators are causal, so a position that is open when a test window starts
was opened on information available at the time.
"""
from __future__ import annotations

import itertools
import math
from statistics import NormalDist
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

_N = NormalDist()
EULER_GAMMA = 0.5772156649015329


def sharpe(r: np.ndarray, ppy: int = 252) -> float:
    r = r[np.isfinite(r)]
    if len(r) < 3:
        return float("nan")
    sd = r.std(ddof=1)
    return float(r.mean() / sd * math.sqrt(ppy)) if sd > 1e-12 else 0.0


def _objective(r: np.ndarray, kind: str, ppy: int) -> float:
    if kind == "cagr":
        g = np.prod(1 + r[np.isfinite(r)])
        yrs = len(r) / ppy
        return float(g ** (1 / yrs) - 1) if yrs > 0 and g > 0 else -1.0
    return sharpe(r, ppy)


def pbo_cscv(returns: np.ndarray, blocks: int = 10, ppy: int = 252) -> Optional[dict]:
    """returns: T x N (N strategy variants)."""
    T, N = returns.shape
    if N < 2 or T < blocks * 10:
        return None
    blocks = blocks - (blocks % 2)
    edges = np.linspace(0, T, blocks + 1).round().astype(int)
    parts = [returns[edges[i]:edges[i + 1]] for i in range(blocks)]
    logits = []
    degr = []
    for is_ids in itertools.combinations(range(blocks), blocks // 2):
        oos_ids = [i for i in range(blocks) if i not in is_ids]
        R_is = np.vstack([parts[i] for i in is_ids])
        R_oos = np.vstack([parts[i] for i in oos_ids])
        sr_is = np.array([sharpe(R_is[:, j], ppy) for j in range(N)])
        sr_oos = np.array([sharpe(R_oos[:, j], ppy) for j in range(N)])
        sr_is = np.nan_to_num(sr_is, nan=-np.inf)
        best = int(np.argmax(sr_is))
        # relative rank of the IS winner out of sample, in (0, 1)
        rank = (np.sum(sr_oos < sr_oos[best]) + 0.5 * (np.sum(sr_oos == sr_oos[best]) - 1) + 1)
        w = rank / (N + 1)
        logits.append(math.log(w / (1 - w)))
        degr.append((float(sr_is[best]), float(sr_oos[best])))
    logits = np.array(logits)
    is_b, oos_b = np.array(degr).T
    slope = float(np.polyfit(is_b, oos_b, 1)[0]) if np.std(is_b) > 1e-12 else None
    return {
        "pbo": round(float((logits <= 0).mean()), 4),
        "splits": int(len(logits)),
        "blocks": blocks,
        "variants": int(N),
        "median_logit": round(float(np.median(logits)), 4),
        "is_winner_oos_sharpe_median": round(float(np.median(oos_b)), 4),
        "is_vs_oos_slope": None if slope is None else round(slope, 4),
        "prob_oos_loss": round(float((oos_b < 0).mean()), 4),
    }


def deflated_sharpe(best_returns: np.ndarray, trial_sharpes_ann: List[float], ppy: int = 252) -> Optional[dict]:
    r = best_returns[np.isfinite(best_returns)]
    T = len(r)
    if T < 30:
        return None
    sd = r.std(ddof=1)
    if sd <= 1e-12:
        return None
    sr = r.mean() / sd  # per period
    z = (r - r.mean()) / sd
    skew = float(np.mean(z ** 3))
    kurt = float(np.mean(z ** 4))  # Pearson (normal = 3)
    trials = [s / math.sqrt(ppy) for s in trial_sharpes_ann if s is not None and math.isfinite(s)]
    N = max(1, len(trials))
    if N > 1:
        var_sr = float(np.var(trials, ddof=1))
        sr0 = math.sqrt(max(var_sr, 0.0)) * ((1 - EULER_GAMMA) * _N.inv_cdf(1 - 1 / N)
                                              + EULER_GAMMA * _N.inv_cdf(1 - 1 / (N * math.e)))
    else:
        sr0 = 0.0
    denom = 1 - skew * sr + (kurt - 1) / 4 * sr ** 2
    if denom <= 0:
        return None
    stat = (sr - sr0) * math.sqrt(T - 1) / math.sqrt(denom)
    return {
        "deflated_sharpe_probability": round(_N.cdf(stat), 4),
        "sharpe_annual": round(float(sr * math.sqrt(ppy)), 4),
        "benchmark_sharpe_annual": round(sr0 * math.sqrt(ppy), 4),
        "trials": N, "observations": T, "skew": round(skew, 4), "kurtosis": round(kurt, 4),
    }


def split_index(index: pd.DatetimeIndex, frac: float) -> int:
    return max(1, min(len(index) - 1, int(round(len(index) * frac))))


def walk_forward_folds(n: int, folds: int, mode: str = "anchored", min_train: int = 126) -> List[tuple]:
    """(train_start, train_end, test_start, test_end) as bar offsets, half-open."""
    folds = max(2, folds)
    test_len = (n - min_train) // folds
    if test_len < 20:
        return []
    out = []
    for k in range(folds):
        test_start = min_train + k * test_len
        test_end = n if k == folds - 1 else test_start + test_len
        train_start = 0 if mode == "anchored" else max(0, test_start - max(min_train, test_len * 2))
        out.append((train_start, test_start, test_start, test_end))
    return out


def analyse_sweep(
    combos: List[Dict[str, float]],
    returns: pd.DataFrame,  # columns = combo index, rows = dates
    ppy: int,
    oos_frac: Optional[float] = 0.7,
    wf_folds: Optional[int] = None,
    wf_mode: str = "anchored",
    objective: str = "sharpe",
    initial: float = 10_000.0,
) -> dict:
    R = returns.to_numpy(dtype=float)
    T, N = R.shape
    idx = returns.index
    out: dict = {"variants": N, "objective": objective}
    full_obj = [_objective(R[:, j], objective, ppy) for j in range(N)]
    rows = []
    if oos_frac:
        cut = split_index(idx, oos_frac)
        is_obj = [_objective(R[:cut, j], objective, ppy) for j in range(N)]
        oos_obj = [_objective(R[cut:, j], objective, ppy) for j in range(N)]
        best = int(np.nanargmax(np.nan_to_num(is_obj, nan=-np.inf)))
        out["oos_split"] = {
            "split_date": idx[cut].date().isoformat(), "in_sample_fraction": oos_frac,
            "selected": best, "selected_params": combos[best],
            "in_sample": {"sharpe": _r(sharpe(R[:cut, best], ppy)), "total_return_pct": _r(_tot(R[:cut, best]) * 100)},
            "out_of_sample": {"sharpe": _r(sharpe(R[cut:, best], ppy)), "total_return_pct": _r(_tot(R[cut:, best]) * 100)},
            "oos_rank_of_is_winner": int(1 + np.sum(np.nan_to_num(oos_obj, nan=-np.inf) > oos_obj[best])),
        }
        valid = [(a, b) for a, b in zip(is_obj, oos_obj) if math.isfinite(a) and math.isfinite(b)]
        if len(valid) >= 3:
            a, b = np.array(valid).T
            out["oos_split"]["is_oos_rank_correlation"] = _r(float(pd.Series(a).rank().corr(pd.Series(b).rank())))
        for j in range(N):
            rows.append({"params": combos[j], "full": _r(full_obj[j]), "in_sample": _r(is_obj[j]), "out_of_sample": _r(oos_obj[j])})
    else:
        rows = [{"params": combos[j], "full": _r(full_obj[j])} for j in range(N)]
    out["grid"] = rows
    if N >= 2:
        out["pbo"] = pbo_cscv(R, blocks=10 if T >= 200 else 6, ppy=ppy)
    best_full = int(np.nanargmax(np.nan_to_num(full_obj, nan=-np.inf)))
    out["best_full_period"] = {"index": best_full, "params": combos[best_full], "objective": _r(full_obj[best_full])}
    out["deflated_sharpe"] = deflated_sharpe(R[:, best_full], [sharpe(R[:, j], ppy) for j in range(N)], ppy)
    if wf_folds:
        folds = walk_forward_folds(T, wf_folds, wf_mode)
        stitched = []
        fold_rows = []
        for (a, b, c, d) in folds:
            tr = [_objective(R[a:b, j], objective, ppy) for j in range(N)]
            pick = int(np.nanargmax(np.nan_to_num(tr, nan=-np.inf)))
            seg = R[c:d, pick]
            stitched.append(pd.Series(seg, index=idx[c:d]))
            fold_rows.append({
                "train": [idx[a].date().isoformat(), idx[b - 1].date().isoformat()],
                "test": [idx[c].date().isoformat(), idx[d - 1].date().isoformat()],
                "params": combos[pick],
                "train_sharpe": _r(sharpe(R[a:b, pick], ppy)), "test_sharpe": _r(sharpe(seg, ppy)),
                "test_return_pct": _r(_tot(seg) * 100),
            })
        if stitched:
            s = pd.concat(stitched)
            eq = initial * (1 + s.fillna(0)).cumprod()
            tr_sh = [f["train_sharpe"] for f in fold_rows if f["train_sharpe"] is not None]
            oos_sh = sharpe(s.to_numpy(), ppy)
            out["walk_forward"] = {
                "mode": wf_mode, "folds": fold_rows,
                "oos_sharpe": _r(oos_sh), "oos_total_return_pct": _r(_tot(s.to_numpy()) * 100),
                "mean_train_sharpe": _r(float(np.mean(tr_sh)) if tr_sh else None),
                "efficiency": _r(oos_sh / float(np.mean(tr_sh)) if tr_sh and abs(np.mean(tr_sh)) > 1e-9 else None),
                "equity": [{"date": d.date().isoformat(), "equity": round(float(v), 2)}
                           for d, v in eq.iloc[np.unique(np.linspace(0, len(eq) - 1, min(300, len(eq))).astype(int))].items()],
            }
    return out


def _tot(r: np.ndarray) -> float:
    r = r[np.isfinite(r)]
    return float(np.prod(1 + r) - 1) if len(r) else 0.0


def _r(v, n: int = 4):
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None
