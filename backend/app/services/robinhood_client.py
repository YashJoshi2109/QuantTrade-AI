"""
Robinhood Client — US stock quotes via robin_stocks

US-only fallback for real-time quotes. Requires Robinhood account credentials.
Does NOT support international stocks.

Usage:
    from app.services.robinhood_client import robinhood_client

    quote = robinhood_client.get_quote("AAPL")
    quotes = robinhood_client.get_quotes(["AAPL", "MSFT", "GOOGL"])
"""
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from app.config import settings

logger = logging.getLogger(__name__)

_logged_in = False


def _ensure_login() -> bool:
    """Lazy login to Robinhood. Returns True if authenticated."""
    global _logged_in
    if _logged_in:
        return True

    if not settings.ROBINHOOD_USERNAME or not settings.ROBINHOOD_PASSWORD:
        return False

    try:
        import robin_stocks.robinhood as rh

        login_kwargs = {
            "username": settings.ROBINHOOD_USERNAME,
            "password": settings.ROBINHOOD_PASSWORD,
            "store_session": True,
            "expiresIn": 86400,
        }
        if settings.ROBINHOOD_MFA_CODE:
            login_kwargs["mfa_code"] = settings.ROBINHOOD_MFA_CODE

        rh.login(**login_kwargs)
        _logged_in = True
        logger.info("Robinhood login successful")
        return True
    except Exception as e:
        logger.warning(f"Robinhood login failed: {e}")
        return False


class RobinhoodClient:
    """US stock quotes via Robinhood (robin_stocks)."""

    def get_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Fetch real-time quote from Robinhood.
        US stocks only. Returns None if unavailable.
        """
        if not _ensure_login():
            return None

        try:
            import robin_stocks.robinhood as rh

            quotes = rh.stocks.get_quotes(symbol.upper())
            if not quotes or not quotes[0]:
                return None

            q = quotes[0]
            price = float(q.get("last_trade_price") or 0)
            if price <= 0:
                return None

            prev_close = float(q.get("previous_close") or price)
            change = price - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0

            return {
                "symbol": symbol.upper(),
                "price": round(price, 2),
                "change": round(change, 2),
                "change_percent": round(change_pct, 4),
                "volume": int(float(q.get("last_trade_size") or 0)),
                "high": round(float(q.get("high_price") or 0), 2) if q.get("high_price") else 0,
                "low": round(float(q.get("low_price") or 0), 2) if q.get("low_price") else 0,
                "open": round(float(q.get("open_price") or 0), 2) if q.get("open_price") else 0,
                "previous_close": round(prev_close, 2),
                "market_cap": None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data_source": "robinhood",
            }
        except Exception as e:
            logger.debug(f"Robinhood quote failed for {symbol}: {e}")
            return None

    def get_quotes(self, symbols: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
        """Fetch quotes for multiple US symbols."""
        if not _ensure_login():
            return {}

        try:
            import robin_stocks.robinhood as rh

            upper_symbols = [s.upper() for s in symbols]
            raw_quotes = rh.stocks.get_quotes(*upper_symbols)
            if not raw_quotes:
                return {}

            results = {}
            for q in raw_quotes:
                if not q:
                    continue
                sym = q.get("symbol", "").upper()
                price = float(q.get("last_trade_price") or 0)
                if price <= 0:
                    continue

                prev_close = float(q.get("previous_close") or price)
                change = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close else 0

                results[sym] = {
                    "symbol": sym,
                    "price": round(price, 2),
                    "change": round(change, 2),
                    "change_percent": round(change_pct, 4),
                    "volume": 0,
                    "high": round(float(q.get("high_price") or 0), 2) if q.get("high_price") else 0,
                    "low": round(float(q.get("low_price") or 0), 2) if q.get("low_price") else 0,
                    "open": round(float(q.get("open_price") or 0), 2) if q.get("open_price") else 0,
                    "previous_close": round(prev_close, 2),
                    "market_cap": None,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data_source": "robinhood",
                }
            return results
        except Exception as e:
            logger.debug(f"Robinhood batch quotes failed: {e}")
            return {}

    def get_historical(self, symbol: str, interval: str = "day", span: str = "year") -> list:
        """
        Fetch historical data from Robinhood (US stocks only).

        Args:
            symbol: US stock ticker
            interval: "5minute", "10minute", "hour", "day", "week"
            span: "day", "week", "month", "3month", "year", "5year"
        """
        if not _ensure_login():
            return []

        try:
            import robin_stocks.robinhood as rh
            return rh.stocks.get_stock_historicals(
                symbol.upper(), interval=interval, span=span,
            ) or []
        except Exception as e:
            logger.debug(f"Robinhood historical failed for {symbol}: {e}")
            return []


# Singleton
robinhood_client = RobinhoodClient()
