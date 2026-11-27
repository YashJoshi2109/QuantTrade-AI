"""Performance metrics from one daily equity series.

Conventions (all documented in docs/BACKTESTING.md):

* Returns are simple period returns of the marked-to-market equity.
* CAGR uses calendar time: ``years = (last_date - first_date).days / 365.25``.
  The old engine used ``bars / 252``, which mis-states CAGR for anything that
  trades on weekends (crypto) or has gaps.
* Volatility / Sharpe / Sortino annualise with ``periods_per_year``
  (252 for exchange calendars, 365 when the series trades on weekends).
* Sharpe and Sortino use the sample standard deviation (ddof=1) of excess
  returns; Sortino's denominator is the downside deviation
  ``sqrt(mean(min(r - rf, 0)^2))`` over *all* periods.
* Max drawdown duration is the longest peak-to-recovery stretch, in bars and
  calendar days; an unrecovered drawdown runs to the last bar.
* Alpha / beta are OLS on **date-aligned** daily returns (inner join).
* ``rf`` is an annual risk-free rate as a fraction (0.04 = 4%), de-annualised
  arithmetically (``rf / ppy`` per period). It moves Sharpe, Sortino and
  alpha only; volatility, drawdown and returns are unaffected.
* Exposure-adjusted CAGR is CAGR divided by the average share of equity
  deployed, i.e. the growth rate per unit of capital actually at risk.
* Historical VaR / CVaR (95%) are one-day figures from the empirical
  distribution of daily returns, reported as (negative) percentages.
"""
from __future__ import annotations

import math
from typing import Iterable, List, Optional

import numpy as np
import pandas as pd


def _f(v, n: int = 4):
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, n)


def infer_periods_per_year(index: pd.DatetimeIndex) -> int:
    if len(index) < 10:
        return 252
    weekend = np.isin(pd.DatetimeIndex(index).dayofweek, [5, 6]).mean()
    return 365 if weekend > 0.1 else 252


def years_between(index: pd.DatetimeIndex) -> float:
    if len(index) < 2:
        return 0.0
    return (index[-1] - index[0]).days / 365.25


def drawdown_stats(equity: pd.Series) -> dict:
    eq = equity.to_numpy(dtype=float)
    peak = np.maximum.accumulate(eq)
    dd = eq / peak - 1.0
    mdd = float(dd.min()) if len(dd) else 0.0
    # longest underwater stretch
    longest = (0, 0, 0)  # bars, start_i, end_i
    start = None
    for i, v in enumerate(dd):
        if v < -1e-12:
            if start is None:
                start = i - 1 if i > 0 else 0
        elif start is not None:
            if i - start > longest[0]:
                longest = (i - start, start, i)
            start = None
    recovered = True
    if start is not None:
        if len(dd) - 1 - start > longest[0]:
            longest = (len(dd) - 1 - start, start, len(dd) - 1)
            recovered = False
    bars, s, e = longest
    idx = equity.index
    days = int((idx[e] - idx[s]).days) if bars > 0 else 0
    trough_i = int(np.argmin(dd)) if len(dd) else 0
    return {
        "max_drawdown_pct": _f(mdd * 100, 3),
        "max_drawdown_date": idx[trough_i].date().isoformat() if len(dd) else None,
        "max_drawdown_duration_bars": int(bars),
        "max_drawdown_duration_days": days,
        "max_drawdown_recovered": recovered if bars > 0 else True,
        "drawdown": pd.Series(dd, index=idx),
    }


def return_stats(returns: pd.Series, ppy: int, rf: float = 0.0) -> dict:
    r = returns.dropna().to_numpy(dtype=float)
    if len(r) < 2:
        return {"volatility_pct": None, "sharpe": None, "sortino": None}
    ex = r - rf / ppy
    sd = float(np.std(r, ddof=1))
    vol = sd * math.sqrt(ppy)
    sharpe = float(np.mean(ex) / np.std(ex, ddof=1) * math.sqrt(ppy)) if np.std(ex, ddof=1) > 1e-12 else None
    dd = math.sqrt(float(np.mean(np.minimum(ex, 0.0) ** 2)))
    sortino = float(np.mean(ex) / dd * math.sqrt(ppy)) if dd > 1e-12 else None
    return {"volatility_pct": _f(vol * 100, 3), "sharpe": _f(sharpe, 3), "sortino": _f(sortino, 3)}


