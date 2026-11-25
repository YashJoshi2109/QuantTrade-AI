"""In-process stale-while-revalidate cache for slow / flaky upstreams.

Why: a slow upstream (Yahoo, FRED, ...) used to make every request wait for it,
so one bad minute upstream became minutes of 60s+ responses here. With this
cache a request:

* gets the cached value immediately while it is fresh;
* gets the last-good value immediately once it is stale, while ONE background
  refresh runs (concurrent callers share it - no thundering herd);
* only waits when nothing was ever cached, and then at most ``wait`` seconds.

A refresh whose result fails ``is_good`` (e.g. every quote came back "--") or
raises never replaces the last-good value.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class _Entry:
    value: Any
    stored_at: float  # time.monotonic()


class SWRCache:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._entries: Dict[str, _Entry] = {}
        self._inflight: Dict[str, asyncio.Task] = {}
        self._clock = clock

    def peek(self, key: str) -> Optional[Any]:
        entry = self._entries.get(key)
        return entry.value if entry else None

    def age(self, key: str) -> Optional[float]:
        entry = self._entries.get(key)
        return None if entry is None else self._clock() - entry.stored_at

    def put(self, key: str, value: Any) -> None:
        self._entries[key] = _Entry(value, self._clock())

    def clear(self) -> None:
        self._entries.clear()
        self._inflight.clear()

    def _refresh_task(
        self, key: str, fetch: Callable[[], Awaitable[Any]], is_good: Callable[[Any], bool]
    ) -> asyncio.Task:
        loop = asyncio.get_running_loop()
        task = self._inflight.get(key)
        # A task from another (closed) event loop - e.g. between test clients - is dead.
        if task is not None and not task.done() and task.get_loop() is loop:
            return task

        async def run() -> Any:
            try:
                value = await fetch()
                if is_good(value):
                    self.put(key, value)
                    return value
                logger.warning("swr_cache: refresh of %s returned unusable data; keeping last-good", key)
                stale = self._entries.get(key)
                return stale.value if stale else value
            finally:
                if self._inflight.get(key) is asyncio.current_task():
                    self._inflight.pop(key, None)

        task = loop.create_task(run())
        # Never let a failed background refresh log "exception was never retrieved".
        task.add_done_callback(lambda t: t.cancelled() or t.exception())
        self._inflight[key] = task
        return task

    async def get(
        self,
        key: str,
        fetch: Callable[[], Awaitable[Any]],
        *,
        fresh_for: float,
        wait: float,
        is_good: Callable[[Any], bool] = lambda v: v is not None,
    ) -> Any:
        """Return a value for ``key``; see module docstring for the policy.

        Raises ``asyncio.TimeoutError`` (or the fetch's exception) only when
        nothing has ever been cached for ``key``.
        """
        entry = self._entries.get(key)
        if entry is not None and self._clock() - entry.stored_at < fresh_for:
            return entry.value

        task = self._refresh_task(key, fetch, is_good)
        if entry is not None:
            return entry.value  # stale-while-revalidate

        # Cold: wait (bounded) for the shared refresh; shield so a caller timing
        # out does not cancel the refresh that will warm the cache for the next one.
        return await asyncio.wait_for(asyncio.shield(task), timeout=wait)
