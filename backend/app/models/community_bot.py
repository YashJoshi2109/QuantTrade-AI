"""
Community bots: automated, clearly labelled accounts that post data summaries
(market weather, sentiment pulse, movers, earnings, real estate, sectors).

Tables (all new; no existing table is altered, so an old backend image keeps
working against a migrated DB and a new image keeps working before the
migration script runs: create_all() also creates them on startup):

  community_bots       one row per bot account: the "is_bot" flag for a user
                       (user_id unique) + the admin enable/disable switch.
  community_bot_posts  structured payload of each bot post (tables, chart
                       series, sources, as-of) + the dedupe key / content hash.
  community_bot_runs   audit log of every scheduled or manual run (posted,
                       skipped, capped, duplicate, disabled, error) with reason.

Bot posts themselves are ordinary rows in ``posts`` (author = bot user,
post_type = "bot", source_platform = "qt_bot"), so votes / comments /
bookmarks / reports / moderation work unchanged.
"""
from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base

BOT_SOURCE_PLATFORM = "qt_bot"
BOT_POST_TYPE = "bot"


class CommunityBot(Base):
    __tablename__ = "community_bots"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(40), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    # Admin switch (PATCH /community-bots/{slug}); env kill switches override it.
    enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    disabled_reason = Column(Text, nullable=True)
    updated_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])

    def __repr__(self):
        return f"<CommunityBot {self.slug} user={self.user_id}>"


class CommunityBotPost(Base):
    __tablename__ = "community_bot_posts"

    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    bot_slug = Column(String(40), nullable=False)
    # e.g. "market_weather:2026-11-27:close" - one post per bot per slot.
    dedupe_key = Column(String(160), nullable=False, unique=True)
    # sha256 of the data-bearing content: identical numbers are never re-posted.
    content_hash = Column(String(64), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    as_of = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_community_bot_posts_slug_created", "bot_slug", "created_at"),
        Index("ix_community_bot_posts_hash", "bot_slug", "content_hash"),
    )


class CommunityBotRun(Base):
    __tablename__ = "community_bot_runs"

    id = Column(Integer, primary_key=True, index=True)
    bot_slug = Column(String(40), nullable=False)
    slot = Column(String(40), nullable=True)
    trigger = Column(String(20), nullable=False, default="schedule")  # schedule | manual | preview
    status = Column(String(20), nullable=False)  # posted | skipped | capped | duplicate | disabled | rejected | error
    reason = Column(Text, nullable=True)
    post_id = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_community_bot_runs_slug_created", "bot_slug", "created_at"),
    )
