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

# Retry after transient init failures (seconds)
_INIT_RETRY_DELAY = 60
_sync_fail_until: float = 0
_async_fail_until: float = 0


def _get_sync_client():
    """Lazy-init synchronous Public.com API client. Retries after transient failures."""
    global _sync_client, _sync_fail_until
    if _sync_client is not None:
        return _sync_client
    import time
    if _sync_fail_until and time.monotonic() < _sync_fail_until:
        return None
    if not settings.PUBLIC_API_SECRET_KEY:
        return None
    try:
        from public_api_sdk import PublicApiClient, ApiKeyAuthConfig
        auth = ApiKeyAuthConfig(api_secret_key=settings.PUBLIC_API_SECRET_KEY)
        _sync_client = PublicApiClient(auth_config=auth)
        # Cache account ID
        try:
            resp = _sync_client.get_accounts()
            acct_list = getattr(resp, 'accounts', None) or (resp if isinstance(resp, list) else [])
            if acct_list:
                acct = acct_list[0]
                _sync_client._qt_account_id = getattr(acct, 'account_id', None) or getattr(acct, 'id', None) or str(acct)
            else:
                _sync_client._qt_account_id = None
        except Exception:
            _sync_client._qt_account_id = None
        _sync_fail_until = 0
        logger.info("Public.com sync client initialized")
        return _sync_client
    except Exception as e:
        _sync_fail_until = time.monotonic() + _INIT_RETRY_DELAY
        logger.warning(f"Public.com sync client init failed (retry in {_INIT_RETRY_DELAY}s): {e}")
        return None


async def _get_async_client():
    """Lazy-init async Public.com API client. Retries after transient failures."""
    global _async_client, _async_fail_until
    if _async_client is not None:
        return _async_client
    import time
    if _async_fail_until and time.monotonic() < _async_fail_until:
        return None
    if not settings.PUBLIC_API_SECRET_KEY:
        return None
    try:
        from public_api_sdk import AsyncPublicApiClient, ApiKeyAuthConfig
        auth = ApiKeyAuthConfig(api_secret_key=settings.PUBLIC_API_SECRET_KEY)
        _async_client = AsyncPublicApiClient(auth_config=auth)
        # Cache account ID
        try:
            resp = await _async_client.get_accounts()
            acct_list = getattr(resp, 'accounts', None) or (resp if isinstance(resp, list) else [])
            if acct_list:
                acct = acct_list[0]
                _async_client._qt_account_id = getattr(acct, 'account_id', None) or getattr(acct, 'id', None) or str(acct)
            else:
                _async_client._qt_account_id = None
        except Exception:
            _async_client._qt_account_id = None
        _async_fail_until = 0
        logger.info("Public.com async client initialized")
        return _async_client
    except Exception as e:
        _async_fail_until = time.monotonic() + _INIT_RETRY_DELAY
        logger.warning(f"Public.com async client init failed (retry in {_INIT_RETRY_DELAY}s): {e}")
        return None


# Regular-session last-price keys, checked in order before the all-session
# `last`. The current public_api_sdk Quote model exposes only `last`, so these
# are forward-compatible hooks for raw/dict payloads that include them.
_REGULAR_LAST_KEYS = ("regularMarketLast", "regular_market_last", "regularLast", "regular_last")

# (symbol, reference session date) -> that session's close, from daily bars.
_prev_close_cache: Dict[tuple, float] = {}


def _et_today():
    try:
        import pytz
        return datetime.now(pytz.timezone("America/New_York")).date()
    except Exception:
        return datetime.now(timezone.utc).date()


