"""
Telemetry the admin console reads, all collected passively (never on a path
that can fail a user request):

  * RequestMetricsMiddleware: in-process ring buffer of (time, status, latency)
    for every API request -> API p95 and 5xx error rate (this API process,
    since it started; the buffer holds the most recent RING_N requests).
  * host_metrics(): CPU / memory of this host or container via psutil.
  * touch_activity(user_id): one user_activity_days row per user per UTC day.
  * status_history_loop(): every SNAPSHOT_EVERY_S the status leader stores a
    system_status_snapshots row and an ops_events row per status transition.
  * record_deploy(): an ops_events "deploy" row when GIT_SHA changes.
  * record_copilot_trace(trace): one copilot_request_metrics row per request.

DB writes go through one background thread with their own session.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PROCESS_STARTED_AT = time.time()
RING_N = 20_000
SNAPSHOT_EVERY_S = int(os.getenv("ADMIN_STATUS_SNAPSHOT_S", "300"))

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="admin-metrics")


def _submit(fn: Callable[[], None]) -> None:
    if os.getenv("APP_ENV", "").lower() == "test" and not os.getenv("ADMIN_METRICS_IN_TESTS"):
        return
    _pool.submit(_guarded, fn)


def _guarded(fn: Callable[[], None]) -> None:
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        logger.debug("admin metrics write skipped: %s", type(exc).__name__)


def _session():
    from app.db import database
    if database.SessionLocal is None:
        return None
    return database.SessionLocal()


# ── API request metrics ──────────────────────────────────────────────────────

_requests: Deque[Tuple[float, int, float]] = deque(maxlen=RING_N)
_req_lock = threading.Lock()


class RequestMetricsMiddleware:
    """Pure ASGI middleware: records status + latency of /api/* HTTP requests."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not str(scope.get("path", "")).startswith("/api/"):
            return await self.app(scope, receive, send)
        t0 = time.perf_counter()
        status_holder = {"code": 500}

        async def _send(message):
            if message.get("type") == "http.response.start":
                status_holder["code"] = int(message.get("status") or 500)
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            ms = (time.perf_counter() - t0) * 1000
            with _req_lock:
                _requests.append((time.time(), status_holder["code"], ms))


def record_request(status_code: int, ms: float, at: Optional[float] = None) -> None:
    with _req_lock:
        _requests.append((at or time.time(), int(status_code), float(ms)))


def _pct(vals: List[float], q: float) -> Optional[int]:
    if not vals:
        return None
    vals = sorted(vals)
    k = max(0, min(len(vals) - 1, int(round(q * (len(vals) - 1)))))
    return int(vals[k])


def request_summary(since_s: Optional[float] = None) -> Dict[str, Any]:
    now = time.time()
    with _req_lock:
        rows = list(_requests)
    if since_s is not None:
        rows = [r for r in rows if r[0] >= now - since_s]
    n = len(rows)
    errors = sum(1 for r in rows if r[1] >= 500)
    lat = [r[2] for r in rows]
    return {
        "requests": n,
        "errors_5xx": errors,
        "client_errors_4xx": sum(1 for r in rows if 400 <= r[1] < 500),
        "error_rate": round(errors / n, 4) if n else None,
        "p50_ms": _pct(lat, 0.5),
        "p95_ms": _pct(lat, 0.95),
        "oldest_at": datetime.fromtimestamp(rows[0][0], timezone.utc).isoformat() if rows else None,
        "process_started_at": datetime.fromtimestamp(PROCESS_STARTED_AT, timezone.utc).isoformat(),
        "scope": "this API process",
    }


def reset_requests() -> None:
    with _req_lock:
        _requests.clear()


# ── Host metrics ─────────────────────────────────────────────────────────────

def host_metrics() -> Dict[str, Any]:
    try:
        import psutil  # type: ignore
    except Exception:  # noqa: BLE001
        return {"available": False, "reason": "psutil not installed", "cpu_percent": None, "memory_percent": None}
    try:
        vm = psutil.virtual_memory()
        proc = psutil.Process()
        return {
            "available": True,
            "cpu_percent": round(psutil.cpu_percent(interval=0.25), 1),
            "cpu_count": psutil.cpu_count(),
            "memory_percent": round(vm.percent, 1),
            "memory_used_mb": int((vm.total - vm.available) / 1e6),
            "memory_total_mb": int(vm.total / 1e6),
            "process_rss_mb": int(proc.memory_info().rss / 1e6),
            "load_avg": [round(x, 2) for x in os.getloadavg()] if hasattr(os, "getloadavg") else None,
        }
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": type(exc).__name__, "cpu_percent": None, "memory_percent": None}


# ── Daily activity ───────────────────────────────────────────────────────────

_seen: set = set()
_seen_lock = threading.Lock()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def touch_activity(user_id: Optional[int]) -> None:
    if not user_id:
        return
    key = (int(user_id), _today())
    with _seen_lock:
        if key in _seen:
            return
        if len(_seen) > 200_000:
            _seen.clear()
        _seen.add(key)

    def _write():
        from sqlalchemy.exc import IntegrityError
        from app.models.admin import UserActivityDay
        s = _session()
        if s is None:
            return
        try:
            if s.get(UserActivityDay, {"user_id": key[0], "day": key[1]}) is None:
                s.add(UserActivityDay(user_id=key[0], day=key[1]))
                s.commit()
        except IntegrityError:
            s.rollback()  # another worker wrote it first
        finally:
            s.close()

    _submit(_write)


# ── System status history + ops events ───────────────────────────────────────

_last_statuses: Dict[str, str] = {}


def _compact(snapshot: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [{"id": s.get("id"), "name": s.get("name"), "group": s.get("group"), "status": s.get("status"),
             "latency_ms": s.get("latency_ms")} for s in snapshot.get("services") or []]


def transitions(prev: Dict[str, str], services: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Status changes worth an ops event (ignores pending / not configured)."""
    out = []
    for s in services:
        sid, st = s.get("id"), s.get("status")
        if st in ("pending", "not_configured") or sid is None:
            continue
        before = prev.get(sid)
        if before is not None and before != st:
            sev = "critical" if st == "down" else "warning" if st == "degraded" else "ok"
            verb = {"down": "is down", "degraded": "is degraded", "ok": "recovered"}.get(st, f"is {st}")
            out.append({"severity": sev, "title": f"{s.get('name') or sid} {verb}",
                        "details": {"service": sid, "from": before, "to": st}})
        prev[sid] = st
    return out


def store_status_snapshot(snapshot: Dict[str, Any]) -> None:
    from app.models.admin import OpsEvent, SystemStatusSnapshot
    services = _compact(snapshot)
    events = transitions(_last_statuses, services)
    s = _session()
    if s is None:
        return
    try:
        s.add(SystemStatusSnapshot(overall=str(snapshot.get("overall") or "unknown"), services=services))
        for e in events:
            s.add(OpsEvent(kind="service_status", severity=e["severity"], title=e["title"][:200], details=e["details"]))
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


async def status_history_loop() -> None:
    """Collector extra task: snapshot every SNAPSHOT_EVERY_S while leader."""
    from app.services import system_status as ss
    await asyncio.sleep(60)  # let the first probes land
    while True:
        try:
            c = ss.get_collector()
            if c is not None and c.is_leader:
                snap = c.snapshot()
                await asyncio.to_thread(_guarded, lambda: store_status_snapshot(snap))
        except Exception:  # noqa: BLE001
            logger.debug("status snapshot failed", exc_info=True)
        await asyncio.sleep(SNAPSHOT_EVERY_S)


def record_deploy() -> None:
    sha = os.environ.get("GIT_SHA") or ""
    if not sha or sha == "unknown":
        return

    def _write():
        from app.models.admin import OpsEvent
        s = _session()
        if s is None:
            return
        try:
            last = (s.query(OpsEvent).filter(OpsEvent.kind == "deploy").order_by(OpsEvent.ts.desc()).first())
            if last is None or (last.details or {}).get("version") != sha:
                s.add(OpsEvent(kind="deploy", severity="info", title=f"Deployed version {sha[:12]}",
                               details={"version": sha}))
                s.commit()
        finally:
            s.close()

    _submit(_write)


# ── Copilot request metrics ──────────────────────────────────────────────────

def _is_retrieval_tool(name: str) -> bool:
    n = (name or "").lower()
    return "filing" in n or "search" in n or "rag" in n or n.startswith("sec_")


def copilot_row(data: Dict[str, Any]) -> Dict[str, Any]:
    stages = data.get("stages_ms") or {}
    tools = data.get("tools") or []
    rt = [t for t in tools if _is_retrieval_tool(str(t.get("name")))]
    err = data.get("error")
    return {
        "user_id": data.get("user_id") if isinstance(data.get("user_id"), int) else None,
        "provider": (data.get("provider") or None) and str(data.get("provider"))[:32],
        "model": (data.get("model") or None) and str(data.get("model"))[:120],
        "ok": not err,
        "error": (err or None) and str(err)[:64],
        "refusal": bool(data.get("refusal")),
        "total_ms": stages.get("total"),
        "first_token_ms": stages.get("first_token"),
        "chain_index": data.get("chain_index"),
        "retrieval_calls": len(rt),
        "retrieval_empty": sum(1 for t in rt if not t.get("facts")),
        "retrieval_ms": sum(int(t.get("ms") or 0) for t in rt) if rt else None,
        "citations": len(data.get("cited") or []),
        "invalid_citations": len(data.get("invalid_citations") or []),
        "policy_flags": len(data.get("policy_flags") or []),
    }


def record_copilot_trace(data: Dict[str, Any]) -> None:
    try:
        row = copilot_row(data)
    except Exception:  # noqa: BLE001
        return

    def _write():
        from app.models.admin import CopilotRequestMetric
        s = _session()
        if s is None:
            return
        try:
            s.add(CopilotRequestMetric(**row))
            s.commit()
        finally:
            s.close()

    _submit(_write)
