"""Dividend calendar parsing, frequency inference, income projection math, and API."""
import asyncio
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import dividend_calendar as dc


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.services.redis_cache_service import cache_service
    cache_service._fallback.clear_prefix("qt:div")
    yield
    cache_service._fallback.clear_prefix("qt:div")


NASDAQ = {"data": {"calendar": {"rows": [
    {"companyName": "Coca-Cola Company (The)", "symbol": "KO", "dividend_Ex_Date": "11/30/2026",
     "payment_Date": "12/14/2026", "record_Date": "11/30/2026", "dividend_Rate": 0.53,
     "indicated_Annual_Dividend": 2.12, "announcement_Date": "10/16/2026"},
    {"companyName": "Realty Income", "symbol": "O", "dividend_Ex_Date": "11/30/2026",
     "payment_Date": "12/15/2026", "record_Date": "11/30/2026", "dividend_Rate": 0.272,
     "indicated_Annual_Dividend": 3.264, "announcement_Date": "11/10/2026"},
    {"companyName": "Special Co", "symbol": "SPC", "dividend_Ex_Date": "11/30/2026",
     "payment_Date": "N/A", "record_Date": "", "dividend_Rate": 3.5,
     "indicated_Annual_Dividend": 0.0, "announcement_Date": "10/23/2026"},
    {"symbol": "", "dividend_Ex_Date": "11/30/2026"},
    {"symbol": "BAD", "dividend_Ex_Date": "N/A"},
]}}}


# ── parsing / frequency ──────────────────────────────────────────────────────

def test_parse_nasdaq_dividends():
    rows = dc.parse_nasdaq_dividends(NASDAQ)
    by = {r["symbol"]: r for r in rows}
    assert set(by) == {"KO", "O", "SPC"}
    assert by["KO"]["ex_date"] == "2026-11-30" and by["KO"]["pay_date"] == "2026-12-14"
    assert by["KO"]["frequency"] == 4 and by["KO"]["frequency_label"] == "Quarterly"
    assert by["O"]["frequency"] == 12
    # unknown annual (Nasdaq 0) and missing dates stay None, never 0
    assert by["SPC"]["annual_dividend"] is None and by["SPC"]["pay_date"] is None
    assert by["SPC"]["record_date"] is None and by["SPC"]["frequency"] is None
    assert dc.parse_nasdaq_dividends({}) == []


def test_frequency_inference():
    assert dc.frequency_from_ratio(0.53, 2.12) == 4
    assert dc.frequency_from_ratio(0.272, 3.264) == 12
    assert dc.frequency_from_ratio(1.0, 2.0) == 2
    assert dc.frequency_from_ratio(1.0, 1.0) == 1
    assert dc.frequency_from_ratio(1.0, 7.0) is None
    assert dc.frequency_from_ratio(0.05395, 2.88392) == 52  # weekly income ETF
    assert dc.frequency_from_ratio(0.1286, 3.3436) == 26
    assert dc.frequency_from_ratio(0.0658, 16.3842) is None  # 249x: inconsistent upstream row
    assert dc.frequency_from_ratio(None, 2.0) is None
    d = date(2026, 1, 15)
    assert dc.frequency_from_dates([d + timedelta(days=30 * i) for i in range(6)]) == 12
    assert dc.frequency_from_dates([d + timedelta(days=91 * i) for i in range(5)]) == 4
    assert dc.frequency_from_dates([d + timedelta(days=182 * i) for i in range(3)]) == 2
    assert dc.frequency_from_dates([d + timedelta(days=365 * i) for i in range(3)]) == 1
    assert dc.frequency_from_dates([d]) is None
    assert dc.frequency_from_dates([d, d + timedelta(days=55)]) is None  # irregular


def test_regular_amount_skips_special():
    assert dc.regular_amount([0.51, 0.51, 0.53, 0.53]) == 0.53
    assert dc.regular_amount([0.5, 0.5, 0.5, 0.5, 3.0]) == 0.5  # special one-off
    assert dc.regular_amount([0.5]) == 0.5
    assert dc.regular_amount([]) is None


# ── projection math ──────────────────────────────────────────────────────────

