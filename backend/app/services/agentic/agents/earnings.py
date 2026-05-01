"""Earnings agent — calendar + guidance + estimates."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_earnings_agent(state: dict) -> AgentResult:
    """Earnings agent: SEC guidance sections + earnings data."""
    routing = state.get("routing_decision", {})
    tickers = routing.get("all_tickers") or []
    message = state.get("message", "")

    chunks = await _search_sec_filings_impl(
        query=message,
        tickers=tickers or None,
        filing_types=["10-Q", "8-K"],
        sections=["MD&A"],
        limit=8,
    )
    live_data: dict = {}
    # Try FMP earnings data if available
    for ticker in tickers[:3]:
        try:
            from app.services.fmp_client import get_fundamentals_snapshot
            snap = get_fundamentals_snapshot(ticker)
            if snap:
                live_data[ticker] = {"earnings_snapshot": snap}
        except Exception:
            pass

    return AgentResult(chunks=chunks, live_data=live_data)
