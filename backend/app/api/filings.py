"""
SEC filings API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.filing import Filing
from app.services.filings_fetcher import FilingsFetcher
from pydantic import BaseModel

router = APIRouter()
filings_fetcher = FilingsFetcher()


class FilingResponse(BaseModel):
    id: int
    form_type: Optional[str]
    filing_date: datetime
    period_end_date: Optional[datetime]
    accession_number: Optional[str]
    url: Optional[str]
    summary: Optional[str]
    
    class Config:
        from_attributes = True


@router.get("/filings/{symbol}", response_model=List[FilingResponse])
async def get_filings(
    symbol: str,
    form_type: Optional[str] = Query(None, description="Filter by form type (e.g., 10-K, 10-Q)"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Get SEC filings for a symbol"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    query = db.query(Filing).filter(Filing.symbol_id == db_symbol.id)
    
    if form_type:
        query = query.filter(Filing.form_type == form_type)
    
    filings = query.order_by(Filing.filing_date.desc()).limit(limit).all()
    
    return filings


@router.get("/filings/{symbol}/{filing_id}")
async def get_filing_detail(
    symbol: str,
    filing_id: int,
    db: Session = Depends(get_db)
):
    """Get detailed filing content"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    filing = db.query(Filing).filter(
        Filing.id == filing_id,
        Filing.symbol_id == db_symbol.id
    ).first()
    
    if not filing:
        raise HTTPException(status_code=404, detail="Filing not found")
    
    return {
        "id": filing.id,
        "form_type": filing.form_type,
        "filing_date": filing.filing_date,
        "period_end_date": filing.period_end_date,
        "accession_number": filing.accession_number,
        "url": filing.url,
        "content": filing.content,
        "summary": filing.summary,
        "chunks_count": len(filing.chunks) if filing.chunks else 0
    }


@router.post("/filings/{symbol}/sync")
async def sync_filings(
    symbol: str,
    use_mock: bool = Query(True, description="Use mock data for testing"),
    db: Session = Depends(get_db)
):
    """Sync SEC filings for a symbol"""
    try:
        count = filings_fetcher.sync_filings_for_symbol(db, symbol, use_mock=use_mock)
        return {
            "symbol": symbol.upper(),
            "filings_synced": count,
            "message": "Filings synced successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
