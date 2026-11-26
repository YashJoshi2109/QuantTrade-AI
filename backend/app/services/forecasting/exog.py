"""Exogenous regressors for SARIMAX that are KNOWN at forecast time.

A SARIMAX forecast h days ahead needs exog values for every day t+1..t+h.
Contemporaneous market data (today's SPY return, today's VIX) is unknown on
those days, so using it would be look-ahead. Every column here declares
``known_ahead``: how many future days its value is known at the forecast
origin.

- Calendar dummies (day of week, turn of month, January) are deterministic:
  ``known_ahead=None`` (unlimited).
- Market series enter lagged by L trading days: the feature on day s uses raw
  data up to s-L only, so it is known L days ahead. For horizon h we build
  lag L = h (the smallest valid lag).
- Earnings-session dummies use the published schedule. Dates are usually set
  a few weeks ahead, so they are trusted only 20 trading days out.

Two guards make leakage fail loudly instead of silently:

1. ``columns_for_horizon`` drops any column with ``known_ahead < h``.
2. ``future_exog`` builds the future rows from raw data truncated at the
   origin. A value that would need data after the origin comes out NaN, and
   ``ExogLeakageError`` is raised. Asking for a lag-1 column at h=5 raises.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

import numpy as np
import pandas as pd

EARNINGS_KNOWN_AHEAD = 20
CALENDAR_COLUMNS = ("dow_mon", "dow_tue", "dow_wed", "dow_thu", "turn_of_month", "january")
# raw column -> feature family. Raw columns are closes / levels aligned to the
# target's trading dates.
RAW_FAMILIES = {
    "mkt": "market",      # SPY close
    "sector": "sector",   # sector ETF close
    "vix": "vix",         # ^VIX level
    "tnx": "rates",       # ^TNX (10y yield, %)
}


class ExogLeakageError(ValueError):
    """An exogenous value needed for the forecast is not known at the origin."""


@dataclass(frozen=True)
class ExogColumn:
    name: str
    family: str
    known_ahead: Optional[int]  # None = deterministic, known for any horizon

    def usable_for(self, h: int) -> bool:
        return self.known_ahead is None or self.known_ahead >= h


def calendar_frame(dates: pd.DatetimeIndex, next_after_last: Optional[pd.Timestamp] = None) -> pd.DataFrame:
    """Deterministic calendar dummies for a sequence of trading dates.

    Turn of month = last trading day of a month plus the first three. The last
    row needs the following trading date to know if it ends a month; pass it as
    ``next_after_last`` (from the exchange calendar), else it is assumed not to.
    """
    d = pd.DatetimeIndex(dates)
    out = pd.DataFrame(index=d)
    dow = d.dayofweek
    for i, c in enumerate(("dow_mon", "dow_tue", "dow_wed", "dow_thu")):
        out[c] = (dow == i).astype(float)
    months = d.month.to_numpy()
    nxt = np.empty(len(d), dtype=int)
    nxt[:-1] = months[1:]
    nxt[-1] = next_after_last.month if next_after_last is not None else (months[-1] if len(d) else 0)
    last_of_month = nxt != months
    prev = np.empty(len(d), dtype=int)
    if len(d):
        prev[0] = months[0]
        prev[1:] = months[:-1]
    first = prev != months
    # first three sessions: first, and the two after it
    first_idx = np.flatnonzero(first)
    tom = last_of_month.copy()
    for i in first_idx:
        tom[i:i + 3] = True
    out["turn_of_month"] = tom.astype(float)
    out["january"] = (d.month == 1).astype(float)
    return out


def _lagged_features(raw: pd.DataFrame, lag: int) -> pd.DataFrame:
    """Market features on each row s using raw rows <= s - lag only."""
    L = int(lag)
    f = pd.DataFrame(index=raw.index)
    if "mkt" in raw:
        lr = np.log(raw["mkt"])
        f[f"mkt_ret_l{L}"] = 100 * (lr.shift(L) - lr.shift(2 * L))
    if "sector" in raw:
        lr = np.log(raw["sector"])
        f[f"sector_ret_l{L}"] = 100 * (lr.shift(L) - lr.shift(2 * L))
    if "vix" in raw:
        f[f"vix_log_l{L}"] = np.log(raw["vix"]).shift(L)
    if "tnx" in raw:
        f[f"rate_chg_l{L}"] = raw["tnx"].shift(L) - raw["tnx"].shift(2 * L)
    return f


def column_specs(raw_columns: Iterable[str], lag: int, earnings: bool) -> list[ExogColumn]:
    cols = [ExogColumn(c, "calendar", None) for c in CALENDAR_COLUMNS]
    names = {"mkt": f"mkt_ret_l{lag}", "sector": f"sector_ret_l{lag}",
             "vix": f"vix_log_l{lag}", "tnx": f"rate_chg_l{lag}"}
    for rc in raw_columns:
        if rc in names:
            cols.append(ExogColumn(names[rc], RAW_FAMILIES[rc], int(lag)))
    if earnings:
        cols.append(ExogColumn("earnings_session", "earnings", EARNINGS_KNOWN_AHEAD))
    return cols


def columns_for_horizon(specs: Sequence[ExogColumn], h: int) -> list[ExogColumn]:
    return [c for c in specs if c.usable_for(h)]


def build_features(hist_dates: pd.DatetimeIndex, raw: Optional[pd.DataFrame], lag: int,
                   future_dates: Sequence[pd.Timestamp] = (), earnings_sessions: Optional[set] = None,
                   ) -> pd.DataFrame:
    """Feature rows for ``hist_dates`` followed by ``future_dates``.

    ``raw`` must cover ``hist_dates`` only (it is the data known at the
    origin); future rows are filled from lags of it, NaN where unknowable.
    """
    future = pd.DatetimeIndex(list(future_dates))
    all_dates = pd.DatetimeIndex(hist_dates).append(future)
    cal = calendar_frame(all_dates)
    parts = [cal]
    if raw is not None and len(raw.columns):
        r = raw.reindex(hist_dates).reindex(all_dates)  # future rows NaN: unknown at origin
        parts.append(_lagged_features(r, lag))
    if earnings_sessions is not None:
        sessions = {pd.Timestamp(d).normalize() for d in earnings_sessions}
        e = pd.Series([1.0 if d.normalize() in sessions else 0.0 for d in all_dates], index=all_dates)
        parts.append(e.rename("earnings_session").to_frame())
    return pd.concat(parts, axis=1)


def future_exog(features: pd.DataFrame, n_hist: int, h: int, specs: Sequence[ExogColumn]) -> np.ndarray:
    """Exog rows for the h forecast days. Raises ExogLeakageError if any value
    would need data after the origin (declared or actual)."""
    bad = [c.name for c in specs if not c.usable_for(h)]
    if bad:
        raise ExogLeakageError(f"columns {bad} are not known {h} days ahead")
    names = [c.name for c in specs]
    block = features.iloc[n_hist:n_hist + h][names]
    if len(block) < h:
        raise ExogLeakageError(f"only {len(block)} future rows for horizon {h}")
    vals = block.to_numpy(dtype=float)
    if not np.all(np.isfinite(vals)):
        missing = sorted({names[j] for j in np.argwhere(~np.isfinite(vals))[:, 1]})
        raise ExogLeakageError(f"columns {missing} need data after the forecast origin")
    return vals


def earnings_sessions_from_timestamps(stamps: Iterable[pd.Timestamp], trading_dates: pd.DatetimeIndex,
                                      future_dates: Sequence[pd.Timestamp] = ()) -> set:
    """Map announcement timestamps to the first session that can react.

    Before noon ET (pre-market) -> that day; otherwise the next trading day.
    """
    days = pd.DatetimeIndex(trading_dates).append(pd.DatetimeIndex(list(future_dates))).normalize()
    out = set()
    for ts in stamps:
        ts = pd.Timestamp(ts)
        if ts.tzinfo is not None:
            ts = ts.tz_convert("America/New_York").tz_localize(None)
        day = ts.normalize()
        target = day if ts.hour < 12 else day + pd.Timedelta(days=1)
        pos = days.searchsorted(target)
        if pos < len(days):
            out.add(days[pos])
    return out
