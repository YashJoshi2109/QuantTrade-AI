"""Rolling-origin (walk-forward) evaluation with an honest edge rule.

Procedure, per ticker:

1. Origins every ``STEP`` (5) trading days over the last ~2 years. At each
   origin every model sees only the trailing ``window`` of data up to it.
   Parameters are re-estimated every ``REFIT_EVERY`` origins (20 trading days)
   and re-applied in between.
2. The ARMA order is chosen once, by BIC on the first training window, before
   any test outcome is seen.
3. Per horizon, the scored origins are split in time: the first half is the
   **selection** set, the second half the **holdout** set.
   - The *primary* model is the candidate (drift, ARIMA, SARIMAX, ETS,
     ensemble) with the lowest error on the selection set.
   - Interval scale (calibration of GARCH bands) is also set on the
     selection set.
   - Everything reported (error vs random walk, Diebold-Mariano, direction,
     interval coverage) is measured on the holdout set only.
4. A horizon has an **edge** only if, on the holdout set, the primary model's
   MAE is below the random walk's AND the one-sided Diebold-Mariano p-value,
   Holm-adjusted across the ticker's horizons, is below 0.05, AND there are at
   least ``MIN_EFFECTIVE_TESTS`` non-overlapping outcomes. Otherwise the
   served forecast is centred on the random walk and only the range is shown.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from app.services.forecasting import stats
from app.services.forecasting.models import (
    CANDIDATES, ModelSet, OriginData, candidate_value, order_label, select_order,
)
from app.services.forecasting import exog as ex

logger = logging.getLogger(__name__)

HORIZONS = (1, 5, 20, 60)
BAND_LEVELS = (50, 80, 95)
STEP = 5
N_ORIGINS = 100
WINDOW = 504
MIN_TRAIN = 150
MIN_ORIGINS = 30
REFIT_EVERY = 6   # re-estimate every 30 trading days; re-filter in between
EDGE_ALPHA = 0.05
MIN_EFFECTIVE_TESTS = 8
T_DF = 6
EVAL_VERSION = 1


def t_q(level: int) -> float:
    from scipy.stats import t as student_t

    return float(student_t.ppf(0.5 + level / 200, df=T_DF))


T_MEDIAN_ABS = 0.7176  # median |t_6|


def min_history(horizons: Sequence[int] = HORIZONS) -> int:
    return MIN_TRAIN + 2 * max(horizons) + 2 + (MIN_ORIGINS - 1) * STEP + 1


def plan_origins(n: int, horizons: Sequence[int] = HORIZONS, n_origins: int = N_ORIGINS,
                 step: int = STEP, window: int = WINDOW) -> tuple[list[int], int]:
    """Origins (indices into the price series) and the training-window length.

    Exog lags need 2*max(h)+1 rows before a window starts. Short histories get a
    shorter window (>= MIN_TRAIN) rather than no evaluation.
    """
    lead = 2 * max(horizons) + 1
    last = n - 2  # an origin needs at least one future close
    avail = last - lead  # index of the last origin minus the first usable row
    if avail < MIN_TRAIN + (MIN_ORIGINS - 1) * step:
        raise ValueError(f"need at least {min_history(horizons)} daily closes, got {n}")
    k = min(n_origins, (avail - MIN_TRAIN) // step + 1)
    w = min(window, avail - (k - 1) * step)
    first = last - (k - 1) * step
    return list(range(first, last + 1, step)), int(w)


def _origin_data(y, dates, ext_dates, raw, earnings, o, w, H, lead) -> OriginData:
    a = o - w + 1
    ae = max(0, a - lead)
    return OriginData(
        y=y[a:o + 1], dates=dates[a:o + 1], future_dates=list(ext_dates[o + 1:o + 1 + H]),
        raw_ext=None if raw is None else raw.iloc[ae:o + 1], dates_ext=dates[ae:o + 1],
        earnings=earnings,
    )


def _r(x, d=4):
    return None if x is None or not np.isfinite(x) else round(float(x), d)


def evaluate(y: np.ndarray, dates: pd.DatetimeIndex, raw: Optional[pd.DataFrame] = None,
             earnings: Optional[set] = None, horizons: Sequence[int] = HORIZONS,
             n_origins: int = N_ORIGINS, step: int = STEP, window: int = WINDOW,
             deadline: Optional[float] = None, future_dates: Sequence[pd.Timestamp] = ()) -> dict:
    """Walk-forward evaluation of all candidates. Returns a JSON-able dict.

    ``y`` = log closes, ``raw`` = exog raw frame aligned to ``dates`` (or None),
    ``future_dates`` = trading days after the last date (so late origins can
    still be given an exog calendar). ``deadline`` is a time.monotonic() bound;
    when it passes, remaining origins are skipped and the result says so.
    """
    t0 = time.monotonic()
    horizons = tuple(sorted(horizons))
    H = max(horizons)
    n = len(y)
    origins, w = plan_origins(n, horizons, n_origins, step, window)
    lead = 2 * H + 1
    ext_dates = pd.DatetimeIndex(dates).append(pd.DatetimeIndex(list(future_dates)))
    if len(ext_dates) < n + H:  # synthetic data without a calendar: business days
        extra = pd.bdate_range(ext_dates[-1] + pd.Timedelta(days=1), periods=n + H - len(ext_dates))
        ext_dates = ext_dates.append(extra)

    # 1. order selection on the first training window only (no test outcome seen)
    d0 = _origin_data(y, dates, ext_dates, raw, earnings, origins[0], w, 1, lead)
    feats0 = ex.build_features(d0.dates_ext, d0.raw_ext, lag=1, earnings_sessions=None)
    cal0 = feats0.iloc[len(d0.dates_ext) - (len(d0.y) - 1):][list(ex.CALENDAR_COLUMNS)]
    cal0 = cal0.loc[:, cal0.std() > 1e-9]
    sel_deadline = None if deadline is None else min(deadline, time.monotonic() + max(2.0, (deadline - t0) * 0.15))
    order_info = select_order(d0.r, cal0.to_numpy(dtype=float) if cal0.shape[1] else None, sel_deadline)

    ms = ModelSet(order=order_info["order"], seasonal_order=order_info["seasonal_order"],
                  horizons=horizons, raw_columns=tuple(raw.columns) if raw is not None else (),
                  earnings=earnings is not None)

    rec = {h: {"o": [], "actual": [], "sigma": [], **{c: [] for c in ("rw",) + CANDIDATES}} for h in horizons}
    done, budget_hit = 0, False
    for i, o in enumerate(origins):
        if deadline is not None and time.monotonic() > deadline:
            budget_hit = True
            break
        live = [h for h in horizons if o + h <= n - 1]
        if not live:
            continue
        d = _origin_data(y, dates, ext_dates, raw, earnings, o, w, H, lead)
        refit = i % REFIT_EVERY == 0
        paths = ms.paths(d, H, refit, horizons=live)
        sig = ms.garch.step(d, H, refit)
        for h in live:
            rr = rec[h]
            rr["o"].append(o)
            rr["actual"].append(float(y[o + h] - y[o]))
            rr["sigma"].append(float(sig[h - 1]))
            for c in ("rw",) + CANDIDATES:
                rr[c].append(candidate_value(paths, c, h))
        done += 1

    per_h: dict = {}
    dm_p: dict = {}
    for h in horizons:
        per_h[h] = _score_horizon(rec[h], h, step)
        dm_p[h] = per_h[h]["dm_pvalue"]
    adj = stats.holm({h: p for h, p in dm_p.items()})
    for h in horizons:
        e = per_h[h]
        e["dm_pvalue_holm"] = _r(adj.get(h, 1.0))
        e["edge"] = bool(
            e["primary"] is not None and e["rel_mae"] is not None and e["rel_mae"] < 1.0
            and adj.get(h, 1.0) < EDGE_ALPHA and (e["effective_tests"] or 0) >= MIN_EFFECTIVE_TESTS
        )
        served = "primary" if e["edge"] else "rw"
        e["served"] = e["primary"] if e["edge"] else "rw"
        e["band_scale"] = e["calibration"][served]["scale"]
        e["band_coverage"] = e["calibration"][served]["coverage"]
        e["why"] = _why(h, e, ms)

    sx = {h: ms.sarimax[h] for h in horizons}
    return {
        "version": EVAL_VERSION,
        "as_of": str(pd.Timestamp(dates[-1]).date()),
        "origins": done,
        "origins_planned": len(origins),
        "step": step,
        "window": w,
        "refit_every": REFIT_EVERY,
        "period": [str(pd.Timestamp(dates[origins[0]]).date()),
                   str(pd.Timestamp(dates[origins[max(0, done - 1)]]).date())] if done else [None, None],
        "budget_hit": budget_hit or bool(order_info.get("budget_hit")),
        "elapsed_s": round(time.monotonic() - t0, 2),
        "order": list(order_info["order"]),
        "seasonal_order": list(order_info["seasonal_order"]),
        "order_label": order_label(order_info["order"], order_info["seasonal_order"]),
        "order_selection": {"criterion": order_info["criterion"], "tried": order_info["tried"],
                            "score": _r(order_info.get("score"), 2)},
        "ets_damped_trend": bool(ms.ets.damped),
        "exog": {str(h): sx[h].exog_names for h in horizons},
        "horizons": {str(h): per_h[h] for h in horizons},
        "benchmark": BENCHMARK,
        "rules": {"edge_alpha": EDGE_ALPHA, "min_effective_tests": MIN_EFFECTIVE_TESTS,
                  "multiple_testing": "Holm across horizons", "split": "first half select, second half test"},
    }


def _score_horizon(rr: dict, h: int, step: int) -> dict:
    n = len(rr["actual"])
    act = np.asarray(rr["actual"])
    sig = np.maximum(np.asarray(rr["sigma"]), 1e-9)
    half = n // 2
    sel, hold = slice(0, half), slice(half, n)
    out: dict = {"h": h, "selection_origins": half, "holdout_origins": n - half,
                 "effective_tests": _r(stats.effective_n(n - half, h, step), 1)}

    def mae(c, s):
        e = np.abs(np.asarray(rr[c])[s] - act[s])
        return float(np.nanmean(e)) if np.isfinite(e).sum() >= max(3, 0.8 * len(e)) else float("nan")

    if half < 3 or n - half < 3:
        out.update(primary=None, rel_mae=None, rmse_ratio=None, dm_pvalue=1.0, dm_stat=None,
                   dir_acc=None, dir_pvalue=None, dir_binom_pvalue=None, up_rate=None,
                   candidates={}, calibration={k: {"scale": 1.0, "coverage": {}} for k in ("rw", "primary")})
        return out

    sel_mae = {c: mae(c, sel) for c in ("rw",) + CANDIDATES}
    ok = {c: v for c, v in sel_mae.items() if c != "rw" and np.isfinite(v)}
    primary = min(ok, key=ok.get) if ok else None
    hold_mae = {c: mae(c, hold) for c in ("rw",) + CANDIDATES}
    out["candidates"] = {c: {"selection_rel_mae": _r(sel_mae[c] / sel_mae["rw"]) if sel_mae["rw"] > 0 else None,
                             "holdout_rel_mae": _r(hold_mae[c] / hold_mae["rw"]) if hold_mae["rw"] > 0 else None,
                             "holdout_mae_logret": _r(hold_mae[c], 5)}
                         for c in ("rw",) + CANDIDATES}
    out["primary"] = primary
    if primary is None:
        out.update(rel_mae=None, rmse_ratio=None, dm_pvalue=1.0, dm_stat=None, dir_acc=None,
                   dir_pvalue=None, dir_binom_pvalue=None, up_rate=None)
    else:
        pred = np.asarray(rr[primary])
        e_p, e_0 = (pred - act)[hold], act[hold]
        rmse_p = math.sqrt(np.nanmean(e_p ** 2))
        rmse_0 = math.sqrt(np.mean(e_0 ** 2))
        dm = stats.diebold_mariano(e_p, e_0, h, step)
        pt = stats.pesaran_timmermann(pred[hold], act[hold], h, step)
        hits = int(round((pt["hit_rate"] or 0) * pt["n"]))
        out.update(
            rel_mae=_r(hold_mae[primary] / hold_mae["rw"]) if hold_mae["rw"] > 0 else None,
            rmse_ratio=_r(rmse_p / rmse_0) if rmse_0 > 0 else None,
            dm_stat=_r(dm["stat"], 3), dm_pvalue=_r(dm["pvalue"]),
            dir_acc=_r(pt["hit_rate"]), dir_pvalue=_r(pt["pvalue"]), up_rate=_r(pt["up_rate"]),
            dir_binom_pvalue=_r(stats.binomial_direction_p(hits, pt["n"], h, step)),
        )

    cal = {}
    for key, c in (("rw", "rw"), ("primary", primary or "rw")):
        z = np.abs(np.asarray(rr[c]) - act) / sig
        zs = z[sel][np.isfinite(z[sel])]
        # A scale estimated from a handful of independent outcomes (60-day windows
        # 5 days apart) is noise; keep the raw GARCH-t width there.
        enough = stats.effective_n(len(zs), h, step) >= MIN_EFFECTIVE_TESTS
        scale = float(np.clip(np.median(zs) / T_MEDIAN_ABS, 0.7, 1.6)) if len(zs) and enough else 1.0
        cal[key] = {"scale": round(scale, 3),
                    "coverage": {str(l): _r(stats.coverage(z[hold], scale * t_q(l)), 3) for l in BAND_LEVELS}}
    out["calibration"] = cal
    return out


# The benchmark everywhere (edge gate, MASE denominator, UI table) is
# ARIMA(0,1,0) on log price without drift, i.e. the random walk "no change"
# forecast. The drift variant is a candidate, not the benchmark.
BENCHMARK = {"key": "rw", "name": "ARIMA(0,1,0)",
             "description": "random walk on log price without drift (forecast = last close)"}
LABELS = {"rw": "ARIMA(0,1,0) random walk", "drift": "ARIMA(0,1,0) with drift", "arima": "ARIMA",
          "sarimax": "SARIMAX", "ets": "Exponential smoothing", "ensemble": "Equal-weight ensemble"}


def model_label(name: Optional[str], ev: dict, h: int) -> str:
    if name in ("arima", "sarimax"):
        base = f"{'SARIMAX' if name == 'sarimax' else 'ARIMA'}{ev.get('order_label', '')}"
        if name == "sarimax":
            n = len((ev.get("exog") or {}).get(str(h), []))
            base += f" + {n} exog" if n else ""
        else:
            base += " with drift (MLE)"  # never confused with the ARIMA(0,1,0) benchmark
        return base
    if name == "ets":
        return "ETS (damped trend)" if ev.get("ets_damped_trend") else "ETS (simple)"
    return LABELS.get(name or "rw", name or LABELS["rw"])


def _why(h: int, e: dict, ms: ModelSet) -> str:
    p = e.get("primary")
    if p is None:
        return "Too few walk-forward tests to compare models; the range is centred on no change."
    cand = e["candidates"].get(p, {})
    sel = cand.get("selection_rel_mae")
    parts = [f"{LABELS.get(p, p)} had the lowest error on the first {e['selection_origins']} tests"
             + (f" ({sel:.2f}x ARIMA(0,1,0))." if sel is not None else ".")]
    rm, pv = e.get("rel_mae"), e.get("dm_pvalue_holm")
    if rm is not None:
        parts.append(f"On the next {e['holdout_origins']} tests it scored {rm:.2f}x the error of ARIMA(0,1,0), the random walk"
                     f" (Diebold-Mariano p={pv:.2f}, Holm-adjusted).")
    if e["edge"]:
        parts.append("That is a statistically supported edge, so its forecast centres the range.")
    elif (e.get("effective_tests") or 0) < MIN_EFFECTIVE_TESTS:
        parts.append(f"Only ~{e.get('effective_tests')} independent {h}-day outcomes were tested, too few to claim an edge;"
                     " the range is centred on no change.")
    else:
        parts.append("That is no edge over ARIMA(0,1,0), so the range is centred on no change.")
    return " ".join(parts)
