"""GET /api/v1/forecasts/summary: cache-only compact summaries for list pages."""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient



def raw_forecast(edge_20=False):
    return {
        "as_of": "2026-11-25", "last_close": 236.48, "benchmark": {"name": "ARIMA(0,1,0)"},
        "horizons": [{"h": 20, "date": "2026-12-23", "point": 238.1, "exp_return_pct": 0.69, "prob_up": 0.56,
                      "bands": {"80": [219.5, 257.3], "95": [209.0, 268.4]},
                      "reliability": "edge_in_backtest" if edge_20 else "no_edge",
                      "calibration": {"status": "calibrated"},
                      "eval": {"holdout_origins": 40, "coverage": {"80": 0.78, "95": 0.93}}}],
        "beats_naive": {"20": edge_20},
        "ml_model": {"promoted": False, "gates_passed": 6, "gates_total": 10, "gates_required": 8},
    }


@pytest.fixture
def env(monkeypatch):
    from app.api import forecast as api

    store = {f"forecast:{api._CACHE_VERSION}:AAPL": raw_forecast(edge_20=False)}
    computed = []

    async def fake_get(key):
        return store.get(key)

    async def fake_compute(t, refresh=False):
        computed.append(t)
        return {}

    monkeypatch.setattr(api.cache_service, "get", fake_get)
    monkeypatch.setattr(api, "_get_or_compute", fake_compute)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    return api, TestClient(app), computed


def test_ready_pending_and_invalid(env):
    api, c, computed = env
    r = c.get("/api/v1/forecasts/summary", params={"tickers": "aapl, MSFT,AAPL,bad$x"})
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "Experimental · Not investment advice" and body["benchmark"] == "ARIMA(0,1,0)"
    items = {i["ticker"]: i for i in body["items"]}
    assert list(items) == ["AAPL", "MSFT", "BAD$X"]  # de-duplicated, order kept
    assert items["AAPL"]["status"] == "ready"
    h20 = next(h for h in items["AAPL"]["summary"]["horizons"] if h["h"] == 20)
    assert h20["range_80"] == [219.5, 257.3] and h20["midpoint"] is None and h20["hit_rate_80"] == 0.78
    assert items["MSFT"] == {"ticker": "MSFT", "status": "pending", "summary": None}
    assert items["BAD$X"]["status"] == "invalid"
    # the request returned without fitting; MSFT is warmed in the background
    for _ in range(20):
        if computed:
            break
        asyncio.run(asyncio.sleep(0.01))
    assert computed in ([], ["MSFT"])  # TestClient may finish the task after the response


def test_no_warm_and_limits(env):
    api, c, computed = env
    r = c.get("/api/v1/forecasts/summary", params={"tickers": "MSFT", "warm": "false"})
    assert r.status_code == 200 and r.json()["items"][0]["status"] == "pending"
    assert computed == []
    assert c.get("/api/v1/forecasts/summary", params={"tickers": " , "}).status_code == 400
    many = ",".join(f"T{i}" for i in range(51))
    assert c.get("/api/v1/forecasts/summary", params={"tickers": many}).status_code == 400


def test_summary_route_does_not_collide_with_single_forecast(env):
    api, _, _ = env
    paths = [r.path for r in api.router.routes]
    assert "/forecasts/summary" in paths and "/forecast/{ticker}" in paths
