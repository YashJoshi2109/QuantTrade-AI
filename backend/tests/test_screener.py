"""Stock screener: metric computation, outlier handling, query validation, SQL filters, sort, pagination."""
import json
import math
import random
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import screener_service as svc

NOW = datetime(2026, 11, 25, 22, 0, tzinfo=timezone.utc)  # after the 16:00 ET close


def _bars(closes, end=NOW):
    """Daily bars ending the session before `end` (05:00 UTC == midnight ET, like our price_bars)."""
    start = (end - timedelta(days=len(closes))).replace(hour=5, minute=0, second=0, microsecond=0)
    return [(start + timedelta(days=i), c) for i, c in enumerate(closes)]


def _sv(v):
    return json.dumps({"value": v, "unit": "USD"})


# ── pure metrics ─────────────────────────────────────────────────────────────

def test_rsi_matches_indicator_service():
    import pandas as pd
    from app.services.indicators import IndicatorService

    rnd = random.Random(7)
    closes = [100.0]
    for _ in range(80):
        closes.append(closes[-1] * (1 + rnd.uniform(-0.03, 0.03)))
    expected = IndicatorService.compute_rsi(pd.DataFrame({"close": closes}), 14).iloc[-1]
    assert svc.rsi(closes) == pytest.approx(expected)
    assert svc.rsi([1.0 + i for i in range(20)]) == 100.0       # only gains
    assert svc.rsi([5.0] * 20) is None                          # no movement: undefined, not 0 or 50
    assert svc.rsi([1.0] * 10) is None                          # not enough bars


def test_technicals_sma_change_and_live_quote():
    closes = [100.0 + i for i in range(60)]
    t = svc.technicals(_bars(closes))
    assert t["sma_50"] == pytest.approx(sum(closes[-50:]) / 50)
    assert t["sma_200"] is None and t["price_vs_sma200_pct"] is None   # not enough history -> null
    assert t["change_1d_pct"] == pytest.approx((159 / 158 - 1) * 100)
    assert t["change_1m_pct"] == pytest.approx((159 / closes[-22] - 1) * 100)

    # quote from a later session is appended as today's close
    q = {"price": 170.0, "change_percent": 6.9, "market_time": NOW.isoformat()}
    t2 = svc.technicals(_bars(closes), q)
    assert t2["price"] == 170.0 and t2["change_1d_pct"] == 6.9
    assert t2["sma_50"] == pytest.approx((sum(closes[-49:]) + 170) / 50)
    # a quote older than the last bar is ignored
    old = {"price": 1.0, "change_percent": -99, "market_time": (NOW - timedelta(days=30)).isoformat()}
    assert svc.technicals(_bars(closes), old)["price"] == 159.0
    # no data at all
    assert svc.technicals([], None)["price"] is None


def test_fundamental_metrics_units_nulls_and_outliers():
    flags = []
    # yfinance ratio-style row is normalised to percentage points; D/E percent -> ratio
    m = svc.fundamental_metrics({"roe": 0.25, "profit_margin": 0.2, "dividend_yield": 0.03, "debt_to_equity": 66.0,
                                 "pe_ratio": 20.0}, {}, 100.0, 1e9, flags)
    assert m["roe_pct"] == pytest.approx(25) and m["profit_margin_pct"] == pytest.approx(20)
    assert m["dividend_yield_pct"] == pytest.approx(3) and m["debt_to_equity"] == pytest.approx(0.66)
    assert flags == []
    # missing stays None, never 0
    assert all(v is None for v in svc.fundamental_metrics({}, {}, None, None, []).values())

    flags = []
    m = svc.fundamental_metrics({"roe": 4500.0, "pe_ratio": 5000.0, "profit_margin": 30.0}, {}, 10.0, 1e9, flags)
    assert m["roe_pct"] is None and "roe_outlier" in flags
    assert m["pe_ratio"] is None and "pe_outlier" in flags

    flags = []
    m = svc.fundamental_metrics({"pe_ratio": -12.0, "eps": -1.5}, {}, 10.0, 1e9, flags)
    assert m["pe_ratio"] is None and "negative_earnings" in flags

    flags = []
    m = svc.fundamental_metrics({"roe": 300.0}, {"equity": -5e9, "long_term_debt": 1e10}, 10.0, 1e9, flags)
    assert m["roe_pct"] is None and m["debt_to_equity"] is None and "negative_equity" in flags


