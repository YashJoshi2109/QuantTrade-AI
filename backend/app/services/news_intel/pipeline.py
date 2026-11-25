"""
NewsIntelService — the asyncio ingestion service started from main.py lifespan.

  pollers (staggered, every NEWS_INTEL_POLL_SECONDS) ─┐
  Alpaca/Benzinga WebSocket (if keys set) ────────────┴─> queue
  consumer: batch -> dedupe/cluster -> classify (thread) -> persist (thread)
            -> publish {"type":"news","item":...} on Redis qt:ws:news
  ai loop:   top-impact clusters without a note -> Claude Haiku (daily cap)
  upkeep:    leader-lock renewal, 14-day retention, clusterer prune

Only the process holding the Redis leader lock ingests. Without Redis the
process assumes it is the only one (single-worker dev).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from app.services.news_intel import ai_notes, store
from app.services.news_intel.categorizer import get_categorizer, order_categories
from app.services.news_intel.dedupe import Clusterer
from app.services.news_intel.impact import impact_score
from app.services.news_intel.sentiment import get_sentiment_classifier, sentiment_text
from app.services.news_intel.sources import AlpacaNewsStream, PollerSpec, RawItem, default_pollers
from app.services.news_intel.tickers import get_ticker_index

logger = logging.getLogger(__name__)

WS_CHANNEL = "qt:ws:news"
LEADER_KEY = "qt:news:leader"
SOURCES_KEY = "qt:news:sources"
ALPACA_KEY = "qt:news:alpaca_connected"
STATUS_KEY = "qt:news:worker:status"   # JSON snapshot written by the news-worker every 15s
HEARTBEAT_FILE = os.environ.get("NEWS_WORKER_HEARTBEAT_FILE", "/tmp/news-worker.heartbeat")
MAX_AGE_HOURS = 48          # ignore feed items older than this (RSS backlogs)
BATCH_MAX = 32
QUEUE_MAX = 5000

_RENEW_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── classification (pure, sync; runs in a worker thread) ─────────────────

def classify_items(items: List[RawItem], *, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Sentiment + categories + tickers + impact for new clusters."""
    if not items:
        return []
    clf = get_sentiment_classifier()
    cat = get_categorizer()
    tix = get_ticker_index()
    sents = clf.classify([sentiment_text(i.title, i.summary) for i in items])
    cats = cat.classify([i.title for i in items])
    out = []
    for it, s, c in zip(items, sents, cats):
        categories = list(c.categories)
        primary = c.primary
        if it.category_hints:
            categories = order_categories(list(it.category_hints) + [x for x in categories if x != "other"])
            if primary == "other" or c.method != "rules":
                primary = it.category_hints[0]
        tickers = tix.extract(it.title, it.summary, it.symbols)
        impact = impact_score(
            sentiment_score=s.score,
            sentiment_confidence=s.confidence,
            source=it.source,
            market_caps=[tix.market_cap(t) for t in tickers],
            categories=categories,
            published_at=it.published_at,
            n_sources=1,
            now=now,
        )
        out.append({
            "tickers": tickers,
            "categories": categories or ["other"],
            "primary_category": primary or "other",
            "sentiment_label": s.label,
            "sentiment_score": s.score,
            "sentiment_confidence": s.confidence,
            "impact": impact,
        })
    return out


def _source_entry(it: RawItem) -> Dict[str, Any]:
    return {
        "source": it.source,
        "feed": it.feed,
        "url": it.url,
        "title": it.title,
        "published_at": (it.published_at or it.received_at).isoformat().replace("+00:00", "Z"),
    }


