"""
Community ban management endpoints.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.user import User
from app.models.community import Community, CommunityMember, CommunityBan, AuditLog
from app.api.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


class BanCreate(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)
    duration_days: Optional[int] = Field(None, ge=1, le=365)  # None = permanent


class BanResponse(BaseModel):
    id: int
    user_id: int
    username: str
    reason: Optional[str]
    expires_at: Optional[datetime]
    created_at: datetime
    is_permanent: bool

    class Config:
        from_attributes = True


def _require_mod(db: Session, community: Community, user: User):
    membership = (
        db.query(CommunityMember)
        .filter(CommunityMember.community_id == community.id, CommunityMember.user_id == user.id)
        .first()
    )
    if not membership or membership.role not in ("owner", "moderator"):
        raise HTTPException(status_code=403, detail="Moderators only")


@router.post("/communities/{slug}/ban/{user_id}", status_code=201)
async def ban_user(
    slug: str,
    user_id: int,
    body: BanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Ban a user from a community."""
    community = db.query(Community).filter(Community.slug == slug).first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
    _require_mod(db, community, user)

    # Can't ban yourself or other mods
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot ban yourself")

    target_membership = (
        db.query(CommunityMember)
        .filter(CommunityMember.community_id == community.id, CommunityMember.user_id == user_id)
        .first()
    )
    if target_membership and target_membership.role in ("owner", "moderator"):
        raise HTTPException(status_code=403, detail="Cannot ban moderators")

    existing = db.query(CommunityBan).filter(
        CommunityBan.community_id == community.id,
        CommunityBan.user_id == user_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="User already banned")

    expires_at = None
    if body.duration_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.duration_days)

    ban = CommunityBan(
        community_id=community.id,
        user_id=user_id,
        banned_by=user.id,
        reason=body.reason,
        expires_at=expires_at,
    )
    db.add(ban)

    # Remove membership
    if target_membership:
        db.delete(target_membership)
        community.member_count = max((community.member_count or 1) - 1, 0)

    # Audit log
    db.add(AuditLog(
        actor_id=user.id,
        actor_type="moderator",
        action="ban_user",
        target_type="user",
        target_id=user_id,
        extra_data={"community": slug, "reason": body.reason, "duration_days": body.duration_days},
    ))

    db.commit()

    target_user = db.query(User).filter(User.id == user_id).first()
    return {
        "message": f"User banned from {slug}",
        "ban_id": ban.id,
        "username": target_user.username if target_user else "unknown",
        "expires_at": expires_at.isoformat() if expires_at else None,
        "is_permanent": expires_at is None,
    }


@router.delete("/communities/{slug}/ban/{user_id}")
async def unban_user(
    slug: str,
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Unban a user from a community."""
    community = db.query(Community).filter(Community.slug == slug).first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
    _require_mod(db, community, user)

    ban = db.query(CommunityBan).filter(
        CommunityBan.community_id == community.id,
        CommunityBan.user_id == user_id,
    ).first()
    if not ban:
        raise HTTPException(status_code=404, detail="User not banned")

    db.delete(ban)
    db.add(AuditLog(
        actor_id=user.id,
        actor_type="moderator",
        action="unban_user",
        target_type="user",
        target_id=user_id,
        extra_data={"community": slug},
    ))
    db.commit()
    return {"message": f"User unbanned from {slug}"}


@router.get("/communities/{slug}/bans")
async def list_bans(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """List banned users in a community. Moderator only."""
    community = db.query(Community).filter(Community.slug == slug).first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")
    _require_mod(db, community, user)

    bans = db.query(CommunityBan).filter(CommunityBan.community_id == community.id).all()
    items = []
    for ban in bans:
        target = db.query(User).filter(User.id == ban.user_id).first()
        items.append({
            "id": ban.id,
            "user_id": ban.user_id,
            "username": target.username if target else "unknown",
            "reason": ban.reason,
            "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
            "created_at": ban.created_at.isoformat() if ban.created_at else None,
            "is_permanent": ban.expires_at is None,
        })
    return {"bans": items}
