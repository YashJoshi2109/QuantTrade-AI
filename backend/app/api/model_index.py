"""
Model Index Engine — API Endpoints

Exposes the AI basket intelligence engine via clean REST endpoints.
All read endpoints are public. Write/refresh endpoints require auth.
"""

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.auth.dependencies import get_current_user
from app.services.model_index.orchestrator import Orchestrator
from app.services.model_index.model_index import ModelIndex, INDEX_DEFINITIONS
from app.services.model_index.regime_engine import RegimeEngine
from app.models.model_index import ModelIndexSnapshot, BasketHolding, FactorScoreHistory

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory cache for latest snapshots (refreshed by pipeline runs)
_snapshot_cache: dict = {}


# ── Helper: save snapshot to DB ─────────────────────────────────────────────

def _persist_snapshot(db: Session, index_id: str, snapshot: dict):
    """Save a pipeline result to the database."""
    try:
        record = ModelIndexSnapshot(
            index_id=index_id,
            index_name=snapshot.get("index_name"),
            strategy_type=snapshot.get("strategy_type"),
            regime=snapshot.get("regime"),
            regime_confidence=snapshot.get("regime_confidence"),
            num_holdings=snapshot.get("num_holdings", 0),
            avg_score=snapshot.get("avg_ai_score"),
            risk_score=snapshot.get("risk_score"),
            risk_level=snapshot.get("risk_level"),
            portfolio_beta=snapshot.get("portfolio_beta"),
            portfolio_volatility=snapshot.get("portfolio_volatility_ann"),
            snapshot_data=json.dumps(snapshot, default=str),
        )
        db.add(record)
        db.flush()

        # Save individual holdings
        for h in snapshot.get("holdings", []):
            holding = BasketHolding(
                snapshot_id=record.id,
                ticker=h.get("ticker"),
                company_name=h.get("company_name"),
                sector=h.get("sector"),
                weight=h.get("weight_pct", 0) / 100,
                composite_score=h.get("overall_ai_score"),
                regime_adjusted_score=h.get("overall_ai_score"),
                confidence_score=h.get("confidence_score"),
                grade=h.get("grade"),
                role=h.get("role", {}).get("role_label") if isinstance(h.get("role"), dict) else None,
                factor_scores=json.dumps({
                    "fundamental": h.get("fundamental_score"),
                    "valuation": h.get("valuation_score"),
                    "quality": h.get("quality_score"),
                    "technical": h.get("technical_score"),
                    "sentiment": h.get("sentiment_score"),
                    "macro_fit": h.get("macro_fit_score"),
                    "geopolitical": h.get("geopolitical_resilience_score"),
                    "risk": h.get("risk_score"),
                    "diversification": h.get("diversification_score"),
                    "analyst": h.get("analyst_score"),
                }),
            )
            db.add(holding)

        db.commit()
        logger.info(f"Persisted snapshot for {index_id} (id={record.id})")

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to persist snapshot for {index_id}: {e}")


async def _run_pipeline_background(index_id: str):
    """Background task: use a fresh DB session (request-scoped session is closed after response)."""
    from app.db.database import SessionLocal

    if SessionLocal is None:
        logger.error("Background pipeline skipped: DATABASE_URL not configured")
        return
    db = SessionLocal()
    try:
        orchestrator = Orchestrator(db)
        snapshot = await orchestrator.run_full_pipeline(index_id)
        if "error" not in snapshot:
            _snapshot_cache[index_id] = snapshot
            _persist_snapshot(db, index_id, snapshot)
    except Exception as e:
        logger.error(f"Background pipeline failed for {index_id}: {e}", exc_info=True)
    finally:
        db.close()


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/indices")
async def list_indices():
    """List all available model index definitions."""
    indices = ModelIndex.list_indices()
    return {
        "indices": indices,
        "total": len(indices),
        "generated_at": datetime.utcnow().isoformat(),
    }


# Batch response cache with TTL
_batch_cache: dict = {"data": None, "expires": 0}
_BATCH_TTL_SECONDS = 120  # Cache batch response for 2 minutes


@router.get("/batch")
async def batch_load(db: Session = Depends(get_db)):
    """
    Single call that returns indices + all cached snapshots + regime.
    Eliminates N+1 requests from the frontend.
    Response cached server-side for 2 minutes.
    """
    import time
    now = time.time()

    # Return cached batch if still fresh
    if _batch_cache["data"] and now < _batch_cache["expires"]:
        return _batch_cache["data"]

    indices = ModelIndex.list_indices()

    # Collect all cached snapshots (in-memory first, then DB)
    snapshots: dict = {}
    for idx in indices:
        iid = idx["index_id"]
        if iid in _snapshot_cache:
            snapshots[iid] = _snapshot_cache[iid]
            continue
        db_snap = (
            db.query(ModelIndexSnapshot)
            .filter(ModelIndexSnapshot.index_id == iid)
            .order_by(ModelIndexSnapshot.created_at.desc())
            .first()
        )
        if db_snap:
            try:
                snapshots[iid] = json.loads(db_snap.snapshot_data)
            except json.JSONDecodeError:
                pass

    # Regime: use previously cached value only — never compute live on batch endpoint.
    # Computing regime live calls collect_universe() which fetches 166 stocks
    # and blocks all Gunicorn workers for 30-120 seconds.
    regime = None
    if _batch_cache.get("data"):
        regime = _batch_cache["data"].get("regime")

    result = {
        "indices": indices,
        "snapshots": snapshots,
        "regime": regime,
        "total": len(indices),
        "cached": len(snapshots),
        "generated_at": datetime.utcnow().isoformat(),
    }

    # Cache the response
    _batch_cache["data"] = result
    _batch_cache["expires"] = now + _BATCH_TTL_SECONDS

    return result


