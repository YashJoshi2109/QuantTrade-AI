"""Live system status: a background collector that probes every dependency on
its own cadence and serves the latest results from memory.

  GET /api/v1/system/status  ->  SystemStatusCollector.snapshot()

The request path never probes anything: it serialises the in-memory results.
Each probe runs in its own asyncio task (``interval_s`` apart, bounded by
``timeout_s``) started from the FastAPI lifespan.  Results are mirrored to a
Redis hash so several API workers agree, and probes marked ``shared`` (the ones
that call a third party) run only on the worker holding a short Redis lease;
the others read that worker's results.  Without Redis every probe runs locally.

Status vocabulary per service:
  ok | degraded | down | not_configured   (+ ``pending`` before the first check)

Aggregation (``overall``):
  down      a ``critical`` service is down
  degraded  any configured service is degraded or down
  ok        otherwise

A result older than ``STALE_FACTOR`` x interval is reported degraded (the
probe loop is stuck), older than ``DEAD_FACTOR`` x interval as down.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

OK, DEGRADED, DOWN, NOT_CONFIGURED, PENDING = "ok", "degraded", "down", "not_configured", "pending"
STATUSES = (OK, DEGRADED, DOWN, NOT_CONFIGURED, PENDING)
_RANK = {OK: 0, NOT_CONFIGURED: 0, PENDING: 0, DEGRADED: 1, DOWN: 2}

STALE_FACTOR = 3.0
DEAD_FACTOR = 10.0
STALE_GRACE_S = 10.0     # never call a result stale before interval + this

REDIS_RESULTS = "qt:system:status:probes"
REDIS_LEADER = "qt:system:status:leader"
LEADER_TTL_S = 15

GROUPS = ("core", "market_data", "intelligence")


def iso(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def worst(*statuses: str) -> str:
    return max(statuses, key=lambda s: _RANK.get(s, 0)) if statuses else OK


def age_status(age_s: Optional[float], degraded_after: float, down_after: Optional[float] = None) -> str:
    """ok / degraded / down from the age of the last good signal (None = never)."""
    if age_s is None:
        return DOWN if down_after is not None else DEGRADED
    if down_after is not None and age_s >= down_after:
        return DOWN
    if age_s >= degraded_after:
        return DEGRADED
    return OK


def fmt_age(age_s: Optional[float]) -> str:
    if age_s is None:
        return "never"
    s = int(max(0, age_s))
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m"
    if s < 86400:
        return f"{s // 3600}h {s % 3600 // 60}m"
    return f"{s // 86400}d {s % 86400 // 3600}h"


def quota(used: Optional[int], limit: Optional[int], resets_at: Optional[float] = None,
          window: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if limit is None or used is None:
        return None
    used = max(0, int(used))
    return {"used": used, "limit": int(limit), "remaining": max(0, int(limit) - used),
            "resets_at": iso(resets_at), "window": window}


@dataclass
class ProbeResult:
    status: str
    detail: str = ""
    latency_ms: Optional[float] = None
    last_ok_at: Optional[float] = None       # probe knows when the service last worked
    quota: Optional[Dict[str, Any]] = None
    meta: Dict[str, Any] = field(default_factory=dict)


ProbeFn = Callable[["ProbeContext"], Awaitable[ProbeResult]]


@dataclass
class Probe:
    id: str
    name: str
    group: str
    interval_s: float
    fn: ProbeFn
    timeout_s: float = 10.0
    critical: bool = False
    shared: bool = False          # calls a third party: one worker runs it
    method: str = ""              # human description for docs / the API
    can_cost: bool = False        # whether a run of this probe can spend money/quota


@dataclass
class ProbeContext:
    """What probes may read.  ``app`` is the FastAPI app (or None in tests)."""
    app: Any = None
    redis: Any = None
    collector: Optional["SystemStatusCollector"] = None
    meter: Dict[str, Dict[str, Any]] = field(default_factory=dict)   # merged provider meter
    daily: Dict[str, int] = field(default_factory=dict)              # shared UTC-day counts
    now: Callable[[], float] = time.time


class SystemStatusCollector:
    def __init__(self, probes: List[Probe], *, redis=None, app=None, clock: Callable[[], float] = time.time,
                 worker_id: Optional[str] = None) -> None:
        ids = [p.id for p in probes]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate probe id")
        self.probes = list(probes)
        self._by_id = {p.id: p for p in probes}
        self.redis = redis
        self.clock = clock
        self.ctx = ProbeContext(app=app, redis=redis, collector=self, now=clock)
        self.results: Dict[str, Dict[str, Any]] = {}
        self.started_at = clock()
        self.worker_id = worker_id or f"{os.uname().nodename if hasattr(os, 'uname') else 'host'}:{os.getpid()}"
        self.is_leader = redis is None
        self._tasks: List[asyncio.Task] = []
        self._extra: List[Callable[[], Awaitable[None]]] = []
        self.shared_meters: Dict[str, Dict[str, Any]] = {}   # other processes' provider meters
        self.running = False

    # ── probing ──────────────────────────────────────────────────────────
    async def run_probe(self, probe: Probe) -> Dict[str, Any]:
        t0 = time.perf_counter()
        try:
            res = await asyncio.wait_for(probe.fn(self.ctx), timeout=probe.timeout_s)
            if res.status not in STATUSES:
                res = ProbeResult(DEGRADED, f"probe returned unknown status {res.status!r}")
        except asyncio.TimeoutError:
            res = ProbeResult(DOWN, f"Health check timed out after {probe.timeout_s:.0f}s",
                              latency_ms=probe.timeout_s * 1000)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug("probe %s failed", probe.id, exc_info=True)
            res = ProbeResult(DOWN, f"Health check error: {type(e).__name__}: {str(e)[:120]}")
        now = self.clock()
        prev = self.results.get(probe.id) or {}
        last_ok = res.last_ok_at
        if last_ok is None:
            last_ok = now if res.status == OK else prev.get("last_ok_ts")
        rec = {
            "status": res.status,
            "detail": res.detail,
            "latency_ms": None if res.latency_ms is None else round(float(res.latency_ms), 1),
            "last_ok_ts": last_ok,
            "last_checked_ts": now,
            "quota": res.quota,
            "meta": res.meta or {},
            "probe_ms": round((time.perf_counter() - t0) * 1000, 1),
        }
        self.results[probe.id] = rec
        await self._mirror(probe.id, rec)
        return rec

    async def _mirror(self, pid: str, rec: Dict[str, Any]) -> None:
        if self.redis is None:
            return
        try:
            await self.redis.hset(REDIS_RESULTS, pid, json.dumps({**rec, "by": self.worker_id}, default=str))
            await self.redis.expire(REDIS_RESULTS, 3600)
        except Exception as e:
            logger.debug("status mirror failed: %s", e)

    async def _read_mirror(self, pid: str) -> Optional[Dict[str, Any]]:
        if self.redis is None:
            return None
        try:
            raw = await self.redis.hget(REDIS_RESULTS, pid)
            return json.loads(raw) if raw else None
        except Exception:
            return None

    async def _renew_leader(self) -> None:
        if self.redis is None:
            self.is_leader = True
            return
        try:
            ok = await self.redis.set(REDIS_LEADER, self.worker_id, ex=LEADER_TTL_S, nx=True)
            if ok:
                self.is_leader = True
                return
            holder = await self.redis.get(REDIS_LEADER)
            if holder == self.worker_id:
                await self.redis.expire(REDIS_LEADER, LEADER_TTL_S)
                self.is_leader = True
            else:
                self.is_leader = False
        except Exception:
            self.is_leader = True     # Redis trouble: probe locally rather than go blind

    async def _loop(self, probe: Probe) -> None:
        # Spread the first runs so startup does not fire every probe at once.
        await asyncio.sleep(min(2.0, (abs(hash(probe.id)) % 1000) / 1000.0))
        while self.running:
            try:
                if probe.shared and not self.is_leader:
                    rec = await self._read_mirror(probe.id)
                    if rec:
                        rec.pop("by", None)
                        self.results[probe.id] = rec
                    else:
                        await self.run_probe(probe)
                else:
                    await self.run_probe(probe)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("status probe loop %s", probe.id)
            await asyncio.sleep(probe.interval_s)

    async def _leader_loop(self) -> None:
        while self.running:
            await self._renew_leader()
            await asyncio.sleep(LEADER_TTL_S / 3)

    def add_task(self, fn: Callable[[], Awaitable[None]]) -> None:
        """Extra background coroutine (e.g. the meter publisher) owned by the collector."""
        self._extra.append(fn)

    def start(self) -> None:
        if self.running:
            return
        self.running = True
        loop = asyncio.get_running_loop()
        self._tasks.append(loop.create_task(self._leader_loop(), name="status-leader"))
        for fn in self._extra:
            self._tasks.append(loop.create_task(fn(), name="status-extra"))
        for p in self.probes:
            self._tasks.append(loop.create_task(self._loop(p), name=f"status-{p.id}"))

    async def stop(self) -> None:
        self.running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    # ── reading ──────────────────────────────────────────────────────────
    def service(self, probe: Probe, now: float) -> Dict[str, Any]:
        rec = self.results.get(probe.id)
        base = {"id": probe.id, "name": probe.name, "group": probe.group, "critical": probe.critical,
                "interval_s": probe.interval_s}
        if rec is None:
            return {**base, "status": PENDING, "latency_ms": None, "last_ok_at": None, "last_checked_at": None,
                    "detail": "Waiting for the first check", "quota": None, "meta": {}}
        status, detail = rec["status"], rec.get("detail") or ""
        checked = rec.get("last_checked_ts")
        age = None if checked is None else now - checked
        stale_after = max(probe.interval_s * STALE_FACTOR, probe.interval_s + STALE_GRACE_S)
        dead_after = max(probe.interval_s * DEAD_FACTOR, probe.interval_s + 6 * STALE_GRACE_S)
        if age is not None and age > stale_after and status != NOT_CONFIGURED:
            stale_status = DOWN if age > dead_after else DEGRADED
            status = worst(status, stale_status)
            detail = f"Health check is stale (last run {fmt_age(age)} ago). {detail}".strip()
        out = {**base, "status": status, "latency_ms": rec.get("latency_ms"),
               "last_ok_at": iso(rec.get("last_ok_ts")), "last_checked_at": iso(checked),
               "detail": detail, "meta": rec.get("meta") or {}}
        out["quota"] = rec.get("quota")
        return out

    def snapshot(self) -> Dict[str, Any]:
        now = self.clock()
        services = [self.service(p, now) for p in self.probes]
        return {"generated_at": iso(now), **aggregate(services),
                "services": services,
                "collector": {"running": self.running, "started_at": iso(self.started_at),
                              "leader": self.is_leader}}


def aggregate(services: List[Dict[str, Any]]) -> Dict[str, Any]:
    counted = [s for s in services if s["status"] not in (NOT_CONFIGURED, PENDING)]
    bad = [s for s in counted if s["status"] in (DEGRADED, DOWN)]
    critical_down = [s for s in counted if s["status"] == DOWN and s.get("critical")]
    if critical_down:
        overall = DOWN
    elif bad:
        overall = DEGRADED
    else:
        overall = OK
    counts = {k: 0 for k in STATUSES}
    for s in services:
        counts[s["status"]] = counts.get(s["status"], 0) + 1
    return {"overall": overall, "counts": counts, "issues": [s["id"] for s in bad]}


# ── process singleton ───────────────────────────────────────────────────

_collector: Optional[SystemStatusCollector] = None


def get_collector() -> Optional[SystemStatusCollector]:
    return _collector


def set_collector(c: Optional[SystemStatusCollector]) -> None:
    global _collector
    _collector = c


def enabled() -> bool:
    return os.environ.get("SYSTEM_STATUS_ENABLED", "1") != "0"
