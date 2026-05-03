"""
Unified Real-Time Market Data Service

Multi-source fallback chain: Public.com -> yfinance -> FMP -> Finnhub -> Alpaca -> Robinhood
All methods return standardized data, no synthetic/random data ever.

Usage:
    from app.services.market_data_service import market_data

    quote = await market_data.get_quote("AAPL")
    quotes = await market_data.get_quotes_batch(["AAPL", "MSFT", "GOOGL"])
    history = await market_data.get_historical("AAPL", period="6mo")
"""
import asyncio
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Dict, List, Optional

import pandas as pd

from app.config import settings
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)


@dataclass
class MarketQuote:
    symbol: str
    price: float
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    change_pct: float = 0.0
    volume: int = 0
    avg_volume: int = 0
    market_cap: Optional[float] = None
    name: Optional[str] = None
    timestamp: Optional[str] = None
    source: str = "unknown"

    def to_dict(self) -> dict:
        return asdict(self)


class MarketDataService:
    """Unified async market data with multi-source fallback and Redis caching."""

    # Cache TTLs (seconds)
    QUOTE_TTL = 30          # 30s during market hours
    HISTORY_TTL = 300       # 5 min for historical data
    BATCH_TTL = 45          # 45s for batch quotes

    # ── Public.com (primary — real-time, 10 req/s) ────────────────────────────

    async def _public_quote(self, symbol: str) -> Optional[MarketQuote]:
        """Fetch quote via Public.com API (real-time, US stocks/ETFs/crypto)."""
        try:
            from app.services.public_client import public_client
            q = await public_client.get_quote(symbol)
            if not q or q.get("price", 0) <= 0:
                return None
            return MarketQuote(
                symbol=symbol,
                price=q["price"],
                open=q.get("open"),
                high=q.get("high"),
                low=q.get("low"),
                prev_close=q.get("previous_close"),
                change_pct=q.get("change_percent", 0),
                volume=q.get("volume", 0),
                timestamp=q.get("timestamp"),
                source="public.com",
            )
        except Exception as e:
            logger.debug(f"Public.com quote failed for {symbol}: {e}")
            return None

    async def _public_batch(self, symbols: List[str]) -> Dict[str, MarketQuote]:
        """Batch fetch via Public.com — single API call for all symbols."""
        try:
            from app.services.public_client import public_client
            raw = await public_client.get_quotes(symbols)
            results = {}
            for sym, q in raw.items():
                if q and q.get("price", 0) > 0:
                    results[sym] = MarketQuote(
                        symbol=sym,
                        price=q["price"],
                        open=q.get("open"),
                        high=q.get("high"),
                        low=q.get("low"),
                        prev_close=q.get("previous_close"),
                        change_pct=q.get("change_percent", 0),
                        volume=q.get("volume", 0),
                        timestamp=q.get("timestamp"),
                        source="public.com",
                    )
            return results
        except Exception as e:
            logger.debug(f"Public.com batch failed: {e}")
            return {}

    # ── yfinance (secondary — free, no rate limit) ──────────────────────────

    async def _yf_quote(self, symbol: str) -> Optional[MarketQuote]:
        """Fetch single quote via yfinance (run in thread — it's synchronous)."""
        try:
            def _fetch():
                import yfinance as yf
                ticker = yf.Ticker(symbol)
                info = ticker.fast_info
                hist = ticker.history(period="2d")
                if hist.empty:
                    return None

                price = float(hist["Close"].iloc[-1])
                prev_close = float(hist["Close"].iloc[-2]) if len(hist) > 1 else price
                change = ((price - prev_close) / prev_close * 100) if prev_close else 0

                return MarketQuote(
                    symbol=symbol,
                    price=round(price, 2),
                    open=round(float(hist["Open"].iloc[-1]), 2) if "Open" in hist else None,
                    high=round(float(hist["High"].iloc[-1]), 2) if "High" in hist else None,
                    low=round(float(hist["Low"].iloc[-1]), 2) if "Low" in hist else None,
                    prev_close=round(prev_close, 2),
                    change_pct=round(change, 2),
                    volume=int(hist["Volume"].iloc[-1]) if "Volume" in hist else 0,
                    avg_volume=int(getattr(info, "average_volume", 0) or 0),
                    market_cap=getattr(info, "market_cap", None),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    source="yfinance",
                )
            return await asyncio.to_thread(_fetch)
        except Exception as e:
            logger.debug(f"yfinance quote failed for {symbol}: {e}")
            return None

    async def _yf_batch(self, symbols: List[str]) -> Dict[str, MarketQuote]:
        """Batch fetch via yfinance download — single network call."""
        try:
            def _fetch():
                import yfinance as yf
                df = yf.download(symbols, period="5d", group_by="ticker", progress=False, threads=True)
                results = {}
                for sym in symbols:
                    try:
                        if len(symbols) == 1:
                            data = df
                        else:
                            data = df[sym] if sym in df.columns.get_level_values(0) else None
                        if data is None or data.empty:
                            continue
                        data = data.dropna(subset=["Close"])
                        if data.empty:
                            continue
                        price = float(data["Close"].iloc[-1])
                        prev = float(data["Close"].iloc[-2]) if len(data) > 1 else price
                        change = ((price - prev) / prev * 100) if prev else 0
                        vol = int(data["Volume"].iloc[-1]) if "Volume" in data else 0
                        # Average volume over available days
                        avg_vol = int(data["Volume"].mean()) if "Volume" in data and len(data) > 1 else vol

                        results[sym] = MarketQuote(
                            symbol=sym,
                            price=round(price, 2),
                            open=round(float(data["Open"].iloc[-1]), 2) if "Open" in data else None,
                            high=round(float(data["High"].iloc[-1]), 2) if "High" in data else None,
                            low=round(float(data["Low"].iloc[-1]), 2) if "Low" in data else None,
                            prev_close=round(prev, 2),
                            change_pct=round(change, 2),
                            volume=vol,
                            avg_volume=avg_vol,
                            timestamp=datetime.now(timezone.utc).isoformat(),
                            source="yfinance",
                        )
                    except Exception:
                        continue
                return results
            return await asyncio.to_thread(_fetch)
        except Exception as e:
            logger.warning(f"yfinance batch failed: {e}")
            return {}

    async def _yf_historical(self, symbol: str, period: str = "6mo") -> Optional[pd.DataFrame]:
        """Fetch OHLCV history via yfinance."""
        try:
            def _fetch():
                import yfinance as yf
                df = yf.download(symbol, period=period, progress=False)
                if df.empty:
                    return None
                # Flatten multi-level columns if present
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                return df
            return await asyncio.to_thread(_fetch)
        except Exception as e:
            logger.debug(f"yfinance history failed for {symbol}: {e}")
            return None

    # ── FMP (secondary — 250 calls/day free tier) ────────────────────────────

    async def _fmp_quote(self, symbol: str) -> Optional[MarketQuote]:
        if not settings.FMP_API_KEY:
            return None
        try:
            import httpx
            url = f"https://financialmodelingprep.com/api/v3/quote/{symbol}"
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(url, params={"apikey": settings.FMP_API_KEY})
                if resp.status_code != 200:
                    return None
                data = resp.json()
                if not data:
                    return None
                q = data[0]
                price = q.get("price", 0)
                prev = q.get("previousClose", price)
                change = q.get("changesPercentage", 0)
                return MarketQuote(
                    symbol=symbol,
                    price=round(float(price), 2),
                    open=round(float(q.get("open", 0)), 2) if q.get("open") else None,
                    high=round(float(q.get("dayHigh", 0)), 2) if q.get("dayHigh") else None,
                    low=round(float(q.get("dayLow", 0)), 2) if q.get("dayLow") else None,
                    prev_close=round(float(prev), 2) if prev else None,
                    change_pct=round(float(change), 2),
                    volume=int(q.get("volume", 0)),
                    avg_volume=int(q.get("avgVolume", 0)),
                    market_cap=q.get("marketCap"),
                    name=q.get("name"),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    source="fmp",
                )
        except Exception as e:
            logger.debug(f"FMP quote failed for {symbol}: {e}")
            return None

    # ── Finnhub (tertiary — 60 calls/min) ────────────────────────────────────

    async def _finnhub_quote(self, symbol: str) -> Optional[MarketQuote]:
        if not settings.FINNHUB_API_KEY:
            return None
        try:
            import httpx
            url = "https://finnhub.io/api/v1/quote"
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(url, params={
                    "symbol": symbol,
                    "token": settings.FINNHUB_API_KEY,
                })
                if resp.status_code != 200:
                    return None
                q = resp.json()
                price = q.get("c", 0)
                prev = q.get("pc", price)
                if not price or price == 0:
                    return None
                change = ((price - prev) / prev * 100) if prev else 0
                return MarketQuote(
                    symbol=symbol,
                    price=round(float(price), 2),
                    open=round(float(q.get("o", 0)), 2) if q.get("o") else None,
                    high=round(float(q.get("h", 0)), 2) if q.get("h") else None,
                    low=round(float(q.get("l", 0)), 2) if q.get("l") else None,
                    prev_close=round(float(prev), 2),
                    change_pct=round(change, 2),
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    source="finnhub",
                )
        except Exception as e:
            logger.debug(f"Finnhub quote failed for {symbol}: {e}")
            return None

    # ── Alpaca (US stocks — free, no rate limit) ──────────────────────────

    async def _alpaca_quote(self, symbol: str) -> Optional[MarketQuote]:
        """Fetch quote via Alpaca Markets."""
        try:
            def _fetch():
                from app.services.alpaca_client import alpaca_client
                q = alpaca_client.get_quote(symbol)
                if not q or q.get("price", 0) <= 0:
                    return None
                return MarketQuote(
                    symbol=symbol,
                    price=q["price"],
                    open=q.get("open"),
                    high=q.get("high"),
                    low=q.get("low"),
                    prev_close=q.get("previous_close"),
                    change_pct=q.get("change_percent", 0),
                    volume=q.get("volume", 0),
                    timestamp=q.get("timestamp"),
                    source="alpaca",
                )
            return await asyncio.to_thread(_fetch)
        except Exception as e:
            logger.debug(f"Alpaca quote failed for {symbol}: {e}")
            return None

    # ── Robinhood (US stocks only — requires account) ───────────────────

    async def _robinhood_quote(self, symbol: str) -> Optional[MarketQuote]:
        """Fetch quote via Robinhood (US stocks only)."""
        try:
            def _fetch():
                from app.services.robinhood_client import robinhood_client
                q = robinhood_client.get_quote(symbol)
                if not q or q.get("price", 0) <= 0:
                    return None
                return MarketQuote(
                    symbol=symbol,
                    price=q["price"],
                    open=q.get("open"),
                    high=q.get("high"),
                    low=q.get("low"),
                    prev_close=q.get("previous_close"),
                    change_pct=q.get("change_percent", 0),
                    volume=q.get("volume", 0),
                    timestamp=q.get("timestamp"),
                    source="robinhood",
                )
            return await asyncio.to_thread(_fetch)
        except Exception as e:
            logger.debug(f"Robinhood quote failed for {symbol}: {e}")
            return None

    # ── Alpaca historical (free bars for candlesticks) ──────────────────

    async def _alpaca_historical(self, symbol: str, period: str = "6mo") -> Optional[pd.DataFrame]:
        """Fetch OHLCV history via Alpaca (free, unlimited)."""
        try:
            def _fetch():
                from app.services.alpaca_client import alpaca_client
                return alpaca_client.get_historical_bars_df(symbol, period=period)
            df = await asyncio.to_thread(_fetch)
            return df if df is not None and not df.empty else None
        except Exception as e:
            logger.debug(f"Alpaca history failed for {symbol}: {e}")
            return None

    # ── Public API ───────────────────────────────────────────────────────────

    async def get_quote(self, symbol: str) -> Optional[MarketQuote]:
        """Get real-time quote with multi-source fallback + Redis caching."""
        cache_key = f"qt:quote:{symbol}"

        async def _fetch():
            # Waterfall: Finnhub -> Public.com -> yfinance -> FMP -> Alpaca -> Robinhood
            # Finnhub is primary for research/markets: real-time US data, 60 req/min free tier
            quote = await self._finnhub_quote(symbol)
            if quote and quote.price > 0:
                return quote.to_dict()
            quote = await self._public_quote(symbol)
            if quote and quote.price > 0:
                return quote.to_dict()
            quote = await self._yf_quote(symbol)
            if quote and quote.price > 0:
                return quote.to_dict()
            quote = await self._fmp_quote(symbol)
            if quote and quote.price > 0:
                return quote.to_dict()
            quote = await self._alpaca_quote(symbol)
            if quote and quote.price > 0:
                return quote.to_dict()
            quote = await self._robinhood_quote(symbol)
            if quote and quote.price > 0:
                return quote.to_dict()
            return None

        data = await cache_service.get_or_fetch(cache_key, self.QUOTE_TTL, _fetch)
        if data:
            return MarketQuote(**data)
        return None

    async def get_quotes_batch(self, symbols: List[str]) -> Dict[str, MarketQuote]:
        """Batch fetch quotes. Uses yfinance batch download for efficiency."""
        cache_key = f"qt:batch:{','.join(sorted(symbols[:20]))}"

        async def _fetch():
            # Try Public.com batch first (single API call, real-time)
            results = await self._public_batch(symbols)

            # Fill gaps with yfinance batch
            missing = [s for s in symbols if s not in results]
            if missing:
                yf_results = await self._yf_batch(missing)
                results.update(yf_results)

            # Fill remaining gaps with Finnhub/FMP/Alpaca/Robinhood
            missing = [s for s in symbols if s not in results]
            if missing:
                for sym in missing[:10]:  # Cap individual fallbacks
                    q = await self._finnhub_quote(sym)
                    if not q:
                        q = await self._fmp_quote(sym)
                    if not q:
                        q = await self._alpaca_quote(sym)
                    if not q:
                        q = await self._robinhood_quote(sym)
                    if q and q.price > 0:
                        results[sym] = q

            return {k: v.to_dict() if isinstance(v, MarketQuote) else v
                    for k, v in results.items()}

        data = await cache_service.get_or_fetch(cache_key, self.BATCH_TTL, _fetch)
        if data:
            return {k: MarketQuote(**v) for k, v in data.items()}
        return {}

    async def get_historical(self, symbol: str, period: str = "6mo") -> Optional[pd.DataFrame]:
        """Get OHLCV history with fallback: yfinance → Alpaca. Cached in memory."""
        from app.services.ttl_cache import cache as mem_cache

        cache_key = f"qt:hist:{symbol}:{period}"
        cached = mem_cache.get(cache_key)
        if cached is not None:
            return cached

        # Primary: yfinance
        df = await self._yf_historical(symbol, period)
        # Fallback: Alpaca (free historical bars)
        if df is None or df.empty:
            df = await self._alpaca_historical(symbol, period)
        if df is not None and not df.empty:
            mem_cache.set(cache_key, df, self.HISTORY_TTL)
        return df


# Singleton
market_data = MarketDataService()
