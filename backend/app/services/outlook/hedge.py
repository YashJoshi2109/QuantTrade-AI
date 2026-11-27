"""Hedge planner: compare protective put, collar and trimming a position at expiry.

Educational calculator. Inputs are a position (shares at today's price) and
option premiums per share (mid prices from the chain). Outcomes are measured
from today's price, at the option expiry, before fees, taxes and dividends.

For a long position of N shares at price S:

- Unhedged:     P&L(S_T) = (S_T - S) N
- Protective put (buy put K_p at premium P):
                P&L = (S_T - S + max(K_p - S_T, 0) - P) N
                max loss = (S - K_p + P) N, breakeven = S + P, upside uncapped
- Collar (buy put K_p at P, sell call K_c at C, K_c >= K_p):
                net = P - C (negative is a credit)
                P&L = (S_T - S + max(K_p - S_T, 0) - max(S_T - K_c, 0) - net) N
                max loss = (S - K_p + net) N, max gain = (K_c - S - net) N, breakeven = S + net
- Reduce (sell a fraction f now at S):
                P&L = (S_T - S) (1 - f) N, max loss = S (1 - f) N, breakeven = S
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional


def _pl_unhedged(s: float, n: float) -> Callable[[float], float]:
    return lambda st: (st - s) * n


def _pl_put(s: float, n: float, kp: float, p: float) -> Callable[[float], float]:
    return lambda st: (st - s + max(kp - st, 0.0) - p) * n


def _pl_collar(s: float, n: float, kp: float, p: float, kc: float, c: float) -> Callable[[float], float]:
    net = p - c
    return lambda st: (st - s + max(kp - st, 0.0) - max(st - kc, 0.0) - net) * n


def _pl_reduce(s: float, n: float, f: float) -> Callable[[float], float]:
    return lambda st: (st - s) * (1.0 - f) * n


def _r(x: Optional[float], d: int = 2) -> Optional[float]:
    return None if x is None else round(x, d)


def plan(*, spot: float, shares: float, put_strike: Optional[float] = None, put_premium: Optional[float] = None,
         call_strike: Optional[float] = None, call_premium: Optional[float] = None,
         reduce_fraction: float = 0.5, prob_below: Optional[Callable[[float], float]] = None,
         grid_points: int = 61) -> Dict:
    """Outcome table for each strategy plus a P&L-at-expiry curve.

    ``prob_below`` (optional) maps a price to the risk-neutral P(S_T < price)
    so each strategy can report the chance of finishing below its breakeven.
    """
    if spot <= 0 or shares <= 0:
        raise ValueError("spot and shares must be positive")
    if not 0.0 <= reduce_fraction <= 1.0:
        raise ValueError("reduce_fraction must be between 0 and 1")
    s, n = float(spot), float(shares)
    strategies: List[Dict] = []
    curves: Dict[str, Callable[[float], float]] = {}

    def add(sid: str, label: str, fn, cost: float, max_loss: float, max_gain: Optional[float],
            breakeven: float, notes: str, legs: List[Dict]):
        curves[sid] = fn
        strategies.append({
            "id": sid,
            "label": label,
            "legs": legs,
            "upfront_cost": _r(cost),
            "upfront_cost_pct": _r(cost / (s * n) * 100, 3),
            "max_loss": _r(max(max_loss, 0.0)),
            "max_loss_pct": _r(max(max_loss, 0.0) / (s * n) * 100, 3),
            "max_gain": _r(max_gain),
            "breakeven": _r(breakeven, 4),
            "prob_below_breakeven": _r(prob_below(breakeven), 4) if prob_below else None,
            "notes": notes,
        })

    add("unhedged", "Hold, unhedged", _pl_unhedged(s, n), 0.0, s * n, None, s,
        "Full upside and full downside.", [])

    if put_strike and put_premium is not None and put_premium >= 0:
        kp, p = float(put_strike), float(put_premium)
        add("protective_put", f"Protective put {kp:g}", _pl_put(s, n, kp, p), p * n,
            (s - kp + p) * n, None, s + p,
            "Pays a premium for a floor at the put strike; upside stays open, reduced by the premium.",
            [{"action": "buy", "type": "put", "strike": kp, "premium": p, "contracts": n / 100.0}])

        if call_strike and call_premium is not None and call_premium >= 0 and float(call_strike) >= kp:
            kc, c = float(call_strike), float(call_premium)
            net = p - c
            add("collar", f"Collar {kp:g} / {kc:g}", _pl_collar(s, n, kp, p, kc, c), net * n,
                (s - kp + net) * n, (kc - s - net) * n, s + net,
                "The call premium pays for part or all of the put; gains above the call strike are given up.",
                [{"action": "buy", "type": "put", "strike": kp, "premium": p, "contracts": n / 100.0},
                 {"action": "sell", "type": "call", "strike": kc, "premium": c, "contracts": n / 100.0}])

    f = float(reduce_fraction)
    if f > 0:
        add("reduce", f"Reduce position {f * 100:g}%", _pl_reduce(s, n, f), 0.0, s * (1 - f) * n, None, s,
            "No premium, but the sold shares stop participating in any rebound; a sale can realise a taxable gain.",
            [{"action": "sell_shares", "fraction": f, "shares": round(n * f, 6)}])

    lo, hi = s * 0.5, s * 1.5
    grid = [lo + (hi - lo) * i / (grid_points - 1) for i in range(grid_points)]
    curve = [{"price": round(x, 4), **{sid: round(fn(x), 2) for sid, fn in curves.items()}} for x in grid]
    return {"spot": round(s, 4), "shares": n, "position_value": round(s * n, 2),
            "strategies": strategies, "curve": curve}
