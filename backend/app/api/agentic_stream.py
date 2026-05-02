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


# ── Structured data builder ───────────────────────────────────────────────────
def _build_structured_data(ticker: str, state: dict) -> dict | None:
    """Assemble structured data payload from agent live_data for frontend UI panels.

    Returns a dict matching CopilotStructuredData / StockAnalysisData on the
    frontend, or None if no usable ticker data is present.
    """
    from app.services.agentic.agents.shared import AgentResult

    # Merge live_data from all agent results
    live_data: dict = {}
    for ar in state.get("agent_results", {}).values():
        if isinstance(ar, AgentResult):
            live_data.update(ar.live_data or {})

    ticker_data: dict = live_data.get(ticker, {})
    if not ticker_data:
        return None

    result: dict = {"symbol": ticker}

    # ── Quote ────────────────────────────────────────────────────────────────
    quote = {
        "price":          ticker_data.get("price"),
        "change":         ticker_data.get("change"),
        "change_percent": ticker_data.get("change_percent"),
        "volume":         ticker_data.get("volume"),
        "high":           ticker_data.get("high"),
        "low":            ticker_data.get("low"),
        "open":           ticker_data.get("open"),
        "previous_close": ticker_data.get("previous_close"),
        "data_source":    ticker_data.get("data_source"),
    }
    if any(v is not None for k, v in quote.items() if k != "data_source"):
        result["quote"] = quote

    # ── Fundamentals ────────────────────────────────────────────────────────
    FUND_KEYS = (
        "pe_ratio", "forward_pe", "peg_ratio", "price_to_book", "eps",
        "market_cap", "beta", "dividend_yield", "week_52_high", "week_52_low",
        "profit_margin", "operating_margin", "roe", "roa", "debt_to_equity",
        "current_ratio", "target_price", "recommendation", "revenue", "avg_volume",
    )
    fundamentals = {k: ticker_data[k] for k in FUND_KEYS if ticker_data.get(k) is not None}
    if fundamentals:
        result["fundamentals"] = fundamentals

    # ── Company info ────────────────────────────────────────────────────────
    company = {
        k: ticker_data[k]
        for k in ("name", "company_name", "sector", "industry", "market_cap")
        if ticker_data.get(k)
    }
    if "company_name" in company:
        company["name"] = company.pop("company_name")
    if company:
        result["company"] = company

    return result


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

    # Emit structured data for UI stock panels (quote + fundamentals)
    ticker = rd_dict.get("primary_ticker")
    if ticker:
        structured = _build_structured_data(ticker, state)
        if structured:
            yield _sse("structured_data", structured)

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

    full_response = ""
    model_used    = "claude-sonnet-4-6"  # default; updated on fallback

    try:
        llm = get_llm_sonnet()
        llm_cls = type(llm).__name__
        if "Bedrock" in llm_cls:
            model_used = getattr(llm, "model_id", None) or "bedrock"
        elif "ChatOpenAI" in llm_cls:
            model_used = getattr(llm, "model_name", None) or "gpt-4o"
        async for chunk in llm.astream(messages):
            token = chunk.content if hasattr(chunk, "content") else str(chunk)
            if token:
                full_response += token
                yield _sse("token", {"text": token})
    except Exception as exc:
        # If Bedrock failed (model not enabled, auth error, throttle), retry with
        # OpenAI/OpenRouter by temporarily forcing PREFER_OPENAI=1 for this call.
        exc_name = type(exc).__name__
        bedrock_errors = (
            "AccessDeniedException", "ValidationException",
            "ModelNotReadyException", "ThrottlingException",
            "ClientError", "EndpointResolutionError",
            "NoCredentialsError", "BotoCoreError",
        )
        is_bedrock_error = (
            exc_name in bedrock_errors
            or "bedrock" in str(exc).lower()
            or "model access" in str(exc).lower()
            or "not authorized" in str(exc).lower()
        )
        if is_bedrock_error:
            logger.warning("Bedrock unavailable (%s: %s), retrying with OpenAI/OpenRouter fallback", exc_name, exc)
            try:
                import os as _os
                _orig = _os.environ.get("PREFER_OPENAI", "0")
                _os.environ["PREFER_OPENAI"] = "1"
                try:
                    llm_fallback = get_llm_sonnet()
                finally:
                    _os.environ["PREFER_OPENAI"] = _orig
                fb_cls = type(llm_fallback).__name__
                model_used = getattr(llm_fallback, "model_name", None) or (
                    "gpt-4o" if "OpenAI" in fb_cls else "openrouter"
                )
                async for chunk in llm_fallback.astream(messages):
                    token = chunk.content if hasattr(chunk, "content") else str(chunk)
                    if token:
                        full_response += token
                        yield _sse("token", {"text": token})
            except Exception as fallback_exc:
                logger.error("LLM fallback also failed (%s): %s", type(fallback_exc).__name__, fallback_exc, exc_info=True)
                yield _sse("error", {"message": f"LLM unavailable ({type(fallback_exc).__name__}). Check API keys or model access."})
                return
        else:
            logger.error("LLM stream failed (%s): %s", exc_name, exc, exc_info=True)
            yield _sse("error", {"message": f"LLM streaming error ({exc_name}). Please try again."})
            return

    # ── 6. Guardrails — emit disclaimer as token if appended ─────────────────
    guarded = apply_guardrails(full_response)
    if len(guarded) > len(full_response):
        disclaimer = guarded[len(full_response):]
        yield _sse("token", {"text": disclaimer})
    full_response = guarded

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
        "model":           model_used,
    })


