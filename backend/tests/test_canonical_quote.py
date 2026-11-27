"""One canonical quote for every surface.

Prod, 2026-11-26 21:45 ET (Thanksgiving, NYSE closed; last close Nov 25):

    AMD  copilot 423.01 (+2.36% vs 413.27)   tape/research 406.03 (-1.75%)
    AAPL copilot 358.00 (+1.11%)             tape/research 355.58 (+0.43%)

Raw Public.com quote for AMD at that time (read-only prod diagnostic):

    last 424.00  last_timestamp 2026-11-27 02:47:50Z  previous_close 413.27
    one_day_change {change: -7.24, percent_change: -1.75}

`last` is an overnight-venue trade; previous_close + one_day_change
(413.27 - 7.24 = 406.03) is the Nov 25 regular close. The copilot showed the
overnight print as the headline price. The contract now: headline = regular
session, the overnight print in `extended`, every surface reads the same
quote_snapshots row.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import canonical_quote as cq
from app.services import public_client as pc
from app.services.copilot import sources as src
from app.services.quote_cache import QuoteCacheService

UTC = timezone.utc
THANKSGIVING_NIGHT = datetime(2026, 11, 27, 2, 48, tzinfo=UTC)     # Thu 21:48 ET
BLACK_FRIDAY_NOON = datetime(2026, 11, 27, 17, 0, tzinfo=UTC)      # Fri 12:00 ET (early close 13:00)

AMD_RAW = {  # SDK Quote.__dict__ (snake_case), as seen in prod
    "instrument": {"symbol": "AMD", "type": "EQUITY"}, "outcome": "SUCCESS",
    "last": "424.00", "last_timestamp": datetime(2026, 11, 27, 2, 47, 50, tzinfo=UTC),
    "bid": "424.00", "ask": "424.50", "volume": 78535, "previous_close": "413.27",
    "one_day_change": {"change": "-7.24", "percent_change": "-1.75"},
}


def _bars(rows):
    idx = pd.to_datetime([d for d, _ in rows])
    return pd.DataFrame({"Close": [c for _, c in rows]}, index=idx)


def _public_amd(bars=True):
    """Public.com parse + #118's reference-close rebase, as get_quotes runs it."""
    q = pc._parse_quote(AMD_RAW)
    pc._prev_close_cache.clear()
    pc._prior_close_cache.clear()
    frame = _bars([("2026-11-21", 401.10), ("2026-11-24", 413.27), ("2026-11-25", 406.03)])
    results = {"AMD": q}
    if bars:
        with patch("yfinance.download", return_value=frame):
            asyncio.run(pc.PublicClient()._fill_previous_closes(results))
    else:
        with patch("yfinance.download", return_value=pd.DataFrame()):
            asyncio.run(pc.PublicClient()._fill_previous_closes(results))
    pc._prev_close_cache.clear()
    pc._prior_close_cache.clear()
    return results["AMD"]


# ── public.com overnight payload -> regular close + separate extended ───────

@pytest.mark.parametrize("bars", [True, False], ids=["bars", "public-baseline-only"])
def test_public_overnight_print_normalises_to_regular_close(bars):
    c = cq.canonicalize(_public_amd(bars), now=THANKSGIVING_NIGHT)
    assert c["price"] == 406.03 and c["previous_close"] == 413.27
    assert c["change"] == pytest.approx(-7.24, abs=0.005)
    assert c["change_percent"] == pytest.approx(-1.7519, abs=1e-3)
    reg = c["regular"]
    assert reg["session_date"] == "2026-11-25" and reg["previous_session_date"] == "2026-11-24"
    assert reg["close_time"] == "2026-11-25T21:00:00+00:00" and reg["live"] is False
    ext = c["extended"]
    assert ext["session"] == "overnight" and ext["price"] == 424.0
    assert ext["time"] == "2026-11-27T02:47:50+00:00"
    assert ext["change_percent"] == pytest.approx((424 - 406.03) / 406.03 * 100, abs=1e-3)
    # as_of is the regular close, never the fetch time or the overnight print
    assert c["as_of"] == c["market_time"] == "2026-11-25T21:00:00+00:00"
    assert c["session"] == "regular" and c["stale"] is False and c["needs_regular"] is False
    assert cq.extended_label(ext) == "Overnight 424.00 +4.43%"


