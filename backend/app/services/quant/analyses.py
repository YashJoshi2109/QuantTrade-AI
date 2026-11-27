"""End-to-end analyses behind the copilot quant tools.

Each function loads data through the active provider (app.services.quant.data),
runs the deterministic math in stats / risk / event_study / portfolio, and
returns a JSON-safe dict:

  analysis     name of the analysis
  as_of        date of the last bar used
  data         per-symbol provenance: source, adjusted?, first/last bar, bars
  results      the numbers (percentages are in percent, e.g. 12.3 = 12.3%)
  method       formulas / windows used, in words
  assumptions  every parameter that is a choice rather than data
  caveats      statistical limitations
  warnings     data-quality notes from the providers

``DataUnavailable`` is raised (and reported verbatim to the model) when a
required series cannot be loaded; nothing is filled in.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from app.services.quant import event_study as es
from app.services.quant import portfolio as pf
from app.services.quant import risk as rk
from app.services.quant import stats as st
from app.services.quant.data import QuantData, get_provider
from app.services.quant.stats import TRADING_DAYS, r


class DataUnavailable(LookupError):
    pass


def _now() -> datetime:          # patched in tests
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _pct(v, n: int = 3):
    return r(v * 100, n) if v is not None else None


def _d(ts) -> str:
    return pd.Timestamp(ts).date().isoformat()


def _load(p: QuantData, sym: str, start: datetime, end: datetime) -> tuple[pd.Series, dict]:
    ps = p.prices(sym, start, end)
    if ps is None or ps.df is None or len(ps.df) < 20:
        raise DataUnavailable(f"no daily price data for {sym} between {start.date()} and {end.date()} "
                              "from any provider (yfinance, Alpaca, FMP, Finnhub, our database)")
    close = ps.df["close"].astype(float)
    return close, {"source": ps.source, "adjusted": bool(ps.adjusted), "warnings": list(ps.warnings)}


def _info(meta: dict, s: pd.Series) -> dict:
    return {"source": meta["source"], "split_dividend_adjusted": meta["adjusted"],
            "first_bar": _d(s.index[0]), "last_bar": _d(s.index[-1]), "bars": int(len(s))}


def _rf_daily(p: QuantData, index: pd.DatetimeIndex, override_pct: Optional[float]) -> tuple[np.ndarray, dict]:
    """Per-day risk-free return aligned to `index` (annual % / 100 / 252)."""
    if override_pct is not None:
        return (np.full(len(index), override_pct / 100 / TRADING_DAYS),
                {"source": "user-supplied constant", "annual_pct": override_pct,
                 "assumption": f"constant risk-free rate {override_pct}% p.a. (supplied in the request)"})
    rf = p.risk_free(index[0].to_pydatetime(), index[-1].to_pydatetime())
    if rf is None or rf.series.empty:
        return (np.zeros(len(index)),
                {"source": None, "annual_pct": 0.0,
                 "assumption": "risk-free series unavailable (FRED DTB3 not reachable or not configured): rf = 0 "
                               "was used, so Sharpe, Sortino and alpha are on total, not excess, returns"})
    s = rf.series.reindex(rf.series.index.union(index)).sort_index().ffill().reindex(index)
    s = s.bfill()
    return (s.to_numpy(float) / 100 / TRADING_DAYS,
            {"source": rf.source, "mean_annual_pct": r(float(s.mean()), 3), "latest_annual_pct": r(float(s.iloc[-1]), 3),
             "latest_date": _d(rf.series.index[-1]),
             "conversion": "daily rf = annual % / 100 / 252, forward-filled over days without an observation"})


def _clean(x):
    """JSON-safe: numpy -> python, NaN/inf -> None, floats rounded to 6 dp."""
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items() if not str(k).startswith("_")}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, np.ndarray):
        return [_clean(v) for v in x.tolist()]
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return r(float(x), 6)
    return x


# ═════════════════════════════════════════════════════════════════════════════
# Q5: volatility, Hurst, autocorrelation, variance ratio, regimes
# ═════════════════════════════════════════════════════════════════════════════

def _vol_block(lr: pd.Series, analysis_start: pd.Timestamp) -> Dict[str, object]:
    out = {}
    x = lr.to_numpy(float)
    for w in (30, 90, 252):
        rv = pd.Series(st.rolling_vol(x, w), index=lr.index)
        hist = rv[rv.index >= analysis_start].dropna()
        if hist.empty:
            out[f"{w}d"] = {"available": False, "reason": f"fewer than {w} returns"}
            continue
        cur = float(hist.iloc[-1])
        out[f"{w}d"] = {
            "current_pct": _pct(cur), "as_of": _d(hist.index[-1]),
            "window": [_d(lr.index[-w]), _d(lr.index[-1])],
            "median_pct": _pct(float(hist.median())),
            "min_pct": _pct(float(hist.min())), "min_date": _d(hist.idxmin()),
            "max_pct": _pct(float(hist.max())), "max_date": _d(hist.idxmax()),
            "current_percentile": r(float((hist <= cur).mean() * 100), 1),
            "history_days": int(len(hist)),
            "quarterly_samples_pct": {_d(i): _pct(v) for i, v in hist.iloc[::-63][::-1].items()},
        }
    try:
        out["ratio_30d_to_252d"] = r(out["30d"]["current_pct"] / out["252d"]["current_pct"], 3)
    except (KeyError, TypeError, ZeroDivisionError):
        pass
    return out


def _direction(vr: float) -> str:
    return "momentum" if vr > 1 else "mean_reversion"


def _serial_block(x: np.ndarray, lags: int, idx: pd.DatetimeIndex) -> Dict[str, object]:
    n = len(x)
    ac = st.acf(x, lags)
    band = 1.96 / math.sqrt(n)
    lb_lags = [m for m in (5, 10, 20) if m <= lags] or [lags]
    vr = []
    for q in (2, 5, 10, 20):
        if n >= 2 * q + 30:
            v = st.variance_ratio(x, q)
            vr.append({k: r(val, 6) if isinstance(val, float) else val for k, val in v.items()})
    a_abs = st.acf(np.abs(x), 10)
    return {
        "window": [_d(idx[0]), _d(idx[-1])], "returns": n,
        "acf": {str(k): r(ac[k], 5) for k in range(1, lags + 1)},
        "acf_95pct_band": r(band, 5),
        "significant_lags": [k for k in range(1, lags + 1) if abs(ac[k]) > band],
        "ljung_box": [{k: r(v, 6) for k, v in row.items()} for row in st.ljung_box(x, lb_lags)],
        "abs_return_acf": {str(k): r(a_abs[k], 4) for k in (1, 5, 10)},
        "abs_return_ljung_box_10": {k: r(v, 6) for k, v in st.ljung_box(np.abs(x), [10])[0].items()},
        "variance_ratio": vr,
    }


def price_behavior(ticker: str, years: float = 5.0, n_states: int = 2, acf_lags: int = 20,
                   provider: Optional[QuantData] = None) -> Dict[str, object]:
    p = provider or get_provider()
    end = _now()
    start = end - timedelta(days=int(years * 365.25) + 400)       # +warm-up for the 252-day vol
    close, meta = _load(p, ticker, start, end)
    lr_all = np.log(close).diff().dropna()
    analysis_start = pd.Timestamp(end - timedelta(days=int(years * 365.25)))
    lr = lr_all[lr_all.index >= analysis_start]
    if len(lr) < 260:
        raise DataUnavailable(f"{ticker}: only {len(lr)} daily returns in the last {years} years; need at least 260")
    x = lr.to_numpy(float)

    vol = _vol_block(lr_all, analysis_start)
    full = _serial_block(x, acf_lags, lr.index)
    recent = _serial_block(x[-252:], min(acf_lags, 20), lr.index[-252:])

    hrs, hdfa = st.hurst_rs(x), st.hurst_dfa(x)
    null = st.hurst_null(x, sims=100, seed=12345)
    h_p = st.empirical_two_sided_p(hrs["h_corrected"], null["_h_samples"])
    d_p = st.empirical_two_sided_p(hdfa["alpha"], null["_dfa_samples"])
    hurst = {
        "rs": {"h_raw": r(hrs["h"], 4), "h_raw_se": r(hrs["h_se"], 4),
               "h_anis_lloyd_peters": r(hrs["h_corrected"], 4), "h_alp_se": r(hrs["h_corrected_se"], 4),
               "fit_r2": r(hrs["r2"], 4), "window_sizes": hrs["sizes"],
               "null_95pct_interval": [r(null["h_corrected_p2_5"], 4), r(null["h_corrected_p97_5"], 4)],
               "null_mean": r(null["h_corrected_mean"], 4), "permutation_p_value": r(h_p, 4)},
        "dfa": {"alpha": r(hdfa["alpha"], 4), "alpha_se": r(hdfa["alpha_se"], 4), "fit_r2": r(hdfa["r2"], 4),
                "window_sizes": hdfa["sizes"],
                "null_95pct_interval": [r(null["dfa_p2_5"], 4), r(null["dfa_p97_5"], 4)],
                "null_mean": r(null["dfa_mean"], 4), "permutation_p_value": r(d_p, 4)},
        "null_method": f"{null['sims']} random permutations of the same returns (seed {null['seed']})",
    }

    # regimes
    regimes: Dict[str, object] = {}
    fits = {}
    for k in (2, 3):
        try:
            fits[k] = st.fit_gaussian_hmm(x, k)
        except (ValueError, np.linalg.LinAlgError, FloatingPointError) as e:
            regimes[f"k{k}_error"] = str(e)
    k_sel = n_states if n_states in fits else (2 if 2 in fits else None)
    if k_sel:
        f = fits[k_sel]
        sm = f["smoothed"].argmax(axis=1)
        segs = st.regime_segments(sm)
        names = ["calm", "turbulent"] if k_sel == 2 else ["calm", "normal", "turbulent"]
        states = []
        for j in range(k_sel):
            p_ii = float(f["A"][j, j])
            states.append({"state": j, "label": names[j],
                           "mean_return_annual_pct": _pct(f["mu"][j] * TRADING_DAYS),
                           "vol_annual_pct": _pct(math.sqrt(f["var"][j] * TRADING_DAYS)),
                           "persistence_p_stay": r(p_ii, 4),
                           "expected_duration_days": r(1 / (1 - p_ii), 1) if p_ii < 1 else None,
                           "stationary_share_pct": _pct(f["stationary"][j], 2),
                           "share_of_days_pct": _pct(float((sm == j).mean()), 2)})
        cur = segs[-1]
        filt = f["filtered"][-1]
        regimes.update({
            "model": f"{k_sel}-state Gaussian HMM on daily log returns (Baum-Welch EM, {f['iterations']} iterations)",
            "states": states,
            "current_state": names[int(np.argmax(filt))],
            "current_filtered_probabilities_pct": {names[j]: _pct(filt[j], 2) for j in range(k_sel)},
            "current_regime_start": _d(lr.index[cur[0]]),
            "current_regime_days": int(cur[1] - cur[0] + 1),
            "recent_segments": [{"state": names[s], "start": _d(lr.index[a]), "end": _d(lr.index[b]),
                                 "days": int(b - a + 1)} for a, b, s in segs[-8:]],
            "regime_switches": len(segs) - 1,
        })
        # 1-state benchmark: a single Gaussian (no regimes)
        mu1, v1 = float(x.mean()), float(x.var(ddof=0))
        ll1 = float(np.sum(-0.5 * np.log(2 * np.pi * v1) - (x - mu1) ** 2 / (2 * v1)))
        bics = {1: -2 * ll1 + 2 * math.log(len(x)), **{k: v["bic"] for k, v in fits.items()}}
        best = min(bics, key=bics.get)
        sel = {"k1": {"loglik": r(ll1, 2), "bic": r(bics[1], 2)}}
        sel.update({f"k{k}": {"loglik": r(v["loglik"], 2), "bic": r(v["bic"], 2)} for k, v in fits.items()})
        vols = [math.sqrt(v) for v in f["var"]]
        state_days = [int((sm == j).sum()) for j in range(k_sel)]
        separated = best > 1 and vols[-1] / vols[0] >= 1.25 and min(state_days) >= 20
        regimes.update({
            "model_selection": sel, "bic_prefers": f"{best} state(s)",
            "regimes_supported": bool(separated),
            "regime_note": ("Distinct volatility regimes are supported: BIC prefers a regime model over a single "
                            "Gaussian and the states differ materially in volatility."
                            if separated else
                            "Regimes are NOT well supported in this window (BIC prefers a single Gaussian, the state "
                            "volatilities are close, or a state covers fewer than 20 days); treat the state labels "
                            "as descriptive only."),
        })

    # descriptive trend context
    c = close[close.index >= analysis_start - pd.Timedelta(days=400)]
    trend = {}
    if len(c) > 253:
        sma200 = float(c.iloc[-200:].mean())
        trend = {"last_close": r(float(c.iloc[-1]), 4), "last_close_date": _d(c.index[-1]),
                 "sma_200": r(sma200, 4), "close_vs_sma200_pct": _pct(float(c.iloc[-1]) / sma200 - 1),
                 "return_252d_pct": _pct(float(c.iloc[-1] / c.iloc[-253] - 1)),
                 "momentum_12_1_pct": _pct(float(c.iloc[-22] / c.iloc[-253] - 1))}

    verdict = _behavior_verdict(full, recent, hurst)
    return _clean({
        "analysis": "price_behavior", "ticker": ticker, "as_of": _d(close.index[-1]),
        "data": {ticker: _info(meta, close)},
        "analysis_window": [_d(lr.index[0]), _d(lr.index[-1])], "returns_used": int(len(x)),
        "results": {"realised_volatility": vol, "hurst": hurst,
                    "serial_dependence_full_window": full, "serial_dependence_last_252d": recent,
                    "regimes": regimes, "trend_context": trend, "verdict": verdict},
        "method": {
            "returns": "daily log returns of the split/dividend-adjusted close",
            "realised_vol": "std(log returns, ddof=1) over the trailing 30/90/252 trading days x sqrt(252)",
            "hurst_rs": "slope of log mean(R/S) vs log n over non-overlapping chunks; corrected with the "
                        "Anis-Lloyd-Peters expected R/S (H = 0.5 + slope of log R/S - log E[R/S])",
            "dfa": "DFA-1: profile = cumsum(x - mean), linear detrend per segment, slope of log F(s) vs log s",
            "acf": "sample autocorrelation; 95% band = 1.96 / sqrt(N)",
            "ljung_box": "Q(m) = N(N+2) sum r_k^2/(N-k), chi-square(m)",
            "variance_ratio": "Lo-MacKinlay overlapping VR(q) with heteroskedasticity-robust z*",
            "regimes": "Gaussian HMM, deterministic initialisation, states ordered by volatility; current "
                       "state uses filtered (real-time) probabilities, segments use smoothed probabilities",
        },
        "assumptions": [f"analysis window = last {years} years", f"HMM states = {k_sel}",
                        "significance level 5% for all tests"],
        "caveats": [
            "Hurst estimates are noisy at this sample size; the raw R/S estimate is biased upward in short "
            "samples, so compare the corrected value against the permutation interval, not against 0.5.",
            "R/S and DFA respond to short-memory autocorrelation and volatility clustering as well as to long "
            "memory; a significant result does not prove long-range dependence.",
            "Daily-return autocorrelations of large caps are typically tiny; statistical significance on "
            "~1,250 days is not the same as an exploitable effect after costs.",
            "Volatility clustering (significant ACF of |returns|) violates the iid assumption of the "
            "plain Ljung-Box and VR z tests; use the robust z* for the variance ratio.",
            "HMM regimes are fitted in-sample; past segment boundaries use smoothed probabilities that "
            "see later data. EM can converge to a local optimum, and Gaussian states understate tails.",
            "All tests are on past prices only; they describe the sample and are not a forecast.",
        ],
        "warnings": meta["warnings"],
    })


def _behavior_verdict(full: dict, recent: dict, hurst: dict) -> Dict[str, object]:
    ev: List[Dict[str, object]] = []
    for label, blk in (("full window", full), ("last 252 days", recent)):
        for v in blk["variance_ratio"]:
            if v["p_value_robust"] is not None and v["p_value_robust"] < 0.05:
                ev.append({"test": f"VR({v['q']}) {label}", "direction": _direction(v["vr"]),
                           "value": v["vr"], "p_value": v["p_value_robust"]})
        a1 = blk["acf"]["1"]
        if abs(a1) > blk["acf_95pct_band"]:
            ev.append({"test": f"lag-1 autocorrelation {label}", "direction": "momentum" if a1 > 0 else "mean_reversion",
                       "value": a1, "p_value": None})
    h = hurst["rs"]
    if h["permutation_p_value"] is not None and h["permutation_p_value"] < 0.05:
        ev.append({"test": "Hurst R/S (corrected) vs permutation null",
                   "direction": "momentum" if h["h_anis_lloyd_peters"] > h["null_mean"] else "mean_reversion",
                   "value": h["h_anis_lloyd_peters"], "p_value": h["permutation_p_value"]})
    d = hurst["dfa"]
    if d["permutation_p_value"] is not None and d["permutation_p_value"] < 0.05:
        ev.append({"test": "DFA alpha vs permutation null",
                   "direction": "momentum" if d["alpha"] > d["null_mean"] else "mean_reversion",
                   "value": d["alpha"], "p_value": d["permutation_p_value"]})
    mom = sum(1 for e in ev if e["direction"] == "momentum")
    mr = sum(1 for e in ev if e["direction"] == "mean_reversion")
    if not ev:
        reading = "random_walk_consistent"
        text = ("No test rejects the random-walk null at 5%: the evidence does not support either mean reversion "
                "or momentum in daily returns.")
    elif mom and not mr:
        reading = "momentum"
        text = f"{mom} significant result(s), all pointing to positive serial dependence (momentum / persistence)."
    elif mr and not mom:
        reading = "mean_reversion"
        text = f"{mr} significant result(s), all pointing to negative serial dependence (mean reversion)."
    else:
        reading = "mixed"
        text = f"Conflicting evidence: {mom} result(s) suggest momentum and {mr} suggest mean reversion."
    serial = [blk["ljung_box"][-1]["p_value"] for blk in (full, recent)]
    return {"reading": reading, "summary": text, "significant_evidence": ev,
            "ljung_box_p_full_and_recent": serial,
            "volatility_clustering": bool(full["abs_return_ljung_box_10"]["p_value"] < 0.05)}


# ═════════════════════════════════════════════════════════════════════════════
# Q6: beta, alpha, Sharpe, Sortino, drawdown, VaR
# ═════════════════════════════════════════════════════════════════════════════

def _rolling_summary(s: pd.Series) -> Dict[str, object]:
    s = s.dropna()
    if s.empty:
        return {"available": False}
    return {"latest": r(float(s.iloc[-1]), 4), "latest_date": _d(s.index[-1]),
            "min": r(float(s.min()), 4), "min_date": _d(s.idxmin()),
            "max": r(float(s.max()), 4), "max_date": _d(s.idxmax()),
            "median": r(float(s.median()), 4),
            "quarterly_samples": {_d(i): r(v, 4) for i, v in s.iloc[::-63][::-1].items()}}


def risk_metrics(ticker: str, benchmark: str = "SPY", years: float = 5.0, var_level: float = 0.95,
                 risk_free_rate_pct: Optional[float] = None, provider: Optional[QuantData] = None) -> Dict[str, object]:
    p = provider or get_provider()
    end = _now()
    start = end - timedelta(days=int(years * 365.25) + 5)
    ci, mi = _load(p, ticker, start, end)
    cm, mm = _load(p, benchmark, start, end)
    px = pd.concat([ci.rename("i"), cm.rename("m")], axis=1, join="inner").dropna()
    ret = px.pct_change().dropna()
    if len(ret) < 252:
        raise DataUnavailable(f"only {len(ret)} overlapping daily returns for {ticker} and {benchmark}; need 252")
    rf, rf_info = _rf_daily(p, ret.index, risk_free_rate_pct)
    ri, rm = ret["i"].to_numpy(float), ret["m"].to_numpy(float)

    ba = rk.beta_alpha(ri, rm, rf)
    db = rk.downside_beta(ri, rm, rf)
    ex_i = pd.Series(ri - rf, index=ret.index)
    ex_m = pd.Series(rm - rf, index=ret.index)
    rolling = {f"rolling_beta_{w}": _rolling_summary(rk.rolling_beta(ex_i, ex_m, w)) for w in (63, 252)}
    wealth = (1 + ret["i"]).cumprod()
    wealth = pd.concat([pd.Series([1.0], index=[px.index[0]]), wealth])
    mwealth = pd.concat([pd.Series([1.0], index=[px.index[0]]), (1 + ret["m"]).cumprod()])
    dd = rk.max_drawdown(wealth)
    mdd = rk.max_drawdown(mwealth)
    v = rk.var_cvar(ri, var_level)
    vm = rk.var_cvar(rm, var_level)
    yrs = (ret.index[-1] - px.index[0]).days / 365.25
    cagr = float(wealth.iloc[-1]) ** (1 / yrs) - 1 if yrs > 0 else None
    mcagr = float(mwealth.iloc[-1]) ** (1 / yrs) - 1 if yrs > 0 else None

    def var_block(x):
        return {"historical_var_pct": _pct(x.get("historical_var")), "historical_cvar_pct": _pct(x.get("historical_cvar")),
                "parametric_var_pct": _pct(x.get("parametric_var")), "parametric_cvar_pct": _pct(x.get("parametric_cvar")),
                "cornish_fisher_var_pct": _pct(x.get("cornish_fisher_var")),
                "tail_observations": x.get("tail_observations"),
                "skewness": r(x.get("skewness"), 4), "excess_kurtosis": r(x.get("excess_kurtosis"), 4),
                "jarque_bera_p_value": r(x.get("jarque_bera_p_value"), 6),
                "worst_day_pct": _pct(x.get("worst_day")), "mean_daily_pct": _pct(x.get("mean_daily"), 4),
                "std_daily_pct": _pct(x.get("std_daily"), 4)}

    raw = {"beta": ba["beta"], "downside_beta": db["downside_beta"], "sharpe": rk.sharpe(ri, rf),
           "sortino": rk.sortino(ri, rf), "alpha_p_value": ba["alpha_p_value"], "var_95": v,
           "rolling_beta_252": rolling["rolling_beta_252"]}
    lvl = int(round(var_level * 100))
    res = {
        "beta": r(ba["beta"], 4), "beta_se": r(ba["beta_se"], 4), "r_squared": r(ba["r2"], 4),
        "correlation": r(ba["correlation"], 4),
        "jensens_alpha_annual_pct": _pct(ba["alpha_annual"]), "alpha_t_stat": r(ba["alpha_t"], 3),
        "alpha_p_value": r(ba["alpha_p_value"], 4), "alpha_p_value_white": r(ba["alpha_p_value_white"], 4),
        "idiosyncratic_vol_annual_pct": _pct(ba["idiosyncratic_vol_annual"]),
        "downside_beta": r(db["downside_beta"], 4), "upside_beta": r(db["upside_beta"], 4),
        "estrada_semi_beta": r(db["estrada_semi_beta"], 4),
        "down_market_days": db["down_days"], "up_market_days": db["up_days"],
        **rolling,
        "annualised_return_cagr_pct": _pct(cagr), "annualised_volatility_pct": _pct(st.realised_vol(ri)),
        "downside_deviation_annual_pct": _pct(rk.downside_deviation(ri, rf)),
        "sharpe": r(raw["sharpe"], 4), "sortino": r(raw["sortino"], 4),
        "max_drawdown": {k: (r(val, 3) if isinstance(val, float) else val) for k, val in dd.items()},
        f"var_{lvl}_1day": var_block(v),
        "benchmark": {"symbol": benchmark, "cagr_pct": _pct(mcagr), "volatility_pct": _pct(st.realised_vol(rm)),
                      "sharpe": r(rk.sharpe(rm, rf), 4), "sortino": r(rk.sortino(rm, rf), 4),
                      "max_drawdown_pct": r(mdd.get("max_drawdown_pct"), 3),
                      "max_drawdown_peak": mdd.get("peak_date"), "max_drawdown_trough": mdd.get("trough_date"),
                      f"var_{lvl}_1day": var_block(vm)},
        "divergences": rk.divergence_notes(raw),
    }
    return _clean({
        "analysis": "risk_metrics", "ticker": ticker, "benchmark": benchmark, "as_of": _d(ret.index[-1]),
        "data": {ticker: _info(mi, ci), benchmark: _info(mm, cm)},
        "analysis_window": [_d(px.index[0]), _d(ret.index[-1])], "aligned_returns": int(len(ret)),
        "risk_free": rf_info, "results": res,
        "method": {
            "returns": "simple daily returns of adjusted (total-return) closes, inner-joined on dates",
            "beta_alpha": "OLS of (r_i - rf) on (r_m - rf); alpha = intercept x 252 (Jensen); OLS and White SEs",
            "rolling_beta": "cov/var of daily excess returns over trailing 63 and 252 trading days",
            "downside_beta": "OLS slope on days with benchmark excess return < 0 (Bawa-Lindenberg style); "
                             "Estrada semi-beta = E[min(r_i-mu_i,0) min(r_m-mu_m,0)] / E[min(r_m-mu_m,0)^2]",
            "sharpe": "mean(r - rf) / std(r - rf, ddof=1) x sqrt(252)",
            "sortino": "mean(r - rf) / sqrt(mean(min(r - rf, 0)^2)) x sqrt(252), target = rf",
            "max_drawdown": "largest fall of cumulative total-return wealth from a running peak",
            "var": f"1-day {lvl}%: historical = -5th percentile (linear interpolation), CVaR = -mean of returns at or "
                   "below it; parametric = normal with sample mean/std; Cornish-Fisher adjusts the normal quantile for "
                   "skewness and excess kurtosis",
            "cagr": "(final wealth)^(1/years) - 1, years = calendar days / 365.25",
        },
        "assumptions": [f"benchmark = {benchmark} (adjusted ETF closes, i.e. S&P 500 total return proxy incl. dividends "
                        "and ETF fees)" if benchmark.upper() == "SPY" else f"benchmark = {benchmark}",
                        f"window = last {years} years of daily returns", f"VaR confidence = {lvl}%, 1-day horizon",
                        rf_info.get("assumption") or f"risk-free = {rf_info.get('source')}"],
        "caveats": [
            "Historical VaR at 95% uses ~5% of days (the tail_observations count); it is sensitive to the window.",
            "Parametric VaR assumes normal returns; when Jarque-Bera rejects normality it understates tail risk.",
            "Beta and alpha are in-sample OLS estimates; the rolling beta shows how unstable they are.",
            "Jensen's alpha over a few years has a wide confidence interval; check its p-value before reading it "
            "as skill.",
            "Sharpe and Sortino treat the sample mean as the expected return; a large run-up inflates both.",
        ],
        "warnings": mi["warnings"] + mm["warnings"],
    })


# ═════════════════════════════════════════════════════════════════════════════
# Q7: earnings event study
# ═════════════════════════════════════════════════════════════════════════════

def earnings_event_study(ticker: str, n_events: int = 12, window_pre: int = -2, window_post: int = 2,
                         estimation_days: int = 120, gap_days: int = 10, market: str = "SPY",
                         provider: Optional[QuantData] = None) -> Dict[str, object]:
    p = provider or get_provider()
    ev = p.earnings_events(ticker, n_events)
    if not ev.events:
        raise DataUnavailable(f"no past earnings announcement dates for {ticker} ("
                              + "; ".join(ev.notes or ["no provider returned events"]) + ")")
    events = ev.events[-n_events:]
    first = pd.Timestamp(events[0]["date"])
    start = (first - timedelta(days=int((estimation_days + gap_days - window_pre + 20) * 1.6))).to_pydatetime()
    end = _now()
    cs, ms = _load(p, ticker, start, end)
    cm, mm = _load(p, market, start, end)
    out = es.run_event_study(cs, cm, events, window_pre, window_post, estimation_days, gap_days)
    notes = list(ev.notes)
    unknown = [e["announcement_date"] for e in out["events"] if e["timing"] == "unknown"]
    if unknown:
        notes.append("release time unknown for " + ", ".join(unknown) + ": day 0 = announcement date")
    if len(out["events"]) < n_events:
        notes.append(f"{len(out['events'])} of the {n_events} requested events could be analysed")

    def pct_tests(t):
        t = dict(t)
        for k in ("mean_car", "median_car", "std_car"):
            if t.get(k) is not None:
                t[k + "_pct"] = _pct(t.pop(k), 4)
        return t

    rows = []
    for e in out["events"]:
        rows.append({"announcement_date": e["announcement_date"], "timing": e["timing"], "day0": e["day0"],
                     "event_window": e["window"], "estimation_window": e["estimation_window"],
                     "market_model_alpha_daily_pct": _pct(e["alpha"], 4), "market_model_beta": r(e["beta"], 4),
                     "ar_by_day_pct": {k: _pct(v, 4) for k, v in e["ar_by_day"].items()},
                     "car_pct": _pct(e["car"], 4), "car_se_pct": _pct(e["car_se"], 4), "scar": r(e["scar"], 4),
                     "car_p_value": r(e["car_p_two_sided"], 4), "raw_return_pct": _pct(e["raw_return"], 4),
                     "eps_actual": e["eps_actual"], "eps_estimate": e["eps_estimate"],
                     "eps_surprise_pct": e["surprise_pct"], "surprise_sign": e["surprise_sign"]})
    diff = out["positive_minus_negative"]
    if diff:
        diff = {"mean_car_difference_pct": _pct(diff["mean_difference"], 4), "welch_t": r(diff["t_stat"], 4),
                "p_two_sided": r(diff["p_two_sided"], 4)}
    pos = out["positive_surprise"]
    answer = None
    if pos.get("n", 0) >= 2 and pos.get("p_greater") is not None:
        sig = pos["p_greater"] < 0.05
        answer = (f"Positive-surprise events: n={pos['n']}, mean CAR {pos['mean_car'] * 100:.4f}%, one-sided t-test "
                  f"p={pos['p_greater']:.4f}, sign test {pos['positive']}/{pos['n']} positive (one-sided p="
                  f"{pos['sign_test_p_greater']:.4f}): "
                  + ("statistically significant positive abnormal return at 5%." if sig else
                     "not statistically significant at 5%."))
    w = f"[{window_pre},+{window_post}]"
    return _clean({
        "analysis": "earnings_event_study", "ticker": ticker, "market": market, "as_of": _d(cs.index[-1]),
        "data": {ticker: _info(ms, cs), market: _info(mm, cm),
                 "earnings_events": {"source": ev.source, "events_requested": n_events,
                                     "events_returned": len(events)}},
        "results": {"events": rows, "skipped": out["skipped"],
                    "all_events": pct_tests(out["all"]),
                    "positive_surprise": pct_tests(out["positive_surprise"]),
                    "negative_or_zero_surprise": pct_tests(out["negative_or_zero_surprise"]),
                    "positive_minus_negative": diff,
                    "aar_by_day_pct": {k: {"aar_pct": _pct(v["aar"], 4), "t_stat": r(v["t_stat"], 4),
                                           "p_value": r(v["p_two_sided"], 4)} for k, v in out["aar_by_day"].items()},
                    "positive_surprise_answer": answer},
        "method": {
            "market_model": f"R_i = a + b R_{market} + e, OLS over {estimation_days} trading days ending {gap_days} "
                            f"days before the event window",
            "abnormal_return": "AR = R_i - (a + b R_m); CAR = sum of AR over the event window "
                               f"{w} trading days around day 0",
            "day0": "announcement date for pre-market/intraday releases; next session for after-close releases",
            "tests": "cross-sectional t on CARs (t(N-1)); CLM J1 (uses each event's CAR variance incl. estimation "
                     "error) and J2 (standardised CARs); exact binomial sign test; Welch t for positive vs "
                     "negative surprises",
            "surprise": "EPS surprise sign = reported EPS vs consensus estimate from the earnings data source",
        },
        "assumptions": [f"event window {w}", f"estimation window {estimation_days} days, gap {gap_days} days",
                        f"market proxy {market}", f"last {n_events} reported quarters"],
        "caveats": [
            "N is small (about 12 events); t-tests rely on approximate normality of CARs and have low power.",
            "If almost every quarter is a positive surprise, the negative group is too small to test and the "
            "comparison is not informative.",
            "Consensus EPS and 'reported EPS' are vendor figures (often adjusted / non-GAAP).",
            "Other news released with earnings (guidance, buybacks) is part of the measured reaction.",
            "Event windows of consecutive quarters do not overlap, but market-wide shocks on event days "
            "are only removed to the extent the market model captures them.",
        ],
        "warnings": ms["warnings"] + mm["warnings"] + notes,
    })


# ═════════════════════════════════════════════════════════════════════════════
# Q24 / Q23: portfolio risk, concentration, stress
# ═════════════════════════════════════════════════════════════════════════════

def portfolio_risk(tickers: Sequence[str], weights: Optional[Sequence[float]] = None, years: float = 3.0,
                   tech_shock_pct: float = -20.0, include_sector_etfs: bool = True,
                   provider: Optional[QuantData] = None) -> Dict[str, object]:
    p = provider or get_provider()
    syms = [t.upper() for t in tickers]
    if len(set(syms)) != len(syms):
        raise ValueError("duplicate tickers")
    assumptions = []
    if weights is None:
        w = np.full(len(syms), 1 / len(syms))
        assumptions.append("equal weights (none supplied)")
    else:
        if len(weights) != len(syms):
            raise ValueError("weights must have one value per ticker")
        w = np.asarray(weights, float)
        if (w < 0).any() or w.sum() <= 0:
            raise ValueError("weights must be non-negative and not all zero")
        if abs(w.sum() - 1) > 1e-6:
            assumptions.append(f"weights normalised to sum to 1 (supplied sum {w.sum():g})")
        w = w / w.sum()
    end = _now()
    stats_start = end - timedelta(days=int(years * 365.25) + 5)
    hist_start = min(stats_start, datetime(2018, 9, 1))
    closes, metas = {}, {}
    for s in syms:
        closes[s], metas[s] = _load(p, s, hist_start, end)
    refs = {}
    for b in ("SPY", "QQQ"):
        try:
            refs[b], metas[b] = _load(p, b, hist_start, end)
        except DataUnavailable:
            pass
    if "SPY" not in refs:
        raise DataUnavailable("SPY (market factor) price data unavailable")

    px = pd.concat({s: closes[s] for s in syms}, axis=1, join="inner").dropna()
    px = px[px.index >= pd.Timestamp(stats_start)]
    ret = px.pct_change().dropna()
    if len(ret) < 120:
        raise DataUnavailable(f"only {len(ret)} common trading days for {', '.join(syms)} in the window")
    R = ret.to_numpy(float)
    cov = np.cov(R, rowvar=False, ddof=1) * TRADING_DAYS
    cov = np.atleast_2d(cov)
    corr = np.atleast_2d(np.corrcoef(R, rowvar=False))
    rc = pf.risk_contributions(w, cov)
    pret = pd.Series(R @ w, index=ret.index)          # daily-rebalanced to target weights

    # pairwise correlations
    pairs = []
    for i in range(len(syms)):
        for j in range(i + 1, len(syms)):
            pairs.append({"pair": f"{syms[i]}-{syms[j]}", "correlation": r(corr[i, j], 4)})
    pairs.sort(key=lambda x: -x["correlation"])
    avg_corr = float(np.mean([x["correlation"] for x in pairs])) if pairs else None

    # sectors
    sectors, sector_src = {}, {}
    for s in syms:
        info = p.sector(s)
        sectors[s] = info.get("sector") if info else None
        sector_src[s] = info.get("source") if info else "unavailable"
    sw: Dict[str, float] = {}
    for s, wt in zip(syms, w):
        sw[sectors[s] or "unknown"] = sw.get(sectors[s] or "unknown", 0.0) + float(wt)

    # factor regressions
    fac_px = {"SPY": refs["SPY"]}
    if "QQQ" in refs:
        fac_px["QQQ"] = refs["QQQ"]
    etf_for = {}
    if include_sector_etfs:
        for s in syms:
            etf = pf.SECTOR_ETF.get((sectors[s] or "").lower())
            if etf and etf not in fac_px:
                try:
                    fac_px[etf], metas[etf] = _load(p, etf, stats_start, end)
                except DataUnavailable:
                    etf = None
            if etf and etf in fac_px:
                etf_for[s] = etf
    fr = pd.concat(fac_px, axis=1).pct_change()
    J = pd.concat([ret, pret.rename("PORTFOLIO"), fr.add_prefix("f_")], axis=1, join="inner").dropna(subset=list(ret.columns) + ["f_SPY"])
    def reg(name: str, cols: Dict[str, pd.Series]) -> Optional[dict]:
        D = pd.concat([J[name].rename("_y"), *[c.rename(k) for k, c in cols.items()]], axis=1).dropna()
        if len(D) < 60:
            return None
        return pf.factor_regression(D["_y"].to_numpy(float), {k: D[k].to_numpy(float) for k in cols})

    factors = {}
    for name in syms + ["PORTFOLIO"]:
        row = {"market_model": _fac(reg(name, {"SPY": J["f_SPY"]}))}
        if "f_QQQ" in J:
            f2 = reg(name, {"SPY": J["f_SPY"], "QQQ_minus_SPY": J["f_QQQ"] - J["f_SPY"]})
            if f2:
                row["market_plus_tech"] = _fac(f2)
        etf = etf_for.get(name)
        if etf and f"f_{etf}" in J:
            f3 = reg(name, {"SPY": J["f_SPY"], f"{etf}_minus_SPY": J[f"f_{etf}"] - J["f_SPY"]})
            if f3:
                row["market_plus_sector"] = {"sector_etf": etf, **_fac(f3)}
        factors[name] = row

    pca = pf.pca_share(corr) if len(syms) > 1 else None

    # stress
    stress = pf.historical_stress(closes, dict(zip(syms, w)), references=refs)
    hypo = None
    if "QQQ" in refs and "f_QQQ" in J:
        rows = {}
        for name in syms + ["PORTFOLIO"]:
            D = J[[name, "f_QQQ"]].dropna()
            y, q = D[name].to_numpy(float), D["f_QQQ"].to_numpy(float)
            down = q < 0
            b = pf.factor_regression(y, {"QQQ": q})["betas"]["QQQ"]
            bd = pf.factor_regression(y[down], {"QQQ": q[down]})["betas"]["QQQ"] if down.sum() > 30 else None
            rows[name] = {"beta_to_QQQ": r(b, 4), "downside_beta_to_QQQ": r(bd, 4),
                          "implied_move_pct": r(b * tech_shock_pct, 3),
                          "implied_move_downside_beta_pct": r(bd * tech_shock_pct, 3) if bd is not None else None}
            factors[name]["beta_to_QQQ"] = r(b, 4)
        analogue = next((s for s in stress if s["id"] == "tech_bear_2022"), None)
        ratio = None
        if analogue and analogue.get("portfolio_return_pct") is not None and analogue.get("benchmarks", {}).get("QQQ"):
            qret = analogue["benchmarks"]["QQQ"]["return_pct"]
            ratio = analogue["portfolio_return_pct"] / qret if qret else None
        if ratio is not None and not (analogue["portfolio_return_pct"] < 0 and analogue["benchmarks"]["QQQ"]["return_pct"] < 0):
            ratio = None              # analogue only meaningful when both fell
        hypo = {"shock": f"QQQ (Nasdaq-100 proxy) {tech_shock_pct:+g}%", "shock_pct": tech_shock_pct,
                "by_asset": rows,
                "portfolio_implied_move_pct": rows["PORTFOLIO"]["implied_move_pct"],
                "portfolio_implied_move_downside_beta_pct": rows["PORTFOLIO"]["implied_move_downside_beta_pct"],
                "historical_analogue_2022": ({"portfolio_to_QQQ_ratio": r(ratio, 4),
                                              "implied_move_pct": r(ratio * tech_shock_pct, 3)} if ratio is not None else
                                             {"note": "not meaningful: the portfolio and QQQ did not both fall in the "
                                                      "2021-22 window (or the window lacks data)"}),
                "method": "linear: move = beta x shock, betas from daily OLS on QQQ over the analysis window "
                          "(downside beta: QQQ down days only); analogue scales the shock by the portfolio/QQQ "
                          "return ratio in the 2021-22 tech bear window"}

    wealth = (1 + pret).cumprod()
    wealth = pd.concat([pd.Series([1.0], index=[px.index[0]]), wealth])
    dd = rk.max_drawdown(wealth)
    v = rk.var_cvar(pret.to_numpy(float), 0.95)
    assumptions += [f"statistics window = last {years} years ({_d(ret.index[0])} to {_d(ret.index[-1])})",
                    "portfolio returns rebalanced daily to the target weights (stress windows: buy-and-hold)",
                    f"hypothetical tech correction = QQQ {tech_shock_pct:+g}% (scenario input, not a forecast)",
                    "sector ETFs: SPDR Select Sector funds mapped from each company's sector"]
    res = {
        "weights": {s: r(x, 6) for s, x in zip(syms, w)},
        "correlation_matrix": {syms[i]: {syms[j]: r(corr[i, j], 4) for j in range(len(syms))} for i in range(len(syms))},
        "pairwise_correlations": pairs, "average_pairwise_correlation": r(avg_corr, 4),
        "covariance_matrix_annual": {syms[i]: {syms[j]: r(cov[i, j], 6) for j in range(len(syms))} for i in range(len(syms))},
        "portfolio_vol_annual_pct": _pct(rc["portfolio_vol"]),
        "weighted_avg_asset_vol_pct": _pct(float(w @ rc["asset_vol"])),
        "diversification_ratio": r(rc["diversification_ratio"], 4),
        "effective_n_weights": r(rc["effective_n_weights"], 3), "effective_n_risk": r(rc["effective_n_risk"], 3),
        "risk_contributions": {s: {"weight_pct": _pct(w[i], 2), "asset_vol_pct": _pct(rc["asset_vol"][i]),
                                   "marginal_contribution_pct": _pct(rc["mcr"][i]),
                                   "component_contribution_pct": _pct(rc["ccr"][i]),
                                   "percent_of_risk": _pct(rc["pcr"][i], 2)} for i, s in enumerate(syms)},
        "pca": ({"pc1_share_of_variance_pct": _pct(pca["pc1_share"], 2),
                 "eigenvalues": [r(e, 4) for e in pca["eigenvalues"]],
                 "pc1_loadings": {s: r(x, 4) for s, x in zip(syms, pca["pc1_loadings"])}} if pca else None),
        "sectors": {s: {"sector": sectors[s], "source": sector_src[s]} for s in syms},
        "sector_weights_pct": {k: _pct(x, 2) for k, x in sw.items()},
        "sector_hhi": r(pf.hhi(list(sw.values())), 4), "weight_hhi": r(pf.hhi(w), 4),
        "factor_regressions": factors,
        "portfolio_max_drawdown": {k: (r(val, 3) if isinstance(val, float) else val) for k, val in dd.items()},
        "portfolio_var_95_1day_pct": {"historical": _pct(v.get("historical_var")), "parametric": _pct(v.get("parametric_var")),
                                      "historical_cvar": _pct(v.get("historical_cvar"))},
        "historical_stress": [_stress_row(s) for s in stress],
        "hypothetical_tech_correction": hypo,
    }
    return _clean({
        "analysis": "portfolio_risk", "tickers": syms, "as_of": _d(ret.index[-1]),
        "data": {k: _info(metas[k], s) for k, s in {**closes, **refs, **{e: fac_px[e] for e in fac_px if e not in refs}}.items()},
        "common_trading_days": int(len(ret)), "results": res,
        "method": {
            "covariance": "sample covariance of daily simple returns (ddof=1) x 252",
            "risk_contribution": "MCR = (Sigma w)/sigma_p; component = w x MCR; percent = component / sigma_p",
            "diversification_ratio": "sum w_i sigma_i / sigma_p",
            "effective_n": "1/sum(w^2) for weights; 1/sum(PCR^2) for risk",
            "pca": "eigenvalues of the correlation matrix; PC1 share = largest eigenvalue / number of assets",
            "factor_regressions": "daily OLS on SPY; SPY + (QQQ - SPY); SPY + (sector ETF - SPY)",
            "stress": "buy-and-hold return between the closes on/before the window dates",
        },
        "assumptions": assumptions,
        "caveats": [
            "Correlations and betas are estimated on the window; correlations typically rise in sell-offs, so "
            "normal-period diversification overstates crisis diversification (compare the stress rows).",
            "Sector labels come from data vendors (Yahoo-style sectors), so e.g. AMZN/TSLA are Consumer Cyclical and "
            "GOOGL Communication Services even though their returns load on the same tech factor.",
            "The hypothetical shock is linear in daily betas; it ignores compounding, volatility changes and "
            "idiosyncratic moves, and the shock size is an assumption.",
            "Historical stress windows are fixed calendar dates; each asset's own peak/trough differs.",
            "An asset without data at a window's start makes that window's portfolio figure unavailable.",
        ],
        "warnings": [x for k in metas for x in metas[k]["warnings"]],
    })


def _fac(f: Optional[dict]) -> Optional[dict]:
    if f is None:
        return None
    return {"alpha_annual_pct": _pct(f["alpha_annual"]), "alpha_t": r(f["alpha_t"], 3),
            "betas": {k: r(v, 4) for k, v in f["betas"].items()},
            "t_stats": {k: r(v, 3) for k, v in f["t_stats"].items()}, "r2": r(f["r2"], 4), "n": f["n"]}


def _stress_row(s: dict) -> dict:
    out = {k: s[k] for k in ("id", "name", "start", "end", "basis")}
    out["portfolio_return_pct"] = r(s.get("portfolio_return_pct"), 3)
    if s.get("portfolio_max_drawdown_pct") is not None:
        out["portfolio_max_drawdown_pct"] = r(s["portfolio_max_drawdown_pct"], 3)
    out["assets_return_pct"] = {k: r(v["return_pct"], 3) for k, v in s["assets"].items()}
    if s.get("benchmarks"):
        out["benchmarks_return_pct"] = {k: r(v["return_pct"], 3) for k, v in s["benchmarks"].items()}
    if s.get("worst_asset"):
        out["worst_asset"] = s["worst_asset"]
    if s.get("missing"):
        out["missing_data"] = s["missing"]
    if s.get("note"):
        out["note"] = s["note"]
    return out
