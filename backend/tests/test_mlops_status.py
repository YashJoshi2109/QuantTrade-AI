"""MLOps Command Center: endpoints return what prod has, with reasons when empty.

Prod (2026-11-26): every file-backed MLOps store (ml/registry, experiments,
drift_reports, prediction_logs, feature_store_data) is empty because the
container disk is reset on deploy, so /mlops/overview and /mlops/models were
all zeros even though Postgres holds 2 training runs and a production model
version. Also nginx replayed a logged-in user's cached 200 to anonymous
callers because its microcache bypass only looked at the Authorization header.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

NOW = datetime.now(timezone.utc)


@pytest.fixture
def make_client(monkeypatch):
    from app.api import mlops
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.fundamentals import Fundamentals
    from app.models.ml_training import ModelVersion, TrainingArtifact, TrainingRun, TrainingShard
    from app.models.price import PriceBar
    from app.models.symbol import Symbol
    from app.models.user import User

    store: dict = {}

    class FakeCache:
        async def get(self, key):
            return store.get(key)

        async def set(self, key, value, ttl=60):
            store[key] = value

    import app.services.redis_cache_service as rcs
    monkeypatch.setattr(rcs, "cache_service", FakeCache())

    def _build(seed: bool):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=eng, tables=[
            User.__table__, Symbol.__table__, PriceBar.__table__, Fundamentals.__table__,
            TrainingRun.__table__, TrainingShard.__table__, TrainingArtifact.__table__, ModelVersion.__table__,
        ])
        SL = sessionmaker(bind=eng)
        s = SL()
        s.add(User(id=1, email="a@example.com", username="a", is_verified=True))
        if seed:
            s.add_all([Symbol(id=1, symbol="AAPL", name="Apple"), Symbol(id=2, symbol="MSFT", name="Microsoft")])
            s.add(PriceBar(symbol_id=1, timestamp=NOW - timedelta(days=1), open=1, high=1, low=1, close=1, volume=1))
            s.add(Fundamentals(symbol_id=1, fetched_at=NOW - timedelta(days=20)))
            rid = uuid.uuid4()
            s.add(TrainingRun(run_id=rid, run_type="manual", status="completed", created_at=NOW))
            s.add(ModelVersion(model_version="v20261126_1303", run_id=rid, promotion_status="production",
                               symbol_count=30, horizons=[7], avg_directional_accuracy=0.5388,
                               avg_information_coefficient=0.1515, created_at=NOW))
            store["forecast:eval:v1:AAPL"] = {
                "as_of": "2026-11-25", "origins": 40, "order_label": "(0,1,1)",
                "horizons": {"1": {"primary": "arima", "rel_mae": 1.01, "dm_pvalue_holm": 0.8, "edge": False,
                                   "holdout_origins": 20, "effective_tests": 20.0},
                             "5": {"primary": "ets", "rel_mae": 0.97, "dm_pvalue_holm": 0.03, "edge": True,
                                   "holdout_origins": 20, "effective_tests": 8.0}},
            }
        s.commit()
        s.close()

        app = FastAPI()
        app.include_router(mlops.router, prefix="/api/v1")

        def _db():
            d = SL()
            try:
                yield d
            finally:
                d.close()

        app.dependency_overrides[get_db] = _db
        c = TestClient(app)
        c.hdrs = {"Authorization": f"Bearer {create_access_token(1)}"}
        return c

    return _build


def test_status_requires_auth(make_client):
    c = make_client(seed=True)
    assert c.get("/api/v1/mlops/status").status_code == 401


def test_status_reports_gate_benchmarks_registry_and_freshness(make_client):
    c = make_client(seed=True)
    r = c.get("/api/v1/mlops/status", headers=c.hdrs)
    assert r.status_code == 200, r.text
    body = r.json()

    gate = body["gate"]
    assert gate["verdict"] == "NOT_READY" and gate["promoted"] is False
    assert gate["benchmark_test"]["benchmark"] == "ARIMA(0,1,0)"
    assert {h["horizon"] for h in gate["benchmark_test"]["horizons"]} == {1, 7}

    reg = body["registry"]
    assert reg["production"]["model_version"] == "v20261126_1303"
    assert reg["runs_total"] == 1 and reg["empty_reason"] is None

    fresh = body["data_freshness"]
    assert fresh["price_bars"]["status"] == "fresh" and fresh["price_bars"]["symbols_covered"] == 1
    assert fresh["fundamentals"]["status"] == "stale"
    assert "days old" in fresh["fundamentals"]["empty_reason"]

    fb = body["forecast_benchmarks"]
    assert fb["cached"] == 1 and fb["edges"] == 1 and fb["tests"] == 2
    assert fb["tickers"][0]["horizons"][0]["primary_label"].startswith("ARIMA")

    assert "reset on every deploy" in body["file_stores"]["empty_reason"]


def test_status_empty_db_explains_every_section(make_client):
    c = make_client(seed=False)
    body = c.get("/api/v1/mlops/status", headers=c.hdrs).json()
    assert body["registry"]["status"] == "empty" and "training run must complete" in body["registry"]["empty_reason"]
    assert body["data_freshness"]["price_bars"]["status"] == "empty"
    assert body["data_freshness"]["fundamentals"]["status"] == "empty"
    assert body["forecast_benchmarks"]["status"] == "empty"
    assert "ARIMA(0,1,0)" in body["forecast_benchmarks"]["empty_reason"]
    # The committed gate snapshot is always available.
    assert body["gate"]["verdict"] == "NOT_READY"


def test_overview_falls_back_to_postgres_registry(make_client):
    c = make_client(seed=True)
    body = c.get("/api/v1/mlops/overview", headers=c.hdrs).json()
    assert body["models"]["registered"] >= 1
    assert "v20261126_1303" in body["models"]["production"]
    assert body["experiments"]["total_runs"] >= 1


def test_alerts_include_gate_and_stale_data(make_client):
    c = make_client(seed=True)
    alerts = c.get("/api/v1/mlops/monitoring/alerts", headers=c.hdrs).json()["alerts"]
    types = {a["type"] for a in alerts}
    assert "gate_not_ready" in types
    assert "data_stale" in types  # fundamentals 20 days old


def test_mlops_responses_are_never_cacheable(make_client):
    c = make_client(seed=True)
    for path in ("/api/v1/mlops/status", "/api/v1/mlops/overview", "/api/v1/mlops/monitoring/alerts"):
        r = c.get(path, headers=c.hdrs)
        assert r.headers.get("cache-control") == "private, no-store", path


def test_nginx_microcache_bypasses_cookie_auth():
    conf = (Path(__file__).resolve().parents[2] / "nginx" / "nginx.conf").read_text()
    bypass = [l.strip() for l in conf.splitlines() if l.strip().startswith(("proxy_cache_bypass", "proxy_no_cache"))]
    assert bypass, "expected microcache bypass rules"
    for line in bypass:
        assert "$cookie_qt_access_token" in line and "$http_authorization" in line, line
