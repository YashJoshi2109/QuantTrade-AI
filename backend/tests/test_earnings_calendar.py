"""Earnings calendar: source parsing, merge, caching, API filters, and earnings pre-alerts."""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import earnings_calendar as cal


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.services.redis_cache_service import cache_service
    cache_service._fallback.clear_prefix("qt:earn")
    yield
    cache_service._fallback.clear_prefix("qt:earn")


FINNHUB = {
    "earningsCalendar": [
        {"date": "2026-12-02", "epsActual": None, "epsEstimate": 2.41, "hour": "amc", "quarter": 3,
         "revenueActual": None, "revenueEstimate": 10_120_000_000, "symbol": "CRM", "year": 2026},
        {"date": "2026-11-24", "epsActual": 9.16, "epsEstimate": 6.55, "hour": "", "quarter": 3,
         "revenueActual": 27_000_000_000, "revenueEstimate": 25_000_000_000, "symbol": "DELL", "year": 2026},
        {"date": "bad", "symbol": "X"},
        {"date": "2026-12-03", "symbol": ""},
        {"date": "2026-12-03", "symbol": "ZERO", "epsActual": 0.1, "epsEstimate": 0, "hour": "bmo"},
    ]
}

NASDAQ_DAY = {
    "data": {
        "rows": [
            {"symbol": "CRM", "name": "Salesforce, Inc.", "time": "time-after-hours", "epsForecast": "$2.40",
             "marketCap": "$159,052,972,000", "fiscalQuarterEnding": "Oct/2026", "noOfEsts": "13",
             "lastYearEPS": "$2.66"},
            {"symbol": "SNOW", "name": "Snowflake Inc.", "time": "time-pre-market", "epsForecast": "($0.84)",
             "marketCap": "$60,000,000,000", "noOfEsts": "N/A"},
            {"symbol": "TINY", "name": "Tiny Co", "time": "time-not-supplied", "epsForecast": "N/A",
             "marketCap": "N/A"},
        ]
    }
}


# ── parsing ──────────────────────────────────────────────────────────────────

def test_parse_money_and_surprise():
    assert cal.parse_money("$9.16") == 9.16
    assert cal.parse_money("($0.84)") == -0.84
    assert cal.parse_money("-$1.20") == -1.2
    assert cal.parse_money("$159,052,972,000") == 159_052_972_000
    for missing in ("N/A", "", None, "--", "abc"):
        assert cal.parse_money(missing) is None
    assert cal.surprise_pct(9.16, 6.55) == pytest.approx(39.85, abs=0.01)
    assert cal.surprise_pct(-0.5, -1.0) == pytest.approx(50.0)  # beat on a loss estimate is positive
    assert cal.surprise_pct(1.0, 0) is None
    assert cal.surprise_pct(None, 1.0) is None
    assert cal.surprise_pct(1.0, None) is None


def test_cap_tiers():
    assert cal.cap_tier(3e12) == "mega"
    assert cal.cap_tier(200e9) == "mega"
    assert cal.cap_tier(50e9) == "large"
    assert cal.cap_tier(5e9) == "mid"
    assert cal.cap_tier(1e9) == "small"
    assert cal.cap_tier(50e6) == "micro"
    assert cal.cap_tier(None) is None and cal.cap_tier(0) is None and cal.cap_tier(float("nan")) is None


def test_parse_finnhub_skips_bad_rows_and_keeps_nulls():
    rows = cal.parse_finnhub_earnings(FINNHUB)
    assert [r["symbol"] for r in rows] == ["CRM", "DELL", "ZERO"]
    crm = rows[0]
    assert crm["hour"] == "amc" and crm["eps_actual"] is None and crm["eps_estimate"] == 2.41
    assert crm["fiscal_period"] == "Q3 2026"
    assert rows[1]["hour"] is None  # "" is unknown, not a guess
    assert cal.parse_finnhub_earnings({}) == [] and cal.parse_finnhub_earnings(None) == []