def alpha_beta(strategy_returns: pd.Series, bench_returns: pd.Series, ppy: int, rf: float = 0.0) -> dict:
    j = pd.concat([strategy_returns.rename("s"), bench_returns.rename("b")], axis=1, join="inner").dropna()
    if len(j) < 20:
        return {"alpha_pct": None, "beta": None, "correlation": None, "tracking_error_pct": None,
                "information_ratio": None, "aligned_days": int(len(j))}
    s = j["s"].to_numpy() - rf / ppy
    b = j["b"].to_numpy() - rf / ppy
    var_b = float(np.var(b, ddof=1))
    beta = float(np.cov(s, b, ddof=1)[0, 1] / var_b) if var_b > 0 else None
    alpha = float((np.mean(s) - (beta or 0.0) * np.mean(b)) * ppy) if beta is not None else None
    corr = float(np.corrcoef(s, b)[0, 1]) if np.std(s) > 0 and np.std(b) > 0 else None
    active = j["s"].to_numpy() - j["b"].to_numpy()
    te = float(np.std(active, ddof=1) * math.sqrt(ppy))
    ir = float(np.mean(active) * ppy / te) if te > 1e-12 else None
    return {"alpha_pct": _f(alpha * 100 if alpha is not None else None, 3), "beta": _f(beta, 4),
            "correlation": _f(corr, 4), "tracking_error_pct": _f(te * 100, 3),
            "information_ratio": _f(ir, 3), "aligned_days": int(len(j))}


def calendar_returns(equity: pd.Series, initial: float) -> tuple[List[dict], List[dict]]:
    """Compounded calendar-month and calendar-year returns.

    Each month's return is month-end equity over the previous month-end equity
    (the first month is measured from ``initial``), so the months compound
    exactly to the total return.
    """
    if equity.empty:
        return [], []
    m_end = equity.groupby([equity.index.year, equity.index.month]).last()
    prev = np.concatenate([[initial], m_end.to_numpy()[:-1]])
    monthly = [
        {"year": int(y), "month": int(m), "return_pct": _f((v / p - 1) * 100, 3)}
        for (y, m), v, p in zip(m_end.index, m_end.to_numpy(), prev)
    ]
    y_end = equity.groupby(equity.index.year).last()
    prev_y = np.concatenate([[initial], y_end.to_numpy()[:-1]])
    yearly = [{"year": int(y), "return_pct": _f((v / p - 1) * 100, 3)} for y, v, p in zip(y_end.index, y_end.to_numpy(), prev_y)]
    return monthly, yearly


def trade_stats(trades: Iterable) -> dict:
    pnls = np.array([t.pnl for t in trades], dtype=float)
    n = len(pnls)
    if n == 0:
        return {"total_trades": 0, "win_rate_pct": None, "profit_factor": None, "avg_win": None, "avg_loss": None,
                "expectancy": None, "avg_bars_held": None, "best_trade_pct": None, "worst_trade_pct": None,
                "max_consecutive_losses": 0}
    rets = np.array([t.return_pct for t in trades], dtype=float)
    wins, losses = pnls[pnls > 0], pnls[pnls <= 0]
    gl = float(-losses.sum())
    pf = float(wins.sum() / gl) if gl > 0 else None
    streak = best = 0
    for p in pnls:
        streak = streak + 1 if p <= 0 else 0
        best = max(best, streak)
    return {
        "total_trades": int(n),
        "win_rate_pct": _f(len(wins) / n * 100, 2),
        "profit_factor": _f(pf, 3),
        "avg_win": _f(wins.mean() if len(wins) else None, 2),
        "avg_loss": _f(losses.mean() if len(losses) else None, 2),
        "expectancy": _f(pnls.mean(), 2),
        "avg_bars_held": _f(np.mean([t.bars_held for t in trades]), 1),
        "best_trade_pct": _f(rets.max(), 3),
        "worst_trade_pct": _f(rets.min(), 3),
        "max_consecutive_losses": int(best),
    }


