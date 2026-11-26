"""Honesty labels: ML promotion status + forecast annotations."""
from __future__ import annotations

import json

import pytest

from app.services import model_status as ms


@pytest.fixture(autouse=True)
def _clear_cache():
    ms.ml_model_status.cache_clear()
    yield
    ms.ml_model_status.cache_clear()


def _write(tmp_path, monkeypatch, payload):
    p = tmp_path / "status.json"
    p.write_text(payload if isinstance(payload, str) else json.dumps(payload))
    monkeypatch.setattr(ms, "STATUS_PATH", p)


def test_committed_status_is_not_ready():
    # The served LSTM has not passed the gate; the shipped snapshot must say so.
    s = ms.ml_model_status()
    assert s["verdict"] == "NOT_READY"
    assert ms.ml_model_promoted() is False
    assert "experimental" in ms.ml_status_summary()["note"].lower()


def test_missing_or_corrupt_status_defaults_to_not_ready(tmp_path, monkeypatch):
    monkeypatch.setattr(ms, "STATUS_PATH", tmp_path / "nope.json")
    assert ms.ml_model_promoted() is False
    ms.ml_model_status.cache_clear()
    _write(tmp_path, monkeypatch, "{not json")
    assert ms.ml_model_promoted() is False
    ms.ml_model_status.cache_clear()
    _write(tmp_path, monkeypatch, {"verdict": "YES!"})
    assert ms.ml_model_promoted() is False


def test_ready_requires_enough_gates(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {"verdict": "READY", "gates_passed": 7, "gates_required": 8})
    assert ms.ml_model_promoted() is False
    ms.ml_model_status.cache_clear()
    _write(tmp_path, monkeypatch, {"verdict": "READY", "gates_passed": 8, "gates_required": 8})
    assert ms.ml_model_promoted() is True


def test_summary_note_mentions_gate_count(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {"verdict": "NOT_READY", "gates_passed": 6})
    note = ms.ml_status_summary()["note"]
    assert "6 of 10" in note and "not used" in note


@pytest.mark.parametrize("cov,status", [
    ({"80": 0.81, "95": 0.94}, "calibrated"),
    ({"80": 0.60, "95": 0.85}, "under_covered"),
    ({"80": 0.97, "95": 1.00}, "over_covered"),
])
def test_band_calibration(cov, status):
    assert ms.band_calibration(cov, 40)["status"] == status


def test_band_calibration_needs_enough_origins():
    assert ms.band_calibration({"80": 0.8, "95": 0.95}, 5)["status"] == "insufficient_data"
    assert ms.band_calibration(None, 40)["status"] == "insufficient_data"


def test_annotate_forecast_labels_every_horizon():
    out = {
        "horizons": [{"h": 1}, {"h": 20}],
        "beats_naive": {"1": False, "20": True},
        "backtest": {"origins": 40, "band_coverage": {
            "1": {"50": 0.5, "80": 0.79, "95": 0.95}, "20": {"50": 0.3, "80": 0.55, "95": 0.8}}},
    }
    ms.annotate_forecast(out)
    assert out["status"] == "experimental" and out["investment_advice"] is False
    assert "Not investment advice" in out["label"]
    assert out["ml_model"]["used_in_forecast"] is False
    h1, h20 = out["horizons"]
    assert h1["reliability"] == "no_edge" and h1["calibration"]["status"] == "calibrated"
    assert h20["reliability"] == "edge_in_backtest"
    assert h20["calibration"]["status"] == "under_covered"


def test_forecast_endpoint_returns_honesty_fields(monkeypatch):
    import numpy as np
    import pandas as pd
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api import forecast as api

    rng = np.random.default_rng(3)
    idx = pd.bdate_range("2023-01-02", periods=420)
    closes = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, len(idx)))), index=idx)
    monkeypatch.setattr(api, "_load_closes", lambda t: closes)
    store: dict = {}

    async def fake_get(key):
        return store.get(key)

    async def fake_set(key, value, ttl=60):
        store[key] = value

    monkeypatch.setattr(api.cache_service, "get", fake_get)
    monkeypatch.setattr(api.cache_service, "set", fake_set)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    body = TestClient(app).get("/api/v1/forecast/TEST").json()
    assert body["status"] == "experimental"
    assert body["ml_model"]["used_in_forecast"] is False
    assert all(h["reliability"] in ("edge_in_backtest", "no_edge") for h in body["horizons"])
    assert all("status" in h["calibration"] for h in body["horizons"])
    assert api._CACHE_VERSION == "v2"  # old cached payloads lack the labels
