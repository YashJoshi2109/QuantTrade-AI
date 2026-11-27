"""Bounded on-demand sync of fundamentals / SEC statements for the copilot.

The research page lazily syncs a ticker's fundamentals (finviz -> yfinance)
and SEC XBRL statements when it is viewed; the copilot used to read only the
DB, so a mega-cap nobody had opened yet (AMZN in the prod evaluation) had
"no fundamentals" and "no SEC financial statements".  Now a missing section
triggers the same sync, then the pack retries the DB read once.

Rules (see PR #98 for the shared-Session bug class):
  * the sync never runs on the event loop: it is submitted to a small
    dedicated thread pool;
  * every sync opens and closes its OWN SessionLocal session in the worker
    thread — the request's Session is never passed in;
  * the caller waits at most a time budget (COPILOT_SYNC_BUDGET_S); a sync
    that takes longer keeps running in the background and the next question
    gets the data;
  * single flight per (kind, ticker), plus a cool-down after each attempt so
    a ticker the providers cannot serve is not re-fetched on every question.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

SYNC_BUDGET_S = float(os.getenv("COPILOT_SYNC_BUDGET_S", "8"))
COOLDOWN_S = float(os.getenv("COPILOT_SYNC_COOLDOWN_S", "1800"))

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="copilot-sync")
_lock = threading.Lock()
_inflight: Dict[Tuple[str, str], Future] = {}
_last_attempt: Dict[Tuple[str, str], float] = {}


def _sync_fundamentals(ticker: str) -> str:
    from app.db import database as _database
    from app.services.enhanced_data_fetcher import EnhancedDataFetcher
    if _database.SessionLocal is None:
        return "error: database not configured"
    db = _database.SessionLocal()          # own session, owned by this worker thread
    try:
        EnhancedDataFetcher.sync_fundamentals(ticker, db)
        return "ok"
    finally:
        db.close()


def _sync_statements(ticker: str) -> str:
    # The research page's single-flight EDGAR sync: own session per run,
    # one sync per ticker at a time, skipped when one just succeeded.
    from app.api.research import _sync_once
    res = _sync_once(ticker, 0.0)
    return str(res.get("status") or "unknown")


SYNCERS: Dict[str, Callable[[str], str]] = {
    "fundamentals": _sync_fundamentals,
    "statements": _sync_statements,
}


def _run(kind: str, ticker: str) -> str:
    try:
        return SYNCERS[kind](ticker)
    except Exception as e:  # provider/parse failures must not escape the worker
        logger.warning("copilot %s sync failed for %s: %s", kind, ticker, e)
        return f"error: {type(e).__name__}"


def _submit(kind: str, ticker: str) -> Optional[Future]:
    key = (kind, ticker)
    with _lock:
        fut = _inflight.get(key)
        if fut is not None and not fut.done():
            return fut
        if time.monotonic() - _last_attempt.get(key, -1e18) < COOLDOWN_S:
            return None
        _last_attempt[key] = time.monotonic()
        fut = _pool.submit(_run, kind, ticker)
        _inflight[key] = fut
    # outside the lock: a sync that already finished runs the callback inline
    fut.add_done_callback(lambda f, key=key: _forget(key, f))
    return fut


def _forget(key: Tuple[str, str], fut: Future) -> None:
    with _lock:
        if _inflight.get(key) is fut:
            _inflight.pop(key, None)


async def ensure(kind: str, ticker: str, budget: Optional[float] = None) -> str:
    """Trigger (or join) the sync for one section and wait up to ``budget``.

    Returns "ok" / the syncer's status, "pending" (still running in the
    background), "skipped" (attempted recently) or "error: ..."."""
    if kind not in SYNCERS:
        raise ValueError(kind)
    fut = _submit(kind, ticker.upper())
    if fut is None:
        return "skipped"
    try:
        # shield: a timeout abandons the wait, never the sync
        return await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(fut)),
                                      SYNC_BUDGET_S if budget is None else budget)
    except asyncio.TimeoutError:
        return "pending"


def reset() -> None:
    """Forget cool-downs (tests)."""
    with _lock:
        _last_attempt.clear()
        _inflight.clear()
