"""
Messaging system — Reddit-style direct messages.

Phase 1: Conversations + participants + messages (DM only).
"""

from sqlalchemy import (
    Boolean, Column, DateTime, Integer, String, Text,
    ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.sql import func

from app.db.database import Base


class Conversation(Base):
    """A conversation between 2+ users (Phase 1: DM only = 2 participants)."""
    __tablename__ = "dm_conversations"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_group = Column(Boolean, default=False)
    title = Column(String(100), nullable=True)  # null for DMs, set for groups
    last_message_at = Column(DateTime(timezone=True))
    last_message_preview = Column(String(200))
    message_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_conversations_last_msg", "last_message_at"),
    )


class ConversationParticipant(Base):
    """Links users to conversations with read tracking."""
    __tablename__ = "conversation_participants"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("dm_conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(20), default="member")  # owner | member
    last_read_at = Column(DateTime(timezone=True))
    is_muted = Column(Boolean, default=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conv_participant"),
        Index("idx_participant_user", "user_id"),
        Index("idx_participant_conv", "conversation_id"),
    )


class Message(Base):
    """Individual message within a conversation."""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("dm_conversations.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    parent_id = Column(Integer, ForeignKey("messages.id"), nullable=True)  # thread replies
    is_edited = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_messages_conv_created", "conversation_id", "created_at"),
        Index("idx_messages_sender", "sender_id"),
    )


class UserBlock(Base):
    """Platform-wide user blocking (prevents DMs + visibility)."""
    __tablename__ = "user_blocks"

    id = Column(Integer, primary_key=True, index=True)
    blocker_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    blocked_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_user_block"),
        Index("idx_block_blocker", "blocker_id"),
        Index("idx_block_blocked", "blocked_id"),
    )