class NewsIntelService:
    def __init__(self, *, session_factory: Optional[Callable] = None, redis=None,
                 pollers: Optional[List[PollerSpec]] = None, publisher: Optional[Callable] = None):
        self._session_factory = session_factory
        self.redis = redis
        self.pollers = pollers
        self._publisher = publisher
        self.clusterer = Clusterer()
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
        self.source_state: Dict[str, Dict[str, Any]] = {}
        self.alpaca: Optional[AlpacaNewsStream] = None
        self.token = uuid.uuid4().hex
        self.is_leader = False
        self.ai_cap = ai_notes.DailyCap(redis=redis)
        self._ai_attempted: set = set()
        self._task: Optional[asyncio.Task] = None
        self._children: List[asyncio.Task] = []
        self.stats = {"processed": 0, "new": 0, "joined": 0, "duplicates": 0, "stale": 0, "dropped": 0}

    # ── plumbing ─────────────────────────────────────────────────────────
    @property
    def session_factory(self):
        if self._session_factory is None:
            from app.db.database import SessionLocal
            self._session_factory = SessionLocal
        return self._session_factory

    def _db_call(self, fn, *args, **kwargs):
        db = self.session_factory()
        try:
            return fn(db, *args, **kwargs)
        finally:
            db.close()

    async def publish(self, row_payload: Dict[str, Any]) -> None:
        msg = {"type": "news", "item": row_payload}
        if self._publisher is not None:
            await self._publisher(WS_CHANNEL, msg)
            return
        from app.services.redis_cache_service import cache_service

        if cache_service.available:
            await cache_service.publish(WS_CHANNEL, msg)
        else:  # single-process dev without Redis: push straight to sockets
            from app.services.ws_manager import ws_manager
            await ws_manager.broadcast("news", msg)

    async def _record_source(self, key: str, *, ok: bool, count: int = 0,
                             latency_ms: Optional[float] = None, error: Optional[str] = None) -> None:
        st = self.source_state.setdefault(key, {})
        now = _now().isoformat().replace("+00:00", "Z")
        if ok:
            st.update(last_success=now, last_count=count, last_latency_ms=latency_ms)
        else:
            err = re.sub(r"(?i)(token|key|secret|apikey|api_key)=[^&\s'\"]+", r"\1=***", error or "")
            st.update(last_error=err[:300], last_error_at=now)
        if self.redis is not None:
            try:
                await self.redis.hset(SOURCES_KEY, key, json.dumps(st))
                await self.redis.expire(SOURCES_KEY, 7 * 86400)
            except Exception:
                pass

    # ── core batch processing (testable without network) ─────────────────
    async def process_batch(self, items: List[RawItem]) -> List[Dict[str, Any]]:
        """Dedupe/cluster, classify, persist and publish. Returns published payloads."""
        now = _now()
        new_items: List[tuple] = []
        joins: List[tuple] = []
        for it in items:
            self.stats["processed"] += 1
            if not it.title:
                continue
            pub = it.published_at or it.received_at
            if pub > now + timedelta(minutes=10):
                pub = it.received_at  # bad clocks / future-dated feeds
            it.published_at = pub
            if now - pub > timedelta(hours=MAX_AGE_HOURS):
                self.stats["stale"] += 1
                continue
            d = self.clusterer.assign(it.title, it.url, now=it.received_at)
            if d.kind == "duplicate":
                self.stats["duplicates"] += 1
            elif d.kind == "join":
                joins.append((d, it))
            else:
                new_items.append((d, it))

        published: List[Dict[str, Any]] = []
        if new_items:
            classified = await asyncio.to_thread(classify_items, [it for _, it in new_items], now=now)
            classified_at = _now()
            rows = []
            for (d, it), c in zip(new_items, classified):
                rows.append({
                    "cluster_id": d.cluster_id,
                    "title": it.title,
                    "summary": it.summary or None,
                    "url": it.url or None,
                    "url_hash": d.url_hash or None,
                    "title_hash": d.title_hash or None,
                    "source": it.source,
                    "source_feed": it.feed,
                    "sources": [_source_entry(it)],
                    "sources_count": 1,
                    "published_at": it.published_at,
                    "ingested_at": it.received_at,
                    "classified_at": classified_at,
                    "image_url": it.image_url,
                    **c,
                })
            payloads = await asyncio.to_thread(self._db_call, _insert_rows, rows)
            self.stats["new"] += len(payloads)
            published.extend(payloads)

        for d, it in joins:
            payload = await asyncio.to_thread(self._db_call, _join_row, d.cluster_id, it)
            if payload:
                self.stats["joined"] += 1
                published.append(payload)

        for p in published:
            try:
                await self.publish(p)
            except Exception as e:
                logger.debug("news publish failed: %s", e)
        return published

    async def enqueue(self, item: RawItem) -> None:
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            self.stats["dropped"] += 1

    # ── loops ─────────────────────────────────────────────────────────────
    async def _consumer(self) -> None:
        while True:
            first = await self.queue.get()
            batch = [first]
            deadline = time.monotonic() + 0.5
            while len(batch) < BATCH_MAX:
                timeout = deadline - time.monotonic()
                if timeout <= 0:
                    break
                try:
                    batch.append(await asyncio.wait_for(self.queue.get(), timeout))
                except asyncio.TimeoutError:
                    break
            try:
                await self.process_batch(batch)
            except Exception:
                logger.exception("news batch failed (%d items)", len(batch))

    async def _poll_loop(self, spec: PollerSpec, client, offset: float) -> None:
        from app.config import settings

        await asyncio.sleep(offset)
        failures = 0
        while True:
            if spec.requires and not getattr(settings, spec.requires, None):
                await asyncio.sleep(max(spec.interval, 300))
                continue
            t0 = time.perf_counter()
            try:
                items = await asyncio.wait_for(spec.fetch(client), timeout=45)
                for it in items:
                    await self.enqueue(it)
                await self._record_source(spec.key, ok=True, count=len(items),
                                          latency_ms=round((time.perf_counter() - t0) * 1000, 1))
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:
                failures += 1
                await self._record_source(spec.key, ok=False, error=f"{type(e).__name__}: {str(e)[:160]}")
            # Exponential backoff on errors (429s from Google News, 403s), capped at 15 min.
            await asyncio.sleep(min(spec.interval * (2 ** min(failures, 4)), 900.0))

    async def _alpaca_loop(self) -> None:
        from app.config import settings

        key = (settings.ALPACA_API_KEY or "").strip()
        secret = (settings.ALPACA_SECRET_KEY or "").strip()
        if not key or not secret:
            logger.info("Alpaca news stream disabled (ALPACA_API_KEY/ALPACA_SECRET_KEY not set)")
            return

        def on_state(connected: bool, err: Optional[str]):
            if connected:
                asyncio.get_running_loop().create_task(self._record_source("alpaca", ok=True))
            elif err:
                asyncio.get_running_loop().create_task(self._record_source("alpaca", ok=False, error=err))

        async def sink(item: RawItem):
            await self.enqueue(item)

        self.alpaca = AlpacaNewsStream(key, secret, sink, on_state=on_state)
        await self.alpaca.run()

    async def _ai_loop(self) -> None:
        interval = _env_int("NEWS_AI_INTERVAL_SECONDS", 300)
        min_impact = _env_int("NEWS_AI_MIN_IMPACT", 20)
        await asyncio.sleep(60)
        while True:
            try:
                await self.run_ai_pass(min_impact=min_impact)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("news AI pass failed")
            await asyncio.sleep(interval)

    async def run_ai_pass(self, *, min_impact: int = 20, batch: int = 5, llm_call=None) -> int:
        """Annotate up to `batch` top-impact clusters from the last 24h. Returns notes written."""
        since = _now() - timedelta(hours=24)
        rows = await asyncio.to_thread(self._db_call, _top_payloads, since, min_impact, batch * 4)
        rows = [r for r in rows if r["cluster_id"] not in self._ai_attempted][:batch]
        written = 0
        for payload in rows:
            if not await self.ai_cap.try_acquire():
                break
            # One attempt per cluster: a failing item must not drain the daily cap.
            self._ai_attempted.add(payload["cluster_id"])
            if len(self._ai_attempted) > 5000:
                self._ai_attempted.clear()
            note = await asyncio.to_thread(ai_notes.generate_note, payload, llm_call)
            if not note:
                continue
            updated = await asyncio.to_thread(self._db_call, _set_ai_payload, payload["cluster_id"], note)
            if updated:
                written += 1
                await self.publish(updated)
        return written

    async def _upkeep(self) -> None:
        retention = _env_int("NEWS_INTEL_RETENTION_DAYS", 14)
        last_prune = 0.0
        while True:
            await asyncio.sleep(15)
            if not await self._renew_leader():
                logger.warning("news-intel lost leader lock; stopping ingestion")
                return
            if self.redis is not None:
                try:
                    if self.alpaca and self.alpaca.connected:
                        await self.redis.set(ALPACA_KEY, "1", ex=60)
                    else:
                        await self.redis.delete(ALPACA_KEY)
                except Exception:
                    pass
            if time.monotonic() - last_prune > 3600:
                last_prune = time.monotonic()
                try:
                    n = await asyncio.to_thread(self._db_call, store.prune, retention)
                    self.clusterer.prune()
                    await asyncio.to_thread(get_ticker_index().refresh)
                    if n:
                        logger.info("news-intel pruned %d rows older than %d days", n, retention)
                except Exception as e:
                    logger.warning("news-intel prune failed: %s", e)

    # ── leadership ───────────────────────────────────────────────────────
    async def _acquire_leader(self) -> bool:
        if self.redis is None:
            return True
        try:
            return bool(await self.redis.set(LEADER_KEY, self.token, nx=True, ex=45))
        except Exception as e:
            logger.debug("leader lock error: %s", e)
            return False

    async def _renew_leader(self) -> bool:
        if self.redis is None:
            return True
        try:
            return bool(await self.redis.eval(_RENEW_LUA, 1, LEADER_KEY, self.token, 45))
        except Exception:
            return True  # transient Redis error: keep going, retry next tick

    async def _release_leader(self) -> None:
        if self.redis is None:
            return
        try:
            await self.redis.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
                1, LEADER_KEY, self.token,
            )
        except Exception:
            pass

    async def warm(self) -> None:
        """Load models + ticker map and rebuild the clusterer from the DB."""
        await asyncio.to_thread(get_ticker_index().refresh, True)
        await asyncio.to_thread(get_sentiment_classifier().load)
        await asyncio.to_thread(get_categorizer().load)
        try:
            rows = await asyncio.to_thread(self._db_call, _seed_rows)
            for cid, title, urls, titles, ingested in rows:
                self.clusterer.seed(cid, title, urls, ingested, titles)
            logger.info("news-intel clusterer seeded with %d clusters", len(rows))
        except Exception as e:
            logger.warning("news-intel seed failed: %s", e)

    async def _run_as_leader(self) -> None:
        import httpx

        await self.warm()
        pollers = self.pollers if self.pollers is not None else default_pollers()
        async with httpx.AsyncClient(limits=httpx.Limits(max_connections=10)) as client:
            n = max(1, len(pollers))
            self._children = [asyncio.create_task(self._consumer(), name="news-consumer")]
            for i, spec in enumerate(pollers):
                offset = (spec.interval / n) * i  # stagger across the interval
                self._children.append(asyncio.create_task(self._poll_loop(spec, client, offset),
                                                          name=f"news-poll-{spec.key}"))
            self._children.append(asyncio.create_task(self._alpaca_loop(), name="news-alpaca"))
            if ai_notes.daily_limit() > 0:
                self._children.append(asyncio.create_task(self._ai_loop(), name="news-ai"))
            upkeep = asyncio.create_task(self._upkeep(), name="news-upkeep")
            try:
                await upkeep  # returns when the leader lock is lost
            finally:
                for t in self._children:
                    t.cancel()
                await asyncio.gather(*self._children, return_exceptions=True)
                self._children = []
                if self.alpaca:
                    self.alpaca.connected = False

    async def run(self) -> None:
        while True:
            try:
                if await self._acquire_leader():
                    self.is_leader = True
                    logger.info("news-intel: leader, starting ingestion")
                    await self._run_as_leader()
                    self.is_leader = False
                await asyncio.sleep(20)
            except asyncio.CancelledError:
                await self._release_leader()
                raise
            except Exception:
                self.is_leader = False
                logger.exception("news-intel service error; restarting in 30s")
                await asyncio.sleep(30)

    def status(self) -> Dict[str, Any]:
        clf = get_sentiment_classifier()
        return {
            "pid": os.getpid(),
            "ts": _now().isoformat().replace("+00:00", "Z"),
            "is_leader": self.is_leader,
            "alpaca_connected": bool(self.alpaca and self.alpaca.connected),
            "queue_depth": self.queue.qsize(),
            "stats": dict(self.stats),
            "sources": self.source_state,
            "models": {"sentiment": clf.backend, "sentiment_load_seconds": clf.load_seconds,
                       "categorizer_embeddings": get_categorizer().loaded},
        }

    async def status_loop(self, interval: float = 15.0) -> None:
        """Heartbeat for the container healthcheck + status for /news/health."""
        while True:
            try:
                Path(HEARTBEAT_FILE).touch()
            except OSError:
                pass
            if self.redis is not None:
                try:
                    await self.redis.set(STATUS_KEY, json.dumps(self.status(), default=str), ex=90)
                except Exception as e:
                    logger.debug("news status write failed: %s", e)
            await asyncio.sleep(interval)

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self.run(), name="news-intel")
        return self._task

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass


