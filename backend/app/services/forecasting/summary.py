"""Compact, honesty-labelled summary of one statistical forecast payload.

One function turns a full ``/api/v1/forecast/{ticker}`` payload into the small
shape every other surface uses: watchlist rows, portfolio holdings, the
screener column and the AI Copilot tool. Using one function keeps the numbers
and the labels identical everywhere.

Rules (the same as frontend/src/lib/forecastHonesty.ts):
- Every summary is experimental and never investment advice.
- The 80% and 95% ranges are always shown.
- The midpoint, expected return and P(up) are included ONLY for a horizon whose
  walk-forward test beat the ARIMA(0,1,0) benchmark with statistical support
  (``reliability == "edge_in_backtest"``). Otherwise they are ``None``: the
  midpoint of a model with no edge is noise.
- ``signal`` is always False while the ML promotion gate has not passed. Even
  with a gate pass, the statistical forecast is a range, not a trade signal.
- ``hit_rate_80`` / ``hit_rate_95`` are the measured share of past test outcomes
  that landed inside the range (held-out walk-forward tests), with the test
  count, so a reader can judge the range themselves. ``None`` when unknown.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.services.model_status import EXPERIMENTAL_LABEL, band_calibration

BENCHMARK_NAME = "ARIMA(0,1,0)"
HORIZON_LABELS = {1: "1 day", 5: "1 week", 20: "1 month", 60: "3 months"}


def _f(x: Any) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def _band(row: Dict[str, Any], lvl: str) -> Optional[List[float]]:
    b = (row.get("bands") or {}).get(lvl)
    if not b or len(b) != 2:
        return None
    lo, hi = _f(b[0]), _f(b[1])
    return [lo, hi] if lo is not None and hi is not None else None


def _horizon(raw: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    h = int(row["h"])
    k = str(h)
    bt = raw.get("backtest") or {}
    beats = (raw.get("beats_naive") or {}).get(k)
    reliability = row.get("reliability") or ("edge_in_backtest" if beats else "no_edge")
    edge = reliability == "edge_in_backtest"

    ev = row.get("eval") or {}
    cov = ev.get("coverage") or (bt.get("band_coverage") or {}).get(k) or {}
    tests = ev.get("holdout_origins")
    if tests is None:
        tests = (bt.get("holdout_origins") or {}).get(k)
    if tests is None:
        tests = bt.get("origins")
    tests = int(tests) if tests is not None else None
    effective = ev.get("effective_tests")
    if effective is None:
        effective = (bt.get("effective_tests") or {}).get(k)

    cal = row.get("calibration") or band_calibration(cov or None, tests or 0, effective)
    last = _f(raw.get("last_close"))
    r80, r95 = _band(row, "80"), _band(row, "95")

    def pct(v: Optional[float]) -> Optional[float]:
        return round((v / last - 1) * 100, 2) if v is not None and last else None

    prob = _f(row.get("prob_up"))
    return {
        "h": h,
        "label": HORIZON_LABELS.get(h, f"{h} days"),
        "date": row.get("date"),
        "range_80": r80,
        "range_95": r95,
        "range_80_pct": [pct(r80[0]), pct(r80[1])] if r80 else None,
        "range_95_pct": [pct(r95[0]), pct(r95[1])] if r95 else None,
        "sigma_log": _f(row.get("sigma_log")),
        "reliability": reliability,
        "edge": edge,
        "edge_text": f"Beat {BENCHMARK_NAME} in tests" if edge else f"No edge vs {BENCHMARK_NAME}",
        # Direction only with a tested edge; otherwise the range is the forecast.
        "midpoint": _f(row.get("point")) if edge else None,
        "exp_return_pct": _f(row.get("exp_return_pct")) if edge else None,
        "prob_up_pct": round(prob * 100, 1) if edge and prob is not None else None,
        "hit_rate_80": _f(cov.get("80")),
        "hit_rate_95": _f(cov.get("95")),
        "hit_rate_tests": tests,
        "calibration": (cal or {}).get("status", "insufficient_data"),
    }


def summarize_forecast(raw: Optional[Dict[str, Any]], ticker: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Compact summary of a forecast payload, or None when it has no horizons."""
    if not raw or not raw.get("horizons"):
        return None
    ml = raw.get("ml_model") or {}
    promoted = bool(ml.get("promoted"))
    horizons = [_horizon(raw, r) for r in raw["horizons"] if r.get("h") is not None]
    return {
        "ticker": (ticker or raw.get("ticker") or "").upper() or None,
        "as_of": raw.get("as_of"),
        "generated_at": raw.get("generated_at"),
        "last_close": _f(raw.get("last_close")),
        "vol_annualized_pct": _f(raw.get("vol_annualized_pct")),
        "benchmark": (raw.get("benchmark") or {}).get("name", BENCHMARK_NAME)
        if isinstance(raw.get("benchmark"), dict) else BENCHMARK_NAME,
        "horizons": horizons,
        "any_edge": any(h["edge"] for h in horizons),
        "status": "experimental",
        "label": EXPERIMENTAL_LABEL,
        "investment_advice": False,
        # Never a trade signal; the ML gate must pass before any ML output is one.
        "signal": False,
        "ml_gate": {
            "promoted": promoted,
            "gates_passed": ml.get("gates_passed"),
            "gates_total": ml.get("gates_total"),
            "gates_required": ml.get("gates_required"),
            "note": ml.get("note") or "Our ML price model is experimental and is not used in this forecast.",
        },
    }


def pick_horizon(summary: Optional[Dict[str, Any]], h: int) -> Optional[Dict[str, Any]]:
    if not summary:
        return None
    return next((r for r in summary.get("horizons") or [] if r["h"] == h), None)
