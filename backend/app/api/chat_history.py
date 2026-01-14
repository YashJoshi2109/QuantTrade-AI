"""
Chat history API for persisting copilot conversations
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel
import uuid

from app.db.database import get_db
from app.models.user import User
from app.models.chat_history import ChatHistory
from app.api.auth import get_current_user, require_auth

router = APIRouter()


class ChatHistoryItem(BaseModel):
    id: int
    role: str
    content: str
    symbol: Optional[str]
    session_id: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


@router.get("/chat/history", response_model=List[ChatHistoryItem])
async def get_chat_history(
    limit: int = 50,
    session_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """Get chat history for authenticated user"""
    query = db.query(ChatHistory).filter(ChatHistory.user_id == user.id)
    
    if session_id:
        query = query.filter(ChatHistory.session_id == session_id)
    
    history = query.order_by(ChatHistory.created_at.desc()).limit(limit).all()
    return history


@router.delete("/chat/history")
async def clear_chat_history(
    session_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth)
):
    """Clear chat history for authenticated user"""
    query = db.query(ChatHistory).filter(ChatHistory.user_id == user.id)
    
    if session_id:
        query = query.filter(ChatHistory.session_id == session_id)
    
    count = query.delete()
    db.commit()
    
    return {"message": f"Deleted {count} messages"}
