"""
Price data API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.services.data_fetcher import DataFetcher
from app.config import settings
from pydantic import BaseModel
import httpx
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class PriceBarResponse(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    
    class Config:
        from_attributes = True


@router.get("/prices/{symbol}", response_model=List[PriceBarResponse])
async def get_prices(
    symbol: str,
    start: Optional[datetime] = Query(None, description="Start date"),
    end: Optional[datetime] = Query(None, description="End date"),
    limit: int = Query(500, ge=1, le=5000, description="Max number of bars"),
    auto_sync: bool = Query(True, description="Automatically sync data if not available"),
    db: Session = Depends(get_db)
):
    """
    Get price bars for a symbol.
    Automatically syncs data if not available (even with date ranges).
    """
    symbol_upper = symbol.upper()
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol_upper).first()
    
    if not db_symbol:
        # Try to sync symbol first
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol_upper)
        db.refresh(db_symbol)
    
    # Query for existing bars
    query = db.query(PriceBar).filter(PriceBar.symbol_id == db_symbol.id)
    
    if start:
        query = query.filter(PriceBar.timestamp >= start)
    if end:
        query = query.filter(PriceBar.timestamp <= end)
    
    bars = query.order_by(PriceBar.timestamp.asc()).limit(limit).all()
    
    # If no bars found and auto_sync is enabled, try to fetch data
    data_synced = False
    if not bars and auto_sync:
        try:
            logger.info(f"No price data found for {symbol_upper} in range {start} to {end}, attempting sync...")
            
            # If date range provided, sync with that range
            # Otherwise, sync last 3 months (90 days) for chart display
            sync_start = start
            sync_end = end
            
            if not sync_start or not sync_end:
                from datetime import timedelta
                sync_end = datetime.utcnow()
                sync_start = sync_end - timedelta(days=90)  # Default to 3 months
            
            sync_count = DataFetcher.sync_price_data_to_db(db, symbol_upper, sync_start, sync_end)
            
            if sync_count > 0:
                logger.info(f"Synced {sync_count} bars for {symbol_upper}")
                data_synced = True
                # Re-query after sync
                db.refresh(db_symbol)
                query = db.query(PriceBar).filter(PriceBar.symbol_id == db_symbol.id)
                
                if start:
                    query = query.filter(PriceBar.timestamp >= start)
                if end:
                    query = query.filter(PriceBar.timestamp <= end)
                
                bars = query.order_by(PriceBar.timestamp.asc()).limit(limit).all()
            else:
                # If sync returned 0 with date range, try without date range to get any available data
                logger.info(f"No data synced with date range, trying without date range (last year)...")
                sync_count = DataFetcher.sync_price_data_to_db(db, symbol_upper)
                if sync_count > 0:
                    logger.info(f"Synced {sync_count} bars for {symbol_upper} without date range")
                    data_synced = True
                    db.refresh(db_symbol)
                    query = db.query(PriceBar).filter(PriceBar.symbol_id == db_symbol.id)
                    if start:
                        query = query.filter(PriceBar.timestamp >= start)
                    if end:
                        query = query.filter(PriceBar.timestamp <= end)
                    bars = query.order_by(PriceBar.timestamp.asc()).limit(limit).all()
                else:
                    logger.warning(f"Failed to sync any price data for {symbol_upper}")
        except Exception as e:
            # Log error but don't fail - return empty array
            logger.error(f"Error syncing price data for {symbol_upper}: {e}", exc_info=True)
    
    # Log result
    if bars:
        logger.info(f"Returning {len(bars)} bars for {symbol_upper}")
    else:
        logger.warning(f"No price bars found for {symbol_upper} in range {start} to {end}")
    
    return bars


@router.post("/prices/{symbol}/sync")
async def sync_prices(
    symbol: str,
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db)
):
    """Sync price data for a symbol"""
    try:
        symbol_upper = symbol.upper()
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol_upper)
        
        # If no date range provided, default to last 3 months
        if not start or not end:
            from datetime import timedelta
            end = datetime.utcnow()
            start = end - timedelta(days=90)
        
        logger.info(f"Syncing price data for {symbol_upper} from {start} to {end}")
        count = DataFetcher.sync_price_data_to_db(db, symbol_upper, start, end)
        
        # If sync returned 0, try without date range to get any available data
        if count == 0:
            logger.info(f"No data synced with date range for {symbol_upper}, trying without date range...")
            count = DataFetcher.sync_price_data_to_db(db, symbol_upper)
        
        return {
            "symbol": symbol_upper,
            "bars_inserted": count,
            "message": f"Price data synced successfully. Inserted {count} bars."
        }
    except Exception as e:
        logger.error(f"Error syncing price data for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to sync price data: {str(e)}")


@router.get("/prices/{symbol}/quote")
async def get_quote(symbol: str, db: Session = Depends(get_db)):
    """Get live quote for a symbol from Alpha Vantage"""
    try:
        # Try Alpha Vantage GLOBAL_QUOTE
        if settings.ALPHA_VANTAGE_API_KEY:
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "GLOBAL_QUOTE",
                "symbol": symbol.upper(),
                "apikey": settings.ALPHA_VANTAGE_API_KEY
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params)
                data = response.json()
            
            if "Global Quote" in data and data["Global Quote"]:
                quote = data["Global Quote"]
                return {
                    "symbol": quote.get("01. symbol", symbol.upper()),
                    "price": float(quote.get("05. price", 0)),
                    "change": float(quote.get("09. change", 0)),
                    "change_percent": float(quote.get("10. change percent", "0%").rstrip('%')),
                    "volume": int(quote.get("06. volume", 0)),
                    "high": float(quote.get("03. high", 0)),
                    "low": float(quote.get("04. low", 0)),
                    "open": float(quote.get("02. open", 0)),
                    "previous_close": float(quote.get("08. previous close", 0)),
                    "timestamp": quote.get("07. latest trading day", datetime.now().isoformat())
                }
        
        # Fallback to database
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if db_symbol:
            latest_bar = db.query(PriceBar).filter(
                PriceBar.symbol_id == db_symbol.id
            ).order_by(PriceBar.timestamp.desc()).first()
            
            if latest_bar:
                # Get previous bar for change calculation
                prev_bar = db.query(PriceBar).filter(
                    PriceBar.symbol_id == db_symbol.id,
                    PriceBar.timestamp < latest_bar.timestamp
                ).order_by(PriceBar.timestamp.desc()).first()
                
                change = 0
                change_pct = 0
                if prev_bar:
                    change = latest_bar.close - prev_bar.close
                    change_pct = (change / prev_bar.close) * 100 if prev_bar.close else 0
                
                return {
                    "symbol": symbol.upper(),
                    "price": latest_bar.close,
                    "change": change,
                    "change_percent": change_pct,
                    "volume": latest_bar.volume,
                    "high": latest_bar.high,
                    "low": latest_bar.low,
                    "open": latest_bar.open,
                    "previous_close": prev_bar.close if prev_bar else latest_bar.open,
                    "timestamp": latest_bar.timestamp.isoformat()
                }
        
        # Return empty quote
        return {
            "symbol": symbol.upper(),
            "price": 0,
            "change": 0,
            "change_percent": 0,
            "volume": 0,
            "high": 0,
            "low": 0,
            "open": 0,
            "previous_close": 0,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch quote: {str(e)}")
