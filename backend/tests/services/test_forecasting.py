"""Forecasting engine + API: honest metrics on synthetic series, calendar, errors."""
import math

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("statsmodels")
pytest.importorskip("arch")

from app.services.forecasting.engine import (  # noqa: E402
    _next_trading_days,
    ensemble_weights,
    forecast,
    horizon_sigma,
)


def _series(log_returns: np.ndarray, start=100.0) -> pd.Series:
    idx = pd.bdate_range("2023-01-02", periods=len(log_returns) + 1)
    return pd.Series(start * np.exp(np.concatenate([[0], np.cumsum(log_returns)])), index=idx)


@pytest.fixture(scope="module")
def random_walk():
    rng = np.random.default_rng(7)
    return _series(rng.standard_t(df=5, size=700) * 0.012)


@pytest.fixture(scope="module")
def rw_result(random_walk):
    return forecast(random_walk, n_origins=30)


def test_shape_and_ordering(rw_result):
    assert [h["h"] for h in rw_result["horizons"]] == [1, 5, 20]
    assert len(rw_result["path"]) == 20
    for row in rw_result["horizons"]:
        lo50, hi50 = row["bands"]["50"]
        lo80, hi80 = row["bands"]["80"]
        lo95, hi95 = row["bands"]["95"]
        assert lo95 <= lo80 <= lo50 <= row["point"] <= hi50 <= hi80 <= hi95
        assert lo95 > 0  # log-space bands never go negative
        assert 0 <= row["prob_up"] <= 1
    widths = [r["bands"]["80"][1] - r["bands"]["80"][0] for r in rw_result["horizons"]]
    assert widths == sorted(widths)  # uncertainty grows with horizon


def test_random_walk_is_not_beaten(rw_result):
    """On a pure random walk nothing should claim an edge."""
    for h, mase in rw_result["backtest"]["mase_vs_naive"].items():
        assert 0.85 < mase < 1.2, (h, mase)
    assert not any(rw_result["beats_naive"].values())


def test_bands_are_calibrated_on_random_walk(rw_result):
    cov = rw_result["backtest"]["band_coverage"]
    for h in ("1", "5"):
        assert 0.6 <= cov[h]["80"] <= 1.0
        assert cov[h]["95"] >= 0.8


def test_trend_is_detected():
    """A steady drift plus small noise should be forecast upward and beat naive at 20d."""
    rng = np.random.default_rng(3)
    s = _series(0.004 + rng.normal(0, 0.002, 700))
    out = forecast(s, n_origins=30)
    h20 = out["horizons"][2]
    assert h20["exp_return_pct"] > 3
    assert out["backtest"]["mase_vs_naive"]["20"] < 0.9


def test_short_history_rejected():
    rng = np.random.default_rng(1)
    with pytest.raises(ValueError, match="need at least"):
        forecast(_series(rng.normal(0, 0.01, 100)))


def test_nyse_calendar_skips_thanksgiving_and_good_friday():
    days = _next_trading_days(pd.Timestamp("2026-11-24"), 3)
    assert [str(d.date()) for d in days] == ["2026-11-25", "2026-11-27", "2026-11-30"]
    days = _next_trading_days(pd.Timestamp("2026-04-02"), 2)  # Good Friday 2026-04-03
    assert [str(d.date()) for d in days] == ["2026-04-06", "2026-04-07"]
    days = _next_trading_days(pd.Timestamp("2026-10-09"), 1)  # Columbus Day: NYSE open
    assert str(days[0].date()) == "2026-10-12"


def test_sigma_guardrail_limits_single_shock():
    r = np.random.default_rng(5).normal(0, 0.01, 400)
    r[-2:] = [-0.15, 0.27]  # NVDA-style shock
    s = horizon_sigma(r, 20)
    rv = np.std(r[-252:], ddof=1)
    assert s[0] <= 2 * rv + 1e-9
    assert np.all(np.diff(s) > 0)


def test_ensemble_weights_shrink_and_clip():
    w = ensemble_weights({"arima": 0.01, "ets": 0.02, "theta": 0.02, "drift": 1.0})
    assert math.isclose(sum(w.values()), 1.0)
    assert all(0.05 - 1e-9 <= v <= 0.6 + 1e-9 for v in w.values())
    assert w["arima"] > w["drift"]


# ── API ────────────────────────────────────────────────────────────────────

def test_api_caches_and_validates(monkeypatch, random_walk):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api import forecast as api

    calls = {"n": 0}

    def fake_load(t):
        calls["n"] += 1
        return random_walk

    store: dict = {}

    async def fake_get(key):
        return store.get(key)

    async def fake_set(key, value, ttl=60):
        store[key] = value

    monkeypatch.setattr(api, "_load_closes", fake_load)
    monkeypatch.setattr(api.cache_service, "get", fake_get)
    monkeypatch.setattr(api.cache_service, "set", fake_set)

    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    c = TestClient(app)

    r = c.get("/api/v1/forecast/aapl")
    assert r.status_code == 200 and r.json()["ticker"] == "AAPL"
    assert c.get("/api/v1/forecast/AAPL").status_code == 200
    assert calls["n"] == 1  # second call served from cache

    assert c.get("/api/v1/forecast/bad$ticker").status_code == 400

    monkeypatch.setattr(api, "_load_closes", lambda t: random_walk.iloc[:50])
    r = c.get("/api/v1/forecast/NEWIPO")
    assert r.status_code == 422 and "needs at least" in r.json()["detail"]
