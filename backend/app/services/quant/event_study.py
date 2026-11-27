"""Market-model event study (Campbell, Lo & MacKinlay 1997, ch. 4;
MacKinlay 1997, "Event Studies in Economics and Finance").

For event i with day 0 at trading-day index tau0:
* estimation window: L1 days ending ``gap`` days before the event window,
  i.e. days [pre - gap - L1, pre - gap - 1] relative to day 0;
* market model: R_it = a_i + b_i R_mt + e_it, OLS on the estimation window,
  sigma_e^2 = SSR / (L1 - 2);
* abnormal return AR_it = R_it - (a_i + b_i R_mt) on the event window
  [pre, post]; CAR_i = sum of AR_it over the window (L2 = post - pre + 1 days);
* Var(CAR_i) = sigma_e^2 * 1'(I + X*(X'X)^-1 X*')1 (includes the estimation
  error of a_i, b_i); SCAR_i = CAR_i / sqrt(Var(CAR_i)).

Tests across N events
* cross-sectional t: mean(CAR) / (std(CAR, ddof=1) / sqrt(N)), t(N-1);
* CLM J1 = mean(CAR) / sqrt(sum Var(CAR_i) / N^2) ~ N(0,1);
* CLM J2 = sqrt(N (L1 - 4) / (L1 - 2)) * mean(SCAR) ~ N(0,1);
* sign test: number of positive CARs ~ Binomial(N, 0.5) under H0 (exact);
* positive vs negative EPS-surprise groups: Welch two-sample t on CARs.

Day 0 is the first session in which the market could trade on the news:
the announcement date for a pre-market / intraday release, the next trading
day for an after-close release. When the release time is unknown day 0 is
the announcement date and this is flagged.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd
from scipy import stats as sst


def day_zero(index: pd.DatetimeIndex, announce: str, timing: Optional[str]) -> Optional[int]:
    """Position of day 0 in a sorted trading-day index."""
    d = pd.Timestamp(announce[:10])
    if timing == "amc":
        pos = int(index.searchsorted(d, side="right"))     # first session after the date
    else:
        pos = int(index.searchsorted(d, side="left"))      # the date itself or the next session
    return pos if pos < len(index) else None


def market_model_event(ri: np.ndarray, rm: np.ndarray, tau0: int, pre: int, post: int,
                       est_len: int, gap: int) -> Dict[str, object]:
    """One event. ri / rm are aligned simple daily returns; tau0 = day-0 position."""
    w0, w1 = tau0 + pre, tau0 + post
    e1 = w0 - gap                      # exclusive end of the estimation window
    e0 = e1 - est_len
    if e0 < 0:
        raise ValueError(f"needs {est_len} estimation days before the event window; only {max(e1, 0)} available")
    if w1 >= len(ri):
        raise ValueError("event window extends past the last available bar")
    y, x = ri[e0:e1], rm[e0:e1]
    X = np.column_stack([np.ones(est_len), x])
    xtx_inv = np.linalg.inv(X.T @ X)
    a, b = xtx_inv @ X.T @ y
    resid = y - (a + b * x)
    s2 = float(resid @ resid) / (est_len - 2)
    xs = np.column_stack([np.ones(w1 - w0 + 1), rm[w0:w1 + 1]])
    ar = ri[w0:w1 + 1] - (a + b * rm[w0:w1 + 1])
    V = s2 * (np.eye(len(ar)) + xs @ xtx_inv @ xs.T)
    var_car = float(np.ones(len(ar)) @ V @ np.ones(len(ar)))
    car = float(ar.sum())
    return {"alpha": float(a), "beta": float(b), "sigma_e": math.sqrt(s2), "ar": ar,
            "car": car, "var_car": var_car, "scar": car / math.sqrt(var_car),
            "raw_return": float(np.prod(1 + ri[w0:w1 + 1]) - 1),
            "estimation_start_pos": e0, "estimation_end_pos": e1 - 1, "window_start_pos": w0, "window_end_pos": w1}


def group_tests(cars: Sequence[float], var_cars: Sequence[float], scars: Sequence[float],
                est_len: int) -> Dict[str, Optional[float]]:
    c = np.asarray(cars, float)
    n = len(c)
    out: Dict[str, Optional[float]] = {"n": n}
    if n == 0:
        return out
    out["mean_car"] = float(c.mean())
    out["median_car"] = float(np.median(c))
    pos = int((c > 0).sum())
    out["positive"] = pos
    bt2 = sst.binomtest(pos, n, 0.5, alternative="two-sided")
    bt1 = sst.binomtest(pos, n, 0.5, alternative="greater")
    out["sign_test_p_two_sided"] = float(bt2.pvalue)
    out["sign_test_p_greater"] = float(bt1.pvalue)
    if n >= 2:
        sd = float(c.std(ddof=1))
        out["std_car"] = sd
        if sd > 0:
            t = float(c.mean() / (sd / math.sqrt(n)))
            out["t_stat"] = t
            out["p_two_sided"] = float(2 * sst.t.sf(abs(t), n - 1))
            out["p_greater"] = float(sst.t.sf(t, n - 1))
        j1 = float(c.mean() / math.sqrt(float(np.sum(var_cars)) / n ** 2))
        out["j1"] = j1
        out["j1_p_two_sided"] = float(2 * sst.norm.sf(abs(j1)))
        j2 = float(math.sqrt(n * (est_len - 4) / (est_len - 2)) * float(np.mean(scars)))
        out["j2"] = j2
        out["j2_p_two_sided"] = float(2 * sst.norm.sf(abs(j2)))
    return out


def welch(a: Sequence[float], b: Sequence[float]) -> Optional[Dict[str, float]]:
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 2 or len(b) < 2:
        return None
    res = sst.ttest_ind(a, b, equal_var=False)
    return {"mean_difference": float(a.mean() - b.mean()), "t_stat": float(res.statistic),
            "p_two_sided": float(res.pvalue)}


def run_event_study(stock: pd.Series, market: pd.Series, events: List[Dict[str, object]],
                    pre: int = -2, post: int = 2, est_len: int = 120, gap: int = 10) -> Dict[str, object]:
    """stock / market: adjusted close series. events: dicts with ``date``
    (YYYY-MM-DD), ``timing`` (bmo / amc / dmh / None), ``eps_actual``,
    ``eps_estimate``. Returns per-event rows and test statistics."""
    if pre > 0 or post < 0:
        raise ValueError("event window must contain day 0 (pre <= 0 <= post)")
    px = pd.concat([stock.rename("s"), market.rename("m")], axis=1, join="inner").dropna()
    ret = px.pct_change().dropna()
    idx = ret.index
    ri, rm = ret["s"].to_numpy(float), ret["m"].to_numpy(float)
    rows, skipped = [], []
    for ev in events:
        date = str(ev.get("date"))[:10]
        timing = ev.get("timing")
        tau0 = day_zero(idx, date, timing if isinstance(timing, str) else None)
        if tau0 is None:
            skipped.append({"date": date, "reason": "no trading day on/after the announcement in the data"})
            continue
        try:
            res = market_model_event(ri, rm, tau0, pre, post, est_len, gap)
        except ValueError as e:
            skipped.append({"date": date, "reason": str(e)})
            continue
        act, est = ev.get("eps_actual"), ev.get("eps_estimate")
        surprise = None
        if isinstance(act, (int, float)) and isinstance(est, (int, float)):
            surprise = "positive" if act > est else "negative" if act < est else "zero"
        rows.append({
            "announcement_date": date, "timing": timing or "unknown",
            "day0": idx[tau0].date().isoformat(),
            "window": [idx[res["window_start_pos"]].date().isoformat(), idx[res["window_end_pos"]].date().isoformat()],
            "estimation_window": [idx[res["estimation_start_pos"]].date().isoformat(),
                                  idx[res["estimation_end_pos"]].date().isoformat()],
            "alpha": res["alpha"], "beta": res["beta"], "sigma_e": res["sigma_e"],
            "ar_by_day": {str(pre + k): float(v) for k, v in enumerate(res["ar"])},
            "car": res["car"], "car_se": math.sqrt(res["var_car"]), "scar": res["scar"],
            "car_p_two_sided": float(2 * sst.norm.sf(abs(res["scar"]))),
            "raw_return": res["raw_return"],
            "eps_actual": act, "eps_estimate": est, "surprise_pct": ev.get("surprise_pct"),
            "surprise_sign": surprise, "_var_car": res["var_car"],
        })

    def tests(rs):
        return group_tests([x["car"] for x in rs], [x["_var_car"] for x in rs], [x["scar"] for x in rs], est_len)

    pos = [x for x in rows if x["surprise_sign"] == "positive"]
    neg = [x for x in rows if x["surprise_sign"] in ("negative", "zero")]
    days = list(range(pre, post + 1))
    aar = {}
    for d in days:
        vals = np.array([x["ar_by_day"][str(d)] for x in rows], float)
        if len(vals):
            sd = float(vals.std(ddof=1)) if len(vals) > 1 else float("nan")
            t = float(vals.mean() / (sd / math.sqrt(len(vals)))) if len(vals) > 1 and sd > 0 else None
            aar[str(d)] = {"aar": float(vals.mean()), "t_stat": t,
                           "p_two_sided": float(2 * sst.t.sf(abs(t), len(vals) - 1)) if t is not None else None}
    out = {
        "events": rows, "skipped": skipped,
        "all": tests(rows), "positive_surprise": tests(pos), "negative_or_zero_surprise": tests(neg),
        "positive_minus_negative": welch([x["car"] for x in pos], [x["car"] for x in neg]),
        "aar_by_day": aar,
    }
    for x in rows:
        x.pop("_var_car", None)
    return out
