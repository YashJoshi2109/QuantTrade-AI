"""Candidate forecasting models on daily log returns / log price.

Every model is a small stateful object with ``step(origin_data, refit)`` that
returns the cumulative log-return path for steps 1..H from that origin. Refits
re-estimate parameters on the training window; between refits the fitted
parameters are re-applied to the new window (Kalman filter / smoothing
recursion only). That is the usual "periodic re-estimation" walk-forward and
keeps a 100-origin evaluation to a few seconds. Parameters are only ever
estimated on data up to the current origin.

Models
- ``rw``      random walk: no change (the baseline every model must beat)
- ``drift``   random walk with drift: mean daily return of the window
- ``arima``   ARIMA(p,1,q) with drift = ARMA(p,q)+constant on returns
- ``sarimax`` ARMA(p,q)(P,0,0,5)+constant on returns with exogenous regressors
              known at the origin (see exog.py); one model per horizon
- ``ets``     simple or damped-trend exponential smoothing on log price
- ``ensemble`` equal-weight mean of drift, arima, sarimax and ets (equal
              weights: estimated combination weights rarely beat them)
Volatility: GJR-GARCH(1,1) with Student-t errors.
"""
from __future__ import annotations

import logging
import math
import time
import warnings
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from app.services.forecasting import exog as ex

logger = logging.getLogger(__name__)

ORDER_GRID_PQ = 2            # p, q in 0..2
SEASONAL_PERIOD = 5          # trading-day week
CANDIDATES = ("drift", "arima", "sarimax", "ets", "ensemble")
ENSEMBLE_MEMBERS = ("drift", "arima", "sarimax", "ets")


def _quiet():
    w = warnings.catch_warnings()
    w.__enter__()
    warnings.simplefilter("ignore")
    return w


def _sarimax(endog, exog, order, seasonal_order, validate: bool = True):
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    return SARIMAX(endog, exog=exog, order=order, seasonal_order=seasonal_order, trend="c",
                   enforce_stationarity=True, enforce_invertibility=True, concentrate_scale=True,
                   validate_specification=validate)


def _fit(model, start_params=None, maxiter: Optional[int] = None):
    """MLE fit without the (unused) parameter covariance. A warm start from the
    previous refit converges in a few iterations, so it gets a tighter cap."""
    if maxiter is None:
        maxiter = 15 if start_params is not None else 60
    w = _quiet()
    try:
        return model.fit(disp=False, start_params=start_params, maxiter=maxiter, cov_type="none")
    finally:
        w.__exit__(None, None, None)


# ── Order selection ─────────────────────────────────────────────────────────

def select_order(r: np.ndarray, X: Optional[np.ndarray], deadline: Optional[float] = None,
                 criterion: str = "bic") -> dict:
    """Bounded BIC grid over ARMA(p,q), p,q <= 2, then one seasonal AR(1) at lag 5.

    Stops at ``deadline`` (time.monotonic()) and keeps the best so far. Returns
    ``{"order", "seasonal_order", "criterion", "score", "tried", "budget_hit"}``.
    """
    best = {"order": (0, 0, 0), "seasonal_order": (0, 0, 0, 0), "score": math.inf}
    tried, budget_hit = 0, False
    grid = [(p, 0, q) for p in range(ORDER_GRID_PQ + 1) for q in range(ORDER_GRID_PQ + 1)]
    grid.sort(key=lambda o: o[0] + o[2])  # cheapest first, so a cut-off keeps simple models
    for order in grid:
        if deadline is not None and time.monotonic() > deadline and tried:
            budget_hit = True
            break
        try:
            res = _fit(_sarimax(r, X, order, (0, 0, 0, 0)), maxiter=80)
            score = float(getattr(res, criterion))
            tried += 1
            if np.isfinite(score) and score < best["score"]:
                best = {"order": order, "seasonal_order": (0, 0, 0, 0), "score": score}
        except Exception:
            tried += 1
    if not budget_hit and (deadline is None or time.monotonic() <= deadline):
        try:
            so = (1, 0, 0, SEASONAL_PERIOD)
            res = _fit(_sarimax(r, X, best["order"], so), maxiter=80)
            tried += 1
            score = float(getattr(res, criterion))
            if np.isfinite(score) and score < best["score"]:
                best = {"order": best["order"], "seasonal_order": so, "score": score}
        except Exception:
            tried += 1
    best.update(criterion=criterion.upper(), tried=tried, budget_hit=budget_hit)
    best["order"] = tuple(int(v) for v in best["order"])
    best["seasonal_order"] = tuple(int(v) for v in best["seasonal_order"])
    if not np.isfinite(best["score"]):
        best["score"] = None
    return best


