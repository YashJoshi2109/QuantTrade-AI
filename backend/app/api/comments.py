"""
Comment API endpoints

Implementation Notes:
- API Contract:
  POST   /api/v1/posts/{post_id}/comments       -> Create comment (auth required)
  GET    /api/v1/posts/{post_id}/comments       -> Get comment tree (public, paginated)
  PATCH  /api/v1/comments/{comment_id}          -> Edit comment (author only)
  DELETE /api/v1/comments/{comment_id}          -> Delete comment (author or mod)
  POST   /api/v1/comments/{comment_id}/vote     -> Vote on comment (auth required)

- Error Codes:
  400 - Invalid input
  401 - Not authenticated
  403 - Forbidden
  404 - Post/comment not found
"""
import asyncio
import logging
import math
import re
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

from app.db.database import get_db, SessionLocal
from app.models.user import User
from app.models.community import (
    Post, Comment, Vote, CommunityMember, Notification,
    ModerationReport, AuditLog,
)
from app.api.auth import get_current_user, require_auth
from app.services.reputation_service import reputation_service
from app.services.moderation_service import moderation_service

logger = logging.getLogger(__name__)
router = APIRouter()

MENTION_RE = re.compile(r'@(\w{3,30})\b')


def _process_mentions(body: str, post_id: int, comment_id: int, author_id: int, db: Session):
    """Detect @username mentions and create notifications."""
    mentions = MENTION_RE.findall(body)
    if not mentions:
        return

    # Limit to 5 mentions per comment
    for username in mentions[:5]:
        mentioned_user = db.query(User).filter(User.username == username).first()
        if mentioned_user and mentioned_user.id != author_id:
            notification = Notification(
                user_id=mentioned_user.id,
                type="mention",
                title="You were mentioned in a comment",
                body=body[:200],
                action_url=f"/community/post/{post_id}#comment-{comment_id}",
                actor_id=author_id,
            )
            db.add(notification)

    db.commit()


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)
    parent_id: Optional[int] = None


class CommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)


