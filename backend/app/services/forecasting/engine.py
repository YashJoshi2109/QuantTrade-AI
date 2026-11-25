"""Statistical price forecasting: ARIMA/ETS/Theta/drift ensemble + GJR-GARCH bands.

Design (see docs in the PR):
- Everything is modelled on LOG price, so the h-step change is a log return and
  price bands stay positive and asymmetric.
- Point forecast = weighted mean of non-naive models; weights come from each
  model's walk-forward error, shrunk toward equal weights (forecast-combination
  evidence: simple averages are hard to beat, so weights are kept tame).
- Band width = GJR-GARCH(1,1)-t volatility, then *calibrated* with the
  standardized errors observed in the walk-forward backtest, so an "80% band"
  really contained ~80% of past outcomes.
- Every result ships with out-of-sample metrics versus the naive (random-walk)
  forecast. At 1-20 day horizons stock prices are close to a random walk; the
  honest product is the range, and `beats_naive` says whether the point path
  adds anything.

No look-ahead: each backtest origin fits only on data up to that origin. No
exogenous regressors (same-day market data would not be known at forecast time).
"""
from __future__ import annotations

import logging
import math
import warnings
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

DEFAULT_HORIZONS = (1, 5, 20)
BAND_LEVELS = (50, 80, 95)
MIN_HISTORY = 160              # ~8 months of trading days
FIT_WINDOW = 504               # ~2 years: enough for order selection, cheap to fit
MODEL_NAMES = ("arima", "ets", "theta", "drift")


# ── Individual models: each returns the log-price path for steps 1..H ─────────

def _fc_naive(y: np.ndarray, H: int, _state: dict) -> np.ndarray:
    return np.full(H, y[-1])


def _fc_drift(y: np.ndarray, H: int, _state: dict) -> np.ndarray:
    n = len(y)
    slope = (y[-1] - y[0]) / (n - 1) if n > 1 else 0.0
    return y[-1] + slope * np.arange(1, H + 1)


def _aicc(res, n: int) -> float:
    k = len(res.params)
    return res.aic + (2 * k * (k + 1)) / max(n - k - 1, 1)


def select_arima_order(y: np.ndarray, max_pq: int = 2) -> tuple[int, int, int]:
    """Small AICc grid over ARIMA(p,1,q) with drift — log prices are I(1)."""
    from statsmodels.tsa.arima.model import ARIMA

    best, best_order = math.inf, (0, 1, 0)
    for p in range(max_pq + 1):
        for q in range(max_pq + 1):
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    res = ARIMA(y, order=(p, 1, q), trend="t").fit()
                score = _aicc(res, len(y))
                if score < best:
                    best, best_order = score, (p, 1, q)
            except Exception:  # non-invertible / failed optimisation
                continue
    return best_order


def _fc_arima(y: np.ndarray, H: int, state: dict) -> np.ndarray:
    from statsmodels.tsa.arima.model import ARIMA

    order = state.get("arima_order") or select_arima_order(y)
    state["arima_order"] = order
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = ARIMA(y, order=order, trend="t").fit()
    return np.asarray(res.forecast(H))


