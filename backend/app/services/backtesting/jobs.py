"""In-process background jobs for heavy backtests (sweeps, walk-forward,
Monte Carlo).

Prod runs one uvicorn worker in a 768 MB container, and the Celery worker is
off by default (docker-compose.prod.yml). So jobs run in a small dedicated
thread pool, never on the event loop. Limits:

* ``MAX_WORKERS`` (1) job runs at a time; up to ``MAX_QUEUED`` wait behind it.
* One active (queued or running) job per user.
* Every job has a time budget (``JOB_TIME_BUDGET_S``) and can be cancelled.
* Finished jobs are kept for ``RESULT_TTL_S`` and at most ``MAX_STORED`` in total.

Durability: every status change is also written to a ``JobStore`` (Redis by
default, kept ``DURABLE_TTL_S``), keyed by job id plus a per-user "latest job"
pointer. A user who leaves the page, reloads, or opens another device can
re-attach to their job (``latest_public``) and still see a finished result
after the in-memory copy is collected or the process restarts. A snapshot that
says queued/running but is unknown to this process was interrupted by a
restart; it is reported as an error, not polled forever.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from app.services.backtesting import limits as L
from app.services.backtesting.engine import BacktestTimeout

logger = logging.getLogger(__name__)

MAX_WORKERS = 1
MAX_QUEUED = 4
MAX_STORED = 32
RESULT_TTL_S = 15 * 60
DURABLE_TTL_S = 24 * 3600
INTERRUPTED = "Interrupted by a server restart. Run it again."


class QueueFull(Exception):
    pass


class AlreadyRunning(Exception):
    pass


@dataclass
class Job:
    id: str
    owner: str
    kind: str = "lab"  # lab (Strategy Lab) | classic (named-strategy backtester)
    status: str = "queued"  # queued | running | done | error | cancelled | timeout
    stage: str = "Queued"
    progress: float = 0.0
    created: float = field(default_factory=time.time)
    started: Optional[float] = None
    finished: Optional[float] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    cancel: bool = False

    def public(self, include_result: bool = True) -> dict:
        d = {"id": self.id, "kind": self.kind, "status": self.status, "stage": self.stage, "progress": round(self.progress, 3),
             "created": self.created, "started": self.started, "finished": self.finished, "error": self.error}
        if include_result and self.status == "done":
            d["result"] = self.result
        return d

    def snapshot(self) -> dict:
        d = self.public(include_result=True)
        d["owner"] = self.owner
        return d


# ── Durable snapshots ────────────────────────────────────────────────────────

class JobStore:
    """Where job snapshots outlive the in-memory pool. Implementations never raise."""

    def save(self, snap: dict) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def load(self, job_id: str) -> Optional[dict]:  # pragma: no cover - interface
        raise NotImplementedError

    def latest_id(self, owner: str, kind: str) -> Optional[str]:  # pragma: no cover - interface
        raise NotImplementedError

    def forget(self, job_id: str, owner: str, kind: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class MemoryJobStore(JobStore):
    """Process-local store, used in tests (APP_ENV=test)."""

    def __init__(self):
        self.snaps: Dict[str, str] = {}
        self.latest: Dict[str, str] = {}
        self._lock = threading.Lock()

    def save(self, snap: dict) -> None:
        with self._lock:
            self.snaps[snap["id"]] = json.dumps(snap, default=str)
            self.latest[f"{snap['owner']}:{snap.get('kind', 'lab')}"] = snap["id"]

    def load(self, job_id: str) -> Optional[dict]:
        with self._lock:
            raw = self.snaps.get(job_id)
        return json.loads(raw) if raw else None

    def latest_id(self, owner: str, kind: str) -> Optional[str]:
        with self._lock:
            return self.latest.get(f"{owner}:{kind}")

    def forget(self, job_id: str, owner: str, kind: str) -> None:
        with self._lock:
            self.snaps.pop(job_id, None)
            if self.latest.get(f"{owner}:{kind}") == job_id:
                self.latest.pop(f"{owner}:{kind}", None)


class RedisJobStore(JobStore):
    """Snapshots in Redis with a TTL. On a Redis error it backs off for 30 s
    and the manager keeps working from memory."""

    def __init__(self, url: Optional[str] = None, ttl_s: int = DURABLE_TTL_S):
        self.url = url or os.getenv("REDIS_URL") or "redis://localhost:6379/0"
        self.ttl_s = ttl_s
        self._client: Any = None
        self._down_until = 0.0
        self._lock = threading.Lock()

    def _r(self):
        if time.time() < self._down_until:
            return None
        if self._client is None:
            with self._lock:
                if self._client is None:
                    try:
                        import redis  # sync client; the API handlers run in the threadpool

                        c = redis.Redis.from_url(self.url, socket_timeout=1.0, socket_connect_timeout=0.5,
                                                 decode_responses=True)
                        c.ping()
                        self._client = c
                    except Exception as e:  # noqa: BLE001
                        self._down(e)
                        return None
        return self._client

    def _down(self, e: Exception) -> None:
        logger.warning("backtest job store: Redis unavailable (%s); using memory only", type(e).__name__)
        self._client = None
        self._down_until = time.time() + 30

    def save(self, snap: dict) -> None:
        r = self._r()
        if r is None:
            return
        try:
            p = r.pipeline()
            p.set(f"bt:job:{snap['id']}", json.dumps(snap, default=str), ex=self.ttl_s)
            p.set(f"bt:last:{snap['owner']}:{snap.get('kind', 'lab')}", snap["id"], ex=self.ttl_s)
            p.execute()
        except Exception as e:  # noqa: BLE001
            self._down(e)

    def load(self, job_id: str) -> Optional[dict]:
        r = self._r()
        if r is None:
            return None
        try:
            raw = r.get(f"bt:job:{job_id}")
            return json.loads(raw) if raw else None
        except Exception as e:  # noqa: BLE001
            self._down(e)
            return None

    def latest_id(self, owner: str, kind: str) -> Optional[str]:
        r = self._r()
        if r is None:
            return None
        try:
            return r.get(f"bt:last:{owner}:{kind}")
        except Exception as e:  # noqa: BLE001
            self._down(e)
            return None

    def forget(self, job_id: str, owner: str, kind: str) -> None:
        r = self._r()
        if r is None:
            return
        try:
            r.delete(f"bt:job:{job_id}")
            if r.get(f"bt:last:{owner}:{kind}") == job_id:
                r.delete(f"bt:last:{owner}:{kind}")
        except Exception as e:  # noqa: BLE001
            self._down(e)


def default_store() -> JobStore:
    if os.getenv("APP_ENV", "").lower() == "test":
        return MemoryJobStore()
    return RedisJobStore()


def public_from_snapshot(snap: dict, include_result: bool = True) -> dict:
    d = {k: v for k, v in snap.items() if k != "owner"}
    if d.get("status") in ("queued", "running"):
        # Not in this process's pool, so the process that ran it is gone.
        d.update(status="error", stage="Interrupted", error=INTERRUPTED)
    if not include_result or d.get("status") != "done":
        d.pop("result", None)
    return d


class JobManager:
    def __init__(self, workers: int = MAX_WORKERS, budget_s: float = L.JOB_TIME_BUDGET_S,
                 store: Optional[JobStore] = None):
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="backtest")
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self.budget_s = budget_s
        self.store = store if store is not None else default_store()
        # Finished-job outcomes for the status page (kept past _gc).
        self._history: deque = deque(maxlen=20)

    def _persist(self, job: Job) -> None:
        try:
            self.store.save(job.snapshot())
        except Exception:  # noqa: BLE001
            logger.exception("backtest job snapshot failed")

    def _gc(self):
        now = time.time()
        done = [j for j in self._jobs.values() if j.finished and now - j.finished > RESULT_TTL_S]
        for j in done:
            self._jobs.pop(j.id, None)
        if len(self._jobs) > MAX_STORED:
            for j in sorted((j for j in self._jobs.values() if j.finished), key=lambda j: j.finished)[: len(self._jobs) - MAX_STORED]:
                self._jobs.pop(j.id, None)

    def submit(self, owner: str, fn: Callable[..., dict], kind: str = "lab") -> Job:
        """``fn(progress, deadline, should_cancel) -> dict`` runs in the pool."""
        with self._lock:
            self._gc()
            active = [j for j in self._jobs.values() if j.status in ("queued", "running")]
            if any(j.owner == owner for j in active):
                raise AlreadyRunning()
            if len([j for j in active if j.status == "queued"]) >= MAX_QUEUED:
                raise QueueFull()
            job = Job(id=uuid.uuid4().hex, owner=owner, kind=kind)
            self._jobs[job.id] = job
        self._persist(job)
        self._pool.submit(self._run, job, fn)
        return job

    def _run(self, job: Job, fn):
        if job.cancel:
            job.status, job.finished = "cancelled", time.time()
            self._persist(job)
            return
        job.status, job.started, job.stage = "running", time.time(), "Starting"
        self._persist(job)
        deadline = time.monotonic() + self.budget_s

        def progress(stage: str, frac: float):
            job.stage, job.progress = stage, max(job.progress, min(1.0, frac))

        internal_error = False
        try:
            job.result = fn(progress, deadline, lambda: job.cancel)
            job.status, job.progress = "done", 1.0
        except BacktestTimeout:
            job.status, job.error = "timeout", f"Stopped after the {int(self.budget_s)} s time budget. Use fewer symbols, years or parameter values."
        except Exception as e:  # noqa: BLE001
            from app.services.backtesting.runner import Cancelled

            if isinstance(e, Cancelled):
                job.status, job.error = "cancelled", "Cancelled"
            elif isinstance(e, ValueError):
                job.status, job.error = "error", str(e)
            else:
                logger.exception("backtest job failed")
                job.status, job.error = "error", "Backtest failed"
                internal_error = True
        finally:
            job.finished = time.time()
            self._history.append({"status": "failed" if internal_error else job.status, "kind": job.kind,
                                  "finished": job.finished,
                                  "duration_s": job.finished - job.started if job.started else None})
            self._persist(job)

    def get(self, job_id: str, owner: str) -> Optional[Job]:
        """The live in-memory job in this process, or None."""
        with self._lock:
            j = self._jobs.get(job_id)
        return j if j is not None and j.owner == owner else None

    def get_public(self, job_id: str, owner: str, include_result: bool = True) -> Optional[dict]:
        """The live job, else its durable snapshot. None if unknown, expired or someone else's."""
        j = self.get(job_id, owner)
        if j is not None:
            return j.public(include_result=include_result)
        snap = self.store.load(job_id)
        if not snap or str(snap.get("owner")) != owner:
            return None
        return public_from_snapshot(snap, include_result)

    def latest_public(self, owner: str, kind: str = "lab", include_result: bool = True) -> Optional[dict]:
        """The owner's most recent job of ``kind``: an active one first, else the newest known."""
        with self._lock:
            mine = sorted((j for j in self._jobs.values() if j.owner == owner and j.kind == kind),
                          key=lambda j: j.created, reverse=True)
        active = next((j for j in mine if j.status in ("queued", "running")), None)
        if active is not None:
            return active.public(include_result=include_result)
        jid = self.store.latest_id(owner, kind)
        snap = self.get_public(jid, owner, include_result) if jid else None
        if snap is not None and snap.get("kind", "lab") != kind:
            snap = None
        if mine and (snap is None or mine[0].created >= float(snap.get("created") or 0)):
            return mine[0].public(include_result=include_result)
        return snap

    def forget(self, job_id: str, owner: str) -> bool:
        """Drop a finished job from memory and the store. An active job is cancelled instead."""
        j = self.get(job_id, owner)
        if j is not None and j.status in ("queued", "running"):
            self.cancel(job_id, owner)
            return True
        snap = j.public(include_result=False) if j is not None else self.get_public(job_id, owner, include_result=False)
        if snap is None:
            return False
        with self._lock:
            self._jobs.pop(job_id, None)
        self.store.forget(job_id, owner, snap.get("kind", "lab"))
        return True

    def cancel(self, job_id: str, owner: str) -> Optional[Job]:
        j = self.get(job_id, owner)
        if j is not None and j.status in ("queued", "running"):
            j.cancel = True
            if j.status == "queued":
                j.status, j.finished, j.error = "cancelled", time.time(), "Cancelled"
                self._persist(j)
        return j

    def stats(self) -> dict:
        """Queue depth and the most recent finished job (system status page)."""
        with self._lock:
            jobs = list(self._jobs.values())
        hist = list(self._history)
        done = [h for h in hist if h["status"] == "done"]
        return {
            "queued": sum(1 for j in jobs if j.status == "queued"),
            "running": sum(1 for j in jobs if j.status == "running"),
            # "failed" = the runner crashed; "error" = invalid input (user error)
            "recent_statuses": [h["status"] for h in hist[-10:]],
            "last": dict(hist[-1]) if hist else None,
            "last_done_at": done[-1]["finished"] if done else None,
        }


manager = JobManager()
