"""
Risk metrics API endpoints (Phase 3)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.risk_scorer import RiskScorer

router = APIRouter()


@router.get("/risk/{symbol}")
async def get_risk_metrics(
    symbol: str,
    db: Session = Depends(get_db)
):
    """Get risk metrics for a symbol"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    risk_data = RiskScorer.calculate_risk_score(db, db_symbol.id)
    
    return {
        "symbol": symbol.upper(),
        **risk_data
    }


@router.get("/risk/portfolio")
async def get_portfolio_risk(
    user_id: str,
    db: Session = Depends(get_db)
):
    """Get portfolio risk metrics (Phase 3)"""
    # TODO: Get user's watchlist/portfolio
    # For now, return placeholder
    return {
        "user_id": user_id,
        "portfolio_risk_score": 0,
        "message": "Portfolio risk calculation coming in Phase 3"
    }
