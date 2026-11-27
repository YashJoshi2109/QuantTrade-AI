"""The real probes behind /api/v1/system/status (see app.services.system_status).

Cost rules (enforced here, documented in PROBE_DOCS / the PR):
  * Quota-metered providers (Finnhub 60/min, FMP 250/day, Twelve Data,
    Alpha Vantage) are NEVER called by a probe: their status comes from the
    passive provider meter (app.services.provider_meter), i.e. real traffic.
  * Free / unmetered upstreams (Yahoo chart, SEC EDGAR, Alpaca IEX data,
    Public.com quotes) get one tiny request at a slow cadence, and only when
    real traffic has not already exercised them within that interval.
  * The Copilot synthetic check is the only probe that can cost money: the
    cheapest configured model, an 8-token answer, at most every 5 minutes, and
    skipped when real Copilot traffic succeeded in that window.
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.services import provider_meter as pm
from app.services.system_status import (DEGRADED, DOWN, NOT_CONFIGURED, OK, Probe, ProbeContext, ProbeResult,
                                        fmt_age, quota, worst)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _ts(dt: Optional[datetime]) -> Optional[float]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _ms(t0: float) -> float:
    return (time.perf_counter() - t0) * 1000


def _market_regular() -> bool:
    try:
        from app.services import market_calendar as mc
        return mc.session_at() == mc.REGULAR
    except Exception:
        return False


def _next_utc_midnight(now: float) -> float:
    d = datetime.fromtimestamp(now, tz=timezone.utc).date() + timedelta(days=1)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


# ── provider meter → status ──────────────────────────────────────────────

def meter_result(ctx: ProbeContext, provider: str, *, configured: bool, label: str,
                 minute_limit: Optional[int] = None, day_limit: Optional[int] = None,
                 idle_note: str = "No calls yet since the API started") -> ProbeResult:
    """Status of a provider from real traffic only (never spends a call)."""
    if not configured:
        return ProbeResult(NOT_CONFIGURED, f"{label} key is not set")
    now = ctx.now()
    m = ctx.meter.get(provider) or {}
    minute_used = len([t for t in m.get("minute_calls") or [] if t >= now - pm.WINDOW_S])
    day_used = max(int(ctx.daily.get(provider, 0)), int(m.get("day_count") or 0))
    q = None
    if day_limit is not None:
        q = quota(day_used, day_limit, _next_utc_midnight(now), "day (UTC)")
    elif minute_limit is not None:
        oldest = min(m.get("minute_calls") or [now])
        q = quota(minute_used, minute_limit, oldest + pm.WINDOW_S if minute_used else None, "minute")
    lat = sorted(m.get("recent_latency_ms") or [])
    p50 = pm.percentile(lat, 0.5)
    usage = []
    if minute_limit is not None:
        usage.append(f"{minute_used}/{minute_limit} this minute")
    if day_limit is not None:
        usage.append(f"{day_used}/{day_limit} today")
    if not m.get("total"):
        return ProbeResult(OK, f"{idle_note}. " + " · ".join(usage) if usage else idle_note, quota=q,
                           meta={"calls": 0})
    n, good = m.get("recent_n") or 0, m.get("recent_ok") or 0
    err_rate = (n - good) / n if n else 0.0
    last_ok, last_err = m.get("last_ok_at"), m.get("last_error_at")
    status = OK
    notes: List[str] = []
    if n >= 3 and good == 0:
        status = DOWN
        notes.append(f"last {n} calls failed ({m.get('last_error')})")
    elif last_err and (not last_ok or last_err > last_ok) and n >= 1 and err_rate >= 0.5:
        status = DOWN if n >= 3 else DEGRADED
        notes.append(f"failing: {m.get('last_error')}")
    elif err_rate >= 0.3 and n >= 5:
        status = DEGRADED
        notes.append(f"{round(err_rate * 100)}% of the last {n} calls failed ({m.get('last_error')})")
    rl = m.get("rate_limited_at")
    if rl and now - rl < 120:
        status = worst(status, DEGRADED)
        notes.append(f"rate limited {fmt_age(now - rl)} ago")
    if q:
        if q["remaining"] == 0:
            status = worst(status, DOWN if day_limit is not None else DEGRADED)
            notes.append("quota exhausted")
        elif q["used"] >= 0.9 * q["limit"]:
            status = worst(status, DEGRADED)
            notes.append("quota above 90%")
    head = f"Last call {fmt_age(now - m['last_call_at'])} ago" if m.get("last_call_at") else ""
    if p50 is not None:
        head += f" · p50 {int(p50)} ms"
    parts = [head] + usage + notes
    return ProbeResult(status, " · ".join(p for p in parts if p), latency_ms=m.get("last_latency_ms"),
                       last_ok_at=last_ok, quota=q,
                       meta={"calls": m.get("total"), "errors": m.get("errors"), "error_rate": round(err_rate, 3),
                             "p50_ms": p50, "last_status": m.get("last_status")})


def _idle(ctx: ProbeContext, provider: str, seconds: float) -> bool:
    m = ctx.meter.get(provider) or {}
    last = m.get("last_call_at")
    return last is None or ctx.now() - last >= seconds


# ── core ─────────────────────────────────────────────────────────────────

async def probe_api(ctx: ProbeContext) -> ProbeResult:
    t0 = time.perf_counter()
    await asyncio.sleep(0.05)
    lag_ms = max(0.0, _ms(t0) - 50.0)
    c = ctx.collector
    uptime = ctx.now() - (c.started_at if c else ctx.now())
    status = OK if lag_ms < 250 else (DEGRADED if lag_ms < 2000 else DOWN)
    version = os.environ.get("GIT_SHA", "unknown")[:12]
    detail = f"Up {fmt_age(uptime)} · event-loop lag {int(lag_ms)} ms · build {version}"
    if status != OK:
        detail = f"Event loop is lagging ({int(lag_ms)} ms): requests are slow. " + detail
    return ProbeResult(status, detail, latency_ms=lag_ms, meta={"loop_lag_ms": round(lag_ms, 1),
                                                                 "uptime_s": int(uptime), "version": version})


async def probe_postgres(ctx: ProbeContext) -> ProbeResult:
    from app.db import database
    if database.SessionLocal is None:
        return ProbeResult(NOT_CONFIGURED, "DATABASE_URL is not set")

    def _q():
        from sqlalchemy import text
        db = database.SessionLocal()
        try:
            t = time.perf_counter()
            db.execute(text("SELECT 1"))
            return _ms(t)
        finally:
            db.close()

    t0 = time.perf_counter()
    try:
        ms = await asyncio.to_thread(_q)
    except Exception as e:
        return ProbeResult(DOWN, f"SELECT 1 failed: {type(e).__name__}", latency_ms=_ms(t0))
    pool = ""
    try:
        p = database.engine.pool
        pool = f" · pool {p.checkedout()}/{p.size()} in use"
    except Exception:
        pass
    status = OK if ms < 500 else DEGRADED
    detail = f"SELECT 1 in {ms:.0f} ms{pool}" + ("" if status == OK else " (slow)")
    return ProbeResult(status, detail, latency_ms=ms)


async def probe_redis(ctx: ProbeContext) -> ProbeResult:
    r = ctx.redis
    if r is None:
        return ProbeResult(NOT_CONFIGURED, "Redis is not connected; caches fall back to process memory")
    t0 = time.perf_counter()
    try:
        await r.ping()
    except Exception as e:
        return ProbeResult(DOWN, f"PING failed: {type(e).__name__}", latency_ms=_ms(t0))
    ms = _ms(t0)
    return ProbeResult(OK if ms < 200 else DEGRADED, f"PING in {ms:.1f} ms", latency_ms=ms)


async def probe_email(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    from app.services.email_service import email_provider_status
    configured = [n for n, k in (("Brevo", settings.BREVO_API_KEY), ("Resend", settings.RESEND_API_KEY))
                  if k and k.strip()]
    if not configured:
        return ProbeResult(NOT_CONFIGURED, "No email provider key (BREVO_API_KEY / RESEND_API_KEY)")
    state = await asyncio.to_thread(email_provider_status)
    sends = []
    for pid in ("brevo", "resend"):
        m = ctx.meter.get(pid) or {}
        if m.get("last_ok_at"):
            sends.append(f"{pid} last OK {fmt_age(ctx.now() - m['last_ok_at'])} ago")
    names = " + ".join(configured)
    if state == "ok":
        return ProbeResult(OK, f"{names} key accepted (checked every 15 min)" + (" · " + " · ".join(sends) if sends else ""))
    return ProbeResult(DOWN, f"{names}: every configured key was rejected; sign-up codes and resets cannot be sent")


# ── market data ──────────────────────────────────────────────────────────

async def probe_quote_pipeline(ctx: ProbeContext) -> ProbeResult:
    from app.db import database
    from app.services import quote_cache
    now = ctx.now()
    pipe = quote_cache.pipeline_stats()
    newest = None
    fresh = None
    if database.SessionLocal is not None:
        def _q():
            from sqlalchemy import func
            from app.models.quote_snapshot import QuoteSnapshot
            db = database.SessionLocal()
            try:
                newest = db.query(func.max(QuoteSnapshot.fetched_at)).scalar()
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
                fresh = db.query(func.count(QuoteSnapshot.id)).filter(QuoteSnapshot.fetched_at >= cutoff).scalar()
                return newest, fresh
            finally:
                db.close()
        try:
            newest, fresh = await asyncio.to_thread(_q)
        except Exception as e:
            return ProbeResult(DOWN, f"Quote cache table unreadable: {type(e).__name__}")
    newest_ts = _ts(newest)
    age = None if newest_ts is None else now - newest_ts
    n, ok_n = pipe["recent_n"], pipe["recent_ok"]
    sources = ", ".join(f"{k} {v}" for k, v in pipe["sources"].items()) or "none yet"
    status = OK
    notes = []
    if n >= 5 and ok_n == 0:
        status = DOWN
        notes.append(f"the last {n} live fetches all failed")
    elif n >= 5 and ok_n / n < 0.5:
        status = DEGRADED
        notes.append(f"only {ok_n}/{n} recent live fetches succeeded")
    if _market_regular() and (age is None or age > 30 * 60):
        status = worst(status, DEGRADED)
        notes.append("no quote refreshed in 30 min during market hours")
    head = (f"Newest cached quote {fmt_age(age)} old · {fresh or 0} refreshed in 15 min"
            if age is not None else "Quote cache is empty")
    lat = pipe.get("p50_ms")
    detail = " · ".join([head, f"providers used: {sources}"] + notes)
    return ProbeResult(status, detail, latency_ms=lat, last_ok_at=pipe.get("last_ok_at") or newest_ts,
                       meta={"recent_fetches": n, "recent_ok": ok_n, "sources": pipe["sources"],
                             "newest_quote_age_s": None if age is None else int(age), "fresh_15m": fresh})


async def probe_public(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    if not settings.PUBLIC_API_SECRET_KEY:
        return ProbeResult(NOT_CONFIGURED, "PUBLIC_API_SECRET_KEY is not set")
    from app.services import public_client as pc
    if _idle(ctx, "public", 120) and ctx.collector and ctx.collector.is_leader:
        # Free endpoint, 1 quote, only when no real traffic in 2 min.
        try:
            client = await pc._get_async_client()
            acct = getattr(client, "_qt_account_id", None) if client else None
            if client and acct:
                from public_api_sdk import InstrumentType
                from public_api_sdk.models import OrderInstrument
                await asyncio.wait_for(client.get_quotes(
                    instruments=[OrderInstrument(symbol="SPY", type=InstrumentType.EQUITY)], account_id=acct), 8)
        except Exception:
            pass   # recorded by the meter (or reflected below)
        ctx.meter = _refresh_local(ctx)
    res = meter_result(ctx, "public", configured=True, label="Public.com", idle_note="No calls yet")
    if pc._async_client is None and pc._async_fail_until and time.monotonic() < pc._async_fail_until:
        res.status = DOWN
        res.detail = "Client could not sign in (retrying every 60s). " + res.detail
    elif pc._async_client is not None and not getattr(pc._async_client, "_qt_account_id", None):
        res.status = worst(res.status, DEGRADED)
        res.detail = "Signed in but no brokerage account id: quotes need one. " + res.detail
    res.detail = "Quotes + option chains · " + res.detail
    return res


def _refresh_local(ctx: ProbeContext) -> Dict[str, Dict[str, Any]]:
    """Merge the local meter again after an active probe made a call."""
    shared = [s for k, s in (ctx.collector.shared_meters if ctx.collector else {}).items()]
    return pm.merge([pm.meter.snapshot()] + shared, now=ctx.now())


async def _http_probe(ctx: ProbeContext, provider: str, url: str, *, method: str = "GET",
                      headers: Optional[Dict[str, str]] = None, params: Optional[Dict[str, str]] = None,
                      idle_s: float = 60) -> None:
    """One small request (recorded by the meter) when the provider has been idle."""
    if not _idle(ctx, provider, idle_s) or not (ctx.collector and ctx.collector.is_leader):
        return
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.request(method, url, headers=headers, params=params)
    except Exception:
        pass
    ctx.meter = _refresh_local(ctx)


# Same headers as QuoteCacheService._fetch_from_yahoo_direct: without
# Accept-Language + Referer Yahoo answers 429 to every request.
_YAHOO_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
             "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9",
             "Referer": "https://finance.yahoo.com/"}


async def probe_yahoo(ctx: ProbeContext) -> ProbeResult:
    await _http_probe(ctx, "yahoo", "https://query1.finance.yahoo.com/v8/finance/chart/SPY",
                      headers=_YAHOO_UA, params={"range": "1d", "interval": "1d"}, idle_s=60)
    res = meter_result(ctx, "yahoo", configured=True, label="Yahoo")
    res.detail = "Chart API + yfinance (no key) · " + res.detail
    return res


async def probe_alpaca(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    key, secret = settings.ALPACA_API_KEY, settings.ALPACA_SECRET_KEY
    if not (key and secret):
        return ProbeResult(NOT_CONFIGURED, "ALPACA_API_KEY / ALPACA_SECRET_KEY are not set")
    await _http_probe(ctx, "alpaca", "https://data.alpaca.markets/v2/stocks/trades/latest",
                      headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret},
                      params={"symbols": "SPY", "feed": "iex"}, idle_s=60)
    res = meter_result(ctx, "alpaca", configured=True, label="Alpaca", minute_limit=200)
    res.detail = "Market data, free plan (IEX live, SIP history) · " + res.detail
    return res


async def probe_sec(ctx: ProbeContext) -> ProbeResult:
    from app.services.sec_edgar_service import SEC_HEADERS
    await _http_probe(ctx, "sec_edgar", "https://data.sec.gov/submissions/CIK0000320193.json",
                      method="HEAD", headers=dict(SEC_HEADERS), idle_s=120)
    res = meter_result(ctx, "sec_edgar", configured=True, label="SEC EDGAR", minute_limit=600)
    res.detail = "Filings + XBRL facts (free, 10 req/s fair use) · " + res.detail
    return res


async def probe_finnhub(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    res = meter_result(ctx, "finnhub", configured=bool(settings.FINNHUB_API_KEY), label="Finnhub", minute_limit=60)
    if res.status != NOT_CONFIGURED:
        res.detail = "Free plan, 60 calls/min (all processes) · " + res.detail
    return res


async def probe_fmp(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    res = meter_result(ctx, "fmp", configured=bool(settings.FMP_API_KEY), label="FMP", day_limit=250)
    if res.status != NOT_CONFIGURED:
        res.detail = "Free plan, 250 calls/day (counted by QuantTrade) · " + res.detail
    return res


async def probe_twelve_data(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    res = meter_result(ctx, "twelve_data", configured=bool(settings.TWELVEDATA_API_KEY), label="Twelve Data",
                       day_limit=800)
    if res.status != NOT_CONFIGURED:
        res.detail = "Free plan, 800 credits/day · " + res.detail
    return res


async def probe_alpha_vantage(ctx: ProbeContext) -> ProbeResult:
    from app.config import settings
    res = meter_result(ctx, "alpha_vantage", configured=bool(settings.ALPHA_VANTAGE_API_KEY),
                       label="Alpha Vantage", day_limit=25)
    if res.status != NOT_CONFIGURED:
        res.detail = "Free plan, 25 calls/day · " + res.detail
    return res


async def probe_market_snapshot(ctx: ProbeContext) -> ProbeResult:
    from app.api.market import market_snapshots as svc
    snap = svc._snapshot
    now = ctx.now()
    if snap is None:
        return ProbeResult(OK, f"Idle: the S&P 500 snapshot ({len(svc.symbols)} symbols) is built on the first "
                               "Markets page view in this process", meta={"built": False})
    built_age = now - snap.built_at.timestamp()
    newest = snap.newest_quote_at.timestamp() if snap.newest_quote_at else None
    quote_age = None if newest is None else now - newest
    status = OK
    notes = []
    if _market_regular() and (quote_age is None or quote_age > 20 * 60):
        status = DEGRADED
        notes.append("quotes older than 20 min during market hours")
    detail = (f"{len(snap.rows)}/{snap.universe_size} symbols · built {fmt_age(built_age)} ago · "
              f"newest quote {fmt_age(quote_age)} old" + (" · refreshing" if snap.refreshing else ""))
    return ProbeResult(status, " · ".join([detail] + notes), last_ok_at=snap.built_at.timestamp(),
                       meta={"rows": len(snap.rows), "universe": snap.universe_size,
                             "built_age_s": int(built_age), "refreshing": snap.refreshing})


# ── intelligence ─────────────────────────────────────────────────────────

async def probe_news_worker(ctx: ProbeContext) -> ProbeResult:
    from app.services.news_intel import worker_health
    h = await worker_health.check(ctx.redis, now=ctx.now())
    return ProbeResult(h["status"], h["detail"], last_ok_at=h.get("last_ingest_ts"),
                       latency_ms=h.get("ingest_p50_s") and h["ingest_p50_s"] * 1000,
                       meta={k: h.get(k) for k in ("worker_alive", "heartbeat_age_s", "last_ingest_age_s",
                                                   "items_1h", "items_24h", "is_leader")})


async def probe_forecast(ctx: ProbeContext) -> ProbeResult:
    from app.api import forecast as fc
    from app.services import warmup
    from app.services.redis_cache_service import cache_service
    keys = [fc._forecast_key(t) for t in fc.WARM_TICKERS]
    cached = 0
    if ctx.redis is not None:
        try:
            vals = await ctx.redis.mget(keys)
            cached = sum(1 for v in vals if v)
        except Exception:
            cached = sum(1 for k in keys if cache_service._fallback.get(k) is not None)
    else:
        cached = sum(1 for k in keys if cache_service._fallback.get(k) is not None)
    total = len(keys)
    m = pm.meter.snapshot().get("forecast_compute") or {}
    n, ok_n = m.get("recent_n") or 0, m.get("recent_ok") or 0
    warm = warmup.status()
    warm_on = os.environ.get("RUN_BACKGROUND_JOBS", "1") != "0" and os.environ.get("FORECAST_WARM", "1") != "0"
    status = OK
    notes = []
    if n >= 3 and ok_n == 0:
        status = DOWN
        notes.append(f"the last {n} fits failed ({m.get('last_error')})")
    elif n >= 5 and ok_n / n < 0.5:
        status = DEGRADED
        notes.append(f"{n - ok_n}/{n} recent fits failed")
    if warm_on and cached < total * 0.5 and warm.get("ready"):
        status = worst(status, DEGRADED)
        notes.append("fewer than half of the popular tickers are cached")
    fits = f"{ok_n}/{n} recent fits OK" if n else "no fits in this process yet"
    lat = pm.percentile(sorted(m.get("recent_latency_ms") or []), 0.5)
    head = f"{cached}/{total} popular tickers cached · {fits}"
    if not warm_on:
        head += " · warm loop off in this process"
    return ProbeResult(status, " · ".join([head] + notes), latency_ms=lat, last_ok_at=m.get("last_ok_at"),
                       quota=None, meta={"cached": cached, "popular": total, "warm": warm.get("state")})


async def probe_ml_gate(ctx: ProbeContext) -> ProbeResult:
    def _read():
        from app.services.mlops_status import gate_status
        g = gate_status()
        latest = None
        from app.db import database
        if database.SessionLocal is not None:
            from sqlalchemy import func
            from app.models.ml_training import ModelVersion
            db = database.SessionLocal()
            try:
                latest = db.query(func.max(ModelVersion.created_at)).scalar()
            finally:
                db.close()
        return g, latest
    try:
        g, latest = await asyncio.to_thread(_read)
    except Exception as e:
        return ProbeResult(DOWN, f"ML status unreadable: {type(e).__name__}")
    latest_ts = _ts(latest)
    reg = (f"newest registry version {fmt_age(ctx.now() - latest_ts)} old" if latest_ts
           else "model registry is empty")
    gates = (f"{g.get('gates_passed')}/{g.get('gates_total')} gates" if g.get("gates_passed") is not None
             else "gate not evaluated")
    verdict = g.get("verdict") or "unknown"
    serving = "served" if g.get("promoted") else "not served (statistical forecasts are used)"
    return ProbeResult(OK, f"Verdict {verdict} · {gates} · ML model {serving} · {reg}",
                       meta={"verdict": verdict, "gates_passed": g.get("gates_passed"),
                             "gates_total": g.get("gates_total"), "promoted": g.get("promoted"),
                             "registry_latest_at": latest.isoformat() if latest else None})


async def probe_backtests(ctx: ProbeContext) -> ProbeResult:
    from app.services.backtesting import jobs
    s = jobs.manager.stats()
    now = ctx.now()
    status = OK
    notes = []
    if s["queued"] >= jobs.MAX_QUEUED:
        status = DEGRADED
        notes.append("queue is full: new runs are rejected")
    recent = s["recent_statuses"]
    if len(recent) >= 3 and all(x == "failed" for x in recent[-3:]):
        status = DEGRADED
        notes.append("the last 3 runs crashed")
    last = s.get("last")
    last_txt = (f"last run {last['status']} {fmt_age(now - last['finished'])} ago"
                + (f" in {last['duration_s']:.0f}s" if last.get("duration_s") is not None else "")
                if last else "no runs since the API started")
    detail = f"{s['running']} running · {s['queued']}/{jobs.MAX_QUEUED} queued · {last_txt}"
    last_ok = last["finished"] if last and last["status"] == "done" else s.get("last_done_at")
    return ProbeResult(status, " · ".join([detail] + notes), last_ok_at=last_ok,
                       meta={"running": s["running"], "queued": s["queued"]})


# Copilot ─────────────────────────────────────────────────────────────────

_LLM_CFG: Dict[str, Any] = {"at": 0.0, "chain": [], "helper": None, "down": []}


def _copilot_config(now: float) -> Dict[str, Any]:
    if now - _LLM_CFG["at"] < 30:
        return _LLM_CFG
    from app.services.agentic import bedrock_client as bc
    chain = [{"provider": c.provider, "model": c.model} for c in bc.copilot_llm_candidates()]
    down = []
    if not bc._flag("PREFER_OPENAI") and bc._aws_credentials_available():
        for mid in dict.fromkeys(m for m in (bc.COPILOT_MODEL_PRIMARY, bc.COPILOT_MODEL_FALLBACK) if m):
            if not bc.bedrock_model_available(mid):
                down.append(mid)
    _LLM_CFG.update(at=now, chain=chain, down=down)
    return _LLM_CFG


def synthetic_interval_s() -> float:
    return max(300.0, _env_float("COPILOT_SYNTHETIC_INTERVAL_S", 300.0))


def synthetic_enabled() -> bool:
    return os.environ.get("COPILOT_SYNTHETIC_CHECK", "1") != "0"


def _provider_of(model: Optional[str]) -> Optional[str]:
    m = (model or "").lower()
    if not m:
        return None
    if m.startswith(("us.", "eu.", "apac.", "global.", "anthropic.", "amazon.")) or ":0" in m:
        return "bedrock"
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith(("gpt", "o1", "o3", "o4")):
        return "openai"
    if "/" in m:
        return "openrouter"
    return None


async def run_copilot_synthetic(ctx: ProbeContext) -> Optional[Dict[str, Any]]:
    """Tiny real completion on the cheapest configured model (guarded + metered).

    Skipped when a real Copilot request succeeded within the interval."""
    from app.services.copilot.llm_stats import stats
    s = stats.summary()
    now = ctx.now()
    if s.get("last_ok_at") and now - s["last_ok_at"] < synthetic_interval_s():
        return None
    from app.services import ai_guard
    from app.services.agentic import bedrock_client as bc
    from langchain_core.messages import HumanMessage
    t0 = time.perf_counter()
    provider = model = None
    try:
        with ai_guard.system_context("status_probe"):
            llm = bc.get_llm_haiku(streaming=False, max_tokens=8)
            resp = await asyncio.wait_for(llm.ainvoke([HumanMessage("Reply with the single word: OK")]), 30)
        meta = getattr(resp, "response_metadata", None) or {}
        model = meta.get("model_id") or meta.get("model_name") or meta.get("model")
        provider = _provider_of(model)
        text = getattr(resp, "content", "")
        ok = bool(text)
        stats.record(provider=provider, model=model, ok=ok, latency_ms=_ms(t0), synthetic=True,
                     error=None if ok else "empty answer")
    except Exception as e:
        stats.record(provider=provider, model=model, ok=False, latency_ms=_ms(t0), synthetic=True,
                     error=type(e).__name__)
    return stats.summary().get("synthetic")


async def probe_copilot(ctx: ProbeContext) -> ProbeResult:
    from app.services.copilot.llm_stats import stats
    now = ctx.now()
    try:
        cfg = await asyncio.to_thread(_copilot_config, now)
    except Exception as e:
        return ProbeResult(DOWN, f"Could not read the LLM configuration: {type(e).__name__}")
    chain = cfg["chain"]
    if not chain and not cfg["down"]:
        return ProbeResult(NOT_CONFIGURED, "No LLM provider configured (Bedrock, Anthropic, OpenAI)")
    s = stats.summary()
    syn = s.get("synthetic")
    status = OK
    notes: List[str] = []
    outcomes = s["recent_outcomes"]
    if len(outcomes) >= 3 and not any(outcomes[-3:]):
        status = DOWN
        notes.append(f"the last 3 answers failed ({s['last_error']})")
    elif s["requests"] >= 4 and (s["error_rate"] or 0) >= 0.25:
        status = DEGRADED
        notes.append(f"{round(s['error_rate'] * 100)}% of the last {s['requests']} answers failed")
    if syn and not syn["ok"] and (not s["last_ok_at"] or s["last_ok_at"] < syn["at"]):
        status = worst(status, DOWN)
        notes.append(f"health-check completion failed {fmt_age(now - syn['at'])} ago ({syn['error']})")
    if not chain:
        status = DOWN
        notes.append("every configured model is tripped by the circuit breaker")
    elif cfg["down"]:
        status = worst(status, DEGRADED)
        notes.append(f"{', '.join(cfg['down'])} unavailable; answering with {chain[0]['model']}")
    primary = f"{chain[0]['provider']} {chain[0]['model']}" if chain else "none"
    fallbacks = len(chain) - 1
    head = f"Model {primary}" + (f" (+{fallbacks} fallback{'s' if fallbacks != 1 else ''})" if fallbacks > 0 else "")
    if s["requests"]:
        head += (f" · {s['requests'] - s['errors']}/{s['requests']} recent answers OK"
                 f" · p50 {s['p50_ms']} ms · p95 {s['p95_ms']} ms")
    else:
        head += " · no Copilot traffic since the API started"
    if syn and syn["ok"]:
        head += f" · health check OK {fmt_age(now - syn['at'])} ago ({syn['latency_ms']} ms)"
    last_ok = s["last_ok_at"]
    lat = s["p50_ms"] if s["p50_ms"] is not None else (syn or {}).get("latency_ms")
    return ProbeResult(status, " · ".join([head] + notes), latency_ms=lat, last_ok_at=last_ok,
                       meta={"chain": chain, "breaker_open": cfg["down"], "requests": s["requests"],
                             "errors": s["errors"], "error_rate": s["error_rate"], "p50_ms": s["p50_ms"],
                             "p95_ms": s["p95_ms"], "first_token_p50_ms": s["first_token_p50_ms"],
                             "last_error": s["last_error"],
                             "synthetic": syn, "synthetic_enabled": synthetic_enabled(),
                             "synthetic_interval_s": synthetic_interval_s()})


# ── registry ─────────────────────────────────────────────────────────────

def _db_label() -> str:
    """Name the database by what it really is (prod: AWS RDS PostgreSQL)."""
    import os
    url = os.getenv("DATABASE_URL") or ""
    if ".rds.amazonaws.com" in url:
        return "AWS RDS PostgreSQL"
    if "neon.tech" in url:
        return "Neon PostgreSQL"
    return "PostgreSQL"


def default_probes() -> List[Probe]:
    P = Probe
    return [
        P("api", "API server", "core", 1, probe_api, timeout_s=5, critical=True,
          method="Event-loop lag + uptime of this process", can_cost=False),
        P("postgres", _db_label(), "core", 5, probe_postgres, timeout_s=5, critical=True,
          method="SELECT 1 via the app pool", can_cost=False),
        P("redis", "Redis", "core", 2, probe_redis, timeout_s=3,
          method="PING on the app's client", can_cost=False),
        P("email", "Email (Brevo / Resend)", "core", 60, probe_email, timeout_s=10, shared=True,
          method="Key check on the account endpoint (cached 15 min) + last send", can_cost=False),
        P("quote_pipeline", "Quote pipeline", "market_data", 10, probe_quote_pipeline, timeout_s=5, critical=True,
          method="Outcome of recent live quote fetches + newest row in the quote cache", can_cost=False),
        P("public", "Public.com quotes & options", "market_data", 5, probe_public, timeout_s=12, shared=True,
          method="Real traffic; 1 quote when idle 2 min (free)", can_cost=False),
        P("alpaca", "Alpaca market data", "market_data", 5, probe_alpaca, timeout_s=10, shared=True,
          method="Real traffic; latest IEX trade when idle 60s (free plan)", can_cost=False),
        P("yahoo", "Yahoo Finance", "market_data", 5, probe_yahoo, timeout_s=10, shared=True,
          method="Real traffic; 1-day SPY chart when idle 60s (free)", can_cost=False),
        P("finnhub", "Finnhub", "market_data", 2, probe_finnhub, timeout_s=2,
          method="Usage counters only (never calls)", can_cost=False),
        P("fmp", "Financial Modeling Prep", "market_data", 5, probe_fmp, timeout_s=2,
          method="Usage counters only (never calls)", can_cost=False),
        P("twelve_data", "Twelve Data", "market_data", 5, probe_twelve_data, timeout_s=2,
          method="Usage counters only (never calls)", can_cost=False),
        P("alpha_vantage", "Alpha Vantage", "market_data", 5, probe_alpha_vantage, timeout_s=2,
          method="Usage counters only (never calls)", can_cost=False),
        P("sec_edgar", "SEC EDGAR", "market_data", 10, probe_sec, timeout_s=10, shared=True,
          method="Real traffic; HEAD of one submissions file when idle 2 min (free)", can_cost=False),
        P("market_snapshot", "Market snapshot job", "market_data", 5, probe_market_snapshot, timeout_s=2,
          method="Age of the in-memory S&P 500 snapshot", can_cost=False),
        P("copilot_llm", "AI Copilot (LLM)", "intelligence", 5, probe_copilot, timeout_s=10,
          method="Ring buffer of real Copilot answers + breaker state; synthetic completion every 5 min",
          can_cost=True),
        P("news_worker", "News intelligence worker", "intelligence", 15, probe_news_worker, timeout_s=8,
          method="Worker heartbeat in Redis + newest ingested item", can_cost=False),
        P("forecast", "Forecasts", "intelligence", 30, probe_forecast, timeout_s=5,
          method="Cache coverage of the 30 popular tickers + recent fit outcomes", can_cost=False),
        P("ml_gate", "ML gate / MLOps", "intelligence", 120, probe_ml_gate, timeout_s=10,
          method="Promotion gate file + newest model registry row", can_cost=False),
        P("backtests", "Backtest runner", "intelligence", 2, probe_backtests, timeout_s=2,
          method="Job manager queue depth + last job", can_cost=False),
    ]


def build_collector(app=None, redis=None):
    """Collector with every real probe plus the meter / synthetic background tasks."""
    from app.services.system_status import SystemStatusCollector
    c = SystemStatusCollector(default_probes(), redis=redis, app=app)
    c.shared_meters = {}
    role_key = f"{pm.REDIS_PREFIX}api:{os.getpid()}"

    async def meter_loop():
        while c.running:
            try:
                await pm.publish(redis, "api", os.getpid())
                snaps, daily = await pm.read_shared(redis, exclude_key=role_key)
                c.shared_meters = {str(i): s for i, s in enumerate(snaps)}
                c.ctx.meter = pm.merge([pm.meter.snapshot()] + snaps)
                c.ctx.daily = daily
            except Exception:
                pass
            await asyncio.sleep(2.0)

    async def synthetic_loop():
        await asyncio.sleep(20)
        while c.running:
            if synthetic_enabled() and c.is_leader:
                try:
                    cfg = await asyncio.to_thread(_copilot_config, time.time())
                    if cfg["chain"]:
                        await run_copilot_synthetic(c.ctx)
                except Exception:
                    pass
            await asyncio.sleep(synthetic_interval_s())

    c.add_task(meter_loop)
    c.add_task(synthetic_loop)
    return c
