"""Monte Carlo DCF: really draws N samples (numpy, seedable) and runs the
same vectorised DCF kernel as the point estimate on every one of them.

Distributions (independent draws; the output reports every parameter):
  normal      {"dist": "normal", "mean", "sd", "min", "max"}   (clipped to [min, max])
  uniform     {"dist": "uniform", "min", "max"}
  triangular  {"dist": "triangular", "min", "mode", "max"}
  fixed       {"dist": "fixed", "value"}
Terminal growth is additionally capped at WACC - 1pp per draw (Gordon model
undefined otherwise); how many draws hit any cap is reported.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

import numpy as np

from app.services.valuation.dcf import DCFAssumptions, EquityBridge, per_share, project, validate
from app.services.valuation.provenance import DataUnavailable, pct, r

DEFAULT_N = 10_000
MAX_N = 200_000
DEFAULT_SEED = 42
MIN_SPREAD = 0.01          # terminal growth must stay >= 1pp below WACC

# Default spreads around the base case. ASSUMPTIONS, reported in the output.
DEFAULT_SPREADS = {
    "stage1_growth": {"dist": "normal", "sd": 0.05, "min": -0.30, "max": 0.80},
    "target_operating_margin": {"dist": "normal", "sd": 0.03, "min": -0.30, "max": 0.80},
    "wacc": {"dist": "normal", "sd": 0.01, "min": 0.03, "max": 0.25},
    "terminal_growth": {"dist": "normal", "sd": 0.005, "min": -0.01, "max": 0.04},
}
VARS = tuple(DEFAULT_SPREADS)


def default_distributions(a: DCFAssumptions) -> Dict[str, Dict[str, Any]]:
    return {k: {**v, "mean": float(getattr(a, k))} for k, v in DEFAULT_SPREADS.items()}


def _draw(rng: np.random.Generator, spec: Dict[str, Any], n: int):
    d = spec.get("dist", "normal")
    if d == "fixed":
        return np.full(n, float(spec["value"])), 0
    if d == "normal":
        x = rng.normal(float(spec["mean"]), float(spec["sd"]), n)
    elif d == "uniform":
        x = rng.uniform(float(spec["min"]), float(spec["max"]), n)
    elif d == "triangular":
        x = rng.triangular(float(spec["min"]), float(spec["mode"]), float(spec["max"]), n)
    else:
        raise ValueError(f"unknown distribution {d!r}")
    lo, hi = spec.get("min"), spec.get("max")
    clipped = 0
    if lo is not None or hi is not None:
        y = np.clip(x, -np.inf if lo is None else float(lo), np.inf if hi is None else float(hi))
        clipped = int((y != x).sum())
        x = y
    return x, clipped


def merge_distributions(a: DCFAssumptions, overrides: Optional[Dict[str, Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    dists = default_distributions(a)
    for k, v in (overrides or {}).items():
        if k not in dists:
            raise ValueError(f"unknown Monte Carlo variable {k!r}; allowed: {list(VARS)}")
        if v.get("dist") and v["dist"] != dists[k].get("dist"):
            dists[k] = dict(v)
        else:
            dists[k] = {**dists[k], **v}
    return dists


def simulate(revenue0: float, a: DCFAssumptions, bridge: EquityBridge, *, n: int = DEFAULT_N,
             seed: Optional[int] = DEFAULT_SEED, distributions: Optional[Dict[str, Dict[str, Any]]] = None,
             price: Optional[float] = None) -> Dict[str, Any]:
    validate(a)
    if not 100 <= n <= MAX_N:
        raise ValueError(f"n_simulations must be between 100 and {MAX_N}")
    dists = merge_distributions(a, distributions)
    rng = np.random.default_rng(seed)
    t0 = time.perf_counter()
    draws, clipped = {}, {}
    for k in VARS:                        # fixed order -> reproducible for a given seed
        draws[k], clipped[k] = _draw(rng, dists[k], n)
    cap = draws["wacc"] - MIN_SPREAD
    capped_tg = int((draws["terminal_growth"] > cap).sum())
    draws["terminal_growth"] = np.minimum(draws["terminal_growth"], cap)
    p = project(revenue0, a, g1=draws["stage1_growth"], m_target=draws["target_operating_margin"],
                wacc=draws["wacc"], g_t=draws["terminal_growth"])
    v = per_share(p["enterprise_value"], bridge)
    ok = np.isfinite(v)
    v = v[ok]
    if v.size == 0:
        raise DataUnavailable("no finite simulated values")
    elapsed = (time.perf_counter() - t0) * 1000
    q = np.percentile(v, [5, 25, 50, 75, 95])
    hist_counts, edges = np.histogram(v, bins=20, range=(float(np.percentile(v, 1)), float(np.percentile(v, 99))))
    out: Dict[str, Any] = {
        "executed": True, "n_requested": n, "n_valid": int(v.size), "seed": seed,
        "engine": f"numpy {np.__version__} default_rng (PCG64)", "runtime_ms": r(elapsed, 1),
        "value_per_share": {"median": r(q[2], 2), "mean": r(v.mean(), 2), "p5": r(q[0], 2), "p25": r(q[1], 2),
                            "p75": r(q[3], 2), "p95": r(q[4], 2), "std": r(v.std(ddof=1), 2),
                            "min": r(v.min(), 2), "max": r(v.max(), 2)},
        "distributions": {k: {kk: (pct(vv) if kk in ("mean", "sd", "min", "max", "mode", "value")
                                   and isinstance(vv, (int, float)) else vv) for kk, vv in d.items()}
                          for k, d in dists.items()},
        "distribution_units": "mean/sd/min/max/mode in percent",
        "correlation": "independent draws (no correlation between variables)",
        "clipped_draws": {**clipped, "terminal_growth_capped_at_wacc_minus_1pp": capped_tg},
        "negative_value_draws": int((v < 0).sum()),
        "negative_value_note": "a negative value means enterprise value below net debt; reported unfloored",
        "histogram": {"bin_edges": [r(e, 2) for e in edges], "counts": hist_counts.tolist(),
                      "range": "1st-99th percentile of simulated values"},
    }
    if price:
        out["price"] = r(price, 2)
        out["prob_value_below_price_pct"] = pct(float((v < price).mean()))
        out["median_vs_price_pct"] = pct(q[2] / price - 1.0)
    return out
