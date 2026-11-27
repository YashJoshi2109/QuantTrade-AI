"""Plausibility + completeness layer for fundamentals.

Two jobs, applied where /api/v1/enhanced/fundamentals assembles its payload
(the frontend mirrors the same rules in frontend/src/lib/fundamentalSanity.ts
for values that reach the stats card / Company Folio from other routes):

1. Reject values that cannot be true for the current price. PARA on
   2026-11-27 (microcap at $2.74, after an unadjusted reverse split) showed a
   52-week high of $39,200, EPS of $25,891 with a $1.86M market cap, ROE of
   -250% and a $24,000 target. Each such value becomes ``None`` with a reason
   in ``field_notes`` so the UI shows "—" plus a tooltip instead of a "fact".

2. Fill values providers omitted from data we already hold: market cap =
   shares x price, P/E = price / TTM diluted EPS (SEC XBRL statements), with
   the source in ``field_notes``. P/E of a loss-maker is "n/m", not blank.

Pure functions on dicts, so they are unit-tested without a DB.
"""
from __future__ import annotations

import json
import math
from typing import Dict, Optional, Tuple

# Thresholds (shared with frontend/src/lib/fundamentalSanity.ts).
HIGH_52W_MAX_MULT = 50.0       # 52w high more than 50x the price
LOW_52W_MIN_DIV = 50.0         # 52w low under price / 50
RANGE_TOLERANCE = 0.03         # price may sit 3% outside a cached range (stale by a day)
EPS_EARNINGS_MAX_MULT = 20.0   # |EPS| x shares > 20x market cap  <=>  |EPS| > 20x price
RATIO_ABS_MAX = 200.0          # |ROE|, |ROA| in percent
TARGET_MAX_MULT = 20.0         # analyst target more than 20x away from price
MIN_POSITIVE_PE = 0.5          # P/E under 0.5 means EPS > 2x the price
BETA_ABS_MAX = 10.0
DIVIDEND_YIELD_MAX = 30.0      # percent


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _fmt(v: float) -> str:
    return f"{v:,.2f}"


def implausible_reasons(f: Dict, price: Optional[float]) -> Dict[str, str]:
    """{field: reason} for values that contradict the price (or each other)."""
    out: Dict[str, str] = {}
    p = _num(price)
    if p is not None and p <= 0:
        p = None
    hi, lo = _num(f.get("week_52_high")), _num(f.get("week_52_low"))
    if p:
        if hi is not None and hi > p * HIGH_52W_MAX_MULT:
            out["week_52_high"] = f"52-week high ${_fmt(hi)} is over {HIGH_52W_MAX_MULT:g}x the price (${_fmt(p)}): likely an unadjusted split."
        elif hi is not None and hi < p * (1 - RANGE_TOLERANCE):
            out["week_52_high"] = f"52-week high ${_fmt(hi)} is below the current price (${_fmt(p)})."
        if lo is not None and lo < p / LOW_52W_MIN_DIV:
            out["week_52_low"] = f"52-week low ${_fmt(lo)} is under 1/{LOW_52W_MIN_DIV:g} of the price: likely an unadjusted split."
        elif lo is not None and lo > p * (1 + RANGE_TOLERANCE):
            out["week_52_low"] = f"52-week low ${_fmt(lo)} is above the current price (${_fmt(p)})."
        eps = _num(f.get("eps"))
        if eps is not None and abs(eps) > p * EPS_EARNINGS_MAX_MULT:
            out["eps"] = (f"EPS ${_fmt(eps)} implies earnings over {EPS_EARNINGS_MAX_MULT:g}x the market cap "
                          f"at ${_fmt(p)} a share: likely not split-adjusted.")
        tgt = _num(f.get("target_price"))
        if tgt is not None and tgt > 0 and (tgt > p * TARGET_MAX_MULT or tgt < p / TARGET_MAX_MULT):
            out["target_price"] = f"Analyst target ${_fmt(tgt)} is more than {TARGET_MAX_MULT:g}x away from the price."
    if hi is not None and lo is not None and lo > hi:
        out["week_52_low"] = out["week_52_high"] = "52-week low is above the 52-week high."
    for k in ("pe_ratio", "forward_pe"):
        v = _num(f.get(k))
        if v is not None and 0 < v < MIN_POSITIVE_PE:
            out[k] = f"P/E of {v:.4f} implies EPS over {1 / MIN_POSITIVE_PE:g}x the share price."
    for k, label in (("roe", "ROE"), ("roa", "ROA")):
        v = _num(f.get(k))
        if v is not None and abs(v) > RATIO_ABS_MAX:
            out[k] = f"{label} of {v:.0f}% is outside ±{RATIO_ABS_MAX:g}% (tiny or negative equity base)."
    b = _num(f.get("beta"))
    if b is not None and abs(b) > BETA_ABS_MAX:
        out["beta"] = f"Beta of {b:.1f} is not meaningful (short or broken price history)."
    dy = _num(f.get("dividend_yield"))
    if dy is not None and dy > DIVIDEND_YIELD_MAX:
        out["dividend_yield"] = f"Dividend yield of {dy:.1f}% is implausible for common stock."
    return out


