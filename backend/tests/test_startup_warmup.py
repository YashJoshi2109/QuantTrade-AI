"""Bounded post-deploy warm-up gate (/health/ready) and /health compatibility."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.services import warmup


@pytest.fixture(autouse=True)
def _reset_state():
    warmup.reset()
    yield
    warmup.reset()


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_warmup_completes_and_marks_ready():
    seen = []

    async def warm(tickers):
        seen.extend(tickers)
        return len(tickers)

    out = _run(warmup.run_startup_warmup(warm, tickers=("SPY", "AAPL"), timeout=5))
    assert seen == ["SPY", "AAPL"]
    assert out["state"] == "ready" and out["ready"] is True and out["warmed"] == 2


def test_warmup_timeout_still_marks_ready():
    async def slow(_tickers):
        await asyncio.sleep(10)
        return 0

    out = _run(warmup.run_startup_warmup(slow, tickers=("SPY",), timeout=0.05))
    assert out["state"] == "timeout"
    assert warmup.is_ready()


def test_warmup_provider_error_still_marks_ready():
    async def boom(_tickers):
        raise RuntimeError("provider down")

    out = _run(warmup.run_startup_warmup(boom, tickers=("SPY",), timeout=5))
    assert out["state"] == "error" and "provider down" in out["detail"]
    assert warmup.is_ready()


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("WARMUP_TIMEOUT_S", "7")
    monkeypatch.setenv("WARMUP_TICKERS", "spy, qqq,")
    assert warmup.timeout_s() == 7.0
    assert warmup.startup_tickers() == ("SPY", "QQQ")
    monkeypatch.setenv("WARMUP_TIMEOUT_S", "nope")
    assert warmup.timeout_s() == warmup.DEFAULT_TIMEOUT_S


def test_ready_endpoint_gates_on_warmup_but_health_stays_200(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc123")
    from app.main import app

    client = TestClient(app)  # no lifespan: warm-up never started -> pending
    r = client.get("/health/ready")
    assert r.status_code == 503 and r.json()["ready"] is False

    h = client.get("/health")
    assert h.status_code == 200
    assert h.json()["version"] == "abc123"
    assert h.json()["warm"]["state"] == "pending"

    warmup.mark_skipped("test")
    r = client.get("/health/ready")
    assert r.status_code == 200 and r.json()["ready"] is True
    assert r.json()["version"] == "abc123"
