"""Comparison agent — multi-ticker parallel SEC + quote analysis."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.market_tool import get_realtime_quote_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_comparison_agent(state: dict) -> AgentResult:
    """Comparison agent: parallel SEC search + quotes for each ticker."""
    routing = state.get("routing_decision", {})
    tickers = routing.get("all_tickers") or []
    message = state.get("message", "")

    if len(tickers) < 2:
        return AgentResult(error=f"Comparison needs 2+ tickers, got {len(tickers)}")

    tasks = [
        _search_sec_filings_impl(query=message, tickers=[t], filing_types=["10-K", "10-Q"], limit=4)
        for t in tickers
    ]
    quote_tasks = [get_realtime_quote_impl(t) for t in tickers]

    results      = await asyncio.gather(*tasks, return_exceptions=True)
    quote_results = await asyncio.gather(*quote_tasks, return_exceptions=True)

    all_chunks = []
    for r in results:
        if not isinstance(r, Exception):
            all_chunks.extend(r)

    live_data = {}
    for ticker, q in zip(tickers, quote_results):
        if not isinstance(q, Exception):
            live_data[ticker] = q or {}

    return AgentResult(chunks=all_chunks, live_data=live_data)
