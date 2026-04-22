"""
Messaging API — Reddit-style direct messages (Phase 1: DM only).
"""

import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, desc
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.api.auth import require_auth
from app.models.user import User
from app.models.messaging import (
    Conversation, ConversationParticipant, Message, UserBlock,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response Models ─────────────────────────────────────────

class NewConversationRequest(BaseModel):
    recipient_id: int
    message: str = Field(..., min_length=1, max_length=5000)


class SendMessageRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    parent_id: Optional[int] = None


class ConversationResponse(BaseModel):
    id: int
    other_user: dict
    last_message_preview: Optional[str]
    last_message_at: Optional[str]
    message_count: int
    unread: bool


class MessageResponse(BaseModel):
    id: int
    sender_id: int
    sender_username: str
    body: str
    parent_id: Optional[int]
    is_edited: bool
    created_at: str


# ── Conversations ─────────────────────────────────────────────────────

@router.get("/messages/conversations")
async def list_conversations(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """List user's conversations, ordered by most recent message."""
    # Get conversation IDs where user is a participant
    participant_convos = (
        db.query(ConversationParticipant.conversation_id, ConversationParticipant.last_read_at)
        .filter(ConversationParticipant.user_id == user.id)
        .subquery()
    )

    convos = (
        db.query(Conversation, participant_convos.c.last_read_at)
        .join(participant_convos, Conversation.id == participant_convos.c.conversation_id)
        .order_by(desc(Conversation.last_message_at))
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []
    for convo, last_read_at in convos:
        # Get the other participant
        other_participant = (
            db.query(ConversationParticipant)
            .filter(
                ConversationParticipant.conversation_id == convo.id,
                ConversationParticipant.user_id != user.id,
            )
            .first()
        )
        if not other_participant:
            continue

        other_user = db.query(User).filter(User.id == other_participant.user_id).first()
        if not other_user:
            continue

        unread = (
            last_read_at is None
            or (convo.last_message_at and convo.last_message_at > last_read_at)
        )

        result.append({
            "id": convo.id,
            "other_user": {
                "id": other_user.id,
                "username": other_user.username,
                "avatar_url": getattr(other_user, "avatar_url", None),
            },
            "last_message_preview": convo.last_message_preview,
            "last_message_at": convo.last_message_at.isoformat() if convo.last_message_at else None,
            "message_count": convo.message_count or 0,
            "unread": unread,
        })

    return {"conversations": result, "total": len(result)}


@router.post("/messages/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(
    req: NewConversationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Start a new DM conversation with another user."""
    if req.recipient_id == user.id:
        raise HTTPException(400, "Cannot message yourself")

    # Check recipient exists
    recipient = db.query(User).filter(User.id == req.recipient_id).first()
    if not recipient:
        raise HTTPException(404, "User not found")

    # Check if blocked
    blocked = db.query(UserBlock).filter(
        or_(
            and_(UserBlock.blocker_id == user.id, UserBlock.blocked_id == req.recipient_id),
            and_(UserBlock.blocker_id == req.recipient_id, UserBlock.blocked_id == user.id),
        )
    ).first()
    if blocked:
        raise HTTPException(403, "Cannot message this user")

    # Check if DM conversation already exists
    existing = (
        db.query(Conversation)
        .join(ConversationParticipant, Conversation.id == ConversationParticipant.conversation_id)
        .filter(
            Conversation.is_group == False,
            ConversationParticipant.user_id == user.id,
        )
        .all()
    )
    for convo in existing:
        other = (
            db.query(ConversationParticipant)
            .filter(
                ConversationParticipant.conversation_id == convo.id,
                ConversationParticipant.user_id == req.recipient_id,
            )
            .first()
        )
        if other:
            # Conversation already exists — just send the message
            return await _send_message_to_convo(db, user, convo, req.message)

    # Create new conversation
    now = datetime.now(timezone.utc)
    convo = Conversation(
        created_by=user.id,
        is_group=False,
        last_message_at=now,
        last_message_preview=req.message[:200],
        message_count=1,
    )
    db.add(convo)
    db.flush()

    # Add participants
    db.add(ConversationParticipant(conversation_id=convo.id, user_id=user.id, role="owner", last_read_at=now))
    db.add(ConversationParticipant(conversation_id=convo.id, user_id=req.recipient_id, role="member"))

    # Add first message
    msg = Message(conversation_id=convo.id, sender_id=user.id, body=req.message)
    db.add(msg)
    db.commit()

    return {
        "conversation_id": convo.id,
        "message_id": msg.id,
        "message": "Conversation created",
    }


# ── Messages ──────────────────────────────────────────────────────────

@router.get("/messages/conversations/{conversation_id}")
async def get_messages(
    conversation_id: int,
    limit: int = Query(50, ge=1, le=100),
    before_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get messages in a conversation (paginated, newest first)."""
    # Verify user is participant
    participant = (
        db.query(ConversationParticipant)
        .filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.user_id == user.id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(403, "Not a participant in this conversation")

    q = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id,
            Message.is_deleted == False,
        )
    )
    if before_id:
        q = q.filter(Message.id < before_id)

    messages = q.order_by(desc(Message.created_at)).limit(limit).all()

    # Mark as read
    participant.last_read_at = datetime.now(timezone.utc)
    db.commit()

    # Build response with sender info
    sender_cache: dict[int, str] = {}
    result = []
    for msg in reversed(messages):  # oldest first for display
        if msg.sender_id not in sender_cache:
            sender = db.query(User).filter(User.id == msg.sender_id).first()
            sender_cache[msg.sender_id] = sender.username if sender else "unknown"
        result.append({
            "id": msg.id,
            "sender_id": msg.sender_id,
            "sender_username": sender_cache[msg.sender_id],
            "body": msg.body,
            "parent_id": msg.parent_id,
            "is_edited": msg.is_edited,
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
        })

    return {"messages": result, "has_more": len(messages) == limit}


@router.post("/messages/conversations/{conversation_id}")
async def send_message(
    conversation_id: int,
    req: SendMessageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Send a message in an existing conversation."""
    # Verify participation
    participant = (
        db.query(ConversationParticipant)
        .filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.user_id == user.id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(403, "Not a participant")

    convo = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not convo:
        raise HTTPException(404, "Conversation not found")

    return await _send_message_to_convo(db, user, convo, req.body, req.parent_id)


async def _send_message_to_convo(
    db: Session,
    user: User,
    convo: Conversation,
    body: str,
    parent_id: int | None = None,
) -> dict:
    """Internal: send message and update conversation metadata."""
    now = datetime.now(timezone.utc)
    msg = Message(
        conversation_id=convo.id,
        sender_id=user.id,
        body=body,
        parent_id=parent_id,
    )
    db.add(msg)

    convo.last_message_at = now
    convo.last_message_preview = body[:200]
    convo.message_count = (convo.message_count or 0) + 1

    # Update sender's read cursor
    participant = (
        db.query(ConversationParticipant)
        .filter(
            ConversationParticipant.conversation_id == convo.id,
            ConversationParticipant.user_id == user.id,
        )
        .first()
    )
    if participant:
        participant.last_read_at = now

    db.commit()
    db.refresh(msg)

    # Broadcast via WebSocket (fire-and-forget)
    try:
        from app.services.ws_manager import ws_manager
        import asyncio
        asyncio.create_task(ws_manager.broadcast(f"dm:{convo.id}", {
            "type": "message.new",
            "conversation_id": convo.id,
            "message": {
                "id": msg.id,
                "sender_id": user.id,
                "sender_username": user.username,
                "body": body,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            },
        }))
    except Exception:
        pass  # WS broadcast is best-effort

    return {
        "message_id": msg.id,
        "conversation_id": convo.id,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


# ── Unread Count ──────────────────────────────────────────────────────

@router.get("/messages/unread")
async def get_unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get total unread conversation count."""
    participants = (
        db.query(ConversationParticipant)
        .filter(ConversationParticipant.user_id == user.id)
        .all()
    )

    unread = 0
    for p in participants:
        convo = db.query(Conversation).filter(Conversation.id == p.conversation_id).first()
        if convo and convo.last_message_at:
            if p.last_read_at is None or convo.last_message_at > p.last_read_at:
                unread += 1

    return {"unread": unread}


# ── Block/Unblock ─────────────────────────────────────────────────────

@router.post("/messages/block/{user_id}")
async def block_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Block a user from messaging you."""
    if user_id == user.id:
        raise HTTPException(400, "Cannot block yourself")

    existing = db.query(UserBlock).filter(
        UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id
    ).first()
    if existing:
        return {"message": "Already blocked"}

    db.add(UserBlock(blocker_id=user.id, blocked_id=user_id))
    db.commit()
    return {"message": "User blocked"}


@router.delete("/messages/block/{user_id}")
async def unblock_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Unblock a user."""
    block = db.query(UserBlock).filter(
        UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id
    ).first()
    if block:
        db.delete(block)
        db.commit()
    return {"message": "User unblocked"}
