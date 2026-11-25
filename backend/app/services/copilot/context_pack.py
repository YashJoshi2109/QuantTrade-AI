"""Build a TickerContextPack: all sources in parallel, each with its own timeout,
the question-independent part cached in Redis for COPILOT_PACK_TTL_S (60s)."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Awaitable, Callable, Optional

from app.services.copilot.models import Identity, TickerContextPack
from app.services.copilot.resolver import ResolvedTicker

logger = logging.getLogger(__name__)

PACK_TTL_S = int(os.getenv("COPILOT_PACK_TTL_S", "60"))
SOURCE_TIMEOUT_S = float(os.getenv("COPILOT_SOURCE_TIMEOUT_S", "2.5"))
FILING_TIMEOUT_S = float(os.getenv("COPILOT_FILING_TIMEOUT_S", "3.5"))
_CACHE_VERSION = "v2"

_mem_cache: dict[str, tuple[float, dict]] = {}


async def _cache_get(key: str) -> Optional[dict]:
    try:
        from app.services.redis_cache_service import cache_service
        hit = await cache_service.get(key)
        if hit:
            return hit
    except Exception:
        pass
    ent = _mem_cache.get(key)
    return ent[1] if ent and ent[0] > time.monotonic() else None


async def _cache_set(key: str, value: dict, ttl: int) -> None:
    _mem_cache[key] = (time.monotonic() + ttl, value)
    if len(_mem_cache) > 256:
        for k in sorted(_mem_cache, key=lambda k: _mem_cache[k][0])[:64]:
            _mem_cache.pop(k, None)
    try:
        from app.services.redis_cache_service import cache_service
        await cache_service.set(key, value, ttl=ttl)
    except Exception:
        pass


async def _timed(name: str, coro: Awaitable[Any], timeout: float, pack: TickerContextPack) -> Any:
    t0 = time.perf_counter()
    try:
        return await asyncio.wait_for(coro, timeout)
    except asyncio.TimeoutError:
        pack.errors[name] = f"timed out after {timeout:.1f}s"
    except Exception as e:  # one broken source must not sink the pack
        logger.warning("pack source %s failed for %s: %s", name, pack.ticker, e)
        pack.errors[name] = f"unavailable ({type(e).__name__})"
    finally:
        pack.timings_ms[name] = int((time.perf_counter() - t0) * 1000)
    return None


def _cache_key(ticker: str) -> str:
    return f"copilot:pack:{_CACHE_VERSION}:{ticker}"


async def build_pack(rt: ResolvedTicker, sources, *, filings_query: Optional[str] = None,
                     use_cache: bool = True) -> TickerContextPack:
    """``filings_query``: when set (question needs filing text), the ticker-scoped
    filing search runs concurrently with the other sources."""
    ticker = rt.symbol
    pack: Optional[TickerContextPack] = None
    holder = TickerContextPack(ticker=ticker)          # collects filing errors/timings
    filings_task = None
    if filings_query and rt.asset_type == "equity":
        filings_task = asyncio.create_task(_timed(
            "filings", sources.filings(ticker, filings_query, limit=4), FILING_TIMEOUT_S, holder))
    if use_cache:
        hit = await _cache_get(_cache_key(ticker))
        if hit:
            try:
                pack = TickerContextPack.model_validate(hit)
                pack.cached = True
                pack.timings_ms = {"cache": 0}
            except Exception:
                pack = None

    if pack is None:
        pack = TickerContextPack(ticker=ticker, name=rt.name, asset_type=rt.asset_type,
                                 identity=rt.identity or Identity())
        is_company = rt.asset_type == "equity"
        jobs: dict[str, Callable[[], Awaitable[Any]]] = {
            "quote": lambda: sources.quote(ticker),
            "fundamentals": lambda: sources.fundamentals(ticker),
            "forecast": lambda: sources.forecast(ticker),
            "technicals": lambda: sources.technicals(ticker),
            "news": lambda: sources.news(ticker),
        }
        if is_company:
            jobs["statements"] = lambda: sources.statements(ticker)
        results = await asyncio.gather(*[_timed(n, f(), SOURCE_TIMEOUT_S, pack) for n, f in jobs.items()])
        r = dict(zip(jobs, results))
        pack.quote = r.get("quote")
        pack.fundamentals = r.get("fundamentals")
        pack.forecast = r.get("forecast")
        pack.technicals = r.get("technicals")
        pack.news = r.get("news") or []
        pack.statements = r.get("statements") or []
        for name in ("quote", "fundamentals", "forecast", "technicals"):
            if r.get(name) is None and name not in pack.errors:
                pack.errors[name] = "not in data"
        if not is_company:
            pack.errors["statements"] = f"not applicable ({rt.asset_type}: no SEC company financials)"
        if pack.fundamentals and not pack.name:
            pack.name = pack.fundamentals.company_name
        if use_cache:
            await _cache_set(_cache_key(ticker), pack.model_dump(exclude={"filings", "cached"}), PACK_TTL_S)
    else:
        pack.identity = rt.identity or pack.identity

    # A reassigned ticker's live quote belongs to a different company now.
    if pack.identity.status in ("changed", "mismatch") and pack.quote is not None:
        pack.quote = None
        pack.errors["quote"] = "withheld: ticker identity changed (" + (pack.identity.note or "") + ")"

    if filings_task is not None:
        pack.filings = (await filings_task) or []
        pack.errors.update(holder.errors)
        pack.timings_ms.update(holder.timings_ms)
        if not pack.filings and "filings" not in pack.errors:
            pack.errors["filings"] = "no indexed filing passages matched"
    return pack
