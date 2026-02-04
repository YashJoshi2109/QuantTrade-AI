"""
Watchlist API endpoints

Implementation Notes:
- API Contract:
  GET    /api/v1/watchlist           → List user's watchlist items (200)
  POST   /api/v1/watchlist           → Add item { symbol, note? } (201 created, 409 duplicate)
  DELETE /api/v1/watchlist/{symbol}  → Remove item by symbol (204 no content)
  PUT    /api/v1/watchlist/{symbol}  → Update note { note } (200)

- Error Codes:
  400 - Invalid input (bad symbol format)
  401 - Not authenticated
  404 - Symbol not found
  409 - Duplicate entry (symbol already in watchlist)

- Symbol validation: ^[A-Z0-9.\-]{1,10}$ (uppercase, alphanumeric, dots, dashes)
"""
import re
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.watchlist import Watchlist
from app.models.user import User
from app.api.auth import get_current_user, require_auth

router = APIRouter()

# Symbol validation regex
SYMBOL_PATTERN = re.compile(r'^[A-Z0-9.\-]{1,10}$')


def validate_symbol(symbol: str) -> str:
    """Validate and normalize symbol to uppercase"""
    normalized = symbol.strip().upper()
    if not SYMBOL_PATTERN.match(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid symbol format: '{symbol}'. Must be 1-10 characters, uppercase letters, numbers, dots, or dashes."
        )
    return normalized


# Pydantic schemas
class WatchlistItemResponse(BaseModel):
    id: int
    symbol: str
    name: Optional[str] = None
    note: Optional[str] = None
    source: Optional[str] = None
    added_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class AddToWatchlistRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10, description="Stock symbol (e.g., AAPL)")
    note: Optional[str] = Field(None, max_length=500, description="Optional note about this stock")
    source: Optional[str] = Field(None, max_length=50, description="Where you found this stock")
    
    @field_validator('symbol')
    @classmethod
    def normalize_symbol(cls, v: str) -> str:
        return v.strip().upper()


class UpdateNoteRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500, description="Updated note")


class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None


@router.get("/watchlist", response_model=List[WatchlistItemResponse])
async def get_watchlist(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """
    Get user's watchlist items.
    Returns empty list for unauthenticated users.
    """
    if not current_user:
        return []
    
    from sqlalchemy.orm import joinedload
    items = db.query(Watchlist).options(
        joinedload(Watchlist.symbol)
    ).filter(Watchlist.user_id == current_user.id).order_by(Watchlist.created_at.desc()).all()
    
    result = []
    for item in items:
        if item.symbol:
            result.append(WatchlistItemResponse(
                id=item.id,
                symbol=item.symbol.symbol,
                name=item.symbol.name,
                note=item.notes,
                source=item.source,
                added_at=item.created_at,
                updated_at=item.updated_at
            ))
    
    return result


@router.post(
    "/watchlist",
    response_model=WatchlistItemResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"model": ErrorResponse, "description": "Symbol already in watchlist"},
        404: {"model": ErrorResponse, "description": "Symbol not found"},
        400: {"model": ErrorResponse, "description": "Invalid symbol format"},
    }
)
async def add_to_watchlist(
    request: AddToWatchlistRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """
    Add a symbol to user's watchlist.
    Returns 201 on success, 409 if duplicate.
    """
    # Validate and normalize symbol
    symbol = validate_symbol(request.symbol)
    
    # Find symbol in database
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol).first()
    
    if not db_symbol:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Symbol '{symbol}' not found. Try syncing it first."
        )
    
    # Check for existing entry (application-level check before DB)
    existing = db.query(Watchlist).filter(
        Watchlist.user_id == user.id,
        Watchlist.symbol_id == db_symbol.id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Symbol '{symbol}' is already in your watchlist"
        )
    
    # Create new watchlist entry
    watchlist_item = Watchlist(
        user_id=user.id,
        symbol_id=db_symbol.id,
        notes=request.note,
        source=request.source
    )
    
    try:
        db.add(watchlist_item)
        db.commit()
        db.refresh(watchlist_item)
    except IntegrityError:
        # Race condition: another request added it first
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Symbol '{symbol}' is already in your watchlist"
        )
    
    return WatchlistItemResponse(
        id=watchlist_item.id,
        symbol=db_symbol.symbol,
        name=db_symbol.name,
        note=watchlist_item.notes,
        source=watchlist_item.source,
        added_at=watchlist_item.created_at,
        updated_at=watchlist_item.updated_at
    )


@router.delete(
    "/watchlist/{symbol}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"model": ErrorResponse, "description": "Symbol not in watchlist"},
    }
)
async def remove_from_watchlist(
    symbol: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """
    Remove a symbol from user's watchlist.
    Returns 204 No Content on success.
    """
    normalized_symbol = validate_symbol(symbol)
    
    db_symbol = db.query(Symbol).filter(Symbol.symbol == normalized_symbol).first()
    
    if not db_symbol:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Symbol '{normalized_symbol}' not found"
        )
    
    item = db.query(Watchlist).filter(
        Watchlist.user_id == user.id,
        Watchlist.symbol_id == db_symbol.id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Symbol '{normalized_symbol}' is not in your watchlist"
        )
    
    db.delete(item)
    db.commit()
    
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/watchlist/{symbol}",
    response_model=WatchlistItemResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Symbol not in watchlist"},
    }
)
async def update_watchlist_item(
    symbol: str,
    request: UpdateNoteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """
    Update note for a watchlist item.
    Returns 200 with updated item.
    """
    normalized_symbol = validate_symbol(symbol)
    
    db_symbol = db.query(Symbol).filter(Symbol.symbol == normalized_symbol).first()
    
    if not db_symbol:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Symbol '{normalized_symbol}' not found"
        )
    
    item = db.query(Watchlist).filter(
        Watchlist.user_id == user.id,
        Watchlist.symbol_id == db_symbol.id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Symbol '{normalized_symbol}' is not in your watchlist"
        )
    
    item.notes = request.note
    db.commit()
    db.refresh(item)
    
    return WatchlistItemResponse(
        id=item.id,
        symbol=db_symbol.symbol,
        name=db_symbol.name,
        note=item.notes,
        source=item.source,
        added_at=item.created_at,
        updated_at=item.updated_at
    )
