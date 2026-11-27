"""Run one bot slot: kill switches -> caps -> dedupe -> collect -> compose ->
compliance -> publish. Every outcome is written to community_bot_runs.

Kill switches (checked on every run, highest first):
  COMMUNITY_BOTS_ENABLED=0           all bots off
  COMMUNITY_BOTS_DISABLED=a,b | all  listed bots off
  community_bots.enabled = false     admin switch (PATCH /api/v1/community-bots/{slug})
Caps:
  spec.daily_cap posts per bot per ET day, COMMUNITY_BOTS_GLOBAL_DAILY_CAP
  (default 12) for all bots together, spec.min_interval_minutes between posts.
Dedupe:
  one post per (bot, ET date, slot) - unique community_bot_posts.dedupe_key;
  no post whose data fingerprint equals one of the bot's posts in the last 3 days.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

from sqlalchemy.exc import IntegrityError

from app.services import market_calendar as mc
from app.services.community_bots import compliance, registry
from app.services.community_bots.base import (
    ET, BotPost, BotSpec, Skip, et_date, payload_of, render_body,
)

logger = logging.getLogger(__name__)

COLLECT_TIMEOUT_S = float(os.getenv("COMMUNITY_BOTS_COLLECT_TIMEOUT_S", "240"))
HASH_LOOKBACK = timedelta(days=3)


@dataclass
class RunResult:
    slug: str
    slot: str
    status: str            # posted | skipped | capped | duplicate | disabled | rejected | error | preview
    reason: Optional[str] = None
    post_id: Optional[int] = None
    dedupe_key: Optional[str] = None
    preview: Optional[Dict[str, Any]] = None
    violations: list = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {"slug": self.slug, "slot": self.slot, "status": self.status, "reason": self.reason,
                "post_id": self.post_id, "dedupe_key": self.dedupe_key, "preview": self.preview,
                "violations": self.violations}


def global_daily_cap() -> int:
    try:
        return max(0, int(os.getenv("COMMUNITY_BOTS_GLOBAL_DAILY_CAP", "12")))
    except ValueError:
        return 12


def kill_switch_reason(slug: str) -> Optional[str]:
    if os.getenv("COMMUNITY_BOTS_ENABLED", "1").strip().lower() in ("0", "false", "off", "no"):
        return "COMMUNITY_BOTS_ENABLED=0 (global kill switch)"
    disabled = {s.strip().lower() for s in os.getenv("COMMUNITY_BOTS_DISABLED", "").split(",") if s.strip()}
    if "all" in disabled or slug.lower() in disabled:
        return f"disabled by COMMUNITY_BOTS_DISABLED ({slug})"
    return None


def et_day_start(now: datetime) -> datetime:
    d = et_date(now)
    return datetime(d.year, d.month, d.day, tzinfo=ET).astimezone(timezone.utc)


def dedupe_key(slug: str, slot: str, now: datetime) -> str:
    return f"{slug}:{et_date(now).isoformat()}:{slot}"


def _default_session_factory():
    from app.db import database
    return database.SessionLocal() if database.SessionLocal is not None else None


def _record(sf, slug: str, slot: str, trigger: str, status: str, reason: Optional[str],
            post_id: Optional[int], started: float, details: Optional[dict] = None) -> None:
    from app.models.community_bot import CommunityBotRun
    db = sf()
    if db is None:
        return
    try:
        db.add(CommunityBotRun(bot_slug=slug, slot=slot, trigger=trigger, status=status,
                               reason=(reason or "")[:2000] or None, post_id=post_id,
                               duration_ms=int((time.monotonic() - started) * 1000), details=details))
        db.commit()
    except Exception as e:  # noqa: BLE001 - audit log must never break a run
        logger.warning("bots: could not record run %s/%s: %s", slug, slot, e)
        db.rollback()
    finally:
        db.close()


def _gate(db, spec: BotSpec, slot: str, now: datetime, key: str, *, ignore_schedule: bool) -> Optional[tuple]:
    """Return (status, reason) when the run must stop before collecting data."""
    from app.models.community_bot import CommunityBot, CommunityBotPost

    ks = kill_switch_reason(spec.slug)
    if ks:
        return "disabled", ks
    bot = db.query(CommunityBot).filter(CommunityBot.slug == spec.slug).first()
    if bot is None:
        return "disabled", "bot account not seeded (run scripts/seed_community_bots.py)"
    if not bot.enabled:
        return "disabled", f"disabled by admin{': ' + bot.disabled_reason if bot.disabled_reason else ''}"
    if not ignore_schedule and spec.trading_days_only and not mc.is_trading_day(et_date(now)):
        return "skipped", f"{et_date(now)} is not a trading day"
    if db.query(CommunityBotPost.post_id).filter(CommunityBotPost.dedupe_key == key).first():
        return "duplicate", f"already posted for slot {key}"
    start = et_day_start(now)
    today_q = db.query(CommunityBotPost).filter(CommunityBotPost.created_at >= start)
    mine = today_q.filter(CommunityBotPost.bot_slug == spec.slug).count()
    if mine >= spec.daily_cap:
        return "capped", f"daily cap reached ({mine}/{spec.daily_cap})"
    total = today_q.count()
    if total >= global_daily_cap():
        return "capped", f"global daily cap reached ({total}/{global_daily_cap()})"
    last = (db.query(CommunityBotPost.created_at).filter(CommunityBotPost.bot_slug == spec.slug)
            .order_by(CommunityBotPost.created_at.desc()).first())
    if last and last[0] is not None:
        lt = last[0] if last[0].tzinfo else last[0].replace(tzinfo=timezone.utc)
        if now - lt < timedelta(minutes=spec.min_interval_minutes):
            return "capped", f"minimum interval {spec.min_interval_minutes} min not reached"
    return None


def _publish(sf, spec: BotSpec, post: BotPost, slot: str, now: datetime, key: str) -> tuple:
    from app.api.posts import hot_score
    from app.models.community import Community, CommunityMember, Post
    from app.models.community_bot import BOT_POST_TYPE, BOT_SOURCE_PLATFORM, CommunityBot, CommunityBotPost
    from app.models.user import User

    db = sf()
    if db is None:
        return "error", "no database configured", None
    try:
        gate = _gate(db, spec, slot, now, key, ignore_schedule=True)  # re-check inside the write session
        if gate:
            return gate[0], gate[1], None
        fp = post.content_fingerprint()
        if (db.query(CommunityBotPost.post_id)
                .filter(CommunityBotPost.bot_slug == spec.slug, CommunityBotPost.content_hash == fp,
                        CommunityBotPost.created_at >= now - HASH_LOOKBACK).first()):
            return "duplicate", "same data as a recent post", None
        bot = db.query(CommunityBot).filter(CommunityBot.slug == spec.slug).first()
        user = db.query(User).filter(User.id == bot.user_id).first()
        community = db.query(Community).filter(Community.slug == spec.community_slug).first()
        if community is None:
            return "skipped", f"community '{spec.community_slug}' does not exist", None
        if not db.query(CommunityMember).filter(CommunityMember.community_id == community.id,
                                                CommunityMember.user_id == user.id).first():
            db.add(CommunityMember(community_id=community.id, user_id=user.id, role="member"))
            community.member_count = (community.member_count or 0) + 1

        body = render_body(spec, post)
        row = Post(
            author_id=user.id, community_id=community.id, title=post.title, body=body,
            post_type=BOT_POST_TYPE, tickers=post.tickers[:10], sentiment=post.sentiment,
            source_platform=BOT_SOURCE_PLATFORM, moderation_status="approved", media_urls=[],
            created_at=now, updated_at=now,
            hot_score=hot_score(0, 0, now.astimezone(timezone.utc).replace(tzinfo=None)),
        )
        db.add(row)
        db.flush()
        db.add(CommunityBotPost(post_id=row.id, bot_slug=spec.slug, dedupe_key=key, content_hash=fp,
                                payload=payload_of(spec, post, slot), as_of=post.as_of, created_at=now))
        community.post_count = (community.post_count or 0) + 1
        user.post_count = (user.post_count or 0) + 1
        db.commit()
        return "posted", None, row.id
    except IntegrityError:
        db.rollback()
        return "duplicate", f"already posted for slot {key} (concurrent run)", None
    except Exception as e:  # noqa: BLE001
        db.rollback()
        logger.exception("bots: publish %s failed", spec.slug)
        return "error", f"publish failed: {e}", None
    finally:
        db.close()


async def run_bot(
    slug: str,
    slot: str,
    *,
    hub,
    now: Optional[datetime] = None,
    trigger: str = "schedule",
    dry_run: bool = False,
    session_factory: Optional[Callable[[], Any]] = None,
) -> RunResult:
    spec = registry.get(slug)
    if slot not in {s.name for s in spec.slots}:
        raise ValueError(f"unknown slot {slot!r} for {slug}")
    now = now or datetime.now(timezone.utc)
    sf = session_factory or _default_session_factory
    started = time.monotonic()
    key = dedupe_key(slug, slot, now)

    def finish(status: str, reason: Optional[str] = None, post_id: Optional[int] = None,
               details: Optional[dict] = None, **extra) -> RunResult:
        if not dry_run:
            _record(sf, slug, slot, trigger, status, reason, post_id, started, details)
        log = logger.info if status in ("posted", "preview") else logger.warning if status == "error" else logger.debug
        log("bots: %s/%s -> %s %s", slug, slot, status, reason or post_id or "")
        return RunResult(slug=slug, slot=slot, status=status, reason=reason, post_id=post_id,
                         dedupe_key=key, **extra)

    if not dry_run:
        def gate():
            db = sf()
            if db is None:
                return "error", "no database configured"
            try:
                return _gate(db, spec, slot, now, key, ignore_schedule=(trigger == "manual"))
            finally:
                db.close()
        g = await asyncio.to_thread(gate)
        if g:
            return finish(g[0], g[1])

    try:
        data = await asyncio.wait_for(spec.collect(hub, now, slot), timeout=COLLECT_TIMEOUT_S)
        post = spec.compose(data, now, slot)
    except Skip as s:
        return finish("skipped", s.reason)
    except asyncio.TimeoutError:
        return finish("error", f"data collection timed out after {COLLECT_TIMEOUT_S:g}s")
    except Exception as e:  # noqa: BLE001
        logger.exception("bots: %s/%s failed", slug, slot)
        return finish("error", f"{type(e).__name__}: {e}")

    violations = compliance.check(spec, post)
    if violations:
        return finish("rejected", "; ".join(violations)[:500], details={"violations": violations},
                      violations=violations)

    if dry_run:
        return finish("preview", preview={"title": post.title, "body": render_body(spec, post),
                                          "payload": payload_of(spec, post, slot),
                                          "community_slug": spec.community_slug})

    status, reason, post_id = await asyncio.to_thread(_publish, sf, spec, post, slot, now, key)
    if status == "posted":
        try:
            from app.services.redis_cache_service import cache_service
            await cache_service.invalidate_pattern("qt:feed:*")
        except Exception:  # noqa: BLE001
            pass
    return finish(status, reason, post_id)
