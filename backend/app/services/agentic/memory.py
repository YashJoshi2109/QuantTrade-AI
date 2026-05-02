"""Redis sliding-window conversation memory.

Maintains last 8 turns verbatim.
After 8 turns: Claude Haiku summarizes oldest 4 into a 200-token summary.
Key: copilot:memory:{user_id}:{conversation_id}
TTL: 24 hours
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import redis.asyncio as aioredis

from app.config import settings
from app.services.agentic.bedrock_client import get_llm_haiku

logger = logging.getLogger(__name__)

MEMORY_TTL_SECONDS = 86400  # 24 hours
MAX_TURNS         = 8
COMPRESS_COUNT    = 4       # compress oldest N turns when limit reached

_COMPRESS_PROMPT = """\
Summarize the following conversation turns in 1-3 sentences (max 200 words).
Focus on: what the user was asking about, tickers/topics discussed, key insights given.

Turns:
{turns_text}

Summary:"""


@lru_cache(maxsize=1)
def _redis_client() -> aioredis.Redis:
    return aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2.0,
        socket_timeout=2.0,
    )


@dataclass
class ConversationMemory:
    turns:   list[dict[str, str]] = field(default_factory=list)
    summary: str = ""


def _memory_key(user_id: int, conversation_id: str) -> str:
    return f"copilot:memory:{user_id}:{conversation_id}"


async def load_memory(user_id: int, conversation_id: str) -> ConversationMemory:
    """Load conversation memory from Redis. Returns empty memory on cache miss."""
    client = _redis_client()
    try:
        raw = await client.get(_memory_key(user_id, conversation_id))
        if raw:
            data = json.loads(raw)
            return ConversationMemory(
                turns=data.get("turns", []),
                summary=data.get("summary", ""),
            )
    except Exception as exc:
        logger.warning("Memory load failed: %s", exc)
    return ConversationMemory()


async def save_turn(
    mem: ConversationMemory,
    role: str,
    content: str,
    user_id: int,
    conversation_id: str,
) -> None:
    """Append turn to memory, compress if over limit, persist to Redis."""
    mem.turns.append({"role": role, "content": content})

    if len(mem.turns) >= MAX_TURNS and role == "assistant":
        await _compress_oldest_turns(mem)

    client = _redis_client()
    try:
        payload = json.dumps({"turns": mem.turns, "summary": mem.summary})
        await client.setex(
            _memory_key(user_id, conversation_id),
            MEMORY_TTL_SECONDS,
            payload,
        )
    except Exception as exc:
        logger.warning("Memory save failed: %s", exc)


async def _compress_oldest_turns(mem: ConversationMemory) -> None:
    """Haiku summarizes oldest COMPRESS_COUNT turns; replaces them with summary."""
    if len(mem.turns) < COMPRESS_COUNT:
        return

    oldest = mem.turns[:COMPRESS_COUNT]
    mem.turns = mem.turns[COMPRESS_COUNT:]

    turns_text = "\n".join(
        f"{t['role'].upper()}: {t['content'][:300]}" for t in oldest
    )
    if mem.summary:
        turns_text = f"[Prior summary: {mem.summary}]\n\n" + turns_text

    try:
        llm = get_llm_haiku()
        resp = await llm.ainvoke([
            ("human", _COMPRESS_PROMPT.format(turns_text=turns_text))
        ])
        mem.summary = resp.content[:500]
        logger.debug("Compressed %d turns into summary", COMPRESS_COUNT)
    except Exception as exc:
        logger.warning("Memory compression failed: %s", exc)
        # Fallback: keep a crude summary
        mem.summary = f"[Prior conversation: {len(oldest)} turns about financial analysis]"


def format_history_for_llm(mem: ConversationMemory) -> str:
    """Format memory into a string for inclusion in the LLM system prompt."""
    parts = []
    if mem.summary:
        parts.append(f"[Conversation summary]\n{mem.summary}")
    for t in mem.turns[-MAX_TURNS:]:
        parts.append(f"{t['role'].upper()}: {t['content'][:400]}")
    return "\n\n".join(parts) if parts else ""
