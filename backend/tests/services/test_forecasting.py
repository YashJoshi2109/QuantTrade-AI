"""Forecasting engine + API.

Synthetic series where the right answer is known:
- AR(1) returns: order selection finds p=1, the coefficient is recovered, and
  the 1-day horizon shows a significant edge over the random walk.
- Pure random walk: no horizon may claim an edge.
- Exogenous leakage: a regressor that only moves the target on the SAME day is
  unusable (it is not known at the origin) and must not produce an edge; the
  same regressor with a one-day lead must. Future exog that would need data
  after the origin raises ExogLeakageError.
"""
import asyncio
import json

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("statsmodels")
pytest.importorskip("arch")

from app.services.forecasting import exog as ex  # noqa: E402
from app.services.forecasting import stats  # noqa: E402
from app.services.forecasting.engine import _next_trading_days, forecast, horizon_sigma  # noqa: E402
from app.services.forecasting.evaluation import evaluate, min_history  # noqa: E402
from app.services.forecasting.models import Arima, OriginData, select_order  # noqa: E402

N = 1000


def _log_prices(r_pct: np.ndarray, start=100.0):
    idx = pd.bdate_range("2021-01-04", periods=len(r_pct) + 1)
    return idx, np.log(start) + np.concatenate([[0], np.cumsum(r_pct / 100)])


def _close(r_pct: np.ndarray) -> pd.Series:
    idx, y = _log_prices(r_pct)
    return pd.Series(np.exp(y), index=idx)


def _ar1(phi=0.5, seed=11):
    rng = np.random.default_rng(seed)
    e = rng.normal(0, 1.0, N)
    r = np.zeros(N)
    for t in range(1, N):
        r[t] = phi * r[t - 1] + e[t]
    return r


@pytest.fixture(scope="module")
def rw_returns():
    return np.random.default_rng(7).standard_t(df=5, size=N) * 1.2


@pytest.fixture(scope="module")
def rw_result(rw_returns):
    from app.services.model_status import annotate_forecast

    return annotate_forecast(forecast(_close(rw_returns), n_origins=60))


# ── Known-answer synthetic series ──────────────────────────────────────────

def test_ar1_order_and_coefficient_recovered():
    r = _ar1(0.5)
    sel = select_order(r[-504:], None)
    assert sel["order"][0] >= 1 and sel["criterion"] == "BIC"
    idx, y = _log_prices(r)
    d = OriginData(y=y[-504:], dates=idx[-504:], future_dates=[], raw_ext=None,
                   dates_ext=idx[-504:], earnings=None)
    m = Arima((1, 0, 0), (0, 0, 0, 0))
    m.step(d, 1, refit=True)
    ar = float(m.res.params[list(m.res.model.param_names).index("ar.L1")])
    assert abs(ar - 0.5) < 0.08


def test_ar1_has_edge_at_one_day():
    idx, y = _log_prices(_ar1(0.5))
    ev = evaluate(y, idx, horizons=(1, 5), n_origins=80)
    assert ev["order"][0] == 1
    h1 = ev["horizons"]["1"]
    assert h1["edge"] is True and h1["served"] != "rw"
    assert h1["rel_mae"] < 0.8 and h1["dm_pvalue_holm"] < 0.05
    assert h1["candidates"]["arima"]["holdout_rel_mae"] < 0.8
    # AR(1) with phi=0.5 has almost no 5-day predictability left
    assert ev["horizons"]["5"]["rel_mae"] > 0.9


def test_random_walk_shows_no_edge(rw_result):
    assert [h["h"] for h in rw_result["horizons"]] == [1, 5, 20, 60]
    assert not any(rw_result["beats_naive"].values())
    for row in rw_result["horizons"]:
        assert row["reliability"] == "no_edge"
        assert row["model"]["served"] == "rw" and row["model"]["centre"] == "random_walk"
        assert row["exp_return_pct"] == 0.0  # centred on no change when there is no edge
        assert row["point"] == rw_result["last_close"]
    for h, m in rw_result["backtest"]["mase_vs_naive"].items():
        assert 0.8 < m < 1.25, (h, m)


