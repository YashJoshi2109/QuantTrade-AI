"""
Black-Scholes pricing, implied volatility and Greeks for option-chain display.

Used to fill in the fields our providers leave blank: Public.com's chain
returns bid/ask/last/volume/OI only, and yfinance adds implied volatility but
no Greeks. Everything here is pure math (stdlib only) so it is cheap to run on
a full chain and easy to unit-test against textbook values.

Conventions (match what retail brokers display):
- delta, gamma: per $1 move in the underlying
- theta: per calendar day (annual theta / 365)
- vega: per 1 volatility point (annual vega / 100)
- rho: per 1 percentage point change in rates (annual rho / 100)
"""
from __future__ import annotations

import math
import os
from datetime import date, datetime, time, timezone, timedelta
from typing import Any, Dict, Iterable, Optional

# ~3-month T-bill yield. Override with OPTIONS_RISK_FREE_RATE (decimal, e.g. 0.045).
DEFAULT_RISK_FREE_RATE = 0.043

# US equity options stop trading at 16:00 ET. ET is UTC-5 (EST) or UTC-4 (EDT);
# using 21:00 UTC is within an hour either way, which is noise next to IV error.
_EXPIRY_UTC = time(21, 0)
_MIN_T = 1.0 / (365.0 * 24.0)  # one hour, keeps same-day expiries finite


def risk_free_rate() -> float:
    raw = os.getenv("OPTIONS_RISK_FREE_RATE")
    if raw:
        try:
            val = float(raw)
            if -0.05 < val < 0.25:
                return val
        except ValueError:
            pass
    return DEFAULT_RISK_FREE_RATE


def year_fraction(expiration: str | date, now: Optional[datetime] = None) -> float:
    """Years from `now` (UTC) until the 16:00 ET close on the expiration date."""
    exp_date = expiration if isinstance(expiration, date) else date.fromisoformat(str(expiration)[:10])
    expiry = datetime.combine(exp_date, _EXPIRY_UTC, tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    seconds = (expiry - now).total_seconds()
    return max(seconds / (365.0 * 86400.0), _MIN_T)


def _norm_cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _d1_d2(spot: float, strike: float, t: float, r: float, sigma: float, q: float = 0.0):
    vol_sqrt_t = sigma * math.sqrt(t)
    d1 = (math.log(spot / strike) + (r - q + 0.5 * sigma * sigma) * t) / vol_sqrt_t
    return d1, d1 - vol_sqrt_t


def bs_price(spot: float, strike: float, t: float, r: float, sigma: float,
             is_call: bool, q: float = 0.0) -> float:
    d1, d2 = _d1_d2(spot, strike, t, r, sigma, q)
    if is_call:
        return spot * math.exp(-q * t) * _norm_cdf(d1) - strike * math.exp(-r * t) * _norm_cdf(d2)
    return strike * math.exp(-r * t) * _norm_cdf(-d2) - spot * math.exp(-q * t) * _norm_cdf(-d1)


def bs_greeks(spot: float, strike: float, t: float, r: float, sigma: float,
              is_call: bool, q: float = 0.0) -> Dict[str, float]:
    """Delta, gamma, theta (per day), vega (per vol point), rho (per 1% rate)."""
    d1, d2 = _d1_d2(spot, strike, t, r, sigma, q)
    sqrt_t = math.sqrt(t)
    disc_r = math.exp(-r * t)
    disc_q = math.exp(-q * t)
    pdf_d1 = _norm_pdf(d1)

    gamma = disc_q * pdf_d1 / (spot * sigma * sqrt_t)
    vega = spot * disc_q * pdf_d1 * sqrt_t
    decay = -spot * disc_q * pdf_d1 * sigma / (2.0 * sqrt_t)
    if is_call:
        delta = disc_q * _norm_cdf(d1)
        theta = decay - r * strike * disc_r * _norm_cdf(d2) + q * spot * disc_q * _norm_cdf(d1)
        rho = strike * t * disc_r * _norm_cdf(d2)
    else:
        delta = -disc_q * _norm_cdf(-d1)
        theta = decay + r * strike * disc_r * _norm_cdf(-d2) - q * spot * disc_q * _norm_cdf(-d1)
        rho = -strike * t * disc_r * _norm_cdf(-d2)

    return {
        "delta": delta,
        "gamma": gamma,
        "theta": theta / 365.0,
        "vega": vega / 100.0,
        "rho": rho / 100.0,
    }


def implied_volatility(price: float, spot: float, strike: float, t: float, r: float,
                       is_call: bool, q: float = 0.0,
                       lo: float = 1e-4, hi: float = 5.0, tol: float = 1e-6) -> Optional[float]:
    """Solve BS price == `price` for sigma by bisection. None when the price sits
    outside the no-arbitrage band (deep ITM quotes below intrinsic, stale lasts)."""
    if not (price > 0 and spot > 0 and strike > 0 and t > 0):
        return None
    p_lo = bs_price(spot, strike, t, r, lo, is_call, q)
    p_hi = bs_price(spot, strike, t, r, hi, is_call, q)
    if not (p_lo - tol <= price <= p_hi + tol):
        return None
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if bs_price(spot, strike, t, r, mid, is_call, q) > price:
            hi = mid
        else:
            lo = mid
        if hi - lo < tol:
            break
    return 0.5 * (lo + hi)


def _pos(val: Any) -> Optional[float]:
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f) or f <= 0:
        return None
    return f


