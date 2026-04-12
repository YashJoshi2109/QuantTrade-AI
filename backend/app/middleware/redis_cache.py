"""
Redis API Response Cache Middleware

Caches GET responses in Redis with market-hours-aware TTLs.
Skips: POST/PUT/DELETE, authenticated requests, streaming responses.
"""

import hashlib
import json
import logging
import time
from datetime import datetime
from typing import Optional

import redis.asyncio as aioredis
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

logger = logging.getLogger(__name__)

# ── TTL Configuration ─────────────────────────────────────────────────────────

# Path prefix → base TTL in seconds (during market hours)
CACHE_PATHS: dict[str, int] = {
    "/api/v1/quotes": 30,
    "/api/v1/enhanced/quote": 30,
    "/api/v1/market/ipo-calendar": 1800,
    "/api/v1/market/": 60,
    "/api/v1/model-index/batch": 120,
    "/api/v1/model-index/indices": 120,
    "/api/v1/model-index/regime": 60,
    "/api/v1/enhanced/market-indices": 30,
    "/api/v1/enhanced/news/": 120,
    "/api/v1/enhanced/api-stats": 30,
    "/api/v1/enhanced/prediction-alerts": 60,
    "/api/v1/monitor/": 120,
    "/api/v1/ideas/trending": 120,
}

# Never cache these
SKIP_PREFIXES = (
    "/api/v1/auth/",
    "/api/v1/billing/",
    "/api/v1/copilot/",
    "/api/v1/conversations",
    "/api/v1/watchlist",
    "/api/v1/chat",
    "/health",
)


def _get_market_status() -> str:
    """Determine US market status: open, extended, closed."""
    from zoneinfo import ZoneInfo

    et_now = datetime.now(ZoneInfo("America/New_York"))
    day = et_now.weekday()  # 0=Mon, 6=Sun
    if day >= 5:
        return "closed"

    et_minutes = et_now.hour * 60 + et_now.minute
    if 570 <= et_minutes < 960:  # 9:30 AM - 4:00 PM ET
        return "open"
    if (240 <= et_minutes < 570) or (960 <= et_minutes < 1200):  # 4 AM-9:30 AM, 4 PM-8 PM ET
        return "extended"
    return "closed"


def _get_ttl(path: str) -> Optional[int]:
    """Get cache TTL for a path, adjusted by market status."""
    base_ttl = None
    for prefix, ttl in CACHE_PATHS.items():
        if path.startswith(prefix):
            base_ttl = ttl
            break

    if base_ttl is None:
        return None

    status = _get_market_status()
    if status == "open":
        return base_ttl
    elif status == "extended":
        return min(base_ttl * 3, 600)
    else:  # closed
        return min(base_ttl * 5, 1800)


def _cache_key(path: str, query: str) -> str:
    """Generate a deterministic cache key."""
    if query:
        # Sort query params for consistency
        params = sorted(query.split("&"))
        qhash = hashlib.md5("&".join(params).encode()).hexdigest()[:12]
        return f"api_cache:{path}:{qhash}"
    return f"api_cache:{path}"


class RedisCacheMiddleware(BaseHTTPMiddleware):
    """Cache GET API responses in Redis."""

    def __init__(self, app, redis_client: aioredis.Redis):
        super().__init__(app)
        self.redis = redis_client

    async def dispatch(self, request: Request, call_next):
        # Only cache GET requests
        if request.method != "GET":
            return await call_next(request)

        path = request.url.path

        # Skip uncacheable paths
        if any(path.startswith(p) for p in SKIP_PREFIXES):
            return await call_next(request)

        # Skip authenticated requests
        if request.headers.get("authorization"):
            return await call_next(request)

        # Check if path is cacheable
        ttl = _get_ttl(path)
        if ttl is None:
            return await call_next(request)

        key = _cache_key(path, request.url.query or "")

        # Try cache
        try:
            cached = await self.redis.get(key)
            if cached:
                data = json.loads(cached)
                return JSONResponse(
                    content=data,
                    headers={
                        "X-Cache": "HIT",
                        "X-Cache-Key": key,
                        "Cache-Control": f"public, max-age={ttl}, stale-while-revalidate={ttl * 2}",
                    },
                )
        except Exception as e:
            logger.debug(f"Redis cache read error: {e}")

        # Cache miss — call endpoint
        response = await call_next(request)

        # Only cache successful JSON responses
        if response.status_code == 200:
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type:
                try:
                    # Read response body
                    body = b""
                    async for chunk in response.body_iterator:
                        body += chunk

                    # Store in Redis
                    await self.redis.setex(key, ttl, body)

                    # Return new response with cache headers
                    return Response(
                        content=body,
                        status_code=200,
                        headers={
                            **dict(response.headers),
                            "X-Cache": "MISS",
                            "Cache-Control": f"public, max-age={ttl}, stale-while-revalidate={ttl * 2}",
                        },
                        media_type="application/json",
                    )
                except Exception as e:
                    logger.debug(f"Redis cache write error: {e}")
                    # Return original body if caching failed
                    return Response(
                        content=body,
                        status_code=200,
                        headers=dict(response.headers),
                        media_type="application/json",
                    )

        return response