def test_bands_ordered_positive_and_widening(rw_result):
    assert len(rw_result["path"]) == 60
    for row in rw_result["horizons"]:
        lo50, hi50 = row["bands"]["50"]
        lo80, hi80 = row["bands"]["80"]
        lo95, hi95 = row["bands"]["95"]
        assert 0 < lo95 <= lo80 <= lo50 <= row["point"] <= hi50 <= hi80 <= hi95
    widths = [r["bands"]["80"][1] - r["bands"]["80"][0] for r in rw_result["horizons"]]
    assert widths == sorted(widths)


def test_coverage_on_random_walk_is_close_to_nominal(rw_result):
    cov = rw_result["backtest"]["band_coverage"]
    for h in ("1", "5"):
        assert 0.6 <= cov[h]["80"] <= 1.0
        assert cov[h]["95"] >= 0.8


def _exog_case(mode: str):
    rng = np.random.default_rng(5)
    x = rng.normal(0, 1.0, N + 1)
    noise = rng.normal(0, 0.6, N + 1)
    lead = np.concatenate([[0], x[:-1]])
    rt = 0.8 * (lead if mode == "lagged" else x) + noise
    idx = pd.bdate_range("2021-01-04", periods=N + 1)
    y = np.log(100) + np.cumsum(rt / 100)
    raw = pd.DataFrame({"mkt": 100 * np.exp(np.cumsum(x / 100))}, index=idx)
    return y, idx, raw


def test_lagged_exog_is_used_and_found():
    y, idx, raw = _exog_case("lagged")
    ev = evaluate(y, idx, raw, horizons=(1, 5), n_origins=80)
    assert "mkt_ret_l1" in ev["exog"]["1"] and "mkt_ret_l5" in ev["exog"]["5"]
    h1 = ev["horizons"]["1"]
    assert h1["primary"] == "sarimax" and h1["edge"] and h1["rel_mae"] < 0.7


def test_contemporaneous_exog_cannot_leak():
    """Same-day market moves explain 64% of the target, but they are unknown
    at the origin. The model only ever sees them lagged, so: no edge."""
    y, idx, raw = _exog_case("contemporaneous")
    ev = evaluate(y, idx, raw, horizons=(1, 5), n_origins=80)
    for h in ("1", "5"):
        assert ev["horizons"][h]["edge"] is False
        assert ev["horizons"][h]["rel_mae"] > 0.95


def test_future_exog_beyond_known_horizon_raises():
    idx = pd.bdate_range("2024-01-01", periods=300)
    raw = pd.DataFrame({"mkt": np.linspace(100, 130, 300), "vix": np.full(300, 15.0)}, index=idx)
    future = list(pd.bdate_range(idx[-1] + pd.Timedelta(days=1), periods=5))
    specs_l1 = ex.column_specs(raw.columns, lag=1, earnings=False)
    feats = ex.build_features(idx, raw, lag=1, future_dates=future)
    # declared: lag-1 columns are only known 1 day ahead
    with pytest.raises(ex.ExogLeakageError, match="not known 5 days ahead"):
        ex.future_exog(feats, len(idx), 5, specs_l1)
    # actual: even with the declaration bypassed, day 2+ values are NaN because
    # raw data after the origin is never handed to the feature builder
    lying = [ex.ExogColumn(c.name, c.family, None) for c in specs_l1]
    with pytest.raises(ex.ExogLeakageError, match="need data after the forecast origin"):
        ex.future_exog(feats, len(idx), 5, lying)
    # horizon 1 is fine, and columns_for_horizon drops lag-1 columns at h=5
    assert ex.future_exog(feats, len(idx), 1, specs_l1).shape == (1, len(specs_l1))
    kept = {c.name for c in ex.columns_for_horizon(specs_l1, 5)}
    assert kept == set(ex.CALENDAR_COLUMNS)


