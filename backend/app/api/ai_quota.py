"""
FastAPI side of the AI usage guard.

  require_llm_quota(feature)   dependency for every user-triggered paid-AI endpoint:
                               authenticated + email-verified user, tier lookup,
                               global breaker (503) and per-user / per-IP caps (429).
  GET  /api/v1/me/ai-usage     caller's usage and remaining quota today
  GET  /api/v1/admin/llm-usage admin-only spend report (per day / feature / provider / user)
  POST /api/v1/ai-usage/reserve
                               quota check + worst-case charge for the Next.js relays
                               that call Groq / OpenRouter directly (/api/copilot,
                               /api/ai-analysis). They must call this before spending.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.auth import is_admin_user, require_admin, require_auth
from app.db.database import get_db
from app.models.user import User
from app.services import ai_guard
from app.services.ai_guard import GuardContext

router = APIRouter(tags=["ai-usage"])


def client_ip(request: Request) -> str:
    return (
        request.headers.get("cf-connecting-ip")
        or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or request.headers.get("x-real-ip")
        or (request.client.host if request.client else "unknown")
    )


def resolve_tier(db: Session, user: User) -> str:
    if is_admin_user(user):
        return "admin"
    try:
        from app.services.billing_service import is_premium

        if is_premium(db, user.id):
            return "pro"
    except Exception:  # noqa: BLE001
        pass
    return "free"


def _require_verified() -> bool:
    return os.getenv("AI_REQUIRE_VERIFIED_EMAIL", "1").lower() not in ("0", "false", "no")


def build_context(request: Request, user: Optional[User], db: Session, feature: str) -> GuardContext:
    """Auth + verification gate; returns the guard context (does not count a request)."""
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to use AI features.")
    if getattr(user, "is_active", True) is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled.")
    if _require_verified() and not getattr(user, "is_verified", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Verify your email address to use AI features.")
    return GuardContext(feature=feature, user_id=user.id, tier=resolve_tier(db, user), ip=client_ip(request))


def require_llm_quota(feature: str):
    """Dependency factory: authenticated, verified user with quota left for `feature`.
    Counts one request (burst/day/IP) and returns the GuardContext to bind for the call."""

    def _dep(request: Request, user: User = Depends(require_auth), db: Session = Depends(get_db)) -> GuardContext:
        ctx = build_context(request, user, db, feature)
        ai_guard.admit_request(ctx)
        return ctx

    _dep.__name__ = f"require_llm_quota_{feature}"
    return _dep


def require_media_quota(feature: str):
    """Dependency factory for image / voice endpoints: same auth gate, media burst
    bucket + IP cap; images/day and TTS chars/day are enforced per call."""

    def _dep(request: Request, user: User = Depends(require_auth), db: Session = Depends(get_db)) -> GuardContext:
        ctx = build_context(request, user, db, feature)
        ai_guard.admit_request(ctx, kind="media")
        return ctx

    _dep.__name__ = f"require_media_quota_{feature}"
    return _dep


# ── User endpoint ────────────────────────────────────────────────────────────

@router.get("/me/ai-usage")
def my_ai_usage(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    return ai_guard.usage_summary(user.id, resolve_tier(db, user))


# ── Admin endpoint ───────────────────────────────────────────────────────────

@router.get("/admin/llm-usage")
def admin_llm_usage(
    days: int = Query(7, ge=1, le=90),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models.ai_usage import AIUsageEvent as E

    since = datetime.now(timezone.utc) - timedelta(days=days)
    day = func.date(E.ts)
    out: dict = {"days": days, "live": ai_guard.global_summary()}
    try:
        by_day_feature = (
            db.query(day.label("day"), E.feature, E.provider,
                     func.count(E.id), func.sum(E.input_tokens), func.sum(E.output_tokens), func.sum(E.cost_usd))
            .filter(E.ts >= since)
            .group_by(day, E.feature, E.provider)
            .order_by(day.desc())
            .all()
        )
        out["by_day_feature"] = [
            {"day": str(d), "feature": f, "provider": p, "calls": int(n or 0),
             "input_tokens": int(i or 0), "output_tokens": int(o or 0), "cost_usd": round(float(c or 0), 4)}
            for d, f, p, n, i, o, c in by_day_feature
        ]
        totals = (
            db.query(day.label("day"), func.count(E.id), func.sum(E.cost_usd))
            .filter(E.ts >= since).group_by(day).order_by(day.desc()).all()
        )
        out["by_day"] = [{"day": str(d), "calls": int(n or 0), "cost_usd": round(float(c or 0), 4)}
                         for d, n, c in totals]
        top = (
            db.query(E.user_id, func.count(E.id), func.sum(E.input_tokens + E.output_tokens), func.sum(E.cost_usd))
            .filter(E.ts >= since, E.user_id.isnot(None))
            .group_by(E.user_id)
            .order_by(func.sum(E.cost_usd).desc())
            .limit(20)
            .all()
        )
        out["top_users"] = [{"user_id": u, "calls": int(n or 0), "tokens": int(t or 0),
                             "cost_usd": round(float(c or 0), 4)} for u, n, t, c in top]
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        out["error"] = f"usage table unavailable: {type(exc).__name__}"
    return out


# ── Reservation endpoint for the Next.js relays ──────────────────────────────

# Server-side allowlist: what each relay may spend on (prices come from ai_guard).
_RELAY_FEATURES = {
    "copilot_relay": {"provider": "groq",
                      "models": {"llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"},
                      "max_tokens": 2048},
    "ai_analysis": {"provider": "openrouter", "models": {"google/gemini-flash-1.5-8b"}, "max_tokens": 400},
}


class RelayReserveRequest(BaseModel):
    feature: str
    model: str
    input_chars: int = Field(ge=0, le=200_000)
    max_tokens: int = Field(ge=1, le=8192)


@router.post("/ai-usage/reserve")
def reserve_for_relay(
    body: RelayReserveRequest,
    request: Request,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    spec = _RELAY_FEATURES.get(body.feature)
    if not spec or body.model not in spec["models"]:
        raise HTTPException(status_code=400, detail="Unsupported AI feature or model")
    max_chars = max(ai_guard.io_caps()["max_prompt_chars"] * 15, 60_000)
    if body.input_chars > max_chars:
        raise HTTPException(status_code=413, detail="Prompt too long")
    ctx = build_context(request, user, db, body.feature)
    ai_guard.admit_request(ctx)
    max_tokens = min(body.max_tokens, spec["max_tokens"])
    res = ai_guard.reserve(spec["provider"], body.model,
                           est_input_tokens=ai_guard.estimate_tokens(body.input_chars),
                           est_output_tokens=max_tokens, ctx=ctx)
    # The relay streams straight from the provider and never reports back, so
    # charge the worst case (full prompt + max_tokens) now.
    res.commit(res.reserved_tokens - max_tokens, max_tokens)
    return {"ok": True, "max_tokens": max_tokens}