def test_sec_fallbacks_and_revenue_growth():
    rows = []
    for fy, base in ((2025, 100.0), (2026, 125.0)):
        for fq in (1, 2, 3):
            rows.append({"period": f"{fy}-Q{fq}", "form": "10-Q", "fiscal_year": fy, "fiscal_quarter": fq,
                         "period_end_date": f"{fy}-0{fq * 3}-28", "revenue": _sv(base + fq),
                         "net_income": _sv(10.0), "stockholders_equity": _sv(200.0), "long_term_debt": _sv(50.0)})
    sec = svc.statement_metrics("TST", rows)
    assert sec["revenue_growth_yoy_pct"] == pytest.approx((128 / 103 - 1) * 100, abs=0.01)
    # no fiscal Q4 / 10-K rows, so there is no TTM figure: stays None rather than a partial-year sum
    assert sec["ttm_revenue"] is None
    assert sec["equity"] == 200.0 and sec["long_term_debt"] == 50.0
    flags = []
    m = svc.fundamental_metrics({}, {**sec, "ttm_revenue": 500.0, "ttm_net_income": 40.0}, 10.0, 1000.0, flags)
    assert m["ps_ratio"] == pytest.approx(2.0)
    assert m["profit_margin_pct"] == pytest.approx(8.0)
    assert m["roe_pct"] == pytest.approx(20.0)
    assert m["debt_to_equity"] == pytest.approx(0.25)
    assert m["revenue_growth_yoy_pct"] == pytest.approx(24.27, abs=0.01)


def test_canonical_sector():
    assert svc.canonical_sector("Financials") == "Financial Services"
    assert svc.canonical_sector("Consumer Staples") == "Consumer Defensive"
    assert svc.canonical_sector("ETF") is None and svc.canonical_sector("") is None
    assert svc.canonical_sector("Technology") == "Technology"


# ── query parsing / validation ──────────────────────────────────────────────

def test_parse_screen_defaults_and_values():
    sq = svc.parse_screen({})
    assert (sq.sort, sq.order, sq.limit, sq.offset) == ("market_cap", "desc", 50, 0)
    sq = svc.parse_screen({"pe_max": "15", "mcap_min": "10", "sector": "Technology|Healthcare", "sma50": "above",
                           "sort": "rsi", "order": "asc", "limit": "25", "offset": "50", "utm_source": "x"})
    assert sq.ranges == {"pe": (None, 15.0), "mcap": (10.0, None)}
    assert sq.sectors == ["Healthcare", "Technology"] and sq.sma == {"sma50": "above"}
    assert (sq.sort, sq.order, sq.limit, sq.offset) == ("rsi", "asc", 25, 50)


@pytest.mark.parametrize("params,msg", [
    ({"pe_max": "abc"}, "number"),
    ({"pe_max": "nan"}, "finite"),
    ({"rsi_min": "-5"}, "between"),
    ({"roe_max": "100000"}, "between"),
    ({"pe_min": "20", "pe_max": "10"}, "less than"),
    ({"sort": "password"}, "sort must be"),
    ({"order": "sideways"}, "order"),
    ({"limit": "0"}, "limit"),
    ({"limit": "1000"}, "limit"),
    ({"offset": "-1"}, "offset"),
    ({"sma200": "near"}, "sma200"),
    ({"preset": "moonshot"}, "unknown preset"),
    ({"sector": "Tech; DROP TABLE"}, "invalid sector"),
    ({"q": "<script>"}, "q may"),
])
def test_parse_screen_rejects(params, msg):
    with pytest.raises(svc.ScreenError, match=msg):
        svc.parse_screen(params)


def test_preset_defaults_are_overridable():
    sq = svc.parse_screen({"preset": "oversold"})
    assert sq.ranges["rsi"] == (None, 30.0) and sq.sort == "rsi" and sq.order == "asc" and sq.preset == "oversold"
    sq = svc.parse_screen({"preset": "oversold", "rsi_max": "25", "sort": "market_cap"})
    assert sq.ranges["rsi"] == (None, 25.0) and sq.sort == "market_cap"
    for p in svc.PRESETS:   # every preset is itself valid
        svc.parse_screen({"preset": p.id})


# ── API over a real (SQLite) snapshot ───────────────────────────────────────

