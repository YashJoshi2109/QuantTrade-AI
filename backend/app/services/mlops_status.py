"""MLOps status: what the MLOps Command Center can show with what prod has.

The file-backed MLOps services (ml/model_registry, experiment_tracker,
drift_detector, prediction_logger, feature_store) write to the container's
local disk, which is wiped on every deploy, so in prod they are always empty.
The durable sources are Postgres (training_runs, model_versions,
training_artifacts, price_bars, fundamentals), Redis (forecast walk-forward
evaluations) and the committed ML gate snapshot (ml_promotion_status.json).

Every section is fault-isolated and carries an ``empty_reason`` instead of
silently returning nothing.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# price_bars are daily; a few days covers weekends + one exchange holiday.
PRICE_BARS_STALE_DAYS = 4
FUNDAMENTALS_STALE_DAYS = 7

EPHEMERAL_STORE_REASON = (
    "This file-based store lives on the backend container's disk, which is reset on "
    "every deploy; durable model and run records are in Postgres (see Model registry)."
)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _age_days(dt: Optional[datetime], now: datetime) -> Optional[float]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round((now - dt).total_seconds() / 86400, 2)


def _section(fn, *args) -> Dict[str, Any]:
    try:
        return fn(*args)
    except Exception as e:  # one broken source must not blank the page
        logger.warning("mlops status section %s failed: %s", getattr(fn, "__name__", fn), e)
        return {"status": "error", "error": f"{type(e).__name__}: {e}"[:200],
                "empty_reason": "This section could not be loaded; see backend logs."}


# ── ML gate (NOT READY / READY) ──────────────────────────────────────────────

def gate_status() -> Dict[str, Any]:
    from app.services.model_status import ml_model_status, ml_status_summary

    raw = ml_model_status()
    summary = ml_status_summary()
    bt = raw.get("benchmark_test") if isinstance(raw.get("benchmark_test"), dict) else None
    horizons: List[Dict[str, Any]] = []
    for h, row in sorted(((bt or {}).get("horizons") or {}).items(), key=lambda kv: int(kv[0])):
        horizons.append({
            "horizon": int(h),
            "checkpoint": row.get("checkpoint"),
            "tickers": row.get("tickers") or [],
            "oos_period": row.get("oos_period"),
            "origins_per_ticker": row.get("origins_per_ticker"),
            "rel_mae_range": row.get("rel_mae_range"),
            "min_dm_p_one_sided": row.get("min_dm_p_one_sided"),
            "significantly_worse_tickers": row.get("significantly_worse_tickers") or [],
            "edge": bool(row.get("edge")),
        })
    return {
        "status": "ok",
        **summary,
        "served_model": raw.get("served_model"),
        "reason": raw.get("reason"),
        "research_candidate": raw.get("research_candidate"),
        "benchmark_test": {
            "benchmark": (bt or {}).get("benchmark", "ARIMA(0,1,0)"),
            "test": (bt or {}).get("test"),
            "evaluated_at": (bt or {}).get("evaluated_at"),
            "edge_any": (bt or {}).get("edge_any"),
            "finding": (bt or {}).get("finding"),
            "horizons": horizons,
        } if bt else None,
    }


# ── Model registry (Postgres model_versions + training_runs) ──────────────────

def model_registry(db: Session) -> Dict[str, Any]:
    from app.models.ml_training import ModelVersion, TrainingRun

    versions = db.query(ModelVersion).order_by(ModelVersion.created_at.desc()).limit(20).all()
    runs_total = db.query(func.count(TrainingRun.run_id)).scalar() or 0
    completed = (db.query(func.count(TrainingRun.run_id))
                 .filter(TrainingRun.status == "completed").scalar() or 0)
    latest = db.query(TrainingRun).order_by(TrainingRun.created_at.desc()).first()
    rows = [{
        "model_version": v.model_version,
        "promotion_status": v.promotion_status,
        "symbol_count": v.symbol_count,
        "horizons": v.horizons,
        "avg_da": v.avg_directional_accuracy,
        "avg_ic": v.avg_information_coefficient,
        "promoted_at": _iso(v.promoted_at),
        "created_at": _iso(v.created_at),
    } for v in versions]
    prod = next((r for r in rows if r["promotion_status"] == "production"), None)
    empty_reason = None
    if not rows:
        empty_reason = ("No model versions in Postgres yet. A training run must complete "
                        "(Runs tab, or the nightly pipeline) before a version is registered.")
    return {
        "status": "ok" if rows else "empty",
        "versions": rows,
        "production": prod,
        "runs_total": runs_total,
        "runs_completed": completed,
        "latest_run": {
            "run_id": str(latest.run_id),
            "status": latest.status,
            "created_at": _iso(latest.created_at),
            "ended_at": _iso(getattr(latest, "ended_at", None)),
        } if latest else None,
        "empty_reason": empty_reason,
    }


# ── Data freshness (price_bars, fundamentals) ────────────────────────────────

def data_freshness(db: Session, now: Optional[datetime] = None) -> Dict[str, Any]:
    from app.models.fundamentals import Fundamentals
    from app.models.price import PriceBar
    from app.models.symbol import Symbol

    now = now or datetime.now(timezone.utc)
    symbols = db.query(func.count(Symbol.id)).scalar() or 0

    bars, bar_syms, newest, oldest = db.query(
        func.count(PriceBar.id), func.count(func.distinct(PriceBar.symbol_id)),
        func.max(PriceBar.timestamp), func.min(PriceBar.timestamp),
    ).one()
    newest_age = _age_days(newest, now)
    if not bars:
        pb_status, pb_reason = "empty", ("price_bars is empty: no daily history has been synced. "
                                         "Bars are filled when a ticker is viewed or by the price sync job.")
    elif newest_age is not None and newest_age > PRICE_BARS_STALE_DAYS:
        pb_status, pb_reason = "stale", f"Newest bar is {newest_age:.1f} days old."
    else:
        pb_status, pb_reason = "fresh", None

    fund_rows, fund_newest, fund_oldest = db.query(
        func.count(Fundamentals.id), func.max(Fundamentals.fetched_at), func.min(Fundamentals.fetched_at),
    ).one()
    fund_age = _age_days(fund_newest, now)
    if not fund_rows:
        f_status, f_reason = "empty", ("fundamentals is empty: rows are written when a ticker is "
                                       "viewed or by the fundamentals sync job.")
    elif fund_age is not None and fund_age > FUNDAMENTALS_STALE_DAYS:
        f_status, f_reason = "stale", f"Newest fundamentals row is {fund_age:.1f} days old."
    else:
        f_status, f_reason = "fresh", None

    coverage_note = None
    if symbols and (bar_syms < symbols * 0.5 or fund_rows < symbols * 0.5):
        coverage_note = (f"Only {bar_syms} of {symbols} symbols have price history and {fund_rows} have "
                         "fundamentals. Features and AI Baskets fall back to live providers for the rest.")
    return {
        "status": "ok",
        "as_of": now.isoformat(),
        "symbols": symbols,
        "price_bars": {
            "status": pb_status, "rows": bars, "symbols_covered": bar_syms,
            "newest": _iso(newest), "oldest": _iso(oldest), "newest_age_days": newest_age,
            "stale_after_days": PRICE_BARS_STALE_DAYS, "empty_reason": pb_reason,
        },
        "fundamentals": {
            "status": f_status, "rows": fund_rows,
            "newest": _iso(fund_newest), "oldest": _iso(fund_oldest), "newest_age_days": fund_age,
            "stale_after_days": FUNDAMENTALS_STALE_DAYS, "empty_reason": f_reason,
        },
        "coverage_note": coverage_note,
    }


# ── Forecast benchmarks (walk-forward vs ARIMA(0,1,0), Redis-cached) ─────────

async def forecast_benchmarks(tickers=None) -> Dict[str, Any]:
    """Read cached walk-forward evaluations only; never fits a model here."""
    from app.api.forecast import WARM_TICKERS, _eval_key
    from app.services.forecasting.evaluation import BENCHMARK, LABELS
    from app.services.redis_cache_service import cache_service

    tickers = list(tickers or WARM_TICKERS)
    rows: List[Dict[str, Any]] = []
    for t in tickers:
        try:
            ev = await cache_service.get(_eval_key(t))
        except Exception:
            ev = None
        if not isinstance(ev, dict):
            continue
        hz = []
        for h, e in sorted((ev.get("horizons") or {}).items(), key=lambda kv: int(kv[0])):
            primary = e.get("primary")
            hz.append({
                "horizon": int(h),
                "primary": primary,
                "primary_label": LABELS.get(primary, primary) if primary else None,
                "rel_mae": e.get("rel_mae"),
                "dm_pvalue_holm": e.get("dm_pvalue_holm", e.get("dm_pvalue")),
                "edge": bool(e.get("edge")),
                "holdout_origins": e.get("holdout_origins"),
                "effective_tests": e.get("effective_tests"),
            })
        rows.append({"ticker": t, "as_of": ev.get("as_of"), "origins": ev.get("origins"),
                     "order_label": ev.get("order_label"), "budget_hit": bool(ev.get("budget_hit")),
                     "horizons": hz})
    edges = sum(1 for r in rows for h in r["horizons"] if h["edge"])
    tests = sum(len(r["horizons"]) for r in rows)
    return {
        "status": "ok" if rows else "empty",
        "benchmark": BENCHMARK.get("name", "ARIMA(0,1,0)"),
        "checked": len(tickers),
        "cached": len(rows),
        "edges": edges,
        "tests": tests,
        "tickers": rows,
        "empty_reason": None if rows else (
            "No forecast evaluations are cached yet. Each ticker's walk-forward test against "
            "ARIMA(0,1,0) runs on its first /forecast view or in the post-close warm-up, then "
            "stays cached for a week."),
    }


async def build_status(db: Session) -> Dict[str, Any]:
    import asyncio

    now = datetime.now(timezone.utc)
    sync_part = await asyncio.to_thread(
        lambda: {"registry": _section(model_registry, db), "data_freshness": _section(data_freshness, db, now)})
    try:
        bench = await forecast_benchmarks()
    except Exception as e:
        logger.warning("mlops status forecast_benchmarks failed: %s", e)
        bench = {"status": "error", "error": str(e)[:200], "tickers": [],
                 "empty_reason": "Forecast evaluations could not be read (Redis unavailable?)."}
    return {
        "generated_at": now.isoformat(),
        "gate": _section(gate_status),
        "registry": sync_part["registry"],
        "data_freshness": sync_part["data_freshness"],
        "forecast_benchmarks": bench,
        "file_stores": {
            "status": "ephemeral",
            "stores": ["model_registry", "experiment_tracker", "drift_detector", "prediction_logger",
                       "feature_store"],
            "empty_reason": EPHEMERAL_STORE_REASON,
        },
    }
