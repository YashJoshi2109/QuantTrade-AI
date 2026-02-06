"""
Quotes API - MVP Lean Implementation

Real-time quotes with Neon-backed caching.
NO fake data - returns "unavailable" if provider fails.

Endpoints:
- GET /api/v1/quotes?symbols=AAPL,MSFT,... → Batch quotes with caching
- GET /api/v1/quotes/{symbol} → Single quote

TTL:
- Market hours: 60s
- Extended hours: 5min  
- Closed: 10min

Implementation Notes:
- Uses quote_snapshots table for caching
- Primary source: yfinance
- Backup source: Finnhub
- Returns { unavailable: true } if both fail (never fake data)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime

from app.db.database import get_db
from app.services.quote_cache import QuoteCacheService


router = APIRouter()


class QuoteResponse(BaseModel):
    """Single quote response"""
    symbol: str
    price: Optional[float] = None
    change: Optional[float] = None
    change_percent: Optional[float] = None
    volume: Optional[int] = None
    high: Optional[float] = None
    low: Optional[float] = None
    open: Optional[float] = None
    previous_close: Optional[float] = None
    market_cap: Optional[float] = None
    timestamp: Optional[str] = None
    data_source: Optional[str] = None
    cached: bool = False
    unavailable: bool = False
    message: Optional[str] = None


class BatchQuotesResponse(BaseModel):
    """Batch quotes response"""
    quotes: Dict[str, QuoteResponse]
    fetched_at: str
    cache_hits: int
    cache_misses: int


@router.get("/quotes", response_model=BatchQuotesResponse)
async def get_quotes(
    symbols: str = Query(..., description="Comma-separated symbols (e.g., AAPL,MSFT,GOOGL)"),
    force_refresh: bool = Query(False, description="Force refresh ignoring cache"),
    db: Session = Depends(get_db)
):
    """
    Get quotes for multiple symbols with caching.
    
    Returns real data or unavailable indicator - never fake values.
    
    TTL:
    - Market hours (9:30-4:00 ET): 60 seconds
    - Extended hours: 5 minutes
    - Closed/Weekend: 10 minutes
    
    Example:
        GET /api/v1/quotes?symbols=AAPL,MSFT,GOOGL
    
    Response includes cache stats (hits/misses) for monitoring.
    """
    # Parse symbols
    symbol_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    
    if not symbol_list:
        raise HTTPException(status_code=400, detail="No valid symbols provided")
    
    if len(symbol_list) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 symbols per request")
    
    # Fetch quotes with caching
    service = QuoteCacheService(db)
    raw_quotes = await service.get_quotes(symbol_list, force_refresh)
    
    # Convert to response format and count cache stats
    quotes = {}
    cache_hits = 0
    cache_misses = 0
    
    for symbol, data in raw_quotes.items():
        if data.get('cached'):
            cache_hits += 1
        else:
            cache_misses += 1
        
        quotes[symbol] = QuoteResponse(
            symbol=symbol,
            price=data.get('price'),
            change=data.get('change'),
            change_percent=data.get('change_percent'),
            volume=data.get('volume'),
            high=data.get('high'),
            low=data.get('low'),
            open=data.get('open'),
            previous_close=data.get('previous_close'),
            market_cap=data.get('market_cap'),
            timestamp=data.get('timestamp'),
            data_source=data.get('data_source'),
            cached=data.get('cached', False),
            unavailable=data.get('unavailable', False),
            message=data.get('message')
        )
    
    return BatchQuotesResponse(
        quotes=quotes,
        fetched_at=datetime.utcnow().isoformat(),
        cache_hits=cache_hits,
        cache_misses=cache_misses
    )


@router.get("/quotes/{symbol}", response_model=QuoteResponse)
async def get_quote(
    symbol: str,
    force_refresh: bool = Query(False, description="Force refresh ignoring cache"),
    db: Session = Depends(get_db)
):
    """
    Get quote for a single symbol with caching.
    
    Returns real data or unavailable indicator - never fake values.
    
    Example:
        GET /api/v1/quotes/AAPL
    """
    symbol = symbol.strip().upper()
    
    if not symbol:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    
    service = QuoteCacheService(db)
    data = await service.get_quote(symbol, force_refresh)
    
    return QuoteResponse(
        symbol=symbol,
        price=data.get('price'),
        change=data.get('change'),
        change_percent=data.get('change_percent'),
        volume=data.get('volume'),
        high=data.get('high'),
        low=data.get('low'),
        open=data.get('open'),
        previous_close=data.get('previous_close'),
        market_cap=data.get('market_cap'),
        timestamp=data.get('timestamp'),
        data_source=data.get('data_source'),
        cached=data.get('cached', False),
        unavailable=data.get('unavailable', False),
        message=data.get('message')
    )