@pytest.fixture
def env(monkeypatch):
    from app.api import screener as api
    from app.db.database import Base, get_db
    from app.models.edgar import FinancialStatement
    from app.models.fundamentals import Fundamentals
    from app.models.price import PriceBar
    from app.models.quote_snapshot import QuoteSnapshot
    from app.models.screener_snapshot import ScreenerSnapshot
    from app.models.symbol import Symbol

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[t.__table__ for t in (
        Symbol, Fundamentals, FinancialStatement, PriceBar, QuoteSnapshot, ScreenerSnapshot)])
    SL = sessionmaker(bind=eng)
    s = SL()
    syms = [
        # id, symbol, sector, asset, mcap, fundamentals, closes trend
        (1, "VAL", "Financials", "Equity", dict(market_cap=50e9, pe_ratio=9.0, price_to_sales=1.5, debt_to_equity=0.5,
                                                 dividend_yield=4.0, roe=12.0, profit_margin=20.0), "down"),
        (2, "GRO", "Technology", "Equity", dict(market_cap=200e9, pe_ratio=60.0, price_to_sales=12.0, roe=30.0,
                                                 profit_margin=25.0, quarterly_revenue_growth=40.0), "up"),
        (3, "WEIRD", "Technology", "Equity", dict(market_cap=5e9, roe=2500.0, pe_ratio=-3.0, eps=-2.0), "up"),
        (4, "NODATA", "Healthcare", "Equity", dict(market_cap=1e9), None),
        (5, "FUND", None, "ETF", dict(market_cap=400e9, pe_ratio=20.0), "up"),
        (6, "EMPTY", "Energy", "Equity", None, None),     # no price, no market cap -> not in the snapshot
    ]
    for sid, ticker, sector, asset, fund, trend in syms:
        s.add(Symbol(id=sid, symbol=ticker, name=f"{ticker} Corp", sector=sector, asset_type=asset))
        if fund:
            s.add(Fundamentals(symbol_id=sid, sector=sector, **fund))
        if trend:
            n = 230
            closes = [100 * (1.004 ** i if trend == "up" else 0.996 ** i) for i in range(n)]
            for ts, c in _bars(closes):
                s.add(PriceBar(symbol_id=sid, timestamp=ts, open=c, high=c, low=c, close=c, volume=1000))
    s.add(QuoteSnapshot(symbol="NODATA", payload={"price": 42.0, "change_percent": 1.0,
                                                  "market_time": NOW.isoformat()}, fetched_at=NOW))
    s.commit()
    svc.rebuild_snapshot(s, NOW)
    s.close()

    spawned = []
    monkeypatch.setattr(svc, "_spawn_refresh", lambda: spawned.append(1) or True)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    c.SL, c.spawned = SL, spawned
    return c


def _syms(r):
    assert r.status_code == 200, r.text
    return [x["symbol"] for x in r.json()["results"]]


def test_default_listing_excludes_etfs_and_empty_rows(env):
    r = env.get("/api/v1/screener")
    body = r.json()
    assert _syms(r) == ["GRO", "VAL", "WEIRD", "NODATA"]        # market cap desc
    assert body["total"] == 4 and body["universe"] == 5 and body["as_of"]
    assert "public" in r.headers["cache-control"]
    assert "FUND" in _syms(env.get("/api/v1/screener?include_etfs=true"))


def test_nulls_and_outliers_in_response(env):
    rows = {x["symbol"]: x for x in env.get("/api/v1/screener").json()["results"]}
    w = rows["WEIRD"]
    assert w["roe_pct"] is None and w["pe_ratio"] is None
    assert set(w["flags"]) >= {"roe_outlier", "negative_earnings"}
    n = rows["NODATA"]
    assert n["price"] == 42.0 and n["pe_ratio"] is None and n["rsi_14"] is None and n["dividend_yield_pct"] is None
    assert rows["VAL"]["sector"] == "Financial Services"     # canonicalised
    assert rows["GRO"]["revenue_growth_yoy_pct"] == 40.0


