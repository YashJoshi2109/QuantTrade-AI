"""Scenario planner: portfolio P&L under a market shock or a replayed historical episode.

Historical episodes are defined by dates only (S&P 500 peak to trough). Their
returns are measured from adjusted closes at request time, never hard-coded.
A holding that did not trade through the episode gets beta x the SPY move,
with beta estimated from the last year of daily returns; the response says
which method each holding used.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Dict, List, Optional, Sequence

HISTORICAL: List[Dict] = [
    {"id": "gfc_2008", "label": "Global financial crisis", "start": "2007-10-09", "end": "2009-03-09",
     "description": "S&P 500 peak in October 2007 to the March 2009 low."},
    {"id": "dotcom_2000", "label": "Dot-com bust", "start": "2000-03-24", "end": "2002-10-09",
     "description": "S&P 500 peak in March 2000 to the October 2002 low."},
    {"id": "covid_2020", "label": "COVID crash", "start": "2020-02-19", "end": "2020-03-23",
     "description": "Pre-pandemic high to the March 2020 low, about five weeks."},
    {"id": "rates_2022", "label": "2022 rate shock", "start": "2022-01-03", "end": "2022-10-12",
     "description": "Inflation and Fed tightening bear market, January to October 2022."},
    {"id": "q4_2018", "label": "Q4 2018 selloff", "start": "2018-09-20", "end": "2018-12-24",
     "description": "Fed tightening and trade-war drawdown into Christmas Eve 2018."},
    {"id": "carry_2024", "label": "Aug 2024 carry unwind", "start": "2024-07-16", "end": "2024-08-05",
     "description": "Yen carry-trade unwind and growth scare, July to 5 August 2024."},
]
HISTORICAL_BY_ID = {h["id"]: h for h in HISTORICAL}

BETA_MIN, BETA_MAX = -1.0, 3.0
MIN_BETA_OBS = 120


def beta(asset_returns: Sequence[float], market_returns: Sequence[float]) -> Optional[float]:
    """OLS beta of paired daily returns; None with too little data or a flat market."""
    pairs = [(a, m) for a, m in zip(asset_returns, market_returns)
             if a is not None and m is not None and math.isfinite(a) and math.isfinite(m)]
    if len(pairs) < MIN_BETA_OBS:
        return None
    n = len(pairs)
    ma = sum(a for a, _ in pairs) / n
    mm = sum(m for _, m in pairs) / n
    cov = sum((a - ma) * (m - mm) for a, m in pairs) / (n - 1)
    var = sum((m - mm) ** 2 for _, m in pairs) / (n - 1)
    if var <= 0:
        return None
    return max(BETA_MIN, min(BETA_MAX, cov / var))


def window_return(closes: Dict[date, float], start: date, end: date) -> Optional[float]:
    """Return from the first close on/after ``start`` to the last close on/before ``end``.

    None unless the series covers both ends within 7 calendar days (a symbol
    that listed mid-episode did not live through it).
    """
    days = sorted(d for d in closes if closes[d] and closes[d] > 0)
    first = next((d for d in days if d >= start), None)
    last = next((d for d in reversed(days) if d <= end), None)
    if first is None or last is None or last <= first:
        return None
    if (first - start).days > 7 or (end - last).days > 7:
        return None
    return closes[last] / closes[first] - 1.0


def apply(holdings: List[Dict], *, market_return: float, symbol_returns: Optional[Dict[str, float]] = None,
          betas: Optional[Dict[str, Optional[float]]] = None,
          overrides: Optional[Dict[str, float]] = None) -> Dict:
    """P&L per holding. Precedence: user override > measured symbol return > beta x market > 1 x market.

    ``holdings``: [{"symbol", "shares", "price"}]; returns are decimals (-0.2 = -20%).
    """
    symbol_returns = symbol_returns or {}
    betas = betas or {}
    overrides = {k.upper(): v for k, v in (overrides or {}).items()}
    rows: List[Dict] = []
    value = pnl = 0.0
    for h in holdings:
        sym = h["symbol"].upper()
        shares, price = float(h["shares"]), h.get("price")
        if price is None or price <= 0:
            rows.append({"symbol": sym, "shares": shares, "price": None, "value": None, "shock_pct": None,
                         "pnl": None, "stressed_value": None, "method": "no_price", "beta": betas.get(sym)})
            continue
        b = betas.get(sym)
        if sym in overrides:
            ret, method = overrides[sym], "override"
        elif sym in symbol_returns and symbol_returns[sym] is not None:
            ret, method = symbol_returns[sym], "actual"
        elif b is not None:
            ret, method = b * market_return, "beta"
        else:
            ret, method = market_return, "assumed_beta_1"
        ret = max(ret, -1.0)  # a long position cannot lose more than its value
        v = shares * price
        p = v * ret
        value += v
        pnl += p
        rows.append({"symbol": sym, "shares": shares, "price": round(price, 4), "value": round(v, 2),
                     "shock_pct": round(ret * 100, 2), "pnl": round(p, 2), "stressed_value": round(v + p, 2),
                     "method": method, "beta": None if b is None else round(b, 3)})
    rows.sort(key=lambda r: (r["pnl"] is None, r["pnl"] or 0.0))
    return {
        "holdings": rows,
        "total_value": round(value, 2),
        "total_pnl": round(pnl, 2),
        "total_pnl_pct": round(pnl / value * 100, 2) if value > 0 else None,
        "stressed_value": round(value + pnl, 2),
        "market_return_pct": round(market_return * 100, 2),
    }
