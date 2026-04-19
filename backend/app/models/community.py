"""
Community models — forums, posts, comments, votes, reactions, notifications.

Tables:
  communities          — topic-based groups (like subreddits)
  community_members    — membership + role (member/moderator/owner)
  posts                — user content within a community
  comments             — threaded replies on posts (materialized path)
  votes                — up/down votes on posts or comments
  reactions            — emoji reactions on posts or comments
  notifications        — user notification inbox
"""
from sqlalchemy import (
    Column, Integer, SmallInteger, String, Boolean, DateTime, Text, Float,
    ForeignKey, JSON, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.database import Base


# ─── Community ───────────────────────────────────────────────────────────────

class Community(Base):
    __tablename__ = "communities"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    icon_url = Column(Text, nullable=True)
    banner_url = Column(Text, nullable=True)

    category = Column(String(50), nullable=False)  # stocks, options, crypto, forex, macro, education
    ticker_focus = Column(String(20), nullable=True)  # optional ticker this community is about

    member_count = Column(Integer, nullable=False, default=0)
    post_count = Column(Integer, nullable=False, default=0)

    is_private = Column(Boolean, nullable=False, default=False)

    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    settings = Column(JSON, nullable=False, server_default="{}")

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    members = relationship("CommunityMember", back_populates="community", cascade="all, delete-orphan")
    posts = relationship("Post", back_populates="community", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_communities_category", "category"),
        Index("ix_communities_ticker_focus", "ticker_focus"),
    )

    def __repr__(self):
        return f"<Community {self.slug}>"


# ─── Community Member ────────────────────────────────────────────────────────

class CommunityMember(Base):
    __tablename__ = "community_members"

    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    role = Column(String(20), nullable=False, default="member")  # member, moderator, owner
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    community = relationship("Community", back_populates="members")
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("community_id", "user_id", name="uq_community_member"),
        Index("ix_community_members_user", "user_id"),
    )

    def __repr__(self):
        return f"<CommunityMember community={self.community_id} user={self.user_id}>"


# ─── Post ────────────────────────────────────────────────────────────────────

class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(300), nullable=False)
    body = Column(Text, nullable=True)
    body_html = Column(Text, nullable=True)

    post_type = Column(String(20), nullable=False, default="text")  # text, analysis, trade, poll, media
    tickers = Column(ARRAY(String(20)), nullable=False, server_default="{}")  # referenced tickers like $AAPL
    sentiment = Column(String(10), nullable=True)  # bullish, bearish, neutral

    upvote_count = Column(Integer, nullable=False, default=0)
    downvote_count = Column(Integer, nullable=False, default=0)
    comment_count = Column(Integer, nullable=False, default=0)
    view_count = Column(Integer, nullable=False, default=0)

    is_removed = Column(Boolean, nullable=False, default=False)
    is_pinned = Column(Boolean, nullable=False, default=False)
    is_locked = Column(Boolean, nullable=False, default=False)

    media_urls = Column(ARRAY(Text), nullable=False, server_default="{}")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    author = relationship("User", foreign_keys=[author_id])
    community = relationship("Community", back_populates="posts")
    comments = relationship("Comment", back_populates="post", cascade="all, delete-orphan")

    hot_score = Column(Float, nullable=False, default=0.0)

    # AI moderation fields
    ai_mod_score = Column(Float, nullable=True)              # 0-1 risk score from moderation pipeline
    ai_risk_flags = Column(JSON, nullable=True)              # list of flag strings
    moderation_status = Column(String(20), nullable=True)    # approved | review | removed

    __table_args__ = (
        Index("ix_posts_community_created", "community_id", "created_at"),
        Index("ix_posts_author_created", "author_id", "created_at"),
        Index("ix_posts_tickers", "tickers", postgresql_using="gin"),
        Index("ix_posts_hot_score", "hot_score"),
    )

    def __repr__(self):
        return f"<Post {self.id} '{self.title[:40]}'>"


# ─── Comment ─────────────────────────────────────────────────────────────────

class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True)

    body = Column(Text, nullable=False)
    body_html = Column(Text, nullable=True)

    depth = Column(Integer, nullable=False, default=0)
    path = Column(Text, nullable=True)  # materialized path for tree queries, e.g. "1.5.12"

    upvote_count = Column(Integer, nullable=False, default=0)
    downvote_count = Column(Integer, nullable=False, default=0)
    reply_count = Column(Integer, nullable=False, default=0)

    is_removed = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    post = relationship("Post", back_populates="comments")
    author = relationship("User", foreign_keys=[author_id])
    parent = relationship("Comment", remote_side=[id], foreign_keys=[parent_id], back_populates="replies")
    replies = relationship("Comment", foreign_keys=[parent_id], back_populates="parent", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_comments_post_created", "post_id", "created_at"),
        Index("ix_comments_path", "path"),
    )

    def __repr__(self):
        return f"<Comment {self.id} post={self.post_id}>"