def test_feature_values_never_use_future_raw():
    idx = pd.bdate_range("2024-01-01", periods=200)
    raw = pd.DataFrame({"mkt": np.exp(np.random.default_rng(0).normal(0, 0.01, 200).cumsum())}, index=idx)
    full = ex.build_features(idx, raw, lag=5)
    cut = ex.build_features(idx[:150], raw.iloc[:150], lag=5, future_dates=list(idx[150:155]))
    # rows known at the cut (incl. 5 future rows) match the full-data features exactly
    np.testing.assert_allclose(cut["mkt_ret_l5"].to_numpy()[10:], full["mkt_ret_l5"].to_numpy()[10:155])


def test_earnings_dummy_only_for_horizons_it_is_known():
    specs = ex.column_specs(["mkt"], lag=60, earnings=True)
    assert "earnings_session" not in {c.name for c in ex.columns_for_horizon(specs, 60)}
    assert "earnings_session" in {c.name for c in ex.columns_for_horizon(ex.column_specs([], 20, True), 20)}
    days = pd.bdate_range("2026-01-26", periods=10)
    s = ex.earnings_sessions_from_timestamps(
        [pd.Timestamp("2026-01-29 16:00", tz="America/New_York"),   # after close -> next day
         pd.Timestamp("2026-02-03 07:00", tz="America/New_York")], days)  # pre-market -> same day
    assert {str(d.date()) for d in s} == {"2026-01-30", "2026-02-03"}


def test_calendar_turn_of_month():
    d = pd.DatetimeIndex(["2026-01-28", "2026-01-29", "2026-01-30", "2026-02-02", "2026-02-03",
                          "2026-02-04", "2026-02-05"])
    cal = ex.calendar_frame(d)
    assert cal["turn_of_month"].tolist() == [0, 0, 1, 1, 1, 1, 0]
    assert cal["january"].tolist() == [1, 1, 1, 0, 0, 0, 0]


# ── Statistics ─────────────────────────────────────────────────────────────

def test_diebold_mariano_and_overlap():
    rng = np.random.default_rng(1)
    base = rng.normal(0, 1, 200)
    assert stats.diebold_mariano(base, base, 1, 5)["pvalue"] == 1.0
    better = stats.diebold_mariano(base * 0.5, base, 1, 5)
    assert better["pvalue"] < 0.001
    worse = stats.diebold_mariano(base * 1.5, base, 1, 5)
    assert worse["pvalue"] > 0.99
    # same data, overlapping 60-day windows: much weaker evidence
    small = rng.normal(0, 1, 60)
    p1 = stats.diebold_mariano(small * 0.85, small + rng.normal(0, 0.3, 60), 1, 5)["pvalue"]
    p60 = stats.diebold_mariano(small * 0.85, small + rng.normal(0, 0.3, 60), 60, 5)["pvalue"]
    assert p60 >= p1 or p60 > 0.01
    assert stats.overlap_k(60, 5) == 12 and stats.effective_n(48, 20, 5) == 12


def test_pesaran_timmermann_gives_always_up_no_skill():
    actual = np.random.default_rng(2).normal(0.1, 1, 100)  # bull market: ~54% up days
    assert stats.pesaran_timmermann(np.ones(100), actual, 1, 5)["pvalue"] == 1.0
    assert stats.pesaran_timmermann(actual, actual, 1, 5)["pvalue"] < 1e-6


def test_coverage_and_holm():
    z = np.abs(np.random.default_rng(3).standard_normal(20000))
    assert abs(stats.coverage(z, 1.2816) - 0.80) < 0.01
    assert abs(stats.coverage(z, 1.96) - 0.95) < 0.01
    assert stats.coverage([], 1.0) is None
    adj = stats.holm({"1": 0.01, "5": 0.04, "20": 0.5})
    assert adj == {"1": 0.03, "5": 0.08, "20": 0.5}


