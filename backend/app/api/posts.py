"""
Post & Feed API endpoints

Implementation Notes:
- API Contract:
  POST   /api/v1/posts                          -> Create post (auth, must be community member)
  GET    /api/v1/posts/{post_id}                -> Get single post with author info (public)
  PATCH  /api/v1/posts/{post_id}                -> Edit post (author only)
  DELETE /api/v1/posts/{post_id}                -> Delete post (author or mod)
  GET    /api/v1/communities/{slug}/posts       -> Community posts feed (public, paginated, sort)
  GET    /api/v1/feed                           -> User's personalized feed (auth)
  GET    /api/v1/feed/popular                   -> Global popular feed (public)
  GET    /api/v1/feed/ticker/{symbol}           -> Posts mentioning a ticker (public)
  POST   /api/v1/posts/{post_id}/vote           -> Upvote/downvote (auth)
  DELETE /api/v1/posts/{post_id}/vote           -> Remove vote (auth)

- Error Codes:
  400 - Invalid input
  401 - Not authenticated
  403 - Forbidden (not a member, not the author)
  404 - Post or community not found
"""
import asyncio
import math
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, case
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field

from app.db.database import get_db, SessionLocal
from app.models.user import User
from app.models.community import (
    Community, CommunityMember, Post, Comment, Vote, Notification,
    ModerationReport, AuditLog,
)
from app.api.auth import get_current_user, require_auth
from app.services.reputation_service import reputation_service
from app.services.moderation_service import moderation_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Hot Score ────────────────────────────────────────────────────────────────

def hot_score(upvotes: int, downvotes: int, created_at: datetime) -> float:
    """Reddit-style hot score for feed ranking."""
    score = upvotes - downvotes
    order = math.log10(max(abs(score), 1))
    sign = 1 if score > 0 else -1 if score < 0 else 0
    epoch = created_at if isinstance(created_at, datetime) else datetime.utcnow()
    seconds = (epoch - datetime(1970, 1, 1)).total_seconds() - 1134028003
    return round(sign * order + seconds / 45000, 7)


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    body: Optional[str] = Field(None, max_length=40000)
    post_type: str = Field("text", max_length=20)
    tickers: Optional[List[str]] = Field(None, max_length=20)
    sentiment: Optional[str] = Field(None, max_length=10)
    community_slug: str = Field(..., min_length=3, max_length=100)


class PostUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    body: Optional[str] = Field(None, max_length=40000)
    tickers: Optional[List[str]] = None
    sentiment: Optional[str] = Field(None, max_length=10)


