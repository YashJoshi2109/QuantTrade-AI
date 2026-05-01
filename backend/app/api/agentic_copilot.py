"""
Admin endpoints for Agentic RAG Copilot.
POST /api/v1/copilot/ingest        — trigger ingestion (admin only)
GET  /api/v1/copilot/ingest/status — ingestion progress
GET  /api/v1/copilot/health        — Qdrant + Bedrock connectivity
"""
from __future__ import annotations

import asyncio
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.auth import require_auth
from app.models.user import User
from app.services.agentic.ingestion.orchestrator import (
    run_full_ingestion,
    get_ingestion_status,
    IngestionStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["agentic-copilot"])

_admin_env = os.getenv("ADMIN_EMAILS", "")
ADMIN_EMAILS = set(e.strip() for e in _admin_env.split(",") if e.strip())


def _require_admin(user: User = Depends(require_auth)) -> User:
    if user.email not in ADMIN_EMAILS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


@router.post("/ingest", response_model=dict)
async def trigger_ingestion(
    background_tasks: BackgroundTasks,
    tickers: list[str] | None = None,
    years_back: int = 5,
    _user: User = Depends(_require_admin),
):
    """Trigger SEC filing ingestion in background. Admin only."""
    status_obj = get_ingestion_status()
    if status_obj.is_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ingestion already running",
        )
    # Set is_running=True synchronously before scheduling to close the race window
    status_obj.is_running = True

    def _run_ingestion() -> None:
        asyncio.run(run_full_ingestion(tickers=tickers, years_back=years_back))

    background_tasks.add_task(_run_ingestion)
    return {"status": "started", "message": "Ingestion running in background"}


@router.get("/ingest/status", response_model=IngestionStatus)
async def ingestion_status(_user: User = Depends(_require_admin)):
    """Return current ingestion progress. Admin only."""
    return get_ingestion_status()


@router.get("/health")
async def health_check():
    """Check Qdrant and Bedrock connectivity."""
    checks: dict[str, str] = {}

    try:
        from app.services.agentic.ingestion.indexer import _qdrant_client
        _qdrant_client().get_collections()
        checks["qdrant"] = "ok"
    except Exception as e:
        checks["qdrant"] = f"error: {e}"

    try:
        from app.services.agentic.bedrock_client import embed_query
        vec = embed_query("health check")
        checks["bedrock_titan"] = f"ok (dim={len(vec)})"
    except Exception as e:
        checks["bedrock_titan"] = f"error: {e}"

    all_ok = all(v.startswith("ok") for v in checks.values())
    return {"healthy": all_ok, "checks": checks}
