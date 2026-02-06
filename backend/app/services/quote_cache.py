"""
Quote Cache Service - Neon-backed caching for real-time quotes

Implementation Notes:
- Fetches quotes from yfinance (primary) or Finnhub (backup)
- Caches results in Neon PostgreSQL (quote_snapshots table)
- TTL-based expiration: 60s market hours, 300s after hours, 600s weekends
- Returns cached data if fresh, otherwise fetches and updates

TTL Strategy:
- Market hours (9:30 AM - 4:00 PM ET weekdays): 60 seconds
- Pre/after hours (4:00 AM - 9:30 AM, 4:00 PM - 8:00 PM ET): 300 seconds
- Closed (8:00 PM - 4:00 AM ET, weekends): 600 seconds

Usage:
    from app.services.quote_cache import QuoteCacheService
    
    service = QuoteCacheService(db)
    quote = await service.get_quote("AAPL")  # Returns cached or fresh
    quotes = await service.get_quotes(["AAPL", "MSFT", "GOOGL"])  # Batch
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
import pytz
import httpx

from app.models.quote_snapshot import QuoteSnapshot
from app.config import settings


class QuoteCacheService:
    """
    Service for fetching and caching real-time quotes.
    Uses Neon PostgreSQL as the cache store.
    """
    
    # TTL settings (in seconds)
    TTL_MARKET_OPEN = 60      # 1 minute during market hours
    TTL_EXTENDED_HOURS = 300  # 5 minutes pre/after market
    TTL_MARKET_CLOSED = 600   # 10 minutes when market closed
    
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
        """Fetch quote from yfinance"""
        try:
            import yfinance as yf
            ticker = yf.Ticker(symbol)
            info = ticker.fast_info
            
            # Get basic quote data
            price = getattr(info, 'last_price', None) or getattr(info, 'previous_close', None)
            if not price:
                return None
            
            previous_close = getattr(info, 'previous_close', price)
            change = price - previous_close if previous_close else 0
            change_percent = (change / previous_close * 100) if previous_close else 0
            
            return {
                "symbol": symbol.upper(),
                "price": round(price, 2),
                "change": round(change, 2),
                "change_percent": round(change_percent, 4),
                "volume": getattr(info, 'last_volume', 0) or 0,
                "high": getattr(info, 'day_high', 0) or 0,
                "low": getattr(info, 'day_low', 0) or 0,
                "open": getattr(info, 'open', 0) or 0,
                "previous_close": round(previous_close, 2) if previous_close else 0,
                "market_cap": getattr(info, 'market_cap', None),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data_source": "yfinance"
            }
        except Exception as e:
            print(f"yfinance error for {symbol}: {e}")
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
        """Fetch quote from providers (yfinance first, then Finnhub)"""
        # Try yfinance first
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
        Get quotes for multiple symbols.
        
        Returns:
            Dict mapping symbol to quote data
        """
        results = {}
        
        for symbol in symbols:
            results[symbol.upper()] = await self.get_quote(symbol, force_refresh)
        
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
