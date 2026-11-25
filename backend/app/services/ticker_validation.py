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

        hist = yf.Ticker(yahoo_symbol(symbol)).history(period="5d", auto_adjust=False)
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


# ── Provider symbol mapping ───────────────────────────────────────────────
#
# US share-class tickers are written with a dot in our DB / URLs (BRK.B, BF.B),
# but Yahoo Finance and Finviz spell them with a dash (BRK-B, BF-B). Querying
# them with the dot returns nothing, which left BRK.B fundamentals all-null.
#
# Yahoo also uses dots for exchange suffixes (0700.HK, SHOP.TO, VOD.L), which
# must NOT be rewritten. A share class is a single letter after the dot on a
# purely alphabetic root; single-letter Yahoo exchange suffixes are excluded.
_SHARE_CLASS_RE = re.compile(r"^([A-Z]{1,6})\.([A-Z])$")
_YAHOO_SINGLE_LETTER_SUFFIXES = {"L", "V", "F", "T"}


def is_share_class_ticker(symbol: str) -> bool:
    m = _SHARE_CLASS_RE.match((symbol or "").strip().upper())
    return bool(m) and m.group(2) not in _YAHOO_SINGLE_LETTER_SUFFIXES


def yahoo_symbol(symbol: str) -> str:
    """BRK.B -> BRK-B for Yahoo/yfinance; any other symbol is returned upper-cased."""
    sym = (symbol or "").strip().upper()
    return sym.replace(".", "-") if is_share_class_ticker(sym) else sym


def finviz_symbol(symbol: str) -> str:
    """Finviz uses the same dash spelling as Yahoo for share classes (BRK-B)."""
    return yahoo_symbol(symbol)


# ── Asset type ────────────────────────────────────────────────────────────

def classify_asset_type(symbol: str, stored_type: str | None = None) -> str:
    """Return 'index' | 'etf' | 'fund' | 'future' | 'fx' | 'crypto' | 'equity'.

    Index symbols (^GSPC) never have a Symbol row or SEC filer, so the symbol
    shape decides first; the stored asset_type (Equity/ETF/...) decides the rest.
    """
    sym = (symbol or "").strip().upper()
    if sym.startswith("^"):
        return "index"
    if sym.endswith("=F"):
        return "future"
    if sym.endswith("=X"):
        return "fx"
    if re.match(r"^[A-Z0-9]+-USD$", sym):
        return "crypto"
    t = (stored_type or "").strip().lower()
    if t in ("etf", "etn"):
        return "etf"
    if t in ("fund", "mutual fund", "mutualfund", "closed-end fund", "cef"):
        return "fund"
    if t == "index":
        return "index"
    return "equity"