def order_label(order: Sequence[int], seasonal_order: Sequence[int]) -> str:
    """Order in log-price terms: ARMA(p,q) on returns == ARIMA(p,1,q) on log price."""
    p, _, q = order
    s = f"({p},1,{q})"
    if seasonal_order and seasonal_order[3]:
        s += f"({seasonal_order[0]},0,{seasonal_order[2]},{seasonal_order[3]})"
    return s


# ── Data slices handed to models at each origin ─────────────────────────────

@dataclass
class OriginData:
    y: np.ndarray               # log prices of the training window, last = origin
    dates: pd.DatetimeIndex     # dates of y
    future_dates: list          # trading dates t+1..t+H
    raw_ext: Optional[pd.DataFrame]   # raw exog for the window plus 2*maxlag rows before it
    dates_ext: pd.DatetimeIndex       # dates of raw_ext (ends at origin)
    earnings: Optional[set]

    @property
    def r(self) -> np.ndarray:
        return 100 * np.diff(self.y)


# ── Models ──────────────────────────────────────────────────────────────────

class Drift:
    name = "drift"

    def step(self, d: OriginData, H: int, refit: bool) -> np.ndarray:
        mu = float(np.mean(np.diff(d.y)))
        return mu * np.arange(1, H + 1)


class _StateSpace:
    """Shared fit / update / persist logic for the SARIMAX-family models.

    Between refits the fitted results are NOT re-estimated: new bars are run
    through the Kalman filter with ``results.extend(new_endog, exog=new_exog)``
    (fixed parameters, state carried over). For serving, ``export`` keeps only
    what is needed to resume: parameters, the predicted state and covariance
    for the last fitted bar (the "anchor"), the fit-time scale and the exog
    column names. ``resume`` rebuilds a results object from that by filtering
    the bars from the anchor on with the known initial state, which is the same
    computation ``extend`` performs. No model object outlives a request.
    """

    name = "statespace"

    def __init__(self, order, seasonal_order):
        self.order, self.seasonal_order = tuple(order), tuple(seasonal_order)
        self.res = None
        self.last_date: Optional[pd.Timestamp] = None
        self.fit_scale: Optional[float] = None
        self._same_cols = True

    def _new_rows(self, d: "OriginData") -> np.ndarray:
        ret_dates = pd.DatetimeIndex(d.dates[1:])
        if self.last_date is None:
            return np.ones(len(ret_dates), dtype=bool)
        return np.asarray(ret_dates > self.last_date)

    def _update(self, d: "OriginData", refit: bool, X_hist):
        r = d.r
        if refit or self.res is None:
            start = self.res.params if (self.res is not None and self._same_cols) else None
            self.res = _fit(_sarimax(r, X_hist, self.order, self.seasonal_order), start)
            self.fit_scale = float(self.res.scale)
        else:
            mask = self._new_rows(d)
            if mask.any():
                Xn = None if X_hist is None else X_hist[mask]
                w = _quiet()
                try:
                    self.res = self.res.extend(r[mask], exog=Xn)
                finally:
                    w.__exit__(None, None, None)
        self.last_date = pd.Timestamp(d.dates[-1])
        return self.res

    def export(self) -> dict:
        res = self.res
        return {
            "params": [float(v) for v in np.asarray(res.params)],
            "state": [float(v) for v in res.predicted_state[:, -2]],
            "cov": np.asarray(res.predicted_state_cov[:, :, -2]).tolist(),
            "anchor": str(self.last_date.date()),
            "scale": self.fit_scale,
        }

    def _resume(self, stored: dict, d: "OriginData", X_hist) -> np.ndarray:
        """Rebuild results from ``stored`` and filter bars >= anchor. Returns the
        one-step standardized errors (vs the fit-time scale) of the bars after
        the anchor, for the drift check."""
        anchor = pd.Timestamp(stored["anchor"])
        ret_dates = pd.DatetimeIndex(d.dates[1:])
        mask = np.asarray(ret_dates >= anchor)
        if not mask.any() or ret_dates[mask][0] != anchor:
            raise ValueError("anchor bar not in window")
        Xn = None if X_hist is None else X_hist[mask]
        # a few new bars can make an exog dummy look constant; params are fixed, so skip that check
        mod = _sarimax(d.r[mask], Xn, self.order, self.seasonal_order, validate=False)
        mod.ssm.initialize_known(np.asarray(stored["state"], dtype=float), np.asarray(stored["cov"], dtype=float))
        w = _quiet()
        try:
            self.res = mod.filter(np.asarray(stored["params"], dtype=float))
        finally:
            w.__exit__(None, None, None)
        self.fit_scale = stored.get("scale")
        self.last_date = pd.Timestamp(d.dates[-1])
        e = np.asarray(self.res.forecasts_error[0])[1:]
        f = np.asarray(self.res.forecasts_error_cov[0, 0])[1:]
        scale = float(self.fit_scale or 1.0)
        return e / np.sqrt(np.maximum(f * scale, 1e-12))


