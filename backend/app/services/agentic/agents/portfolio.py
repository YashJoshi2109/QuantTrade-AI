"""Portfolio agent — holdings critique + risk analysis."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.market_tool import get_fundamentals_impl
from app.services.agentic.tools.macro_tool import get_macro_data_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_portfolio_agent(state: dict) -> AgentResult:
    """Portfolio agent: fundamentals for each mentioned ticker + macro context."""
    routing = state.get("routing_decision", {})
    tickers = routing.get("all_tickers") or []
    message = state.get("message", "")

    macro_task  = asyncio.create_task(get_macro_data_impl(["FED_RATE", "10Y_YIELD", "VIX"]))
    chunks_task = asyncio.create_task(
        _search_sec_filings_impl(query=message, tickers=tickers or None,
                                 sections=["Risk Factors"], limit=6)
    )

    if tickers[:5]:
        fund_tasks = [get_fundamentals_impl(t) for t in tickers[:5]]
        fund_results_raw = await asyncio.gather(*fund_tasks, return_exceptions=True)
    else:
        fund_results_raw = []

    macro, chunks = await asyncio.gather(macro_task, chunks_task, return_exceptions=True)

    live_data: dict = {}
    for t, f in zip(tickers, fund_results_raw):
        if not isinstance(f, Exception) and f:
            fundamentals = f.get("fundamentals", {})
            live_data[t] = fundamentals if isinstance(fundamentals, dict) else {}
    if not isinstance(macro, Exception):
        live_data["macro"] = macro

    return AgentResult(
        chunks=chunks if not isinstance(chunks, Exception) else [],
        live_data=live_data,
    )
