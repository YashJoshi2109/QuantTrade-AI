"""New Agentic RAG Copilot SSE Endpoint.

POST /api/v1/copilot/stream  (replaces old GROQ-based endpoint)

Flow:
  1. Auth + budget guard
  2. CopilotRouter.route() → RoutingDecision
  3. Load Redis memory
  4. Run LangGraph prep graph (supervisor → agents → merge → context)
  5. Stream Claude Sonnet response via ChatBedrock.astream()
  6. Apply guardrails inline
  7. Save to Redis memory + PostgreSQL chat history
  8. Emit citations + done events
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import require_auth
from app.db.database import get_db
from app.models.user import User
from app.services.agentic.bedrock_client import get_llm_sonnet
from app.services.agentic.memory import (
    ConversationMemory,
    format_history_for_llm,
    load_memory,
    save_turn,
)
from app.services.agentic.supervisor import CopilotState, get_compiled_graph
from app.services.copilot.router import CopilotRouter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["agentic-copilot"])

FREE_TIER_DAILY_LIMIT = 50

DISCLAIMER = (
    "\n\n*This is AI-generated analysis for informational purposes only. "
    "Not financial advice. Always consult a qualified financial professional.*"
)

SYSTEM_PROMPT_BASE = """\
You are QuantTrade AI Copilot — an institutional-grade financial analyst powered by \
quantitative models, real-time market data, and SEC filings.

Rules:
- ONLY use data provided in the context below — never hallucinate financial numbers
- Reference retrieved SEC sections as [Source N] inline
- Always end analysis with a risk disclaimer
- Be precise, structured, and cite sources

{agent_instructions}

{context}
"""


# ── Request model ──────────────────────────────────────────────────────────────
class AgenticStreamRequest(BaseModel):
    message: str
    symbol:          Optional[str] = None
    conversation_id: Optional[str] = None


# ── Budget guard ───────────────────────────────────────────────────────────────
def _check_budget(user_id: int, db: Session, daily_count: int, daily_limit: int) -> None:
    if daily_count >= daily_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily copilot limit reached ({daily_limit} requests/day on free tier). "
                   f"Upgrade to Pro for unlimited access.",
        )


def _get_daily_count(user_id: int, db: Session) -> int:
    """Count today's copilot requests for this user from chat history."""
    try:
        from app.models.chat_history import ChatHistory
        from sqlalchemy import func
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        count = (
            db.query(func.count(ChatHistory.id))
            .filter(
                ChatHistory.user_id   == user_id,
                ChatHistory.role      == "user",
                ChatHistory.created_at >= today_start,
            )
            .scalar()
        )
        return count or 0
    except Exception:
        return 0


# ── Guardrails ─────────────────────────────────────────────────────────────────
def apply_guardrails(response: str) -> str:
    """Apply post-stream guardrails inline (never blocks, only fixes)."""
    lower = response.lower()
    if "informational purposes" not in lower and "not financial advice" not in lower:
        response += DISCLAIMER
    return response


# ── SSE helper ─────────────────────────────────────────────────────────────────
def _sse(event: str, data) -> str:
    payload = json.dumps(data, default=str) if not isinstance(data, str) else data
    return f"event: {event}\ndata: {payload}\n\n"


