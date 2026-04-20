"""
Notification API endpoints

Implementation Notes:
- API Contract:
  GET    /api/v1/notifications                  -> User's notifications (auth, paginated)
  PATCH  /api/v1/notifications/{id}/read        -> Mark as read (auth)
  POST   /api/v1/notifications/read-all         -> Mark all as read (auth)
  GET    /api/v1/notifications/unread-count     -> Unread count for badge (auth)

- Error Codes:
  401 - Not authenticated
  404 - Notification not found
"""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.db.database import get_db
from app.models.user import User
from app.models.community import Notification
from app.api.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic Schemas ─────────────────────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: int
    type: str
    title: str
    body: Optional[str] = None
    action_url: Optional[str] = None
    actor_id: Optional[int] = None
    is_read: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaginatedNotifications(BaseModel):
    items: List[NotificationResponse]
    next_cursor: Optional[int] = None
    unread_count: int = 0


class UnreadCountResponse(BaseModel):
    count: int


# ── Helpers ──────────────────────────────────────────────────────────────────

def _notification_to_response(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        action_url=n.action_url,
        actor_id=n.actor_id,
        is_read=n.is_read,
        created_at=n.created_at,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/notifications", response_model=PaginatedNotifications)
async def get_notifications(
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get user's notifications, newest first."""
    q = db.query(Notification).filter(Notification.user_id == user.id)

    if unread_only:
        q = q.filter(Notification.is_read == False)

    if cursor is not None:
        q = q.filter(Notification.id < cursor)

    notifications = q.order_by(Notification.created_at.desc()).limit(limit).all()

    # Get total unread count
    unread_count = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user.id, Notification.is_read == False)
        .scalar()
    ) or 0

    items = [_notification_to_response(n) for n in notifications]
    next_cursor = notifications[-1].id if len(notifications) == limit else None

    return PaginatedNotifications(
        items=items,
        next_cursor=next_cursor,
        unread_count=unread_count,
    )


@router.patch("/notifications/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Mark a single notification as read."""
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user.id)
        .first()
    )
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    notification.is_read = True
    db.commit()
    db.refresh(notification)

    return _notification_to_response(notification)


@router.post("/notifications/read-all", status_code=status.HTTP_200_OK)
async def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Mark all unread notifications as read."""
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read == False)
        .update({"is_read": True})
    )
    db.commit()

    return {"message": f"Marked {updated} notifications as read"}


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get count of unread notifications for badge display."""
    count = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user.id, Notification.is_read == False)
        .scalar()
    ) or 0

    return UnreadCountResponse(count=count)


# ── Notification Preferences ────────────────────────────────────────────────

class NotificationPreferences(BaseModel):
    replies: bool = True
    mentions: bool = True
    upvotes: bool = True
    follows: bool = True
    community_posts: bool = False
    price_alerts: bool = True


def _load_preferences_json(user: User) -> dict:
    """Parse the Text-based preferences_json column into a dict."""
    if not hasattr(user, 'preferences_json') or not user.preferences_json:
        return {}
    if isinstance(user.preferences_json, dict):
        return user.preferences_json
    try:
        return json.loads(user.preferences_json)
    except (json.JSONDecodeError, TypeError):
        return {}


@router.get("/notifications/preferences")
async def get_notification_preferences(
    user: User = Depends(require_auth),
):
    """Get notification preferences."""
    prefs = _load_preferences_json(user).get("notifications", {})
    defaults = NotificationPreferences()
    return {
        "replies": prefs.get("replies", defaults.replies),
        "mentions": prefs.get("mentions", defaults.mentions),
        "upvotes": prefs.get("upvotes", defaults.upvotes),
        "follows": prefs.get("follows", defaults.follows),
        "community_posts": prefs.get("community_posts", defaults.community_posts),
        "price_alerts": prefs.get("price_alerts", defaults.price_alerts),
    }


@router.patch("/notifications/preferences")
async def update_notification_preferences(
    body: NotificationPreferences,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Update notification preferences."""
    prefs = _load_preferences_json(user)
    prefs["notifications"] = body.model_dump()
    user.preferences_json = json.dumps(prefs)
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(user, "preferences_json")
    db.commit()
    return prefs["notifications"]
