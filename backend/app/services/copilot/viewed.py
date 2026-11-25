"""Which tickers users actually look at (Research page views + copilot questions).

Redis sorted set ``copilot:viewed`` (member = ticker, score = last-view epoch).
The SEC refresh job indexes these plus the static universe.  Writes are
best-effort and never block a request.
"""
from __future__ import annotations

import logging
import time
from typing import List

logger = logging.getLogger(__name__)

KEY = "copilot:viewed"
QUEUE_KEY = "copilot:sec:queue"
MAX_TRACKED = 500


def _client():
    from app.services import ai_guard
    return ai_guard._redis_client()


def record_view(ticker: str) -> None:
    t = (ticker or "").upper().strip()
    if not t or len(t) > 10:
        return
    try:
        c = _client()
        if c is None:
            return
        c.zadd(KEY, {t: time.time()})
        if c.zcard(KEY) > MAX_TRACKED + 50:
            c.zremrangebyrank(KEY, 0, -MAX_TRACKED - 1)
    except Exception as e:
        logger.debug("record_view skipped: %s", e)


async def recent_views(redis, days: int = 14, limit: int = 100) -> List[str]:
    """Async read used by the worker (redis.asyncio client)."""
    if redis is None:
        return []
    since = time.time() - days * 86400
    try:
        rows = await redis.zrevrangebyscore(KEY, "+inf", since, start=0, num=limit)
        return [r.decode() if isinstance(r, bytes) else r for r in rows]
    except Exception as e:
        logger.warning("recent_views failed: %s", e)
        return []
