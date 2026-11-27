"""Backtest jobs survive leaving the page: durable snapshots, re-attach via
``/jobs/latest``, restart handling, per-user isolation, forget, and the
classic backtester as a job."""
from __future__ import annotations

import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bt_fixtures import random_walk
from app.services.backtesting import jobs
from app.services.backtesting.jobs import INTERRUPTED, JobManager, MemoryJobStore, RedisJobStore


def _wait(mgr: JobManager, jid: str, owner: str, timeout: float = 10.0) -> dict:
    t = time.time()
    while time.time() - t < timeout:
        j = mgr.get_public(jid, owner)
        if j and j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.02)
    raise AssertionError("job did not finish")


# ── Manager + store ──────────────────────────────────────────────────────────

def test_finished_result_outlives_memory_and_process():
    store = MemoryJobStore()
    m1 = JobManager(workers=1, budget_s=10, store=store)
    job = m1.submit("7", lambda p, d, c: {"answer": 42})
    done = _wait(m1, job.id, "7")
    assert done["result"] == {"answer": 42}

    # A new process (restart) sharing the store still serves the result.
    m2 = JobManager(workers=1, budget_s=10, store=store)
    again = m2.get_public(job.id, "7")
    assert again["status"] == "done" and again["result"] == {"answer": 42}
    assert m2.latest_public("7")["id"] == job.id
    # Never to another user.
    assert m2.get_public(job.id, "8") is None
    assert m2.latest_public("8") is None


def test_job_running_when_process_died_reports_interrupted():
    store = MemoryJobStore()
    store.save({"id": "abc", "owner": "7", "kind": "lab", "status": "running", "stage": "Sweep", "progress": 0.4,
                "created": time.time(), "started": time.time(), "finished": None, "error": None, "result": None})
    m = JobManager(workers=1, budget_s=10, store=store)
    j = m.get_public("abc", "7")
    assert j["status"] == "error" and j["error"] == INTERRUPTED
    assert "result" not in j


def test_latest_prefers_active_job_and_tracks_kind():
    store = MemoryJobStore()
    m = JobManager(workers=1, budget_s=10, store=store)
    first = m.submit("7", lambda p, d, c: {"n": 1})
    _wait(m, first.id, "7")
    gate = {"go": False}

    def slow(progress, deadline, should_cancel):
        progress("Working", 0.5)
        while not gate["go"]:
            time.sleep(0.01)
        return {"n": 2}

    second = m.submit("7", slow)
    t = time.time()
    while m.get_public(second.id, "7")["status"] != "running" and time.time() - t < 5:
        time.sleep(0.01)
    latest = m.latest_public("7", include_result=False)
    assert latest["id"] == second.id and latest["status"] == "running" and latest["progress"] == 0.5
    # A classic job has its own "latest" pointer.
    assert m.latest_public("7", kind="classic") is None
    gate["go"] = True
    _wait(m, second.id, "7")
    assert m.latest_public("7")["result"] == {"n": 2}


def test_forget_drops_result_everywhere():
    store = MemoryJobStore()
    m = JobManager(workers=1, budget_s=10, store=store)
    job = m.submit("7", lambda p, d, c: {"x": 1})
    _wait(m, job.id, "7")
    assert m.forget(job.id, "8") is False  # not yours
    assert m.forget(job.id, "7") is True
    assert m.get_public(job.id, "7") is None
    assert m.latest_public("7") is None
    assert JobManager(workers=1, budget_s=10, store=store).get_public(job.id, "7") is None


def test_store_failure_never_breaks_jobs():
    class Broken(MemoryJobStore):
        def save(self, snap):
            raise RuntimeError("boom")

    m = JobManager(workers=1, budget_s=10, store=Broken())
    job = m.submit("7", lambda p, d, c: {"ok": True})
    assert _wait(m, job.id, "7")["result"] == {"ok": True}


def test_redis_store_round_trip_and_backoff():
    class FakeRedis:
        def __init__(self):
            self.kv: dict = {}

        def ping(self):
            return True

        def pipeline(self):
            outer = self

            class P:
                def __init__(self):
                    self.ops = []

                def set(self, k, v, ex=None):
                    self.ops.append((k, v))

                def execute(self):
                    for k, v in self.ops:
                        outer.kv[k] = v

            return P()

        def get(self, k):
            return self.kv.get(k)

        def delete(self, k):
            self.kv.pop(k, None)

    s = RedisJobStore(url="redis://unused")
    s._client = FakeRedis()
    snap = {"id": "j1", "owner": "7", "kind": "lab", "status": "done", "result": {"a": 1}}
    s.save(snap)
    assert s.load("j1") == snap and s.latest_id("7", "lab") == "j1"
    assert json.loads(s._client.kv["bt:job:j1"])["owner"] == "7"
    s.forget("j1", "7", "lab")
    assert s.load("j1") is None and s.latest_id("7", "lab") is None

    # Unreachable Redis: calls return None quickly and back off.
    dead = RedisJobStore(url="redis://127.0.0.1:1/0")
    assert dead.load("x") is None
    assert dead._down_until > time.time()
    dead.save(snap)  # no exception


