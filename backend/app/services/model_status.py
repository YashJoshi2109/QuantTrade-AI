"""Validation status of QuantTrade's ML models, and honesty labels for the API.

The ML ranking model (h=20 LightGBM) is promoted only when it passes at least
8 of the 10 walk-forward promotion gates (see docs/ML_PHASE9_IC_RESEARCH.md).
Until then every ML-derived number that reaches a user must say it is
experimental, and nothing may present it as a reliable signal.

``ml_promotion_status.json`` is the committed snapshot of the latest gate run
(``python -m ml.phase9_ic ... --out <dir>`` writes ``promotion_status.json``;
copy it here when a new run is accepted). A missing or unreadable file is
treated as NOT_READY — the safe default.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

STATUS_PATH = Path(__file__).with_name("ml_promotion_status.json")

EXPERIMENTAL_LABEL = "Experimental · Not investment advice"

_SAFE_DEFAULT = {
    "served_model": "unknown",
    "verdict": "NOT_READY",
    "gates_passed": None,   # None = the served model has never been gate-tested
    "gates_total": 10,
    "gates_required": 8,
    "evaluated_at": None,
    "reason": "No validation record found.",
    "research_candidate": None,
    "benchmark_test": None,  # DM test of the served model vs ARIMA(0,1,0) (scripts/eval_lstm_vs_rw.py)
}


@lru_cache(maxsize=1)
def ml_model_status() -> dict:
    try:
        data = json.loads(STATUS_PATH.read_text())
        if data.get("verdict") not in ("READY", "NOT_READY"):
            raise ValueError("bad verdict")
        return {**_SAFE_DEFAULT, **data}
    except Exception as exc:  # missing / corrupt -> safe default
        logger.warning("ML promotion status unavailable (%s); treating as NOT_READY", exc)
        return dict(_SAFE_DEFAULT)


def benchmark_edge() -> bool | None:
    """Did the served model beat ARIMA(0,1,0) out of sample (Diebold-Mariano)?
    None = never tested."""
    bt = ml_model_status().get("benchmark_test")
    if not isinstance(bt, dict) or "edge_any" not in bt:
        return None
    return bool(bt["edge_any"])


def ml_model_promoted() -> bool:
    """Promoted only with enough gates AND, when a benchmark test exists, a
    significant edge over the ARIMA(0,1,0) random walk."""
    s = ml_model_status()
    passed = s.get("gates_passed")
    gates_ok = s["verdict"] == "READY" and passed is not None and passed >= s["gates_required"]
    return gates_ok and benchmark_edge() is not False


# What the product serves instead of an un-validated model.
BASELINE_SERVED = ("statistical forecast (ARIMA/ETS/Theta mean + GJR-GARCH bands, band width "
                   "calibrated on walk-forward tests and checked for coverage on held-out tests)")


def research_candidate() -> dict | None:
    rc = ml_model_status().get("research_candidate")
    return rc if isinstance(rc, dict) else None


def ranker_servable() -> bool:
    """The cross-sectional ranker may be shown as a signal only when its gate
    holds on every robustness re-run AND an inference path is deployed."""
    rc = research_candidate()
    if not rc:
        return False
    req = int(rc.get("gates_required") or 8)
    return (rc.get("verdict") == "READY" and bool(rc.get("robust")) and bool(rc.get("deployed"))
            and int(rc.get("gates_passed") or 0) >= req
            and int((rc.get("robustness") or {}).get("min_gates") or 0) >= req)


def serving_decision() -> dict:
    """Which model the product actually serves, and why (shown in /forecast + MLOps)."""
    if ml_model_promoted():
        return {"signal_model": ml_model_status().get("served_model"), "baseline": None,
                "reason": "The served ML model passed its validation gate."}
    if ranker_servable():
        rc = research_candidate() or {}
        return {"signal_model": f"{rc.get('model_family')} ({rc.get('variant')})", "baseline": None,
                "reason": "The ranker passed its gate on every robustness re-run and is deployed."}
    rc = research_candidate()
    why = "No ML model has passed its validation gate"
    if rc:
        rob = rc.get("robustness") or {}
        if rc.get("gates_passed") is not None and rob.get("skipped_reason"):
            why += (f" (best research model: {rc['gates_passed']}/{rc.get('gates_total', 10)} on its "
                    f"primary run, but its {rob['skipped_reason'].replace('primary run fails ', '')} "
                    "check fails, so its predictions carry no measurable ranking signal)")
        elif rc.get("gates_passed") is not None and rob.get("min_gates") is not None:
            why += (f" (best research model: {rc['gates_passed']}/{rc.get('gates_total', 10)} on its "
                    f"primary run, {rob['min_gates']}/{rc.get('gates_total', 10)} on its weakest re-run, "
                    f"{rc.get('gates_required', 8)} required on every run)")
    return {"signal_model": None, "baseline": BASELINE_SERVED,
            "reason": why + ", so no ML signal is shown. Forecasts come from the statistical baseline."}


def ml_status_summary() -> dict:
    """Compact, user-facing description of the served ML model's validation state."""
    s = ml_model_status()
    promoted = ml_model_promoted()
    passed = s.get("gates_passed")
    if promoted:
        note = "The ML model passed its validation gates."
    elif passed is None:
        note = ("Our ML price model is experimental: it has not passed the "
                f"{s['gates_total']}-point validation gate, so it is not used here "
                "and its output is never shown as a signal.")
    else:
        note = (f"Our ML price model is experimental: it passed {passed} of "
                f"{s['gates_total']} validation gates ({s['gates_required']} required), "
                "so it is not used here and its output is never shown as a signal.")
    bt = s.get("benchmark_test") if isinstance(s.get("benchmark_test"), dict) else None
    if bt and not bt.get("edge_any") and bt.get("finding"):
        note += " " + bt["finding"]
    return {
        "promoted": promoted,
        "benchmark": (bt or {}).get("benchmark", "ARIMA(0,1,0)"),
        "beats_benchmark": benchmark_edge(),
        "benchmark_finding": (bt or {}).get("finding"),
        "verdict": s["verdict"],
        "gates_passed": passed,
        "gates_total": s["gates_total"],
        "gates_required": s["gates_required"],
        "evaluated_at": s.get("evaluated_at"),
        "note": note,
        "serving": serving_decision(),
    }