def _quarterly(last: date, amount=0.53, n=8, gap=91):
    return [((last - timedelta(days=gap * i)).isoformat(), amount) for i in reversed(range(n))]


def test_quarterly_projection_math():
    today = date(2026, 11, 26)
    hist = {"dividends": _quarterly(date(2026, 9, 15)), "next_ex_date": "2026-11-30", "next_pay_date": "2026-12-14"}
    out = dc.project_income({"KO": 100}, {"KO": hist}, today)
    months = [m["month"] for m in out["months"]]
    assert months[0] == "2026-11" and months[-1] == "2027-10" and len(months) == 12
    pays = [(p["ex_date"], p["pay_date"], p["income"], p["estimated"]) for m in out["months"] for p in m["payments"]]
    # announced payment uses the announced pay date and is not estimated
    assert pays[0] == ("2026-11-30", "2026-12-14", 53.0, False)
    # then three more quarterly payments within the 12-month window, estimated with the announced 14-day lag
    assert len(pays) == 4
    assert all(p[3] for p in pays[1:])
    assert pays[1][1] == (date(2026, 11, 30) + timedelta(days=91) + timedelta(days=14)).isoformat()
    assert out["total_12m"] == pytest.approx(4 * 53.0)
    h = out["holdings"][0]
    assert h["frequency_label"] == "Quarterly" and h["annual_per_share"] == pytest.approx(2.12)
    assert h["next_ex_date"] == "2026-11-30" and h["status"] == "projected"
    assert sum(m["total"] for m in out["months"]) == pytest.approx(out["total_12m"])


def test_monthly_projection_and_last_ex_still_paying():
    today = date(2026, 11, 5)
    # last ex-date Oct 30 (before today); its estimated pay date (+21d) is Nov 20, still ahead -> counted
    hist = {"dividends": [((date(2026, 10, 30) - timedelta(days=30 * i)).isoformat(), 0.272) for i in reversed(range(8))],
            "next_ex_date": None, "next_pay_date": None}
    out = dc.project_income({"O": 10}, {"O": hist}, today)
    pays = [p for m in out["months"] for p in m["payments"]]
    assert pays[0]["ex_date"] == "2026-10-30" and pays[0]["pay_date"] == "2026-11-20"
    assert all(p["pay_date"][:7] in {m["month"] for m in out["months"]} for p in pays)
    assert 11 <= len(pays) <= 12
    assert all(p["income"] == pytest.approx(2.72) for p in pays)
    assert out["total_12m"] == pytest.approx(2.72 * len(pays))


def test_non_payers_suspended_irregular_unavailable():
    today = date(2026, 11, 26)
    hist = {
        "NVDA0": {"dividends": []},
        "OLD": {"dividends": _quarterly(date(2025, 6, 1))},  # nothing for ~18 months
        "ODD": {"dividends": [("2026-01-10", 1.0), ("2026-03-05", 2.0)]},
        "NONE": None,
    }
    out = dc.project_income({"NVDA0": 5, "OLD": 5, "ODD": 5, "NONE": 5, "ZERO": 0}, hist, today)
    st = {h["symbol"]: h["status"] for h in out["holdings"]}
    assert st == {"NONE": "unavailable", "NVDA0": "no_dividend", "ODD": "irregular", "OLD": "suspended"}
    assert out["total_12m"] is None  # nothing projectable: "—", not $0
    assert all(h["projected_income"] is None for h in out["holdings"])
    assert all(m["total"] == 0 for m in out["months"])


def test_special_dividend_not_projected_forward():
    today = date(2026, 11, 26)
    divs = _quarterly(date(2026, 8, 15), amount=0.5, n=4) + [("2026-11-10", 3.0)]
    out = dc.project_income({"X": 10}, {"X": {"dividends": divs}}, today)
    # the 3.00 special does not set the forward amount
    assert out["holdings"][0]["amount_per_share"] == 0.5


# ── fetch + cache ────────────────────────────────────────────────────────────

