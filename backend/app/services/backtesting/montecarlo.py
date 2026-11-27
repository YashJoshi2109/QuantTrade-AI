"""Monte Carlo confidence bands for a backtest.

The old simulator shuffled the order of trade P&L and added it to a fixed
starting balance. A sum does not depend on order, so every simulation ended at
exactly the same equity: the "5th-95th percentile" band always had zero width
(see tests/backtesting/test_legacy_audit.py).

Two resampling schemes replace it, both seeded so results are reproducible:

* **Stationary block bootstrap of daily returns** (Politis & Romano 1994),
  mean block length ~20 bars. It keeps short-range autocorrelation and
  volatility clustering, and it works when trades overlap (a multi-asset
  portfolio), because it resamples the one portfolio return series instead
  of summing per-trade returns.
* **Trade bootstrap** (resample trades *with replacement*, compound each
  trade's return on equity at entry). Only offered when trades never
  overlap; with overlapping trades compounding per-trade returns double
  counts capital, which is the over-statement Phase 9 found.
"""
from __future__ import annotations

from typing import List, Optional

import numpy as np
import pandas as pd

MAX_CELLS = 2_000_000  # sims x bars kept in memory at once


def _pct(a, q):
    return float(np.percentile(a, q))


def _max_dd(paths: np.ndarray) -> np.ndarray:
    peak = np.maximum.accumulate(paths, axis=1)
    return (paths / peak - 1.0).min(axis=1)


def stationary_bootstrap_indices(n: int, sims: int, mean_block: float, rng: np.random.Generator) -> np.ndarray:
    p = 1.0 / max(mean_block, 1.0)
    idx = np.empty((sims, n), dtype=np.int64)
    idx[:, 0] = rng.integers(0, n, sims)
    restart = rng.random((sims, n)) < p
    fresh = rng.integers(0, n, (sims, n))
    for t in range(1, n):
        idx[:, t] = np.where(restart[:, t], fresh[:, t], (idx[:, t - 1] + 1) % n)
    return idx


def block_bootstrap(returns: pd.Series, initial: float, sims: int = 500, mean_block: float = 20.0,
                    seed: int = 7, band_points: int = 120, ppy: int = 252) -> Optional[dict]:
    r = returns.dropna().to_numpy(dtype=float)
    n = len(r)
    if n < 30:
        return None
    sims = int(max(50, min(sims, MAX_CELLS // max(n, 1))))
    rng = np.random.default_rng(seed)
    idx = stationary_bootstrap_indices(n, sims, mean_block, rng)
    paths = initial * np.cumprod(1.0 + r[idx], axis=1)
    final = paths[:, -1] / initial - 1.0
    mdd = _max_dd(np.hstack([np.full((sims, 1), initial), paths]))
    years = n / ppy
    cagr = np.where(paths[:, -1] > 0, (paths[:, -1] / initial) ** (1 / years) - 1, -1.0) if years > 0 else final
    keep = np.unique(np.linspace(0, n - 1, min(band_points, n)).round().astype(int))
    dates = returns.dropna().index
    bands = [{
        "date": dates[k].date().isoformat(),
        "p5": round(float(np.percentile(paths[:, k], 5)), 2),
        "p25": round(float(np.percentile(paths[:, k], 25)), 2),
        "p50": round(float(np.percentile(paths[:, k], 50)), 2),
        "p75": round(float(np.percentile(paths[:, k], 75)), 2),
        "p95": round(float(np.percentile(paths[:, k], 95)), 2),
    } for k in keep]
    hist_counts, edges = np.histogram(final * 100, bins=20)
    return {
        "method": "stationary_block_bootstrap",
        "simulations": sims, "mean_block_bars": mean_block, "seed": seed,
        "final_return_pct": {q: round(_pct(final * 100, v), 3) for q, v in
                             (("p5", 5), ("p25", 25), ("p50", 50), ("p75", 75), ("p95", 95))},
        "mean_final_return_pct": round(float(np.mean(final) * 100), 3),
        "cagr_pct": {q: round(_pct(cagr * 100, v), 3) for q, v in (("p5", 5), ("p50", 50), ("p95", 95))},
        "max_drawdown_pct": {q: round(_pct(mdd * 100, v), 3) for q, v in (("p5", 5), ("p50", 50), ("p95", 95))},
        "probability_of_loss_pct": round(float((final < 0).mean() * 100), 2),
        "probability_drawdown_over_50_pct": round(float((mdd < -0.5).mean() * 100), 2),
        "bands": bands,
        "distribution": [{"range_start": round(float(edges[i]), 2), "range_end": round(float(edges[i + 1]), 2),
                          "count": int(hist_counts[i])} for i in range(len(hist_counts))],
    }


def trades_overlap(trades: List) -> bool:
    spans = sorted((t.entry_date, t.exit_date) for t in trades)
    for (s1, e1), (s2, _e2) in zip(spans, spans[1:]):
        if s2 < e1:
            return True
    return False


def trade_bootstrap(trades: List, initial: float, sims: int = 1000, seed: int = 7) -> Optional[dict]:
    if len(trades) < 5:
        return None
    if trades_overlap(trades):
        return {"method": "trade_bootstrap", "skipped": True,
                "reason": "Trades overlap in time; compounding per-trade returns would double count capital. "
                          "Use the daily-return bootstrap instead."}
    tr = np.array([t.pnl / t.entry_equity for t in trades if t.entry_equity > 0], dtype=float)
    if len(tr) < 5:
        return None
    rng = np.random.default_rng(seed)
    sims = int(min(sims, MAX_CELLS // len(tr)))
    draws = tr[rng.integers(0, len(tr), (sims, len(tr)))]
    paths = initial * np.cumprod(1 + draws, axis=1)
    final = paths[:, -1] / initial - 1
    mdd = _max_dd(np.hstack([np.full((sims, 1), initial), paths]))
    return {
        "method": "trade_bootstrap", "skipped": False, "simulations": sims, "seed": seed, "trades": int(len(tr)),
        "final_return_pct": {q: round(_pct(final * 100, v), 3) for q, v in (("p5", 5), ("p50", 50), ("p95", 95))},
        "max_drawdown_pct": {q: round(_pct(mdd * 100, v), 3) for q, v in (("p5", 5), ("p50", 50), ("p95", 95))},
        "probability_of_loss_pct": round(float((final < 0).mean() * 100), 2),
    }
