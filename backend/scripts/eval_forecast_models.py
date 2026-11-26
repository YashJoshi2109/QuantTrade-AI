"""Walk-forward report for the statistical forecast models (free Yahoo data only).

    cd backend
    python -m scripts.eval_forecast_models --tickers SPY AAPL NVDA JPM XOM \
        --out ../docs/forecast_eval --offsets 0 2

For each ticker and each origin offset it runs the same evaluation the API
serves (app.services.forecasting), with no time budget, and writes
``<out>/<TICKER>_offset<k>.json`` plus a Markdown summary on stdout.
``--offsets`` drops the last k closes before evaluating, which shifts every
origin by k days: a cheap robustness check (an edge that disappears when the
test dates move by two days is not an edge).

``--leak-diagnostic`` adds one deliberately leaky number per ticker: a
1-day forecast that uses the SAME day's SPY return (unknown at the origin).
It is reported only to show what look-ahead would look like and is never
eligible for serving.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.forecast import _load_closes, _load_earnings, _load_exog  # noqa: E402
from app.services.forecasting.engine import HISTORY_DAYS, forecast  # noqa: E402


def leak_diagnostic(close, spy, window=504, step=5, n=100) -> float | None:
    """Rel. MAE of r_{t+1} ~ beta * spy_{t+1} (same-day, leaky) vs random walk."""
    import pandas as pd

    df = pd.concat([np.log(close).diff(), np.log(spy).diff()], axis=1, join="inner").dropna()
    df.columns = ["r", "m"]
    r, m = df["r"].to_numpy(), df["m"].to_numpy()
    last = len(r) - 2
    origins = range(max(window, last - (n - 1) * step), last + 1, step)
    e_leak, e_rw = [], []
    for o in origins:
        x, y = m[o - window + 1:o + 1], r[o - window + 1:o + 1]
        beta = float(np.dot(x - x.mean(), y - y.mean()) / np.dot(x - x.mean(), x - x.mean()))
        alpha = y.mean() - beta * x.mean()
        pred = alpha + beta * m[o + 1]
        e_leak.append(abs(pred - r[o + 1]))
        e_rw.append(abs(r[o + 1]))
    return float(np.mean(e_leak) / np.mean(e_rw)) if e_rw else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="+", default=["SPY", "AAPL", "NVDA", "JPM", "XOM"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--offsets", nargs="+", type=int, default=[0])
    ap.add_argument("--leak-diagnostic", action="store_true")
    args = ap.parse_args()
    out_dir = Path(args.out) if args.out else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for t in args.tickers:
        closes = _load_closes(t)
        raw = _load_exog(t)
        earnings = _load_earnings(t)
        leak = None
        if args.leak_diagnostic and t != "SPY":
            leak = leak_diagnostic(closes, _load_closes("SPY"))
        for off in args.offsets:
            c = closes.iloc[: len(closes) - off] if off else closes
            t0 = time.monotonic()
            res = forecast(c.iloc[-HISTORY_DAYS:], raw=raw, earnings_stamps=earnings)
            ev = res.pop("_evaluation")
            elapsed = time.monotonic() - t0
            if out_dir:
                (out_dir / f"{t}_offset{off}.json").write_text(json.dumps(
                    {"ticker": t, "offset": off, "elapsed_s": round(elapsed, 2), "evaluation": ev,
                     "exog_sources": sorted(raw.columns) if raw is not None else [],
                     "earnings_dates": earnings is not None, "leak_diagnostic_h1_rel_mae": leak},
                    indent=1, default=str))
            for h, e in ev["horizons"].items():
                rows.append((t, off, h, e, ev, leak, elapsed))

    print("| Ticker | Off | H | Primary (selected on first half) | MASE vs ARIMA(0,1,0) | RMSE ratio | DM p (Holm) "
          "| Dir. acc (PT p) | Cov 80 / 95 | Eff. tests | Edge |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")

    def f(x, d=2):
        return "—" if x is None else f"{x:.{d}f}"

    for t, off, h, e, ev, leak, _ in rows:
        cov = e.get("calibration", {}).get("rw", {}).get("coverage", {}) if not e.get("edge") else e.get("band_coverage", {})
        prim = e.get("primary") or "—"
        if prim == "arima":
            prim = f"ARIMA{ev['order_label']}+drift"
        elif prim == "sarimax":
            prim = f"SARIMAX{ev['order_label']}+exog"
        print(f"| {t} | {off} | {h}D | {prim} | {f(e.get('rel_mae'), 3)} | {f(e.get('rmse_ratio'), 3)} "
              f"| {f(e.get('dm_pvalue'))} ({f(e.get('dm_pvalue_holm'))}) | {f((e.get('dir_acc') or 0) * 100, 0)}% "
              f"({f(e.get('dir_pvalue'))}) | {f((cov.get('80') or 0) * 100, 0)}% / {f((cov.get('95') or 0) * 100, 0)}% "
              f"| {e.get('effective_tests')} | {'**yes**' if e.get('edge') else 'no'} |")
    seen = set()
    for t, off, h, e, ev, leak, elapsed in rows:
        if (t, off) in seen:
            continue
        seen.add((t, off))
        print(f"\n{t} offset {off}: {ev['origins']} origins {ev['period'][0]} -> {ev['period'][1]}, "
              f"order {ev['order_label']} (BIC, {ev['order_selection']['tried']} fits), "
              f"exog h=1 {ev['exog']['1']}, {elapsed:.1f}s"
              + (f", LEAK DIAGNOSTIC (same-day SPY) h=1 rel MAE {leak:.3f}" if leak is not None and off == args.offsets[0] else ""))


if __name__ == "__main__":
    main()