# ─── Vote ────────────────────────────────────────────────────────────────────

class Vote(Base):
    __tablename__ = "votes"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    target_id = Column(Integer, primary_key=True)
    target_type = Column(String(10), primary_key=True)  # 'post' or 'comment'

    vote_type = Column(SmallInteger, nullable=False)  # 1 = up, -1 = down
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("ix_votes_target", "target_type", "target_id"),
    )

    def __repr__(self):
        return f"<Vote user={self.user_id} {self.target_type}:{self.target_id} {self.vote_type}>"


# ─── Reaction ────────────────────────────────────────────────────────────────

class Reaction(Base):
    __tablename__ = "reactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(Integer, nullable=False)
    target_type = Column(String(10), nullable=False)  # 'post' or 'comment'

    emoji = Column(String(20), nullable=False)  # bullish, bearish, rocket, diamond_hands, think
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("user_id", "target_id", "target_type", "emoji", name="uq_reaction_user_target_emoji"),
        Index("ix_reactions_target", "target_type", "target_id"),
    )

    def __repr__(self):
        return f"<Reaction {self.emoji} user={self.user_id} {self.target_type}:{self.target_id}>"


# ─── Notification ────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    type = Column(String(50), nullable=False)  # reply, mention, upvote, follow, community_post, price_alert, moderation_action
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    action_url = Column(Text, nullable=True)

    actor_id = Column(Integer, nullable=True)  # who triggered it (nullable for system notifications)

    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("ix_notifications_user_read", "user_id", "is_read"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    def __repr__(self):
        return f"<Notification {self.id} type={self.type} user={self.user_id}>"


# ─── User Follow ────────────────────────────────────────────────────────────

class UserFollow(Base):
    __tablename__ = "user_follows"

    follower_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    following_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    follower = relationship("User", foreign_keys=[follower_id])
    following = relationship("User", foreign_keys=[following_id])

    __table_args__ = (
        Index('ix_follows_follower', 'follower_id'),
        Index('ix_follows_following', 'following_id'),
    )

    def __repr__(self):
        return f"<UserFollow {self.follower_id} -> {self.following_id}>"


# ─── Moderation Report ──────────────────────────────────────────────────────

class ModerationReport(Base):
    __tablename__ = "moderation_reports"

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # null = AI-generated report
    target_id = Column(Integer, nullable=False)
    target_type = Column(String(20), nullable=False)  # post, comment, user
    reason = Column(String(50), nullable=False)  # spam, misinformation, manipulation, harassment
    description = Column(Text, nullable=True)
    ai_score = Column(Float, nullable=True)
    ai_flags = Column(JSON, nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending, reviewed, resolved
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reporter = relationship("User", foreign_keys=[reporter_id])

    __table_args__ = (
        Index("ix_moderation_reports_status", "status"),
        Index("ix_moderation_reports_target", "target_type", "target_id"),
    )

    def __repr__(self):
        return f"<ModerationReport {self.id} {self.target_type}:{self.target_id} status={self.status}>"


# ─── Moderation Action ─────────────────────────────────────────────────────

class ModerationAction(Base):
    __tablename__ = "moderation_actions"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("moderation_reports.id"), nullable=True)
    moderator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action_type = Column(String(20), nullable=False)  # approve, remove, warn, mute, ban
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    report = relationship("ModerationReport", foreign_keys=[report_id])
    moderator = relationship("User", foreign_keys=[moderator_id])

    def __repr__(self):
        return f"<ModerationAction {self.id} {self.action_type}>"


# ─── Audit Log ──────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, nullable=True)
    actor_type = Column(String(20), nullable=False)  # user, moderator, admin, system, ai
    action = Column(String(50), nullable=False)
    target_type = Column(String(20), nullable=True)
    target_id = Column(Integer, nullable=True)
    extra_data = Column("metadata", JSON, default={})
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_audit_log_actor", "actor_type", "actor_id"),
        Index("ix_audit_log_target", "target_type", "target_id"),
        Index("ix_audit_log_created", "created_at"),
    )

    def __repr__(self):
        return f"<AuditLog {self.id} {self.action}>"
