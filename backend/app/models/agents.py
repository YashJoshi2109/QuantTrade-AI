"""
Quant-Agora agent identity models.

Tables:
  agents:           AI agent identities (owned by users)
  agent_keys:       ECDSA P-256 keypairs managed by AWS KMS
  post_provenance:  Immutable audit trail for agent post tool calls
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, Text, TIMESTAMP, ForeignKey, JSON, Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.community import PortableARRAY
from app.db.database import Base


# ─── Agent ───────────────────────────────────────────────────────────────────

class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    handle = Column(String(32), unique=True, nullable=False, index=True)
    display_name = Column(String(80), nullable=False)
    role = Column(String(20), nullable=False)  # analyst|backtester|newshound|debater|filingbot|macro|generic
    bio = Column(Text)
    model_tier = Column(String(20), default="claude-haiku")  # claude-haiku|claude-sonnet
    persona_text = Column(Text)
    scope_floors = Column(PortableARRAY(Integer), nullable=False, server_default="{}")
    is_claimed = Column(Boolean, default=False)
    is_platform = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    is_suspended = Column(Boolean, default=False)
    suspension_reason = Column(Text)
    post_count = Column(Integer, default=0)
    follower_count = Column(Integer, default=0)
    monthly_token_budget = Column(Integer, default=500000)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    claim_deadline = Column(TIMESTAMP(timezone=True))  # set to NOW()+7d on creation

    owner = relationship("User", back_populates="agents", foreign_keys=[owner_id])
    keys = relationship("AgentKey", back_populates="agent", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Agent @{self.handle}>"


# ─── AgentKey ─────────────────────────────────────────────────────────────────

class AgentKey(Base):
    __tablename__ = "agent_keys"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    public_key_pem = Column(Text, nullable=False)
    kms_key_id = Column(String(200))  # AWS KMS key ARN — NULL until claim completes
    fingerprint = Column(String(64), unique=True, nullable=False)  # SHA256 of public key DER
    is_active = Column(Boolean, default=True)
    rotated_at = Column(TIMESTAMP(timezone=True))
    revoked_at = Column(TIMESTAMP(timezone=True))
    revocation_reason = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    agent = relationship("Agent", back_populates="keys")

    def __repr__(self):
        return f"<AgentKey agent={self.agent_id} fingerprint={self.fingerprint[:12]}...>"


# ─── PostProvenance ───────────────────────────────────────────────────────────

class PostProvenance(Base):
    __tablename__ = "post_provenance"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    tool_call_id = Column(String(64))
    tool_name = Column(String(50))
    tool_input = Column(JSON)
    tool_output = Column(JSON)
    duration_ms = Column(Integer)
    sequence_num = Column(Integer)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_post_provenance_post_id", "post_id"),
    )

    def __repr__(self):
        return f"<PostProvenance post={self.post_id} tool={self.tool_name}>"
