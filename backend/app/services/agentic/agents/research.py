"""Research agent — deep 10-K analysis for STOCK_ANALYSIS intent."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.market_tool import get_realtime_quote_impl, get_fundamentals_impl
from app.services.agentic.tools.news_tool import get_news_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_research_agent(state: dict) -> AgentResult:
    """Research agent: SEC filings + realtime quote + fundamentals + news."""
    routing = state.get("routing_decision", {})
    ticker  = routing.get("primary_ticker") or ""
    message = state.get("message", "")

    if not ticker:
        return AgentResult(error="No ticker for research agent")

    try:
        chunks_task = asyncio.create_task(
            _search_sec_filings_impl(
                query=message,
                tickers=[ticker],
                filing_types=["10-K", "10-Q"],
                limit=8,
            )
        )
        quote_task = asyncio.create_task(get_realtime_quote_impl(ticker))
        fund_task  = asyncio.create_task(get_fundamentals_impl(ticker))
        news_task  = asyncio.create_task(get_news_impl(ticker, limit=5))

        chunks, quote, fund, news = await asyncio.gather(
            chunks_task, quote_task, fund_task, news_task,
            return_exceptions=True,
        )

        live_data = {}
        if not isinstance(quote, Exception):
            live_data[ticker] = {**(quote or {}), "type": "quote"}
        if not isinstance(fund, Exception) and fund:
            live_data.setdefault(ticker, {}).update(fund.get("fundamentals", {}) if isinstance(fund.get("fundamentals"), dict) else {})
        if not isinstance(news, Exception):
            live_data["news"] = news

        return AgentResult(
            chunks=chunks if not isinstance(chunks, Exception) else [],
            live_data=live_data,
        )
    except Exception as exc:
        logger.error("Research agent failed for %s: %s", ticker, exc)
        return AgentResult(error=str(exc))
