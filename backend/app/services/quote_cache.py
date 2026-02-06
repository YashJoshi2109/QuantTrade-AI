"""
Quote Cache Service - Neon-backed caching for real-time quotes

Implementation Notes:
- Fetches quotes from multiple providers with fallback chain:
  1. Twelve Data API (primary - most reliable, 800 credits/day free)
  2. Yahoo Finance Direct API (fallback - no API key needed)
  3. yfinance library (fallback - uses Yahoo's data)
  4. Finnhub API (tertiary - requires API key)
- Caches results in Neon PostgreSQL (quote_snapshots table)
- TTL-based expiration: 60s market hours, 300s after hours, 600s weekends
- PARALLEL fetching for bulk operations (critical for performance)

TTL Strategy:
- Market hours (9:30 AM - 4:00 PM ET weekdays): 60 seconds
- Pre/after hours (4:00 AM - 9:30 AM, 4:00 PM - 8:00 PM ET): 300 seconds
- Closed (8:00 PM - 4:00 AM ET, weekends): 600 seconds

Usage:
    from app.services.quote_cache import QuoteCacheService
    
    service = QuoteCacheService(db)
    quote = await service.get_quote("AAPL")  # Returns cached or fresh
    quotes = await service.get_quotes(["AAPL", "MSFT", "GOOGL"])  # Parallel batch
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
import asyncio
import pytz
import httpx
import concurrent.futures

from app.models.quote_snapshot import QuoteSnapshot
from app.config import settings


class QuoteCacheService:
    """
    Service for fetching and caching real-time quotes.
    Uses Neon PostgreSQL as the cache store with PARALLEL fetching.
    
    Data Provider Priority:
    1. Yahoo Finance Direct API (primary - free, unlimited, real-time)
    2. yfinance library (fallback - uses Yahoo's data)
    3. Finnhub API (tertiary - requires API key)
    """
    
    # TTL settings (in seconds)
    TTL_MARKET_OPEN = 60      # 1 minute during market hours
    TTL_EXTENDED_HOURS = 300  # 5 minutes pre/after market
    TTL_MARKET_CLOSED = 600   # 10 minutes when market closed
    
    # Parallel fetch settings
    MAX_CONCURRENT_FETCHES = 20  # Max parallel API calls
    BATCH_SIZE = 50  # Process in batches
    
    def __init__(self, db: Session):
        self.db = db
        self.et_tz = pytz.timezone('America/New_York')
    
    def _get_current_ttl(self) -> int:
        """Determine TTL based on current market status"""
        now_et = datetime.now(self.et_tz)
        
        # Check if weekend
        if now_et.weekday() >= 5:  # Saturday = 5, Sunday = 6
            return self.TTL_MARKET_CLOSED
        
        # Check market hours (9:30 AM - 4:00 PM ET)
        market_open = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
        market_close = now_et.replace(hour=16, minute=0, second=0, microsecond=0)
        
        if market_open <= now_et <= market_close:
            return self.TTL_MARKET_OPEN
        
        # Extended hours (4:00 AM - 9:30 AM, 4:00 PM - 8:00 PM ET)
        extended_open = now_et.replace(hour=4, minute=0, second=0, microsecond=0)
        extended_close = now_et.replace(hour=20, minute=0, second=0, microsecond=0)
        
        if extended_open <= now_et <= extended_close:
            return self.TTL_EXTENDED_HOURS
        
        return self.TTL_MARKET_CLOSED
    
    def _is_cache_fresh(self, snapshot: QuoteSnapshot) -> bool:
        """Check if cached snapshot is still fresh"""
        if not snapshot or not snapshot.fetched_at:
            return False
        
        now = datetime.now(timezone.utc)
        fetched_at = snapshot.fetched_at
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        
        age_seconds = (now - fetched_at).total_seconds()
        return age_seconds < snapshot.ttl_seconds
    
    async def _fetch_from_yfinance(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch quote from yfinance - runs in thread pool to avoid blocking"""
        try:
            # Run yfinance in thread pool since it's sync
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self._fetch_yfinance_sync, symbol)
        except Exception as e:
            print(f"yfinance error for {symbol}: {e}")
            return None
    
    def _fetch_yfinance_sync(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Synchronous yfinance fetch using history() method - more reliable"""
        try:
            import yfinance as yf
            ticker = yf.Ticker(symbol)
            
            # Method 1: Try getting 2 days of history (more reliable than fast_info)
            hist = ticker.history(period="2d")
            if hist.empty or len(hist) == 0:
                return None
            
            # Get latest row
            latest = hist.iloc[-1]
            price = float(latest['Close'])
            
            # Get previous close (either from yesterday's data or first row)
            if len(hist) > 1:
                previous_close = float(hist.iloc[-2]['Close'])
            else:
                previous_close = float(latest.get('Open', price))
            
            change = price - previous_close
            change_percent = (change / previous_close * 100) if previous_close else 0
            
            return {
                "symbol": symbol.upper(),
                "price": round(price, 2),
                "change": round(change, 2),
                "change_percent": round(change_percent, 4),
                "volume": int(latest.get('Volume', 0) or 0),
                "high": round(float(latest.get('High', 0) or 0), 2),
                "low": round(float(latest.get('Low', 0) or 0), 2),
                "open": round(float(latest.get('Open', 0) or 0), 2),
                "previous_close": round(previous_close, 2) if previous_close else 0,
                "market_cap": None,  # Not available in history
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data_source": "yfinance"
            }
        except Exception as e:
            print(f"yfinance sync error for {symbol}: {e}")
            return None
    
    async def _fetch_from_yahoo_direct(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch quote directly from Yahoo Finance API (no library dependency)"""
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
            params = {
                "interval": "1d",
                "range": "2d"
            }
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params, headers=headers)
                data = response.json()
            
            result = data.get("chart", {}).get("result", [])
            if not result:
                return None
            
            chart = result[0]
            meta = chart.get("meta", {})
            
            price = meta.get("regularMarketPrice") or meta.get("previousClose")
            previous_close = meta.get("previousClose") or meta.get("chartPreviousClose")
            
            if not price:
                return None
            
            change = price - previous_close if previous_close else 0
            change_percent = (change / previous_close * 100) if previous_close else 0
            
            # Get open/high/low from indicators (more reliable)
            indicators = chart.get("indicators", {}).get("quote", [{}])
            if indicators and len(indicators) > 0:
                quote_data = indicators[0]
                open_prices = quote_data.get("open", [])
                high_prices = quote_data.get("high", [])
                low_prices = quote_data.get("low", [])
                
                # Get latest values (today's data)
                open_price = open_prices[-1] if open_prices else 0
                high_price = high_prices[-1] if high_prices else meta.get("regularMarketDayHigh", 0)
                low_price = low_prices[-1] if low_prices else meta.get("regularMarketDayLow", 0)
            else:
                open_price = 0
                high_price = meta.get("regularMarketDayHigh", 0) or 0
                low_price = meta.get("regularMarketDayLow", 0) or 0
            
            return {
                "symbol": symbol.upper(),
                "price": round(price, 2),
                "change": round(change, 2),
                "change_percent": round(change_percent, 4),
                "volume": meta.get("regularMarketVolume", 0) or 0,
                "high": round(float(high_price or 0), 2),
                "low": round(float(low_price or 0), 2),
                "open": round(float(open_price or 0), 2),
                "previous_close": round(previous_close, 2) if previous_close else 0,
                "market_cap": meta.get("marketCap"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data_source": "yahoo_direct"
            }
        except Exception as e:
            print(f"Yahoo direct error for {symbol}: {e}")
            return None
    
    async def _fetch_from_finnhub(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch quote from Finnhub API"""
        if not settings.FINNHUB_API_KEY:
            return None
        
        try:
            url = "https://finnhub.io/api/v1/quote"
            params = {
                "symbol": symbol.upper(),
                "token": settings.FINNHUB_API_KEY
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params)
                data = response.json()
            
            # Finnhub returns: c=current, d=change, dp=change%, h=high, l=low, o=open, pc=previous close
            if data.get('c'):
                return {
                    "symbol": symbol.upper(),
                    "price": round(data['c'], 2),
                    "change": round(data.get('d', 0), 2),
                    "change_percent": round(data.get('dp', 0), 4),
                    "volume": 0,  # Finnhub quote doesn't include volume
                    "high": round(data.get('h', 0), 2),
                    "low": round(data.get('l', 0), 2),
                    "open": round(data.get('o', 0), 2),
                    "previous_close": round(data.get('pc', 0), 2),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data_source": "finnhub"
                }
        except Exception as e:
            print(f"Finnhub error for {symbol}: {e}")
        
        return None
    
    async def _fetch_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Fetch quote from providers with multiple fallbacks
        
        Priority Order:
        1. Yahoo Finance direct API (primary - free, unlimited, real-time)
        2. yfinance library (fallback)
        3. Finnhub API (if configured)
        """
        # Try Yahoo Finance direct API first (primary source - free & unlimited)
        quote = await self._fetch_from_yahoo_direct(symbol)
        if quote and quote.get('price'):
            return quote
        
        # Try yfinance library
        quote = await self._fetch_from_yfinance(symbol)
        if quote and quote.get('price'):
            return quote
        
        # Fallback to Finnhub
        quote = await self._fetch_from_finnhub(symbol)
        if quote and quote.get('price'):
            return quote
        
        return None
    
    def _update_cache(self, symbol: str, data: Dict[str, Any], ttl: int) -> QuoteSnapshot:
        """Update or create cache entry"""
        snapshot = self.db.query(QuoteSnapshot).filter(
            QuoteSnapshot.symbol == symbol.upper()
        ).first()
        
        if snapshot:
            snapshot.payload = data
            snapshot.fetched_at = datetime.now(timezone.utc)
            snapshot.ttl_seconds = ttl
            snapshot.data_source = data.get('data_source')
        else:
            snapshot = QuoteSnapshot(
                symbol=symbol.upper(),
                payload=data,
                ttl_seconds=ttl,
                data_source=data.get('data_source')
            )
            self.db.add(snapshot)
        
        self.db.commit()
        self.db.refresh(snapshot)
        return snapshot
    
    async def get_quote(self, symbol: str, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Get quote for a symbol, using cache if fresh.
        
        Returns:
            Quote data dict with price, change, etc.
            If unavailable, returns {"unavailable": True}
        """
        symbol = symbol.upper().strip()
        
        # Check cache first (unless force refresh)
        if not force_refresh:
            snapshot = self.db.query(QuoteSnapshot).filter(
                QuoteSnapshot.symbol == symbol
            ).first()
            
            if snapshot and self._is_cache_fresh(snapshot):
                data = snapshot.payload.copy()
                data['cached'] = True
                data['cache_age_seconds'] = (
                    datetime.now(timezone.utc) - snapshot.fetched_at.replace(tzinfo=timezone.utc)
                ).total_seconds()
                return data
        
        # Fetch fresh data
        quote = await self._fetch_quote(symbol)
        
        if quote:
            ttl = self._get_current_ttl()
            self._update_cache(symbol, quote, ttl)
            quote['cached'] = False
            return quote
        
        # Return unavailable indicator (never fake data)
        return {
            "symbol": symbol,
            "unavailable": True,
            "message": "Quote temporarily unavailable",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    
    async def get_quotes(self, symbols: List[str], force_refresh: bool = False) -> Dict[str, Dict[str, Any]]:
        """
        Get quotes for multiple symbols with PARALLEL fetching.
        Much faster than sequential fetching!
        
        Returns:
            Dict mapping symbol to quote data
        """
        if not symbols:
            return {}
        
        results = {}
        symbols_to_fetch = []
        
        # First, check cache for all symbols (fast database query)
        if not force_refresh:
            cached = self._get_cached_quotes_bulk(symbols)
            for symbol, data in cached.items():
                if data:
                    results[symbol] = data
                else:
                    symbols_to_fetch.append(symbol)
        else:
            symbols_to_fetch = [s.upper() for s in symbols]
        
        # Fetch missing quotes in parallel
        if symbols_to_fetch:
            fresh_quotes = await self._fetch_quotes_parallel(symbols_to_fetch)
            
            # Update cache with fresh data
            ttl = self._get_current_ttl()
            for symbol, quote in fresh_quotes.items():
                if quote and not quote.get("unavailable"):
                    self._update_cache(symbol, quote, ttl)
                    quote['cached'] = False
                results[symbol] = quote
        
        # Return unavailable for any remaining symbols
        for symbol in symbols:
            symbol_upper = symbol.upper()
            if symbol_upper not in results:
                results[symbol_upper] = {
                    "symbol": symbol_upper,
                    "unavailable": True,
                    "message": "Quote temporarily unavailable",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
        
        return results
    
    def _get_cached_quotes_bulk(self, symbols: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
        """
        Get multiple cached quotes in a single database query.
        Returns dict with symbol -> quote_data (or None if not cached/expired)
        """
        results = {}
        upper_symbols = [s.upper() for s in symbols]
        
        snapshots = self.db.query(QuoteSnapshot).filter(
            QuoteSnapshot.symbol.in_(upper_symbols)
        ).all()
        
        snapshot_map = {s.symbol: s for s in snapshots}
        
        for symbol in upper_symbols:
            snapshot = snapshot_map.get(symbol)
            if snapshot and self._is_cache_fresh(snapshot):
                data = snapshot.payload.copy()
                data['cached'] = True
                data['cache_age_seconds'] = (
                    datetime.now(timezone.utc) - snapshot.fetched_at.replace(tzinfo=timezone.utc)
                ).total_seconds()
                results[symbol] = data
            else:
                results[symbol] = None
        
        return results
    
    async def _fetch_quotes_parallel(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Fetch quotes for multiple symbols in PARALLEL using asyncio.
        This is the key performance optimization!
        """
        results = {}
        
        # Use semaphore to limit concurrent requests
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_FETCHES)
        
        async def fetch_with_semaphore(symbol: str) -> tuple:
            async with semaphore:
                quote = await self._fetch_quote(symbol)
                return (symbol, quote)
        
        # Process in batches to avoid overwhelming the API
        for i in range(0, len(symbols), self.BATCH_SIZE):
            batch = symbols[i:i + self.BATCH_SIZE]
            tasks = [fetch_with_semaphore(s) for s in batch]
            
            # Gather all results in parallel
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in batch_results:
                if isinstance(result, Exception):
                    continue
                symbol, quote = result
                if quote:
                    results[symbol.upper()] = quote
                else:
                    results[symbol.upper()] = {
                        "symbol": symbol.upper(),
                        "unavailable": True,
                        "message": "Quote temporarily unavailable",
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
        
        return results
    
    def get_cached_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get cached quote without fetching (sync version).
        Returns None if not cached or expired.
        """
        snapshot = self.db.query(QuoteSnapshot).filter(
            QuoteSnapshot.symbol == symbol.upper()
        ).first()
        
        if snapshot and self._is_cache_fresh(snapshot):
            data = snapshot.payload.copy()
            data['cached'] = True
            return data
        
        return None
    
    def clear_cache(self, symbol: Optional[str] = None):
        """Clear cache for a symbol or all symbols"""
        if symbol:
            self.db.query(QuoteSnapshot).filter(
                QuoteSnapshot.symbol == symbol.upper()
            ).delete()
        else:
            self.db.query(QuoteSnapshot).delete()
        self.db.commit()
