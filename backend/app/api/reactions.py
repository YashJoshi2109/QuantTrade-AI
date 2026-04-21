"""
Reaction API endpoints

Implementation Notes:
- API Contract:
  POST   /api/v1/posts/{post_id}/reactions       -> Add reaction (auth required)
  DELETE /api/v1/posts/{post_id}/reactions/{emoji} -> Remove reaction (auth required)
  GET    /api/v1/posts/{post_id}/reactions       -> Get reaction counts + user reactions (public)

- Error Codes:
  400 - Invalid emoji
  401 - Not authenticated
  404 - Post not found
  409 - Already reacted with same emoji
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List, Dict
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.user import User
from app.models.community import Reaction, Post
from app.api.auth import get_current_user, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()

VALID_EMOJIS = {"bullish", "bearish", "rocket", "diamond_hands", "think"}


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class ReactionCreate(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=20)


class ReactionCount(BaseModel):
    emoji: str
    count: int


class ReactionResponse(BaseModel):
    counts: List[ReactionCount]
    user_reactions: List[str]  # emojis the current user has reacted with


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_post_or_404(db: Session, post_id: int) -> Post:
    post = db.query(Post).filter(Post.id == post_id, Post.is_removed == False).first()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/reactions", status_code=status.HTTP_201_CREATED)
async def add_reaction(
    post_id: int,
    body: ReactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Add an emoji reaction to a post. Returns 409 if already reacted with same emoji."""
    if body.emoji not in VALID_EMOJIS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid emoji. Must be one of: {', '.join(sorted(VALID_EMOJIS))}",
        )

    _get_post_or_404(db, post_id)

    # Check for existing reaction
    existing = (
        db.query(Reaction)
        .filter(
            Reaction.user_id == user.id,
            Reaction.target_id == post_id,
            Reaction.target_type == "post",
            Reaction.emoji == body.emoji,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already reacted with this emoji",
        )

    reaction = Reaction(
        user_id=user.id,
        target_id=post_id,
        target_type="post",
        emoji=body.emoji,
    )
    db.add(reaction)
    db.commit()

    return {"message": "Reaction added", "emoji": body.emoji, "post_id": post_id}


@router.delete("/posts/{post_id}/reactions/{emoji}", status_code=status.HTTP_200_OK)
async def remove_reaction(
    post_id: int,
    emoji: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Remove a reaction from a post."""
    reaction = (
        db.query(Reaction)
        .filter(
            Reaction.user_id == user.id,
            Reaction.target_id == post_id,
            Reaction.target_type == "post",
            Reaction.emoji == emoji,
        )
        .first()
    )
    if not reaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reaction not found",
        )

    db.delete(reaction)
    db.commit()

    return {"message": "Reaction removed", "emoji": emoji, "post_id": post_id}


@router.get("/posts/{post_id}/reactions", response_model=ReactionResponse)
async def get_reactions(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get reaction counts and the current user's reactions for a post."""
    _get_post_or_404(db, post_id)

    # Get counts grouped by emoji
    rows = (
        db.query(Reaction.emoji, func.count(Reaction.id))
        .filter(Reaction.target_id == post_id, Reaction.target_type == "post")
        .group_by(Reaction.emoji)
        .all()
    )
    counts = [ReactionCount(emoji=emoji, count=count) for emoji, count in rows]

    # Get current user's reactions
    user_reactions: List[str] = []
    if current_user:
        user_rows = (
            db.query(Reaction.emoji)
            .filter(
                Reaction.user_id == current_user.id,
                Reaction.target_id == post_id,
                Reaction.target_type == "post",
            )
            .all()
        )
        user_reactions = [r[0] for r in user_rows]

    return ReactionResponse(counts=counts, user_reactions=user_reactions)
