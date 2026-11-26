"""Statistical price forecast: SARIMAX + baselines, GJR-GARCH bands, honest edge.

- Models (models.py): random walk, drift, ARIMA, SARIMAX with exogenous
  regressors known at forecast time (exog.py), ETS, equal-weight ensemble.
  Everything is modelled on daily log returns / log price, so price bands stay
  positive and asymmetric.
- Evaluation (evaluation.py): rolling-origin walk-forward per horizon
  (1, 5, 20, 60 trading days). The primary model is picked on the first half of
  the tests and judged on the second half against the random walk, with a
  Diebold-Mariano test (Holm-adjusted across horizons).
- Serving: a horizon is centred on the primary model ONLY when it has a
  statistically supported edge. Otherwise the range is centred on the random
  walk (no change) and the UI shows "no edge vs random walk". Band width =
  GJR-GARCH(1,1)-t volatility, scaled on the selection tests and checked for
  coverage on the holdout tests.
"""
from __future__ import annotations

import logging
import math
from typing import Iterable, Optional, Sequence

import numpy as np
import pandas as pd

from app.services.forecasting import evaluation as ev_mod
from app.services.forecasting import exog as ex
from app.services.forecasting.evaluation import (
    BAND_LEVELS, HORIZONS, N_ORIGINS, evaluate, min_history, model_label, t_q,
)
from app.services.forecasting.models import (
    ENSEMBLE_MEMBERS, Garch, ModelSet, OriginData, drift_failed,
)

logger = logging.getLogger(__name__)

DEFAULT_HORIZONS = HORIZONS
MIN_HISTORY = min_history(HORIZONS)
FIT_WINDOW = ev_mod.WINDOW
HISTORY_DAYS = 1260  # ~5 years: 504-day window + ~2 years of test origins + exog lags
REFIT_BARS = ev_mod.REFIT_EVERY * ev_mod.STEP  # re-estimate every 30 bars, as in the walk-forward


# ── Volatility (kept as a function for callers/tests) ───────────────────────

def horizon_sigma(log_returns: np.ndarray, H: int) -> np.ndarray:
    """Std-dev of the cumulative log return for steps 1..H (GJR-GARCH-t, clipped
    to 0.5x-2x of 1-year realised vol so one shock cannot blow up the bands)."""
    r = np.asarray(log_returns, dtype=float)
    r = r[np.isfinite(r)]
    y = np.concatenate([[0.0], np.cumsum(r)])
    d = OriginData(y=y, dates=pd.DatetimeIndex([]), future_dates=[], raw_ext=None,
                   dates_ext=pd.DatetimeIndex([]), earnings=None)
    return Garch().step(d, H, refit=True)


# ── Calendar ────────────────────────────────────────────────────────────────

def _nyse_calendar():
    """NYSE full-day closures (unlike the federal calendar: Good Friday closed,
    Columbus/Veterans Day open)."""
    from pandas.tseries.holiday import (
        AbstractHolidayCalendar, GoodFriday, Holiday, USLaborDay, USMartinLutherKingJr,
        USMemorialDay, USPresidentsDay, USThanksgivingDay, nearest_workday,
    )

    class NYSECalendar(AbstractHolidayCalendar):
        rules = [
            Holiday("NewYearsDay", month=1, day=1, observance=nearest_workday),
            USMartinLutherKingJr, USPresidentsDay, GoodFriday, USMemorialDay,
            Holiday("Juneteenth", month=6, day=19, start_date="2022-01-01", observance=nearest_workday),
            Holiday("IndependenceDay", month=7, day=4, observance=nearest_workday),
            USLaborDay, USThanksgivingDay,
            Holiday("Christmas", month=12, day=25, observance=nearest_workday),
        ]

    return NYSECalendar()


def _next_trading_days(last: pd.Timestamp, H: int) -> list[pd.Timestamp]:
    from pandas.tseries.offsets import CustomBusinessDay

    bday = CustomBusinessDay(calendar=_nyse_calendar())
    return list(pd.date_range(last + bday, periods=H, freq=bday))


