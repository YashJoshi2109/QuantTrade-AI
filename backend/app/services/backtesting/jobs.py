"""In-process background jobs for heavy backtests (sweeps, walk-forward,
Monte Carlo).

Prod runs one uvicorn worker in a 768 MB container, and the Celery worker is
off by default (docker-compose.prod.yml). So jobs run in a small dedicated
thread pool, never on the event loop. Limits:

* ``MAX_WORKERS`` (1) job runs at a time; up to ``MAX_QUEUED`` wait behind it.
* One active (queued or running) job per user.
* Every job has a time budget (``JOB_TIME_BUDGET_S``) and can be cancelled.
* Finished jobs are kept for ``RESULT_TTL_S`` and at most ``MAX_STORED`` in total.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
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


class QueueFull(Exception):
    pass


class AlreadyRunning(Exception):
    pass


@dataclass
class Job:
    id: str
    owner: str
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
        d = {"id": self.id, "status": self.status, "stage": self.stage, "progress": round(self.progress, 3),
             "created": self.created, "started": self.started, "finished": self.finished, "error": self.error}
        if include_result and self.status == "done":
            d["result"] = self.result
        return d


class JobManager:
    def __init__(self, workers: int = MAX_WORKERS, budget_s: float = L.JOB_TIME_BUDGET_S):
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="backtest")
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self.budget_s = budget_s

    def _gc(self):
        now = time.time()
        done = [j for j in self._jobs.values() if j.finished and now - j.finished > RESULT_TTL_S]
        for j in done:
            self._jobs.pop(j.id, None)
        if len(self._jobs) > MAX_STORED:
            for j in sorted((j for j in self._jobs.values() if j.finished), key=lambda j: j.finished)[: len(self._jobs) - MAX_STORED]:
                self._jobs.pop(j.id, None)

    def submit(self, owner: str, fn: Callable[..., dict]) -> Job:
        """``fn(progress, deadline, should_cancel) -> dict`` runs in the pool."""
        with self._lock:
            self._gc()
            active = [j for j in self._jobs.values() if j.status in ("queued", "running")]
            if any(j.owner == owner for j in active):
                raise AlreadyRunning()
            if len([j for j in active if j.status == "queued"]) >= MAX_QUEUED:
                raise QueueFull()
            job = Job(id=uuid.uuid4().hex, owner=owner)
            self._jobs[job.id] = job
        self._pool.submit(self._run, job, fn)
        return job

    def _run(self, job: Job, fn):
        if job.cancel:
            job.status, job.finished = "cancelled", time.time()
            return
        job.status, job.started, job.stage = "running", time.time(), "Starting"
        deadline = time.monotonic() + self.budget_s

        def progress(stage: str, frac: float):
            job.stage, job.progress = stage, max(job.progress, min(1.0, frac))

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
        finally:
            job.finished = time.time()

    def get(self, job_id: str, owner: str) -> Optional[Job]:
        with self._lock:
            j = self._jobs.get(job_id)
        return j if j is not None and j.owner == owner else None

    def cancel(self, job_id: str, owner: str) -> Optional[Job]:
        j = self.get(job_id, owner)
        if j is not None and j.status in ("queued", "running"):
            j.cancel = True
            if j.status == "queued":
                j.status, j.finished, j.error = "cancelled", time.time(), "Cancelled"
        return j


manager = JobManager()
