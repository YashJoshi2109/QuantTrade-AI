"""Per-conversation memory in Redis: last turns + the active tickers.

No LLM summarisation (v1 called Haiku after every 8 turns); older turns are
simply dropped — the active tickers are what follow-ups need.
Key copilot:memory:v2:{user_id}:{conversation_id}, TTL 24h.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List

logger = logging.getLogger(__name__)

TTL_S = 86400
MAX_TURNS = 8


@dataclass
class ConversationMemory:
    turns: List[Dict[str, str]] = field(default_factory=list)
    tickers: List[str] = field(default_factory=list)


@lru_cache(maxsize=1)
def _redis():
    import redis.asyncio as aioredis
    from app.config import settings
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True,
                             socket_connect_timeout=1.5, socket_timeout=1.5)


def _key(user_id: int, conversation_id: str) -> str:
    return f"copilot:memory:v2:{user_id}:{conversation_id}"


class RedisMemoryStore:
    async def load(self, user_id: int, conversation_id: str) -> ConversationMemory:
        try:
            raw = await _redis().get(_key(user_id, conversation_id))
            if raw:
                d = json.loads(raw)
                return ConversationMemory(turns=d.get("turns", []), tickers=d.get("tickers", []))
        except Exception as e:
            logger.warning("memory load failed: %s", e)
        return ConversationMemory()

    async def save(self, user_id: int, conversation_id: str, mem: ConversationMemory) -> None:
        mem.turns = mem.turns[-MAX_TURNS:]
        try:
            await _redis().setex(_key(user_id, conversation_id), TTL_S,
                                 json.dumps({"turns": mem.turns, "tickers": mem.tickers[:3]}))
        except Exception as e:
            logger.warning("memory save failed: %s", e)


class InMemoryStore:
    def __init__(self) -> None:
        self.data: Dict[str, ConversationMemory] = {}

    async def load(self, user_id: int, conversation_id: str) -> ConversationMemory:
        m = self.data.get(_key(user_id, conversation_id))
        return ConversationMemory(list(m.turns), list(m.tickers)) if m else ConversationMemory()

    async def save(self, user_id: int, conversation_id: str, mem: ConversationMemory) -> None:
        self.data[_key(user_id, conversation_id)] = ConversationMemory(mem.turns[-MAX_TURNS:], mem.tickers[:3])
