"""
Community API endpoints

Implementation Notes:
- API Contract:
  POST   /api/v1/communities                    -> Create community (auth required)
  GET    /api/v1/communities                    -> List/discover communities (public, paginated)
  GET    /api/v1/communities/search             -> Search communities by query (public)
  GET    /api/v1/communities/{slug}             -> Get community by slug (public)
  POST   /api/v1/communities/{slug}/join        -> Join community (auth required)
  DELETE /api/v1/communities/{slug}/leave       -> Leave community (auth required)
  GET    /api/v1/communities/{slug}/members     -> List members (public, paginated)

- Error Codes:
  400 - Invalid input
  401 - Not authenticated
  403 - Forbidden
  404 - Community not found
  409 - Duplicate (already a member, slug taken)
"""
import re
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

from app.db.database import get_db
from app.models.user import User
from app.models.community import Community, CommunityMember
from app.api.auth import get_current_user, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9\-]{1,98}[a-z0-9]$")
VALID_CATEGORIES = {
    "stocks", "options", "crypto", "forex", "macro", "education", "general",
}


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class CommunityCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    category: str = Field(..., max_length=50)
    ticker_focus: Optional[str] = Field(None, max_length=20)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not SLUG_PATTERN.match(v):
            raise ValueError(
                "Slug must be 3-100 chars, lowercase alphanumeric and hyphens, "
                "cannot start or end with a hyphen."
            )
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in VALID_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
        return v


class CommunityUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    icon_url: Optional[str] = None
    banner_url: Optional[str] = None
    is_private: Optional[bool] = None


class CommunityResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: Optional[str] = None
    category: str
    ticker_focus: Optional[str] = None
    icon_url: Optional[str] = None
    banner_url: Optional[str] = None
    member_count: int
    post_count: int
    is_private: bool
    created_at: Optional[datetime] = None
    creator_username: Optional[str] = None
    is_member: bool = False

    class Config:
        from_attributes = True


class MemberResponse(BaseModel):
    user_id: int
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    joined_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaginatedCommunities(BaseModel):
    items: List[CommunityResponse]
    next_cursor: Optional[int] = None
    total: Optional[int] = None


class PaginatedMembers(BaseModel):
    items: List[MemberResponse]
    next_cursor: Optional[int] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _community_to_response(
    community: Community,
    is_member: bool = False,
) -> CommunityResponse:
    return CommunityResponse(
        id=community.id,
        slug=community.slug,
        name=community.name,
        description=community.description,
        category=community.category,
        ticker_focus=community.ticker_focus,
        icon_url=community.icon_url,
        banner_url=community.banner_url,
        member_count=community.member_count,
        post_count=community.post_count,
        is_private=community.is_private,
        created_at=community.created_at,
        creator_username=community.creator.username if community.creator else None,
        is_member=is_member,
    )


def _get_community_or_404(db: Session, slug: str) -> Community:
    community = (
        db.query(Community)
        .options(joinedload(Community.creator))
        .filter(Community.slug == slug)
        .first()
    )
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Community '{slug}' not found",
        )
    return community


