"""Macro data tool — FRED economic indicators."""
from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.tools import tool

from app.config import settings

logger = logging.getLogger(__name__)

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

INDICATOR_SERIES = {
    "GDP_GROWTH":   "A191RL1Q225SBEA",
    "CPI":          "CPIAUCSL",
    "FED_RATE":     "FEDFUNDS",
    "UNEMPLOYMENT": "UNRATE",
    "10Y_YIELD":    "DGS10",
    "VIX":          "VIXCLS",
}


async def _fetch_fred(indicators: list[str]) -> dict[str, Any]:
    """Fetch latest observation for each indicator from FRED."""
    api_key = getattr(settings, "FRED_API_KEY", None)
    if not api_key:
        return {ind: "API key not configured" for ind in indicators}

    results: dict[str, Any] = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for ind in indicators:
            series_id = INDICATOR_SERIES.get(ind)
            if not series_id:
                results[ind] = "Unknown indicator"
                continue
            params = {
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "limit": 1,
                "sort_order": "desc",
            }
            try:
                resp = await client.get(FRED_URL, params=params)
                resp.raise_for_status()
                obs = resp.json().get("observations", [])
                results[ind] = float(obs[0]["value"]) if obs else None
            except Exception as exc:
                logger.warning("FRED fetch failed for %s: %s", ind, exc)
                results[ind] = None
    return results


async def get_macro_data_impl(indicators: list[str]) -> dict[str, Any]:
    """Fetch macro indicators; gracefully handles failures."""
    try:
        return await _fetch_fred(indicators)
    except Exception as exc:
        logger.warning("Macro data fetch failed: %s", exc)
        return {ind: None for ind in indicators}


@tool
async def get_macro_data(indicators: list[str]) -> dict[str, Any]:
    """Get macroeconomic indicators from FRED. Available: GDP_GROWTH, CPI, FED_RATE, UNEMPLOYMENT, 10Y_YIELD, VIX."""
    return await get_macro_data_impl(indicators)