def test_parse_nasdaq_day():
    rows = cal.parse_nasdaq_earnings(NASDAQ_DAY, "2026-12-02")
    by = {r["symbol"]: r for r in rows}
    assert by["CRM"]["hour"] == "amc" and by["CRM"]["market_cap"] == 159_052_972_000
    assert by["CRM"]["num_estimates"] == 13 and by["CRM"]["date"] == "2026-12-02"
    assert by["SNOW"]["hour"] == "bmo" and by["SNOW"]["eps_estimate"] == -0.84
    assert by["SNOW"]["num_estimates"] is None
    assert by["TINY"]["hour"] is None and by["TINY"]["eps_estimate"] is None and by["TINY"]["market_cap"] is None
    assert cal.parse_nasdaq_earnings({"data": None}, "2026-12-02") == []


def test_merge_prefers_finnhub_numbers_and_fills_from_nasdaq():
    fh = cal.parse_finnhub_earnings(FINNHUB)
    nq = cal.parse_nasdaq_earnings(NASDAQ_DAY, "2026-12-02")
    merged = cal.merge_earnings(fh, nq)
    by = {(r["symbol"], r["date"]): r for r in merged}
    crm = by[("CRM", "2026-12-02")]
    assert crm["eps_estimate"] == 2.41  # Finnhub wins
    assert crm["name"] == "Salesforce, Inc." and crm["market_cap"] == 159_052_972_000  # Nasdaq fills
    assert crm["revenue_estimate"] == 10_120_000_000
    assert crm["status"] == "upcoming" and crm["eps_surprise_pct"] is None
    assert sorted(crm["sources"]) == ["finnhub", "nasdaq"]
    dell = by[("DELL", "2026-11-24")]
    assert dell["status"] == "reported"
    assert dell["eps_surprise_pct"] == pytest.approx(39.85, abs=0.01)
    assert dell["revenue_surprise_pct"] == pytest.approx(8.0)
    assert by[("ZERO", "2026-12-03")]["eps_surprise_pct"] is None  # estimate 0: undefined, not inf
    # date order, then bmo before amc on the same day
    days = [r["date"] for r in merged]
    assert days == sorted(days)
    same_day = [r["symbol"] for r in merged if r["date"] == "2026-12-02"]
    assert same_day.index("SNOW") < same_day.index("CRM")


def test_merge_uses_nasdaq_surprise_only_when_actual_known():
    nq = [{"symbol": "A", "date": "2026-11-24", "eps_actual": 1.0, "eps_estimate": None,
           "nasdaq_surprise_pct": 12.5, "source": "nasdaq"},
          {"symbol": "B", "date": "2026-11-24", "eps_actual": None, "eps_estimate": 1.0,
           "nasdaq_surprise_pct": 5.0, "source": "nasdaq"}]
    by = {r["symbol"]: r for r in cal.merge_earnings([], nq)}
    assert by["A"]["eps_surprise_pct"] == 12.5
    assert by["B"]["eps_surprise_pct"] is None
    assert "nasdaq_surprise_pct" not in by["A"]


# ── fetching + cache ─────────────────────────────────────────────────────────

def test_fetch_window_caches_and_survives_finnhub_outage():
    calls = {"fh": 0, "nq": []}

    def fh(s, e):
        calls["fh"] += 1
        return None  # no key / rate limited

    async def nq(days):
        calls["nq"].append(list(days))
        return {d: cal.parse_nasdaq_earnings(NASDAQ_DAY, d) if d == "2026-12-02" else [] for d in days}

    today = date(2026, 11, 30)
    out = asyncio.run(cal.fetch_window(date(2026, 11, 30), date(2026, 12, 6), today=today, finnhub_fn=fh, nasdaq_fn=nq))
    assert out["sources"] == {"finnhub": False, "nasdaq": True}
    assert {r["symbol"] for r in out["rows"]} == {"CRM", "SNOW", "TINY"}
    assert len(calls["nq"][0]) == 7

    # Second call: Nasdaq days come from cache; Finnhub (unavailable, not cached) is retried.
    asyncio.run(cal.fetch_window(date(2026, 11, 30), date(2026, 12, 6), today=today, finnhub_fn=fh, nasdaq_fn=nq))
    assert len(calls["nq"]) == 1 and calls["fh"] == 2


