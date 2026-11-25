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
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, case, func, literal, text
from typing import List, Optional
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.symbols_master import SymbolsMaster
from app.services.data_fetcher import DataFetcher
from app.services.ticker_validation import normalize_ticker
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


logger = logging.getLogger(__name__)

# None = not probed yet. Re-probed every _TRGM_PROBE_TTL seconds so the
# extension being created after startup is picked up without a restart.
_TRGM_AVAILABLE: Optional[bool] = None
_TRGM_PROBED_AT: float = 0.0
_TRGM_PROBE_TTL = 600.0


def _trigram_available(db: Session) -> bool:
    """True when running on PostgreSQL with the pg_trgm extension installed."""
    global _TRGM_AVAILABLE, _TRGM_PROBED_AT
    import time as _time
    if _TRGM_AVAILABLE is not None and _time.monotonic() - _TRGM_PROBED_AT < _TRGM_PROBE_TTL:
        return _TRGM_AVAILABLE
    _TRGM_PROBED_AT = _time.monotonic()
    try:
        if db.get_bind().dialect.name != "postgresql":
            _TRGM_AVAILABLE = False
        else:
            row = db.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
            ).first()
            _TRGM_AVAILABLE = row is not None
            if not _TRGM_AVAILABLE:
                logger.warning(
                    "pg_trgm extension missing — symbol search uses ILIKE only. "
                    "Run CREATE EXTENSION pg_trgm as a superuser to enable fuzzy matching."
                )
    except Exception as e:
        db.rollback()
        logger.warning("pg_trgm probe failed (%s); using ILIKE search", e)
        _TRGM_AVAILABLE = False
    return _TRGM_AVAILABLE


def _like_escape(value: str) -> str:
    """Escape LIKE wildcards in user input (escape char: backslash)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/symbols/search", response_model=List[SearchResultResponse])
def universal_search(
    q: str = Query(..., min_length=1, max_length=50, description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
    db: Session = Depends(get_db)
):
    """
    Universal symbol search with ranked results.

    Uses the symbols_master table. pg_trgm similarity is added only when the
    extension is installed; otherwise (and on SQLite) ranking is ILIKE-based:
    exact symbol, symbol prefix, name prefix, symbol contains, name contains.
    NO external API calls - all data from the database.
    """
    query = q.strip()
    if not query:
        return []
    query_upper = query.upper()

    use_trgm = _trigram_available(db)
    for trgm in ([True, False] if use_trgm else [False]):
        try:
            results = _search_symbols_master(db, query, limit, use_trgm=trgm)
            if results:
                return results
            break  # query succeeded with no rows: try the symbols table
        except Exception as e:
            # A failed statement aborts the PostgreSQL transaction; roll back
            # so the next query on this session can run.
            db.rollback()
            logger.warning("symbols_master search failed (trgm=%s): %s", trgm, e)

    try:
        return _search_symbols_fallback(db, query, limit)
    except Exception as e:
        db.rollback()
        logger.error("symbols fallback search failed for %r: %s", query_upper, e)
        return []


def _rank_and_filter(symbol_col, name_col, query: str):
    """Shared ILIKE ranking (lower = better) and match filter."""
    esc = _like_escape(query)
    rank_expr = case(
        (func.upper(symbol_col) == query.upper(), literal(1)),
        (symbol_col.ilike(f"{esc}%", escape="\\"), literal(2)),
        (name_col.ilike(f"{esc}%", escape="\\"), literal(3)),
        (symbol_col.ilike(f"%{esc}%", escape="\\"), literal(4)),
        (name_col.ilike(f"%{esc}%", escape="\\"), literal(5)),
        else_=literal(6),
    )
    match = or_(
        symbol_col.ilike(f"%{esc}%", escape="\\"),
        name_col.ilike(f"%{esc}%", escape="\\"),
    )
    return rank_expr, match


def _match_type(rank: int) -> str:
    if rank == 1:
        return 'exact'
    if rank in (2, 3):
        return 'prefix'
    if rank in (4, 5):
        return 'contains'
    return 'fuzzy'


def _search_symbols_master(
    db: Session,
    query: str,
    limit: int,
    use_trgm: bool = False,
) -> List[SearchResultResponse]:
    """Search symbols_master; adds pg_trgm similarity matches when available."""
    rank_expr, filter_condition = _rank_and_filter(SymbolsMaster.symbol, SymbolsMaster.name, query)

    if use_trgm:
        filter_condition = or_(
            filter_condition,
            text("similarity(symbols_master.symbol, :q_upper) > 0.3").bindparams(q_upper=query.upper()),
            text("similarity(symbols_master.name, :q_lower) > 0.3").bindparams(q_lower=query.lower()),
        )

    results = (
        db.query(SymbolsMaster, rank_expr.label('rank'))
        .filter(filter_condition)
        .filter(SymbolsMaster.is_active == 'Y')
        .order_by('rank', func.length(SymbolsMaster.symbol), SymbolsMaster.symbol)
        .limit(limit)
        .all()
    )

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
            match_type=_match_type(rank)
        )
        for sym, rank in results
    ]


def _search_symbols_fallback(
    db: Session,
    query: str,
    limit: int,
) -> List[SearchResultResponse]:
    """Fallback ILIKE search on the original symbols table."""
    rank_expr, filter_condition = _rank_and_filter(Symbol.symbol, Symbol.name, query)

    results = (
        db.query(Symbol, rank_expr.label('rank'))
        .filter(filter_condition)
        .order_by('rank', func.length(Symbol.symbol), Symbol.symbol)
        .limit(limit)
        .all()
    )

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
            match_type=_match_type(rank)
        )
        for sym, rank in results
    ]


@router.get("/symbols", response_model=List[SymbolResponse])
def get_symbols(
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
def get_symbol(symbol: str, db: Session = Depends(get_db)):
    """Get symbol details by symbol ticker"""
    sym = normalize_ticker(symbol)
    db_symbol = db.query(Symbol).filter(Symbol.symbol == sym).first()
    
    if not db_symbol:
        # Validates upstream first; unknown tickers raise 404 (no row created)
        db_symbol = DataFetcher.sync_symbol_to_db(db, sym)
    
    return db_symbol


@router.post("/symbols/{symbol}/sync")
def sync_symbol(symbol: str, db: Session = Depends(get_db)):
    """Sync symbol data from external source"""
    try:
        sym = normalize_ticker(symbol)
        db_symbol = DataFetcher.sync_symbol_to_db(db, sym)
        count = DataFetcher.sync_price_data_to_db(db, sym)
        return {
            "symbol": db_symbol.symbol,
            "bars_inserted": count,
            "message": "Symbol synced successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