def test_canonicalize_is_idempotent():
    c = cq.canonicalize(_public_amd(), now=THANKSGIVING_NIGHT)
    assert cq.canonicalize(c, now=THANKSGIVING_NIGHT) is c


def test_public_without_any_baseline_needs_a_regular_provider():
    raw = {**AMD_RAW, "previous_close": None, "one_day_change": None}
    q = pc._parse_quote(raw)
    q.update(session="overnight", reference_close_date="2026-11-25")
    c = cq.canonicalize(q, now=THANKSGIVING_NIGHT)
    assert c["needs_regular"] is True and c["price"] is None


def test_regular_session_public_print_is_the_headline():
    q = {"symbol": "AMD", "price": 410.0, "previous_close": 406.03, "session": "regular",
         "market_time": "2026-11-27T16:55:00+00:00", "data_source": "public.com"}
    c = cq.canonicalize(q, now=BLACK_FRIDAY_NOON)
    assert c["price"] == 410.0 and c["extended"] is None
    assert c["regular"]["live"] is True and c["regular"]["close_time"] is None
    assert c["regular"]["previous_session_date"] == "2026-11-25"   # skips Thanksgiving
    assert c["as_of"] == "2026-11-27T16:55:00+00:00"


# ── holiday previous close (NYSE calendar) ──────────────────────────────────

def _yahoo_chart(rmt: datetime, price: float, bars):
    stamps = [int(datetime(*map(int, d.split("-")), 14, 30, tzinfo=UTC).timestamp()) for d, _ in bars]
    return {"meta": {"regularMarketPrice": price, "regularMarketTime": int(rmt.timestamp()),
                     "chartPreviousClose": 390.0},
            "timestamp": stamps,
            "indicators": {"quote": [{"close": [c for _, c in bars], "open": [c for _, c in bars],
                                      "high": [c for _, c in bars], "low": [c for _, c in bars]}]}}


def test_holiday_previous_close_skips_thanksgiving():
    # Black Friday intraday: the previous regular close is Wed Nov 25, not Thu Nov 26.
    chart = _yahoo_chart(BLACK_FRIDAY_NOON, 410.0,
                         [("2026-11-24", 413.27), ("2026-11-25", 406.03), ("2026-11-27", 410.0)])
    assert QueueYahoo.prev(chart) == 406.03
    c = cq.canonicalize({"symbol": "AMD", "price": 410.0, "previous_close": 406.03,
                         "data_source": "yahoo_direct", "market_time": BLACK_FRIDAY_NOON.isoformat()},
                        now=BLACK_FRIDAY_NOON)
    assert c["regular"]["session_date"] == "2026-11-27"
    assert c["regular"]["previous_session_date"] == "2026-11-25"


def test_thanksgiving_night_yahoo_baseline_is_nov_24():
    rmt = datetime(2026, 11, 25, 21, 0, tzinfo=UTC)
    chart = _yahoo_chart(rmt, 406.03, [("2026-11-21", 401.10), ("2026-11-24", 413.27), ("2026-11-25", 406.03)])
    assert QueueYahoo.prev(chart) == 413.27
    c = cq.canonicalize({"symbol": "AMD", "price": 406.03, "previous_close": 413.27,
                         "data_source": "yahoo_direct", "market_time": rmt.isoformat()}, now=THANKSGIVING_NIGHT)
    assert c["regular"]["session_date"] == "2026-11-25" and c["stale"] is False