def enrich_contracts(contracts: Iterable[Dict[str, Any]], *, spot: Optional[float],
                     expiration: str, is_call: bool, r: Optional[float] = None,
                     now: Optional[datetime] = None) -> None:
    """Fill missing mid / implied_volatility / Greeks in place.

    Provider values always win; we only compute what is null. IV is taken from
    the provider when present, otherwise solved from the mid (or last) price.
    Greeks need a spot price; without one only `mid` is filled.
    """
    rate = risk_free_rate() if r is None else r
    try:
        t = year_fraction(expiration, now)
    except ValueError:
        t = None

    contracts = list(contracts)
    pending: list[Dict[str, Any]] = []
    for c in contracts:
        bid, ask = _pos(c.get("bid")), _pos(c.get("ask"))
        if c.get("mid") is None and bid is not None and ask is not None and ask >= bid:
            c["mid"] = round((bid + ask) / 2.0, 4)
        elif c.get("mid") is None and bid is None and ask is not None:
            # No bid (far OTM): the fair value is somewhere in [0, ask].
            c["mid"] = round(ask / 2.0, 4)

        strike = _pos(c.get("strike"))
        if spot is None or spot <= 0 or strike is None or t is None:
            continue

        sigma = _pos(c.get("implied_volatility"))
        if sigma is not None and sigma > 5.0:
            sigma = None  # yfinance reports nonsense IV (e.g. 475%) on illiquid deep ITM rows
        if sigma is None:
            price = _pos(c.get("mid")) or _pos(c.get("last"))
            if price is not None:
                sigma = implied_volatility(price, spot, strike, t, rate, is_call)
            if sigma is not None:
                c["implied_volatility"] = round(sigma, 4)
        if sigma is None:
            # Deep ITM quotes often sit below intrinsic + carry, so no IV solves.
            # Borrow the nearest strike's IV (smile) for Greeks in pass two.
            pending.append(c)
            continue
        _fill_greeks(c, spot, strike, t, rate, sigma, is_call)

    if not pending or spot is None or t is None:
        return
    solved = [(float(c["strike"]), float(c["implied_volatility"])) for c in contracts
              if _pos(c.get("strike")) and _pos(c.get("implied_volatility")) and c["implied_volatility"] <= 5.0]
    if not solved:
        return
    for c in pending:
        strike = float(c["strike"])
        sigma = min(solved, key=lambda kv: abs(kv[0] - strike))[1]
        # implied_volatility stays null: it was not observed for this contract.
        _fill_greeks(c, spot, strike, t, rate, sigma, is_call)


def _fill_greeks(c: Dict[str, Any], spot: float, strike: float, t: float, rate: float,
                 sigma: float, is_call: bool) -> None:
    greeks = bs_greeks(spot, strike, t, rate, sigma, is_call)
    for key, val in greeks.items():
        if c.get(key) is None:
            c[key] = round(val, 4)
