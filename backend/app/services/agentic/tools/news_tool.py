"""News tool — recent market news and sentiment."""
from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.tools import tool

from app.config import settings

logger = logging.getLogger(__name__)

NEWSAPI_URL = "https://newsapi.org/v2/everything"


async def _fetch_news(ticker: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch recent news articles for ticker from NewsAPI."""
    api_key = getattr(settings, "NEWS_API_KEY", None) or getattr(settings, "NEWSAPI_KEY", None)
    if not api_key:
        return []
    params = {
        "q": ticker,
        "sortBy": "publishedAt",
        "pageSize": limit,
        "language": "en",
        "apiKey": api_key,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(NEWSAPI_URL, params=params)
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
        return [
            {
                "title":       a.get("title", ""),
                "description": a.get("description", ""),
                "url":         a.get("url", ""),
                "published_at": a.get("publishedAt", ""),
                "source":      a.get("source", {}).get("name", ""),
            }
            for a in articles
        ]


async def get_news_impl(ticker: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch news; gracefully returns empty list on failure."""
    try:
        return await _fetch_news(ticker, limit)
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", ticker, exc)
        return []


@tool
async def get_news(ticker: str, limit: int = 10) -> list[dict[str, Any]]:
    """Get recent news articles for a stock ticker. Returns title, description, url."""
    return await get_news_impl(ticker, limit)