# ── Main SSE generator ──────────────────────────────────────────────────────────
async def _stream_generator(
    req: AgenticStreamRequest,
    db: Session,
    user: User,
) -> AsyncGenerator[str, None]:
    """Main SSE generator: prep graph → Sonnet stream → guardrails → persist."""
    request_id      = str(uuid.uuid4())
    conversation_id = req.conversation_id or str(uuid.uuid4())

    # ── 1. Budget guard ────────────────────────────────────────────────────────
    daily_count = _get_daily_count(user.id, db)
    try:
        _check_budget(user.id, db, daily_count, FREE_TIER_DAILY_LIMIT)
    except HTTPException as e:
        yield _sse("error", {"message": e.detail})
        return

    # ── 2. Route ───────────────────────────────────────────────────────────────
    copilot_router   = CopilotRouter(db)
    routing_decision = copilot_router.route(req.message, explicit_symbol=req.symbol)

    rd_dict = {
        "intent":                routing_decision.intent.value
                                 if hasattr(routing_decision.intent, "value")
                                 else str(routing_decision.intent),
        "primary_ticker":        routing_decision.primary_ticker,
        "all_tickers":           routing_decision.all_tickers,
        "use_stock_context":     routing_decision.use_stock_context,
        "inject_general_knowledge": routing_decision.inject_general_knowledge,
    }
    yield _sse("intent", {"intent": rd_dict["intent"], "symbol": rd_dict["primary_ticker"]})

    # ── 3. Load memory (3s hard timeout — Redis may be unreachable) ─────────────
    try:
        memory = await asyncio.wait_for(
            load_memory(user.id, conversation_id), timeout=3.0
        )
    except Exception:
        memory = ConversationMemory()
    history_str = format_history_for_llm(memory)

    # ── 4. Run prep graph ──────────────────────────────────────────────────────
    yield _sse("tool_call", {"message": "Running analysis pipeline..."})

    initial_state: CopilotState = {
        "message":              req.message,
        "routing_decision":     rd_dict,
        "conversation_history": memory.turns[-8:],
        "active_agents":        [],
        "agent_results":        {},
        "all_chunks":           [],
        "final_context":        "",
        "response":             "",
        "citations":            [],
        "error":                None,
    }

    try:
        graph  = get_compiled_graph()
        state  = await graph.ainvoke(initial_state)
    except Exception as exc:
        logger.error("Prep graph failed: %s", exc, exc_info=True)
        yield _sse("error", {"message": "Analysis pipeline error. Please try again."})
        return

    final_context = state.get("final_context", "")
    citations     = state.get("citations", [])

    yield _sse("tool_result", {"message": f"Found {len(state.get('all_chunks', []))} relevant sections"})

    # Emit citations early (frontend can start rendering)
    for i, cit in enumerate(citations[:10]):
        yield _sse("citation", {**cit, "source_n": i + 1})

    # ── 5. Stream LLM response ────────────────────────────────────────────────
    system_prompt = SYSTEM_PROMPT_BASE.format(
        agent_instructions=f"You are answering a {rd_dict['intent']} query.",
        context=final_context,
    )
    messages = [
        ("system", system_prompt),
        ("human",  req.message),
    ]

    llm = get_llm_sonnet()
    full_response = ""

    try:
        async for chunk in llm.astream(messages):
            token = chunk.content if hasattr(chunk, "content") else str(chunk)
            if token:
                full_response += token
                yield _sse("token", {"text": token})
    except Exception as exc:
        logger.error("LLM stream failed: %s", exc, exc_info=True)
        yield _sse("error", {"message": "LLM streaming error. Please try again."})
        return

    # ── 6. Guardrails ─────────────────────────────────────────────────────────
    full_response = apply_guardrails(full_response)

    # ── 7. Save memory + chat history ─────────────────────────────────────────
    try:
        await asyncio.wait_for(
            save_turn(memory, "user", req.message, user.id, conversation_id),
            timeout=3.0,
        )
        await asyncio.wait_for(
            save_turn(memory, "assistant", full_response, user.id, conversation_id),
            timeout=3.0,
        )
    except Exception as exc:
        logger.warning("Memory save failed: %s", exc)

    try:
        from app.models.chat_history import ChatHistory, Conversation
        now = datetime.now(timezone.utc)

        conv = (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
            .first()
        )
        if not conv:
            conv = Conversation(id=conversation_id, user_id=user.id, title=req.message[:80])
            db.add(conv)
            db.flush()

        db.add_all([
            ChatHistory(user_id=user.id, session_id=request_id, conversation_id=conversation_id,
                        symbol=rd_dict["primary_ticker"], role="user",
                        content=req.message, created_at=now),
            ChatHistory(user_id=user.id, session_id=request_id, conversation_id=conversation_id,
                        symbol=rd_dict["primary_ticker"], role="assistant",
                        content=full_response, intent_type=rd_dict["intent"],
                        created_at=now),
        ])
        conv.updated_at = now
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Chat history save failed: %s", exc)

    # ── 8. Done ───────────────────────────────────────────────────────────────
    yield _sse("done", {
        "request_id":      request_id,
        "conversation_id": conversation_id,
        "citations":       citations,
    })


# ── Endpoint ───────────────────────────────────────────────────────────────────
@router.post("/stream")
async def agentic_stream(
    req: AgenticStreamRequest,
    db: Session   = Depends(get_db),
    user: User    = Depends(require_auth),
):
    """Agentic RAG copilot streaming endpoint. Returns Server-Sent Events."""
    return StreamingResponse(
        _stream_generator(req, db, user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection":    "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
