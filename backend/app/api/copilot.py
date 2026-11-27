"""Copilot API.

POST /api/v1/copilot/stream            SSE answer stream (auth + AI quota)
GET  /api/v1/copilot/context/{symbol}  ticker context card for the UI (no LLM)
GET  /api/v1/copilot/usage             per-user AI usage (legacy shape)
GET  /api/v1/copilot/llm-status        configured answer-model chain
POST /api/v1/copilot/ingest            admin: queue tickers for the SEC refresh (news-worker)
GET  /api/v1/copilot/ingest/status     admin: last SEC refresh status
GET  /api/v1/copilot/health            Qdrant + pinned embedder config (no paid call)

SSE events: intent, context, structured_data (legacy cards), tool, token,
citation, error, done, heartbeat.  `heartbeat` ({"ts"}) is sent whenever the
engine has been silent for COPILOT_SSE_HEARTBEAT_S (default 15s) so nginx /
Cloudflare / the Next proxy never cut a deep answer during a long tool phase;
clients ignore it.  `done` carries per-stage latency, guard usage and —
when post-checks changed the streamed text — `final_text` to replace it.
Deep (multi-part) questions also stream `plan` (planned computations and the
tools discovered for each, re-sent after prefetch with statuses) and
`progress` ({label, status, tool, step_id}: "Running 10,000 simulations for
AMZN"); their `done` has `deep: true`, the final `plan`, and the composer's
postcheck (removed_numbers, missing/added sections, not_executed).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, AsyncIterator, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.ai_quota import require_llm_quota, resolve_tier
from app.api.auth import is_admin_user, require_auth
from app.db.database import get_db
from app.models.user import User
from app.services import ai_guard
from app.services.ai_guard import GuardContext

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["copilot"])


class CopilotStreamRequest(BaseModel):
    message: str
    symbol: Optional[str] = Field(default=None, max_length=12)
    conversation_id: Optional[str] = Field(default=None, max_length=64)


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


try:
    HEARTBEAT_S = max(1.0, float(os.getenv("COPILOT_SSE_HEARTBEAT_S", "15")))
except ValueError:
    HEARTBEAT_S = 15.0
_END = object()


async def with_heartbeat(events: AsyncIterator[Tuple[str, Any]], interval: Optional[float] = None
                         ) -> AsyncIterator[Tuple[str, Any]]:
    """Yield the engine's events, plus ("heartbeat", {"ts"}) after every
    ``interval`` seconds without one.  The engine runs in ONE background task
    (its context, including the AI-guard context, is copied once at start); an
    engine exception is re-raised here; closing this generator cancels the engine."""
    interval = HEARTBEAT_S if interval is None else interval
    q: asyncio.Queue = asyncio.Queue()

    async def pump():
        try:
            async for ev in events:
                await q.put(ev)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - re-raised in the consumer
            await q.put(exc)
        finally:
            q.put_nowait(_END)

    task = asyncio.create_task(pump())
    try:
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=interval)
            except asyncio.TimeoutError:
                yield "heartbeat", {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds")}
                continue
            if item is _END:
                return
            if isinstance(item, BaseException):
                raise item
            yield item
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:  # noqa: BLE001
                pass


def _persist_history(db: Session, user_id: int, conversation_id: str, request_id: str,
                     symbol: Optional[str], question: str, answer: str, intent: str) -> None:
    try:
        from app.models.chat_history import ChatHistory, Conversation
        now = datetime.now(timezone.utc)
        conv = (db.query(Conversation)
                .filter(Conversation.id == conversation_id, Conversation.user_id == user_id).first())
        if not conv:
            conv = Conversation(id=conversation_id, user_id=user_id, title=question[:80])
            db.add(conv)
            db.flush()
        db.add_all([
            ChatHistory(user_id=user_id, session_id=request_id, conversation_id=conversation_id,
                        symbol=symbol, role="user", content=question, created_at=now),
            ChatHistory(user_id=user_id, session_id=request_id, conversation_id=conversation_id,
                        symbol=symbol, role="assistant", content=answer, intent_type=intent, created_at=now),
        ])
        conv.updated_at = now
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("chat history save failed: %s", exc)


async def _stream(req: CopilotStreamRequest, db: Session, user: User,
                  guard_ctx: Optional[GuardContext]) -> AsyncGenerator[str, None]:
    from app.services.copilot.engine import CopilotEngine, CopilotRequest
    from app.services.copilot.viewed import record_view

    if guard_ctx is not None:
        ai_guard.set_context(guard_ctx)
    engine = CopilotEngine(db)
    creq = CopilotRequest(message=req.message, user_id=user.id, symbol=req.symbol,
                          conversation_id=req.conversation_id)
    answer, intent, symbol, conv_id = [], "text", None, req.conversation_id
    try:
        async for name, data in with_heartbeat(engine.run(creq)):
            if name == "intent":
                intent, symbol = data.get("intent", "text"), data.get("symbol")
                if symbol:
                    await asyncio.to_thread(record_view, symbol)
            elif name == "token":
                answer.append(data.get("text", ""))
            elif name == "done":
                conv_id = data.get("conversation_id")
                if data.get("final_text"):
                    answer = [data["final_text"]]
                try:
                    tier = guard_ctx.tier if guard_ctx else "free"
                    u = ai_guard.usage_summary(user.id, tier)
                    data["guard"] = {k: u.get(k) for k in ("requests_used", "requests_limit",
                                                            "tokens_remaining", "paused")}
                except Exception:
                    pass
            yield _sse(name, data)
    except Exception as exc:
        logger.exception("copilot stream failed")
        yield _sse("error", {"message": f"Copilot error ({type(exc).__name__}). Please try again."})
        return
    if conv_id and answer:
        await asyncio.to_thread(_persist_history, db, user.id, conv_id, creq.request_id, symbol,
                                req.message, "".join(answer), intent)


@router.post("/stream")
def copilot_stream(
    req: CopilotStreamRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
    guard_ctx: GuardContext = Depends(require_llm_quota("copilot")),
):
    """Anonymous -> 401, unverified -> 403, per-user/IP limit -> 429,
    AI budget exhausted -> 503 {"detail": "AI features are paused for today (budget reached)."}"""
    max_chars = ai_guard.io_caps()["max_prompt_chars"]
    if not (req.message or "").strip():
        raise HTTPException(status_code=422, detail="Message is empty.")
    if len(req.message) > max_chars:
        raise HTTPException(status_code=413, detail=f"Message too long (max {max_chars} characters).")
    return StreamingResponse(_stream(req, db, user, guard_ctx), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


@router.get("/context/{symbol}")
async def copilot_context(symbol: str, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    """Ticker context card (quote, key stats, forecast range, latest statement, top news).
    Built from the same cached pack the answer uses; no LLM / embedding call."""
    from app.services.copilot.context_pack import build_pack
    from app.services.copilot.resolver import TickerResolver, normalize_symbol
    from app.services.copilot.sources import LiveSources
    resolver = TickerResolver(db)
    row = await asyncio.to_thread(resolver.lookup, symbol)
    if row is None:
        raise HTTPException(status_code=404, detail=f"{normalize_symbol(symbol)} is not in our symbol universe")
    rt = resolver._make(row, normalize_symbol(symbol), "explicit")
    pack = await build_pack(rt, LiveSources())
    return pack.summary()


@router.get("/usage")
def copilot_usage(db: Session = Depends(get_db), current_user: User = Depends(require_auth)):
    """Per-user AI usage for today (legacy shape + the guard's fields)."""
    tier = resolve_tier(db, current_user)
    from app.services.account_controls import get_controls
    _c = get_controls(db, current_user.id)
    u = ai_guard.usage_summary(current_user.id, tier, (_c.ai_quota_override or None) if _c is not None else None)
    g = ai_guard.global_summary()
    return {
        "today_requests": u["requests_used"],
        "today_input_tokens": u["input_tokens"],
        "today_output_tokens": u["output_tokens"],
        "today_cost_usd": u["cost_usd"],
        "daily_budget_usd": g["daily_budget_usd"],
        "budget_remaining_usd": round(max(0.0, g["daily_budget_usd"] - g["today_spent_usd"]), 4),
        "budget_ok": not u["paused"] and (u["requests_limit"] < 0 or u["requests_remaining"] > 0),
        "is_pro": tier in ("pro", "admin"),
        "free_limit": u["requests_limit"],
        "free_remaining": u["requests_remaining"],
        "tier": tier,
        "paused": u["paused"],
        "paused_message": u["paused_message"],
        "tokens_limit": u["tokens_limit"],
        "tokens_remaining": u["tokens_remaining"],
    }


@router.get("/llm-status")
def llm_status(user: User = Depends(require_auth)):
    from app.services.agentic.bedrock_client import (BEDROCK_HAIKU_MODEL, copilot_llm_candidates,
                                                     embedding_spec, rerank_configured)
    chain = [{"provider": c.provider, "model": c.model} for c in copilot_llm_candidates()]
    return {"answer_chain": chain, "active_provider": chain[0]["provider"] if chain else "none",
            "active_model": chain[0]["model"] if chain else "No LLM provider configured",
            "helper_model": BEDROCK_HAIKU_MODEL, "embedding": embedding_spec().key,
            "rerank": rerank_configured()}


def _require_admin(user: User = Depends(require_auth)) -> User:
    if not is_admin_user(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


class IngestRequest(BaseModel):
    tickers: List[str] = Field(default_factory=list, max_length=100)


@router.post("/ingest")
def queue_ingestion(body: IngestRequest, _user: User = Depends(_require_admin)):
    """Queue tickers for the news-worker's SEC refresh (runs there, never in the API)."""
    from app.services.copilot.resolver import normalize_symbol
    from app.services.copilot.viewed import QUEUE_KEY, _client
    c = _client()
    if c is None:
        raise HTTPException(status_code=503, detail="Redis unavailable")
    tickers = [normalize_symbol(t) for t in body.tickers if t.strip()]
    if tickers:
        c.sadd(QUEUE_KEY, *tickers)
    return {"status": "queued", "tickers": tickers}


@router.get("/ingest/status")
def ingestion_status(_user: User = Depends(_require_admin)):
    from app.services.copilot.sec_refresh import STATUS_KEY
    from app.services.copilot.viewed import _client
    c = _client()
    raw = c.get(STATUS_KEY) if c is not None else None
    return json.loads(raw) if raw else {"status": "never_run"}


@router.get("/health")
def health_check():
    checks: dict[str, str] = {}
    try:
        from app.services.copilot.sec_index import CHUNKS_COLLECTION, qdrant
        n = qdrant().count(CHUNKS_COLLECTION, exact=False).count
        checks["qdrant"] = f"ok ({n} chunks)"
    except Exception as e:
        checks["qdrant"] = f"error: {type(e).__name__}"
    try:
        from app.services.agentic.bedrock_client import embedding_spec, get_embedder
        get_embedder()
        checks["embedder"] = f"ok ({embedding_spec().key})"
    except Exception as e:
        checks["embedder"] = f"error: {e}"
    return {"healthy": all(v.startswith("ok") for v in checks.values()), "checks": checks}