def test_fetch_window_rejects_long_windows():
    with pytest.raises(ValueError):
        asyncio.run(cal.fetch_window(date(2026, 1, 1), date(2026, 3, 1)))


def test_next_event_and_days_until():
    rows = [{"symbol": "A", "date": "2026-11-20"}, {"symbol": "A", "date": "2026-12-10"},
            {"symbol": "A", "date": "2026-12-03"}, {"symbol": "B", "date": "2026-11-30"}]
    m = cal.next_event_map(rows, date(2026, 11, 30))
    assert m["A"]["date"] == "2026-12-03" and m["B"]["date"] == "2026-11-30"
    assert cal.days_until("2026-12-03", date(2026, 11, 30)) == 3
    assert cal.days_until("garbage", date(2026, 11, 30)) is None
    assert cal.event_payload(None, date(2026, 11, 30))["days_until"] is None


def test_next_earnings_prefers_symbol_query_then_window():
    today = date(2026, 11, 30)

    def sym_fn(sym, s, e):
        return cal.parse_finnhub_earnings({"earningsCalendar": [
            {"date": "2026-12-02", "symbol": sym, "hour": "amc", "epsEstimate": 2.4}]}) if sym == "CRM" else None

    async def window(s, e, today=None):
        return {"rows": [{"symbol": "SNOW", "date": "2026-12-04", "hour": "bmo"}], "sources": {}}

    ev = asyncio.run(cal.next_earnings("crm", today=today, symbol_fn=sym_fn, window_fn=window))
    assert ev["date"] == "2026-12-02" and ev["hour"] == "amc"
    ev = asyncio.run(cal.next_earnings("SNOW", today=today, symbol_fn=sym_fn, window_fn=window))
    assert ev["date"] == "2026-12-04"
    assert asyncio.run(cal.next_earnings("NONE", today=today, symbol_fn=sym_fn, window_fn=window)) is None


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def api_env(monkeypatch):
    from app.api import earnings as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.fundamentals import Fundamentals
    from app.models.portfolio import Portfolio, Position
    from app.models.symbol import Symbol
    from app.models.user import User
    from app.models.watchlist import Watchlist

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, Fundamentals.__table__, Watchlist.__table__,
        Portfolio.__table__, Position.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        Symbol(id=1, symbol="CRM", name="Salesforce", sector="Technology", market_cap=159e9),
        Symbol(id=2, symbol="SNOW", name="Snowflake", sector="Technology"),
        Symbol(id=3, symbol="JPM", name="JPMorgan", sector="Financial Services", market_cap=600e9),
    ])
    s.flush()
    s.add_all([
        Fundamentals(symbol_id=2, market_cap=60e9),
        Watchlist(user_id=1, symbol_id=1),
        Portfolio(id=1, user_id=1, name="P", is_paper_trading=0),
    ])
    s.flush()
    s.add(Position(portfolio_id=1, symbol_id=3, quantity=10, avg_cost_basis=100))
    s.commit()
    s.close()

    async def fake_window(start, end, today=None):
        return {"rows": cal.merge_earnings([], [
            {"symbol": "CRM", "date": "2026-12-02", "hour": "amc", "eps_estimate": 2.4, "source": "nasdaq"},
            {"symbol": "SNOW", "date": "2026-12-02", "hour": "bmo", "source": "nasdaq"},
            {"symbol": "JPM", "date": "2026-12-03", "hour": "bmo", "eps_estimate": 4.0, "eps_actual": 4.4,
             "source": "nasdaq"},
            {"symbol": "TINY", "date": "2026-12-03", "market_cap": 50e6, "source": "nasdaq"},
        ]), "sources": {"finnhub": False, "nasdaq": True}}

    monkeypatch.setattr(api.cal, "fetch_window", fake_window)
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
    c.a = {"Authorization": f"Bearer {create_access_token(1)}"}
    return c


