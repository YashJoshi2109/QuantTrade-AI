"""
Watchlist API endpoints (Phase 3)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.watchlist import Watchlist
from app.models.user import User
from app.api.auth import get_current_user, require_auth
from pydantic import BaseModel

router = APIRouter()


class WatchlistItemResponse(BaseModel):
    id: int
    symbol: str
    name: Optional[str]
    added_at: datetime
    
    class Config:
        from_attributes = True


class AddToWatchlistRequest(BaseModel):
    symbol: str


@router.get("/watchlist", response_model=List[WatchlistItemResponse])
async def get_watchlist(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """Get user's watchlist (requires authentication)"""
    if not current_user:
        # Return empty watchlist for unauthenticated users
        return []
    
    from sqlalchemy.orm import joinedload
    items = db.query(Watchlist).options(
        joinedload(Watchlist.symbol)
    ).filter(Watchlist.user_id == current_user.id).all()
    
    result = []
    for item in items:
        if item.symbol:  # Make sure symbol relationship exists
            result.append(WatchlistItemResponse(
                id=item.id,
                symbol=item.symbol.symbol,
                name=item.symbol.name,
                added_at=item.created_at
            ))
    
    return result


@router.post("/watchlist")
async def add_to_watchlist(
    request: AddToWatchlistRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """Add symbol to watchlist (requires authentication)"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == request.symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    # Check if already in watchlist
    existing = db.query(Watchlist).filter(
        Watchlist.user_id == user.id,
        Watchlist.symbol_id == db_symbol.id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Symbol already in watchlist")
    
    watchlist_item = Watchlist(
        user_id=user.id,
        symbol_id=db_symbol.id
    )
    db.add(watchlist_item)
    db.commit()
    db.refresh(watchlist_item)
    
    return {
        "id": watchlist_item.id,
        "symbol": db_symbol.symbol,
        "message": "Added to watchlist"
    }


@router.delete("/watchlist/{symbol}")
async def remove_from_watchlist(
    symbol: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """Remove symbol from watchlist (requires authentication)"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    item = db.query(Watchlist).filter(
        Watchlist.user_id == user.id,
        Watchlist.symbol_id == db_symbol.id
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Symbol not in watchlist")
    
    db.delete(item)
    db.commit()
    
    return {"message": "Removed from watchlist"}