# ── Calendar / volatility / errors ─────────────────────────────────────────

def test_short_history_rejected():
    rng = np.random.default_rng(1)
    with pytest.raises(ValueError, match="need at least"):
        forecast(_close(rng.normal(0, 1, min_history() - 50)))


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


def test_eval_budget_bounds_work(rw_returns):
    import time

    idx, y = _log_prices(rw_returns)
    ev = evaluate(y, idx, n_origins=100, deadline=time.monotonic() + 1.0)
    assert ev["budget_hit"] is True and ev["origins"] < ev["origins_planned"]
    assert not any(h["edge"] for h in ev["horizons"].values())


# ── API contract ───────────────────────────────────────────────────────────

LEGACY_TOP = {"ticker", "as_of", "last_close", "horizons", "path", "models", "vol_annualized_pct",
              "backtest", "beats_naive", "method", "disclaimer", "status", "label", "investment_advice",
              "ml_model", "generated_at"}
LEGACY_BACKTEST = {"origins", "period", "mase_vs_naive", "directional_accuracy", "directional_pvalue",
                   "band_coverage", "band_scale", "model_mae_logret"}
LEGACY_ROW = {"h", "date", "point", "exp_return_pct", "prob_up", "bands", "sigma_log", "reliability",
              "calibration"}


@pytest.fixture
def api_env(monkeypatch, rw_returns):
    from app.api import forecast as api

    close = _close(rw_returns)
    calls = {"closes": 0, "evals_passed": []}

    def fake_closes(t):
        calls["closes"] += 1
        return close

    store: dict = {}

    async def fake_get(key):
        return store.get(key)

    async def fake_set(key, value, ttl=60):
        store[key] = value

    real_compute = api._compute_unlimited

    def spy_compute(t, evaluation, state=None):
        calls["evals_passed"].append(evaluation is not None)
        calls.setdefault("states_passed", []).append(state is not None)
        return real_compute(t, evaluation, state)

    rng = np.random.default_rng(9)
    mkt = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, len(close)))), index=close.index)
    monkeypatch.setattr(api, "_load_closes", fake_closes)
    monkeypatch.setattr(api, "_load_exog", lambda t: pd.DataFrame({"mkt": mkt, "vix": 15 + mkt * 0}))
    monkeypatch.setattr(api, "_load_earnings", lambda t: None)
    monkeypatch.setattr(api, "_compute_unlimited", spy_compute)
    monkeypatch.setattr(api.cache_service, "get", fake_get)
    monkeypatch.setattr(api.cache_service, "set", fake_set)
    return api, store, calls