# ── DB helpers (sync, run in threads) ────────────────────────────────────

def _insert_rows(db, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from app.models.news_item import NewsItem

    objs = [NewsItem(**r) for r in rows]
    db.add_all(objs)
    try:
        db.commit()
    except Exception:
        db.rollback()
        objs = []
        for r in rows:  # isolate the bad row (e.g. a racing duplicate cluster_id)
            try:
                o = NewsItem(**r)
                db.add(o)
                db.commit()
                objs.append(o)
            except Exception:
                db.rollback()
    out = []
    for o in objs:
        db.refresh(o)
        out.append(store.serialize(o))
    return out


def _join_row(db, cluster_id: str, it: RawItem) -> Optional[Dict[str, Any]]:
    tix = get_ticker_index()
    extra = tix.extract(it.title, it.summary, it.symbols)
    row = store.add_source(db, cluster_id, _source_entry(it), extra_tickers=extra, image_url=it.image_url)
    if row is None:
        return None
    row.impact = impact_score(
        sentiment_score=row.sentiment_score or 0.0,
        sentiment_confidence=row.sentiment_confidence or 0.0,
        source=row.source,
        market_caps=[tix.market_cap(t) for t in (row.tickers or [])],
        categories=row.categories or [],
        published_at=row.published_at,
        n_sources=row.sources_count,
    )
    db.commit()
    db.refresh(row)
    return store.serialize(row)


def _top_payloads(db, since, min_impact, limit):
    return [store.serialize(r) for r in store.top_without_ai(db, since=since, min_impact=min_impact, limit=limit)]


def _set_ai_payload(db, cluster_id, note):
    row = store.set_ai(db, cluster_id, note)
    return store.serialize(row) if row else None


def _seed_rows(db):
    out = []
    for r in store.recent_for_seed(db, 24):
        srcs = r.sources or []
        out.append((r.cluster_id, r.title, [s.get("url") for s in srcs if s.get("url")] + ([r.url] if r.url else []),
                    [s.get("title") for s in srcs if s.get("title")], r.ingested_at))
    return out


_service: Optional[NewsIntelService] = None


def get_service() -> Optional[NewsIntelService]:
    return _service


def start_news_intel(redis=None) -> Optional[asyncio.Task]:
    """In-process start (dev only: main.py with NEWS_INTEL_IN_API=1). Production
    runs the pipeline in the separate news-worker container (news_intel.worker)."""
    global _service
    if os.environ.get("NEWS_INTEL_ENABLED", "1") == "0":
        logger.info("news-intel disabled (NEWS_INTEL_ENABLED=0)")
        return None
    _service = NewsIntelService(redis=redis)
    return _service.start()
