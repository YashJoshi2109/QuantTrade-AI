"""
Conversation & chat history API.
Provides CRUD for conversation threads and message history with snapshot support.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.db.database import get_db
from app.models.user import User
from app.models.chat_history import Conversation, ChatHistory
from app.api.auth import require_auth
from app.services.ttl_cache import cache, DEFAULT_TTLS

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConversationOut(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    last_message: Optional[str] = None

    class Config:
        from_attributes = True


class ConversationCreate(BaseModel):
    title: Optional[str] = None


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    symbol: Optional[str] = None
    intent_type: Optional[str] = None
    payload_json: Optional[Dict[str, Any]] = None
    as_of: Optional[datetime] = None
    ttl_expires_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RefreshRequest(BaseModel):
    conversation_id: str
    message_id: int
    refresh_parts: Optional[List[str]] = None  # e.g. ["quote","technicals","news"]


class RefreshResponse(BaseModel):
    message_id: int
    payload_json: Optional[Dict[str, Any]]
    as_of: Optional[datetime]
    ttl_expires_at: Optional[datetime]
    refreshed_parts: List[str]


# ---------------------------------------------------------------------------
# Conversation CRUD
# ---------------------------------------------------------------------------

@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    conv = Conversation(
        id=str(uuid.uuid4()),
        user_id=user.id,
        title=body.title,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return ConversationOut(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=0,
    )


@router.get("/conversations", response_model=List[ConversationOut])
async def list_conversations(
    limit: int = Query(default=30, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
        .all()
    )

    result = []
    for conv in rows:
        msg_count = (
            db.query(sqlfunc.count(ChatHistory.id))
            .filter(ChatHistory.conversation_id == conv.id)
            .scalar()
        )
        last_msg = (
            db.query(ChatHistory.content)
            .filter(ChatHistory.conversation_id == conv.id, ChatHistory.role == "user")
            .order_by(ChatHistory.created_at.desc())
            .first()
        )
        result.append(ConversationOut(
            id=conv.id,
            title=conv.title,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
            message_count=msg_count or 0,
            last_message=last_msg[0] if last_msg else None,
        ))

    return result


@router.get("/conversations/{conversation_id}/messages", response_model=List[MessageOut])
async def get_conversation_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Return stored messages — renders from snapshots, no re-computation."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = (
        db.query(ChatHistory)
        .filter(ChatHistory.conversation_id == conversation_id)
        .order_by(ChatHistory.created_at.asc())
        .all()
    )
    return messages


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.delete(conv)
    db.commit()
    return {"message": "Conversation deleted"}


# ---------------------------------------------------------------------------
# Refresh endpoint
# ---------------------------------------------------------------------------

@router.post("/chat/refresh", response_model=RefreshResponse)
async def refresh_message(
    body: RefreshRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Re-compute specific data parts for a stored assistant message."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == body.conversation_id, Conversation.user_id == user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msg = (
        db.query(ChatHistory)
        .filter(
            ChatHistory.id == body.message_id,
            ChatHistory.conversation_id == body.conversation_id,
            ChatHistory.role == "assistant",
        )
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if not msg.payload_json or not msg.symbol:
        raise HTTPException(status_code=400, detail="Message has no refreshable payload")

    parts = body.refresh_parts or ["quote", "technicals", "risk", "regime", "sentiment"]
    refreshed: List[str] = []
    payload = dict(msg.payload_json)
    symbol = msg.symbol

    from app.services.quote_cache import QuoteCacheService
    from app.services.comprehensive_analysis import build_comprehensive_analysis

    quote_service = QuoteCacheService(db)

    try:
        fresh = await build_comprehensive_analysis(symbol, db, quote_service)

        if "quote" in parts and "quote" in fresh:
            payload["quote"] = fresh["quote"]
            refreshed.append("quote")
            cache.set(f"quote:{symbol}", fresh["quote"])

        if "technicals" in parts and "indicators" in fresh:
            payload["indicators"] = fresh["indicators"]
            refreshed.append("technicals")
            cache.set(f"technicals:{symbol}", fresh["indicators"])

        if "risk" in parts and "risk" in fresh:
            payload["risk"] = fresh["risk"]
            refreshed.append("risk")

        if "regime" in parts and "regime" in fresh:
            payload["regime"] = fresh["regime"]
            refreshed.append("regime")

        if "sentiment" in parts and "sentiment" in fresh:
            payload["sentiment"] = fresh["sentiment"]
            refreshed.append("sentiment")

        if "fundamentals" in parts and "fundamentals" in fresh:
            payload["fundamentals"] = fresh["fundamentals"]
            refreshed.append("fundamentals")

        if "technical_signal" in fresh:
            payload["technical_signal"] = fresh["technical_signal"]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {str(e)}")

    now = datetime.now(timezone.utc)
    min_ttl = min(DEFAULT_TTLS.get(p, 60) for p in refreshed) if refreshed else 60
    ttl_expires = now + timedelta(seconds=min_ttl)

    msg.payload_json = payload
    msg.as_of = now
    msg.ttl_expires_at = ttl_expires
    db.commit()

    return RefreshResponse(
        message_id=msg.id,
        payload_json=payload,
        as_of=now,
        ttl_expires_at=ttl_expires,
        refreshed_parts=refreshed,
    )


# ---------------------------------------------------------------------------
# Legacy history (backwards compatible)
# ---------------------------------------------------------------------------

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
    user: User = Depends(require_auth),
):
    query = db.query(ChatHistory).filter(ChatHistory.user_id == user.id)
    if session_id:
        query = query.filter(ChatHistory.session_id == session_id)
    history = query.order_by(ChatHistory.created_at.desc()).limit(limit).all()
    return history


@router.delete("/chat/history")
async def clear_chat_history(
    session_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    query = db.query(ChatHistory).filter(ChatHistory.user_id == user.id)
    if session_id:
        query = query.filter(ChatHistory.session_id == session_id)
    count = query.delete()
    db.commit()
    return {"message": f"Deleted {count} messages"}