def test_day_old_quote_is_stale():
    c = cq.canonicalize({"symbol": "AAPL", "price": 354.07, "previous_close": 349.08,
                         "data_source": "database", "market_time": "2026-11-24T21:00:00+00:00"},
                        now=THANKSGIVING_NIGHT)
    assert c["stale"] is True


class QueueYahoo:
    @staticmethod
    def prev(chart):
        return QuoteCacheService._yahoo_prev_close_by_calendar(chart, chart["meta"])


# ── QuoteCacheService: Public extended + Yahoo regular ─────────────────────

def test_cache_service_takes_regular_from_yahoo_when_public_cannot(monkeypatch):
    public = pc._parse_quote({**AMD_RAW, "previous_close": None, "one_day_change": None})
    public.update(session="overnight", reference_close_date="2026-11-25")
    yahoo = {"symbol": "AMD", "price": 406.03, "previous_close": 413.27, "data_source": "yahoo_direct",
             "market_time": "2026-11-25T21:00:00+00:00", "high": 415.0, "low": 404.0}

    async def fake_public(self, s):
        return dict(public)

    async def fake_yahoo(self, s):
        return dict(yahoo)

    monkeypatch.setattr(QuoteCacheService, "_fetch_from_public", fake_public)
    monkeypatch.setattr(QuoteCacheService, "_fetch_from_yahoo_direct", fake_yahoo)
    monkeypatch.setattr(cq, "_now", lambda: THANKSGIVING_NIGHT)
    q = asyncio.run(QuoteCacheService(None)._fetch_quote("AMD"))
    assert q["price"] == 406.03 and q["change_percent"] == pytest.approx(-1.7519, abs=1e-3)
    assert q["extended"]["price"] == 424.0 and q["extended"]["session"] == "overnight"
    assert "public.com" in q["source"]


def test_legacy_cache_rows_are_a_miss():
    """A pre-contract row (overnight print as `price`) must not be served."""
    engine, db = _db()
    from app.models.quote_snapshot import QuoteSnapshot
    db.add(QuoteSnapshot(symbol="AMD", payload={"symbol": "AMD", "price": 423.01, "previous_close": 413.27,
                                                "data_source": "public.com",
                                                "market_time": "2026-11-27T02:45:00+00:00"},
                         ttl_seconds=600, fetched_at=datetime.now(UTC)))
    db.add(QuoteSnapshot(symbol="AAPL", payload={"symbol": "AAPL", "price": 355.58, "previous_close": 354.07,
                                                 "data_source": "yahoo_direct",
                                                 "market_time": "2026-11-25T21:00:00+00:00"},
                         ttl_seconds=600, fetched_at=datetime.now(UTC)))
    db.commit()
    got = QuoteCacheService(db)._get_cached_quotes_bulk(["AMD", "AAPL"])
    assert got["AMD"] is None                                   # overnight print as price: re-fetch
    assert got["AAPL"]["price"] == 355.58 and got["AAPL"]["quote_version"] == cq.QUOTE_VERSION
    db.close()


# ── every surface agrees on one fixture ─────────────────────────────────────

def _db():
    from app.db.database import Base
    from app.models.price import PriceBar
    from app.models.quote_snapshot import QuoteSnapshot
    from app.models.symbol import Symbol
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[Symbol.__table__, PriceBar.__table__, QuoteSnapshot.__table__])
    return engine, sessionmaker(bind=engine)()