def test_range_filters_exclude_unknown_values(env):
    assert _syms(env.get("/api/v1/screener?pe_max=15")) == ["VAL"]
    assert _syms(env.get("/api/v1/screener?roe_min=0")) == ["GRO", "VAL"]    # WEIRD's ROE is null
    assert _syms(env.get("/api/v1/screener?mcap_min=10&mcap_max=100")) == ["VAL"]   # billions
    assert _syms(env.get("/api/v1/screener?div_yield_min=3")) == ["VAL"]
    assert _syms(env.get("/api/v1/screener?sector=Technology")) == ["GRO", "WEIRD"]
    assert _syms(env.get("/api/v1/screener", params={"sector": "Technology|Financial Services", "pe_min": "1"})) == ["GRO", "VAL"]
    assert _syms(env.get("/api/v1/screener?q=gr")) == ["GRO"]
    assert _syms(env.get("/api/v1/screener?q=weird%20corp")) == ["WEIRD"]


def test_technical_filters(env):
    assert _syms(env.get("/api/v1/screener?sma50=above&sma200=above")) == ["GRO", "WEIRD"]
    assert _syms(env.get("/api/v1/screener?sma200=below")) == ["VAL"]
    assert _syms(env.get("/api/v1/screener?rsi_max=30")) == ["VAL"]        # steady decline -> RSI 0
    assert _syms(env.get("/api/v1/screener?rsi_min=70")) == ["GRO", "WEIRD"]
    assert _syms(env.get("/api/v1/screener?chg1m_min=5")) == ["GRO", "WEIRD"]
    assert _syms(env.get("/api/v1/screener?preset=momentum")) == ["GRO", "WEIRD"]
    assert _syms(env.get("/api/v1/screener?preset=value")) == ["VAL"]


def test_sort_nulls_last_both_directions(env):
    assert _syms(env.get("/api/v1/screener?sort=pe&order=asc")) == ["VAL", "GRO", "NODATA", "WEIRD"]
    assert _syms(env.get("/api/v1/screener?sort=pe&order=desc")) == ["GRO", "VAL", "NODATA", "WEIRD"]
    assert _syms(env.get("/api/v1/screener?sort=symbol&order=asc")) == ["GRO", "NODATA", "VAL", "WEIRD"]


def test_pagination(env):
    p1 = env.get("/api/v1/screener?limit=2&offset=0").json()
    p2 = env.get("/api/v1/screener?limit=2&offset=2").json()
    p3 = env.get("/api/v1/screener?limit=2&offset=4").json()
    assert p1["total"] == p2["total"] == 4
    assert [x["symbol"] for x in p1["results"] + p2["results"]] == ["GRO", "VAL", "WEIRD", "NODATA"]
    assert p3["results"] == [] and p3["total"] == 4


def test_validation_errors_are_422(env):
    for qs in ("pe_max=abc", "sort=hacked", "limit=101", "rsi_min=50&rsi_max=10", "preset=nope"):
        r = env.get(f"/api/v1/screener?{qs}")
        assert r.status_code == 422, qs
        assert isinstance(r.json()["detail"], str)


def test_meta(env):
    m = env.get("/api/v1/screener/meta").json()
    assert {p["id"] for p in m["presets"]} == {"value", "growth", "dividend", "quality", "oversold", "momentum"}
    assert "market_cap" in m["sort_fields"] and {f["key"] for f in m["filters"]} >= {"pe", "rsi", "mcap"}
    assert {s["name"] for s in m["sectors"]} == {"Technology", "Financial Services", "Healthcare"}


def test_stale_snapshot_refreshes_in_background_and_empty_builds_inline(env, monkeypatch):
    from app.models.screener_snapshot import ScreenerSnapshot

    db = env.SL()
    try:
        # NOW-based snapshot is stale relative to the real clock -> background refresh requested
        n, as_of, refreshing = svc.ensure_fresh(db)
        assert n == 5 and refreshing and env.spawned
        # fresh -> no refresh
        env.spawned.clear()
        _, _, refreshing = svc.ensure_fresh(db, now=as_of + timedelta(minutes=1))
        assert not refreshing and not env.spawned
        # empty -> built inline
        db.query(ScreenerSnapshot).delete()
        db.commit()
        n, _, _ = svc.ensure_fresh(db)
        assert n == 5
    finally:
        db.close()


def test_route_handlers_are_sync():
    """DB work must stay off the event loop: handlers are plain `def` (FastAPI threadpool)."""
    import inspect
    from app.api import screener as api

    assert not inspect.iscoroutinefunction(api.screen)
    assert not inspect.iscoroutinefunction(api.screener_meta)