class Arima(_StateSpace):
    """ARMA(p,q)+c on returns == ARIMA(p,1,q) with drift on log price."""

    name = "arima"

    def step(self, d: OriginData, H: int, refit: bool) -> np.ndarray:
        res = self._update(d, refit, None)
        return np.cumsum(np.asarray(res.forecast(H))) / 100

    def resume(self, stored: dict, d: OriginData) -> np.ndarray:
        return self._resume(stored, d, None)


class Sarimax(_StateSpace):
    """ARMA + exogenous regressors for ONE horizon h (lag-h market features)."""

    name = "sarimax"

    def __init__(self, h: int, order, seasonal_order, raw_columns: Sequence[str], earnings: bool):
        super().__init__(order, seasonal_order)
        self.h = h
        specs = ex.column_specs(raw_columns, lag=h, earnings=earnings and h <= ex.EARNINGS_KNOWN_AHEAD)
        self.specs_all = ex.columns_for_horizon(specs, h)
        self.specs: list[ex.ExogColumn] = list(self.specs_all)

    def design(self, d: OriginData, horizon: int):
        lag = self.h
        feats = ex.build_features(d.dates_ext, d.raw_ext, lag=lag, future_dates=d.future_dates[:horizon],
                                  earnings_sessions=d.earnings)
        n_hist = len(d.dates_ext)
        n_win = len(d.y) - 1  # returns in the window
        X_hist = feats.iloc[n_hist - n_win:n_hist]
        return feats, n_hist, X_hist

    def _matrix(self, X_hist):
        if not self.specs:
            return None
        X = X_hist[[c.name for c in self.specs]].to_numpy(dtype=float)
        if not np.all(np.isfinite(X)):
            raise ex.ExogLeakageError("missing exog in training window")
        return X

    def step(self, d: OriginData, H: int, refit: bool) -> np.ndarray:
        """Path for steps 1..H. H may not exceed this model's horizon: its
        lag-h features are not known further ahead (future_exog would raise)."""
        feats, n_hist, X_hist = self.design(d, H)
        if refit or self.res is None:
            # drop columns that are constant or missing in this window (singular design)
            keep = [c for c in self.specs_all
                    if np.all(np.isfinite(X_hist[c.name].to_numpy(dtype=float)))
                    and np.nanstd(X_hist[c.name].to_numpy(dtype=float)) > 1e-9]
            self._same_cols = [c.name for c in keep] == [c.name for c in self.specs]
            self.specs = keep
            refit = True
        res = self._update(d, refit, self._matrix(X_hist))
        fut = ex.future_exog(feats, n_hist, H, self.specs) if self.specs else None
        return np.cumsum(np.asarray(res.forecast(H, exog=fut))) / 100

    def export(self) -> dict:
        return {**super().export(), "cols": self.exog_names}

    def resume(self, stored: dict, d: OriginData) -> np.ndarray:
        by_name = {c.name: c for c in self.specs_all}
        if any(c not in by_name for c in stored.get("cols", [])):
            raise ValueError("stored exog columns no longer available")
        self.specs = [by_name[c] for c in stored.get("cols", [])]
        _, _, X_hist = self.design(d, 1)
        return self._resume(stored, d, self._matrix(X_hist))

    @property
    def exog_names(self) -> list[str]:
        return [c.name for c in self.specs]


