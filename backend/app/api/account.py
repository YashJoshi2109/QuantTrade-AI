"""
Account lifecycle: verified deletion via email OTP.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.db.database import get_db
from app.models.user import User
from app.services.account_delete_service import delete_user_account
from app.services.otp_service import (
    generate_otp,
    send_delete_account_otp_email,
    store_delete_account_otp,
    verify_delete_account_otp,
)

router = APIRouter()


class DeleteAccountConfirmBody(BaseModel):
    otp: str = Field(..., min_length=4, max_length=10)


@router.post("/delete-request")
async def request_account_deletion(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = int(current_user["user_id"])
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    otp = generate_otp()
    store_delete_account_otp(uid, otp)
    ok, err = send_delete_account_otp_email(user.email, otp)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=err or "Could not send verification email",
        )
    return {"ok": True, "message": "Check your email for a verification code."}


@router.post("/delete-confirm")
async def confirm_account_deletion(
    body: DeleteAccountConfirmBody,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = int(current_user["user_id"])
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    clean = body.otp.strip().replace(" ", "")
    if not verify_delete_account_otp(uid, clean):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired code",
        )

    delete_user_account(db, user)
    return {"ok": True, "message": "Account deleted."}
