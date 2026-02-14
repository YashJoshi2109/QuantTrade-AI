"""
Thin client for Financial Modeling Prep (FMP) APIs with simple rate limiting.

Used primarily by the chatbot to enrich answers with up-to-date
fundamental / valuation snapshots without exceeding free-tier limits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Optional

import requests

from app.config import settings


FMP_BASE_URL = "https://financialmodelingprep.com/stable"


@dataclass
class _FMPRateLimiter:
    max_calls: int
    window_seconds: int
    window_start: datetime
    count: int = 0

    def allow(self) -> bool:
        now = datetime.utcnow()
        if now - self.window_start > timedelta(seconds=self.window_seconds):
            # Reset window
            self.window_start = now
            self.count = 0
        if self.count >= self.max_calls:
            return False
        self.count += 1
        return True


# Global in-process limiter: 20 requests per hour
_rate_limiter = _FMPRateLimiter(
    max_calls=20,
    window_seconds=3600,
    window_start=datetime.utcnow(),
)


def _get_api_key() -> Optional[str]:
    # Reuse ALPHA_VANTAGE_API_KEY slot if FMP_API_KEY is not separately configured.
    key = getattr(settings, "FMP_API_KEY", None)
    if not key:
        key = settings.ALPHA_VANTAGE_API_KEY
    return key


def _get(url: str, params: Optional[Dict] = None) -> Optional[Dict]:
    api_key = _get_api_key()
    if not api_key:
        return None

    if not _rate_limiter.allow():
        # Respect 20 req/hour budget; just skip instead of throwing.
        print("⚠️ FMP rate limit (20/hour) reached; skipping request.")
        return None

    params = dict(params or {})
    params.setdefault("apikey", api_key)

    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        # Most FMP endpoints return a list; normalize into a dict when possible
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            return data
        return None
    except Exception as exc:
        print(f"⚠️ FMP request error for {url}: {exc}")
        return None


def get_fundamentals_snapshot(symbol: str) -> Optional[str]:
    """
    Fetch a compact fundamentals / valuation snapshot for use in chatbot prompts.

    Uses a single key-metrics endpoint to keep calls minimal.
    """
    sym = symbol.upper().strip()
    if not sym:
        return None

    url = f"{FMP_BASE_URL}/key-metrics-ttm"
    metrics = _get(url, {"symbol": sym})
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