def _parse_ts(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def reference_session(quote: Dict[str, Any], now: Optional[datetime] = None) -> tuple:
    """(reference close date, session of the print) for one quote.

    The reference close is the last regular-session close at or before the
    print (market_calendar.last_completed_session). A print in a closed
    window (after 20:00 ET, before 04:00 ET, weekends, holidays) can only be an
    overnight-venue trade, so its session is reported as "overnight".
    """
    from app.services import market_calendar as mc

    printed = _parse_ts(quote.get("market_time"))
    at = printed or now or datetime.now(timezone.utc)
    session = mc.print_session(at) if printed else mc.session_at(at)
    if session == mc.REGULAR:
        # Includes the closing print at 16:00:00: its baseline is the prior
        # session, not the close it just made.
        return mc.previous_trading_day(mc._to_et(at).date()), session
    return mc.last_completed_session(at), session


def _fetch_previous_closes(symbols, ref_dates: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
    """Close of each symbol's reference session, from daily bars.

    ``ref_dates`` maps symbol -> the session date whose close is the baseline
    (see reference_session). Without it the baseline is the last session
    before today (ET), the old behaviour. One batched yfinance download;
    results are cached per (symbol, date). Blocking: call via asyncio.to_thread.
    """
    today = _et_today()
    ref_dates = ref_dates or {}
    out: Dict[str, float] = {}
    missing = []
    for sym in symbols:
        cached = _prev_close_cache.get((sym, ref_dates.get(sym, today)))
        if cached:
            out[sym] = cached
        else:
            missing.append(sym)
    if not missing:
        return out
    if len(_prev_close_cache) > 5000:
        _prev_close_cache.clear()
    try:
        import yfinance as yf
        import pandas as pd

        data = yf.download(
            missing, period="10d", interval="1d", progress=False,
            group_by="ticker", auto_adjust=False, threads=False, timeout=10,
        )
        if data is None or data.empty:
            return out
        for sym in missing:
            try:
                frame = data[sym] if isinstance(data.columns, pd.MultiIndex) else data
                closes = frame["Close"].dropna()
                ref = ref_dates.get(sym)
                if ref is not None:
                    closes = closes[[d.date() <= ref for d in closes.index]]
                    # The reference session's own bar must be present; an older
                    # bar would silently re-create the two-sessions-back baseline.
                    if not len(closes) or closes.index[-1].date() != ref:
                        continue
                else:
                    closes = closes[[d.date() < today for d in closes.index]]
                if len(closes):
                    val = float(closes.iloc[-1])
                    if val > 0:
                        out[sym] = val
                        _prev_close_cache[(sym, ref if ref is not None else today)] = val
            except Exception:
                continue
    except Exception as e:
        logger.debug(f"previous-close lookup failed: {e}")
    return out


def _apply_previous_close(quote: Dict[str, Any], prev_close: float) -> None:
    """Fill previous_close and recompute change fields from the quote price."""
    price = quote.get("price") or 0
    if prev_close <= 0 or price <= 0:
        return
    change = price - prev_close
    quote["previous_close"] = round(prev_close, 2)
    quote["change"] = round(change, 2)
    quote["change_percent"] = round(change / prev_close * 100, 4)


def _parse_quote(raw) -> Optional[Dict[str, Any]]:
    """Parse a Public.com Quote object or dict into standardized format.

    The SDK returns Quote objects with enum/Decimal attributes, not plain dicts.
    """
    try:
        # Support both dict access and attribute access
        def _get(obj, key, default=None):
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)

        outcome = _get(raw, "outcome", "")
        # Enum .value or string comparison
        outcome_str = getattr(outcome, "value", outcome) if outcome else ""
        if outcome_str != "SUCCESS":
            return None

        instrument = _get(raw, "instrument", None)
        symbol = (_get(instrument, "symbol", "") or "").upper() if instrument else ""
        if not symbol:
            return None

        # Field choice (see _REGULAR_LAST_KEYS): the SDK's `last` is the most
        # recent trade in ANY session (pre/after-hours/overnight). Prefer a
        # regular-session last when the payload carries one; otherwise use
        # `last`. change/change_percent are then always DERIVED from
        # price - previous_close so the three fields can never disagree.
        # (Previously `last` was paired with a regular-session oneDayChange,
        # or — when Public omitted it — quote_cache spliced Yahoo's change onto
        # Public's extended-hours price, e.g. NVDA 151.33 vs 165.05 - 9.67.)
        price = 0.0
        for key in _REGULAR_LAST_KEYS:
            val = _get(raw, key, None)
            if val:
                price = float(val)
                break
        if price <= 0:
            price = float(_get(raw, "last", 0) or 0)
        if price <= 0:
            return None

        prev_close = float(_get(raw, "previousClose", 0) or _get(raw, "previous_close", 0) or 0)
        one_day = _get(raw, "oneDayChange", None)
        if prev_close <= 0 and one_day:
            # No explicit previous close: back it out of the reported change,
            # which is only valid relative to the same `last` price.
            reported = _get(one_day, "change", None)
            if reported not in (None, ""):
                derived = price - float(reported)
                prev_close = derived if derived > 0 else 0.0

        if prev_close > 0:
            change = price - prev_close
            change_pct = change / prev_close * 100
        else:
            # Unknown baseline: report no change rather than a mismatched one.
            # PublicClient.get_quotes() fills previous_close from daily bars.
            change = 0.0
            change_pct = 0.0

        volume = int(_get(raw, "volume", 0) or 0)

        # Bid/Ask spread
        bid = float(_get(raw, "bid", 0) or 0)
        ask = float(_get(raw, "ask", 0) or 0)

        ts = _get(raw, "last_timestamp", None) or _get(raw, "lastTimestamp", None)
        market_time = ts.isoformat() if hasattr(ts, "isoformat") else (str(ts) if ts else None)
        ts_str = market_time or datetime.now(timezone.utc).isoformat()

        return {
            "symbol": symbol,
            "price": round(price, 2),
            "change": round(change, 2),
            "change_percent": round(change_pct, 4),
            "volume": volume,
            "high": None,  # Not provided by Public.com quote endpoint
            "low": None,
            "open": None,
            "previous_close": round(prev_close, 2) if prev_close else 0,
            "bid": round(bid, 2) if bid else None,
            "ask": round(ask, 2) if ask else None,
            "bid_size": int(_get(raw, "bid_size", 0) or _get(raw, "bidSize", 0) or 0),
            "ask_size": int(_get(raw, "ask_size", 0) or _get(raw, "askSize", 0) or 0),
            "market_cap": None,
            "timestamp": ts_str,
            "market_time": market_time,  # last trade; None when Public doesn't report it
            "data_source": "public.com",
        }
    except Exception as e:
        logger.debug(f"Public.com quote parse error: {e}")
        return None


class PublicClient:
    """Public.com API client for real-time quotes and option data."""

    async def _fill_previous_closes(self, results: Dict[str, Dict[str, Any]]) -> None:
        """Rebase every equity quote on its reference session's close.

        Public's quote either has no previous close (change=0, which let
        downstream code pair Public's price with another provider's change) or
        one that is not the close before the print: on Thanksgiving 2026 at
        21:21 ET it reported AAPL 357.75 (an overnight print) against 354.07,
        the Nov 24 close, i.e. +1.04% instead of +0.61% vs the Nov 25 close
        355.58. The baseline now always comes from daily bars for the session
        market_calendar says the print belongs after; Public's own figure is
        kept only when the bars are unavailable.
        """
        ref_dates: Dict[str, Any] = {}
        for sym, q in results.items():
            if sym.endswith("-USD"):
                continue
            ref, session = reference_session(q)
            q["session"] = session
            q["reference_close_date"] = ref.isoformat()
            ref_dates[sym] = ref
        if not ref_dates:
            return
        try:
            prevs = await asyncio.wait_for(
                asyncio.to_thread(_fetch_previous_closes, list(ref_dates), ref_dates), timeout=12)
        except Exception as e:
            logger.debug(f"Public.com previous-close fill failed: {e}")
            return
        for sym, prev in prevs.items():
            if sym in results:
                _apply_previous_close(results[sym], prev)

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

            await self._fill_previous_closes(results)
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

            results = await asyncio.to_thread(_fetch)
            await self._fill_previous_closes(results)
            return results
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
            from public_api_sdk.models.option import OptionChainRequest

            account_id = getattr(client, '_qt_account_id', None)
            instrument = OrderInstrument(symbol=symbol.upper(), type=InstrumentType.EQUITY)
            # SDK >= 0.1.10 takes a request model, not instrument=/expiration_date= kwargs
            # (the old call raised "unexpected keyword argument 'instrument'" every time).
            response = await client.get_option_chain(
                OptionChainRequest(instrument=instrument, expiration_date=expiration_date),
                account_id=account_id,
            )
            if isinstance(response, dict):
                return response
            return option_chain_response_to_dict(response)
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
            from public_api_sdk.models.option import OptionExpirationsRequest

            account_id = getattr(client, '_qt_account_id', None)
            instrument = OrderInstrument(symbol=symbol.upper(), type=InstrumentType.EQUITY)
            response = await client.get_option_expirations(
                OptionExpirationsRequest(instrument=instrument),
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


def occ_strike(option_symbol: str) -> Optional[float]:
    """Strike from an OCC option symbol, e.g. NVDA261127C00190000 -> 190.0."""
    sym = (option_symbol or "").strip()
    if len(sym) < 15 or not sym[-8:].isdigit():
        return None
    return int(sym[-8:]) / 1000.0


def option_chain_response_to_dict(response: Any) -> Dict[str, Any]:
    """Flatten SDK OptionChainResponse (calls/puts lists of Quote) into the
    {"options": [...]} shape app/api/options.py parses, tagging each contract's type."""
    options: List[Dict[str, Any]] = []
    for side in ("calls", "puts"):
        for q in getattr(response, side, None) or []:
            inst = getattr(q, "instrument", None)
            sym = getattr(inst, "symbol", "") if inst is not None else ""
            options.append({
                "symbol": sym,
                "strike": occ_strike(sym),
                "bid": getattr(q, "bid", None),
                "ask": getattr(q, "ask", None),
                "last": getattr(q, "last", None),
                "volume": getattr(q, "volume", None),
                "openInterest": getattr(q, "open_interest", None),
                "type": "PUT" if side == "puts" else "CALL",
            })
    return {"options": options}
