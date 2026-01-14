"""
Chat/AI Copilot API endpoints with RAG integration
"""
from datetime import datetime, timezone
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.chat_history import ChatHistory
from app.models.user import User
from app.services.rag_service import RAGService
from app.api.auth import get_current_user, require_auth

router = APIRouter()
rag_service = RAGService()


class ChatMessage(BaseModel):
    message: str
    symbol: Optional[str] = None
    include_news: bool = True
    include_filings: bool = True
    top_k: int = 5
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    sources: List[str]
    context_docs: int
    symbol: Optional[str] = None
    session_id: Optional[str] = None


class ChatHistoryItem(BaseModel):
    id: int
    role: str
    content: str
    symbol: Optional[str]
    session_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/chat", response_model=ChatResponse)
async def chat(
    message: ChatMessage,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """AI copilot chat endpoint with RAG and history persistence"""
    symbol_id = None

    if message.symbol:
        db_symbol = db.query(Symbol).filter(
            Symbol.symbol == message.symbol.upper()
        ).first()
        if db_symbol:
            symbol_id = db_symbol.id
        # If symbol not found, continue anyway

    # Ensure we have a session id for grouping messages
    session_id = message.session_id or str(uuid.uuid4())
    user_id = current_user.id if current_user else None
    symbol_value = message.symbol.upper() if message.symbol else None

    # Query RAG service
    result = rag_service.query(
        db=db,
        query=message.message,
        symbol=message.symbol,
        symbol_id=symbol_id,
        include_news=message.include_news,
        include_filings=message.include_filings,
        top_k=message.top_k,
    )

    # Persist chat messages (user + assistant). Fail soft if something goes wrong.
    try:
        now = datetime.now(timezone.utc)
        user_msg = ChatHistory(
            user_id=user_id,
            session_id=session_id,
            symbol=symbol_value,
            role="user",
            content=message.message,
            created_at=now,
        )
        assistant_msg = ChatHistory(
            user_id=user_id,
            session_id=session_id,
            symbol=symbol_value,
            role="assistant",
            content=result["response"],
            created_at=now,
        )
        db.add_all([user_msg, assistant_msg])
        db.commit()
    except Exception as e:
        print(f"⚠️ Failed to save chat history: {e}")
        db.rollback()

    return ChatResponse(
        response=result["response"],
        sources=result.get("sources", []),
        context_docs=result.get("context_docs", 0),
        symbol=message.symbol,
        session_id=session_id,
    )


@router.get("/chat/history", response_model=List[ChatHistoryItem])
async def get_chat_history(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get recent chat history for the authenticated user"""
    history = (
        db.query(ChatHistory)
        .filter(ChatHistory.user_id == user.id)
        .order_by(ChatHistory.created_at.desc())
        .limit(limit)
        .all()
    )
    return history