def _syms(r):
    return [row["symbol"] for row in r.json()["rows"]]


def test_calendar_public_and_enriched(api_env):
    r = api_env.get("/api/v1/earnings/calendar?start=2026-11-30&end=2026-12-06")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(_syms(r)) == {"CRM", "SNOW", "JPM", "TINY"}
    by = {row["symbol"]: row for row in body["rows"]}
    assert by["SNOW"]["market_cap"] == 60e9 and by["SNOW"]["cap_tier"] == "large"  # from fundamentals
    assert by["CRM"]["sector"] == "Technology" and by["CRM"]["hour_label"] == "After close"
    assert by["TINY"]["sector"] is None and by["TINY"]["cap_tier"] == "micro"
    assert by["JPM"]["eps_surprise_pct"] == pytest.approx(10.0)
    assert by["CRM"]["eps_actual"] is None  # missing stays null
    assert body["sectors"] == ["Financial Services", "Technology"]
    assert body["watchlist_count"] is None


def test_calendar_filters(api_env):
    base = "/api/v1/earnings/calendar?start=2026-11-30&end=2026-12-06"
    assert _syms(api_env.get(base + "&cap=mega")) == ["JPM"]
    assert set(_syms(api_env.get(base + "&sector=technology"))) == {"CRM", "SNOW"}
    assert api_env.get(base + "&scope=watchlist").status_code == 401
    assert _syms(api_env.get(base + "&scope=watchlist", headers=api_env.a)) == ["CRM"]
    r = api_env.get(base + "&scope=portfolio", headers=api_env.a)
    assert _syms(r) == ["JPM"] and r.json()["rows"][0]["in_portfolio"] is True
    assert r.json()["watchlist_count"] == 1 and r.json()["portfolio_count"] == 1


def test_calendar_validation(api_env):
    assert api_env.get("/api/v1/earnings/calendar?start=nope").status_code == 422
    assert api_env.get("/api/v1/earnings/calendar?start=2026-12-06&end=2026-11-30").status_code == 422
    assert api_env.get("/api/v1/earnings/calendar?start=2026-01-01&end=2026-03-01").status_code == 422
    assert api_env.get("/api/v1/earnings/calendar?cap=giant").status_code == 422


def test_next_endpoint(api_env, monkeypatch):
    from app.api import earnings as api

    async def fake_next(sym, today=None):
        return {"symbol": sym, "date": (today + timedelta(days=3)).isoformat(), "hour": "bmo", "eps_estimate": None}

    monkeypatch.setattr(api.cal, "next_earnings", fake_next)
    body = api_env.get("/api/v1/earnings/next/crm").json()
    assert body["symbol"] == "CRM" and body["days_until"] == 3 and body["hour_label"] == "Before open"
    assert body["eps_estimate"] is None
    assert api_env.get("/api/v1/earnings/next/bad%20sym").status_code == 422


# ── EPS history ──────────────────────────────────────────────────────────────

SURPRISES = [
    {"actual": 1.64, "estimate": 1.6, "period": "2026-09-30", "quarter": 3, "year": 2026, "symbol": "AAPL"},
    {"actual": 1.57, "estimate": 1.43, "period": "2026-06-30", "quarter": 2, "year": 2026, "symbol": "AAPL"},
    {"actual": None, "estimate": 1.7, "period": "2026-12-31", "quarter": 4, "year": 2026},  # not reported
    {"actual": 1.65, "estimate": None, "period": "2026-03-31", "quarter": 1, "year": 2026},
    {"actual": 2.0, "estimate": 2.1, "period": "bad"},
    "junk",
]


def test_parse_finnhub_surprises():
    rows = cal.parse_finnhub_surprises(SURPRISES)
    assert [r["label"] for r in rows] == ["Q1 2026", "Q2 2026", "Q3 2026"]  # oldest first
    assert rows[0]["eps_estimate"] is None and rows[0]["surprise_pct"] is None  # missing stays null
    assert rows[2]["surprise_pct"] == pytest.approx(2.5)
    assert cal.parse_finnhub_surprises({"error": "x"}) == []


