"""
Thin client for Financial Modeling Prep (FMP) APIs (quota-guarded by fmp_guard).

Used primarily by the chatbot to enrich answers with up-to-date
fundamental / valuation snapshots without exceeding free-tier limits.
"""

from __future__ import annotations

from typing import Dict, Optional


FMP_BASE_URL = "https://financialmodelingprep.com/stable"


def _get(path: str, params: Optional[Dict] = None) -> Optional[Dict]:
    """One FMP call through app.services.fmp_guard (24 h cache, daily budget,
    quota breaker). The old 20-per-hour in-process limiter allowed 480 calls a
    day per process, twice the free quota."""
    from app.services import fmp_guard

    data = fmp_guard.get_json(path, params, ttl=fmp_guard.TTL_FUNDAMENTALS)
    # Most FMP endpoints return a list; normalize into a dict when possible
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0]
    if isinstance(data, dict):
        return data
    return None


def get_fundamentals_snapshot(symbol: str) -> Optional[str]:
    """
    Fetch a compact fundamentals / valuation snapshot for use in chatbot prompts.

    Uses a single key-metrics endpoint to keep calls minimal.
    """
    sym = symbol.upper().strip()
    if not sym:
        return None

    metrics = _get("key-metrics-ttm", {"symbol": sym})
    if not metrics:
        return None

    # Defensive extraction with sane defaults
    pe = metrics.get("peTTM") or metrics.get("peRatioTTM")
    ps = metrics.get("psTTM") or metrics.get("priceToSalesRatioTTM")
    pb = metrics.get("pbTTM") or metrics.get("priceToBookRatioTTM")
    ev_ebitda = metrics.get("evToEbitdaTTM") or metrics.get("enterpriseValueOverEBITDATTM")
    roic = metrics.get("roicTTM")
    margin = metrics.get("netProfitMarginTTM")

    lines = [f"FMP FUNDAMENTALS SNAPSHOT for {sym} (TTM):"]

    if pe is not None:
        lines.append(f"- P/E: {pe:.2f}")
    if ps is not None:
        lines.append(f"- P/S: {ps:.2f}")
    if pb is not None:
        lines.append(f"- P/B: {pb:.2f}")
    if ev_ebitda is not None:
        lines.append(f"- EV/EBITDA: {ev_ebitda:.2f}")
    if roic is not None:
        lines.append(f"- ROIC: {roic:.2f}%")
    if margin is not None:
        lines.append(f"- Net margin: {margin:.2f}%")

    if len(lines) == 1:
        # No usable metrics
        return None

    lines.append(
        "Source: Financial Modeling Prep (TTM key metrics). "
        "Use these as factual anchors; do not guess if a metric is missing."
    )
    return "\n".join(lines)

