"""Regression tests for the 2026-11-25 prod stalls (D1/D2).

* movers / sectors / heatmap answer from ONE snapshot -> breadth always agrees
* requests never wait on quote providers once anything is cached
* concurrent requests share one background refresh (no thundering herd)
* slow upstreams (monitor) serve last-good data instead of hanging
* EDGAR re-syncs are single-flight per ticker
* QuoteCacheService keeps blocking DB work off the event loop
"""
from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.models.quote_snapshot import QuoteSnapshot
from app.services.market_breadth import breadth_counts
from app.services.market_snapshot import MarketSnapshotService, build_snapshot
from app.services.swr_cache import SWRCache

UNIVERSE = [(f"S{i:02d}", f"Stock {i}", "Tech" if i % 2 else "Energy") for i in range(24)]


def _pct(i: int) -> float:
    return round((i - 10) * 0.37, 2)  # mix of up / down / flat (i=10 -> 0.0)


def _session_factory(rows_age: timedelta, ttl: int = 3600, pct=_pct):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[QuoteSnapshot.__table__])
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    fetched = datetime.now(timezone.utc) - rows_age
    for i, (sym, _n, _s) in enumerate(UNIVERSE):
        db.add(QuoteSnapshot(
            symbol=sym,
            payload={"symbol": sym, "price": 100 + i, "change": pct(i), "change_percent": pct(i), "volume": 1000},
            fetched_at=fetched,
            ttl_seconds=ttl,
        ))
    db.commit()
    db.close()
    return Session