class CommentAuthor(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class CommentResponse(BaseModel):
    id: int
    body: str
    post_id: int
    parent_id: Optional[int] = None
    depth: int = 0
    upvote_count: int = 0
    downvote_count: int = 0
    reply_count: int = 0
    is_removed: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    author: Optional[CommentAuthor] = None
    user_vote: Optional[int] = None
    replies: List["CommentResponse"] = []

    class Config:
        from_attributes = True


class VoteRequest(BaseModel):
    direction: int = Field(..., ge=-1, le=1)


class PaginatedComments(BaseModel):
    items: List[CommentResponse]
    next_cursor: Optional[int] = None
    total: Optional[int] = None


# ── Sorting Helpers ─────────────────────────────────────────────────────────

def _wilson_score(ups: int, downs: int) -> float:
    """Wilson score interval lower bound for ranking."""
    n = ups + downs
    if n == 0:
        return 0.0
    z = 1.96  # 95% confidence
    p = ups / n
    return (p + z*z/(2*n) - z * math.sqrt((p*(1-p) + z*z/(4*n)) / n)) / (1 + z*z/n)


def _controversy_score(ups: int, downs: int) -> float:
    """Higher score = more controversial (lots of votes, close to 50/50)."""
    total = ups + downs
    if total == 0:
        return 0.0
    balance = 1 - abs(ups - downs) / total
    return total * balance


def _sort_comments(comments: List[CommentResponse], sort: str) -> List[CommentResponse]:
    """Sort a list of CommentResponse objects by the given sort key."""
    if sort == "top":
        comments.sort(key=lambda c: (c.upvote_count - c.downvote_count), reverse=True)
    elif sort == "new":
        comments.sort(key=lambda c: c.created_at or datetime.min, reverse=True)
    elif sort == "controversial":
        comments.sort(key=lambda c: _controversy_score(c.upvote_count, c.downvote_count), reverse=True)
    else:  # best (default)
        comments.sort(key=lambda c: _wilson_score(c.upvote_count, c.downvote_count), reverse=True)
    return comments


def _sort_replies_best(comment: CommentResponse) -> None:
    """Recursively sort all nested replies by 'best' (Wilson score)."""
    if comment.replies:
        comment.replies.sort(
            key=lambda c: _wilson_score(c.upvote_count, c.downvote_count),
            reverse=True,
        )
        for reply in comment.replies:
            _sort_replies_best(reply)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _author_from_user(user: User) -> CommentAuthor:
    return CommentAuthor(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
    )


def _comment_to_response(
    comment: Comment,
    user_vote: Optional[int] = None,
    nested_replies: Optional[List["CommentResponse"]] = None,
) -> CommentResponse:
    return CommentResponse(
        id=comment.id,
        body=comment.body if not comment.is_removed else "[deleted]",
        post_id=comment.post_id,
        parent_id=comment.parent_id,
        depth=comment.depth,
        upvote_count=comment.upvote_count,
        downvote_count=comment.downvote_count,
        reply_count=comment.reply_count,
        is_removed=comment.is_removed,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        author=_author_from_user(comment.author) if comment.author and not comment.is_removed else None,
        user_vote=user_vote,
        replies=nested_replies or [],
    )


def _get_post_or_404(db: Session, post_id: int) -> Post:
    post = db.query(Post).filter(Post.id == post_id, Post.is_removed == False).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


def _get_comment_or_404(db: Session, comment_id: int) -> Comment:
    comment = (
        db.query(Comment)
        .options(joinedload(Comment.author))
        .filter(Comment.id == comment_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    return comment


def _check_is_mod(db: Session, community_id: int, user_id: int) -> bool:
    membership = (
        db.query(CommunityMember)
        .filter(
            CommunityMember.community_id == community_id,
            CommunityMember.user_id == user_id,
        )
        .first()
    )
    return membership is not None and membership.role in ("moderator", "owner")


def _bulk_comment_votes(db: Session, user_id: int, comment_ids: List[int]) -> dict:
    if not comment_ids:
        return {}
    rows = (
        db.query(Vote.target_id, Vote.vote_type)
        .filter(
            Vote.user_id == user_id,
            Vote.target_type == "comment",
            Vote.target_id.in_(comment_ids),
        )
        .all()
    )
    return {r[0]: r[1] for r in rows}


def _build_comment_tree(
    comments: List[Comment],
    votes_map: dict,
    max_depth: int = 4,
) -> List[CommentResponse]:
    """Build a nested comment tree from a flat list of comments."""
    by_id: dict = {}
    roots: List[CommentResponse] = []

    # First pass: convert all comments to response objects
    for c in comments:
        resp = _comment_to_response(c, user_vote=votes_map.get(c.id))
        by_id[c.id] = resp

    # Second pass: nest children under parents
    for c in comments:
        resp = by_id[c.id]
        if c.parent_id and c.parent_id in by_id and c.depth <= max_depth:
            by_id[c.parent_id].replies.append(resp)
        else:
            roots.append(resp)

    return roots


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/posts/{post_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    post_id: int,
    body: CommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Create a comment on a post. Supports threaded replies via parent_id."""
    post = _get_post_or_404(db, post_id)

    if post.is_locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This post is locked and no longer accepting comments",
        )

    depth = 0
    path = ""

    if body.parent_id:
        parent = _get_comment_or_404(db, body.parent_id)
        if parent.post_id != post_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Parent comment does not belong to this post",
            )
        depth = parent.depth + 1
        path = f"{parent.path}.{parent.id}" if parent.path else str(parent.id)

        # Increment parent reply count
        parent.reply_count = (parent.reply_count or 0) + 1

    comment = Comment(
        body=body.body,
        post_id=post_id,
        author_id=user.id,
        parent_id=body.parent_id,
        depth=depth,
        path=path,
    )
    db.add(comment)

    # Increment post comment count
    post.comment_count = (post.comment_count or 0) + 1

    db.commit()
    db.refresh(comment)

    # Create notification for post author (if not self-comment)
    if post.author_id != user.id:
        notification = Notification(
            user_id=post.author_id,
            type="reply",
            title=f"{user.username} commented on your post",
            body=body.body[:200],
            action_url=f"/communities/{post.community.slug if post.community else ''}/posts/{post.id}",
            actor_id=user.id,
        )
        db.add(notification)
        db.commit()

    # Detect @mentions and create notifications
    _process_mentions(body.body, post_id, comment.id, user.id, db)

    # Broadcast new comment via WebSocket
    try:
        from app.services.ws_manager import ws_manager
        asyncio.create_task(ws_manager.broadcast(
            f"community:post:{post_id}",
            {"type": "new_comment", "comment_id": comment.id, "post_id": post_id}
        ))
    except Exception:
        pass  # WebSocket broadcast is non-critical

    # Award reputation for creating a comment
    reputation_service.update_reputation(user.id, "comment_created", db)

    # ── Non-blocking AI moderation (fire-and-forget) ────────────────────
    _comment_id = comment.id
    _comment_body = body.body
    _user_created = getattr(user, "created_at", None)
    _account_age = (datetime.utcnow() - _user_created).days if _user_created else 365

    async def _moderate_comment_bg():
        try:
            result = await moderation_service.moderate_comment(
                body=_comment_body,
                author_account_age_days=_account_age,
            )
            if SessionLocal is None:
                return
            bg_db = SessionLocal()
            try:
                c = bg_db.query(Comment).filter(Comment.id == _comment_id).first()
                if not c:
                    return
                if result.action == "remove":
                    c.is_removed = True
                if result.action in ("review", "remove"):
                    report = ModerationReport(
                        reporter_id=None,
                        target_id=_comment_id,
                        target_type="comment",
                        reason="ai_flagged",
                        description=result.explanation,
                        ai_score=result.score,
                        ai_flags=result.flags,
                        status="pending" if result.action == "review" else "resolved",
                    )
                    bg_db.add(report)
                    bg_db.add(AuditLog(
                        actor_id=None,
                        actor_type="ai",
                        action=f"auto_{result.action}",
                        target_type="comment",
                        target_id=_comment_id,
                        extra_data={"score": result.score, "flags": result.flags},
                    ))
                bg_db.commit()
            except Exception as exc:
                logger.error("Background comment moderation DB error: %s", exc)
                bg_db.rollback()
            finally:
                bg_db.close()
        except Exception as exc:
            logger.error("Background comment moderation failed: %s", exc)

    asyncio.create_task(_moderate_comment_bg())

    # Reload with author
    comment = _get_comment_or_404(db, comment.id)
    return _comment_to_response(comment)


@router.get("/posts/{post_id}/comments", response_model=PaginatedComments)
async def get_comments(
    post_id: int,
    sort: str = Query("best", pattern="^(best|top|new|controversial)$"),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get comment tree for a post. Returns nested structure.

    Sort options:
    - best (default): Wilson score confidence interval
    - top: net votes (upvotes - downvotes)
    - new: most recent first
    - controversial: high total votes with close to 50/50 split
    """
    post = _get_post_or_404(db, post_id)

    q = (
        db.query(Comment)
        .options(joinedload(Comment.author))
        .filter(Comment.post_id == post_id)
    )

    total = q.count()

    if cursor is not None:
        q = q.filter(Comment.id > cursor)

    comments = q.order_by(Comment.created_at.asc()).limit(limit).all()

    votes_map: dict = {}
    if current_user and comments:
        votes_map = _bulk_comment_votes(
            db, current_user.id, [c.id for c in comments]
        )

    tree = _build_comment_tree(comments, votes_map)

    # Sort top-level comments by the requested sort order
    tree = _sort_comments(tree, sort)

    # Always sort nested replies by 'best'
    for comment in tree:
        _sort_replies_best(comment)

    next_cursor = comments[-1].id if len(comments) == limit else None

    return PaginatedComments(items=tree, next_cursor=next_cursor, total=total)


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: int,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Edit a comment. Author only."""
    comment = _get_comment_or_404(db, comment_id)

    if comment.author_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can edit this comment",
        )

    if comment.is_removed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit a deleted comment",
        )

    comment.body = body.body
    db.commit()
    db.refresh(comment)

    comment = _get_comment_or_404(db, comment.id)
    user_vote = None
    vote = (
        db.query(Vote)
        .filter(Vote.user_id == user.id, Vote.target_id == comment_id, Vote.target_type == "comment")
        .first()
    )
    if vote:
        user_vote = vote.vote_type

    return _comment_to_response(comment, user_vote=user_vote)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_200_OK)
async def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Soft-delete a comment. Author or community moderator/owner."""
    comment = _get_comment_or_404(db, comment_id)

    # Get the post to find the community
    post = db.query(Post).filter(Post.id == comment.post_id).first()

    is_author = comment.author_id == user.id
    is_mod = _check_is_mod(db, post.community_id, user.id) if post else False

    if not is_author and not is_mod:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or a moderator can delete this comment",
        )

    comment.is_removed = True
    db.commit()

    return {"message": "Comment deleted successfully"}


@router.post("/comments/{comment_id}/vote", status_code=status.HTTP_200_OK)
async def vote_on_comment(
    comment_id: int,
    body: VoteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Upvote or downvote a comment."""
    if body.direction not in (1, -1):
        raise HTTPException(status_code=400, detail="direction must be 1 or -1")

    comment = _get_comment_or_404(db, comment_id)

    existing_vote = (
        db.query(Vote)
        .filter(
            Vote.user_id == user.id,
            Vote.target_id == comment_id,
            Vote.target_type == "comment",
        )
        .first()
    )

    if existing_vote:
        if existing_vote.vote_type == body.direction:
            # Toggle off — clicking same direction removes the vote (Reddit-style)
            if existing_vote.vote_type == 1:
                comment.upvote_count = max((comment.upvote_count or 0) - 1, 0)
            else:
                comment.downvote_count = max((comment.downvote_count or 0) - 1, 0)
            db.delete(existing_vote)
            db.commit()
            return {
                "message": "Vote removed",
                "direction": None,
                "upvote_count": comment.upvote_count,
                "downvote_count": comment.downvote_count,
                "vote_count": (comment.upvote_count or 0) - (comment.downvote_count or 0),
            }

        # Reverse old vote
        if existing_vote.vote_type == 1:
            comment.upvote_count = max((comment.upvote_count or 0) - 1, 0)
        else:
            comment.downvote_count = max((comment.downvote_count or 0) - 1, 0)

        existing_vote.vote_type = body.direction
    else:
        new_vote = Vote(
            user_id=user.id,
            target_id=comment_id,
            target_type="comment",
            vote_type=body.direction,
        )
        db.add(new_vote)

    if body.direction == 1:
        comment.upvote_count = (comment.upvote_count or 0) + 1
    else:
        comment.downvote_count = (comment.downvote_count or 0) + 1

    db.commit()

    # Update reputation for the comment author (not the voter)
    if comment.author_id != user.id:
        action = "comment_upvote_received" if body.direction == 1 else "comment_downvote_received"
        reputation_service.update_reputation(comment.author_id, action, db)

        # Create notification for the comment author on upvote (not downvote, not self-vote)
        if body.direction == 1 and not existing_vote:
            notification = Notification(
                user_id=comment.author_id,
                type="upvote",
                title=f"{user.username} upvoted your comment",
                body=comment.body[:200],
                action_url=f"/community/post/{comment.post_id}#comment-{comment.id}",
                actor_id=user.id,
            )
            db.add(notification)
            db.commit()

    return {
        "message": "Vote recorded",
        "direction": body.direction,
        "upvote_count": comment.upvote_count,
        "downvote_count": comment.downvote_count,
    }