def test_default_store_is_memory_under_test_env(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    assert isinstance(jobs.default_store(), MemoryJobStore)


# ── HTTP API ─────────────────────────────────────────────────────────────────

@pytest.fixture
def api(monkeypatch):
    from app.api import backtest as classic
    from app.api import backtest_v2 as v2
    from app.api.auth import create_access_token
    from app.db.database import get_db

    mgr = JobManager(workers=1, budget_s=30, store=MemoryJobStore())
    monkeypatch.setattr(v2, "manager", mgr)
    monkeypatch.setattr(jobs, "manager", mgr)  # classic imports it lazily from the module
    px = random_walk(600, seed=3, start="2019-01-01")
    monkeypatch.setattr(classic, "_fetch_price_data", lambda t, s, e: px.copy())
    monkeypatch.setattr(classic, "_fetch_benchmark", lambda t, s, e: px.copy())

    app = FastAPI()
    app.include_router(v2.router, prefix="/api/v1")
    app.include_router(classic.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: None
    c = TestClient(app)
    c.a = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.b = {"Authorization": f"Bearer {create_access_token(2)}"}
    c.mgr = mgr
    return c


def _poll(c, jid, headers, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        j = c.get(f"/api/v1/backtest/v2/jobs/{jid}", headers=headers).json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_latest_endpoint_requires_auth_and_is_null_when_empty(api):
    assert api.get("/api/v1/backtest/v2/jobs/latest").status_code == 401
    r = api.get("/api/v1/backtest/v2/jobs/latest", headers=api.a)
    assert r.status_code == 200 and r.json() is None
    assert api.get("/api/v1/backtest/v2/jobs/latest?kind=bogus", headers=api.a).status_code == 422


def test_classic_backtest_runs_as_job_and_reattaches(api):
    body = {"symbol": "TEST", "strategy": "rsi_ma_crossover", "start_date": "2019-03-01T00:00:00",
            "end_date": "2020-12-31T00:00:00", "monte_carlo": False}
    assert api.post("/api/v1/backtest/jobs", json=body).status_code == 401
    r = api.post("/api/v1/backtest/jobs", json=body, headers=api.a)
    assert r.status_code == 202, r.text
    jid = r.json()["id"]
    assert r.json()["kind"] == "classic"
    done = _poll(api, jid, api.a)
    assert done["status"] == "done", done
    assert done["result"]["symbol"] == "TEST" and "total_return" in done["result"]

    # Coming back: latest classic job carries the result; the Lab's latest is unaffected.
    latest = api.get("/api/v1/backtest/v2/jobs/latest?kind=classic", headers=api.a).json()
    assert latest["id"] == jid and latest["result"]["symbol"] == "TEST"
    assert api.get("/api/v1/backtest/v2/jobs/latest", headers=api.a).json() is None
    # Another user sees nothing.
    assert api.get("/api/v1/backtest/v2/jobs/latest?kind=classic", headers=api.b).json() is None
    assert api.get(f"/api/v1/backtest/v2/jobs/{jid}", headers=api.b).status_code == 404

    # Result-less latest for a cheap re-attach check.
    slim = api.get("/api/v1/backtest/v2/jobs/latest?kind=classic&include_result=false", headers=api.a).json()
    assert "result" not in slim

    # Forget (Reset): gone for this user, and 404 for others.
    assert api.delete(f"/api/v1/backtest/v2/jobs/{jid}?forget=true", headers=api.b).status_code == 404
    assert api.delete(f"/api/v1/backtest/v2/jobs/{jid}?forget=true", headers=api.a).status_code == 200
    assert api.get(f"/api/v1/backtest/v2/jobs/{jid}", headers=api.a).status_code == 404


def test_classic_job_bad_input_is_a_job_error(api, monkeypatch):
    from app.api import backtest as classic
    import pandas as pd

    monkeypatch.setattr(classic, "_fetch_price_data", lambda t, s, e: pd.DataFrame())
    body = {"symbol": "NODATA", "strategy": "rsi_ma_crossover", "start_date": "2019-03-01T00:00:00",
            "end_date": "2020-12-31T00:00:00", "monte_carlo": False}
    jid = api.post("/api/v1/backtest/jobs", json=body, headers=api.a).json()["id"]
    j = _poll(api, jid, api.a)
    assert j["status"] == "error" and "No price data" in j["error"]
    bad = dict(body, strategy="nope")
    assert api.post("/api/v1/backtest/jobs", json=bad, headers=api.a).status_code in (400, 422)


def test_get_after_restart_serves_snapshot(api, monkeypatch):
    from app.api import backtest_v2 as v2

    jid = api.mgr.submit("1", lambda p, d, c: {"metrics": {}, "kept": True}).id
    _poll(api, jid, api.a)
    # Simulate a restart: new manager, same durable store.
    monkeypatch.setattr(v2, "manager", JobManager(workers=1, budget_s=30, store=api.mgr.store))
    j = api.get(f"/api/v1/backtest/v2/jobs/{jid}", headers=api.a).json()
    assert j["status"] == "done" and j["result"]["kept"] is True
    # Cancel on a finished snapshot is a harmless no-op.
    assert api.delete(f"/api/v1/backtest/v2/jobs/{jid}", headers=api.a).json()["status"] == "done"
