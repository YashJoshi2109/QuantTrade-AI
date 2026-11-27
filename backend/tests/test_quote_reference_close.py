"""Quote baselines and staleness, pinned to prod observations of 2026-11-26
(Thanksgiving, NYSE closed) checked against yfinance daily closes:

    AAPL  Nov 24 close 354.07   Nov 25 close 355.58
    MSFT  Nov 24 close 496.13   Nov 25 close 489.93

* /api/v1/quotes served Public.com's overnight print AAPL 357.75 at
  2026-11-27T02:21Z with previous_close 354.07 (Nov 24): +3.68 / +1.04%.
  The close before that print is Nov 25's 355.58: +2.17 / +0.61%.
* /api/v1/enhanced/quote served the newest DB bar unconditionally:
  AAPL 354.07 (+1.43%) and MSFT 496.13, both the Nov 24 bar.
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

from app.api.enhanced_endpoints import db_bar_is_current
from app.services import market_calendar as mc
from app.services import public_client as pc

UTC = timezone.utc


@pytest.mark.parametrize("at,expected", [
    (datetime(2026, 11, 27, 2, 21, tzinfo=UTC), date(2026, 11, 25)),   # Thanksgiving 21:21 ET
    (datetime(2026, 11, 26, 15, 10, tzinfo=UTC), date(2026, 11, 25)),  # Thanksgiving 10:10 ET
    (datetime(2026, 11, 25, 23, 0, tzinfo=UTC), date(2026, 11, 25)),   # Wed 18:00 ET after-hours
    (datetime(2026, 11, 25, 17, 0, tzinfo=UTC), date(2026, 11, 24)),   # Wed 12:00 ET regular
    (datetime(2026, 11, 25, 13, 0, tzinfo=UTC), date(2026, 11, 24)),   # Wed 08:00 ET pre-market
    (datetime(2026, 11, 27, 18, 30, tzinfo=UTC), date(2026, 11, 27)),  # Black Friday 13:30 ET (early close)
    (datetime(2026, 11, 29, 15, 0, tzinfo=UTC), date(2026, 11, 27)),   # Sunday
])
def test_last_completed_session(at, expected):
    assert mc.last_completed_session(at) == expected


def test_print_session_labels_closed_window_prints_overnight():
    assert mc.print_session(datetime(2026, 11, 27, 2, 21, tzinfo=UTC)) == "overnight"
    assert mc.print_session(datetime(2026, 11, 25, 23, 0, tzinfo=UTC)) == "after-hours"
    assert mc.print_session(datetime(2026, 11, 25, 17, 0, tzinfo=UTC)) == "regular"


@pytest.mark.parametrize("printed,ref,session", [
    ("2026-11-27T02:21:16+00:00", date(2026, 11, 25), "overnight"),    # Thanksgiving evening
    ("2026-11-25T21:00:01+00:00", date(2026, 11, 24), "regular"),      # Nov 25 closing print
    ("2026-11-25T22:30:00+00:00", date(2026, 11, 25), "after-hours"),  # vs that day's close
    ("2026-11-25T17:00:00+00:00", date(2026, 11, 24), "regular"),
])
def test_reference_session_of_a_print(printed, ref, session):
    assert pc.reference_session({"market_time": printed}) == (ref, session)


def test_quotes_api_session_label():
    from app.api.quotes import _session_of

    assert _session_of({"market_time": "2026-11-27T02:21:16+00:00"}) == "overnight"
    assert _session_of({"market_time": "2026-11-25T21:00:00+00:00"}) == "regular"  # closing print
    assert _session_of({"market_time": "2026-11-25T23:00:00+00:00"}) == "after-hours"
    assert _session_of({"market_time": "2026-11-27T02:00:00+00:00", "data_source": "yahoo_direct"}) == "regular"
    assert _session_of({"market_time": "2026-11-25T00:00:00-05:00"}) == "regular"  # daily-bar stamp
    assert _session_of({"session": "pre-market"}) == "pre-market"
    assert _session_of({}) is None


def _public_aapl():
    return pc._parse_quote({
        "instrument": {"symbol": "AAPL"}, "outcome": "SUCCESS", "last": 357.75, "volume": 8883,
        "lastTimestamp": "2026-11-27T02:21:16+00:00",
        "oneDayChange": {"change": 3.68},  # Public's change vs the Nov 24 close
    })


def test_public_overnight_print_is_rebased_on_the_prior_close():
    q = _public_aapl()
    assert q["previous_close"] == 354.07  # the prod bug as parsed
    seen = {}

    def fake_fetch(symbols, ref_dates=None):
        seen.update(ref_dates or {})
        return {"AAPL": 355.58}

    with patch.object(pc, "_fetch_previous_closes", side_effect=fake_fetch):
        results = {"AAPL": q}
        asyncio.run(pc.PublicClient()._fill_previous_closes(results))
    q = results["AAPL"]
    assert seen["AAPL"] == date(2026, 11, 25)
    assert q["previous_close"] == 355.58
    assert q["change"] == pytest.approx(2.17, abs=0.005)
    assert q["change_percent"] == pytest.approx(0.6103, abs=1e-3)
    assert q["session"] == "overnight" and q["reference_close_date"] == "2026-11-25"


def test_reference_close_requires_that_sessions_bar():
    """If the vendor has not published the reference session's bar yet, do
    not fall back to an older one (that is the two-sessions-back bug)."""
    pc._prev_close_cache.clear()
    idx = pd.to_datetime(["2026-11-21", "2026-11-24"])
    frame = pd.DataFrame({"Close": [349.08, 354.07]}, index=idx)
    with patch("yfinance.download", return_value=frame):
        assert pc._fetch_previous_closes(["AAPL"], {"AAPL": date(2026, 11, 25)}) == {}
    idx = pd.to_datetime(["2026-11-24", "2026-11-25"])
    frame = pd.DataFrame({"Close": [354.07, 355.58]}, index=idx)
    with patch("yfinance.download", return_value=frame):
        assert pc._fetch_previous_closes(["AAPL"], {"AAPL": date(2026, 11, 25)}) == {"AAPL": 355.58}
    pc._prev_close_cache.clear()


def test_db_bar_is_current():
    thanksgiving = datetime(2026, 11, 27, 2, 21, tzinfo=UTC)
    assert not db_bar_is_current(datetime(2026, 11, 24, 5, 0, tzinfo=UTC), thanksgiving)  # Nov 24 bar: stale
    assert db_bar_is_current(datetime(2026, 11, 25, 5, 0, tzinfo=UTC), thanksgiving)      # Nov 25 bar: the last close
    regular = datetime(2026, 11, 25, 17, 0, tzinfo=UTC)
    assert not db_bar_is_current(datetime(2026, 11, 25, 5, 0, tzinfo=UTC), regular)       # never live intraday


@pytest.fixture
def client():
    from app.api import enhanced_endpoints
    from app.db.database import Base, get_db
    from app.models.price import PriceBar
    from app.models.symbol import Symbol

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[Symbol.__table__, PriceBar.__table__])
    db = sessionmaker(bind=engine)()
    s = Symbol(symbol="AAPL", name="Apple Inc.")
    db.add(s)
    db.commit()
    for ts, o, c in ((datetime(2026, 11, 21, 5, tzinfo=UTC), 345.0, 349.08),
                     (datetime(2026, 11, 24, 5, tzinfo=UTC), 348.06, 354.07)):
        db.add(PriceBar(symbol_id=s.id, timestamp=ts, open=o, high=c, low=o, close=c, volume=1))
    db.commit()
    app = FastAPI()
    app.include_router(enhanced_endpoints.router, prefix="/api/v1/enhanced")
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    db.close()


def test_enhanced_quote_prefers_live_over_stale_db_bar(client):
    live = {"symbol": "AAPL", "price": 355.58, "change": 1.51, "change_percent": 0.4265, "previous_close": 354.07,
            "volume": 54285255, "high": 356.75, "low": 345.13, "open": 353.475, "data_source": "yahoo_direct",
            "market_time": "2026-11-25T21:00:00+00:00"}
    with patch("app.api.enhanced_endpoints._live_quote", return_value=live):
        body = client.get("/api/v1/enhanced/quote/AAPL").json()
    assert body["last_price"] == 355.58
    assert body["change_percent"] == pytest.approx(0.4265)
    assert body["previous_close"] == 354.07
    assert body["data_source"] == "yahoo_direct"
    assert body["stale"] is False


def test_enhanced_quote_flags_stale_db_bar_when_live_fails(client):
    with patch("app.api.enhanced_endpoints._live_quote", return_value=None):
        body = client.get("/api/v1/enhanced/quote/AAPL").json()
    assert body["last_price"] == 354.07
    assert body["data_source"] == "database"
    assert body["stale"] is True


def test_enhanced_quote_live_path_runs_the_async_cache_from_the_threadpool(client):
    async def fake_get_quote(self, symbol, force_refresh=False):
        return {"symbol": symbol, "price": 355.58, "change": 1.51, "change_percent": 0.4265,
                "previous_close": 354.07, "data_source": "yahoo_direct",
                "market_time": "2026-11-25T21:00:00+00:00"}

    with patch("app.api.enhanced_endpoints.QuoteCacheService.get_quote", fake_get_quote):
        body = client.get("/api/v1/enhanced/quote/AAPL").json()
    assert body["last_price"] == 355.58 and body["data_source"] == "yahoo_direct"
