"""
Admin endpoints for Agentic RAG Copilot.
POST /api/v1/copilot/ingest        — trigger ingestion (admin only)
GET  /api/v1/copilot/ingest/status — ingestion progress
GET  /api/v1/copilot/health        — Qdrant + Bedrock connectivity
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.auth import require_auth
from app.config import settings
from app.models.user import User

# Orchestrator imports sentence_transformers → torch (heavy). Import lazily so
# gunicorn workers don't pay the torch startup cost on every boot.
# The functions are referenced inside endpoint bodies, not at module load time.

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["agentic-copilot"])

ADMIN_EMAILS = set(e.strip() for e in settings.ADMIN_EMAILS.split(",") if e.strip())


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
    from app.services.agentic.ingestion.orchestrator import (  # noqa: PLC0415
        run_full_ingestion,
        get_ingestion_status,
    )
    status_obj = get_ingestion_status()
    if status_obj.is_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ingestion already running",
        )
    status_obj.is_running = True

    background_tasks.add_task(run_full_ingestion, tickers=tickers, years_back=years_back)
    return {"status": "started", "message": "Ingestion running in background"}


@router.get("/ingest/status")
async def ingestion_status(_user: User = Depends(_require_admin)):
    """Return current ingestion progress. Admin only."""
    from app.services.agentic.ingestion.orchestrator import get_ingestion_status  # noqa: PLC0415
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
