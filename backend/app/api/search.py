"""
Unified search endpoint across posts, comments, communities, and users.
Uses PostgreSQL ILIKE for now (tsvector can be added later with migration).
"""
import logging
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func
from typing import Optional
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.user import User
from app.models.community import Post, Comment, Community

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/search")
async def search(
    q: str = Query(..., min_length=2, max_length=200),
    type: Optional[str] = Query(None, pattern="^(posts|comments|communities|users)$"),
    community: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Unified search across posts, comments, communities, and users.
    Filter by type for specific results.
    """
    term = f"%{q.strip()}%"
    results = {}

    # Posts
    if type is None or type == "posts":
        post_q = (
            db.query(Post)
            .filter(
                Post.is_removed == False,
                or_(
                    Post.title.ilike(term),
                    Post.body.ilike(term),
                )
            )
        )
        if community:
            comm = db.query(Community).filter(Community.slug == community).first()
            if comm:
                post_q = post_q.filter(Post.community_id == comm.id)

        posts = post_q.order_by(Post.created_at.desc()).limit(limit).all()
        results["posts"] = [
            {
                "id": p.id,
                "title": p.title,
                "body": (p.body or "")[:200],
                "author_id": p.author_id,
                "community_id": p.community_id,
                "sentiment": p.sentiment,
                "upvote_count": p.upvote_count,
                "comment_count": p.comment_count,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in posts
        ]

    # Comments
    if type is None or type == "comments":
        comments = (
            db.query(Comment)
            .filter(Comment.is_removed == False, Comment.body.ilike(term))
            .order_by(Comment.created_at.desc())
            .limit(limit)
            .all()
        )
        results["comments"] = [
            {
                "id": c.id,
                "post_id": c.post_id,
                "body": (c.body or "")[:200],
                "author_id": c.author_id,
                "upvote_count": c.upvote_count,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ]

    # Communities
    if type is None or type == "communities":
        communities = (
            db.query(Community)
            .filter(
                or_(
                    Community.name.ilike(term),
                    Community.slug.ilike(term),
                    Community.description.ilike(term),
                )
            )
            .order_by(Community.member_count.desc())
            .limit(limit)
            .all()
        )
        results["communities"] = [
            {
                "slug": c.slug,
                "name": c.name,
                "description": (c.description or "")[:200],
                "category": c.category,
                "member_count": c.member_count,
            }
            for c in communities
        ]

    # Users
    if type is None or type == "users":
        users = (
            db.query(User)
            .filter(
                or_(
                    User.username.ilike(term),
                    User.full_name.ilike(term),
                )
            )
            .order_by(User.username)
            .limit(limit)
            .all()
        )
        results["users"] = [
            {
                "id": u.id,
                "username": u.username,
                "full_name": u.full_name,
                "avatar_url": u.avatar_url,
                "reputation": getattr(u, 'reputation', 0),
            }
            for u in users
        ]

    return {"query": q, "results": results}
