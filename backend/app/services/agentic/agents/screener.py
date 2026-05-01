"""Screener agent — NL -> filter -> ranked universe."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_screener_agent(state: dict) -> AgentResult:
    """Screener agent: get top movers + relevant SEC search."""
    message = state.get("message", "")
    live_data: dict = {}

    try:
        from app.api.market import get_top_gainers, get_top_losers
        from app.db.database import SessionLocal
        async with asyncio.timeout(5.0):
            db = SessionLocal()
            try:
                gainers = await get_top_gainers(10, db)
                losers  = await get_top_losers(10, db)
            finally:
                db.close()
        live_data["gainers"] = [g.dict() if hasattr(g, "dict") else g for g in (gainers or [])]
        live_data["losers"]  = [l.dict() if hasattr(l, "dict") else l for l in (losers or [])]
    except Exception as exc:
        logger.warning("Screener market data failed: %s", exc)
        live_data = {"gainers": [], "losers": []}

    chunks = await _search_sec_filings_impl(
        query=message, tickers=None, filing_types=["8-K"], limit=5
    )
    return AgentResult(chunks=chunks, live_data=live_data)
