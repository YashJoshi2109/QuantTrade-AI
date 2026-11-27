"""Free / public-domain datasets API (/api/v1/datasets/...).

Every response carries ``attribution`` ({text: "Source: <agency>, as of <date>",
url, licence ...}) and a ``status``: ok | not_loaded | disabled, plus
``syncing`` while an on-demand refresh is still running (the UI polls).
``as_of`` (ISO date/datetime) returns the point-in-time view: only rows with
``available_at <= as_of``.

All DB work runs in worker threads (``service.with_db``); handlers never block
the event loop.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.services.public_data import service
from app.services.public_data.sources import disabled_payload, enabled

router = APIRouter(prefix="/datasets", tags=["public-datasets"])

_SYM = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")


def _sym(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if not _SYM.match(s):
        raise HTTPException(status_code=400, detail="invalid symbol")
    return s.replace(".", "-")


def _as_of(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(v + "T23:59:59+00:00" if len(v) == 10 else v.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="as_of must be YYYY-MM-DD or ISO datetime")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _read(fn):
    try:
        return await asyncio.to_thread(service.with_db, fn)
    except LookupError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/insiders/{symbol}")
async def insiders(symbol: str, days: int = Query(180, ge=30, le=365), limit: int = Query(40, ge=1, le=200),
                   as_of: Optional[str] = None):
    from app.services.public_data.sec_form4 import insider_payload
    s, ao = _sym(symbol), _as_of(as_of)
    sync = await service.ensure("form4", s, 10.0) if ao is None else {"syncing": False, "error": None}
    out = await _read(lambda db: insider_payload(db, s, days=days, limit=limit, as_of=ao))
    out.update(syncing=sync["syncing"], refresh_error=sync.get("error"))
    return out


@router.get("/institutional/{symbol}")
async def institutional(symbol: str, top: int = Query(15, ge=1, le=50), as_of: Optional[str] = None):
    from app.services.public_data.sec_13f import ownership_payload
    s, ao = _sym(symbol), _as_of(as_of)

    def run(db):
        out = ownership_payload(db, s, top=top, as_of=ao)
        if out["status"] == "not_loaded":
            service.request_bulk(db, s)
            out["reason"] = ("13F holdings for this ticker are not loaded yet. It has been added to the next "
                             "scheduled 13F data-set load (daily 07:40 UTC).")
        return out
    out = await _read(run)
    out["syncing"] = False
    return out


@router.get("/short-interest/{symbol}")
async def short_interest(symbol: str, as_of: Optional[str] = None):
    from app.services.public_data.finra import short_payload
    if not enabled("finra_si"):
        return {**disabled_payload("finra_si"), "symbol": _sym(symbol), "syncing": False}
    s, ao = _sym(symbol), _as_of(as_of)
    sync = await service.ensure("finra_si", s, 8.0) if ao is None else {"syncing": False, "error": None}
    out = await _read(lambda db: short_payload(db, s, as_of=ao))
    out.update(syncing=sync["syncing"], refresh_error=sync.get("error"))
    return out


@router.get("/filing-language/{symbol}")
async def filing_language(symbol: str, limit: int = Query(8, ge=1, le=20), as_of: Optional[str] = None):
    from app.services.public_data.filing_language import language_payload
    s, ao = _sym(symbol), _as_of(as_of)
    sync = await service.ensure("filing_lang", s, 4.0) if ao is None else {"syncing": False, "error": None}
    out = await _read(lambda db: language_payload(db, s, limit=limit, as_of=ao))
    out.update(syncing=sync["syncing"], refresh_error=sync.get("error"))
    return out


@router.get("/fundamentals-pit/{symbol}")
async def fundamentals_pit(symbol: str, as_of: str = Query(..., description="YYYY-MM-DD"),
                           tags: str = Query("Revenues,RevenueFromContractWithCustomerExcludingAssessedTax,"
                                             "NetIncomeLoss,EarningsPerShareDiluted,Assets,StockholdersEquity"),
                           qtrs: Optional[int] = Query(None, ge=0, le=4)):
    from app.services.public_data.sec_fsds import pit_values
    from app.services.public_data.sources import attribution
    s, ao = _sym(symbol), _as_of(as_of)
    want = [t.strip() for t in tags.split(",") if t.strip()][:30]

    def run(db):
        vals = pit_values(db, s, ao, want, qtrs=qtrs)
        if not vals:
            service.request_bulk(db, s)
        latest = max((v["filed"] for v in vals.values()), default=None)
        return {"ticker": s, "as_of": as_of, "status": "ok" if vals else "not_loaded", "values": vals,
                "notes": ["Values as originally filed, from filings accepted on or before as_of (no look-ahead). "
                          "Period ends are rounded to month end by the SEC data set."],
                "attribution": attribution("sec_fsds", latest)}
    return await _read(run)


@router.get("/macro/yield-curve")
async def yield_curve(as_of: Optional[str] = None):
    from app.services.public_data import macro
    ao = _as_of(as_of)
    sync = await service.ensure("macro_curve", "UST", 8.0) if ao is None else {"syncing": False, "error": None}
    out = await _read(lambda db: macro.yield_curve(db, ao))
    out.update(syncing=sync["syncing"], refresh_error=sync.get("error"))
    return out


@router.get("/macro/risk-free")
async def risk_free(tenor_years: float = Query(10.0, gt=0, le=30), as_of: Optional[str] = None):
    from app.services.public_data import macro
    from app.services.public_data.sources import attribution
    ao = _as_of(as_of)
    out = await _read(lambda db: macro.risk_free_pct(db, tenor_years, ao))
    if out is None:
        return {"status": "not_loaded", "attribution": attribution("treasury", None)}
    return {"status": "ok", **out, "attribution": attribution("treasury", out["date"])}


@router.get("/macro/series")
async def macro_series(ids: str = Query("DGS10,DGS2,DTB3,CPIAUCSL,UNRATE"), start: Optional[str] = None,
                       as_of: Optional[str] = None):
    from app.services.public_data import macro
    from app.services.public_data.sources import attribution
    want = [i.strip().upper() for i in ids.split(",") if i.strip()][:20]
    ao = _as_of(as_of)
    data = await _read(lambda db: macro.series(db, want, start, ao))
    attrib = {}
    for sid, d in data.items():
        k = "ff" if sid.startswith("FF5_") else ("bls" if sid.startswith("BLS_") else
                                                 ("treasury" if sid.startswith("UST_") else "fred"))
        latest = (d.get("latest") or {}).get("date")
        attrib[sid] = attribution(k, latest, extra=d.get("source"))
    return {"series": data, "attribution": attrib}


@router.get("/status")
async def status():
    from app.models.public_data import PublicDataLoad
    from app.services.public_data.sources import SOURCES

    def run(db):
        rows = (db.query(PublicDataLoad).filter(PublicDataLoad.dataset != "requested")
                .order_by(PublicDataLoad.loaded_at.desc()).limit(200).all())
        latest = {}
        for r in rows:
            latest.setdefault(r.dataset, {"key": r.key, "status": r.status, "rows": r.rows,
                                          "loaded_at": r.loaded_at.isoformat() if r.loaded_at else None})
        return latest
    loads = await _read(run)
    return {"datasets": {k: {**v, "enabled": enabled(k)} for k, v in SOURCES.items()}, "latest_loads": loads}
