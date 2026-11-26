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


def ml_model_promoted() -> bool:
    s = ml_model_status()
    passed = s.get("gates_passed")
    return s["verdict"] == "READY" and passed is not None and passed >= s["gates_required"]


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
    return {
        "promoted": promoted,
        "verdict": s["verdict"],
        "gates_passed": passed,
        "gates_total": s["gates_total"],
        "gates_required": s["gates_required"],
        "evaluated_at": s.get("evaluated_at"),
        "note": note,
    }


# ── Forecast calibration labels ──────────────────────────────────────────────

# A band "calibrated" if past outcomes landed inside it about as often as its
# nominal level says. Tolerances allow for ~40 walk-forward origins of noise.
COVERAGE_TOLERANCE = {"80": 0.10, "95": 0.07}
MIN_ORIGINS_FOR_CALIBRATION = 20


def band_calibration(coverage: dict | None, origins: int) -> dict:
    """Return {'status': calibrated|under_covered|over_covered|insufficient_data, ...}."""
    if not coverage or origins < MIN_ORIGINS_FOR_CALIBRATION:
        return {"status": "insufficient_data", "origins": origins}
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
    beats = out.get("beats_naive", {}) or {}
    cov = bt.get("band_coverage", {}) or {}
    for row in out.get("horizons", []):
        k = str(row["h"])
        row["reliability"] = "edge_in_backtest" if beats.get(k) else "no_edge"
        row["calibration"] = band_calibration(cov.get(k), origins)
    out["status"] = "experimental"
    out["label"] = EXPERIMENTAL_LABEL
    out["investment_advice"] = False
    out["ml_model"] = {"used_in_forecast": False, **ml_status_summary()}
    return out
