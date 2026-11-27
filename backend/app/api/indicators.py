"""
Technical indicators API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Optional
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.indicators import IndicatorService
from app.services.ticker_validation import (
    UnknownTickerError, normalize_ticker, ticker_exists_upstream,
)

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
def get_indicators(
    symbol: str,
    db: Session = Depends(get_db)
):
    """Get technical indicators for a symbol.

    Tries database price history first; falls back to yfinance live data
    so indicators are never blank for valid symbols.
    """
    symbol_upper = normalize_ticker(symbol)

    # 1. Try database price history
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol_upper).first()
    if db_symbol:
        indicators = IndicatorService.get_all_indicators(db, db_symbol.id)
        if indicators and indicators.get("sma_200") is None:
            # Under 200 stored daily bars (AMD and MSFT on 2026-11-27): SMA200
            # was blank on Research while the trend signals rely on it. A year
            # of yfinance bars gives the full set from one source.
            try:
                full = IndicatorService.get_indicators_from_yfinance(symbol_upper)
            except Exception:
                full = None
            if full and full.get("sma_200") is not None:
                indicators = full
        if indicators:
            return {"symbol": symbol_upper, "indicators": indicators}

    # 2. Fallback: compute from live yfinance data (no DB required)
    try:
        indicators = IndicatorService.get_indicators_from_yfinance(symbol_upper)
        if indicators:
            return {"symbol": symbol_upper, "indicators": indicators}
    except Exception as e:
        print(f"yfinance indicator fallback failed for {symbol_upper}: {e}")

    # Unknown ticker (no DB row, no upstream data) -> 404 instead of 200 + nulls
    if not db_symbol and not ticker_exists_upstream(symbol_upper):
        raise UnknownTickerError(symbol_upper)

    return {"symbol": symbol_upper, "indicators": EMPTY_INDICATORS}
