"""
Moderation API endpoints

Routes:
  GET  /moderation/queue           -- Pending items (mod/admin only)
  POST /moderation/action/{id}     -- Take action: approve/remove/warn (mod/admin only)
  GET  /moderation/audit-log       -- Audit trail (admin only)
  POST /reports                    -- Report a post/comment (any authenticated user)
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User
from app.models.community import (
    Post, Comment, ModerationReport, ModerationAction, AuditLog,
)
from app.api.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic Schemas ────────────────────────────────────────────────────────

class ReportCreate(BaseModel):
    target_id: int
    target_type: str = Field(..., pattern="^(post|comment|user)$")
    reason: str = Field(..., pattern="^(spam|misinformation|manipulation|harassment|other)$")
    description: Optional[str] = Field(None, max_length=2000)


class ReportResponse(BaseModel):
    id: int
    reporter_id: Optional[int] = None
    target_id: int
    target_type: str
    reason: str
    description: Optional[str] = None
    ai_score: Optional[float] = None
    ai_flags: Optional[list] = None
    status: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ActionCreate(BaseModel):
    action_type: str = Field(..., pattern="^(approve|remove|warn|mute|ban)$")
    reason: Optional[str] = Field(None, max_length=2000)


class ActionResponse(BaseModel):
    id: int
    report_id: Optional[int] = None
    moderator_id: int
    action_type: str
    reason: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AuditLogResponse(BaseModel):
    id: int
    actor_id: Optional[int] = None
    actor_type: str
    action: str
    target_type: Optional[str] = None
    target_id: Optional[int] = None
    extra_data: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaginatedReports(BaseModel):
    items: List[ReportResponse]
    total: int
    next_cursor: Optional[int] = None


class PaginatedAuditLogs(BaseModel):
    items: List[AuditLogResponse]
    total: int
    next_cursor: Optional[int] = None


# ── Helpers ─────────────────────────────────────────────────────────────────

def _require_mod_or_admin(user: User):
    """Raise 403 unless user.role is moderator or admin."""
    role = getattr(user, "role", None) or "user"
    if role not in ("moderator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Moderator or admin access required",
        )


def _require_admin(user: User):
    role = getattr(user, "role", None) or "user"
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )


def _log_audit(
    db: Session,
    *,
    actor_id: Optional[int],
    actor_type: str,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    extra_data: Optional[dict] = None,
    ip_address: Optional[str] = None,
):
    entry = AuditLog(
        actor_id=actor_id,
        actor_type=actor_type,
        action=action,
        target_type=target_type,
        target_id=target_id,
        extra_data=extra_data or {},
        ip_address=ip_address,
    )
    db.add(entry)


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/reports", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    body: ReportCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Report a post, comment, or user. Any authenticated user can file a report."""
    # Validate target exists
    if body.target_type == "post":
        target = db.query(Post).filter(Post.id == body.target_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Post not found")
    elif body.target_type == "comment":
        target = db.query(Comment).filter(Comment.id == body.target_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Comment not found")
    elif body.target_type == "user":
        target = db.query(User).filter(User.id == body.target_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")

    report = ModerationReport(
        reporter_id=user.id,
        target_id=body.target_id,
        target_type=body.target_type,
        reason=body.reason,
        description=body.description,
        status="pending",
    )
    db.add(report)

    _log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="report_created",
        target_type=body.target_type,
        target_id=body.target_id,
        extra_data={"reason": body.reason},
    )

    db.commit()
    db.refresh(report)
    return report


@router.get("/moderation/queue", response_model=PaginatedReports)
async def moderation_queue(
    status_filter: str = Query("pending", pattern="^(pending|reviewed|resolved|all)$"),
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get pending moderation reports. Mod/admin only."""
    _require_mod_or_admin(user)

    q = db.query(ModerationReport)
    if status_filter != "all":
        q = q.filter(ModerationReport.status == status_filter)

    total = q.count()

    if cursor is not None:
        q = q.filter(ModerationReport.id > cursor)

    reports = q.order_by(ModerationReport.created_at.desc()).limit(limit).all()
    next_cursor = reports[-1].id if len(reports) == limit else None

    return PaginatedReports(
        items=[ReportResponse.model_validate(r) for r in reports],
        total=total,
        next_cursor=next_cursor,
    )


@router.post(
    "/moderation/action/{report_id}",
    response_model=ActionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def take_moderation_action(
    report_id: int,
    body: ActionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Take action on a moderation report. Mod/admin only."""
    _require_mod_or_admin(user)

    report = db.query(ModerationReport).filter(ModerationReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Apply the action to the target
    if body.action_type == "remove":
        if report.target_type == "post":
            post = db.query(Post).filter(Post.id == report.target_id).first()
            if post:
                post.is_removed = True
        elif report.target_type == "comment":
            comment = db.query(Comment).filter(Comment.id == report.target_id).first()
            if comment:
                comment.is_removed = True

    elif body.action_type == "approve":
        # Un-remove if it was auto-removed
        if report.target_type == "post":
            post = db.query(Post).filter(Post.id == report.target_id).first()
            if post and post.is_removed:
                post.is_removed = False
        elif report.target_type == "comment":
            comment = db.query(Comment).filter(Comment.id == report.target_id).first()
            if comment and comment.is_removed:
                comment.is_removed = False

    # Record the action
    action = ModerationAction(
        report_id=report_id,
        moderator_id=user.id,
        action_type=body.action_type,
        reason=body.reason,
    )
    db.add(action)

    # Update report status
    report.status = "resolved"

    _log_audit(
        db,
        actor_id=user.id,
        actor_type="moderator",
        action=f"moderation_{body.action_type}",
        target_type=report.target_type,
        target_id=report.target_id,
        extra_data={"report_id": report_id, "reason": body.reason},
    )

    db.commit()
    db.refresh(action)
    return action


@router.get("/moderation/audit-log", response_model=PaginatedAuditLogs)
async def audit_log(
    cursor: Optional[int] = Query(None, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Audit trail of all moderation actions. Admin only."""
    _require_admin(user)

    q = db.query(AuditLog)
    total = q.count()

    if cursor is not None:
        q = q.filter(AuditLog.id > cursor)

    logs = q.order_by(AuditLog.created_at.desc()).limit(limit).all()
    next_cursor = logs[-1].id if len(logs) == limit else None

    return PaginatedAuditLogs(
        items=[AuditLogResponse.model_validate(lg) for lg in logs],
        total=total,
        next_cursor=next_cursor,
    )
