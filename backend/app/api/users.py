"""
User Profile & Reputation API endpoints

Implementation Notes:
- API Contract:
  GET    /api/v1/users/{user_id}           -> Public profile (posts, reputation, badges)
  GET    /api/v1/users/{user_id}/posts     -> User's posts (paginated)
  POST   /api/v1/users/{user_id}/follow    -> Follow user (auth)
  DELETE /api/v1/users/{user_id}/follow    -> Unfollow user (auth)
  GET    /api/v1/users/{user_id}/followers -> Follower list
  GET    /api/v1/users/{user_id}/following -> Following list

- Error Codes:
  400 - Invalid input (e.g. self-follow)
  401 - Not authenticated
  404 - User not found
  409 - Already following
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.db.database import get_db
from app.models.user import User
from app.models.community import Post, UserFollow
from app.api.auth import get_current_user, require_auth
from app.services.reputation_service import reputation_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class UserProfileResponse(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    trading_style: Optional[str] = None
    experience: Optional[str] = None
    reputation: int = 0
    post_count: int = 0
    follower_count: int = 0
    following_count: int = 0
    created_at: Optional[datetime] = None
    is_following: bool = False  # Whether the requesting user follows this user

    class Config:
        from_attributes = True


class UserSummary(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    reputation: int = 0

    class Config:
        from_attributes = True


class PostSummary(BaseModel):
    id: int
    title: str
    post_type: str = "text"
    upvote_count: int = 0
    downvote_count: int = 0
    comment_count: int = 0
    created_at: Optional[datetime] = None
    community_slug: Optional[str] = None
    community_name: Optional[str] = None

    class Config:
        from_attributes = True


class PaginatedUserPosts(BaseModel):
    items: List[PostSummary]
    next_cursor: Optional[int] = None


class PaginatedUsers(BaseModel):
    items: List[UserSummary]
    next_cursor: Optional[int] = None
    total: int = 0


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user


def _is_following(db: Session, follower_id: int, following_id: int) -> bool:
    return (
        db.query(UserFollow)
        .filter(
            UserFollow.follower_id == follower_id,
            UserFollow.following_id == following_id,
        )
        .first()
        is not None
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/users/{user_id}", response_model=UserProfileResponse)
async def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get public user profile with reputation and stats."""
    user = _get_user_or_404(db, user_id)

    following = False
    if current_user and current_user.id != user_id:
        following = _is_following(db, current_user.id, user_id)

    return UserProfileResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        bio=getattr(user, "bio", None),
        trading_style=getattr(user, "trading_style", None),
        experience=getattr(user, "experience", None),
        reputation=getattr(user, "reputation", 0) or 0,
        post_count=getattr(user, "post_count", 0) or 0,
        follower_count=getattr(user, "follower_count", 0) or 0,
        following_count=getattr(user, "following_count", 0) or 0,
        created_at=user.created_at,
        is_following=following,
    )


@router.get("/users/{user_id}/posts", response_model=PaginatedUserPosts)
async def get_user_posts(
    user_id: int,
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get a user's posts, paginated by cursor."""
    _get_user_or_404(db, user_id)

    q = (
        db.query(Post)
        .options(joinedload(Post.community))
        .filter(Post.author_id == user_id, Post.is_removed == False)
    )

    if cursor is not None:
        q = q.filter(Post.id < cursor)

    posts = q.order_by(Post.created_at.desc()).limit(limit).all()

    items = [
        PostSummary(
            id=p.id,
            title=p.title,
            post_type=p.post_type,
            upvote_count=p.upvote_count,
            downvote_count=p.downvote_count,
            comment_count=p.comment_count,
            created_at=p.created_at,
            community_slug=p.community.slug if p.community else None,
            community_name=p.community.name if p.community else None,
        )
        for p in posts
    ]
    next_cursor = posts[-1].id if len(posts) == limit else None

    return PaginatedUserPosts(items=items, next_cursor=next_cursor)


@router.post("/users/{user_id}/follow", status_code=status.HTTP_201_CREATED)
async def follow_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """Follow a user."""
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot follow yourself",
        )

    target = _get_user_or_404(db, user_id)

    if _is_following(db, current_user.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already following this user",
        )

    follow = UserFollow(follower_id=current_user.id, following_id=user_id)
    db.add(follow)

    # Update denormalized counts
    target.follower_count = (target.follower_count or 0) + 1
    current_user.following_count = (current_user.following_count or 0) + 1

    db.commit()

    # Update reputation for the followed user
    reputation_service.update_reputation(user_id, "follower_gained", db)

    return {"message": f"Now following {target.username}"}


