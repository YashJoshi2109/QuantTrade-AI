"""One place that decides the units of `fundamentals` table values.

The table is written by several fetchers: finviz stores percents (ROE 142.26,
dividend yield 0.30 meaning 0.30%), yfinance stores ratios (ROE 1.4226,
dividend yield 0.003).  Consumers multiplied by 100 "to be safe" and showed
ROE 14226%.  Contract after normalisation:

  * PERCENT_FIELDS are percentage points (142.26 == 142.26 %)
  * debt_to_equity is a plain ratio (0.66), never percent (yfinance gives 66.0)

Row-level detection: a row is ratio-style when every present margin (and ROA)
field has |v| <= 1.  Dividend yield alone can't be classified, so it follows
the row; a dividend-only row is assumed percent (finviz).
"""
from __future__ import annotations

import math
from typing import Any, Dict, Mapping, Optional

PERCENT_FIELDS = ("profit_margin", "operating_margin", "gross_margin", "roe", "roa", "roi", "roic",
                  "dividend_yield", "payout_ratio", "insider_ownership", "institutional_ownership",
                  "short_float", "quarterly_revenue_growth", "quarterly_earnings_growth")
# Margins can never exceed 100%, so they classify the row; ROE can (AAPL ~142%).
_DETECT = ("profit_margin", "operating_margin", "gross_margin", "roa")


def _f(v: Any) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def is_ratio_row(row: Mapping[str, Any]) -> bool:
    vals = [x for x in (_f(row.get(k)) for k in _DETECT) if x]
    return bool(vals) and all(abs(x) <= 1.0 for x in vals)


def normalize_fundamental_units(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Copy of `row` with PERCENT_FIELDS in percentage points and D/E as a ratio."""
    out = dict(row)
    ratio = is_ratio_row(row)
    for k in PERCENT_FIELDS:
        v = _f(row.get(k))
        if v is not None:
            out[k] = round(v * 100, 4) if ratio else v
    de = _f(row.get("debt_to_equity"))
    if de is not None and de > 10:          # yfinance reports D/E as a percent (66.0 == 0.66x)
        out["debt_to_equity"] = round(de / 100, 4)
    return out
