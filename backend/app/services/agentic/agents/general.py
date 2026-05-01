"""General agent — education, market overview, macro context."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.macro_tool import get_macro_data_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_general_agent(state: dict) -> AgentResult:
    """General agent: broad SEC search (no ticker filter) + macro data."""
    message = state.get("message", "")

    chunks_task = asyncio.create_task(
        _search_sec_filings_impl(
            query=message,
            tickers=None,  # cross-company search
            filing_types=["10-K"],
            limit=6,
        )
    )
    macro_task = asyncio.create_task(
        get_macro_data_impl(["FED_RATE", "CPI", "GDP_GROWTH", "10Y_YIELD"])
    )

    chunks, macro = await asyncio.gather(chunks_task, macro_task, return_exceptions=True)

    live_data = {}
    if not isinstance(macro, Exception):
        live_data["macro"] = macro

    return AgentResult(
        chunks=chunks if not isinstance(chunks, Exception) else [],
        live_data=live_data,
    )