@router.get("/indices/{index_id}")
async def get_index(
    index_id: str,
    db: Session = Depends(get_db),
):
    """
    Get the latest snapshot for a specific index.
    Returns cached in-memory result first, falls back to DB.
    """
    # Check in-memory cache
    if index_id in _snapshot_cache:
        return _snapshot_cache[index_id]

    # Check DB for most recent snapshot
    db_snapshot = (
        db.query(ModelIndexSnapshot)
        .filter(ModelIndexSnapshot.index_id == index_id)
        .order_by(ModelIndexSnapshot.created_at.desc())
        .first()
    )

    if db_snapshot:
        try:
            data = json.loads(db_snapshot.snapshot_data)
            return data
        except json.JSONDecodeError:
            pass

    # Check if valid index
    if index_id not in INDEX_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Index '{index_id}' not found")

    return {
        "index_id": index_id,
        "status": "not_generated",
        "message": "No snapshot available. Use POST /refresh to generate.",
    }


@router.post("/indices/{index_id}/refresh")
async def refresh_index(
    index_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
    sync: bool = Query(False, description="Run synchronously (slower but returns result)"),
    fast: bool = Query(
        True,
        description="Skip Monte Carlo + scenario sims (much faster; recommended for sync refresh from UI)",
    ),
):
    """
    Trigger a full pipeline run for an index.
    By default runs in background and returns 202.
    Set sync=true to wait for result.
    """
    if index_id not in INDEX_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Index '{index_id}' not found")

    if sync:
        orchestrator = Orchestrator(db)
        snapshot = await orchestrator.run_full_pipeline(
            index_id,
            skip_monte_carlo=fast,
            skip_scenarios=fast,
        )
        if "error" not in snapshot:
            _snapshot_cache[index_id] = snapshot
            _persist_snapshot(db, index_id, snapshot)
        return snapshot

    # Run in background (full pipeline; uses its own DB session)
    background_tasks.add_task(_run_pipeline_background, index_id)
    return {
        "status": "accepted",
        "index_id": index_id,
        "message": f"Pipeline started for {index_id}. Results will be available shortly.",
    }


@router.post("/indices/refresh-all")
async def refresh_all_indices(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Trigger pipeline for all indices (background)."""
    for index_id in INDEX_DEFINITIONS:
        background_tasks.add_task(_run_pipeline_background, index_id)

    return {
        "status": "accepted",
        "indices": list(INDEX_DEFINITIONS.keys()),
        "message": f"Pipeline started for {len(INDEX_DEFINITIONS)} indices.",
    }


@router.get("/regime")
async def get_regime(db: Session = Depends(get_db)):
    """Get current market regime detection."""
    orchestrator = Orchestrator(db)
    regime = await orchestrator.get_regime()
    return regime


@router.get("/regime/definitions")
async def get_regime_definitions():
    """List all regime type definitions."""
    return {
        "regimes": RegimeEngine.get_all_regimes(),
    }


@router.get("/stock/{ticker}")
async def get_stock_deep_dive(
    ticker: str,
    db: Session = Depends(get_db),
):
    """
    Deep-dive factor analysis for a single stock.
    Returns all 10 dimension scores + risk + explainability.
    """
    orchestrator = Orchestrator(db)
    result = await orchestrator.get_stock_deep_dive(ticker.upper())

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    return result


@router.get("/rankings")
async def get_universe_rankings(
    index_type: str = Query("balanced_core", description="Strategy type for scoring"),
    db: Session = Depends(get_db),
):
    """
    Score and rank the entire stock universe.
    Returns all stocks sorted by composite score.
    """
    if index_type not in BASKET_CONSTRAINTS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid index_type. Valid: {list(BASKET_CONSTRAINTS.keys())}",
        )

    orchestrator = Orchestrator(db)
    rankings = await orchestrator.get_universe_rankings(index_type)
    return rankings


@router.get("/history/{index_id}")
async def get_index_history(
    index_id: str,
    limit: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Get historical snapshots for an index (metadata only, not full payloads)."""
    snapshots = (
        db.query(ModelIndexSnapshot)
        .filter(ModelIndexSnapshot.index_id == index_id)
        .order_by(ModelIndexSnapshot.created_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "index_id": index_id,
        "history": [
            {
                "id": s.id,
                "regime": s.regime,
                "regime_confidence": s.regime_confidence,
                "num_holdings": s.num_holdings,
                "avg_score": s.avg_score,
                "risk_level": s.risk_level,
                "risk_score": s.risk_score,
                "portfolio_beta": s.portfolio_beta,
                "portfolio_volatility": s.portfolio_volatility,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in snapshots
        ],
        "total": len(snapshots),
    }


@router.get("/history/{index_id}/{snapshot_id}")
async def get_historical_snapshot(
    index_id: str,
    snapshot_id: int,
    db: Session = Depends(get_db),
):
    """Get a specific historical snapshot with full data."""
    snapshot = (
        db.query(ModelIndexSnapshot)
        .filter(
            ModelIndexSnapshot.id == snapshot_id,
            ModelIndexSnapshot.index_id == index_id,
        )
        .first()
    )

    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    try:
        return json.loads(snapshot.snapshot_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Corrupted snapshot data")


# Import BASKET_CONSTRAINTS for validation
from app.services.model_index.config import BASKET_CONSTRAINTS
