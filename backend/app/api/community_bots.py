"""
Community bots API.

  GET   /api/v1/community-bots                 public: every bot, methodology, schedule, status
  GET   /api/v1/community-bots/{slug}          public: one bot + its recent posts
  GET   /api/v1/community-bots/{slug}/runs     admin: recent run log (posted / skipped / capped ...)
  PATCH /api/v1/community-bots/{slug}          admin: {"enabled": bool, "reason": str}
  POST  /api/v1/community-bots/{slug}/preview  admin: build the post for a slot without publishing
  POST  /api/v1/community-bots/{slug}/run      admin: run a slot now (caps / dedupe / compliance apply)
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.api.auth import require_admin
from app.db.database import get_db
from app.models.community import Post
from app.models.community_bot import CommunityBot, CommunityBotPost, CommunityBotRun
from app.models.user import User
from app.services.community_bots import registry
from app.services.community_bots.base import DISCLAIMER
from app.services.community_bots.runner import et_day_start, global_daily_cap, kill_switch_reason

router = APIRouter()


class BotToggle(BaseModel):
    enabled: bool
    reason: Optional[str] = Field(None, max_length=500)


class RunRequest(BaseModel):
    slot: str = Field(..., max_length=40)


def _spec_or_404(slug: str):
    try:
        return registry.get(slug)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown bot '{slug}'")


def _status(db: Session, spec, row: Optional[CommunityBot]) -> dict:
    ks = kill_switch_reason(spec.slug)
    enabled = row is not None and row.enabled and ks is None
    reason = ks or (None if row is None or row.enabled else ("disabled by admin" + (
        f": {row.disabled_reason}" if row.disabled_reason else ""))) or (
        "bot account not seeded" if row is None else None)
    last = (db.query(CommunityBotPost.created_at).filter(CommunityBotPost.bot_slug == spec.slug)
            .order_by(CommunityBotPost.created_at.desc()).first())
    today = (db.query(CommunityBotPost).filter(CommunityBotPost.bot_slug == spec.slug,
                                               CommunityBotPost.created_at >= et_day_start(datetime.now(timezone.utc)))
             .count())
    user = row.user if row is not None else None
    return {
        **spec.public(),
        "username": user.username if user else spec.username,
        "user_id": user.id if user else None,
        "avatar_url": user.avatar_url if user else None,
        "enabled": enabled,
        "disabled_reason": reason if not enabled else None,
        "last_post_at": last[0].isoformat() if last and last[0] else None,
        "posts_today": today,
        "rules": registry.COMMON_RULES,
        "disclaimer": DISCLAIMER,
    }


@router.get("/community-bots")
def list_bots(db: Session = Depends(get_db)):
    rows = {r.slug: r for r in db.query(CommunityBot).options(joinedload(CommunityBot.user)).all()}
    return {
        "bots": [_status(db, s, rows.get(s.slug)) for s in registry.all_specs()],
        "global_daily_cap": global_daily_cap(),
        "rules": registry.COMMON_RULES,
    }


@router.get("/community-bots/{slug}")
def get_bot(slug: str, limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    from app.api.posts import _bot_payload_map, _post_to_response

    spec = _spec_or_404(slug)
    row = db.query(CommunityBot).options(joinedload(CommunityBot.user)).filter(CommunityBot.slug == slug).first()
    posts: List[Post] = []
    if row is not None:
        posts = (db.query(Post).options(joinedload(Post.author), joinedload(Post.community))
                 .filter(Post.author_id == row.user_id, Post.is_removed == False)  # noqa: E712
                 .order_by(Post.created_at.desc()).limit(limit).all())
    bot_map = _bot_payload_map(db, posts)
    return {
        **_status(db, spec, row),
        "recent_posts": [_post_to_response(p, bot_payload=bot_map.get(p.id)).model_dump(mode="json") for p in posts],
    }


@router.get("/community-bots/{slug}/runs")
def bot_runs(slug: str, limit: int = Query(30, ge=1, le=200), db: Session = Depends(get_db),
             _admin: User = Depends(require_admin)):
    _spec_or_404(slug)
    rows = (db.query(CommunityBotRun).filter(CommunityBotRun.bot_slug == slug)
            .order_by(CommunityBotRun.created_at.desc(), CommunityBotRun.id.desc()).limit(limit).all())
    return {"runs": [{"id": r.id, "slot": r.slot, "trigger": r.trigger, "status": r.status, "reason": r.reason,
                      "post_id": r.post_id, "duration_ms": r.duration_ms,
                      "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]}


@router.patch("/community-bots/{slug}")
def toggle_bot(slug: str, body: BotToggle, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    spec = _spec_or_404(slug)
    row = db.query(CommunityBot).filter(CommunityBot.slug == slug).first()
    if row is None:
        raise HTTPException(status_code=409, detail="Bot account not seeded; run scripts/seed_community_bots.py")
    row.enabled = body.enabled
    row.disabled_reason = None if body.enabled else (body.reason or None)
    row.updated_by = admin.id
    db.add(CommunityBotRun(bot_slug=slug, trigger="manual", status="enabled" if body.enabled else "disabled",
                           reason=f"admin {admin.id}: {body.reason or ''}".strip()))
    db.commit()
    db.refresh(row)
    return _status(db, spec, row)


async def _run(slug: str, slot: str, dry_run: bool):
    from app.services.community_bots.scheduler import _get_hub
    from app.services.community_bots.runner import run_bot

    spec = _spec_or_404(slug)
    if slot not in {s.name for s in spec.slots}:
        raise HTTPException(status_code=400, detail=f"slot must be one of {[s.name for s in spec.slots]}")
    res = await asyncio.wait_for(run_bot(slug, slot, hub=_get_hub(), trigger="manual", dry_run=dry_run),
                                 timeout=300)
    return res.as_dict()


@router.post("/community-bots/{slug}/preview")
async def preview_bot(slug: str, body: RunRequest, _admin: User = Depends(require_admin)):
    return await _run(slug, body.slot, dry_run=True)


@router.post("/community-bots/{slug}/run")
async def run_bot_now(slug: str, body: RunRequest, _admin: User = Depends(require_admin)):
    return await _run(slug, body.slot, dry_run=False)
