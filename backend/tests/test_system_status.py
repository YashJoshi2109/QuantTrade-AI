"""System status: collector, aggregation, staleness, quota reporting, meter, endpoint."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.services import provider_meter as pm
from app.services import system_status as ss
from app.services.system_probes import meter_result, probe_backtests, probe_copilot
from app.services.system_status import (DEGRADED, DOWN, NOT_CONFIGURED, OK, PENDING, Probe, ProbeContext,
                                        ProbeResult, SystemStatusCollector, aggregate, age_status)


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def _probe(pid, result=None, *, interval=5, critical=False, exc=None, sleep=None, timeout=1.0):
    async def fn(ctx):
        if sleep:
            await asyncio.sleep(sleep)
        if exc:
            raise exc
        return result
    return Probe(pid, pid.upper(), "core", interval, fn, timeout_s=timeout, critical=critical)


def _svc(status, critical=False, sid="x"):
    return {"id": sid, "status": status, "critical": critical}


# ── aggregation ──────────────────────────────────────────────────────────

def test_aggregate_all_ok():
    assert aggregate([_svc(OK), _svc(OK)])["overall"] == OK


def test_aggregate_noncritical_down_is_degraded():
    out = aggregate([_svc(OK, critical=True, sid="db"), _svc(DOWN, sid="fmp")])
    assert out["overall"] == DEGRADED and out["issues"] == ["fmp"]


def test_aggregate_critical_down_is_outage():
    assert aggregate([_svc(DOWN, critical=True, sid="db"), _svc(OK)])["overall"] == DOWN


def test_aggregate_ignores_not_configured_and_pending():
    out = aggregate([_svc(NOT_CONFIGURED), _svc(PENDING), _svc(OK)])
    assert out["overall"] == OK and out["issues"] == []
    assert out["counts"][NOT_CONFIGURED] == 1 and out["counts"][PENDING] == 1


def test_age_status_thresholds():
    assert age_status(10, 60, 300) == OK
    assert age_status(60, 60, 300) == DEGRADED
    assert age_status(299, 60, 300) == DEGRADED
    assert age_status(300, 60, 300) == DOWN
    assert age_status(None, 60, 300) == DOWN
    assert age_status(None, 60) == DEGRADED


# ── collector ────────────────────────────────────────────────────────────

def test_collector_runs_probes_and_records_results():
    clock = Clock()
    c = SystemStatusCollector([_probe("a", ProbeResult(OK, "fine", latency_ms=12.34)),
                               _probe("b", ProbeResult(DEGRADED, "slow"))], clock=clock)

    async def go():
        for p in c.probes:
            await c.run_probe(p)
    asyncio.run(go())
    snap = c.snapshot()
    by = {s["id"]: s for s in snap["services"]}
    assert by["a"]["status"] == OK and by["a"]["latency_ms"] == 12.3 and by["a"]["detail"] == "fine"
    assert by["a"]["last_ok_at"] == by["a"]["last_checked_at"] == ss.iso(clock.t)
    assert by["b"]["status"] == DEGRADED and by["b"]["last_ok_at"] is None
    assert snap["overall"] == DEGRADED and snap["generated_at"] == ss.iso(clock.t)


def test_probe_exception_and_timeout_become_down():
    c = SystemStatusCollector([_probe("boom", exc=RuntimeError("kaput")),
                               _probe("slow", ProbeResult(OK), sleep=0.5, timeout=0.05)])

    async def go():
        for p in c.probes:
            await c.run_probe(p)
    asyncio.run(go())
    by = {s["id"]: s for s in c.snapshot()["services"]}
    assert by["boom"]["status"] == DOWN and "RuntimeError: kaput" in by["boom"]["detail"]
    assert by["slow"]["status"] == DOWN and "timed out" in by["slow"]["detail"]


def test_last_ok_survives_a_failure():
    clock = Clock()
    state = {"r": ProbeResult(OK, "up")}

    async def fn(ctx):
        return state["r"]
    p = Probe("svc", "Svc", "core", 5, fn)
    c = SystemStatusCollector([p], clock=clock)
    asyncio.run(c.run_probe(p))
    ok_at = ss.iso(clock.t)
    clock.t += 30
    state["r"] = ProbeResult(DOWN, "gone")
    asyncio.run(c.run_probe(p))
    s = c.snapshot()["services"][0]
    assert s["status"] == DOWN and s["last_ok_at"] == ok_at and s["last_checked_at"] == ss.iso(clock.t)


def test_probe_supplied_last_ok_wins():
    p = _probe("m", ProbeResult(OK, last_ok_at=1_700_000_000.0))
    c = SystemStatusCollector([p])
    asyncio.run(c.run_probe(p))
    assert c.snapshot()["services"][0]["last_ok_at"] == ss.iso(1_700_000_000.0)


def test_pending_before_first_check():
    c = SystemStatusCollector([_probe("a", ProbeResult(OK))])
    s = c.snapshot()
    assert s["services"][0]["status"] == PENDING and s["overall"] == OK


def test_stale_result_degrades_then_goes_down():
    clock = Clock()
    p = _probe("a", ProbeResult(OK, "fine"), interval=5)       # stale > 15s, dead > 65s
    c = SystemStatusCollector([p], clock=clock)
    asyncio.run(c.run_probe(p))
    clock.t += 14
    assert c.snapshot()["services"][0]["status"] == OK
    clock.t += 2
    s = c.snapshot()["services"][0]
    assert s["status"] == DEGRADED and s["detail"].startswith("Health check is stale")
    clock.t += 60
    assert c.snapshot()["services"][0]["status"] == DOWN


def test_stale_not_configured_stays_not_configured():
    clock = Clock()
    p = _probe("a", ProbeResult(NOT_CONFIGURED, "no key"), interval=5)
    c = SystemStatusCollector([p], clock=clock)
    asyncio.run(c.run_probe(p))
    clock.t += 1000
    assert c.snapshot()["services"][0]["status"] == NOT_CONFIGURED


def test_collector_loop_start_stop():
    calls = []

    async def fn(ctx):
        calls.append(1)
        return ProbeResult(OK)

    async def go():
        c = SystemStatusCollector([Probe("fast", "Fast", "core", 0.01, fn)])
        c.start()
        await asyncio.sleep(2.3)   # first run is jittered by up to 2s
        await c.stop()
        return c
    c = asyncio.run(go())
    assert len(calls) >= 2 and not c.running and c.snapshot()["services"][0]["status"] == OK


def test_duplicate_probe_ids_rejected():
    with pytest.raises(ValueError):
        SystemStatusCollector([_probe("a", ProbeResult(OK)), _probe("a", ProbeResult(OK))])


class FakeRedis:
    def __init__(self):
        self.h, self.kv = {}, {}

    async def hset(self, key, field, value):
        self.h.setdefault(key, {})[field] = value

    async def hget(self, key, field):
        return self.h.get(key, {}).get(field)

    async def expire(self, key, ttl):
        return True

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.kv:
            return None
        self.kv[key] = value
        return True

    async def get(self, key):
        return self.kv.get(key)


def test_shared_probe_runs_only_on_leader_and_followers_read_mirror():
    r = FakeRedis()
    ran = {"leader": 0, "follower": 0}

    def mk(name):
        async def fn(ctx):
            ran[name] += 1
            return ProbeResult(OK, f"from {name}")
        return Probe("ext", "External", "market_data", 0.01, fn, shared=True)

    async def go():
        lead = SystemStatusCollector([mk("leader")], redis=r, worker_id="w1")
        follow = SystemStatusCollector([mk("follower")], redis=r, worker_id="w2")
        await lead._renew_leader()
        await follow._renew_leader()
        assert lead.is_leader and not follow.is_leader
        await lead.run_probe(lead.probes[0])
        follow.running = True
        task = asyncio.create_task(follow._loop(follow.probes[0]))
        await asyncio.sleep(2.2)
        follow.running = False
        task.cancel()
        return follow
    follow = asyncio.run(go())
    assert ran["follower"] == 0 and ran["leader"] == 1
    assert follow.snapshot()["services"][0]["detail"] == "from leader"


# ── quota reporting from the provider meter ──────────────────────────────

def _ctx(meter, daily=None, now=1_800_000_000.0):
    return ProbeContext(meter=meter, daily=daily or {}, now=lambda: now)


def _meter_with(provider, n, ok=True, now=1_800_000_000.0, status=200, rate_limited=False):
    m = pm.ProviderMeter(clock=lambda: now)
    for _ in range(n):
        m.record(provider, ok, 50, status=status, error=None if ok else "HTTP 500", rate_limited=rate_limited)
    return m.snapshot()


def test_quota_not_configured():
    assert meter_result(_ctx({}), "fmp", configured=False, label="FMP", day_limit=250).status == NOT_CONFIGURED


def test_quota_idle_is_ok_and_reports_zero_usage():
    r = meter_result(_ctx({}), "finnhub", configured=True, label="Finnhub", minute_limit=60)
    assert r.status == OK and r.quota["used"] == 0 and r.quota["remaining"] == 60 and "0/60" in r.detail


def test_quota_minute_window_counts_and_exhaustion():
    now = 1_800_000_000.0
    r = meter_result(_ctx(_meter_with("finnhub", 23, now=now), now=now), "finnhub",
                     configured=True, label="Finnhub", minute_limit=60)
    assert r.status == OK and r.quota == {"used": 23, "limit": 60, "remaining": 37,
                                          "resets_at": ss.iso(now + 60), "window": "minute"}
    r = meter_result(_ctx(_meter_with("finnhub", 60, now=now), now=now), "finnhub",
                     configured=True, label="Finnhub", minute_limit=60)
    assert r.status == DEGRADED and r.quota["remaining"] == 0 and "quota exhausted" in r.detail


def test_quota_minute_window_expires():
    now = 1_800_000_000.0
    r = meter_result(_ctx(_meter_with("finnhub", 30, now=now - 61), now=now), "finnhub",
                     configured=True, label="Finnhub", minute_limit=60)
    assert r.quota["used"] == 0


def test_quota_daily_uses_shared_counter_and_goes_down_when_exhausted():
    now = 1_800_000_000.0
    meter = _meter_with("fmp", 3, now=now)
    r = meter_result(_ctx(meter, daily={"fmp": 230}, now=now), "fmp", configured=True, label="FMP", day_limit=250)
    assert r.quota["used"] == 230 and r.status == DEGRADED and "above 90%" in r.detail
    assert r.quota["resets_at"].endswith("T00:00:00Z")
    r = meter_result(_ctx(meter, daily={"fmp": 250}, now=now), "fmp", configured=True, label="FMP", day_limit=250)
    assert r.status == DOWN and r.quota["remaining"] == 0


def test_failing_provider_is_down_and_flaky_is_degraded():
    now = 1_800_000_000.0
    r = meter_result(_ctx(_meter_with("yahoo", 4, ok=False, status=500, now=now), now=now), "yahoo",
                     configured=True, label="Yahoo")
    assert r.status == DOWN
    m = pm.ProviderMeter(clock=lambda: now)
    for i in range(10):
        m.record("yahoo", i % 3 != 0, 40, status=200 if i % 3 else 500)
    m.record("yahoo", True, 40, status=200)
    r = meter_result(_ctx(m.snapshot(), now=now), "yahoo", configured=True, label="Yahoo")
    assert r.status == DEGRADED and r.last_ok_at == now


def test_rate_limited_recently_is_degraded():
    now = 1_800_000_000.0
    m = pm.ProviderMeter(clock=lambda: now)
    for _ in range(5):
        m.record("twelve_data", True, 40, status=200)
    m.record("twelve_data", False, 40, status=429, error="rate limited", rate_limited=True)
    r = meter_result(_ctx(m.snapshot(), now=now), "twelve_data", configured=True, label="TD", day_limit=800)
    assert r.status == DEGRADED and "rate limited" in r.detail


# ── provider meter ───────────────────────────────────────────────────────

def test_provider_for_host():
    assert pm.provider_for_host("finnhub.io") == "finnhub"
    assert pm.provider_for_host("query2.finance.yahoo.com") == "yahoo"
    assert pm.provider_for_host("data.sec.gov") == "sec_edgar"
    assert pm.provider_for_host("www.sec.gov") == "sec_edgar"
    assert pm.provider_for_host("api.public.com:443") == "public"
    assert pm.provider_for_host("evilfinnhub.io") is None
    assert pm.provider_for_host("example.com") is None


def test_classify():
    assert pm.classify("fmp", 200) == (True, None, False)
    assert pm.classify("fmp", 404)[0] is True                      # unknown symbol is not an outage
    assert pm.classify("fmp", 429) == (False, "rate limited (HTTP 429)", True)
    assert pm.classify("fmp", 401)[0] is False
    assert pm.classify("fmp", 503)[0] is False
    ok, err, rl = pm.classify("alpha_vantage", 200, b'{"Note": "Thank you for using Alpha Vantage! API call frequency"}')
    assert not ok and rl


def test_merge_adds_counts_and_keeps_latest_timestamps():
    now = 1_800_000_000.0
    a = pm.ProviderMeter(clock=lambda: now - 5)
    b = pm.ProviderMeter(clock=lambda: now - 1)
    for _ in range(3):
        a.record("finnhub", True, 10, status=200)
    b.record("finnhub", False, 30, status=500, error="HTTP 500")
    merged = pm.merge([a.snapshot(), b.snapshot()], now=now)["finnhub"]
    assert merged["total"] == 4 and merged["errors"] == 1 and len(merged["minute_calls"]) == 4
    assert merged["day_count"] == 4 and merged["last_call_at"] == now - 1 and merged["last_ok_at"] == now - 5
    assert merged["last_error"] == "HTTP 500" and merged["last_status"] == 500


def test_unpublished_deltas():
    m = pm.ProviderMeter()
    m.record("fmp", True, 1)
    m.record("fmp", True, 1)
    assert m.take_unpublished() == {"fmp": 2}
    assert m.take_unpublished() == {}
    m.restore_unpublished({"fmp": 2})
    assert m.take_unpublished() == {"fmp": 2}


def test_install_meters_httpx_calls_without_storing_urls():
    import httpx

    def handler(request):
        return httpx.Response(429 if "limited" in request.url.path else 200, json={"ok": True})

    pm.meter.reset()
    pm.install()
    try:
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            c.get("https://finnhub.io/api/v1/quote", params={"symbol": "AAPL", "token": "SECRET"})
            c.get("https://finnhub.io/limited")
            c.get("https://example.com/")          # not a provider: ignored

        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as ac:
                await ac.get("https://api.twelvedata.com/quote")
        asyncio.run(go())
    finally:
        pm.uninstall()
    snap = pm.meter.snapshot()
    assert snap["finnhub"]["total"] == 2 and snap["finnhub"]["errors"] == 1
    assert snap["finnhub"]["rate_limited_at"] is not None
    assert snap["twelve_data"]["total"] == 1 and "example" not in str(snap)
    assert "SECRET" not in str(snap)
    pm.meter.reset()


# ── copilot + backtests probes ───────────────────────────────────────────

def test_llm_stats_summary():
    from app.services.copilot.llm_stats import LLMStats
    s = LLMStats(clock=lambda: 100.0)
    for ms in (100, 200, 300, 400, 1000):
        s.record(provider="bedrock", model="m", ok=True, latency_ms=ms, first_token_ms=ms / 2)
    s.record(provider="bedrock", model="m", ok=False, error="ThrottlingException")
    s.record(provider="anthropic", model="h", ok=True, latency_ms=5, synthetic=True)
    out = s.summary()
    assert out["requests"] == 6 and out["errors"] == 1 and out["error_rate"] == round(1 / 6, 3)
    assert out["p50_ms"] == 300 and out["p95_ms"] == 1000
    assert out["last_error"] == "ThrottlingException" and out["synthetic"]["ok"] is True
    assert out["served_by"] == {"bedrock:m": 5}


@pytest.fixture
def copilot_cfg(monkeypatch):
    from app.services import system_probes
    from app.services.copilot import llm_stats
    cfg = {"at": 0, "chain": [{"provider": "bedrock", "model": "us.anthropic.claude-sonnet-5"}], "down": []}
    monkeypatch.setattr(system_probes, "_copilot_config", lambda now: cfg)
    fresh = llm_stats.LLMStats()
    monkeypatch.setattr(llm_stats, "stats", fresh)
    return cfg, fresh


def test_copilot_probe_states(copilot_cfg):
    cfg, st = copilot_cfg
    ctx = ProbeContext()
    r = asyncio.run(probe_copilot(ctx))
    assert r.status == OK and "no Copilot traffic" in r.detail
    for _ in range(3):
        st.record(provider="bedrock", model="m", ok=False, error="ReadTimeout")
    r = asyncio.run(probe_copilot(ctx))
    assert r.status == DOWN and "ReadTimeout" in r.detail
    st.record(provider="bedrock", model="m", ok=True, latency_ms=900)
    cfg["down"] = ["us.anthropic.claude-sonnet-5"]
    r = asyncio.run(probe_copilot(ctx))
    assert r.status == DEGRADED and r.meta["error_rate"] == 0.75
    cfg["chain"], cfg["down"] = [], []
    assert asyncio.run(probe_copilot(ctx)).status == NOT_CONFIGURED


def test_copilot_failed_synthetic_without_real_success_is_down(copilot_cfg):
    cfg, st = copilot_cfg
    st.record(provider=None, model=None, ok=False, error="AccessDeniedException", synthetic=True)
    assert asyncio.run(probe_copilot(ProbeContext())).status == DOWN


def test_engine_records_llm_outcomes(fixture_db_like):
    from app.services.copilot import llm_stats
    from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
    from app.services.copilot.evalkit import FixtureSources, ScriptedLLM
    from app.services.copilot.memory import InMemoryStore
    llm_stats.stats.reset()
    llm = ScriptedLLM([{"text": "Revenue was $114.48B [fs:AAPL:2026-Q4]."}])
    eng = CopilotEngine(fixture_db_like, sources=FixtureSources(),
                        llm_chain=[LLMHandle("scripted", "m", lambda: llm)],
                        memory_store=InMemoryStore(), use_pack_cache=False)

    async def go():
        return [ev async for ev in eng.run(CopilotRequest(message="What was AAPL's revenue last quarter?",
                                                         user_id=7))]
    asyncio.run(go())
    s = llm_stats.stats.summary()
    assert s["requests"] == 1 and s["errors"] == 0 and s["last_ok_provider"] == "scripted"
    assert s["p50_ms"] is not None
    llm_stats.stats.reset()


@pytest.fixture
def fixture_db_like():
    from app.services import ai_guard
    from app.services.copilot.evalkit import fixture_db
    ai_guard.set_store(ai_guard.MemoryStore())
    ai_guard.set_persist_sink(lambda e: None)
    db = fixture_db()
    yield db
    db.close()
    ai_guard.set_store(None)
    ai_guard.set_persist_sink(None)


def test_backtest_probe_reports_queue_and_last_job(monkeypatch):
    from app.services.backtesting import jobs
    mgr = jobs.JobManager(store=jobs.MemoryJobStore())
    monkeypatch.setattr(jobs, "manager", mgr)
    r = asyncio.run(probe_backtests(ProbeContext()))
    assert r.status == OK and "no runs" in r.detail
    j = mgr.submit("u1", lambda progress, deadline, cancel: {"ok": True})
    for _ in range(100):
        if mgr.get(j.id, "u1").status == "done":
            break
        import time
        time.sleep(0.02)
    r = asyncio.run(probe_backtests(ProbeContext()))
    assert r.status == OK and "last run done" in r.detail and r.last_ok_at is not None


# ── endpoint ─────────────────────────────────────────────────────────────

def test_endpoint_serves_snapshot_with_short_cache():
    from app.main import app
    p = _probe("postgres", ProbeResult(OK, "SELECT 1 in 2 ms", latency_ms=2.0), critical=True)
    q = _probe("fmp", ProbeResult(DEGRADED, "quota above 90%", quota=ss.quota(230, 250)))
    c = SystemStatusCollector([p, q])

    async def go():
        await c.run_probe(p)
        await c.run_probe(q)
    asyncio.run(go())
    ss.set_collector(c)
    try:
        r = TestClient(app).get("/api/v1/system/status")
    finally:
        ss.set_collector(None)
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=1"
    body = r.json()
    assert set(body) >= {"generated_at", "overall", "services"}
    assert body["overall"] == DEGRADED
    svc = {s["id"]: s for s in body["services"]}
    assert set(svc["postgres"]) >= {"id", "name", "group", "status", "latency_ms", "last_ok_at",
                                    "last_checked_at", "detail", "quota"}
    assert svc["fmp"]["quota"] == {"used": 230, "limit": 250, "remaining": 20, "resets_at": None, "window": None}


def test_endpoint_without_collector_lists_every_service_as_pending():
    from app.main import app
    ss.set_collector(None)
    body = TestClient(app).get("/api/v1/system/status").json()
    ids = {s["id"] for s in body["services"]}
    assert {"api", "postgres", "redis", "copilot_llm", "finnhub", "fmp", "news_worker"} <= ids
    assert all(s["status"] == PENDING for s in body["services"]) and body["overall"] == OK


# ── news worker liveness (/news/health worker_alive fix) ─────────────────

def test_news_worker_alive_rules():
    from datetime import datetime, timezone
    from app.services.news_intel import worker_health as wh
    now = 1_800_000_000.0
    iso = lambda t: datetime.fromtimestamp(t, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    assert wh.alive({"ts": iso(now - 20)}, None, now)                    # fresh heartbeat
    assert not wh.alive({"ts": iso(now - 600)}, None, now)               # expired heartbeat, no ingest
    assert wh.alive(None, now - 120, now)                                # heartbeat lost, still ingesting
    assert not wh.alive(None, now - 3600, now)


def test_news_worker_heartbeat_read_retries_once():
    import json
    from app.services.news_intel import worker_health as wh

    class Flaky:
        calls = 0

        async def get(self, key):
            Flaky.calls += 1
            if Flaky.calls == 1:
                raise ConnectionError("dropped pooled socket")
            return json.dumps({"ts": "2026-11-27T16:00:00Z", "is_leader": True})

    hb = asyncio.run(wh.read_heartbeat(Flaky()))
    assert hb["is_leader"] is True and Flaky.calls == 2


def test_news_worker_check_statuses():
    import json
    from datetime import datetime, timezone
    from app.services.news_intel import worker_health as wh
    now = 1_800_000_000.0
    ts = datetime.fromtimestamp(now - 10, tz=timezone.utc).isoformat()

    class R:
        def __init__(self, v):
            self.v = v

        async def get(self, key):
            return self.v
    ok = asyncio.run(wh.check(R(json.dumps({"ts": ts, "queue_depth": 0})), now=now, with_db=False))
    assert ok["worker_alive"] and ok["status"] == DEGRADED      # alive but no ingest data -> degraded
    dead = asyncio.run(wh.check(R(None), now=now, with_db=False))
    assert not dead["worker_alive"] and dead["status"] == DOWN