class Ets:
    """Exponential smoothing on log price. Simple vs damped additive trend is
    chosen by AICc at the first fit; parameters are re-estimated at refits and
    run through the smoothing recursion in between."""

    name = "ets"

    def __init__(self):
        self.damped: Optional[bool] = None
        self.params: Optional[dict] = None

    def _fit(self, y):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        w = _quiet()
        try:
            if self.damped is None:
                a = ExponentialSmoothing(y, trend=None).fit(optimized=True)
                b = ExponentialSmoothing(y, trend="add", damped_trend=True).fit(optimized=True)
                self.damped = bool(b.aicc < a.aicc)
                res = b if self.damped else a
            elif self.damped:
                res = ExponentialSmoothing(y, trend="add", damped_trend=True).fit(optimized=True)
            else:
                res = ExponentialSmoothing(y, trend=None).fit(optimized=True)
        finally:
            w.__exit__(None, None, None)
        p = res.params
        self.params = {
            "alpha": float(p.get("smoothing_level", 1.0)),
            "beta": float(p.get("smoothing_trend", 0.0) or 0.0) if self.damped else 0.0,
            "phi": float(p.get("damping_trend", 0.0) or 0.0) if self.damped else 0.0,
        }

    def step(self, d: OriginData, H: int, refit: bool) -> np.ndarray:
        y = d.y
        if refit or self.params is None:
            self._fit(y)
        a, b_, phi = self.params["alpha"], self.params["beta"], self.params["phi"]
        level, trend = y[0], (y[1] - y[0]) if (self.damped and len(y) > 1) else 0.0
        for v in y[1:]:
            prev = level
            level = a * v + (1 - a) * (level + phi * trend)
            if self.damped:
                trend = b_ * (level - prev) + (1 - b_) * phi * trend
        steps = np.arange(1, H + 1)
        damp = np.cumsum(phi ** steps) if self.damped else np.zeros(H)
        return level + damp * trend - y[-1]


class Garch:
    """GJR-GARCH(1,1)-t on daily % returns -> std-dev of the cumulative log
    return for steps 1..H, clipped to 0.5x-2x of 1-year realised volatility."""

    name = "gjr-garch(1,1)-t"

    def __init__(self):
        self.params = None

    def step(self, d: OriginData, H: int, refit: bool) -> np.ndarray:
        r = d.r
        rv = float(np.std(r[-252:] / 100, ddof=1)) if len(r) > 20 else float(np.std(r / 100))
        steps = np.arange(1, H + 1)
        lo, hi = 0.5 * rv * np.sqrt(steps), 2.0 * rv * np.sqrt(steps)
        sig = None
        try:
            from arch import arch_model

            w = _quiet()
            try:
                am = arch_model(r, mean="Constant", vol="GARCH", p=1, o=1, q=1, dist="t", rescale=False)
                if refit or self.params is None:
                    res = am.fit(disp="off", show_warning=False,
                                 starting_values=self.params if self.params is not None else None)
                    self.params = np.asarray(res.params)
                else:
                    res = am.fix(self.params)
                var = np.asarray(res.forecast(horizon=H, reindex=False).variance.values[-1]) / 1e4
            finally:
                w.__exit__(None, None, None)
            if np.all(np.isfinite(var)) and np.all(var > 0):
                sig = np.sqrt(np.cumsum(var))
        except Exception as e:  # pragma: no cover - fallback
            logger.debug("GARCH failed (%s); EWMA fallback", e)
        if sig is None:
            rr = r / 100
            wts = 0.94 ** np.arange(len(rr))[::-1]
            sig = np.sqrt(float(np.sum(wts * rr ** 2) / np.sum(wts)) * steps)
        return np.clip(sig, lo, hi)


