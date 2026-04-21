"""
Public.com Client — Real-time quotes, option chains, batch pricing

Primary real-time quote source for US stocks, ETFs, crypto, and bonds.
Uses the official publicdotcom-py SDK.

Rate limit: 10 requests/second (per account).

Capabilities:
- Batch real-time quotes (stocks, ETFs, options, crypto, bonds)
- Option chain with Greeks (up to 250 contracts/batch)
- Polling-based price stream (1-60s configurable)
- Instrument discovery (all tradeable symbols)

Does NOT provide:
- Historical OHLCV bars (use Alpaca/yfinance for backtesting/candlesticks)
- Fundamentals (market cap, P/E, etc.)
- International stocks
- True WebSocket streaming

Usage:
    from app.services.public_client import public_client

    quote = await public_client.get_quote("AAPL")
    quotes = await public_client.get_quotes(["AAPL", "MSFT", "GOOGL"])
    chain = await public_client.get_option_chain("AAPL", "2026-05-16")
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from app.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded SDK clients
_sync_client = None
_async_client = None


_sync_init_failed = False

def _get_sync_client():
    """Lazy-init synchronous Public.com API client."""
    global _sync_client, _sync_init_failed
    if _sync_client is not None:
        return _sync_client
    if _sync_init_failed:
        return None
    if not settings.PUBLIC_API_SECRET_KEY:
        return None
    try:
        from public_api_sdk import PublicApiClient, ApiKeyAuthConfig
        auth = ApiKeyAuthConfig(api_secret_key=settings.PUBLIC_API_SECRET_KEY)
        _sync_client = PublicApiClient(auth_config=auth)
        # Cache account ID
        try:
            accounts = _sync_client.get_accounts()
            if accounts:
                _sync_client._qt_account_id = accounts[0].id if hasattr(accounts[0], 'id') else str(accounts[0])
            else:
                _sync_client._qt_account_id = None
        except Exception:
            _sync_client._qt_account_id = None
        logger.info("Public.com sync client initialized")
        return _sync_client
    except Exception as e:
        _sync_init_failed = True
        logger.warning(f"Public.com sync client init failed: {e}")
        return None


_async_init_failed = False

async def _get_async_client():
    """Lazy-init async Public.com API client."""
    global _async_client, _async_init_failed
    if _async_client is not None:
        return _async_client
    if _async_init_failed:
        return None
    if not settings.PUBLIC_API_SECRET_KEY:
        return None
    try:
        from public_api_sdk import AsyncPublicApiClient, ApiKeyAuthConfig
        auth = ApiKeyAuthConfig(api_secret_key=settings.PUBLIC_API_SECRET_KEY)
        _async_client = AsyncPublicApiClient(auth_config=auth)
        # Cache account ID
        try:
            accounts = await _async_client.get_accounts()
            if accounts:
                _async_client._qt_account_id = accounts[0].id if hasattr(accounts[0], 'id') else str(accounts[0])
            else:
                _async_client._qt_account_id = None
        except Exception:
            _async_client._qt_account_id = None
        logger.info("Public.com async client initialized")
        return _async_client
    except Exception as e:
        _async_init_failed = True
        logger.warning(f"Public.com async client init failed: {e}")
        return None


def _parse_quote(raw: dict) -> Optional[Dict[str, Any]]:
    """Parse a Public.com quote response into standardized format."""
    try:
        outcome = raw.get("outcome", "")
        if outcome != "SUCCESS":
            return None

        instrument = raw.get("instrument", {})
        symbol = instrument.get("symbol", "").upper()
        if not symbol:
            return None

        price = float(raw.get("last", 0) or 0)
        if price <= 0:
            return None

        prev_close = float(raw.get("previousClose", 0) or 0)
        one_day = raw.get("oneDayChange", {}) or {}
        change = float(one_day.get("change", 0) or 0)
        change_pct = float(one_day.get("percentChange", 0) or 0)

        # If oneDayChange not available, compute from previousClose
        if not change and prev_close > 0:
            change = price - prev_close
            change_pct = (change / prev_close * 100)

        volume = int(raw.get("volume", 0) or 0)

        # Bid/Ask spread
        bid = float(raw.get("bid", 0) or 0)
        ask = float(raw.get("ask", 0) or 0)

        return {
            "symbol": symbol,
            "price": round(price, 2),
            "change": round(change, 2),
            "change_percent": round(change_pct, 4),
            "volume": volume,
            "high": 0,  # Not provided in quote endpoint
            "low": 0,
            "open": 0,
            "previous_close": round(prev_close, 2) if prev_close else 0,
            "bid": round(bid, 2) if bid else None,
            "ask": round(ask, 2) if ask else None,
            "bid_size": int(raw.get("bidSize", 0) or 0),
            "ask_size": int(raw.get("askSize", 0) or 0),
            "market_cap": None,
            "timestamp": raw.get("lastTimestamp") or datetime.now(timezone.utc).isoformat(),
            "data_source": "public.com",
        }
    except Exception as e:
        logger.debug(f"Public.com quote parse error: {e}")
        return None


class PublicClient:
    """Public.com API client for real-time quotes and option data."""

    async def get_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch single real-time quote from Public.com."""
        quotes = await self.get_quotes([symbol])
        return quotes.get(symbol.upper())

    async def get_quotes(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Batch fetch real-time quotes for multiple symbols.
        Public.com supports batch quotes in a single API call.
        """
        if not settings.PUBLIC_API_SECRET_KEY:
            return {}

        try:
            client = await _get_async_client()
            if not client:
                return {}

            account_id = getattr(client, '_qt_account_id', None)
            if not account_id:
                return {}

            from public_api_sdk import InstrumentType
            from public_api_sdk.models import OrderInstrument

            instruments = []
            for sym in symbols:
                sym_upper = sym.upper()
                if sym_upper.endswith("-USD") or sym_upper in (
                    "BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX", "DOT",
                ):
                    instruments.append(OrderInstrument(symbol=sym_upper, type=InstrumentType.CRYPTO))
                else:
                    instruments.append(OrderInstrument(symbol=sym_upper, type=InstrumentType.EQUITY))

            response = await client.get_quotes(instruments=instruments, account_id=account_id)

            results = {}
            quotes_list = response if isinstance(response, list) else getattr(response, "quotes", [])

            for raw in quotes_list:
                raw_dict = raw if isinstance(raw, dict) else raw.__dict__
                parsed = _parse_quote(raw_dict)
                if parsed:
                    results[parsed["symbol"]] = parsed

            logger.info(f"Public.com: Fetched {len(results)}/{len(symbols)} quotes")
            return results

        except Exception as e:
            logger.warning(f"Public.com batch quotes failed: {e}")
            # Fallback to sync client in thread
            return await self._get_quotes_sync_fallback(symbols)

    async def _get_quotes_sync_fallback(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """Sync fallback if async client fails."""
        try:
            def _fetch():
                client = _get_sync_client()
                if not client:
                    return {}

                account_id = getattr(client, '_qt_account_id', None)
                if not account_id:
                    return {}

                from public_api_sdk import InstrumentType
                from public_api_sdk.models import OrderInstrument
                instruments = [
                    OrderInstrument(symbol=s.upper(), type=InstrumentType.EQUITY)
                    for s in symbols
                ]
                response = client.get_quotes(instruments=instruments, account_id=account_id)
                quotes_list = response if isinstance(response, list) else getattr(response, "quotes", [])

                results = {}
                for raw in quotes_list:
                    raw_dict = raw if isinstance(raw, dict) else raw.__dict__
                    parsed = _parse_quote(raw_dict)
                    if parsed:
                        results[parsed["symbol"]] = parsed
                return results

            return await asyncio.to_thread(_fetch)
        except Exception as e:
            logger.debug(f"Public.com sync fallback failed: {e}")
            return {}

    async def get_option_chain(
        self,
        symbol: str,
        expiration_date: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch option chain for a symbol at a specific expiration.

        Args:
            symbol: Underlying stock symbol
            expiration_date: ISO date string (e.g. "2026-05-16")

        Returns:
            Dict with calls and puts, each with strike, bid, ask, Greeks.
        """
        if not settings.PUBLIC_API_SECRET_KEY:
            return None

        try:
            client = await _get_async_client()
            if not client:
                return None

            from public_api_sdk import InstrumentType
            from public_api_sdk.models import OrderInstrument

            account_id = getattr(client, '_qt_account_id', None)
            instrument = OrderInstrument(symbol=symbol.upper(), type=InstrumentType.EQUITY)
            response = await client.get_option_chain(
                instrument=instrument,
                expiration_date=expiration_date,
                account_id=account_id,
            )
            return response if isinstance(response, dict) else response.__dict__
        except Exception as e:
            logger.warning(f"Public.com option chain failed for {symbol}: {e}")
            return None

    async def get_option_expirations(self, symbol: str) -> Optional[List[str]]:
        """Get available option expiration dates for a symbol."""
        if not settings.PUBLIC_API_SECRET_KEY:
            return None

        try:
            client = await _get_async_client()
            if not client:
                return None

            from public_api_sdk import InstrumentType
            from public_api_sdk.models import OrderInstrument

            account_id = getattr(client, '_qt_account_id', None)
            instrument = OrderInstrument(symbol=symbol.upper(), type=InstrumentType.EQUITY)
            response = await client.get_option_expirations(
                instrument=instrument,
                account_id=account_id,
            )
            if isinstance(response, dict):
                return response.get("expirations", [])
            return getattr(response, "expirations", [])
        except Exception as e:
            logger.warning(f"Public.com option expirations failed for {symbol}: {e}")
            return None

    async def get_all_instruments(self, instrument_type: str = "EQUITY") -> List[Dict[str, Any]]:
        """
        Get all tradeable instruments from Public.com.
        Useful for building symbol universe.
        """
        if not settings.PUBLIC_API_SECRET_KEY:
            return []

        try:
            client = await _get_async_client()
            if not client:
                return []

            response = await client.get_all_instruments()
            instruments = response if isinstance(response, list) else getattr(response, "instruments", [])

            results = []
            for inst in instruments:
                inst_dict = inst if isinstance(inst, dict) else inst.__dict__
                inst_info = inst_dict.get("instrument", {})
                if inst_info.get("type", "").upper() == instrument_type.upper():
                    results.append({
                        "symbol": inst_info.get("symbol", ""),
                        "type": inst_info.get("type", ""),
                        "trading": inst_dict.get("trading", ""),
                        "fractional": inst_dict.get("fractionalTrading", ""),
                        "options": inst_dict.get("optionTrading", ""),
                    })
            return results
        except Exception as e:
            logger.warning(f"Public.com instruments fetch failed: {e}")
            return []


# Singleton
public_client = PublicClient()
