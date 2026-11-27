"""Async report job runner (the DungBeetle pattern, sized for one container).

Zerodha's DungBeetle takes heavy read-only SQL (reports, statements) off the
request path: a job is queued, a worker runs the query once, the result set is
written to a separate results store, and the user reads it from there until it
expires. See docs/ZERODHA_DATA_PATTERNS.md.

Here:

* Tasks are named SQL files (``registry``); a request names a task and args,
  never SQL.
* ``job_id`` = sha256(task, owner_key, canonical args). A fresh finished result
  is returned at once (cache hit); a queued/running job with the same id is
  shared (coalescing). Public tasks share one result across all users.
* Jobs run in a small thread pool (``REPORT_JOB_WORKERS``, default 1), never on
  the event loop. Each owner may have ``MAX_ACTIVE_PER_OWNER`` jobs in flight
  and the queue holds at most ``MAX_QUEUED``.
* On PostgreSQL every job runs in a READ ONLY transaction with a per-statement
  ``statement_timeout`` (``REPORT_STATEMENT_TIMEOUT_MS``, default 20000 ms) and
  at most ``MAX_ROWS`` rows are kept (``truncated`` says when more existed).
* Results live in ``report_results`` until ``expires_at`` (task ttl). Expired
  rows are swept in bounded chunks at most once a minute.
* A row that says queued/running but is unknown to this process was cut off by
  a restart: it is reported as an error and the next submit re-runs it.
"""
from __future__ import annotations

import enum
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.report_job import ReportResult
from app.services.reports.registry import ArgError, ReportTask, load_tasks

logger = logging.getLogger(__name__)

MAX_ROWS = 50_000
MAX_QUEUED = 16
MAX_ACTIVE_PER_OWNER = 3
SWEEP_EVERY_S = 60
SWEEP_CHUNK = 500
INTERRUPTED = "Interrupted by a server restart. Run it again."
ACTIVE = ("queued", "running")


class UnknownTask(KeyError):
    pass


class QueueFull(Exception):
    pass


