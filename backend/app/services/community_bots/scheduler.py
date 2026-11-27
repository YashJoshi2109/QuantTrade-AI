"""APScheduler wiring: one cron job per (bot, slot), in America/New_York.

Jobs run in the scheduler's thread pool; all bot coroutines run on ONE
dedicated event loop guarded by a lock, so bots execute one at a time and
never share the API's request loop. The loop is created lazily and reused
(services cache loop-bound clients).
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import List, Optional

from app.services.community_bots import registry

logger = logging.getLogger(__name__)

TIMEZONE = "America/New_York"
_loop: Optional[asyncio.AbstractEventLoop] = None
_lock = threading.Lock()
_hub = None


def _get_hub():
    global _hub
    if _hub is None:
        from app.services.community_bots.data import LiveDataHub
        _hub = LiveDataHub()
    return _hub


def run_scheduled(slug: str, slot: str, trigger: str = "schedule"):
    """Blocking entry point for a scheduler thread."""
    global _loop
    from app.services.community_bots.runner import run_bot
    with _lock:
        if _loop is None or _loop.is_closed():
            _loop = asyncio.new_event_loop()
        try:
            return _loop.run_until_complete(run_bot(slug, slot, hub=_get_hub(), trigger=trigger))
        except Exception as e:  # noqa: BLE001 - a bot must never take the scheduler down
            logger.exception("bots: scheduled run %s/%s crashed: %s", slug, slot, e)
            return None


def job_id(slug: str, slot: str) -> str:
    return f"community_bot:{slug}:{slot}"


def register_bot_jobs(sched) -> List[str]:
    """Add every (bot, slot) cron job to an APScheduler instance. Jobs are
    registered even when bots are disabled: the kill switches are checked at
    run time, so flipping an env var / admin flag needs no restart."""
    from apscheduler.triggers.cron import CronTrigger

    ids = []
    for spec in registry.all_specs():
        for slot in spec.slots:
            jid = job_id(spec.slug, slot.name)
            sched.add_job(
                run_scheduled,
                CronTrigger(day_of_week=slot.day_of_week, hour=slot.hour, minute=slot.minute, timezone=TIMEZONE),
                args=[spec.slug, slot.name],
                id=jid,
                replace_existing=True,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=900,
            )
            ids.append(jid)
    return ids