@router.delete("/users/{user_id}/follow", status_code=status.HTTP_200_OK)
async def unfollow_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """Unfollow a user."""
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot unfollow yourself",
        )

    target = _get_user_or_404(db, user_id)

    existing = (
        db.query(UserFollow)
        .filter(
            UserFollow.follower_id == current_user.id,
            UserFollow.following_id == user_id,
        )
        .first()
    )
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not following this user",
        )

    db.delete(existing)

    # Update denormalized counts
    target.follower_count = max((target.follower_count or 0) - 1, 0)
    current_user.following_count = max((current_user.following_count or 0) - 1, 0)

    db.commit()

    # Update reputation for the unfollowed user
    reputation_service.update_reputation(user_id, "follower_lost", db)

    return {"message": f"Unfollowed {target.username}"}


@router.get("/users/{user_id}/followers", response_model=PaginatedUsers)
async def get_followers(
    user_id: int,
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get a user's followers."""
    _get_user_or_404(db, user_id)

    q = (
        db.query(UserFollow)
        .filter(UserFollow.following_id == user_id)
    )

    total = q.count()

    if cursor is not None:
        q = q.filter(UserFollow.follower_id > cursor)

    follows = q.order_by(UserFollow.follower_id.asc()).limit(limit).all()

    follower_ids = [f.follower_id for f in follows]
    users = (
        db.query(User).filter(User.id.in_(follower_ids)).all() if follower_ids else []
    )
    user_map = {u.id: u for u in users}

    items = [
        UserSummary(
            id=uid,
            username=user_map[uid].username if uid in user_map else "unknown",
            full_name=user_map[uid].full_name if uid in user_map else None,
            avatar_url=user_map[uid].avatar_url if uid in user_map else None,
            reputation=getattr(user_map.get(uid), "reputation", 0) or 0,
        )
        for uid in follower_ids
        if uid in user_map
    ]
    next_cursor = follower_ids[-1] if len(follows) == limit else None

    return PaginatedUsers(items=items, next_cursor=next_cursor, total=total)


@router.get("/users/{user_id}/following", response_model=PaginatedUsers)
async def get_following(
    user_id: int,
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get users that this user is following."""
    _get_user_or_404(db, user_id)

    q = (
        db.query(UserFollow)
        .filter(UserFollow.follower_id == user_id)
    )

    total = q.count()

    if cursor is not None:
        q = q.filter(UserFollow.following_id > cursor)

    follows = q.order_by(UserFollow.following_id.asc()).limit(limit).all()

    following_ids = [f.following_id for f in follows]
    users = (
        db.query(User).filter(User.id.in_(following_ids)).all() if following_ids else []
    )
    user_map = {u.id: u for u in users}

    items = [
        UserSummary(
            id=uid,
            username=user_map[uid].username if uid in user_map else "unknown",
            full_name=user_map[uid].full_name if uid in user_map else None,
            avatar_url=user_map[uid].avatar_url if uid in user_map else None,
            reputation=getattr(user_map.get(uid), "reputation", 0) or 0,
        )
        for uid in following_ids
        if uid in user_map
    ]
    next_cursor = following_ids[-1] if len(follows) == limit else None

    return PaginatedUsers(items=items, next_cursor=next_cursor, total=total)
