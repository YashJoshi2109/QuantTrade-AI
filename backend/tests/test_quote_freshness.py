"""Exchange calendar + copilot quote freshness.

Incident (prod, 2026-11-26 15:10 UTC = Thanksgiving, NYSE closed): the
copilot said "NVDA is trading at $151.23 ... (data as of 2026-11-26
00:59:59 UTC, market session: open)".  The price was Public.com's last
after-hours print (Nov 25 19:59:59 ET) but the session label came from the
wall clock via a weekday-only is_market_open() that knew no holidays.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.api.market_status import is_market_open
from app.services import market_calendar as mc
from app.services.copilot import sources as src
from app.services.quote_cache import QuoteCacheService

UTC = timezone.utc
INCIDENT_NOW = datetime(2026, 11, 26, 15, 10, tzinfo=UTC)          # Thanksgiving 10:10 ET
REGULAR_NOW = datetime(2026, 11, 24, 15, 10, tzinfo=UTC)           # Tuesday 10:10 ET


# ── calendar ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("d,name", [
    (date(2026, 1, 1), "New Year's Day"), (date(2026, 1, 19), "Martin Luther King Jr. Day"),
    (date(2026, 2, 16), "Washington's Birthday"), (date(2026, 4, 3), "Good Friday"),
    (date(2026, 5, 25), "Memorial Day"), (date(2026, 6, 19), "Juneteenth"),
    (date(2026, 7, 3), "Independence Day"),            # Jul 4 2026 is a Saturday
    (date(2026, 9, 7), "Labor Day"), (date(2026, 11, 26), "Thanksgiving Day"),
    (date(2026, 12, 25), "Christmas Day"), (date(2027, 12, 24), "Christmas Day"),   # Sat -> Fri
    (date(2028, 1, 17), "Martin Luther King Jr. Day"), (date(2027, 3, 26), "Good Friday"),
])
def test_nyse_holidays(d, name):
    assert mc.holiday_name(d) == name and not mc.is_trading_day(d)


def test_saturday_new_year_is_not_observed_on_friday():
    assert mc.is_trading_day(date(2021, 12, 31))           # Jan 1 2022 was a Saturday


def test_early_close_day_after_thanksgiving():
    assert mc.close_time(date(2026, 11, 27)).hour == 13
    assert mc.session_at(datetime(2026, 11, 27, 18, 30, tzinfo=UTC)) == mc.AFTER_HOURS   # 13:30 ET
    assert mc.session_at(datetime(2026, 11, 27, 17, 30, tzinfo=UTC)) == mc.REGULAR       # 12:30 ET


def test_sessions():
    assert mc.session_at(INCIDENT_NOW) == mc.CLOSED
    assert mc.session_at(REGULAR_NOW) == mc.REGULAR
    assert mc.session_at(datetime(2026, 11, 24, 12, 0, tzinfo=UTC)) == mc.PRE_MARKET     # 07:00 ET
    assert mc.session_at(datetime(2026, 11, 26, 0, 59, 59, tzinfo=UTC)) == mc.AFTER_HOURS  # Nov 25 19:59 ET
    assert mc.session_at(datetime(2026, 11, 28, 15, 0, tzinfo=UTC)) == mc.CLOSED          # Saturday
    assert mc.next_open(INCIDENT_NOW) == datetime(2026, 11, 27, 9, 30, tzinfo=mc.ET)


def test_market_status_endpoint_knows_holidays():
    s = is_market_open(INCIDENT_NOW)
    assert s["is_open"] is False and s["status"] == "CLOSED" and s["holiday"] == "Thanksgiving Day"
    assert s["exchanges"] == {"NYSE": False, "NASDAQ": False}
    r = is_market_open(REGULAR_NOW)
    assert r["is_open"] is True and r["session"] == "regular" and r["seconds_until_change"] > 0
    assert is_market_open(datetime(2026, 11, 27, 17, 0, tzinfo=UTC))["market_close"].startswith("13:00")


# ── quote labelling (the incident) ──────────────────────────────────────────

def _payload(market_time, **kw):
    return {"symbol": "NVDA", "price": 151.23, "change": 1.1, "change_percent": 0.73,
            "timestamp": market_time, "market_time": market_time, "data_source": "public.com", **kw}


def test_incident_quote_is_labelled_by_its_own_timestamp():
    f = src.quote_fact("NVDA", _payload("2026-11-26T00:59:59+00:00"), now=INCIDENT_NOW)
    assert f.market_session == "after-hours"                 # session of the print, not "open"
    assert f.market_now == "closed (Thanksgiving Day)"
    assert f.quote_time == f.as_of == "2026-11-26T00:59:59+00:00"
    assert f.age_minutes == pytest.approx(850.0, abs=0.1)
    assert f.stale is False                                    # latest print on a holiday is current
    assert "not live" in f.freshness_note and "2026-11-25 19:59 ET" in f.freshness_note


def test_overnight_quote_during_regular_session_is_stale():
    f = src.quote_fact("NVDA", _payload("2026-11-24T00:59:59+00:00"), now=REGULAR_NOW)
    assert f.market_now == "regular" and f.market_session == "after-hours"
    assert f.stale is True and "STALE" in f.freshness_note


def test_fresh_intraday_quote():
    t = (REGULAR_NOW - timedelta(seconds=30)).isoformat()
    f = src.quote_fact("NVDA", _payload(t), now=REGULAR_NOW)
    assert f.market_session == "regular" and f.stale is False and f.age_minutes == 0.5


def test_fetch_time_is_never_used_as_trade_time():
    # yfinance/FMP style: 'timestamp' is when WE fetched; no trade time
    q = {"price": 10.0, "timestamp": REGULAR_NOW.isoformat(), "data_source": "fmp"}
    f = src.quote_fact("X", q, now=REGULAR_NOW)
    assert f.quote_time is None and f.market_session is None and f.stale is None
    assert "no trade time" in f.freshness_note and f.market_now == "regular"


def test_weekend_quote_from_two_sessions_ago_is_stale():
    sat = datetime(2026, 11, 28, 15, 0, tzinfo=UTC)
    assert src.quote_fact("X", _payload("2026-11-27T18:05:00+00:00"), now=sat).stale is False  # Fri after-hours
    assert src.quote_fact("X", _payload("2026-11-25T20:00:00+00:00"), now=sat).stale is True   # Wed


def test_live_source_refetches_a_stale_regular_session_quote(monkeypatch):
    calls = []

    async def fake_get_quote(self, symbol, force_refresh=False):
        calls.append(force_refresh)
        t = "2026-11-24T00:59:59+00:00" if not force_refresh else "2026-11-24T15:09:40+00:00"
        return _payload(t, price=150.0 if not force_refresh else 152.5)

    import app.db.database as dbmod
    monkeypatch.setattr(dbmod, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(QuoteCacheService, "get_quote", fake_get_quote)
    monkeypatch.setattr(src, "_utcnow", lambda: REGULAR_NOW)
    f = asyncio.run(src.LiveSources().quote("NVDA"))
    assert calls == [False, True]
    assert f.price == 152.5 and f.stale is False and f.market_session == "regular"


def test_live_source_does_not_refetch_outside_session(monkeypatch):
    calls = []

    async def fake_get_quote(self, symbol, force_refresh=False):
        calls.append(force_refresh)
        return _payload("2026-11-26T00:59:59+00:00")

    import app.db.database as dbmod
    monkeypatch.setattr(dbmod, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(QuoteCacheService, "get_quote", fake_get_quote)
    monkeypatch.setattr(src, "_utcnow", lambda: INCIDENT_NOW)
    f = asyncio.run(src.LiveSources().quote("NVDA"))
    assert calls == [False] and f.market_now == "closed (Thanksgiving Day)"


# ── quote cache TTL ─────────────────────────────────────────────────────────

def test_ttl_follows_calendar():
    svc = QuoteCacheService(None)
    assert svc._get_current_ttl(INCIDENT_NOW) == svc.TTL_MARKET_CLOSED
    assert svc._get_current_ttl(REGULAR_NOW) == svc.TTL_MARKET_OPEN
    assert svc._get_current_ttl(datetime(2026, 11, 24, 22, 0, tzinfo=UTC)) == svc.TTL_EXTENDED_HOURS


def test_closed_market_ttl_does_not_outlive_the_open(monkeypatch):
    """A snapshot written at 09:25 ET with the 300s/600s TTL must be re-fetched
    after 60s once the regular session is running."""
    svc = QuoteCacheService(None)
    monkeypatch.setattr(svc, "_get_current_ttl", lambda at=None: svc.TTL_MARKET_OPEN)
    snap = SimpleNamespace(fetched_at=datetime.now(UTC) - timedelta(seconds=120), ttl_seconds=600)
    assert svc._is_cache_fresh(snap) is False
    snap.fetched_at = datetime.now(UTC) - timedelta(seconds=20)
    assert svc._is_cache_fresh(snap) is True
