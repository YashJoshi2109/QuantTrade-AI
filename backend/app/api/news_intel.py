"""
News intelligence API (contract shared with the frontend — do not change shapes).

  GET /api/v1/news/feed        clustered, classified news feed
  GET /api/v1/news/categories  category taxonomy
  GET /api/v1/news/health      per-source freshness + pipeline latency

Mounted BEFORE app.api.news so `/news/feed` is not captured by `/news/{symbol}`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.news_intel import store
from app.services.news_intel.categories import CATEGORIES, CATEGORY_KEYS

logger = logging.getLogger(__name__)

router = APIRouter()

_TICKER_RX = re.compile(r"^[A-Z0-9]{1,6}(?:[.\-][A-Z0-9]{1,2})?$")
DEFAULT_WINDOW = timedelta(hours=24)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/news/feed")
def news_feed(
    category: Optional[str] = Query(None, description="Category key, see /news/categories"),
    ticker: Optional[str] = Query(None, max_length=12),
    sentiment: Optional[str] = Query(None, description="bullish | bearish | neutral"),
    sort: str = Query("latest", description="latest | impact | bullish | bearish"),
    since: Optional[datetime] = Query(None, description="ISO-8601; only items published at/after this"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    category = (category or "").strip().lower() or None
    sentiment = (sentiment or "").strip().lower() or None
    sort = (sort or "latest").strip().lower()
    ticker = (ticker or "").strip().upper().lstrip("$") or None
    if category and category not in CATEGORY_KEYS:
        raise HTTPException(status_code=400, detail=f"unknown category '{category}'")
    if sentiment and sentiment not in store.SENTIMENTS:
        raise HTTPException(status_code=400, detail="sentiment must be bullish, bearish or neutral")
    if sort not in store.SORTS:
        raise HTTPException(status_code=400, detail="sort must be latest, impact, bullish or bearish")
    if ticker and not _TICKER_RX.match(ticker):
        raise HTTPException(status_code=400, detail="invalid ticker")

    now = datetime.now(timezone.utc)
    since = _aware(since)
    # Ranking sorts without an explicit window look at the last 24h, otherwise
    # a 2-week-old blockbuster would pin the top of "impact" forever.
    item_since = since or (now - DEFAULT_WINDOW if sort != "latest" else None)
    items = store.query_feed(db, category=category, ticker=ticker, sentiment=sentiment,
                             sort=sort, since=item_since, limit=limit)
    counts = store.category_counts(db, ticker=ticker, sentiment=sentiment, since=since or now - DEFAULT_WINDOW)
    return {
        "items": [store.serialize(r) for r in items],
        "category_counts": {k: int(counts.get(k, 0)) for k in CATEGORY_KEYS},
        "as_of": now.isoformat().replace("+00:00", "Z"),
    }


@router.get("/news/categories")
def news_categories():
    return [{"key": c["key"], "label": c["label"], "description": c["description"]} for c in CATEGORIES]


def _db_health():
    from app.db.database import SessionLocal

    if SessionLocal is None:
        return {"items_24h_by_feed": {}, "items_24h": 0, "latency_seconds": {}}
    db = SessionLocal()
    try:
        return store.health_stats(db)
    finally:
        db.close()


@router.get("/news/health")
async def news_health():
    from app.services.news_intel import ai_notes
    from app.services.news_intel.pipeline import ALPACA_KEY, SOURCES_KEY, STATUS_KEY, get_service
    from app.services.news_intel.sources import default_pollers
    from app.services.redis_cache_service import cache_service

    svc = get_service()
    redis = cache_service._redis if cache_service.available else None

    source_state: dict = {}
    # The pipeline runs in the news-worker container; it publishes a status
    # snapshot to Redis every 15s (absent/expired => worker down).
    worker = svc.status() if svc is not None else None
    alpaca_connected = bool(svc and svc.alpaca and svc.alpaca.connected)
    ai_used = None
    if redis is not None:
        try:
            raw_status = await redis.get(STATUS_KEY)
            if raw_status:
                worker = json.loads(raw_status)
            raw = await redis.hgetall(SOURCES_KEY)
            source_state = {k: json.loads(v) for k, v in (raw or {}).items()}
            alpaca_connected = alpaca_connected or bool(await redis.get(ALPACA_KEY))
            ai_used = await ai_notes.DailyCap(redis=redis).used()
        except Exception as e:
            logger.debug("news health redis error: %s", e)
    if worker:
        for k, v in (worker.get("sources") or {}).items():
            source_state.setdefault(k, v)
        alpaca_connected = alpaca_connected or bool(worker.get("alpaca_connected"))
    if ai_used is None and svc is not None:
        ai_used = await svc.ai_cap.used()

    try:
        db_stats = await asyncio.to_thread(_db_health)
    except Exception as e:
        logger.warning("news health db error: %s", e)
        db_stats = {"items_24h_by_feed": {}, "items_24h": None, "latency_seconds": {}}

    keys = [p.key for p in default_pollers()] + ["alpaca"]
    by_feed = db_stats.get("items_24h_by_feed") or {}
    sources = {}
    for k in keys + [k for k in source_state if k not in keys]:
        st = source_state.get(k, {})
        sources[k] = {
            "last_success": st.get("last_success"),
            "last_error": st.get("last_error"),
            "last_error_at": st.get("last_error_at"),
            "last_fetch_count": st.get("last_count"),
            "last_latency_ms": st.get("last_latency_ms"),
            "items_24h": int(by_feed.get(k, 0)),
            "latency_seconds": (db_stats.get("latency_by_feed") or {}).get(k),
        }
    worker = worker or {}
    return {
        "sources": sources,
        "items_24h": db_stats.get("items_24h"),
        "latency_seconds": db_stats.get("latency_seconds", {}),
        "alpaca_connected": alpaca_connected,
        "worker_alive": bool(worker),
        "worker_last_seen": worker.get("ts"),
        "ingesting": bool(worker.get("is_leader")),
        "queue_depth": worker.get("queue_depth"),
        "stats": worker.get("stats"),
        "models": worker.get("models"),
        "ai_notes": {"used_today": ai_used, "daily_limit": ai_notes.daily_limit()},
        "as_of": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
