"""
User settings preferences (AI copilot, notifications, Pro email alerts).
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.user import User
from app.services.user_preferences_service import (
    load_preferences,
    merge_patch,
    public_preferences,
)

router = APIRouter()


class PreferencesPatch(BaseModel):
    analyst_personality: str | None = Field(default=None)
    data_sources: Dict[str, bool] | None = None
    notifications: Dict[str, bool] | None = None
    pro_alerts: Dict[str, bool] | None = None


@router.get("/preferences")
async def get_preferences(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = int(current_user["user_id"])
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    prefs = load_preferences(user)
    return public_preferences(prefs)


@router.put("/preferences")
async def put_preferences(
    body: PreferencesPatch,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = int(current_user["user_id"])
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    patch: Dict[str, Any] = body.model_dump(exclude_none=True)
    merged = merge_patch(db, user, patch)
    return public_preferences(merged)