def test_all_surfaces_agree(monkeypatch):
    from app.api import enhanced_endpoints, quotes
    from app.db.database import get_db
    from app.models.price import PriceBar
    from app.models.symbol import Symbol
    from app.services.portfolio_pricing import fetch_quotes

    canonical = cq.canonicalize(_public_amd(), now=THANKSGIVING_NIGHT)
    calls = []

    async def fake_fetch(self, symbol):
        calls.append(symbol)
        return dict(canonical)

    monkeypatch.setattr(QuoteCacheService, "_fetch_quote", fake_fetch)
    engine, db = _db()
    s = Symbol(symbol="AMD", name="Advanced Micro Devices")
    db.add(s)
    db.commit()
    # a day-old DB bar that the old endpoint served as the quote
    db.add(PriceBar(symbol_id=s.id, timestamp=datetime(2026, 11, 24, 5, tzinfo=UTC),
                    open=400.0, high=414.0, low=399.0, close=413.27, volume=1))
    db.commit()

    app = FastAPI()
    app.include_router(enhanced_endpoints.router, prefix="/api/v1/enhanced")
    app.include_router(quotes.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    header = client.get("/api/v1/enhanced/quote/AMD").json()           # research header / compare / watchlist
    legacy = client.get("/api/v1/enhanced/quote/AMD/finnhub").json()   # home page cards
    batch = client.get("/api/v1/quotes", params={"symbols": "AMD"}).json()["quotes"]["AMD"]
    portfolio = asyncio.run(fetch_quotes(db, ["AMD"]))["AMD"]
    fact = src.quote_fact("AMD", asyncio.run(QuoteCacheService(db).get_quote("AMD")), now=THANKSGIVING_NIGHT)

    prices = {"header": header["last_price"], "finnhub-route": legacy["last_price"],
              "batch": batch["price"], "portfolio": portfolio["price"], "copilot": fact.price}
    pcts = {"header": header["change_percent"], "finnhub-route": legacy["change_percent"],
            "batch": batch["change_percent"], "portfolio": portfolio["change_percent"],
            "copilot": fact.change_percent}
    assert set(prices.values()) == {406.03}, prices
    assert all(v == pytest.approx(-1.7519, abs=1e-3) for v in pcts.values()), pcts
    for body in (header, legacy, batch):
        assert body["extended"]["price"] == 424.0 and body["extended"]["session"] == "overnight"
        assert body["as_of"] == "2026-11-25T21:00:00+00:00"
    assert header["stale"] is False and header["data_source"] == "public.com"
    assert calls == ["AMD"]          # one provider fetch, then the shared cache row
    db.close()


# ── copilot QuoteFact uses the regular price ────────────────────────────────

def test_copilot_quote_fact_uses_regular_price_and_reports_extended_separately():
    c = cq.canonicalize(_public_amd(), now=THANKSGIVING_NIGHT)
    f = src.quote_fact("AMD", c, now=THANKSGIVING_NIGHT)
    assert f.price == 406.03 and f.previous_close == 413.27
    assert f.change_percent == pytest.approx(-1.7519, abs=1e-3)
    assert f.market_session == "regular" and f.session_date == "2026-11-25"
    assert f.previous_close_date == "2026-11-24"
    assert f.quote_time == f.as_of == "2026-11-25T21:00:00+00:00"
    assert f.stale is False and f.market_now == "closed (Thanksgiving Day)"
    assert f.extended_price == 424.0 and f.extended_session == "overnight"
    assert "regular-session close of 2026-11-25" in f.freshness_note
    assert "Overnight 424.00 +4.43%" in f.freshness_note and "never as the price" in f.freshness_note
    snip = f.ui()["snippet"]
    assert snip.startswith("$406.03 (-1.75%)") and "Overnight 424.00 +4.43%" in snip


def test_copilot_live_regular_quote_staleness():
    q = cq.canonicalize({"symbol": "AMD", "price": 410.0, "previous_close": 406.03, "session": "regular",
                         "market_time": "2026-11-27T16:30:00+00:00", "data_source": "public.com"},
                        now=BLACK_FRIDAY_NOON)
    f = src.quote_fact("AMD", q, now=BLACK_FRIDAY_NOON)
    assert f.market_now == "regular" and f.age_minutes == 30.0
    assert f.stale is True and "STALE" in f.freshness_note    # 30 min > 15 min limit
    assert "live regular-session price" in f.freshness_note