# ── Public API ──────────────────────────────────────────────────────────────

def _value_at(paths: dict, name: str, k: int, bucket: int) -> float:
    """Cumulative log return at step k from candidate ``name``; SARIMAX uses
    the model fitted for horizon ``bucket`` (>= k)."""
    if name == "rw":
        return 0.0
    if name == "sarimax":
        p = paths["sarimax"].get(bucket)
        return float(p[k - 1]) if p is not None and len(p) >= k else float("nan")
    if name == "ensemble":
        vals = [_value_at(paths, m, k, bucket) for m in ENSEMBLE_MEMBERS]
        vals = [v for v in vals if np.isfinite(v)]
        return float(np.mean(vals)) if vals else float("nan")
    return float(paths[name][k - 1])


def _align_raw(raw: Optional[pd.DataFrame], dates: pd.DatetimeIndex) -> Optional[pd.DataFrame]:
    if raw is None or raw.empty:
        return None
    r = raw.copy()
    r.index = pd.to_datetime(r.index).tz_localize(None) if getattr(r.index, "tz", None) else pd.to_datetime(r.index)
    r = r[~r.index.duplicated(keep="last")].sort_index()
    # forward-fill only: a value is used on later days, never earlier ones
    r = r.reindex(r.index.union(dates)).ffill().reindex(dates)
    r = r.loc[:, r.notna().mean() > 0.5]
    return r if r.shape[1] else None