def compute_metrics(
    equity: pd.Series,
    initial: float,
    trades: list,
    gross_exposure: Optional[pd.Series] = None,
    traded_notional: float = 0.0,
    total_commission: float = 0.0,
    benchmark: Optional[pd.Series] = None,
    ppy: Optional[int] = None,
    rf: float = 0.0,
) -> dict:
    """Headline metrics for one equity series (marked at each close)."""
    ppy = ppy or infer_periods_per_year(equity.index)
    # The first point is the close of the first trading bar. No order can fill
    # on that bar (fills are next-open), so it equals ``initial``.
    rets = equity.pct_change().dropna()
    final = float(equity.iloc[-1])
    total = final / initial - 1
    yrs = years_between(equity.index)
    cagr = (final / initial) ** (1 / yrs) - 1 if yrs > 0 and final > 0 else None
    dd = drawdown_stats(equity)
    rs = return_stats(rets, ppy, rf)
    calmar = cagr / abs(dd["max_drawdown_pct"] / 100) if cagr is not None and dd["max_drawdown_pct"] else None
    out = {
        "initial_capital": _f(initial, 2),
        "final_equity": _f(final, 2),
        "total_return_pct": _f(total * 100, 3),
        "cagr_pct": _f(cagr * 100 if cagr is not None else None, 3),
        "years": _f(yrs, 3),
        "annualised_from_under_one_year": bool(yrs < 1),
        "periods_per_year": ppy,
        **rs,
        "calmar": _f(calmar, 3),
        **{k: v for k, v in dd.items() if k != "drawdown"},
        "total_commission": _f(total_commission, 2),
        "bars": int(len(equity)),
    }
    out["risk_free_rate_pct"] = _f(rf * 100, 3)
    if gross_exposure is not None and len(gross_exposure):
        out["exposure_pct"] = _f((gross_exposure > 1e-9).mean() * 100, 2)
        avg_gross = float(gross_exposure.mean())
        out["avg_gross_exposure_pct"] = _f(avg_gross * 100, 2)
        out["exposure_adjusted_cagr_pct"] = _f(cagr / avg_gross * 100 if cagr is not None and avg_gross > 1e-9 else None, 3)
    r_np = rets.to_numpy(dtype=float)
    if len(r_np) >= 20:
        q = float(np.percentile(r_np, 5))
        out["var_95_daily_pct"] = _f(q * 100, 3)
        out["cvar_95_daily_pct"] = _f(float(r_np[r_np <= q].mean()) * 100, 3)
    else:
        out["var_95_daily_pct"] = out["cvar_95_daily_pct"] = None
    monthly, _ = calendar_returns(equity, initial)
    mvals = [x["return_pct"] for x in monthly if x["return_pct"] is not None]
    out["best_month_pct"] = _f(max(mvals), 3) if mvals else None
    out["worst_month_pct"] = _f(min(mvals), 3) if mvals else None
    out["positive_months_pct"] = _f(sum(v > 0 for v in mvals) / len(mvals) * 100, 2) if mvals else None
    avg_eq = float(equity.mean())
    out["turnover_annual"] = _f(traded_notional / avg_eq / yrs if yrs > 0 and avg_eq > 0 else None, 3)
    out.update(trade_stats(trades))
    if benchmark is not None and len(benchmark) > 1:
        # Returns are measured between dates where *both* series have a bar,
        # so a holiday on one calendar never pairs a 0% day with a 2-day move.
        bb = benchmark.dropna()
        common = equity.index.intersection(bb.index)
        out.update(alpha_beta(equity.loc[common].pct_change().dropna(), bb.loc[common].pct_change().dropna(), ppy, rf))
        b = bb.loc[(bb.index >= equity.index[0]) & (bb.index <= equity.index[-1])]
        if len(b) > 1:
            b_total = float(b.iloc[-1] / b.iloc[0] - 1)
            b_yrs = years_between(b.index)
            out["benchmark"] = {
                "total_return_pct": _f(b_total * 100, 3),
                "cagr_pct": _f(((1 + b_total) ** (1 / b_yrs) - 1) * 100 if b_yrs > 0 else None, 3),
                **return_stats(b.pct_change().dropna(), ppy, rf),
                "max_drawdown_pct": drawdown_stats(b)["max_drawdown_pct"],
            }
    return out


def downsample_index(n: int, max_points: int = 600) -> np.ndarray:
    if n <= max_points:
        return np.arange(n)
    idx = np.unique(np.linspace(0, n - 1, max_points).round().astype(int))
    return idx


ROLLING_SHARPE_WINDOW = 126  # ~6 months of trading days


def rolling_sharpe(equity: pd.Series, ppy: int, window: int = ROLLING_SHARPE_WINDOW, rf: float = 0.0) -> pd.Series:
    """Trailing ``window``-bar annualised Sharpe of daily excess returns.

    NaN until a full window exists, and where the window has no variance
    (flat, out of the market), so a flat stretch never reads as 0 or inf.
    """
    ex = equity.pct_change() - rf / ppy
    m = ex.rolling(window, min_periods=window).mean()
    sd = ex.rolling(window, min_periods=window).std(ddof=1)
    return (m / sd.where(sd > 1e-12) * math.sqrt(ppy)).reindex(equity.index)


def series_payload(equity: pd.Series, initial: float, benchmark: Optional[pd.Series], max_points: int = 600,
                   ppy: int = 252, rf: float = 0.0) -> dict:
    """Chart series on one shared date grid (equity, benchmark rebased to the
    same starting capital, drawdown %, trailing 6-month Sharpe)."""
    dd = drawdown_stats(equity)["drawdown"]
    rs = rolling_sharpe(equity, ppy, rf=rf)
    b = None
    if benchmark is not None and len(benchmark):
        b = benchmark.reindex(equity.index).ffill()
        first = b.first_valid_index()
        if first is not None:
            b = b / b.loc[first] * initial
    keep = downsample_index(len(equity), max_points)
    rows = []
    for k in keep:
        ts = equity.index[k]
        rows.append({
            "date": ts.date().isoformat(),
            "equity": _f(equity.iloc[k], 2),
            "benchmark": _f(b.iloc[k], 2) if b is not None else None,
            "drawdown_pct": _f(dd.iloc[k] * 100, 3),
            "rolling_sharpe": _f(rs.iloc[k], 3),
        })
    return {"points": rows, "sampled": len(keep) < len(equity), "rolling_sharpe_window": ROLLING_SHARPE_WINDOW}
