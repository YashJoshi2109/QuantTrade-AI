"""Is the news-intel worker alive?  Shared by /news/health and the status page.

The worker (separate container) writes a status snapshot to Redis every 15 s
with a 90 s TTL.  ``worker_alive`` used to be ``bool(snapshot)``: one failed
Redis read (a dropped pooled connection) or an exception further down the same
try-block turned it false while the worker was ingesting fine.  Now:

  * the Redis read is retried once and is independent of the other reads;
  * a snapshot counts only if its ``ts`` is younger than HEARTBEAT_MAX_AGE_S;
  * when the heartbeat is missing, recent ingestion in Postgres (a new item in
    the last INGEST_ALIVE_S) still proves the worker is alive.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

HEARTBEAT_MAX_AGE_S = 90
INGEST_ALIVE_S = 15 * 60
INGEST_STALE_S = 6 * 3600


def _parse_ts(v: Any) -> Optional[float]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


async def read_heartbeat(redis) -> Optional[Dict[str, Any]]:
    from app.services.news_intel.pipeline import STATUS_KEY
    if redis is None:
        return None
    for attempt in range(2):
        try:
            raw = await redis.get(STATUS_KEY)
            return json.loads(raw) if raw else None
        except ValueError:
            return None
        except Exception as e:
            if attempt:
                logger.debug("news worker heartbeat read failed: %s", e)
                return None
            await asyncio.sleep(0.05)
    return None


def _ingest_stats() -> Dict[str, Any]:
    from app.db import database
    if database.SessionLocal is None:
        return {}
    from sqlalchemy import func
    from app.models.news_item import NewsItem
    db = database.SessionLocal()
    try:
        newest = db.query(func.max(NewsItem.ingested_at)).scalar()
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        n1h = db.query(func.count(NewsItem.id)).filter(NewsItem.ingested_at >= since).scalar()
        return {"newest": newest, "items_1h": int(n1h or 0)}
    finally:
        db.close()


def alive(heartbeat: Optional[Dict[str, Any]], last_ingest_ts: Optional[float], now: float) -> bool:
    hb_ts = _parse_ts((heartbeat or {}).get("ts"))
    if hb_ts is not None and now - hb_ts < HEARTBEAT_MAX_AGE_S:
        return True
    return last_ingest_ts is not None and now - last_ingest_ts < INGEST_ALIVE_S


async def check(redis, now: Optional[float] = None, *, with_db: bool = True) -> Dict[str, Any]:
    now = now if now is not None else time.time()
    hb = await read_heartbeat(redis)
    stats: Dict[str, Any] = {}
    if with_db:
        try:
            stats = await asyncio.to_thread(_ingest_stats)
        except Exception as e:
            logger.debug("news ingest stats failed: %s", e)
    newest = stats.get("newest")
    if newest is not None and newest.tzinfo is None:
        newest = newest.replace(tzinfo=timezone.utc)
    last_ingest_ts = newest.timestamp() if newest else None
    hb_ts = _parse_ts((hb or {}).get("ts"))
    hb_age = None if hb_ts is None else now - hb_ts
    ingest_age = None if last_ingest_ts is None else now - last_ingest_ts
    is_alive = alive(hb, last_ingest_ts, now)
    fresh_hb = hb_age is not None and hb_age < HEARTBEAT_MAX_AGE_S

    from app.services.system_status import DEGRADED, DOWN, OK, fmt_age
    if not is_alive:
        status = DOWN
        detail = ("No heartbeat from the news worker" + (f" for {fmt_age(hb_age)}" if hb_age else "")
                  + f" and no new item for {fmt_age(ingest_age)}")
    elif not fresh_hb:
        status = DEGRADED
        detail = f"Heartbeat missing, but items are still arriving (newest {fmt_age(ingest_age)} ago)"
    elif ingest_age is None or ingest_age > INGEST_STALE_S:
        status = DEGRADED
        detail = f"Worker is up but nothing new was ingested for {fmt_age(ingest_age)}"
    else:
        status = OK
        detail = f"Heartbeat {fmt_age(hb_age)} ago · newest item {fmt_age(ingest_age)} ago"
    if "items_1h" in stats:
        detail += f" · {stats['items_1h']} items in the last hour"
    if hb and hb.get("queue_depth") is not None:
        detail += f" · queue {hb.get('queue_depth')}"
    return {"status": status, "detail": detail, "worker_alive": is_alive,
            "heartbeat": hb, "heartbeat_age_s": None if hb_age is None else int(hb_age),
            "last_ingest_ts": last_ingest_ts,
            "last_ingest_age_s": None if ingest_age is None else int(ingest_age),
            "items_1h": stats.get("items_1h"), "is_leader": bool((hb or {}).get("is_leader"))}
