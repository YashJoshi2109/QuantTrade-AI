"""
Symbol API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.data_fetcher import DataFetcher
from pydantic import BaseModel

router = APIRouter()


class SymbolResponse(BaseModel):
    id: int
    symbol: str
    name: Optional[str]
    sector: Optional[str]
    industry: Optional[str]
    market_cap: Optional[float]
    
    class Config:
        from_attributes = True


@router.get("/symbols", response_model=List[SymbolResponse])
async def get_symbols(
    search: Optional[str] = Query(None, description="Search by symbol or name"),
    db: Session = Depends(get_db)
):
    """Get list of symbols, optionally filtered by search"""
    query = db.query(Symbol)
    
    if search:
        search_term = f"%{search.upper()}%"
        query = query.filter(
            (Symbol.symbol.ilike(search_term)) |
            (Symbol.name.ilike(search_term))
        )
    
    symbols = query.limit(100).all()
    return symbols


@router.get("/symbols/{symbol}", response_model=SymbolResponse)
async def get_symbol(symbol: str, db: Session = Depends(get_db)):
    """Get symbol details by symbol ticker"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        # Try to fetch and create
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
    
    return db_symbol


@router.post("/symbols/{symbol}/sync")
async def sync_symbol(symbol: str, db: Session = Depends(get_db)):
    """Sync symbol data from external source"""
    try:
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
        count = DataFetcher.sync_price_data_to_db(db, symbol.upper())
        return {
            "symbol": db_symbol.symbol,
            "bars_inserted": count,
            "message": "Symbol synced successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