# ── Forecast calibration labels ──────────────────────────────────────────────

# A band "calibrated" if past outcomes landed inside it about as often as its
# nominal level says. Tolerances allow for ~40 walk-forward origins of noise.
COVERAGE_TOLERANCE = {"80": 0.10, "95": 0.07}
MIN_ORIGINS_FOR_CALIBRATION = 20
# Overlapping long-horizon tests (e.g. 60-day windows 5 days apart) carry far
# fewer independent outcomes than origins; below this, coverage is not judged.
MIN_EFFECTIVE_FOR_CALIBRATION = 8


def band_calibration(coverage: dict | None, origins: int, effective: float | None = None) -> dict:
    """Return {'status': calibrated|under_covered|over_covered|insufficient_data, ...}.

    ``origins`` = tests the coverage was measured on; ``effective`` = how many
    of them are non-overlapping (defaults to ``origins``).
    """
    if (not coverage or origins < MIN_ORIGINS_FOR_CALIBRATION
            or (effective is not None and effective < MIN_EFFECTIVE_FOR_CALIBRATION)):
        return {"status": "insufficient_data", "origins": origins, "effective": effective}
    worst, status = 0.0, "calibrated"
    for lvl, tol in COVERAGE_TOLERANCE.items():
        c = coverage.get(lvl)
        if c is None:
            return {"status": "insufficient_data", "origins": origins}
        gap = c - int(lvl) / 100
        if abs(gap) > tol and abs(gap) > abs(worst):
            worst = gap
            status = "under_covered" if gap < 0 else "over_covered"
    return {"status": status, "origins": origins,
            "coverage": {k: coverage.get(k) for k in COVERAGE_TOLERANCE}}


def annotate_forecast(out: dict) -> dict:
    """Add honesty fields to a statistical forecast payload (in place + returned).

    - ``status``/``label``: always experimental, never investment advice.
    - per horizon ``reliability``: ``edge_in_backtest`` only when the backtest
      beat the no-change baseline with statistical support, else ``no_edge``;
      ``calibration`` says whether the bands covered past outcomes as stated.
    - ``ml_model``: the ML model is not used in this forecast, and why.
    """
    bt = out.get("backtest", {}) or {}
    origins = int(bt.get("origins") or 0)
    holdout = bt.get("holdout_origins") or {}
    effective = bt.get("effective_tests") or {}
    beats = out.get("beats_naive", {}) or {}
    cov = bt.get("band_coverage", {}) or {}
    for row in out.get("horizons", []):
        k = str(row["h"])
        row["reliability"] = "edge_in_backtest" if beats.get(k) else "no_edge"
        n = int(holdout[k]) if holdout.get(k) is not None else origins
        row["calibration"] = band_calibration(cov.get(k), n, effective.get(k))
    out["status"] = "experimental"
    out["label"] = EXPERIMENTAL_LABEL
    out["investment_advice"] = False
    out["ml_model"] = {"used_in_forecast": False, **ml_status_summary()}
    return out
