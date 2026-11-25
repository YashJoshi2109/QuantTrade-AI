"""
AI notes (slow path): Claude Haiku "why it matters" for the highest-impact
clusters, under a hard daily cap (NEWS_AI_DAILY_LIMIT, default 50).

- The cap is reserved BEFORE each call (Redis INCR on a per-UTC-day key, or an
  in-process counter without Redis) so failures and retries also count.
- Notes are stored on the cluster row and never regenerated (cache per cluster).
- Runs in its own loop; ingestion never waits on it.

Provider: Anthropic API when ANTHROPIC_API_KEY is set (model NEWS_AI_MODEL,
default claude-haiku-4-5), else get_llm_haiku() (Bedrock/OpenAI chain).
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

DIRECTIONS = {"bullish", "bearish", "neutral", "mixed"}
HORIZONS = {"intraday", "days", "weeks"}

SYSTEM_PROMPT = (
    "You are a sell-side markets analyst writing one-line notes for traders. "
    "Given a news headline cluster, explain why it matters for markets. "
    "Be specific and factual; do not invent numbers not in the input. "
    "Reply with ONLY a JSON object, no prose, with keys: "
    '"why_it_matters" (1-2 sentences, <= 300 characters), '
    '"direction" (one of "bullish","bearish","neutral","mixed" for the affected tickers), '
    '"horizon" (one of "intraday","days","weeks"), '
    '"affected_tickers" (array of up to 6 US ticker symbols, may be empty).'
)


def daily_limit() -> int:
    try:
        return max(0, int(os.environ.get("NEWS_AI_DAILY_LIMIT", "50")))
    except ValueError:
        return 50


class DailyCap:
    """Hard per-UTC-day budget. Redis-backed when available (shared across
    processes and restarts), in-memory otherwise."""

    def __init__(self, limit: Optional[int] = None, redis=None, prefix: str = "qt:news:ai:count"):
        self.limit = daily_limit() if limit is None else limit
        self.redis = redis
        self.prefix = prefix
        self._mem: Dict[str, int] = {}

    def _key(self, now: Optional[datetime] = None) -> str:
        return f"{self.prefix}:{(now or datetime.now(timezone.utc)).strftime('%Y%m%d')}"

    async def used(self, now: Optional[datetime] = None) -> int:
        key = self._key(now)
        if self.redis is not None:
            try:
                v = await self.redis.get(key)
                return int(v or 0)
            except Exception:
                pass
        return self._mem.get(key, 0)

    async def try_acquire(self, now: Optional[datetime] = None) -> bool:
        if self.limit <= 0:
            return False
        key = self._key(now)
        if self.redis is not None:
            try:
                n = int(await self.redis.incr(key))
                if n == 1:
                    await self.redis.expire(key, 2 * 86400)
                return n <= self.limit
            except Exception as e:
                logger.debug("AI cap redis error, using memory: %s", e)
        n = self._mem.get(key, 0) + 1
        self._mem = {key: n}  # drop previous days
        return n <= self.limit


def build_prompt(item: Dict[str, Any]) -> str:
    sources = ", ".join(sorted({s.get("source", "") for s in (item.get("sources") or []) if s.get("source")}))
    return json.dumps({
        "headline": item.get("title"),
        "summary": (item.get("summary") or "")[:600],
        "source": item.get("source"),
        "other_sources": sources[:300],
        "sources_count": item.get("sources_count"),
        "tickers": item.get("tickers") or [],
        "category": item.get("primary_category"),
        "model_sentiment": (item.get("sentiment") or {}).get("label"),
        "published_at": item.get("published_at"),
    }, ensure_ascii=False)


_JSON_OBJ = re.compile(r"\{.*\}", re.S)


def parse_note(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    m = _JSON_OBJ.search(text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return None
    why = str(data.get("why_it_matters") or "").strip()
    if not why:
        return None
    direction = str(data.get("direction") or "neutral").lower().strip()
    horizon = str(data.get("horizon") or "days").lower().strip()
    tickers = data.get("affected_tickers") or []
    if not isinstance(tickers, list):
        tickers = []
    tickers = [str(t).upper().strip().lstrip("$") for t in tickers
               if isinstance(t, str) and re.fullmatch(r"\$?[A-Za-z]{1,5}(?:[.-][A-Za-z])?", t.strip())][:6]
    return {
        "why_it_matters": why[:400],
        "direction": direction if direction in DIRECTIONS else "neutral",
        "horizon": horizon if horizon in HORIZONS else "days",
        "affected_tickers": tickers,
    }


def _call_llm(prompt: str) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        try:
            from app.config import settings
            key = settings.ANTHROPIC_API_KEY
        except Exception:
            key = None
    if key:
        import anthropic

        client = anthropic.Anthropic(api_key=key, timeout=30.0, max_retries=1)
        msg = client.messages.create(
            model=os.environ.get("NEWS_AI_MODEL", "claude-haiku-4-5"),
            max_tokens=300,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(getattr(b, "text", "") for b in msg.content)
    from app.services.agentic.bedrock_client import get_llm_haiku

    llm = get_llm_haiku()
    resp = llm.invoke([("system", SYSTEM_PROMPT), ("human", prompt)])
    content = getattr(resp, "content", resp)
    if isinstance(content, list):
        content = "".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content)
    return str(content)


def generate_note(item: Dict[str, Any], llm_call=None) -> Optional[Dict[str, Any]]:
    """Blocking: call the LLM and return a validated note (or None)."""
    call = llm_call or _call_llm
    try:
        text = call(build_prompt(item))
    except Exception as e:
        logger.warning("AI note failed for %s: %s", item.get("cluster_id"), type(e).__name__)
        return None
    return parse_note(text)