@dataclass
class ModelSet:
    """All candidate models for one ticker, sharing the selected ARMA order."""

    order: tuple
    seasonal_order: tuple
    horizons: tuple
    raw_columns: tuple
    earnings: bool
    drift: Drift = field(default_factory=Drift)
    ets: Ets = field(default_factory=Ets)
    garch: Garch = field(default_factory=Garch)
    arima: Arima = None
    sarimax: dict = None

    def __post_init__(self):
        self.arima = Arima(self.order, self.seasonal_order)
        self.sarimax = {h: Sarimax(h, self.order, self.seasonal_order, self.raw_columns, self.earnings)
                        for h in self.horizons}

    def paths(self, d: OriginData, H: int, refit: bool, horizons=None) -> dict:
        """Cumulative log-return paths per candidate. ``sarimax`` is a dict per
        horizon (each only valid up to its own h). Failures -> NaN path."""
        out: dict = {"rw": np.zeros(H)}
        for name, m in (("drift", self.drift), ("arima", self.arima), ("ets", self.ets)):
            try:
                out[name] = m.step(d, H, refit)
            except Exception as e:
                logger.debug("%s failed: %s", name, e)
                out[name] = np.full(H, np.nan)
        out["sarimax"] = {}
        for h in (horizons or self.horizons):
            try:
                out["sarimax"][h] = self.sarimax[h].step(d, h, refit)
            except ex.ExogLeakageError:
                raise
            except Exception as e:
                logger.debug("sarimax h=%d failed: %s", h, e)
                out["sarimax"][h] = np.full(min(H, h), np.nan)
        return out

    # ── Persisted serving state (params + last filter state; a few KB) ─────
    def export_state(self, fit_date: str, z_recent: Sequence[float] = ()) -> dict:
        sx = {}
        for h, m in self.sarimax.items():
            if m.res is not None:
                sx[str(h)] = m.export()
        return {
            "version": STATE_VERSION,
            "order": list(self.order), "seasonal_order": list(self.seasonal_order),
            "fit_date": fit_date,
            "arima": self.arima.export() if self.arima.res is not None else None,
            "sarimax": sx,
            "ets": {"damped": self.ets.damped, "params": self.ets.params},
            "garch": None if self.garch.params is None else [float(v) for v in self.garch.params],
            "z_recent": [float(v) for v in z_recent][-DRIFT_WINDOW:],
        }

    def resume_state(self, stored: dict, d: OriginData) -> np.ndarray:
        """Load stored params/state and Kalman-filter the bars since the anchor
        (no re-estimation). Returns the ARIMA one-step standardized errors of
        the new bars for the drift check. Raises ValueError if unusable."""
        if stored.get("version") != STATE_VERSION or not stored.get("arima"):
            raise ValueError("no usable state")
        z = self.arima.resume(stored["arima"], d)
        for h, m in self.sarimax.items():
            st = stored["sarimax"].get(str(h))
            if st is None:
                raise ValueError(f"no state for sarimax h={h}")
            m.resume(st, d)
        e = stored.get("ets") or {}
        if e.get("params") is None:
            raise ValueError("no ets params")
        self.ets.damped, self.ets.params = e["damped"], e["params"]
        if stored.get("garch") is not None:
            self.garch.params = np.asarray(stored["garch"], dtype=float)
        return z


STATE_VERSION = 1
DRIFT_WINDOW = 20      # rolling one-step errors kept for the drift check
DRIFT_MIN = 10         # need this many before the check can fire
DRIFT_Z2_LIMIT = 2.0   # mean squared standardized error; ~1.0 when the fit still describes the data


def drift_failed(z_recent: Sequence[float]) -> bool:
    """True when recent one-step errors are much larger than the fit expects
    (mean z^2 over the last DRIFT_WINDOW bars above DRIFT_Z2_LIMIT)."""
    z = np.asarray(list(z_recent)[-DRIFT_WINDOW:], dtype=float)
    z = z[np.isfinite(z)]
    return len(z) >= DRIFT_MIN and float(np.mean(z ** 2)) > DRIFT_Z2_LIMIT


def candidate_value(paths: dict, name: str, h: int) -> float:
    """Cumulative log return at step h for a candidate (ensemble computed here)."""
    if name == "rw":
        return 0.0
    if name == "sarimax":
        p = paths["sarimax"].get(h)
        return float(p[h - 1]) if p is not None and len(p) >= h else float("nan")
    if name == "ensemble":
        vals = [candidate_value(paths, m, h) for m in ENSEMBLE_MEMBERS]
        vals = [v for v in vals if np.isfinite(v)]
        return float(np.mean(vals)) if vals else float("nan")
    return float(paths[name][h - 1])
