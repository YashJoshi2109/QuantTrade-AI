"""RedisCacheService.get_or_fetch coalesces concurrent misses (no cache stampede)."""
import asyncio

import pytest

from app.services.redis_cache_service import RedisCacheService


class _Mem:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl):
        self.d[k] = v

    def delete(self, k):
        self.d.pop(k, None)


def _svc():
    s = RedisCacheService()
    s._memory = _Mem()
    return s


async def test_concurrent_misses_share_one_fetch():
    s, calls = _svc(), []

    async def fetch():
        calls.append(1)
        await asyncio.sleep(0.05)
        return {"price": 1.0}

    out = await asyncio.gather(*[s.get_or_fetch("k", 60, fetch) for _ in range(20)])
    assert len(calls) == 1
    assert all(o == {"price": 1.0} for o in out)
    assert s._inflight == {}
    # later call is a plain cache hit
    assert await s.get_or_fetch("k", 60, fetch) == {"price": 1.0} and len(calls) == 1


async def test_errors_reach_every_waiter_and_next_call_retries():
    s, calls = _svc(), []

    async def boom():
        calls.append(1)
        await asyncio.sleep(0.01)
        raise RuntimeError("provider down")

    res = await asyncio.gather(*[s.get_or_fetch("k", 60, boom) for _ in range(5)], return_exceptions=True)
    assert len(calls) == 1 and all(isinstance(r, RuntimeError) for r in res)

    async def ok():
        return 7

    assert await s.get_or_fetch("k", 60, ok) == 7


async def test_none_is_not_cached_and_cancelled_waiter_keeps_fetch_alive():
    s, calls = _svc(), []

    async def slow():
        calls.append(1)
        await asyncio.sleep(0.05)
        return 3

    first = asyncio.ensure_future(s.get_or_fetch("k", 60, slow))
    second = asyncio.ensure_future(s.get_or_fetch("k", 60, slow))
    await asyncio.sleep(0.01)
    first.cancel()
    assert await second == 3 and len(calls) == 1
    with pytest.raises(asyncio.CancelledError):
        await first

    async def none():
        return None

    assert await s.get_or_fetch("n", 60, none) is None
    assert s._memory.get("n") is None
