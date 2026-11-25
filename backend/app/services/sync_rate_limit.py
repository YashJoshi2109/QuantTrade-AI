"""
Per-IP rate limit for public single-ticker refresh ("sync") endpoints.

These endpoints are reachable without login (the UI's Sync/refresh actions
call them for signed-out visitors too) but each call fans out to paid or
quota-limited upstream data providers, so they get a much tighter budget than
the global RateLimitMiddleware. In-memory per process: good enough to blunt
abuse; not a substitute for an edge/WAF limit.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, status

SYNC_REQUESTS_PER_MINUTE = 20
_WINDOW_SECONDS = 60.0

_hits: Dict[str, Deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def sync_rate_limit(request: Request) -> None:
    """FastAPI dependency: 429 once an IP exceeds SYNC_REQUESTS_PER_MINUTE."""
    ip = _client_ip(request)
    now = time.monotonic()
    with _lock:
        q = _hits[ip]
        while q and q[0] <= now - _WINDOW_SECONDS:
            q.popleft()
        if len(q) >= SYNC_REQUESTS_PER_MINUTE:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many refresh requests. Please wait a minute and try again.",
                headers={"Retry-After": "60"},
            )
        q.append(now)
        if len(_hits) > 50_000:  # bound memory under IP-spray
            for k in [k for k, v in _hits.items() if not v or v[-1] <= now - _WINDOW_SECONDS]:
                _hits.pop(k, None)


def reset_sync_rate_limit() -> None:
    """Test helper."""
    with _lock:
        _hits.clear()
