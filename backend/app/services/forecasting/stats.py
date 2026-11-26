"""Forecast-evaluation statistics: Diebold-Mariano, Pesaran-Timmermann, coverage.

All tests are written for *overlapping* rolling-origin forecasts: origins are
``step`` trading days apart while an h-day forecast spans h days, so for h > step
consecutive errors share most of their path. Treating them as independent would
overstate significance. Each test therefore takes ``k = ceil(h / step)``, the
number of origins one outcome window overlaps, and corrects for it:

- Diebold-Mariano uses a Newey-West (Bartlett) variance with ``k - 1`` lags and
  the Harvey-Leybourne-Newbold small-sample correction.
- Directional tests shrink the sample to its effective size ``n / k``.
"""
from __future__ import annotations

import math
from typing import Iterable, Optional, Sequence

import numpy as np


def overlap_k(h: int, step: int) -> int:
    """How many consecutive origins one h-day outcome window overlaps."""
    return max(1, math.ceil(h / max(step, 1)))


def effective_n(n: int, h: int, step: int) -> float:
    return n / overlap_k(h, step)


def diebold_mariano(err_model: Sequence[float], err_base: Sequence[float], h: int, step: int,
                    power: int = 1) -> dict:
    """One-sided DM test that the model's loss is LOWER than the baseline's.

    Loss is |e|**power (power=1 matches MAE / MASE). Returns
    ``{"stat", "pvalue", "n", "mean_loss_diff"}``; pvalue is P(no improvement)
    so a small value means the model beat the baseline. Degenerate inputs
    (too few points, zero variance) return pvalue 1.0.
    """
    from scipy.stats import t as student_t

    e1 = np.asarray(err_model, dtype=float)
    e0 = np.asarray(err_base, dtype=float)
    ok = np.isfinite(e1) & np.isfinite(e0)
    d = np.abs(e1[ok]) ** power - np.abs(e0[ok]) ** power
    n = len(d)
    out = {"stat": None, "pvalue": 1.0, "n": n, "mean_loss_diff": float(d.mean()) if n else None}
    if n < 5:
        return out
    k = overlap_k(h, step)
    lags = min(k - 1, n - 1)
    dc = d - d.mean()
    var = float(np.dot(dc, dc) / n)
    for lag in range(1, lags + 1):
        w = 1 - lag / (lags + 1)
        var += 2 * w * float(np.dot(dc[lag:], dc[:-lag]) / n)
    if not np.isfinite(var) or var <= 1e-18:
        return out
    stat = float(d.mean() / math.sqrt(var / n))
    hln = (n + 1 - 2 * k + k * (k - 1) / n) / n
    if hln > 0:
        stat *= math.sqrt(hln)
    out["stat"] = stat
    out["pvalue"] = float(student_t.cdf(stat, df=n - 1))  # H1: mean diff < 0
    return out


def pesaran_timmermann(pred: Sequence[float], actual: Sequence[float], h: int, step: int) -> dict:
    """Directional-skill test that is fair to always-up forecasts.

    A plain "hit rate vs 50%" test gives a constant "always up" forecast
    significant skill in any bull market. Pesaran-Timmermann compares the hit
    rate with what independent predicted/actual signs would give, so a constant
    forecast scores no skill (pvalue 1.0). The statistic is shrunk by
    sqrt(1/k) for overlapping windows. One-sided: small p = skill.
    """
    from scipy.stats import norm

    p = np.asarray(pred, dtype=float)
    a = np.asarray(actual, dtype=float)
    ok = np.isfinite(p) & np.isfinite(a) & (a != 0)
    p, a = p[ok], a[ok]
    n = len(a)
    out = {"hit_rate": None, "pvalue": 1.0, "n": n, "up_rate": None, "stat": None}
    if n == 0:
        return out
    xs, ys = p > 0, a > 0
    hit = float(np.mean(xs == ys))
    py, px = float(ys.mean()), float(xs.mean())
    out.update(hit_rate=hit, up_rate=py)
    if n < 8 or px in (0.0, 1.0) or py in (0.0, 1.0):
        return out
    pstar = py * px + (1 - py) * (1 - px)
    v_p = pstar * (1 - pstar) / n
    v_ps = ((2 * py - 1) ** 2 * px * (1 - px) / n + (2 * px - 1) ** 2 * py * (1 - py) / n
            + 4 * py * px * (1 - py) * (1 - px) / n ** 2)
    v = v_p - v_ps
    if v <= 1e-18:
        return out
    stat = (hit - pstar) / math.sqrt(v) / math.sqrt(overlap_k(h, step))
    out["stat"] = float(stat)
    out["pvalue"] = float(1 - norm.cdf(stat))
    return out


def binomial_direction_p(hits: int, n: int, h: int, step: int) -> float:
    """One-sided binomial p-value of hit rate > 50% on the effective sample."""
    from scipy.stats import binomtest

    if n <= 0:
        return 1.0
    k = overlap_k(h, step)
    n_eff = max(1, int(round(n / k)))
    k_eff = int(round(hits * n_eff / n))
    return float(binomtest(k_eff, n_eff, 0.5, alternative="greater").pvalue)


def holm(pvalues: dict) -> dict:
    """Holm-Bonferroni adjusted p-values (family = the dict's entries)."""
    items = sorted(((k, v if v is not None else 1.0) for k, v in pvalues.items()), key=lambda kv: kv[1])
    m = len(items)
    adj, running = {}, 0.0
    for i, (k, p) in enumerate(items):
        running = max(running, min(1.0, (m - i) * p))
        adj[k] = running
    return adj


def coverage(z_abs: Iterable[float], half_width: float) -> Optional[float]:
    """Share of standardized |errors| that fell inside +/- half_width."""
    z = np.asarray(list(z_abs), dtype=float)
    z = z[np.isfinite(z)]
    if len(z) == 0:
        return None
    return float(np.mean(z <= half_width))
