"""
Technical indicators API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Optional
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.indicators import IndicatorService

router = APIRouter()


@router.get("/indicators/{symbol}")
async def get_indicators(
    symbol: str,
    db: Session = Depends(get_db)
):
    """Get technical indicators for a symbol"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        # Return empty indicators instead of 404 - symbol might be synced later
        return {
            "symbol": symbol.upper(),
            "indicators": {
                "current_price": None,
                "sma_20": None,
                "sma_50": None,
                "sma_200": None,
                "rsi": None,
                "macd": {"macd": None, "signal": None, "histogram": None},
                "bollinger_bands": {"upper": None, "middle": None, "lower": None}
            }
        }
    
    indicators = IndicatorService.get_all_indicators(db, db_symbol.id)
    
    # Return empty indicators if no data available
    if not indicators:
        return {
            "symbol": symbol.upper(),
            "indicators": {
                "current_price": None,
                "sma_20": None,
                "sma_50": None,
                "sma_200": None,
                "rsi": None,
                "macd": {"macd": None, "signal": None, "histogram": None},
                "bollinger_bands": {"upper": None, "middle": None, "lower": None}
            }
        }
    
    return {
        "symbol": symbol.upper(),
        "indicators": indicators
    }