def test_fetch_eps_history_fallback_and_cache():
    calls = {"fh": 0, "yf": 0}

    def fh(sym):
        calls["fh"] += 1
        return cal.parse_finnhub_surprises(SURPRISES)  # 3 quarters -> also try yfinance

    def yf(sym):
        calls["yf"] += 1
        return [{"period": f"2025-0{i}-01", "label": "x", "eps_actual": 1.0, "eps_estimate": 1.0,
                 "surprise_pct": 0.0} for i in range(1, 10)]

    out = asyncio.run(cal.fetch_eps_history("aapl", finnhub_fn=fh, yf_fn=yf))
    assert out["available"] and out["source"] == "yfinance" and len(out["quarters"]) == 8
    asyncio.run(cal.fetch_eps_history("AAPL", finnhub_fn=fh, yf_fn=yf))
    assert calls == {"fh": 1, "yf": 1}  # cached

    four = [{"period": f"2026-0{i}-28", "label": f"Q{i} 2026", "eps_actual": 1.0, "eps_estimate": 0.9,
             "surprise_pct": 11.11} for i in range(1, 5)]

    def yf_down(sym):
        raise RuntimeError("yfinance down")

    out = asyncio.run(cal.fetch_eps_history("MSFT", finnhub_fn=lambda s: four, yf_fn=yf_down))
    assert out["available"] and out["source"] == "finnhub" and len(out["quarters"]) == 4
    out = asyncio.run(cal.fetch_eps_history("NVDA", finnhub_fn=lambda s: four, yf_fn=lambda s: four[:2]))
    assert out["source"] == "finnhub"  # fallback used only when it has more quarters

    failed = asyncio.run(cal.fetch_eps_history("FAIL", finnhub_fn=lambda s: None, yf_fn=lambda s: None))
    assert failed == {"symbol": "FAIL", "available": False, "quarters": [], "source": None}


def test_history_endpoint(api_env, monkeypatch):
    from app.api import earnings as api

    async def fake(sym):
        return {"symbol": sym, "available": True, "quarters": cal.parse_finnhub_surprises(SURPRISES), "source": "finnhub"}

    monkeypatch.setattr(api.cal, "fetch_eps_history", fake)
    body = api_env.get("/api/v1/earnings/history/aapl").json()
    assert body["symbol"] == "AAPL" and len(body["quarters"]) == 3 and body["source"] == "finnhub"
    assert api_env.get("/api/v1/earnings/history/bad%20sym").status_code == 422


# ── earnings pre-alerts ──────────────────────────────────────────────────────

@pytest.fixture
def alert_env():
    from app.api import alerts as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.billing import Subscription
    from app.models.community import Notification
    from app.models.price_alert import PriceAlert
    from app.models.symbol import Symbol
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, PriceAlert.__table__, Notification.__table__, Subscription.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([User(id=1, email="a@example.com", username="a", is_verified=True),
               Symbol(id=1, symbol="CRM", name="Salesforce")])
    s.commit()
    s.close()
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    api._load_quotes = lambda db, syms: {}
    c = TestClient(app)
    c.a = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.SL = SL
    return c


def _run_alerts(SL, events, now):
    from app.services.price_alert_service import run_price_alerts

    async def qf(db, syms):
        raise AssertionError("earnings-only runs must not fetch quotes")

    async def ef(syms, today):
        return {s: events[s] for s in syms if s in events}

    db = SL()
    try:
        return asyncio.run(run_price_alerts(db, quote_fetch=qf, earnings_fetch=ef,
                                            send_email=lambda *a: None, now=now))
    finally:
        db.close()


def _titles(SL):
    from app.models.community import Notification
    db = SL()
    try:
        return [n.title for n in db.query(Notification).order_by(Notification.id).all()]
    finally:
        db.close()


def _at(d: str, hour=15):
    return datetime.fromisoformat(d).replace(hour=hour, tzinfo=timezone.utc)