class TooManyActive(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    # SQLite drops tzinfo on read; stored values are UTC.
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _iso(dt: Optional[datetime]) -> Optional[str]:
    dt = _aware(dt)
    return dt.isoformat() if dt else None


def json_cell(v: Any) -> Any:
    """One result cell as plain JSON (dates as ISO text, Decimal as float)."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return _iso(v)
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, enum.Enum):
        return v.value
    if isinstance(v, (bytes, bytearray, memoryview)):
        return None
    return str(v)


def job_id_for(task: str, owner_key: str, canonical_args: Dict[str, str]) -> str:
    raw = json.dumps([task, owner_key, canonical_args], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


class ReportRunner:
    def __init__(
        self,
        session_factory: Optional[Callable[[], Session]] = None,
        tasks: Optional[Dict[str, ReportTask]] = None,
        max_workers: Optional[int] = None,
        statement_timeout_ms: Optional[int] = None,
    ):
        self._session_factory = session_factory
        self._tasks = tasks
        self._max_workers = max_workers or int(os.environ.get("REPORT_JOB_WORKERS", "1") or 1)
        self._stmt_timeout_ms = (
            statement_timeout_ms
            if statement_timeout_ms is not None
            else int(os.environ.get("REPORT_STATEMENT_TIMEOUT_MS", "20000") or 0)
        )
        self._pool: Optional[ThreadPoolExecutor] = None
        self._lock = threading.RLock()
        self._inflight: Dict[str, Future] = {}
        self._inflight_owner: Dict[str, str] = {}
        self._cancelled: set = set()
        self._last_sweep = 0.0

    # ---- wiring -------------------------------------------------------------
    @property
    def tasks(self) -> Dict[str, ReportTask]:
        if self._tasks is None:
            self._tasks = load_tasks()
        return self._tasks

    def _session(self) -> Session:
        if self._session_factory is None:
            from app.db.database import SessionLocal

            if SessionLocal is None:
                raise RuntimeError("Database not configured")
            self._session_factory = SessionLocal
        return self._session_factory()

    def _executor(self) -> ThreadPoolExecutor:
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=self._max_workers, thread_name_prefix="report-job")
        return self._pool

    def shutdown(self, wait: bool = True) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=wait)
            self._pool = None

    def wait(self, job_id: str, timeout: Optional[float] = None) -> None:
        """Block until a job this process runs is finished (tests, CLI)."""
        fut = self._inflight.get(job_id)
        if fut is not None:
            try:
                fut.result(timeout=timeout)
            except Exception:
                pass

    # ---- public API -----------------------------------------------------------
    def list_tasks(self) -> List[dict]:
        return [t.public() for t in self.tasks.values()]

    def task(self, name: str) -> ReportTask:
        t = self.tasks.get(name)
        if t is None:
            raise UnknownTask(name)
        return t

    def submit(self, task_name: str, user_id: int, args: Optional[Dict[str, Any]] = None) -> dict:
        """Queue a job, or return the fresh / in-flight one with the same id.

        Raises UnknownTask, ArgError, TooManyActive, QueueFull."""
        task = self.task(task_name)
        canonical = task.canonical_args(args or {})
        bound = task.bind_args(args or {})
        owner_key = str(int(user_id)) if task.scope == "user" else "*"
        job_id = job_id_for(task.name, owner_key, canonical)
        self._maybe_sweep()

        with self._lock:
            if self._is_live(job_id):
                return self._public_by_id(job_id, cached=False)
            with self._session() as db:
                row = db.get(ReportResult, job_id)
                if row is not None and row.status == "done" and _aware(row.expires_at) and _aware(row.expires_at) > _now():
                    return self._public(row, cached=True)
            me = str(int(user_id))
            live = [j for j in list(self._inflight) if self._is_live(j)]
            if sum(1 for j in live if self._inflight_owner.get(j) == me) >= MAX_ACTIVE_PER_OWNER:
                raise TooManyActive()
            if len(live) >= MAX_QUEUED:
                raise QueueFull()

            with self._session() as db:
                row = db.get(ReportResult, job_id)
                fields = dict(
                    task=task.name, owner_key=owner_key, submitted_by=int(user_id), args_json=canonical,
                    status="queued", error=None, columns_json=None, rows_json=None, row_count=0,
                    truncated=False, duration_ms=None, created_at=_now(), started_at=None,
                    finished_at=None, expires_at=None,
                )
                if row is None:
                    db.add(ReportResult(job_id=job_id, **fields))
                else:
                    for k, v in fields.items():
                        setattr(row, k, v)
                try:
                    db.commit()
                except IntegrityError:  # another process inserted it first
                    db.rollback()
                    row = db.get(ReportResult, job_id)
                    return self._public(row, cached=False)

            self._cancelled.discard(job_id)
            self._inflight_owner[job_id] = me
            fut = self._executor().submit(self._run, job_id, task, bound, int(user_id))
            self._inflight[job_id] = fut
            fut.add_done_callback(lambda _f, jid=job_id: self._forget(jid))
        return self._public_by_id(job_id, cached=False)

    def get(self, job_id: str, user_id: int, offset: int = 0, limit: int = 500) -> Optional[dict]:
        """Status plus one page of rows; None when missing or not visible to the user."""
        with self._session() as db:
            row = db.get(ReportResult, job_id)
            if row is None or not self._visible(row, user_id):
                return None
            out = self._public(row, cached=False)
            if row.status == "done":
                rows = row.rows_json or []
                offset = max(0, int(offset))
                limit = max(1, min(int(limit), 5000))
                out["columns"] = row.columns_json or []
                out["rows"] = rows[offset:offset + limit]
                out["offset"] = offset
                out["limit"] = limit
            return out

    def full_result(self, job_id: str, user_id: int) -> Optional[dict]:
        with self._session() as db:
            row = db.get(ReportResult, job_id)
            if row is None or not self._visible(row, user_id) or row.status != "done":
                return None
            return {"task": row.task, "columns": row.columns_json or [], "rows": row.rows_json or [],
                    "truncated": bool(row.truncated)}

    def cancel(self, job_id: str, user_id: int) -> Optional[dict]:
        """Cancel a queued/running job, or delete a finished one the user owns.

        A running PostgreSQL statement is not interrupted (statement_timeout
        bounds it); its result is discarded. Public results are shared, so a
        user can cancel only a public job they submitted and cannot delete it."""
        with self._lock:
            with self._session() as db:
                row = db.get(ReportResult, job_id)
                if row is None or not self._visible(row, user_id):
                    return None
                mine = row.submitted_by == int(user_id)
                if row.status in ACTIVE and self._is_live(job_id):
                    if not mine:
                        return None
                    self._cancelled.add(job_id)
                    self._inflight[job_id].cancel()
                    row.status, row.finished_at = "cancelled", _now()
                    db.commit()
                    return self._public(row, cached=False)
                if row.owner_key == "*":
                    return self._public(row, cached=False)
                db.delete(row)
                db.commit()
                return {"id": job_id, "status": "deleted"}

    # ---- internals --------------------------------------------------------------
    def _is_live(self, job_id: str) -> bool:
        # A finished future can linger here until its done-callback runs.
        fut = self._inflight.get(job_id)
        return fut is not None and not fut.done()

    def _forget(self, job_id: str) -> None:
        with self._lock:
            self._inflight.pop(job_id, None)
            self._inflight_owner.pop(job_id, None)

    @staticmethod
    def _visible(row: ReportResult, user_id: int) -> bool:
        return row.owner_key == "*" or row.owner_key == str(int(user_id))

    def _public_by_id(self, job_id: str, cached: bool) -> dict:
        with self._session() as db:
            row = db.get(ReportResult, job_id)
            return self._public(row, cached=cached)

    def _public(self, row: ReportResult, cached: bool) -> dict:
        status, error = row.status, row.error
        if status in ACTIVE and row.job_id not in self._inflight:
            status, error = "error", INTERRUPTED
        return {
            "id": row.job_id,
            "task": row.task,
            "scope": "public" if row.owner_key == "*" else "user",
            "args": row.args_json or {},
            "status": status,
            "error": error,
            "cached": cached,
            "row_count": row.row_count or 0,
            "truncated": bool(row.truncated),
            "duration_ms": row.duration_ms,
            "created_at": _iso(row.created_at),
            "started_at": _iso(row.started_at),
            "finished_at": _iso(row.finished_at),
            "expires_at": _iso(row.expires_at),
        }

    def _update(self, job_id: str, **fields) -> None:
        with self._session() as db:
            row = db.get(ReportResult, job_id)
            if row is None:
                return
            if job_id in self._cancelled and fields.get("status") != "cancelled":
                return
            for k, v in fields.items():
                setattr(row, k, v)
            db.commit()

    def _run(self, job_id: str, task: ReportTask, bound: Dict[str, Any], user_id: int) -> None:
        if job_id in self._cancelled:
            return
        t0 = time.monotonic()
        self._update(job_id, status="running", started_at=_now())
        params = dict(bound)
        if task.scope == "user":
            params["user_id"] = int(user_id)
        try:
            with self._session() as db:
                conn = db.connection()
                if conn.dialect.name == "postgresql":
                    conn.exec_driver_sql("SET TRANSACTION READ ONLY")
                    if self._stmt_timeout_ms > 0:
                        conn.exec_driver_sql(f"SET LOCAL statement_timeout = {int(self._stmt_timeout_ms)}")
                res = conn.execute(task.statement(), params)
                columns = list(res.keys())
                fetched = res.fetchmany(MAX_ROWS + 1)
                db.rollback()  # read-only: never commit
            truncated = len(fetched) > MAX_ROWS
            rows = [[json_cell(v) for v in r] for r in fetched[:MAX_ROWS]]
            finished = _now()
            self._update(
                job_id, status="done", columns_json=columns, rows_json=rows, row_count=len(rows),
                truncated=truncated, finished_at=finished, duration_ms=int((time.monotonic() - t0) * 1000),
                expires_at=finished + timedelta(seconds=task.ttl_s),
            )
        except Exception as e:
            logger.warning("report job %s (%s) failed: %s", job_id, task.name, e)
            msg = "The report took too long and was stopped." if "statement timeout" in str(e).lower() \
                else "The report failed to run."
            self._update(job_id, status="error", error=msg, finished_at=_now(),
                         duration_ms=int((time.monotonic() - t0) * 1000))

    def _maybe_sweep(self) -> None:
        now = time.monotonic()
        if now - self._last_sweep < SWEEP_EVERY_S:
            return
        self._last_sweep = now
        try:
            self.sweep_expired()
        except Exception as e:  # never block a submit on housekeeping
            logger.debug("report sweep failed: %s", e)

    def sweep_expired(self) -> int:
        """Delete up to SWEEP_CHUNK expired results; returns how many."""
        with self._session() as db:
            ids = db.execute(
                select(ReportResult.job_id)
                .where(ReportResult.expires_at.is_not(None), ReportResult.expires_at < _now())
                .limit(SWEEP_CHUNK)
            ).scalars().all()
            ids = [i for i in ids if i not in self._inflight]
            if not ids:
                return 0
            db.execute(delete(ReportResult).where(ReportResult.job_id.in_(ids)))
            db.commit()
            return len(ids)


runner = ReportRunner()

__all__ = ["ArgError", "QueueFull", "ReportRunner", "TooManyActive", "UnknownTask", "runner", "job_id_for"]
