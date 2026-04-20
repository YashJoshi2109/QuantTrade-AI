"""
Bookmark API endpoints

Implementation Notes:
- API Contract:
  POST   /api/v1/posts/{post_id}/bookmark      -> Bookmark a post (auth required)
  DELETE /api/v1/posts/{post_id}/bookmark      -> Remove bookmark (auth required)
  GET    /api/v1/users/me/bookmarks            -> List bookmarked posts (auth, paginated)

- Error Codes:
  401 - Not authenticated
  404 - Post not found
  409 - Already bookmarked
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.db.database import get_db
from app.models.user import User
from app.models.community import Bookmark, Post, Vote
from app.api.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class AuthorInfo(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class BookmarkedPostResponse(BaseModel):
    id: int
    title: str
    body: Optional[str] = None
    post_type: str
    tickers: Optional[List[str]] = None
    sentiment: Optional[str] = None
    upvote_count: int = 0
    downvote_count: int = 0
    comment_count: int = 0
    view_count: int = 0
    is_pinned: bool = False
    is_locked: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    community_slug: Optional[str] = None
    community_name: Optional[str] = None
    author: Optional[AuthorInfo] = None
    user_vote: Optional[int] = None
    bookmarked_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaginatedBookmarks(BaseModel):
    items: List[BookmarkedPostResponse]
    next_cursor: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _author_info(user: User) -> AuthorInfo:
    return AuthorInfo(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
    )


def _bookmark_to_response(
    bookmark: Bookmark,
    user_vote: Optional[int] = None,
) -> BookmarkedPostResponse:
    post = bookmark.post
    return BookmarkedPostResponse(
        id=post.id,
        title=post.title,
        body=post.body,
        post_type=post.post_type,
        tickers=post.tickers if post.tickers else [],
        sentiment=post.sentiment,
        upvote_count=post.upvote_count,
        downvote_count=post.downvote_count,
        comment_count=post.comment_count,
        view_count=post.view_count,
        is_pinned=post.is_pinned,
        is_locked=post.is_locked,
        created_at=post.created_at,
        updated_at=post.updated_at,
        community_slug=post.community.slug if post.community else None,
        community_name=post.community.name if post.community else None,
        author=_author_info(post.author) if post.author else None,
        user_vote=user_vote,
        bookmarked_at=bookmark.created_at,
    )


def _get_post_or_404(db: Session, post_id: int) -> Post:
    post = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.community))
        .filter(Post.id == post_id, Post.is_removed == False)
        .first()
    )
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


def _bulk_user_votes(db: Session, user_id: int, post_ids: List[int]) -> dict:
    """Return {post_id: vote_type} for a batch of posts."""
    if not post_ids:
        return {}
    rows = (
        db.query(Vote.target_id, Vote.vote_type)
        .filter(
            Vote.user_id == user_id,
            Vote.target_type == "post",
            Vote.target_id.in_(post_ids),
        )
        .all()
    )
    return {r[0]: r[1] for r in rows}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/bookmark", status_code=status.HTTP_201_CREATED)
async def bookmark_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Bookmark a post. Idempotent — returns 409 if already bookmarked."""
    # Verify the post exists
    _get_post_or_404(db, post_id)

    # Check for existing bookmark
    existing = (
        db.query(Bookmark)
        .filter(Bookmark.user_id == user.id, Bookmark.post_id == post_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Post already bookmarked",
        )

    bookmark = Bookmark(user_id=user.id, post_id=post_id)
    db.add(bookmark)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Post already bookmarked",
        )

    return {"message": "Post bookmarked", "post_id": post_id}


@router.delete("/posts/{post_id}/bookmark", status_code=status.HTTP_200_OK)
async def remove_bookmark(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Remove a bookmark from a post."""
    bookmark = (
        db.query(Bookmark)
        .filter(Bookmark.user_id == user.id, Bookmark.post_id == post_id)
        .first()
    )
    if not bookmark:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bookmark not found",
        )

    db.delete(bookmark)
    db.commit()

    return {"message": "Bookmark removed", "post_id": post_id}


@router.get("/users/me/bookmarks", response_model=PaginatedBookmarks)
async def list_bookmarks(
    cursor: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """List the authenticated user's bookmarked posts, newest bookmarks first.

    Cursor-based pagination using bookmark created_at ISO timestamp.
    """
    q = (
        db.query(Bookmark)
        .options(
            joinedload(Bookmark.post).joinedload(Post.author),
            joinedload(Bookmark.post).joinedload(Post.community),
        )
        .filter(Bookmark.user_id == user.id)
    )

    if cursor:
        try:
            cursor_dt = datetime.fromisoformat(cursor)
            q = q.filter(Bookmark.created_at < cursor_dt)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid cursor format. Use ISO 8601 datetime.",
            )

    bookmarks = (
        q.order_by(Bookmark.created_at.desc())
        .limit(limit)
        .all()
    )

    # Filter out bookmarks whose posts have been removed
    bookmarks = [b for b in bookmarks if b.post and not b.post.is_removed]

    # Bulk fetch user votes for these posts
    post_ids = [b.post.id for b in bookmarks]
    votes_map = _bulk_user_votes(db, user.id, post_ids) if post_ids else {}

    items = [
        _bookmark_to_response(b, user_vote=votes_map.get(b.post.id))
        for b in bookmarks
    ]

    next_cursor = None
    if len(bookmarks) == limit and bookmarks:
        last_created = bookmarks[-1].created_at
        if last_created:
            next_cursor = last_created.isoformat()

    return PaginatedBookmarks(items=items, next_cursor=next_cursor)