def test_earnings_alert_validation(alert_env):
    post = lambda **b: alert_env.post("/api/v1/alerts", json={"symbol": "CRM", "condition": "earnings_within_days", **b},
                                      headers=alert_env.a)
    assert post(threshold=0).status_code == 422
    assert post(threshold=31).status_code == 422
    assert post(threshold=2.5).status_code == 422
    r = post(threshold=3, repeat=True)
    assert r.status_code == 201 and r.json()["metric"] == "earnings"
    assert r.json()["condition_label"].startswith("Earnings")


def test_earnings_alert_fires_once_per_event(alert_env):
    alert_env.post("/api/v1/alerts", json={"symbol": "CRM", "condition": "earnings_within_days",
                                           "threshold": 3, "repeat": True}, headers=alert_env.a)
    ev = {"CRM": {"symbol": "CRM", "date": "2026-12-02", "hour": "amc", "eps_estimate": 2.41}}

    # 6 days out: not yet
    assert _run_alerts(alert_env.SL, ev, _at("2026-11-26"))["triggered"] == 0
    # 3 days out: fires
    assert _run_alerts(alert_env.SL, ev, _at("2026-11-29"))["triggered"] == 1
    # later runs for the same report never fire again
    for d in ("2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"):
        assert _run_alerts(alert_env.SL, ev, _at(d))["triggered"] == 0
    titles = _titles(alert_env.SL)
    assert titles == ["CRM reports earnings in 3 days"]

    # same report rescheduled two days later: still one notification
    moved = {"CRM": {**ev["CRM"], "date": "2026-12-04"}}
    assert _run_alerts(alert_env.SL, moved, _at("2026-12-02"))["triggered"] == 0
    assert _run_alerts(alert_env.SL, moved, _at("2026-12-03"))["triggered"] == 0

    # next quarter's report fires again (repeat=True keeps the alert active)
    nxt = {"CRM": {"symbol": "CRM", "date": "2027-03-01", "hour": None, "eps_estimate": None}}
    assert _run_alerts(alert_env.SL, nxt, _at("2027-02-28"))["triggered"] == 1
    assert _titles(alert_env.SL)[-1] == "CRM reports earnings tomorrow"
    got = alert_env.get("/api/v1/alerts", headers=alert_env.a).json()["alerts"][0]
    assert got["status"] == "active" and got["trigger_count"] == 2 and got["last_event_key"] == "2027-03-01"


def test_one_shot_earnings_alert_and_no_data(alert_env):
    alert_env.post("/api/v1/alerts", json={"symbol": "CRM", "condition": "earnings_within_days", "threshold": 5},
                   headers=alert_env.a)
    stats = _run_alerts(alert_env.SL, {}, _at("2026-11-29"))
    assert stats["no_data"] == 1 and stats["triggered"] == 0
    # a past report (negative days) never matches
    past = {"CRM": {"symbol": "CRM", "date": "2026-11-20"}}
    assert _run_alerts(alert_env.SL, past, _at("2026-11-29"))["triggered"] == 0
    ev = {"CRM": {"symbol": "CRM", "date": "2026-11-29", "hour": "bmo", "eps_estimate": 1.0}}
    assert _run_alerts(alert_env.SL, ev, _at("2026-11-29"))["triggered"] == 1
    assert _titles(alert_env.SL) == ["CRM reports earnings today"]
    got = alert_env.get("/api/v1/alerts", headers=alert_env.a).json()["alerts"][0]
    assert got["status"] == "triggered"
    assert _run_alerts(alert_env.SL, ev, _at("2026-11-29"))["checked"] == 0


def test_ensure_price_alert_columns_is_idempotent():
    from sqlalchemy import inspect, text

    from app.models.price_alert import ensure_price_alert_columns

    eng = create_engine("sqlite://", poolclass=StaticPool)
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE price_alerts (id INTEGER PRIMARY KEY, symbol VARCHAR(12))"))
    ensure_price_alert_columns(eng)
    ensure_price_alert_columns(eng)
    assert "last_event_key" in {c["name"] for c in inspect(eng).get_columns("price_alerts")}
    ensure_price_alert_columns(create_engine("sqlite://"))  # no table: no-op
