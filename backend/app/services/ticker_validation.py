"""
Ticker validation helpers.

User-supplied tickers flow into endpoints that lazily create ``Symbol`` rows
(prices, fundamentals, symbols/{T}, ...). Without validation, a request for a
nonexistent ticker such as ``ZZZZZ`` created a junk row and returned 200 with
zeros. These helpers enforce a syntax guard and confirm the ticker exists
upstream before any row is written.
"""
from __future__ import annotations

import logging
import re

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Letters, digits, dot and dash (BRK.B, BF-B), 1-10 chars, after upper-casing.
TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


class UnknownTickerError(HTTPException):
    """Raised when a ticker is malformed or does not exist upstream.

    Subclasses HTTPException so FastAPI turns it into a 404 automatically,
    while non-HTTP callers (batch jobs) can still catch it as an Exception.
    """

    def __init__(self, symbol: str):
        self.symbol = symbol
        super().__init__(status_code=404, detail=f"Unknown ticker: {symbol}")


def normalize_ticker(symbol: str) -> str:
    """Upper-case/strip and syntax-check a ticker. Raises UnknownTickerError."""
    sym = (symbol or "").strip().upper()
    if not TICKER_RE.match(sym):
        raise UnknownTickerError(sym or symbol)
    return sym


def ticker_exists_upstream(symbol: str) -> bool:
    """Return True when an upstream data source knows this ticker.

    Checks yfinance recent daily history first (no key needed), then the
    Finnhub company profile when a key is configured. Network errors are
    treated as "unknown" for that provider only.
    """
    try:
        import yfinance as yf

        hist = yf.Ticker(symbol).history(period="5d", auto_adjust=False)
        if hist is not None and not hist.empty:
            return True
    except Exception as e:  # pragma: no cover - network dependent
        logger.debug("yfinance validation failed for %s: %s", symbol, e)

    try:
        from app.config import settings

        if getattr(settings, "FINNHUB_API_KEY", None):
            from app.services.finnhub_fetcher import FinnhubFetcher

            profile = FinnhubFetcher.get_company_profile(symbol, priority="high")
            if profile and (profile.get("name") or profile.get("ticker")):
                return True
    except Exception as e:  # pragma: no cover - network dependent
        logger.debug("Finnhub validation failed for %s: %s", symbol, e)

    return False
