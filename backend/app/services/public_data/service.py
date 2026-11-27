"""On-demand freshness for per-ticker datasets + the scheduled refresh jobs.

Per-ticker datasets (Form 4, FINRA short interest, filing language) are
refreshed when a user asks for a stale ticker: ``ensure()`` starts one
background refresh per (dataset, ticker) and waits up to a small budget; the
API answers ``syncing: true`` if it is still running and the frontend polls.

Bulk datasets (SEC Financial Statement Data Sets, 13F data sets) are only
loaded by the scheduled jobs for the refresh universe; a ticker outside it is
recorded (``public_data_loads`` dataset ``requested``) and included next run.

Schedule (APScheduler in app.main, UTC; one deployment runs background jobs):
  macro_daily       22:45 Mon-Fri   Treasury par curve (current year), FRED series
  bls_daily         14:00 daily     BLS CPI-U + unemployment (1 API query)
  ff_weekly         Sat 06:00       Fama-French 5-factor daily file
  form4_daily       11:00 daily     Form 4 for the universe (new accessions only)
  finra_daily       23:30 Mon-Fri   Reg SHO short-sale volume + short interest (only if FINRA_DATA_ENABLED=1)
  fsds_daily        07:00 daily     load the 2 latest quarterly FSDS ZIPs if not yet loaded
  f13_daily         07:40 daily     load the 2 latest 13F data sets if not yet loaded
  filing_lang_daily 08:30 daily     language metrics, up to 8 stale tickers per run
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from app.services.public_data import store
from app.services.public_data.sec_common import norm_ticker, universe

logger = logging.getLogger(__name__)

STALE_H = {"form4": 12, "finra_si": 24, "filing_lang": 24 * 7, "macro_curve": 6}
_INFLIGHT: Dict[str, threading.Thread] = {}
_LOCK = threading.Lock()


def _session_factory():
    from app.db.database import SessionLocal
    return SessionLocal


_FACTORY: Optional[Callable] = None


def set_session_factory(f: Optional[Callable]) -> None:
    """Tests: run refreshes against a test DB."""
    global _FACTORY
    _FACTORY = f


def session_factory():
    return _FACTORY or _session_factory()


def _run(dataset: str, ticker: str) -> None:
    SessionLocal = session_factory()
    db = SessionLocal()
    try:
        if dataset == "form4":
            from app.services.public_data.sec_form4 import refresh_ticker
            refresh_ticker(db, ticker)
        elif dataset == "finra_si":
            from app.services.public_data.finra import refresh_regsho, refresh_short_interest
            refresh_short_interest(db, ticker)
            refresh_regsho(db, [ticker], days=10)
        elif dataset == "filing_lang":
            from app.services.public_data.filing_language import compute_ticker
            compute_ticker(db, ticker)
        elif dataset == "macro_curve":            # ticker = "UST"
            from app.services.public_data import macro
            n = macro.refresh_treasury(db)
            store.mark_load(db, "macro_curve", ticker, rows=n)
    except Exception as e:
        logger.warning("public-data refresh %s %s failed: %s", dataset, ticker, e)
        try:
            db.rollback()
            store.mark_load(db, dataset, ticker, status="error", note=f"{type(e).__name__}: {e}")
        except Exception:
            pass
    finally:
        db.close()


def is_stale(db, dataset: str, ticker: str) -> bool:
    row = store.load_row(db, dataset, ticker)
    if row is None:
        return True
    age = datetime.now(timezone.utc) - store.aware(row.loaded_at)
    if row.status == "error":
        return age > timedelta(minutes=30)
    return age > timedelta(hours=STALE_H.get(dataset, 24))


def with_db(fn):
    """Run ``fn(db)`` with a fresh session (call it via asyncio.to_thread)."""
    SessionLocal = session_factory()
    if SessionLocal is None:
        raise LookupError("database not configured")
    db = SessionLocal()
    try:
        return fn(db)
    finally:
        db.close()


async def ensure(dataset: str, ticker: str, budget_s: float = 8.0) -> Dict[str, Any]:
    """Refresh a stale per-ticker dataset; wait at most ``budget_s``.
    All DB work runs in worker threads (never on the event loop)."""
    t = norm_ticker(ticker)
    if not await asyncio.to_thread(with_db, lambda db: is_stale(db, dataset, t)):
        return {"syncing": False, "error": None}
    key = f"{dataset}:{t}"
    with _LOCK:
        th = _INFLIGHT.get(key)
        if th is None or not th.is_alive():
            th = threading.Thread(target=_run, args=(dataset, t), daemon=True, name=f"public-data-{key}")
            _INFLIGHT[key] = th
            th.start()
    await asyncio.to_thread(th.join, budget_s)

    def err(db):
        row = store.load_row(db, dataset, t)
        return row.note if row is not None and row.status == "error" else None
    return {"syncing": th.is_alive(), "error": await asyncio.to_thread(with_db, err)}


def request_bulk(db, ticker: str) -> None:
    """Remember a ticker outside the bulk-data universe for the next scheduled load."""
    t = norm_ticker(ticker)
    if store.load_row(db, "requested", t) is None:
        store.mark_load(db, "requested", t, status="queued")


def requested(db) -> List[str]:
    from app.models.public_data import PublicDataLoad
    return [r.key for r in db.query(PublicDataLoad).filter_by(dataset="requested").limit(400)]


# ── scheduled jobs (sync; run in the APScheduler thread) ──────────────────

def _job(name: str, fn) -> Dict[str, Any]:
    SessionLocal = session_factory()
    if SessionLocal is None:
        return {"skipped": "no database"}
    db = SessionLocal()
    try:
        res = fn(db)
        logger.info("public-data job %s: %s", name, res)
        return res
    except Exception as e:
        db.rollback()
        logger.warning("public-data job %s failed: %s", name, e)
        return {"error": f"{type(e).__name__}: {e}"}
    finally:
        db.close()


def job_macro_daily() -> Dict[str, Any]:
    from app.services.public_data import macro

    def run(db):
        return {"treasury": macro.refresh_treasury(db), "fred": macro.refresh_fred(db, start="2020-01-01")}
    return _job("macro_daily", run)


def job_bls_daily() -> Dict[str, Any]:
    from app.services.public_data import macro
    return _job("bls_daily", lambda db: {"bls": macro.refresh_bls(db)})


def job_ff_weekly() -> Dict[str, Any]:
    from app.services.public_data import macro
    return _job("ff_weekly", lambda db: {"ff5": macro.refresh_ff(db)})


def job_form4_daily() -> Dict[str, Any]:
    from app.services.public_data.sec_form4 import refresh_ticker

    def run(db):
        out = {}
        for t in universe(requested(db)):
            try:
                out[t] = refresh_ticker(db, t)["rows_added"]
            except Exception as e:
                db.rollback()
                out[t] = f"error: {type(e).__name__}"
        return out
    return _job("form4_daily", run)


def job_finra_daily() -> Dict[str, Any]:
    from app.services.public_data import finra
    from app.services.public_data.sources import enabled
    if not enabled("finra_si"):
        return {"skipped": "FINRA_DATA_ENABLED is not 1 (FINRA terms: display needs written consent)"}

    def run(db):
        tick = universe(requested(db))
        n = finra.refresh_regsho(db, tick, days=5)
        si = 0
        for t in tick:
            try:
                si += finra.refresh_short_interest(db, t, days=60)
            except Exception as e:
                db.rollback()
                logger.info("finra si %s: %s", t, e)
        return {"short_volume_rows": n, "short_interest_rows": si}
    return _job("finra_daily", run)


def _ciks(tickers: List[str]):
    from app.services.public_data.sec_common import cik_for
    return {c for c in (cik_for(t) for t in tickers) if c}


def job_fsds_daily(today: Optional[date] = None) -> Dict[str, Any]:
    from app.services.public_data import sec_fsds

    def run(db):
        ciks = _ciks(universe(requested(db)))
        out = {}
        for key in sec_fsds.recent_quarters(today or date.today(), 2):
            try:
                out[key] = sec_fsds.load_quarter(db, key, ciks)
            except Exception as e:          # the newest quarter may not be published yet
                db.rollback()
                out[key] = f"unavailable: {type(e).__name__}: {e}"
        return out
    return _job("fsds_daily", run)


def job_13f_daily() -> Dict[str, Any]:
    from app.services.public_data import sec_13f

    def run(db):
        tick = universe(requested(db))
        out = {}
        for ds in reversed(sec_13f.list_datasets()[:2]):         # older first, so QoQ has its base
            out[ds["key"]] = sec_13f.load_dataset(db, ds["key"], ds["url"], tick)
        return out
    return _job("13f_daily", run)


def job_filing_lang_daily(max_tickers: int = 8) -> Dict[str, Any]:
    from app.services.public_data.filing_language import compute_ticker

    def run(db):
        out = {}
        for t in universe(requested(db)):
            if len(out) >= max_tickers:
                break
            if not is_stale(db, "filing_lang", t):
                continue
            try:
                out[t] = compute_ticker(db, t)["rows"]
            except Exception as e:
                db.rollback()
                store.mark_load(db, "filing_lang", t, status="error", note=str(e))
                out[t] = f"error: {type(e).__name__}"
        return out
    return _job("filing_lang_daily", run)


JOBS = {
    "macro_daily": job_macro_daily, "bls_daily": job_bls_daily, "ff_weekly": job_ff_weekly,
    "form4_daily": job_form4_daily, "finra_daily": job_finra_daily, "fsds_daily": job_fsds_daily,
    "13f_daily": job_13f_daily, "filing_lang_daily": job_filing_lang_daily,
}


def schedule(sched) -> None:
    """Register the jobs on the app's BackgroundScheduler."""
    from apscheduler.triggers.cron import CronTrigger
    specs = [
        ("macro_daily", CronTrigger(day_of_week="mon-fri", hour=22, minute=45)),
        ("bls_daily", CronTrigger(hour=14, minute=0)),
        ("ff_weekly", CronTrigger(day_of_week="sat", hour=6, minute=0)),
        ("form4_daily", CronTrigger(hour=11, minute=0)),
        ("finra_daily", CronTrigger(day_of_week="mon-fri", hour=23, minute=30)),
        ("fsds_daily", CronTrigger(hour=7, minute=0)),
        ("13f_daily", CronTrigger(hour=7, minute=40)),
        ("filing_lang_daily", CronTrigger(hour=8, minute=30)),
    ]
    for name, trig in specs:
        sched.add_job(JOBS[name], trig, id=f"public_data_{name}", replace_existing=True,
                      max_instances=1, coalesce=True, misfire_grace_time=3600)
