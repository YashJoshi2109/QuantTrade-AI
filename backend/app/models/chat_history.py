"""
Chat history model for AI Copilot conversations.
Includes Conversation (thread) model and ChatMessage model with snapshot storage.
"""
import uuid as _uuid
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey,
    JSON, Boolean, Index,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class Conversation(Base):
    """A conversation thread owned by a user."""
    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=lambda: str(_uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="conversations")
    messages = relationship("ChatHistory", back_populates="conversation", cascade="all, delete-orphan",
                            order_by="ChatHistory.created_at")


class ChatHistory(Base):
    __tablename__ = "chat_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    session_id = Column(String(64), index=True, nullable=True)
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True)
    symbol = Column(String(20), nullable=True, index=True)
    role = Column(String(20), nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    intent_type = Column(String(30), nullable=True)
    payload_json = Column(JSON, nullable=True)
    as_of = Column(DateTime(timezone=True), nullable=True)
    ttl_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User", backref="chat_messages")
    conversation = relationship("Conversation", back_populates="messages")

    __table_args__ = (
        Index("idx_conv_created", "conversation_id", "created_at"),
    )