def test_api_contract_backward_compatible(api_env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    api, store, calls = api_env
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    c = TestClient(app)

    r = c.get("/api/v1/forecast/aapl")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "AAPL"
    assert LEGACY_TOP <= set(body)
    assert LEGACY_BACKTEST <= set(body["backtest"])
    assert body["status"] == "experimental" and "Not investment advice" in body["label"]
    assert body["investment_advice"] is False
    assert "_evaluation" not in body
    for row in body["horizons"]:
        assert LEGACY_ROW <= set(row)
        assert row["reliability"] in ("edge_in_backtest", "no_edge")
        assert set(row["bands"]) == {"50", "80", "95"}
        assert {"primary", "served", "why", "exog"} <= set(row["model"])
        assert {"rel_mae", "dm_pvalue_holm", "dir_acc", "dir_pvalue", "coverage", "edge"} <= set(row["eval"])
    # new fields: model name, order, exog used, eval metrics
    assert body["model"]["name"].startswith("SARIMAX(")
    assert len(body["model"]["order"]) == 3
    assert "mkt_ret_l1" in body["model"]["exog_used"]["1"]
    assert "mkt_ret_l1" not in body["model"]["exog_used"]["5"]  # not known 5 days ahead
    assert body["exog_sources"] == ["mkt", "vix"]
    assert set(body["backtest"]["dm_pvalue_holm"]) == {"1", "5", "20", "60"}
    # 60-day windows 5 days apart are heavily overlapped: coverage not judged
    h60 = next(r for r in body["horizons"] if r["h"] == 60)
    assert h60["calibration"]["status"] == "insufficient_data"

    # cached: second call does not refit
    assert c.get("/api/v1/forecast/AAPL").status_code == 200
    assert calls["closes"] == 1
    # evaluation cached separately; a forecast-cache miss reuses it
    assert f"forecast:eval:v1:AAPL" in store
    del store[f"forecast:{api._CACHE_VERSION}:AAPL"]
    assert c.get("/api/v1/forecast/AAPL").status_code == 200
    assert calls["evals_passed"] == [False, True]
    # serving state persisted (small) and reused: second fit only filters
    st = store[f"forecast:state:v1:AAPL"]
    assert len(json.dumps(st)) < 20_000
    assert calls["states_passed"] == [False, True]
    assert "_state" not in body and body["model_state"]["mode"] == "refit"
    assert body["benchmark"]["name"] == "ARIMA(0,1,0)"

    assert c.get("/api/v1/forecast/bad$ticker").status_code == 400


def test_api_rejects_short_history(api_env, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    api, _, _ = api_env
    monkeypatch.setattr(api, "_load_closes", lambda t: _close(np.zeros(100)))
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    r = TestClient(app).get("/api/v1/forecast/NEWIPO")
    assert r.status_code == 422 and "needs at least" in r.json()["detail"]


def test_warm_skips_cached_and_survives_errors(api_env, monkeypatch):
    api, store, _ = api_env
    store[f"forecast:{api._CACHE_VERSION}:AAPL"] = {"cached": True}
    real = api._load_closes

    def flaky(t):
        if t == "BAD":
            raise RuntimeError("provider down")
        return real(t)

    monkeypatch.setattr(api, "_load_closes", flaky)
    n = asyncio.run(api.warm_forecasts(("AAPL", "BAD", "MSFT"), pause=0))
    assert n == 1  # AAPL cached, BAD failed, MSFT fitted
    assert store[f"forecast:{api._CACHE_VERSION}:MSFT"]["ticker"] == "MSFT"
    assert all(api._TICKER_RE.match(t) for t in api.WARM_TICKERS)


# ── Real-time updating: Kalman-filter new bars, refit only on schedule ──────

def _sx(endog, exog=None, order=(1, 0, 1)):
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    return SARIMAX(endog, exog=exog, order=order, trend="c", concentrate_scale=True)


def test_append_without_refit_matches_fixed_param_filter():
    """results.append(new, refit=False) must give the same one-step forecast as
    filtering the whole series with the same (not re-estimated) parameters."""
    rng = np.random.default_rng(4)
    r = _ar1(0.4, seed=4)[:450]
    X = rng.normal(size=(452, 2))
    res = _sx(r[:400], X[:400]).fit(disp=False)
    appended = res.append(r[400:450], exog=X[400:450], refit=False)
    full = _sx(r, X[:450]).filter(res.params)
    np.testing.assert_allclose(appended.forecast(1, exog=X[450:451]), full.forecast(1, exog=X[450:451]), rtol=1e-8)
    np.testing.assert_allclose(appended.params, res.params)  # nothing re-estimated


def test_persisted_state_resume_matches_append():
    """export() -> JSON -> resume() on the new bars == append(refit=False)."""
    from app.services.forecasting.models import Arima

    r = _ar1(0.4, seed=8)
    idx, y = _log_prices(r)
    d0 = OriginData(y=y[:500], dates=idx[:500], future_dates=[], raw_ext=None, dates_ext=idx[:500], earnings=None)
    m = Arima((1, 0, 1), (0, 0, 0, 0))
    m.step(d0, 1, refit=True)
    stored = json.loads(json.dumps(m.export()))
    expected = m.res.append(100 * np.diff(y[499:520]), refit=False).forecast(5)

    # the next request sees a rolled window ending 20 bars later
    d1 = OriginData(y=y[20:520], dates=idx[20:520], future_dates=[], raw_ext=None, dates_ext=idx[20:520],
                    earnings=None)
    fresh = Arima((1, 0, 1), (0, 0, 0, 0))
    z = fresh.resume(stored, d1)
    np.testing.assert_allclose(fresh.res.forecast(5), expected, rtol=1e-8)
    assert len(z) == 20 and np.all(np.isfinite(z))  # one-step errors of the 20 bars after the anchor


def test_walk_forward_extend_matches_fixed_param_filter():
    """Between refits the evaluation extends the fitted results instead of
    re-estimating; the forecast equals a fixed-param filter over all bars seen."""
    from app.services.forecasting.models import Arima

    r = _ar1(0.4, seed=9)
    idx, y = _log_prices(r)
    m = Arima((1, 0, 0), (0, 0, 0, 0))
    mk = lambda a, b: OriginData(y=y[a:b], dates=idx[a:b], future_dates=[], raw_ext=None,  # noqa: E731
                                 dates_ext=idx[a:b], earnings=None)
    m.step(mk(0, 504), 1, refit=True)
    params = m.res.params
    out = m.step(mk(5, 509), 3, refit=False)
    full = _sx(100 * np.diff(y[:509]), order=(1, 0, 0)).filter(params)
    np.testing.assert_allclose(out, np.cumsum(full.forecast(3)) / 100, rtol=1e-8)


@pytest.fixture(scope="module")
def served_state(rw_returns):
    close = _close(rw_returns)
    rng = np.random.default_rng(12)
    raw = pd.DataFrame({"mkt": 100 * np.exp(np.cumsum(rng.normal(0, 0.01, len(close))))}, index=close.index)
    # exog included: resuming over 1-3 new bars must not trip statsmodels' spec checks
    first = forecast(close.iloc[:-3], raw=raw, n_origins=40)
    return close, first, raw


def test_serving_filters_new_bars_without_refit(served_state):
    close, first, raw = served_state
    assert first["model_state"]["mode"] == "refit"
    ev, st = first["_evaluation"], first["_state"]
    second = forecast(close, raw=raw, evaluation=ev, state=st)
    ms = second["model_state"]
    assert ms["mode"] == "filtered" and ms["refit_reason"] is None
    assert ms["fit_date"] == first["as_of"] and ms["bars_since_fit"] == 3
    assert second["_state"]["fit_date"] == first["as_of"]
    assert second["_state"]["arima"]["params"] == st["arima"]["params"]  # not re-estimated
    assert len(second["_state"]["z_recent"]) == 3


def test_serving_refits_on_schedule_and_on_drift(served_state, rw_returns):
    from app.services.forecasting.engine import REFIT_BARS
    from app.services.forecasting.models import drift_failed

    close, first, raw = served_state
    ev, st = first["_evaluation"], first["_state"]
    old = dict(st, fit_date=str(close.index[-REFIT_BARS - 2].date()))
    assert forecast(close, raw=raw, evaluation=ev, state=old)["model_state"]["refit_reason"].startswith("scheduled")
    drifted = dict(st, z_recent=[3.0] * 15)
    assert "drift" in forecast(close, raw=raw, evaluation=ev, state=drifted)["model_state"]["refit_reason"]
    other = dict(st, order=[2, 0, 2])
    assert forecast(close, raw=raw, evaluation=ev, state=other)["model_state"]["refit_reason"] == "order re-selected"
    assert drift_failed([3.0] * 12) and not drift_failed([1.0] * 20) and not drift_failed([5.0] * 5)
