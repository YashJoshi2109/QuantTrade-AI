"""
Price data API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
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

router = APIRouter()


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
    db: Session = Depends(get_db)
):
    """Get price bars for a symbol"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        # Try to sync first
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
        # Sync some price data
        DataFetcher.sync_price_data_to_db(db, symbol.upper())
        db.refresh(db_symbol)
    
    query = db.query(PriceBar).filter(PriceBar.symbol_id == db_symbol.id)
    
    if start:
        query = query.filter(PriceBar.timestamp >= start)
    if end:
        query = query.filter(PriceBar.timestamp <= end)
    
    bars = query.order_by(PriceBar.timestamp.asc()).limit(limit).all()
    
    if not bars and not start and not end:
        # If no data, try to fetch
        DataFetcher.sync_price_data_to_db(db, symbol.upper())
        bars = db.query(PriceBar).filter(
            PriceBar.symbol_id == db_symbol.id
        ).order_by(PriceBar.timestamp.asc()).limit(limit).all()
    
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
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
        count = DataFetcher.sync_price_data_to_db(db, symbol.upper(), start, end)
        return {
            "symbol": symbol.upper(),
            "bars_inserted": count,
            "message": "Price data synced successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