def _fc_ets(y: np.ndarray, H: int, state: dict) -> np.ndarray:
    """Additive ETS on log price: simple vs damped-trend, chosen by AIC once."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    def fit(damped: bool):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if damped:
                return ExponentialSmoothing(y, trend="add", damped_trend=True).fit(optimized=True)
            return ExponentialSmoothing(y, trend=None).fit(optimized=True)

    if "ets_damped" not in state:
        try:
            a, b = fit(False), fit(True)
            state["ets_damped"] = b.aicc < a.aicc
            res = b if state["ets_damped"] else a
        except Exception:
            state["ets_damped"] = False
            res = fit(False)
    else:
        res = fit(state["ets_damped"])
    return np.asarray(res.forecast(H))


def _fc_theta(y: np.ndarray, H: int, _state: dict) -> np.ndarray:
    from statsmodels.tsa.forecasting.theta import ThetaModel

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = ThetaModel(y, period=1, deseasonalize=False).fit()
    return np.asarray(res.forecast(H))


MODELS: dict[str, Callable[[np.ndarray, int, dict], np.ndarray]] = {
    "naive": _fc_naive,
    "drift": _fc_drift,
    "arima": _fc_arima,
    "ets": _fc_ets,
    "theta": _fc_theta,
}


# ── Volatility ──────────────────────────────────────────────────────────────

def horizon_sigma(log_returns: np.ndarray, H: int) -> np.ndarray:
    """Std-dev of the cumulative log return for steps 1..H.

    GJR-GARCH(1,1)-t (EWMA fallback), clipped to 0.5x-2x of the 1-year realised
    volatility so a single shock (e.g. NVDA -15% then +27% on consecutive days)
    can't push bands to absurd widths, nor a calm spell collapse them.
    """
    r = np.asarray(log_returns, dtype=float)
    r = r[np.isfinite(r)]
    rv = float(np.std(r[-252:], ddof=1)) if len(r) > 20 else float(np.std(r))
    steps = np.arange(1, H + 1)
    lo, hi = 0.5 * rv * np.sqrt(steps), 2.0 * rv * np.sqrt(steps)
    return np.clip(_raw_sigma(r, H), lo, hi)


def _raw_sigma(r: np.ndarray, H: int) -> np.ndarray:
    try:
        from arch import arch_model

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            am = arch_model(r * 100, mean="Constant", vol="GARCH", p=1, o=1, q=1, dist="t", rescale=False)
            res = am.fit(disp="off", show_warning=False)
            var = np.asarray(res.forecast(horizon=H, reindex=False).variance.values[-1]) / 1e4
        if np.all(np.isfinite(var)) and np.all(var > 0):
            return np.sqrt(np.cumsum(var))
    except Exception as e:  # pragma: no cover - fallback path
        logger.debug("GARCH failed (%s); using EWMA", e)
    lam = 0.94
    w = lam ** np.arange(len(r))[::-1]
    daily_var = float(np.sum(w * r ** 2) / np.sum(w))
    return np.sqrt(daily_var * np.arange(1, H + 1))


# ── Backtest ────────────────────────────────────────────────────────────────

@dataclass
class Backtest:
    origins: int = 0
    start: Optional[str] = None
    end: Optional[str] = None
    # per horizon
    mae: dict[int, dict[str, float]] = field(default_factory=dict)       # model -> MAE of log return
    mase: dict[int, float] = field(default_factory=dict)                 # ensemble MAE / naive MAE
    dir_acc: dict[int, float] = field(default_factory=dict)
    dir_pvalue: dict[int, float] = field(default_factory=dict)
    coverage: dict[int, dict[int, float]] = field(default_factory=dict)  # h -> level -> share inside band
    band_scale: dict[int, float] = field(default_factory=dict)  # robust multiplier on Student-t bands
    weights: dict[str, float] = field(default_factory=dict)


T_DF = 6  # fat-tailed bands


def _t_q(level: int) -> float:
    from scipy.stats import t as student_t
    return float(student_t.ppf(0.5 + level / 200, df=T_DF))


T_MEDIAN_ABS = 0.7176  # median of |t_6| = t_6.ppf(0.75)


def _binom_two_sided_p(k: int, n: int) -> float:
    if n == 0:
        return 1.0
    from scipy.stats import binomtest

    return float(binomtest(k, n, 0.5).pvalue)


def ensemble_weights(mae_by_model: dict[str, float], shrink: float = 0.5,
                     lo: float = 0.05, hi: float = 0.6) -> dict[str, float]:
    """Inverse-MAE weights shrunk 50% toward equal, clipped, renormalised."""
    names = [m for m in MODEL_NAMES if m in mae_by_model and np.isfinite(mae_by_model[m]) and mae_by_model[m] > 0]
    if not names:
        return {m: 1 / len(MODEL_NAMES) for m in MODEL_NAMES}
    inv = np.array([1 / mae_by_model[m] for m in names])
    w = (1 - shrink) * inv / inv.sum() + shrink / len(names)
    w = np.clip(w, lo, hi)
    w = w / w.sum()
    return {m: float(v) for m, v in zip(names, w)}


def walk_forward(y: np.ndarray, dates: pd.DatetimeIndex, horizons=DEFAULT_HORIZONS,
                 n_origins: int = 40, step: int = 5, window: int = FIT_WINDOW) -> Backtest:
    """Rolling-origin evaluation. Model orders are chosen once on the first
    training window (cheap); parameters are refit at every origin on data up to
    that origin only."""
    H = max(horizons)
    n = len(y)
    last_origin = n - H - 1
    first_origin = max(MIN_HISTORY, last_origin - (n_origins - 1) * step)
    origins = list(range(first_origin, last_origin + 1, step))
    bt = Backtest(origins=len(origins))
    if not origins:
        return bt
    bt.start, bt.end = str(dates[origins[0]].date()), str(dates[origins[-1]].date())

    state: dict = {}
    errs = {h: {m: [] for m in MODELS} for h in horizons}
    preds = {h: {m: [] for m in MODELS} for h in horizons}
    actual = {h: [] for h in horizons}
    sig = {h: [] for h in horizons}
    logret = np.diff(y)

    for o in origins:
        train = y[max(0, o + 1 - window): o + 1]
        a = y[o + 1: o + 1 + H] - y[o]  # realised cumulative log returns
        s = horizon_sigma(logret[max(0, o - window): o], H)
        for name, fn in MODELS.items():
            try:
                path = fn(train, H, state) - y[o]
            except Exception:
                path = np.full(H, np.nan)
            for h in horizons:
                preds[h][name].append(path[h - 1])
                errs[h][name].append(abs(path[h - 1] - a[h - 1]))
        for h in horizons:
            actual[h].append(a[h - 1])
            sig[h].append(s[h - 1])

    # Weights from the longest horizon's errors (the one users care about most)
    mae_main = {m: float(np.nanmean(errs[max(horizons)][m])) for m in MODEL_NAMES}
    bt.weights = ensemble_weights(mae_main)

    for h in horizons:
        bt.mae[h] = {m: float(np.nanmean(errs[h][m])) for m in MODELS}
        ens = np.nansum([bt.weights.get(m, 0) * np.asarray(preds[h][m]) for m in bt.weights], axis=0)
        act = np.asarray(actual[h])
        naive_mae = float(np.mean(np.abs(act)))  # naive predicts 0 change
        ens_mae = float(np.mean(np.abs(ens - act)))
        bt.mase[h] = ens_mae / naive_mae if naive_mae > 0 else float("nan")
        nz = act != 0
        hits = int(np.sum(np.sign(ens[nz]) == np.sign(act[nz])))
        bt.dir_acc[h] = hits / int(nz.sum()) if nz.any() else float("nan")
        bt.dir_pvalue[h] = _binom_two_sided_p(hits, int(nz.sum()))
        z = np.abs(ens - act) / np.maximum(np.asarray(sig[h]), 1e-9)
        # One robust scale from the median |z| (a 95th percentile from ~40 origins
        # is just the 2nd-largest error — far too noisy to calibrate on).
        scale = float(np.median(z) / T_MEDIAN_ABS) if len(z) else 1.0
        bt.band_scale[h] = float(np.clip(scale, 0.7, 1.6))
        bt.coverage[h] = {
            lvl: float(np.mean(z <= bt.band_scale[h] * _t_q(lvl))) for lvl in BAND_LEVELS
        }
    return bt


# ── Public API ──────────────────────────────────────────────────────────────

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


def forecast(close: pd.Series, horizons=DEFAULT_HORIZONS, n_origins: int = 40) -> dict:
    """Forecast a daily close series. Returns a JSON-serialisable dict."""
    close = close.dropna()
    close = close[close > 0]
    if len(close) < MIN_HISTORY + max(horizons) + 10:
        raise ValueError(f"need at least {MIN_HISTORY + max(horizons) + 10} daily closes, got {len(close)}")
    close.index = pd.to_datetime(close.index)
    y_all = np.log(close.to_numpy(dtype=float))
    dates = close.index
    H = max(horizons)

    bt = walk_forward(y_all, dates, horizons, n_origins=n_origins)

    y = y_all[-FIT_WINDOW:]
    state: dict = {}
    paths: dict[str, np.ndarray] = {}
    for name in MODEL_NAMES:
        try:
            paths[name] = MODELS[name](y, H, state) - y[-1]
        except Exception as e:
            logger.warning("forecast model %s failed: %s", name, e)
    weights = {m: w for m, w in bt.weights.items() if m in paths}
    tot = sum(weights.values()) or 1.0
    weights = {m: w / tot for m, w in weights.items()}
    mean_path = np.sum([weights[m] * paths[m] for m in weights], axis=0)
    sigma = horizon_sigma(np.diff(y_all[-FIT_WINDOW - 1:]), H)

    from scipy.stats import norm

    last_price = float(close.iloc[-1])
    future_dates = _next_trading_days(dates[-1], H)

    def band_mult(h: int, lvl: int) -> float:
        scale = bt.band_scale.get(h, 1.0) if bt.origins >= 20 else 1.0
        return scale * _t_q(lvl)

    def horizon_rows(hs) -> list[dict]:
        rows = []
        for h in hs:
            mu, s = float(mean_path[h - 1]), float(sigma[h - 1])
            bands = {}
            for lvl in BAND_LEVELS:
                k = band_mult(h, lvl) * s
                bands[str(lvl)] = [round(last_price * math.exp(mu - k), 2), round(last_price * math.exp(mu + k), 2)]
            rows.append({
                "h": h,
                "date": str(future_dates[h - 1].date()),
                "point": round(last_price * math.exp(mu), 2),
                "exp_return_pct": round((math.exp(mu) - 1) * 100, 2),
                "prob_up": round(float(1 - norm.cdf(0, loc=mu, scale=max(s, 1e-9))), 3),
                "bands": bands,
                "sigma_log": round(s, 5),
            })
        return rows

    def r(x, d=3):
        return None if x is None or not np.isfinite(x) else round(float(x), d)

    beats = {h: (bt.mase.get(h, math.inf) < 0.98 and bt.dir_pvalue.get(h, 1) < 0.1) for h in horizons}
    return {
        "as_of": str(dates[-1].date()),
        "last_close": round(last_price, 2),
        "horizons": horizon_rows(horizons),
        "path": horizon_rows(range(1, H + 1)),
        "models": {
            "weights": {m: round(w, 3) for m, w in weights.items()},
            "arima_order": list(state.get("arima_order") or []),
            "ets_damped_trend": bool(state.get("ets_damped", False)),
            "volatility": "GJR-GARCH(1,1)-t",
        },
        "vol_annualized_pct": round(float(sigma[0]) * math.sqrt(252) * 100, 1),
        "backtest": {
            "origins": bt.origins,
            "period": [bt.start, bt.end],
            "mase_vs_naive": {str(h): r(v) for h, v in bt.mase.items()},
            "directional_accuracy": {str(h): r(v) for h, v in bt.dir_acc.items()},
            "directional_pvalue": {str(h): r(v) for h, v in bt.dir_pvalue.items()},
            "band_coverage": {str(h): {str(l): r(c) for l, c in v.items()} for h, v in bt.coverage.items()},
            "band_scale": {str(h): r(v) for h, v in bt.band_scale.items()},
            "model_mae_logret": {str(h): {m: r(e, 5) for m, e in v.items()} for h, v in bt.mae.items()},
        },
        "beats_naive": {str(h): bool(v) for h, v in beats.items()},
        "method": "Ensemble of ARIMA, ETS, Theta and drift on log price; bands from GJR-GARCH-t "
                  "volatility calibrated on walk-forward errors.",
        "disclaimer": "Statistical projection, not investment advice. At 1-20 day horizons stock prices are "
                      "close to unpredictable; treat the range, not the line, as the forecast.",
    }