def sanitize(f: Dict, price: Optional[float]) -> Dict:
    """Copy of ``f`` with implausible values set to None and reasons in field_notes."""
    out = dict(f)
    notes = dict(out.get("field_notes") or {})
    for k, reason in implausible_reasons(f, price).items():
        out[k] = None
        notes[k] = {"status": "implausible", "reason": reason}
    out["field_notes"] = notes
    return out


def _json_value(raw) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return _num(raw)
    try:
        return _num(json.loads(raw).get("value"))
    except Exception:
        return None


def sec_ttm_eps_and_shares(statements) -> Tuple[Optional[float], Optional[float], str]:
    """(TTM diluted EPS, latest diluted shares, source) from FinancialStatement rows.

    TTM = sum of the latest four quarterly diluted EPS when they are
    consecutive; otherwise the latest annual figure.
    """
    rows = list(statements or [])
    q = sorted((r for r in rows if getattr(r, "fiscal_quarter", None)),
               key=lambda r: (getattr(r, "period_end_date", "") or ""), reverse=True)
    fy = sorted((r for r in rows if not getattr(r, "fiscal_quarter", None)),
                key=lambda r: (getattr(r, "period_end_date", "") or ""), reverse=True)
    shares = None
    for r in q + fy:
        shares = _json_value(getattr(r, "shares_diluted", None)) or _json_value(getattr(r, "shares_basic", None))
        if shares:
            break
    eps_q = [_json_value(getattr(r, "eps_diluted", None)) for r in q[:4]]
    if len(eps_q) == 4 and all(v is not None for v in eps_q):
        return sum(eps_q), shares, "SEC XBRL: sum of the last 4 quarterly diluted EPS"
    for r in fy:
        v = _json_value(getattr(r, "eps_diluted", None))
        if v is not None:
            return v, shares, f"SEC XBRL: diluted EPS for {getattr(r, 'period', 'the latest fiscal year')}"
    return None, shares, ""


def fill_missing(f: Dict, price: Optional[float], *, ttm_eps: Optional[float] = None,
                 shares: Optional[float] = None, eps_source: str = "", shares_source: str = "",
                 is_fund: bool = False) -> Dict:
    """Derive market cap / P/E when providers omitted them. Never overwrites."""
    out = dict(f)
    notes = dict(out.get("field_notes") or {})
    p = _num(price)
    if p and p > 0:
        if out.get("market_cap") is None and shares and shares > 0:
            out["market_cap"] = round(shares * p, 0)
            notes["market_cap"] = {"status": "derived",
                                   "source": f"{shares_source or 'shares outstanding'} x price ${_fmt(p)}"}
        if out.get("pe_ratio") is None and not is_fund and ttm_eps is not None:
            if ttm_eps > 0 and p / ttm_eps >= MIN_POSITIVE_PE:
                out["pe_ratio"] = round(p / ttm_eps, 2)
                notes["pe_ratio"] = {"status": "derived", "source": f"price / TTM EPS ({eps_source})"}
            elif ttm_eps <= 0:
                notes["pe_ratio"] = {"status": "n/m", "reason": "Not meaningful: trailing EPS is negative."}
    if is_fund:
        for k in ("pe_ratio", "eps"):
            if out.get(k) is None:
                notes.setdefault(k, {"status": "n/a", "reason": "Not applicable to funds/ETFs."})
    out["field_notes"] = notes
    return out
