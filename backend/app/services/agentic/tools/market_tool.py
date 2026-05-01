"""Market data tools — realtime quotes, fundamentals, technical indicators.

Wraps existing QuoteCacheService and fmp_client services.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from langchain_core.tools import tool

from app.services.quote_cache import QuoteCacheService  # noqa: E402 — needed for mock patching

logger = logging.getLogger(__name__)


async def get_realtime_quote_impl(ticker: str) -> dict[str, Any]:
    """Fetch realtime quote for ticker. Returns dict with price, change_pct, volume."""
    try:
        from app.db.database import SessionLocal
        db = SessionLocal()
        try:
            svc = QuoteCacheService(db)
            data = await svc.get_quote(ticker.upper())
            return data or {"ticker": ticker, "error": "no data"}
        finally:
            db.close()
    except Exception as exc:
        logger.warning("Quote fetch failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "error": str(exc)}


async def get_fundamentals_impl(ticker: str) -> dict[str, Any]:
    """Fetch fundamental data (P/E, EPS, revenue) for ticker."""
    try:
        from app.services.fmp_client import get_fundamentals_snapshot
        data = get_fundamentals_snapshot(ticker.upper())
        return {"ticker": ticker, "fundamentals": data} if data else {"ticker": ticker}
    except Exception as exc:
        logger.warning("Fundamentals fetch failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "error": str(exc)}


@tool
async def get_realtime_quote(ticker: str) -> dict[str, Any]:
    """Get current stock price, change, and volume for a ticker symbol."""
    return await get_realtime_quote_impl(ticker)


@tool
async def get_fundamentals(ticker: str) -> dict[str, Any]:
    """Get fundamental metrics (P/E ratio, EPS, revenue) for a stock ticker."""
    return await get_fundamentals_impl(ticker)