def _client(monkeypatch, service: MarketSnapshotService) -> TestClient:
    from app.api import market

    monkeypatch.setattr(market, "market_snapshots", service)
    from app.db.database import get_db

    app = FastAPI()
    app.include_router(market.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: None  # snapshot uses its own sessions
    return TestClient(app)


async def _no_provider(symbols):  # pragma: no cover - must never run when warm
    raise AssertionError(f"provider called for {symbols[:3]}")


# ── D2: one snapshot -> one breadth ───────────────────────────────────────

def test_heatmap_sectors_movers_breadth_agree(monkeypatch):
    svc = MarketSnapshotService(UNIVERSE, session_factory=_session_factory(timedelta(seconds=5)),
                                fetch_quotes=_no_provider, ttl_fn=lambda: 60)
    with _client(monkeypatch, svc) as c:
        heat = c.get("/api/v1/market/heatmap").json()
        movers = c.get("/api/v1/market/movers", params={"limit": 500}).json()
        sectors = c.get("/api/v1/market/sectors").json()

    expected = breadth_counts(_pct(i) for i in range(len(UNIVERSE)))
    assert (heat["gainers"], heat["losers"], heat["unchanged"]) == (expected["up"], expected["down"], expected["flat"])
    assert movers["breadth"] == expected
    sector_pcts = [s["change_percent"] for sec in sectors for s in sec["stocks"]]
    assert breadth_counts(sector_pcts) == expected
    heat_pcts = sorted(s["change_percent"] for sec in heat["sectors"] for s in sec["stocks"])
    assert heat_pcts == sorted(sector_pcts)
    assert all(g["change_percent"] > 0 for g in movers["gainers"])
    assert all(lo["change_percent"] < 0 for lo in movers["losers"])


def test_build_snapshot_drops_bogus_rows_and_counts_flat_band():
    quotes = {
        "A": {"price": 10, "change_percent": 0.05},     # flat
        "B": {"price": 10, "change_percent": 0.5},      # up
        "C": {"price": 10, "change_percent": -0.5},     # down
        "D": {"price": 10, "change_percent": 8116.2},   # PARA-style bogus -> dropped
        "E": {"price": 0, "change_percent": 3},          # no price -> dropped
    }
    snap = build_snapshot([(s, s, "X") for s in "ABCDE"], quotes)
    assert snap.breadth == {"up": 1, "down": 1, "flat": 1, "total": 3}
    assert [r.symbol for r in snap.gainers(5)] == ["B"]
    assert [r.symbol for r in snap.losers(5)] == ["C"]


# ── D1: stale cache is served instantly, one shared refresh ───────────────

def test_stale_snapshot_served_while_single_refresh_runs(monkeypatch):
    calls = []

    async def slow_fetch(symbols):
        calls.append(list(symbols))
        await asyncio.sleep(1.5)
        return {s: {"symbol": s, "price": 500.0, "change": 2.0, "change_percent": 2.0, "volume": 1} for s in symbols}

    svc = MarketSnapshotService(
        UNIVERSE, session_factory=_session_factory(timedelta(hours=2), ttl=60),
        fetch_quotes=slow_fetch, ttl_fn=lambda: 60, rebuild_every=0.0, refresh_chunk=100,
    )
    with _client(monkeypatch, svc) as c:
        t0 = time.monotonic()
        for path in ("/api/v1/market/movers", "/api/v1/market/heatmap", "/api/v1/market/sectors"):
            assert c.get(path).status_code == 200
        assert time.monotonic() - t0 < 1.0, "requests waited on the quote provider"
        assert len(calls) == 1, "concurrent requests must share one refresh"

        time.sleep(2.0)  # background refresh completes and rebuilds the snapshot
        heat = c.get("/api/v1/market/heatmap").json()
    assert heat["gainers"] == len(UNIVERSE)
    assert {s["price"] for sec in heat["sectors"] for s in sec["stocks"]} == {500.0}


def test_refresh_chunk_timeout_does_not_block(monkeypatch):
    async def hang(symbols):
        await asyncio.sleep(30)

    svc = MarketSnapshotService(
        UNIVERSE, session_factory=_session_factory(timedelta(hours=2), ttl=60),
        fetch_quotes=hang, ttl_fn=lambda: 60, chunk_timeout=0.2, refresh_chunk=100,
    )
    with _client(monkeypatch, svc) as c:
        t0 = time.monotonic()
        r = c.get("/api/v1/market/movers")
        assert r.status_code == 200 and time.monotonic() - t0 < 1.0
        assert r.json()["breadth"]["total"] == len(UNIVERSE)


def test_force_refresh_cannot_be_spammed(monkeypatch):
    calls = []

    async def fetch(symbols):
        calls.append(1)
        return {}

    svc = MarketSnapshotService(UNIVERSE, session_factory=_session_factory(timedelta(seconds=1)),
                                fetch_quotes=fetch, ttl_fn=lambda: 60)
    with _client(monkeypatch, svc) as c:
        for _ in range(5):
            c.get("/api/v1/market/heatmap", params={"force_refresh": "true"})
    assert len(calls) == 1


def test_chat_positional_db_arg_is_not_force_refresh(monkeypatch):
    """chat.py calls get_top_gainers(10, db): the Session must not trigger a live pass."""
    from app.api import market

    svc = MarketSnapshotService(UNIVERSE, session_factory=_session_factory(timedelta(seconds=1)),
                                fetch_quotes=_no_provider, ttl_fn=lambda: 60)
    monkeypatch.setattr(market, "market_snapshots", svc)
    gainers = asyncio.run(market.get_top_gainers(10, object()))
    assert gainers and all(g.change_percent > 0 for g in gainers)


# ── SWR cache for slow upstreams ──────────────────────────────────────────

def test_swr_serves_stale_and_dedupes_refresh():
    clock = [0.0]
    cache = SWRCache(clock=lambda: clock[0])
    calls = []

    async def fetch():
        calls.append(1)
        await asyncio.sleep(0.2)
        return len(calls)

    async def scenario():
        assert await cache.get("k", fetch, fresh_for=10, wait=1) == 1
        clock[0] = 100  # stale
        t0 = time.monotonic()
        vals = await asyncio.gather(*[cache.get("k", fetch, fresh_for=10, wait=1) for _ in range(5)])
        assert time.monotonic() - t0 < 0.1
        assert vals == [1] * 5
        await asyncio.sleep(0.3)
        assert cache.peek("k") == 2

    asyncio.run(scenario())
    assert len(calls) == 2


def test_swr_keeps_last_good_on_bad_or_failed_refresh():
    clock = [0.0]
    cache = SWRCache(clock=lambda: clock[0])
    results = iter(["good", "bad"])

    async def fetch():
        return next(results)

    async def boom():
        raise RuntimeError("upstream down")

    async def scenario():
        assert await cache.get("k", fetch, fresh_for=1, wait=1, is_good=lambda v: v == "good") == "good"
        clock[0] = 5
        await cache.get("k", fetch, fresh_for=1, wait=1, is_good=lambda v: v == "good")
        await asyncio.sleep(0.01)
        assert cache.peek("k") == "good"
        await cache.get("k", boom, fresh_for=1, wait=1)
        await asyncio.sleep(0.01)
        assert cache.peek("k") == "good"

    asyncio.run(scenario())


def test_swr_cold_wait_is_bounded():
    cache = SWRCache()

    async def hang():
        await asyncio.sleep(5)

    async def scenario():
        with pytest.raises(asyncio.TimeoutError):
            await cache.get("k", hang, fresh_for=1, wait=0.1)

    asyncio.run(scenario())


def test_commodities_fetch_in_parallel_and_serve_last_good(monkeypatch):
    from app.api import monitor_extended as mx

    async def slow_quote(client, yf_sym, name, sym, group):
        await asyncio.sleep(0.3)
        return mx.CommodityQuote(name=name, symbol=sym, group=group, price="$1.00",
                                 change="+0.01", change_pct="+1.00%", direction="up")

    monkeypatch.setattr(mx, "_fetch_commodity", slow_quote)
    monkeypatch.setattr(mx, "_monitor_cache", SWRCache())
    t0 = time.monotonic()
    first = asyncio.run(mx.get_commodities())
    assert time.monotonic() - t0 < 1.5, "14 quotes must not be fetched sequentially"
    assert all(q.price == "$1.00" for q in first.commodities)

    async def down(client, yf_sym, name, sym, group):
        return mx._commodity_placeholder(name, sym, group)

    monkeypatch.setattr(mx, "_fetch_commodity", down)
    mx._monitor_cache._entries["commodities"].stored_at -= 3600  # make it stale

    async def twice():
        a = await mx.get_commodities()
        await asyncio.sleep(0.05)  # failed refresh finishes
        b = await mx.get_commodities()
        return a, b

    a, b = asyncio.run(twice())
    assert all(q.price == "$1.00" for q in a.commodities + b.commodities)


def test_economic_indicators_cold_timeout_returns_placeholders(monkeypatch):
    from app.api import monitor_extended as mx

    async def hang(tab, series_list):
        await asyncio.sleep(30)

    monkeypatch.setattr(mx, "_build_economic_indicators", hang)
    monkeypatch.setattr(mx, "_monitor_cache", SWRCache())

    async def call():
        return await asyncio.wait_for(mx.get_economic_indicators(tab="oil"), timeout=20)

    t0 = time.monotonic()
    # patch the cold wait down so the test is quick
    orig = mx._monitor_cache.get

    async def quick_get(key, fetch, **kw):
        kw["wait"] = 0.1
        return await orig(key, fetch, **kw)

    monkeypatch.setattr(mx._monitor_cache, "get", quick_get)
    resp = asyncio.run(call())
    assert time.monotonic() - t0 < 2
    assert resp.indicators and all(i.value == "N/A" for i in resp.indicators)


# ── EDGAR single flight ───────────────────────────────────────────────────

def test_edgar_sync_is_single_flight(monkeypatch):
    from app.api import research

    calls = []

    def fake_sync(ticker, db, force_refresh=False):
        calls.append(ticker)
        time.sleep(0.3)
        return {"status": "ok"}

    class FakeSession:
        def close(self):
            pass

        def rollback(self):
            pass

    monkeypatch.setattr(research, "sync_edgar_data", fake_sync)
    monkeypatch.setattr(research._database, "SessionLocal", FakeSession)
    research._sync_ok_at.clear()

    results = []
    threads = [threading.Thread(target=lambda: results.append(research._sync_once("JPM"))) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert calls == ["JPM"]
    assert [r["status"] for r in results] == ["ok"] * 4

    research._sync_ok_at.clear()
    lock = research._sync_lock("JPM")
    lock.acquire()
    try:
        assert research._sync_once("JPM", wait=0.05)["status"] == "pending"
    finally:
        lock.release()


# ── QuoteCacheService: DB off the event loop ──────────────────────────────

def test_quote_cache_db_work_runs_off_event_loop():
    from app.services.quote_cache import QuoteCacheService

    Session = _session_factory(timedelta(seconds=1))
    db = Session()
    svc = QuoteCacheService(db)
    seen = []
    orig = svc._get_cached_quotes_bulk

    def spy(symbols):
        seen.append(threading.current_thread() is threading.main_thread())
        return orig(symbols)

    svc._get_cached_quotes_bulk = spy
    quotes = asyncio.run(svc.get_quotes(["S01", "S02"]))
    db.close()
    assert seen == [False]
    assert quotes["S01"]["cached"] is True and quotes["S01"]["price"] == 101


def test_quote_cache_bulk_write_single_commit():
    from app.services.quote_cache import QuoteCacheService

    Session = _session_factory(timedelta(hours=5), ttl=60)
    db = Session()
    svc = QuoteCacheService(db)
    commits = []
    real_commit = db.commit
    db.commit = lambda: (commits.append(1), real_commit())[1]

    async def fake_parallel(symbols):
        return {s: {"symbol": s, "price": 7.0, "change": 0.1, "change_percent": 1.0} for s in symbols}

    svc._fetch_quotes_parallel = fake_parallel
    asyncio.run(svc.get_quotes([s for s, _n, _x in UNIVERSE]))
    # one commit releasing the read txn + one for the whole batch write
    assert len(commits) <= 2
    check = Session()
    assert {r.payload["price"] for r in check.query(QuoteSnapshot).all()} == {7.0}
    check.close()
    db.close()
