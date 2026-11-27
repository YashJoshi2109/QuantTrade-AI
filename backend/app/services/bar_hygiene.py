"""Daily-bar hygiene shared by every bar-returning path.

Providers sometimes return a session row with no prices (yfinance gave PARA a
2026-11-23 bar with open/high/low/close all NaN and volume 0 around an
unadjusted reverse split). Those rows broke SMA/Bollinger (NaN propagates
through every rolling window) and crashed the Research chart. Rules:

* a bar without a finite, positive close is dropped (or replaced by the
  Alpaca SIP bar for that session when one exists);
* missing/invalid open/high/low are filled from the close, and high/low are
  widened to contain open and close;
* ``split_breaks`` finds day-over-day jumps that are almost certainly
  unadjusted splits, so indicators/forecasts only use the clean tail.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# A close-to-close move beyond 4x up or down in one session is treated as an
# unadjusted split / ticker reuse, not a market move (the largest genuine
# one-day moves of liquid US stocks are well under this).
SPLIT_JUMP_RATIO = 4.0


def finite_pos(x) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


def clean_ohlc(o, h, l, c) -> Optional[Tuple[float, float, float, float]]:
    """(o, h, l, c) with gaps filled from the close, or None when close is unusable."""
    close = finite_pos(c)
    if close is None:
        return None
    op = finite_pos(o) or close
    hi = finite_pos(h) or max(op, close)
    lo = finite_pos(l) or min(op, close)
    hi = max(hi, op, close)
    lo = min(lo, op, close)
    return op, hi, lo, close


def is_valid_bar(bar) -> bool:
    return finite_pos(_get(bar, "close")) is not None


def _get(bar, k):
    return bar.get(k) if isinstance(bar, dict) else getattr(bar, k, None)


def clean_bar_dicts(bars: Iterable) -> List[dict]:
    """Bars (ORM objects or dicts) -> dicts with valid OHLC; invalid ones dropped."""
    out = []
    for b in bars:
        ohlc = clean_ohlc(_get(b, "open"), _get(b, "high"), _get(b, "low"), _get(b, "close"))
        if ohlc is None:
            continue
        vol = _get(b, "volume")
        try:
            vol = int(vol) if vol is not None and math.isfinite(float(vol)) else 0
        except (TypeError, ValueError):
            vol = 0
        out.append({"timestamp": _get(b, "timestamp"), "open": ohlc[0], "high": ohlc[1],
                    "low": ohlc[2], "close": ohlc[3], "volume": vol})
    return out


def clean_ohlcv_df(df):
    """DataFrame with open/high/low/close/volume columns: drop bad closes, fill o/h/l."""
    import numpy as np
    import pandas as pd

    if df is None or getattr(df, "empty", True) or "close" not in df.columns:
        return df
    out = df.copy()
    close = pd.to_numeric(out["close"], errors="coerce")
    out = out[close.notna() & np.isfinite(close) & (close > 0)].copy()
    if out.empty:
        return out
    c = pd.to_numeric(out["close"], errors="coerce")
    for col in ("open", "high", "low"):
        if col not in out.columns:
            out[col] = c
        v = pd.to_numeric(out[col], errors="coerce")
        out[col] = v.where(v.notna() & (v > 0), c)
    out["high"] = out[["high", "open", "close"]].max(axis=1)
    out["low"] = out[["low", "open", "close"]].min(axis=1)
    if "volume" in out.columns:
        out["volume"] = pd.to_numeric(out["volume"], errors="coerce").fillna(0)
    return out


def split_breaks(closes: Sequence[float], ratio: float = SPLIT_JUMP_RATIO) -> List[int]:
    """Indexes i where closes[i] / closes[i-1] is beyond ``ratio`` either way."""
    out = []
    for i in range(1, len(closes)):
        a, b = finite_pos(closes[i - 1]), finite_pos(closes[i])
        if a and b and (b / a > ratio or a / b > ratio):
            out.append(i)
    return out


def clean_tail_start(closes: Sequence[float], ratio: float = SPLIT_JUMP_RATIO) -> int:
    """Index where the last split-free stretch of the series starts (0 if none)."""
    br = split_breaks(closes, ratio)
    return br[-1] if br else 0


# ── Alpaca SIP fill ────────────────────────────────────────────────────────

def sip_bars_by_date(symbol: str, days: int) -> Dict[date, Tuple[float, float, float, float, float]]:
    """{session_date: (o, h, l, c, v)} from Alpaca SIP daily bars; {} when unavailable."""
    try:
        from app.services.alpaca_client import alpaca_client

        rows = alpaca_client.get_daily_bars_sip([symbol], days=days).get(symbol.upper()) or []
    except Exception as e:
        logger.debug("SIP daily bars failed for %s: %s", symbol, e)
        return {}
    return {d: (o, h, l, c, v) for d, o, h, l, c, v in rows if finite_pos(c)}


def _as_date(ts) -> Optional[date]:
    if isinstance(ts, datetime):
        return ts.date()
    if isinstance(ts, date):
        return ts
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).date()
    except Exception:
        return None


def repair_bars_from_sip(symbol: str, bars: Sequence, now: Optional[datetime] = None) -> Dict[date, tuple]:
    """For bars whose close is unusable, return SIP replacements keyed by date.

    The caller decides whether to persist them. Bounded: only asks Alpaca when
    at least one bad bar exists, for a window just covering the oldest one.
    """
    bad = [_as_date(_get(b, "timestamp")) for b in bars if not is_valid_bar(b)]
    bad = [d for d in bad if d]
    if not bad:
        return {}
    today = (now or datetime.utcnow()).date()
    days = min(3 * 365, (today - min(bad)).days + 5)
    sip = sip_bars_by_date(symbol, days)
    return {d: sip[d] for d in bad if d in sip}