def _check_membership(db: Session, community_id: int, user_id: int) -> Optional[CommunityMember]:
    return (
        db.query(CommunityMember)
        .filter(
            CommunityMember.community_id == community_id,
            CommunityMember.user_id == user_id,
        )
        .first()
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/communities",
    response_model=CommunityResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_community(
    body: CommunityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Create a new community. Creator is auto-added as owner."""
    # Check slug uniqueness
    existing = db.query(Community).filter(Community.slug == body.slug).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Slug '{body.slug}' is already taken",
        )

    community = Community(
        name=body.name,
        slug=body.slug,
        description=body.description,
        category=body.category,
        ticker_focus=body.ticker_focus,
        created_by=user.id,
        member_count=1,
    )
    db.add(community)
    db.flush()  # get community.id

    # Add creator as owner
    membership = CommunityMember(
        community_id=community.id,
        user_id=user.id,
        role="owner",
    )
    db.add(membership)

    try:
        db.commit()
        db.refresh(community)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Slug '{body.slug}' is already taken",
        )

    # Eager load creator for response
    community = _get_community_or_404(db, community.slug)
    return _community_to_response(community, is_member=True)


@router.get("/communities", response_model=PaginatedCommunities)
async def list_communities(
    category: Optional[str] = Query(None, max_length=50),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """List/discover communities, ordered by member count descending."""
    q = db.query(Community).options(joinedload(Community.creator))

    if category:
        q = q.filter(Community.category == category.lower())

    total = q.count()

    if cursor is not None:
        q = q.filter(Community.id < cursor)

    communities = (
        q.order_by(Community.member_count.desc(), Community.id.desc())
        .limit(limit)
        .all()
    )

    # Check membership for authenticated user
    member_community_ids: set = set()
    if current_user and communities:
        cids = [c.id for c in communities]
        rows = (
            db.query(CommunityMember.community_id)
            .filter(
                CommunityMember.user_id == current_user.id,
                CommunityMember.community_id.in_(cids),
            )
            .all()
        )
        member_community_ids = {r[0] for r in rows}

    items = [
        _community_to_response(c, is_member=(c.id in member_community_ids))
        for c in communities
    ]
    next_cursor = communities[-1].id if len(communities) == limit else None

    return PaginatedCommunities(items=items, next_cursor=next_cursor, total=total)


@router.get("/communities/search", response_model=PaginatedCommunities)
async def search_communities(
    q: str = Query(..., min_length=1, max_length=200, alias="q"),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Search communities by name, slug, or description."""
    search_term = f"%{q.strip().lower()}%"
    query = (
        db.query(Community)
        .options(joinedload(Community.creator))
        .filter(
            or_(
                func.lower(Community.name).like(search_term),
                func.lower(Community.slug).like(search_term),
                func.lower(Community.description).like(search_term),
            )
        )
    )

    if cursor is not None:
        query = query.filter(Community.id < cursor)

    communities = (
        query.order_by(Community.member_count.desc(), Community.id.desc())
        .limit(limit)
        .all()
    )

    member_community_ids: set = set()
    if current_user and communities:
        cids = [c.id for c in communities]
        rows = (
            db.query(CommunityMember.community_id)
            .filter(
                CommunityMember.user_id == current_user.id,
                CommunityMember.community_id.in_(cids),
            )
            .all()
        )
        member_community_ids = {r[0] for r in rows}

    items = [
        _community_to_response(c, is_member=(c.id in member_community_ids))
        for c in communities
    ]
    next_cursor = communities[-1].id if len(communities) == limit else None

    return PaginatedCommunities(items=items, next_cursor=next_cursor)


@router.get("/communities/{slug}", response_model=CommunityResponse)
async def get_community(
    slug: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get a single community by slug."""
    community = _get_community_or_404(db, slug)
    is_member = False
    if current_user:
        is_member = _check_membership(db, community.id, current_user.id) is not None
    return _community_to_response(community, is_member=is_member)


@router.post("/communities/{slug}/join", status_code=status.HTTP_200_OK)
async def join_community(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Join a community."""
    community = _get_community_or_404(db, slug)

    existing = _check_membership(db, community.id, user.id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already a member of this community",
        )

    membership = CommunityMember(
        community_id=community.id,
        user_id=user.id,
        role="member",
    )
    db.add(membership)
    community.member_count = (community.member_count or 0) + 1

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already a member of this community",
        )

    return {"message": f"Joined community '{slug}' successfully"}


@router.delete("/communities/{slug}/leave", status_code=status.HTTP_200_OK)
async def leave_community(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Leave a community. Owners cannot leave."""
    community = _get_community_or_404(db, slug)

    membership = _check_membership(db, community.id, user.id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not a member of this community",
        )

    if membership.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Community owners cannot leave. Transfer ownership first.",
        )

    db.delete(membership)
    community.member_count = max((community.member_count or 1) - 1, 0)
    db.commit()

    return {"message": f"Left community '{slug}' successfully"}


@router.get("/communities/{slug}/members", response_model=PaginatedMembers)
async def list_members(
    slug: str,
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List community members, ordered by join date."""
    community = _get_community_or_404(db, slug)

    q = (
        db.query(CommunityMember)
        .options(joinedload(CommunityMember.user))
        .filter(CommunityMember.community_id == community.id)
    )

    if cursor is not None:
        q = q.filter(CommunityMember.user_id > cursor)

    members = q.order_by(CommunityMember.joined_at.asc()).limit(limit).all()

    items = [
        MemberResponse(
            user_id=m.user_id,
            username=m.user.username if m.user else "unknown",
            full_name=m.user.full_name if m.user else None,
            avatar_url=m.user.avatar_url if m.user else None,
            role=m.role,
            joined_at=m.joined_at,
        )
        for m in members
    ]
    next_cursor = members[-1].user_id if len(members) == limit else None

    return PaginatedMembers(items=items, next_cursor=next_cursor)


@router.patch("/communities/{slug}", response_model=CommunityResponse)
async def update_community(
    slug: str,
    body: CommunityUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Update community details. Owner or admin only."""
    community = _get_community_or_404(db, slug)
    membership = _check_membership(db, community.id, user.id)

    if not membership or (membership.role not in ("owner", "moderator") and getattr(user, 'role', '') != 'admin'):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners, moderators, or admins can edit communities")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(community, field, value)

    db.commit()
    db.refresh(community)
    community = _get_community_or_404(db, slug)
    is_member = _check_membership(db, community.id, user.id) is not None
    return _community_to_response(community, is_member=is_member)


@router.delete("/communities/{slug}", status_code=status.HTTP_200_OK)
async def delete_community(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Delete a community. Owner or admin only."""
    community = _get_community_or_404(db, slug)
    membership = _check_membership(db, community.id, user.id)

    if not membership or (membership.role != "owner" and getattr(user, 'role', '') != 'admin'):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the community owner or admins can delete communities")

    db.delete(community)
    db.commit()
    return {"message": f"Community '{slug}' deleted successfully"}


class CommunityRules(BaseModel):
    rules: List[dict] = Field(default_factory=list)  # [{title: str, description: str}]


@router.get("/communities/{slug}/rules", response_model=CommunityRules)
async def get_community_rules(
    slug: str,
    db: Session = Depends(get_db),
):
    """Get community rules."""
    community = _get_community_or_404(db, slug)
    settings = community.settings or {}
    return CommunityRules(rules=settings.get("rules", []))


@router.put("/communities/{slug}/rules", response_model=CommunityRules)
async def update_community_rules(
    slug: str,
    body: CommunityRules,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Update community rules. Owner or moderator only."""
    community = _get_community_or_404(db, slug)
    membership = _check_membership(db, community.id, user.id)

    if not membership or membership.role not in ("owner", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners or moderators can update rules")

    settings = dict(community.settings or {})
    settings["rules"] = [r for r in body.rules[:20]]  # max 20 rules
    community.settings = settings

    db.commit()
    return CommunityRules(rules=settings["rules"])


# ── AutoMod Endpoints ──────────────────────────────────────────────────────

class AutoModRule(BaseModel):
    type: str = Field(..., pattern="^(keyword|regex|account_age|karma|link)$")
    value: str
    action: str = Field("review", pattern="^(remove|review)$")
    name: str = Field(..., max_length=100)


@router.get("/communities/{slug}/automod")
async def get_automod_rules(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get automod rules for a community. Moderator/owner only."""
    community = _get_community_or_404(db, slug)
    membership = _check_membership(db, community.id, user.id)
    if not membership or membership.role not in ("owner", "moderator"):
        raise HTTPException(status_code=403, detail="Moderators only")
    settings = community.settings or {}
    return {"rules": settings.get("automod_rules", [])}


@router.put("/communities/{slug}/automod")
async def update_automod_rules(
    slug: str,
    rules: List[AutoModRule],
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Update automod rules. Owner/moderator only. Max 30 rules."""
    community = _get_community_or_404(db, slug)
    membership = _check_membership(db, community.id, user.id)
    if not membership or membership.role not in ("owner", "moderator"):
        raise HTTPException(status_code=403, detail="Moderators only")

    settings = dict(community.settings or {})
    settings["automod_rules"] = [r.model_dump() for r in rules[:30]]
    community.settings = settings
    db.commit()
    return {"rules": settings["automod_rules"], "count": len(settings["automod_rules"])}
