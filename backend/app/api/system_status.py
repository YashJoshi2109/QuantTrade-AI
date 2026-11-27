"""GET /api/v1/system/status — live status of every dependency.

Served from the background collector's in-memory snapshot (no probing on the
request path), so polling it every second is cheap.  The body is the same for
every caller (no user data), which lets nginx micro-cache it for 1 s even for
signed-in users.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.services import system_status as ss

router = APIRouter()

CACHE_CONTROL = "public, max-age=1"


@router.get("/system/status")
async def system_status():
    c = ss.get_collector()
    if c is None:
        # Collector disabled (SYSTEM_STATUS_ENABLED=0) or not started yet.
        from app.services.system_probes import default_probes
        services = [{"id": p.id, "name": p.name, "group": p.group, "critical": p.critical,
                     "interval_s": p.interval_s, "status": ss.PENDING, "latency_ms": None,
                     "last_ok_at": None, "last_checked_at": None, "quota": None, "meta": {},
                     "detail": "Status collector is not running in this API process"}
                    for p in default_probes()]
        import time
        body = {"generated_at": ss.iso(time.time()), **ss.aggregate(services), "services": services,
                "collector": {"running": False, "started_at": None, "leader": False}}
    else:
        body = c.snapshot()
    return JSONResponse(content=body, headers={"Cache-Control": CACHE_CONTROL})
