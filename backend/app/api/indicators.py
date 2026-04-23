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

EMPTY_INDICATORS = {
    "current_price": None,
    "sma_20": None,
    "sma_50": None,
    "sma_200": None,
    "rsi": None,
    "macd": {"macd": None, "signal": None, "histogram": None},
    "bollinger_bands": {"upper": None, "middle": None, "lower": None},
}


@router.get("/indicators/{symbol}")
async def get_indicators(
    symbol: str,
    db: Session = Depends(get_db)
):
    """Get technical indicators for a symbol.

    Tries database price history first; falls back to yfinance live data
    so indicators are never blank for valid symbols.
    """
    symbol_upper = symbol.upper()

    # 1. Try database price history
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol_upper).first()
    if db_symbol:
        indicators = IndicatorService.get_all_indicators(db, db_symbol.id)
        if indicators:
            return {"symbol": symbol_upper, "indicators": indicators}

    # 2. Fallback: compute from live yfinance data (no DB required)
    try:
        indicators = IndicatorService.get_indicators_from_yfinance(symbol_upper)
        if indicators:
            return {"symbol": symbol_upper, "indicators": indicators}
    except Exception as e:
        print(f"yfinance indicator fallback failed for {symbol_upper}: {e}")

    return {"symbol": symbol_upper, "indicators": EMPTY_INDICATORS}