class AuthorInfo(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class PostResponse(BaseModel):
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
    user_vote: Optional[int] = None  # 1, -1, or None
    disclaimer: str = "This is community discussion, not financial advice. Always do your own research."

    class Config:
        from_attributes = True


class VoteRequest(BaseModel):
    direction: int = Field(..., ge=-1, le=1)

    class Config:
        json_schema_extra = {"example": {"direction": 1}}


class PaginatedPosts(BaseModel):
    items: List[PostResponse]
    next_cursor: Optional[int] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _author_info(user: User) -> AuthorInfo:
    return AuthorInfo(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
    )


def _post_to_response(
    post: Post,
    user_vote: Optional[int] = None,
) -> PostResponse:
    return PostResponse(
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


def _get_user_vote(db: Session, user_id: int, post_id: int) -> Optional[int]:
    vote = (
        db.query(Vote)
        .filter(Vote.user_id == user_id, Vote.target_id == post_id, Vote.target_type == "post")
        .first()
    )
    return vote.vote_type if vote else None


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


def _apply_feed_sort(q, sort: str, time_filter: str = "all"):
    """Apply sort and time filter to a feed query. Returns the modified query."""
    if sort == "rising":
        six_hours_ago = datetime.now(timezone.utc) - timedelta(hours=6)
        q = q.filter(Post.created_at > six_hours_ago)
        q = q.order_by(Post.upvote_count.desc(), Post.id.desc())
    elif sort == "new":
        q = q.order_by(Post.created_at.desc(), Post.id.desc())
    elif sort == "top":
        time_deltas = {
            "day": timedelta(days=1),
            "week": timedelta(weeks=1),
            "month": timedelta(days=30),
            "year": timedelta(days=365),
        }
        if time_filter != "all" and time_filter in time_deltas:
            cutoff = datetime.now(timezone.utc) - time_deltas[time_filter]
            q = q.filter(Post.created_at > cutoff)
        q = q.order_by((Post.upvote_count - Post.downvote_count).desc(), Post.id.desc())
    else:  # hot (default)
        q = q.order_by(Post.hot_score.desc(), Post.id.desc())
    return q


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/posts", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
async def create_post(
    body: PostCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Create a new post. User must be a member of the community."""
    community = (
        db.query(Community)
        .filter(Community.slug == body.community_slug)
        .first()
    )
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Community '{body.community_slug}' not found",
        )

    membership = (
        db.query(CommunityMember)
        .filter(
            CommunityMember.community_id == community.id,
            CommunityMember.user_id == user.id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must join this community before posting",
        )

    tickers = [t.strip().upper() for t in (body.tickers or []) if t.strip()]

    now = datetime.utcnow()
    post = Post(
        title=body.title,
        body=body.body,
        post_type=body.post_type,
        tickers=tickers,
        sentiment=body.sentiment,
        author_id=user.id,
        community_id=community.id,
    )
    db.add(post)
    db.flush()

    # Compute and set hot score
    post_created = post.created_at or now
    # If created_at is timezone-aware, make it naive for the calculation
    if hasattr(post_created, 'tzinfo') and post_created.tzinfo is not None:
        post_created = post_created.replace(tzinfo=None)
    post.hot_score = hot_score(0, 0, post_created)

    # Update community post count
    community.post_count = (community.post_count or 0) + 1

    # Update user post count
    user.post_count = (getattr(user, "post_count", 0) or 0) + 1

    db.commit()
    db.refresh(post)

    # Award reputation for creating a post
    reputation_service.update_reputation(user.id, "post_created", db)

    # Broadcast new post via WebSocket to community channel
    try:
        from app.services.ws_manager import ws_manager
        _slug = community.slug if community else "general"
        asyncio.create_task(ws_manager.broadcast(
            f"community:feed:{_slug}",
            {"type": "new_post", "post_id": post.id, "title": post.title}
        ))
    except Exception:
        pass  # WebSocket broadcast is non-critical

    # ── Non-blocking AI moderation (fire-and-forget) ────────────────────
    _post_id = post.id
    _title = body.title
    _body_text = body.body or ""
    _tickers = tickers
    _user_created = getattr(user, "created_at", None)
    _account_age = (datetime.utcnow() - _user_created).days if _user_created else 365

    async def _moderate_post_bg():
        try:
            result = await moderation_service.moderate_post(
                title=_title,
                body=_body_text,
                tickers=_tickers,
                author_account_age_days=_account_age,
            )
            if SessionLocal is None:
                return
            bg_db = SessionLocal()
            try:
                p = bg_db.query(Post).filter(Post.id == _post_id).first()
                if not p:
                    return
                p.ai_mod_score = result.score
                p.ai_risk_flags = result.flags
                p.moderation_status = result.action

                if result.action == "remove":
                    p.is_removed = True
                if result.action in ("review", "remove"):
                    report = ModerationReport(
                        reporter_id=None,
                        target_id=_post_id,
                        target_type="post",
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
                        target_type="post",
                        target_id=_post_id,
                        extra_data={"score": result.score, "flags": result.flags},
                    ))
                bg_db.commit()
            except Exception as exc:
                logger.error("Background moderation DB error: %s", exc)
                bg_db.rollback()
            finally:
                bg_db.close()
        except Exception as exc:
            logger.error("Background post moderation failed: %s", exc)

    asyncio.create_task(_moderate_post_bg())

    # ── Non-blocking sentiment scoring (fire-and-forget) ──────────────
    async def _score_sentiment(post_id: int):
        """Background task to score post sentiment."""
        try:
            from app.services.sentiment_service import sentiment_service
            from app.db.database import SessionLocal as _SL
            db_s = _SL()
            try:
                p = db_s.query(Post).filter(Post.id == post_id).first()
                if p and not p.sentiment:
                    result = sentiment_service.score_text(f"{p.title} {p.body or ''}")
                    p.sentiment = result.label
                    p.sentiment_confidence = result.confidence
                    db_s.commit()
            finally:
                db_s.close()
        except Exception as e:
            logger.error(f"Sentiment scoring failed for post {post_id}: {e}")

    asyncio.create_task(_score_sentiment(post.id))

    # Reload with relationships
    post = _get_post_or_404(db, post.id)
    return _post_to_response(post, user_vote=None)


@router.get("/posts/{post_id}", response_model=PostResponse)
async def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get a single post by ID."""
    post = _get_post_or_404(db, post_id)
    user_vote = None
    if current_user:
        user_vote = _get_user_vote(db, current_user.id, post_id)

    # Increment view count
    post.view_count = (post.view_count or 0) + 1
    db.commit()

    return _post_to_response(post, user_vote=user_vote)


@router.patch("/posts/{post_id}", response_model=PostResponse)
async def update_post(
    post_id: int,
    body: PostUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Edit a post. Only the author can edit."""
    post = _get_post_or_404(db, post_id)

    if post.author_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author can edit this post",
        )

    if body.title is not None:
        post.title = body.title
    if body.body is not None:
        post.body = body.body
    if body.tickers is not None:
        post.tickers = [t.strip().upper() for t in body.tickers if t.strip()]
    if body.sentiment is not None:
        post.sentiment = body.sentiment

    db.commit()
    db.refresh(post)

    post = _get_post_or_404(db, post.id)
    return _post_to_response(post, user_vote=_get_user_vote(db, user.id, post.id))


@router.delete("/posts/{post_id}", status_code=status.HTTP_200_OK)
async def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Delete (soft-remove) a post. Author or community moderator/owner."""
    post = _get_post_or_404(db, post_id)

    is_author = post.author_id == user.id
    is_mod = _check_is_mod(db, post.community_id, user.id)

    if not is_author and not is_mod:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or a moderator can delete this post",
        )

    post.is_removed = True
    db.commit()

    return {"message": "Post deleted successfully"}


@router.get("/communities/{slug}/posts", response_model=PaginatedPosts)
async def community_posts(
    slug: str,
    sort: str = Query("hot", pattern="^(hot|new|top)$"),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get posts for a community, sorted by hot/new/top."""
    community = db.query(Community).filter(Community.slug == slug).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")

    q = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.community))
        .filter(Post.community_id == community.id, Post.is_removed == False)
    )

    if cursor is not None:
        q = q.filter(Post.id < cursor)

    if sort == "new":
        q = q.order_by(Post.created_at.desc())
    elif sort == "top":
        q = q.order_by((Post.upvote_count - Post.downvote_count).desc(), Post.id.desc())
    else:  # hot
        q = q.order_by(Post.hot_score.desc(), Post.id.desc())

    posts = q.limit(limit).all()

    votes_map: dict = {}
    if current_user and posts:
        votes_map = _bulk_user_votes(db, current_user.id, [p.id for p in posts])

    items = [
        _post_to_response(p, user_vote=votes_map.get(p.id))
        for p in posts
    ]
    next_cursor = posts[-1].id if len(posts) == limit else None

    return PaginatedPosts(items=items, next_cursor=next_cursor)


@router.get("/feed", response_model=PaginatedPosts)
async def user_feed(
    sort: str = Query("hot", pattern="^(hot|new|top|rising)$"),
    time: str = Query("all", pattern="^(day|week|month|year|all)$"),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Personalized feed from communities the user has joined.

    Sort options: hot (default), new, top, rising.
    Time filter (only for top): day, week, month, year, all.
    """
    # Get user's community IDs
    community_ids = [
        r[0]
        for r in db.query(CommunityMember.community_id)
        .filter(CommunityMember.user_id == user.id)
        .all()
    ]

    if not community_ids:
        return PaginatedPosts(items=[], next_cursor=None)

    q = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.community))
        .filter(
            Post.community_id.in_(community_ids),
            Post.is_removed == False,
        )
    )

    if cursor is not None:
        q = q.filter(Post.id < cursor)

    q = _apply_feed_sort(q, sort, time)
    posts = q.limit(limit).all()

    votes_map = _bulk_user_votes(db, user.id, [p.id for p in posts]) if posts else {}

    items = [
        _post_to_response(p, user_vote=votes_map.get(p.id))
        for p in posts
    ]
    next_cursor = posts[-1].id if len(posts) == limit else None

    return PaginatedPosts(items=items, next_cursor=next_cursor)


@router.get("/feed/popular", response_model=PaginatedPosts)
async def popular_feed(
    sort: str = Query("hot", pattern="^(hot|new|top|rising)$"),
    time: str = Query("all", pattern="^(day|week|month|year|all)$"),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Global popular feed across all communities.

    Sort options: hot (default), new, top, rising.
    Time filter (only for top): day, week, month, year, all.
    """
    q = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.community))
        .filter(Post.is_removed == False)
    )

    if cursor is not None:
        q = q.filter(Post.id < cursor)

    q = _apply_feed_sort(q, sort, time)
    posts = q.limit(limit).all()

    votes_map: dict = {}
    if current_user and posts:
        votes_map = _bulk_user_votes(db, current_user.id, [p.id for p in posts])

    items = [
        _post_to_response(p, user_vote=votes_map.get(p.id))
        for p in posts
    ]
    next_cursor = posts[-1].id if len(posts) == limit else None

    return PaginatedPosts(items=items, next_cursor=next_cursor)


@router.get("/feed/trending-tickers")
async def trending_tickers(
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Get trending tickers by mention count in recent posts."""
    from sqlalchemy import text
    from datetime import timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Use unnest for PostgreSQL ARRAY, fallback for SQLite
    try:
        rows = db.execute(text("""
            SELECT ticker, COUNT(*) as mention_count
            FROM posts, unnest(tickers) AS ticker
            WHERE created_at > :cutoff
              AND is_removed = false
              AND ticker IS NOT NULL
              AND ticker != ''
            GROUP BY ticker
            ORDER BY mention_count DESC
            LIMIT :lim
        """), {"cutoff": cutoff, "lim": limit}).fetchall()
    except Exception:
        # Fallback: return empty if unnest not supported
        return {"tickers": [], "time_window_hours": hours}

    tickers = [{"symbol": row[0], "mention_count": row[1]} for row in rows]

    return {"tickers": tickers, "time_window_hours": hours}


@router.get("/feed/market-mood")
async def market_mood(
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
):
    """Aggregate sentiment across recent posts — market mood indicator."""
    from datetime import timedelta, timezone as tz
    cutoff = datetime.now(tz.utc) - timedelta(hours=hours)

    posts = (
        db.query(Post.sentiment, func.count(Post.id))
        .filter(Post.created_at > cutoff, Post.is_removed == False, Post.sentiment.isnot(None))
        .group_by(Post.sentiment)
        .all()
    )

    mood = {"bullish": 0, "bearish": 0, "neutral": 0}
    total = 0
    for sentiment, count in posts:
        if sentiment in mood:
            mood[sentiment] = count
            total += count

    dominant = max(mood, key=mood.get) if total > 0 else "neutral"

    return {
        "mood": dominant,
        "counts": mood,
        "total_posts": total,
        "time_window_hours": hours,
        "bullish_pct": round(mood["bullish"] / max(total, 1) * 100, 1),
        "bearish_pct": round(mood["bearish"] / max(total, 1) * 100, 1),
    }


@router.get("/feed/ticker/{symbol}", response_model=PaginatedPosts)
async def ticker_feed(
    symbol: str,
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Posts mentioning a specific ticker symbol."""
    ticker = symbol.strip().upper()

    q = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.community))
        .filter(
            Post.is_removed == False,
            Post.tickers.any(ticker),
        )
    )

    if cursor is not None:
        q = q.filter(Post.id < cursor)

    posts = q.order_by(Post.created_at.desc()).limit(limit).all()

    votes_map: dict = {}
    if current_user and posts:
        votes_map = _bulk_user_votes(db, current_user.id, [p.id for p in posts])

    items = [
        _post_to_response(p, user_vote=votes_map.get(p.id))
        for p in posts
    ]
    next_cursor = posts[-1].id if len(posts) == limit else None

    return PaginatedPosts(items=items, next_cursor=next_cursor)


@router.post("/posts/{post_id}/vote", status_code=status.HTTP_200_OK)
async def vote_on_post(
    post_id: int,
    body: VoteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Upvote or downvote a post. Re-voting with same direction is idempotent.
    Changing direction updates the vote."""
    if body.direction not in (1, -1):
        raise HTTPException(status_code=400, detail="direction must be 1 or -1")

    post = _get_post_or_404(db, post_id)

    existing_vote = (
        db.query(Vote)
        .filter(Vote.user_id == user.id, Vote.target_id == post_id, Vote.target_type == "post")
        .first()
    )

    if existing_vote:
        if existing_vote.vote_type == body.direction:
            # Idempotent
            return {"message": "Vote already recorded", "direction": body.direction}

        # Reverse the old vote counts
        if existing_vote.vote_type == 1:
            post.upvote_count = max((post.upvote_count or 0) - 1, 0)
        else:
            post.downvote_count = max((post.downvote_count or 0) - 1, 0)

        existing_vote.vote_type = body.direction
    else:
        new_vote = Vote(
            user_id=user.id,
            target_id=post_id,
            target_type="post",
            vote_type=body.direction,
        )
        db.add(new_vote)

    # Apply new vote
    if body.direction == 1:
        post.upvote_count = (post.upvote_count or 0) + 1
    else:
        post.downvote_count = (post.downvote_count or 0) + 1

    # Recalculate hot score
    post_created = post.created_at or datetime.utcnow()
    if hasattr(post_created, 'tzinfo') and post_created.tzinfo is not None:
        post_created = post_created.replace(tzinfo=None)
    post.hot_score = hot_score(post.upvote_count, post.downvote_count, post_created)

    db.commit()

    # Update reputation for the post author (not the voter)
    if post.author_id != user.id:
        action = "post_upvote_received" if body.direction == 1 else "post_downvote_received"
        reputation_service.update_reputation(post.author_id, action, db)

    return {
        "message": "Vote recorded",
        "direction": body.direction,
        "upvote_count": post.upvote_count,
        "downvote_count": post.downvote_count,
    }


@router.post("/posts/{post_id}/pin")
async def toggle_pin_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Toggle pin status on a post. Moderator/owner only."""
    from app.models.community import CommunityMember

    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    membership = (
        db.query(CommunityMember)
        .filter(CommunityMember.community_id == post.community_id, CommunityMember.user_id == user.id)
        .first()
    )
    if not membership or membership.role not in ("owner", "moderator"):
        raise HTTPException(status_code=403, detail="Only moderators can pin posts")

    post.is_pinned = not post.is_pinned
    db.commit()
    return {"post_id": post_id, "is_pinned": post.is_pinned}


@router.post("/posts/{post_id}/lock")
async def toggle_lock_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Toggle lock status on a post. Moderator/owner only."""
    from app.models.community import CommunityMember

    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    membership = (
        db.query(CommunityMember)
        .filter(CommunityMember.community_id == post.community_id, CommunityMember.user_id == user.id)
        .first()
    )
    if not membership or membership.role not in ("owner", "moderator"):
        raise HTTPException(status_code=403, detail="Only moderators can lock posts")

    post.is_locked = not post.is_locked
    db.commit()
    return {"post_id": post_id, "is_locked": post.is_locked}


@router.delete("/posts/{post_id}/vote", status_code=status.HTTP_200_OK)
async def remove_vote_on_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Remove a vote on a post."""
    post = _get_post_or_404(db, post_id)

    existing_vote = (
        db.query(Vote)
        .filter(Vote.user_id == user.id, Vote.target_id == post_id, Vote.target_type == "post")
        .first()
    )

    if not existing_vote:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No vote to remove")

    # Reverse counts
    if existing_vote.vote_type == 1:
        post.upvote_count = max((post.upvote_count or 0) - 1, 0)
    else:
        post.downvote_count = max((post.downvote_count or 0) - 1, 0)

    db.delete(existing_vote)
    db.commit()

    return {
        "message": "Vote removed",
        "upvote_count": post.upvote_count,
        "downvote_count": post.downvote_count,
    }
