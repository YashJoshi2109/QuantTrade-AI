"""Reverse DCF: solve for the value driver that makes the DCF equal the price.

The driver (stage-1 revenue growth, target operating margin or
sales-to-capital) is scanned on a grid, every sign change of
value_per_share(x) - price is bracketed and refined by bisection, so a
non-monotonic value function (growth destroys value when the return on new
capital is below WACC) returns every root instead of a silent wrong one.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Dict, List, Optional

import numpy as np

from app.services.valuation.dcf import DCFAssumptions, EquityBridge, per_share, project, run_dcf, validate
from app.services.valuation.provenance import DataUnavailable, pct, r

SOLVE_RANGES = {"stage1_growth": (-0.30, 0.80), "target_operating_margin": (-0.30, 0.80),
                "sales_to_capital": (0.10, 20.0)}
_KW = {"stage1_growth": "g1", "target_operating_margin": "m_target", "sales_to_capital": "s2c"}


def _value(revenue0, a, bridge, param, x) -> np.ndarray:
    p = project(revenue0, a, **{_KW[param]: np.atleast_1d(np.asarray(x, float))})
    return per_share(p["enterprise_value"], bridge)


def solve_roots(revenue0: float, a: DCFAssumptions, bridge: EquityBridge, target: float, param: str,
                lo: Optional[float] = None, hi: Optional[float] = None, n_grid: int = 441,
                tol: float = 1e-7) -> List[float]:
    if param not in _KW:
        raise ValueError(f"solve_for must be one of {sorted(_KW)}")
    lo = SOLVE_RANGES[param][0] if lo is None else lo
    hi = SOLVE_RANGES[param][1] if hi is None else hi
    grid = np.linspace(lo, hi, n_grid)
    f = _value(revenue0, a, bridge, param, grid) - target
    roots: List[float] = []
    for i in range(n_grid - 1):
        f0, f1 = f[i], f[i + 1]
        if not (np.isfinite(f0) and np.isfinite(f1)):
            continue
        if f0 == 0:
            roots.append(float(grid[i]))
            continue
        if f0 * f1 < 0:
            a_, b_ = float(grid[i]), float(grid[i + 1])
            fa = f0
            for _ in range(200):
                m = 0.5 * (a_ + b_)
                fm = float(_value(revenue0, a, bridge, param, m)[0] - target)
                if fa * fm <= 0:
                    b_ = m
                else:
                    a_, fa = m, fm
                if b_ - a_ < tol:
                    break
            roots.append(0.5 * (a_ + b_))
    if np.isfinite(f[-1]) and f[-1] == 0:
        roots.append(float(grid[-1]))
    return roots


def reverse_dcf(revenue0: float, a: DCFAssumptions, bridge: EquityBridge, solve_for: str,
                base_fiscal_year: Optional[int], history: Dict[str, Any],
                peers: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    if not bridge.price:
        raise DataUnavailable("reverse DCF needs a current share price in the reporting currency")
    validate(a)
    target = bridge.price
    roots = solve_roots(revenue0, a, bridge, target, solve_for)
    lo, hi = SOLVE_RANGES[solve_for]
    out: Dict[str, Any] = {"solve_for": solve_for, "target_price": r(target, 2),
                           "search_range": [r(lo, 4), r(hi, 4)], "roots": [r(x, 6) for x in roots]}
    if not roots:
        v_lo, v_hi = (float(_value(revenue0, a, bridge, solve_for, x)[0]) for x in (lo, hi))
        out["solution"] = None
        out["note"] = (f"No value of {solve_for} in [{lo}, {hi}] reproduces the price with the other assumptions "
                       f"held fixed (value per share ranges {r(v_lo, 2)} to {r(v_hi, 2)}). Return on new capital is "
                       f"{pct(a.sales_to_capital * a.target_operating_margin * (1 - a.tax_rate))}% vs WACC {pct(a.wacc)}%; "
                       "solve for a different driver (e.g. target_operating_margin).")
        return out
    # Primary root: the one nearest the base assumption (others reported too)
    base = getattr(a, solve_for)
    x = min(roots, key=lambda v: abs(v - base))
    if len(roots) > 1:
        out["note"] = ("Multiple solutions: value is not monotonic in this driver (growth destroys value when "
                       "the return on new capital is below WACC). The one nearest the base case is used.")
    sol = replace(a, **{solve_for: x})
    d = run_dcf(revenue0, sol, bridge, base_fiscal_year)
    rows = d["projection"]
    horizon = a.horizon
    rev_n = rows[-1]["revenue"]
    implied_cagr = (rev_n / revenue0) ** (1.0 / horizon) - 1.0
    reinv_total = sum(rw["reinvestment"] for rw in rows)
    nopat_gain = rows[-1]["nopat"] - (revenue0 * a.operating_margin_start * (1 - a.tax_rate))
    marginal_roic = sol.sales_to_capital * sol.target_operating_margin * (1 - sol.tax_rate)
    out["solution"] = {"value": r(x, 6), "value_pct": pct(x) if solve_for != "sales_to_capital" else None}
    out["implied_path"] = {
        "projection": rows, "terminal": d["terminal"], "enterprise_value": d["enterprise_value"],
        "value_per_share_check": d["value_per_share"],
        "implied_revenue_cagr_pct": pct(implied_cagr), "implied_final_year_revenue": r(rev_n, 0),
        "final_year_revenue_multiple_of_base": r(rev_n / revenue0, 2),
        "implied_final_year_operating_margin_pct": rows[-1]["operating_margin_pct"],
        "cumulative_reinvestment": r(reinv_total, 0),
        "incremental_return_on_capital_pct": pct(nopat_gain / reinv_total) if reinv_total > 0 else None,
        "return_on_new_capital_pct": pct(marginal_roic),
        "formula": "return on new capital = sales_to_capital x operating margin x (1 - tax)"}
    checks: List[Dict[str, Any]] = []

    def check(name, value, bench, bench_label, higher_is_aggressive=True):
        if value is None or bench is None:
            return
        aggressive = value > bench if higher_is_aggressive else value < bench
        checks.append({"check": name, "implied": value, "benchmark": bench, "benchmark_source": bench_label,
                       "result": "exceeds benchmark" if aggressive else "within benchmark"})

    implied_cagr_pct = pct(implied_cagr)
    for n in (3, 5, 10):
        check(f"revenue CAGR vs own {n}y history", implied_cagr_pct, history.get(f"cagr_{n}y_pct"),
              f"company {n}-year revenue CAGR (XBRL)")
    check("final-year operating margin vs own best year", rows[-1]["operating_margin_pct"],
          history.get("operating_margin_max_pct"), "max historical operating margin (XBRL)")
    check("return on new capital vs WACC", pct(marginal_roic), pct(a.wacc), "WACC", higher_is_aggressive=False)
    if peers:
        pm = [p["operating_margin_pct"] for p in peers if p.get("operating_margin_pct") is not None]
        pg = [p["revenue_cagr_5y_pct"] for p in peers if p.get("revenue_cagr_5y_pct") is not None]
        if pm:
            check("final-year operating margin vs best peer", rows[-1]["operating_margin_pct"], max(pm),
                  "max latest-FY operating margin of supplied peers (XBRL)")
        if pg:
            check("revenue CAGR vs fastest peer", implied_cagr_pct, max(pg),
                  "max 5-year revenue CAGR of supplied peers (XBRL)")
        out["peer_bounds"] = peers
    out["checks"] = checks
    if marginal_roic < a.wacc and solve_for == "stage1_growth":
        out.setdefault("note", "")
        out["note"] = (out["note"] + " Return on new capital is below WACC, so faster growth lowers value.").strip()
    return out
