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


def _coverage(ind: Optional[Dict]) -> int:
    """How many headline indicators a result has (SMA200 weighs most)."""
    if not ind:
        return 0
    score = sum(1 for k in ("sma_20", "sma_50", "rsi") if ind.get(k) is not None)
    score += 1 if (ind.get("macd") or {}).get("macd") is not None else 0
    return score + (10 if ind.get("sma_200") is not None else 0)


def best_indicators(candidates) -> Optional[Dict]:
    """First result with full coverage, else the best one seen (lazy chain)."""
    best = None
    for fetch in candidates:
        try:
            ind = fetch()
        except Exception as e:  # one dead source must not blank the card
            print(f"indicator source failed: {e}")
            ind = None
        if _coverage(ind) > _coverage(best):
            best = ind
        if best is not None and best.get("sma_200") is not None:
            break
    return best


@router.get("/indicators/{symbol}")
def get_indicators(
    symbol: str,
    db: Session = Depends(get_db)
):
    """Technical indicators from clean DAILY bars.

    Chain: stored daily bars -> 2y yfinance -> Alpaca SIP daily bars (~3y),
    stopping at the first source with enough history for SMA200. Null-close
    bars are dropped and series restart after an unadjusted split, so values
    are never computed from broken or intraday data.
    """
    symbol_upper = normalize_ticker(symbol)
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol_upper).first()

    chain = []
    if db_symbol:
        chain.append(lambda: IndicatorService.get_all_indicators(db, db_symbol.id))
    chain.append(lambda: IndicatorService.get_indicators_from_yfinance(symbol_upper))
    chain.append(lambda: IndicatorService.get_indicators_from_sip(symbol_upper))
    indicators = best_indicators(chain)
    if indicators:
        return {"symbol": symbol_upper, "indicators": indicators}

    # Unknown ticker (no DB row, no upstream data) -> 404 instead of 200 + nulls
    if not db_symbol and not ticker_exists_upstream(symbol_upper):
        raise UnknownTickerError(symbol_upper)

    return {"symbol": symbol_upper, "indicators": EMPTY_INDICATORS}
