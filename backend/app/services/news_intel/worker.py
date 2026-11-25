"""
news-worker entry point: ingestion + classification + AI notes, outside the API.

  python -m app.services.news_intel.worker               # run the worker
  python -m app.services.news_intel.worker --healthcheck # exit 0 if heartbeat < 120s old

The API process never loads the models; it reads news_items and bridges the
Redis channel qt:ws:news to /ws/news. This process is the only one with
NEWS_INTEL_MODELS=1, and a Redis leader lock keeps ingestion to one worker.
"""
from __future__ import annotations

import os
import sys
import time

HEARTBEAT_FILE = os.environ.get("NEWS_WORKER_HEARTBEAT_FILE", "/tmp/news-worker.heartbeat")
HEARTBEAT_MAX_AGE = 120


def healthcheck() -> int:
    """Cheap check for the Docker healthcheck (no app imports)."""
    try:
        return 0 if time.time() - os.path.getmtime(HEARTBEAT_FILE) < HEARTBEAT_MAX_AGE else 1
    except OSError:
        return 1


async def _amain() -> None:
    import asyncio
    import logging
    import signal

    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("news-worker")

    from concurrent.futures import ThreadPoolExecutor

    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=8, thread_name_prefix="news-worker"))

    redis = None
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    try:
        import redis.asyncio as aioredis

        redis = aioredis.from_url(redis_url, decode_responses=True, socket_connect_timeout=5)
        await redis.ping()
        from app.services.redis_cache_service import cache_service

        cache_service.init_redis(redis)
        log.info("redis connected")
    except Exception as e:  # without Redis: no leader lock (single worker) and no WS fan-out
        log.warning("redis unavailable (%s); running without leader lock / pub-sub", type(e).__name__)
        redis = None

    from app.db.database import engine
    from app.models.news_item import NewsItem

    if engine is not None:
        await asyncio.to_thread(NewsItem.__table__.create, bind=engine, checkfirst=True)

    from app.services.news_intel import pipeline

    svc = pipeline.NewsIntelService(redis=redis)
    pipeline._service = svc
    status = asyncio.create_task(svc.status_loop(), name="news-status")
    runner = svc.start()

    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):
            pass
    log.info("news-worker started (pid %d)", os.getpid())
    await stop.wait()
    log.info("news-worker stopping")
    status.cancel()
    await svc.stop()
    if not runner.done():
        runner.cancel()
    if redis is not None:
        await redis.close()


def main() -> None:
    if "--healthcheck" in sys.argv:
        sys.exit(healthcheck())
    if os.environ.get("NEWS_INTEL_ENABLED", "1") == "0":
        print("news-worker: NEWS_INTEL_ENABLED=0, idling")
        while True:  # keep the container healthy but idle
            open(HEARTBEAT_FILE, "a").close()
            os.utime(HEARTBEAT_FILE)
            time.sleep(30)
    # Same secret source as the API (DATABASE_URL etc. from AWS Secrets Manager in prod).
    try:
        from app.config_aws import inject_aws_secrets

        inject_aws_secrets()
    except Exception as e:
        print(f"news-worker: AWS secrets load skipped: {e}")
    # This is the only process allowed to load the ONNX models.
    os.environ.setdefault("NEWS_INTEL_MODELS", "1")
    import asyncio

    asyncio.run(_amain())


if __name__ == "__main__":
    main()