def test_fetch_window_caches_days():
    calls = []

    async def nq(days):
        calls.append(list(days))
        return {d: dc.parse_nasdaq_dividends(NASDAQ) if d == "2026-11-30" else [] for d in days}

    out = asyncio.run(dc.fetch_window(date(2026, 11, 30), date(2026, 12, 6), today=date(2026, 11, 26), nasdaq_fn=nq))
    assert out["source_ok"] and {r["symbol"] for r in out["rows"]} == {"KO", "O", "SPC"}
    asyncio.run(dc.fetch_window(date(2026, 11, 30), date(2026, 12, 6), today=date(2026, 11, 26), nasdaq_fn=nq))
    assert len(calls) == 1
    with pytest.raises(ValueError):
        asyncio.run(dc.fetch_window(date(2026, 1, 1), date(2026, 3, 1)))


def test_fetch_histories_caches_success_not_failure():
    seen = []

    def hf(sym):
        seen.append(sym)
        return None if sym == "FAIL" else {"dividends": [("2026-09-15", 0.5)]}

    out = asyncio.run(dc.fetch_histories(["ko", "FAIL"], history_fn=hf))
    assert out["KO"]["dividends"] and out["FAIL"] is None
    asyncio.run(dc.fetch_histories(["KO", "FAIL"], history_fn=hf))
    assert seen.count("KO") == 1 and seen.count("FAIL") == 2


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def api_env(monkeypatch):
    from datetime import datetime, timezone

    from app.api import dividends as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.fundamentals import Fundamentals
    from app.models.portfolio import Portfolio, Position
    from app.models.price import PriceBar
    from app.models.symbol import Symbol
    from app.models.user import User
    from app.models.watchlist import Watchlist

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, Fundamentals.__table__, Watchlist.__table__,
        Portfolio.__table__, Position.__table__, PriceBar.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        User(id=2, email="b@example.com", username="b", is_verified=True),
        Symbol(id=1, symbol="KO", name="Coca-Cola"),
        Symbol(id=2, symbol="O", name="Realty Income"),
        Symbol(id=3, symbol="NVDA", name="NVIDIA"),
    ])
    s.flush()
    s.add_all([
        Fundamentals(symbol_id=1, price=70.0),
        PriceBar(symbol_id=2, timestamp=datetime(2026, 11, 20, tzinfo=timezone.utc), open=1, high=1, low=1, close=60.0, volume=1),
        PriceBar(symbol_id=2, timestamp=datetime(2026, 11, 25, tzinfo=timezone.utc), open=1, high=1, low=1, close=65.28, volume=1),
        Watchlist(user_id=1, symbol_id=2),
        Portfolio(id=1, user_id=1, name="Tracked", is_paper_trading=0),
        Portfolio(id=2, user_id=1, name="Paper", is_paper_trading=1),
        Portfolio(id=3, user_id=2, name="Other", is_paper_trading=0),
    ])
    s.flush()
    s.add_all([
        Position(portfolio_id=1, symbol_id=1, quantity=100, avg_cost_basis=50),
        Position(portfolio_id=1, symbol_id=3, quantity=10, avg_cost_basis=100),
        Position(portfolio_id=2, symbol_id=2, quantity=1000, avg_cost_basis=50),  # paper: excluded by default
    ])
    s.commit()
    s.close()

    async def fake_window(start, end, today=None):
        return {"rows": dc.parse_nasdaq_dividends(NASDAQ), "source_ok": True}

    async def fake_hist(symbols):
        h = {"KO": {"dividends": _quarterly(date(2026, 9, 15)), "next_ex_date": None, "next_pay_date": None},
             "NVDA": {"dividends": []},
             "O": {"dividends": [((date(2026, 10, 30) - timedelta(days=30 * i)).isoformat(), 0.272) for i in reversed(range(8))]}}
        return {s: h.get(s) for s in symbols}

    monkeypatch.setattr(api.dc, "fetch_window", fake_window)
    monkeypatch.setattr(api.dc, "fetch_histories", fake_hist)

    async def fake_closes(symbols, **kw):
        return {s: (40.0 if s == "SPC" else None) for s in symbols}

    monkeypatch.setattr(api.dc, "fetch_last_closes", fake_closes)
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