def forecast(close: pd.Series, raw: Optional[pd.DataFrame] = None,
             earnings_stamps: Optional[Iterable[pd.Timestamp]] = None,
             horizons: Sequence[int] = HORIZONS, evaluation: Optional[dict] = None,
             n_origins: int = N_ORIGINS, deadline: Optional[float] = None,
             state: Optional[dict] = None) -> dict:
    """Forecast a daily close series. Returns a JSON-serialisable dict.

    ``raw``: optional exog raw frame (columns mkt, sector, vix, tnx) indexed by
    date. ``earnings_stamps``: optional announcement timestamps (past and
    scheduled). ``evaluation``: a cached result of evaluation.evaluate for the
    same inputs; computed when missing (bounded by ``deadline``).
    """
    horizons = tuple(sorted(horizons))
    close = close.dropna()
    close = close[close > 0]
    need = min_history(horizons)
    if len(close) < need:
        raise ValueError(f"need at least {need} daily closes, got {len(close)}")
    close.index = pd.to_datetime(close.index)
    if getattr(close.index, "tz", None) is not None:
        close.index = close.index.tz_localize(None)
    dates = pd.DatetimeIndex(close.index)
    y = np.log(close.to_numpy(dtype=float))
    H = max(horizons)
    future = _next_trading_days(dates[-1], H)
    raw_a = _align_raw(raw, dates)
    earnings = None
    if earnings_stamps is not None:
        earnings = ex.earnings_sessions_from_timestamps(earnings_stamps, dates, future)

    ev = evaluation
    if ev is None:
        ev = evaluate(y, dates, raw_a, earnings, horizons, n_origins=n_origins, deadline=deadline,
                      future_dates=future)

    # Final fit on the latest window, with the order chosen in the evaluation.
    w = int(ev["window"])
    lead = 2 * H + 1
    ae = max(0, len(y) - w - lead)
    d = OriginData(y=y[-w:], dates=dates[-w:], future_dates=future,
                   raw_ext=None if raw_a is None else raw_a.iloc[ae:], dates_ext=dates[ae:], earnings=earnings)
    def new_set() -> ModelSet:
        return ModelSet(order=tuple(ev["order"]), seasonal_order=tuple(ev["seasonal_order"]), horizons=horizons,
                        raw_columns=tuple(raw_a.columns) if raw_a is not None else (), earnings=earnings is not None)

    # Serving update: with a stored state, new bars are only Kalman-filtered
    # (no re-estimation). Refit on schedule (REFIT_BARS), when the evaluated
    # order changed, when the state is unusable, or when the drift check fails.
    ms, reason, z_recent, fit_date = new_set(), None, [], str(dates[-1].date())
    if state is None:
        reason = "no stored state"
    elif list(state.get("order") or []) != list(ev["order"]) or \
            list(state.get("seasonal_order") or []) != list(ev["seasonal_order"]):
        reason = "order re-selected"
    elif int((dates > pd.Timestamp(state.get("fit_date", "1900-01-01"))).sum()) >= REFIT_BARS:
        reason = f"scheduled ({REFIT_BARS} bars since last fit)"
    else:
        try:
            z = ms.resume_state(state, d)
            z_recent = list(state.get("z_recent") or []) + [float(v) for v in z]
            if drift_failed(z_recent):
                reason, z_recent = "drift check failed (recent one-step errors too large)", []
            else:
                fit_date = state["fit_date"]
        except Exception as e:  # missing exog column, anchor fell out of window, ...
            reason = f"state unusable ({e})"[:120]
    if reason is not None:
        ms = new_set()
    refit = reason is not None
    paths = ms.paths(d, H, refit=refit)
    sigma = ms.garch.step(d, H, refit=refit)
    model_state = {"mode": "refit" if refit else "filtered", "refit_reason": reason, "fit_date": fit_date,
                   "bars_since_fit": int((dates > pd.Timestamp(fit_date)).sum()), "refit_every_bars": REFIT_BARS}
    new_state = ms.export_state(fit_date, z_recent)

    from scipy.stats import norm

    last_price = float(close.iloc[-1])
    evh = ev["horizons"]

    def bucket(k: int) -> int:
        return next(h for h in horizons if h >= k)

    def row(k: int, full: bool) -> dict:
        b = bucket(k)
        e = evh[str(b)]
        served = e.get("served") or "rw"
        mu = _value_at(paths, served, k, b)
        if not np.isfinite(mu):  # served model failed on the final fit: fall back to no change
            served, mu = "rw", 0.0
        s = float(sigma[k - 1])
        scale = float(e.get("band_scale") or 1.0) if ev.get("origins", 0) >= ev_mod.MIN_ORIGINS // 2 else 1.0
        bands = {}
        for lvl in BAND_LEVELS:
            half = scale * t_q(lvl) * s
            bands[str(lvl)] = [round(last_price * math.exp(mu - half), 2), round(last_price * math.exp(mu + half), 2)]
        out = {
            "h": k,
            "date": str(future[k - 1].date()),
            "point": round(last_price * math.exp(mu), 2),
            "exp_return_pct": round((math.exp(mu) - 1) * 100, 2),
            "prob_up": round(float(1 - norm.cdf(0, loc=mu, scale=max(s, 1e-9))), 3),
            "bands": bands,
            "sigma_log": round(s, 5),
        }
        if full:
            primary = e.get("primary")
            mp = _value_at(paths, primary, k, b) if primary else float("nan")
            out["model"] = {
                "primary": primary,
                "primary_label": model_label(primary, ev, b) if primary else None,
                "served": served,
                "served_label": model_label(served, ev, b),
                "centre": "model" if served != "rw" else "random_walk",
                "primary_exp_return_pct": round((math.exp(mp) - 1) * 100, 2) if np.isfinite(mp) else None,
                "exog": ms.sarimax[b].exog_names if primary in ("sarimax", "ensemble") else [],
                "why": e.get("why"),
            }
            out["eval"] = {key: e.get(key) for key in (
                "rel_mae", "rmse_ratio", "dm_stat", "dm_pvalue", "dm_pvalue_holm", "dir_acc", "dir_pvalue",
                "dir_binom_pvalue", "up_rate", "selection_origins", "holdout_origins", "effective_tests", "edge")}
            out["eval"]["coverage"] = e.get("band_coverage")
        return out

    def r(x, dd=3):
        return None if x is None or not np.isfinite(x) else round(float(x), dd)

    cand_names = ("rw", "drift", "arima", "sarimax", "ets", "ensemble")
    backtest = {
        "benchmark": ev_mod.BENCHMARK["name"],
        "origins": ev["origins"],
        "period": ev["period"],
        "step_days": ev["step"],
        "window_days": ev["window"],
        "refit_every_origins": ev["refit_every"],
        "budget_hit": ev["budget_hit"],
        "mase_vs_naive": {str(h): evh[str(h)].get("rel_mae") for h in horizons},
        "rmse_ratio": {str(h): evh[str(h)].get("rmse_ratio") for h in horizons},
        "dm_pvalue": {str(h): evh[str(h)].get("dm_pvalue") for h in horizons},
        "dm_pvalue_holm": {str(h): evh[str(h)].get("dm_pvalue_holm") for h in horizons},
        "directional_accuracy": {str(h): evh[str(h)].get("dir_acc") for h in horizons},
        "directional_pvalue": {str(h): evh[str(h)].get("dir_pvalue") for h in horizons},
        "band_coverage": {str(h): evh[str(h)].get("band_coverage") or {} for h in horizons},
        "band_scale": {str(h): evh[str(h)].get("band_scale") for h in horizons},
        "holdout_origins": {str(h): evh[str(h)].get("holdout_origins") for h in horizons},
        "effective_tests": {str(h): evh[str(h)].get("effective_tests") for h in horizons},
        "model_mae_logret": {str(h): {c: (evh[str(h)].get("candidates", {}).get(c) or {}).get("holdout_mae_logret")
                                      for c in cand_names} for h in horizons},
        "candidates_rel_mae": {str(h): {c: (evh[str(h)].get("candidates", {}).get(c) or {}).get("holdout_rel_mae")
                                        for c in cand_names} for h in horizons},
    }
    edges = {str(h): bool(evh[str(h)].get("edge")) for h in horizons}
    exog_used = {str(h): ms.sarimax[h].exog_names for h in horizons}
    result = {
        "benchmark": ev_mod.BENCHMARK,
        "as_of": str(dates[-1].date()),
        "last_close": round(last_price, 2),
        "horizons": [row(h, True) for h in horizons],
        "path": [row(k, False) for k in range(1, H + 1)],
        "model": {
            "family": "SARIMAX",
            "name": f"SARIMAX{ev['order_label']}",
            "order": [int(ev["order"][0]), 1, int(ev["order"][2])],  # on log price
            "returns_order": ev["order"],
            "seasonal_order": ev["seasonal_order"],
            "order_selection": ev["order_selection"],
            "exog_used": exog_used,
            "baselines": ["ARIMA(0,1,0) with drift", "ARIMA", "ETS", "equal-weight ensemble"],
            "volatility": "GJR-GARCH(1,1)-t",
        },
        "models": {  # legacy shape (#89 clients)
            "weights": {m: round(1 / len(ENSEMBLE_MEMBERS), 3) for m in ENSEMBLE_MEMBERS},
            "arima_order": [int(ev["order"][0]), 1, int(ev["order"][2])],
            "ets_damped_trend": bool(ev.get("ets_damped_trend")),
            "volatility": "GJR-GARCH(1,1)-t",
        },
        "vol_annualized_pct": round(float(sigma[0]) * math.sqrt(252) * 100, 1),
        "backtest": backtest,
        "beats_naive": edges,
        "evaluation_as_of": ev.get("as_of"),
        "method": (f"SARIMAX{ev['order_label']} on daily log returns with exogenous regressors known at "
                   "forecast time (calendar, lagged market/sector returns, VIX, rate changes, earnings dates), "
                   "compared in a walk-forward test with the ARIMA(0,1,0) random-walk benchmark, ARIMA(0,1,0) with drift, "
                   "ARIMA, ETS and an ensemble. "
                   "Ranges from GJR-GARCH(1,1)-t volatility."),
        "disclaimer": "Statistical projection, not investment advice. Stock prices are close to a random walk; "
                      "unless a horizon shows a tested edge, treat the range, not the line, as the forecast.",
    }
    result["model_state"] = model_state
    result["_state"] = new_state  # small: params + last filter state; the caller persists it
    if evaluation is None:  # freshly computed: hand it back so the caller can cache it
        result["_evaluation"] = ev
    return result
