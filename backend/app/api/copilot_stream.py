"""
Copilot usage endpoint.

The legacy GROQ/OpenRouter streaming pipeline that used to live here (and the
`llm_router` it called) was dead code — replaced by app.api.agentic_stream —
and made unguarded provider calls, so it was removed with the AI usage guard.

GET /api/v1/copilot/usage keeps its response shape for the copilot UI, now
backed by app.services.ai_guard (same numbers as /api/v1/me/ai-usage).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.ai_quota import resolve_tier
from app.api.auth import require_auth
from app.db.database import get_db
from app.models.user import User
from app.services import ai_guard

router = APIRouter()


@router.get("/copilot/usage")
def copilot_usage(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """Per-user AI usage for today (legacy shape + the guard's fields)."""
    tier = resolve_tier(db, current_user)
    u = ai_guard.usage_summary(current_user.id, tier)
    g = ai_guard.global_summary()
    return {
        "today_requests": u["requests_used"],
        "today_input_tokens": u["input_tokens"],
        "today_output_tokens": u["output_tokens"],
        "today_cost_usd": u["cost_usd"],
        "daily_budget_usd": g["daily_budget_usd"],
        "budget_remaining_usd": round(max(0.0, g["daily_budget_usd"] - g["today_spent_usd"]), 4),
        "budget_ok": not u["paused"] and u["requests_remaining"] > 0,
        "is_pro": tier in ("pro", "admin"),
        "free_limit": u["requests_limit"],
        "free_remaining": u["requests_remaining"],
        # ai_guard fields
        "tier": tier,
        "paused": u["paused"],
        "paused_message": u["paused_message"],
        "tokens_limit": u["tokens_limit"],
        "tokens_remaining": u["tokens_remaining"],
    }
