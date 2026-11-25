"""
LLM guard — compatibility name for the AI usage guard.

All paid-AI accounting (LLMs, embeddings, rerank, image generation, TTS) lives
in app.services.ai_guard; this module re-exports it so callers can import
either name.  FastAPI dependencies (require_llm_quota) are in app.api.ai_quota.
"""
from app.services.ai_guard import *  # noqa: F401,F403
from app.services.ai_guard import (  # noqa: F401  (explicit for type checkers)
    AIQuotaError,
    BUDGET_PAUSED_DETAIL,
    GuardCallbackHandler,
    GuardContext,
    Reservation,
    StreamMeter,
    admit_request,
    estimate_cost,
    reserve,
    reserve_system,
    system_context,
    use_context,
)
