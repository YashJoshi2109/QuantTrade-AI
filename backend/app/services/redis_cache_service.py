"""
Universal Redis Cache Service for QuantTrade-AI

Unified cache-aside pattern with pub/sub for WebSocket broadcasts.
Falls back to in-memory TTLCache when Redis is unavailable.

Usage:
    from app.services.redis_cache_service import cache_service

    # Get or fetch with caching
    data = await cache_service.get_or_fetch("qt:quote:AAPL", 60, fetch_fn)

    # Publish to WebSocket channels
    await cache_service.publish("qt:ws:ideas", payload)
"""
import json
import logging
from typing import Any, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)


class RedisCacheService:
    """Unified Redis + in-memory cache with pub/sub support."""

    def __init__(self):
        self._redis = None  # Set via init_redis()
        self._memory = None  # Lazy import of ttl_cache.cache

    def init_redis(self, redis_client) -> None:
        self._redis = redis_client

    @property
    def _fallback(self):
        if self._memory is None:
            from app.services.ttl_cache import cache
            self._memory = cache
        return self._memory

    @property
    def available(self) -> bool:
        return self._redis is not None

    async def get(self, key: str) -> Optional[Any]:
        """Get from Redis, fall back to in-memory."""
        if self._redis:
            try:
                raw = await self._redis.get(key)
                if raw is not None:
                    return json.loads(raw)
            except Exception as e:
                logger.debug(f"Redis get error: {e}")
        # Fallback
        return self._fallback.get(key)

    async def set(self, key: str, value: Any, ttl: int = 60) -> None:
        """Set in both Redis and in-memory cache."""
        serialized = json.dumps(value, default=str)
        if self._redis:
            try:
                await self._redis.setex(key, ttl, serialized)
            except Exception as e:
                logger.debug(f"Redis set error: {e}")
        self._fallback.set(key, value, ttl)

    async def get_or_fetch(
        self,
        key: str,
        ttl: int,
        fetch_fn: Callable[[], Coroutine],
    ) -> Any:
        """Cache-aside: return cached value or fetch, cache, and return."""
        cached = await self.get(key)
        if cached is not None:
            return cached
        result = await fetch_fn()
        if result is not None:
            await self.set(key, result, ttl)
        return result

    async def delete(self, key: str) -> None:
        if self._redis:
            try:
                await self._redis.delete(key)
            except Exception:
                pass
        self._fallback.delete(key)

    async def invalidate_pattern(self, pattern: str) -> int:
        """Delete all keys matching a pattern."""
        count = 0
        if self._redis:
            try:
                async for key in self._redis.scan_iter(match=pattern):
                    await self._redis.delete(key)
                    count += 1
            except Exception as e:
                logger.debug(f"Redis invalidate error: {e}")
        count += self._fallback.clear_prefix(pattern.replace("*", ""))
        return count

    async def publish(self, channel: str, data: Any) -> None:
        """Publish message to Redis pub/sub channel for WebSocket broadcast."""
        if self._redis:
            try:
                await self._redis.publish(channel, json.dumps(data, default=str))
            except Exception as e:
                logger.debug(f"Redis publish error: {e}")

    async def subscribe(self, channel: str):
        """Subscribe to a Redis pub/sub channel. Returns async generator."""
        if not self._redis:
            return
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(channel)
        return pubsub


# Singleton
cache_service = RedisCacheService()
