"""
Symbol API endpoints - MVP Lean Implementation

Production-grade implementation with:
- Universal search using symbols_master table
- Trigram fuzzy search (pg_trgm extension)
- Ranked results with exact matches first
- Rich metadata in responses
- NO external API calls per keystroke

Ranking priority:
1. Exact symbol match (AAPL)
2. Symbol prefix match (AA...)
3. Name prefix match (Apple...)
4. Trigram similarity (name/symbol)
5. Substring contains fallback
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, case, func, literal, text
from typing import List, Optional
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.symbols_master import SymbolsMaster
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


class SearchResultResponse(BaseModel):
    """Rich search result with ranking metadata"""
    symbol: str
    name: Optional[str]
    exchange: Optional[str]
    asset_type: Optional[str]
    currency: Optional[str]
    country: Optional[str]
    sector: Optional[str]
    market_cap: Optional[float] = None
    match_type: str  # 'exact', 'prefix', 'contains', 'fuzzy'
    
    class Config:
        from_attributes = True


@router.get("/symbols/search", response_model=List[SearchResultResponse])
async def universal_search(
    q: str = Query(..., min_length=1, max_length=50, description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
    db: Session = Depends(get_db)
):
    """
    Universal symbol search with ranked results.
    
    Uses symbols_master table with pg_trgm trigram indexes for fast fuzzy search.
    NO external API calls - all data from Neon PostgreSQL.
    
    Ranking priority:
    1. Exact symbol match (AAPL)
    2. Symbol prefix match (AA...)
    3. Name prefix match (Apple...)
    4. Trigram similarity on symbol/name
    5. Substring contains fallback
    
    Returns symbols with rich metadata including exchange, type, currency.
    """
    query_upper = q.strip().upper()
    query_lower = q.strip().lower()
    
    if not query_upper:
        return []
    
    # Try symbols_master first (preferred - has trigram indexes)
    try:
        results = _search_symbols_master(db, query_upper, query_lower, limit)
        if results:
            return results
    except Exception as e:
        # Fall back to symbols table if symbols_master not available
        print(f"symbols_master search failed, falling back: {e}")
    
    # Fallback to original symbols table
    return _search_symbols_fallback(db, query_upper, query_lower, limit)


def _search_symbols_master(
    db: Session, 
    query_upper: str, 
    query_lower: str, 
    limit: int
) -> List[SearchResultResponse]:
    """Search using symbols_master table with trigram support"""
    
    # Build ranking expression with trigram similarity
    # Lower number = higher priority
    rank_expr = case(
        # Tier 1: Exact symbol match
        (func.upper(SymbolsMaster.symbol) == query_upper, literal(1)),
        # Tier 2: Symbol starts with query
        (func.upper(SymbolsMaster.symbol).like(f"{query_upper}%"), literal(2)),
        # Tier 3: Name starts with query (case-insensitive)
        (func.lower(SymbolsMaster.name).like(f"{query_lower}%"), literal(3)),
        # Tier 4: Symbol contains query
        (func.upper(SymbolsMaster.symbol).like(f"%{query_upper}%"), literal(4)),
        # Tier 5: Name contains query
        (func.lower(SymbolsMaster.name).like(f"%{query_lower}%"), literal(5)),
        else_=literal(6)
    )
    
    # Filter: match symbol OR name (prefix, contains, or trigram similarity)
    filter_condition = or_(
        func.upper(SymbolsMaster.symbol).like(f"%{query_upper}%"),
        func.lower(SymbolsMaster.name).like(f"%{query_lower}%"),
        # Trigram similarity threshold (requires pg_trgm)
        text(f"similarity(symbol, '{query_upper}') > 0.3"),
        text(f"similarity(name, '{query_lower}') > 0.3"),
    )
    
    results = (
        db.query(SymbolsMaster, rank_expr.label('rank'))
        .filter(filter_condition)
        .filter(SymbolsMaster.is_active == 'Y')
        .order_by('rank', SymbolsMaster.symbol)
        .limit(limit)
        .all()
    )
    
    def get_match_type(rank: int) -> str:
        if rank == 1:
            return 'exact'
        elif rank in (2, 3):
            return 'prefix'
        elif rank in (4, 5):
            return 'contains'
        else:
            return 'fuzzy'
    
    return [
        SearchResultResponse(
            symbol=sym.symbol,
            name=sym.name,
            exchange=sym.exchange,
            asset_type=sym.asset_type or 'Equity',
            currency=sym.currency or 'USD',
            country=sym.country or 'US',
            sector=sym.sector,
            market_cap=None,  # symbols_master doesn't store market_cap
            match_type=get_match_type(rank)
        )
        for sym, rank in results
    ]


def _search_symbols_fallback(
    db: Session, 
    query_upper: str, 
    query_lower: str, 
    limit: int
) -> List[SearchResultResponse]:
    """Fallback search using original symbols table"""
    
    # Build ranking expression
    rank_expr = case(
        (func.upper(Symbol.symbol) == query_upper, literal(1)),
        (func.upper(Symbol.symbol).like(f"{query_upper}%"), literal(2)),
        (func.lower(Symbol.name).like(f"{query_lower}%"), literal(3)),
        (func.upper(Symbol.symbol).like(f"%{query_upper}%"), literal(4)),
        (func.lower(Symbol.name).like(f"%{query_lower}%"), literal(5)),
        else_=literal(6)
    )
    
    filter_condition = or_(
        func.upper(Symbol.symbol).like(f"%{query_upper}%"),
        func.lower(Symbol.name).like(f"%{query_lower}%") if query_lower else False
    )
    
    results = (
        db.query(Symbol, rank_expr.label('rank'))
        .filter(filter_condition)
        .order_by('rank', Symbol.symbol)
        .limit(limit)
        .all()
    )
    
    def get_match_type(rank: int) -> str:
        if rank == 1:
            return 'exact'
        elif rank in (2, 3):
            return 'prefix'
        else:
            return 'contains'
    
    return [
        SearchResultResponse(
            symbol=sym.symbol,
            name=sym.name,
            exchange=sym.exchange,
            asset_type=sym.asset_type or 'Equity',
            currency=sym.currency or 'USD',
            country=sym.country or 'US',
            sector=sym.sector,
            market_cap=sym.market_cap,
            match_type=get_match_type(rank)
        )
        for sym, rank in results
    ]


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