def test_calendar_yield_and_scope(api_env):
    r = api_env.get("/api/v1/dividends/calendar?start=2026-11-30&end=2026-12-06")
    assert r.status_code == 200, r.text
    by = {x["symbol"]: x for x in r.json()["rows"]}
    assert by["KO"]["yield_pct"] == pytest.approx(3.03, abs=0.01)  # 2.12 / 70 (fundamentals price)
    assert by["O"]["price"] == 65.28 and by["O"]["yield_pct"] == pytest.approx(5.0)  # latest bar
    assert by["KO"]["price_source"] == "db" and by["O"]["price_source"] == "db"
    # Untracked symbol priced from the latest close; no indicated annual -> yield still "—".
    assert by["SPC"]["price"] == 40.0 and by["SPC"]["price_source"] == "last_close"
    assert by["SPC"]["yield_pct"] is None
    assert api_env.get("/api/v1/dividends/calendar?scope=watchlist").status_code == 401
    w = api_env.get("/api/v1/dividends/calendar?scope=watchlist", headers=api_env.a).json()
    assert [x["symbol"] for x in w["rows"]] == ["O"]
    p = api_env.get("/api/v1/dividends/calendar?scope=portfolio", headers=api_env.a).json()
    assert [x["symbol"] for x in p["rows"]] == ["KO", "O"]  # paper holdings count as "my portfolio" here
    assert api_env.get("/api/v1/dividends/calendar?start=bad").status_code == 422


def test_income_tracked_portfolios_only(api_env):
    assert api_env.get("/api/v1/dividends/income").status_code == 401
    body = api_env.get("/api/v1/dividends/income", headers=api_env.a).json()
    syms = {h["symbol"]: h for h in body["holdings"]}
    assert set(syms) == {"KO", "NVDA"}  # paper O excluded
    assert syms["NVDA"]["status"] == "no_dividend" and syms["NVDA"]["projected_income"] is None
    assert syms["KO"]["yield_pct"] == pytest.approx(3.03, abs=0.01)
    assert body["total_12m"] == pytest.approx(syms["KO"]["projected_income"])
    assert body["portfolio_yield_pct"] is None  # NVDA has no price: don't show a partial yield
    assert body["has_tracked_portfolio"] is True and len(body["months"]) == 12
    assert {p["kind"] for p in body["portfolios"]} == {"tracked", "paper"}


def test_income_single_portfolio_and_ownership(api_env):
    body = api_env.get("/api/v1/dividends/income?portfolio_id=2", headers=api_env.a).json()
    assert [h["symbol"] for h in body["holdings"]] == ["O"]
    assert body["portfolio_yield_pct"] is not None
    assert api_env.get("/api/v1/dividends/income?portfolio_id=3", headers=api_env.a).status_code == 404


def test_fetch_last_closes_cache_and_budget():
    import time as _t

    calls = []

    def fn(symbols):
        calls.append(list(symbols))
        return {s: (12.5 if s == "AAA" else None) for s in symbols}

    out = asyncio.run(dc.fetch_last_closes(["aaa", "BBB"], close_fn=fn))
    assert out == {"AAA": 12.5, "BBB": None}
    out2 = asyncio.run(dc.fetch_last_closes(["AAA", "BBB"], close_fn=fn))
    assert out2 == out and len(calls) == 1  # hit and miss both cached

    def slow(symbols):
        _t.sleep(0.3)
        return {s: 9.0 for s in symbols}

    assert asyncio.run(dc.fetch_last_closes(["CCC"], close_fn=slow, budget_s=0.05)) == {"CCC": None}


def test_yield_suppressed_when_annual_inconsistent_with_payment():
    from app.api import dividends as api

    rows = [
        {"symbol": "BAD", "amount": 0.0658, "annual_dividend": 16.3842, "frequency": None, "name": "x"},
        {"symbol": "SPECIAL", "amount": 30.0, "annual_dividend": 5.88, "frequency": None, "name": "y"},
        {"symbol": "OK", "amount": 0.5, "annual_dividend": 2.0, "frequency": 4, "name": "z"},
    ]
    meta = {s: {"name": None, "sector": None, "price": 100.0} for s in ("BAD", "SPECIAL", "OK")}
    out = api._enrich_calendar(None, rows, None, "all", meta)
    by = {r["symbol"]: r for r in out["rows"]}
    assert by["BAD"]["yield_pct"] is None
    assert by["SPECIAL"]["yield_pct"] == pytest.approx(5.88)
    assert by["OK"]["yield_pct"] == pytest.approx(2.0)