# ── LLM status ─────────────────────────────────────────────────────────────────
@router.get("/llm-status")
async def llm_status(user: User = Depends(require_auth)):
    """Return which LLM provider is active and which are configured."""
    import os as _os
    from app.services.agentic.bedrock_client import (
        _aws_credentials_available,
        BEDROCK_SONNET_MODEL, BEDROCK_NOVA_PRO_MODEL,
        BEDROCK_NOVA_LITE_MODEL, BEDROCK_NOVA_MICRO_MODEL,
        USE_NOVA_MICRO, USE_NOVA_LITE, USE_NOVA_PRO,
    )

    prefer_openai = _os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")
    has_aws        = _aws_credentials_available()
    has_openai     = bool(_os.getenv("OPENAI_API_KEY"))
    has_openrouter = bool(
        _os.getenv("OPENROUTER_API_KEY")
        or _os.getenv("NEXT_PUBLIC_OPENROUTER_API_KEY")
    )

    # Sonnet-class active model
    if USE_NOVA_PRO:
        sonnet_model_name = f"nova-pro ({BEDROCK_NOVA_PRO_MODEL})"
    else:
        sonnet_model_name = f"claude-sonnet ({BEDROCK_SONNET_MODEL})"

    # Haiku-class active model (priority: micro > lite > haiku)
    if USE_NOVA_MICRO:
        haiku_model_name = f"nova-micro ({BEDROCK_NOVA_MICRO_MODEL})"
    elif USE_NOVA_LITE:
        haiku_model_name = f"nova-lite ({BEDROCK_NOVA_LITE_MODEL})"
    else:
        haiku_model_name = "claude-haiku-4-5"

    if not prefer_openai and has_aws:
        active_provider = "bedrock"
        active_model    = sonnet_model_name
    elif has_openai:
        active_provider = "openai"
        active_model    = "gpt-4o"
    elif has_openrouter:
        active_provider = "openrouter"
        active_model    = "anthropic/claude-3.5-sonnet (OpenRouter)"
    else:
        active_provider = "none"
        active_model    = "No LLM provider configured"

    return {
        "active_provider":    active_provider,
        "active_model":       active_model,
        "active_haiku_model": haiku_model_name,
        "providers": {
            "bedrock": {
                "available":                has_aws and not prefer_openai,
                "skipped_by_prefer_openai": prefer_openai,
                "nova_micro_enabled":       USE_NOVA_MICRO,
                "nova_lite_enabled":        USE_NOVA_LITE,
                "nova_pro_enabled":         USE_NOVA_PRO,
                "sonnet_class_model":       sonnet_model_name,
                "haiku_class_model":        haiku_model_name,
            },
            "openai":     {"available": has_openai},
            "openrouter": {"available": has_openrouter},
        },
        "prefer_openai": prefer_openai,
        "note": (
            "USE_NOVA_MICRO=1: Nova Micro for haiku-class calls (text-only, cheapest ~20x vs Sonnet). "
            "USE_NOVA_LITE=1: Nova Lite for haiku-class calls (multimodal, ~10x vs Sonnet). "
            "USE_NOVA_PRO=1: Nova Pro instead of Claude Sonnet (mid-tier). "
            "Priority for haiku-class: MICRO > LITE > Haiku 4.5."
        ),
    }


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
