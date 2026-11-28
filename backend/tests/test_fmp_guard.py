"""FMP quota guard: quota detection, breaker, budget, cache, single flight,
status-probe mapping, and the call sites falling through. No network."""
from __future__ import annotations

import asyncio
import json
import threading
import time
from datetime import datetime, timezone

import pytest
import requests

from app.config import settings
from app.services import fmp_guard as fg
from app.services import provider_meter as pm
from app.services.system_probes import fmp_status, meter_result, probe_fmp
from app.services.system_status import DEGRADED, DOWN, NOT_CONFIGURED, OK, ProbeContext

NOW = 1_800_000_000.0   # 2027-01-15 08:00 UTC


class Resp:
    def __init__(self, status=200, payload=None, headers=None, body=None):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.content = body if body is not None else json.dumps(payload).encode()

    def json(self):
        if self._payload is None:
            return json.loads(self.content)
        return self._payload


class FakeHTTP:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, params=None, timeout=None, **kw):
        self.calls.append((url, dict(params or {})))
        r = self.responses[0] if len(self.responses) == 1 else self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setattr(settings, "FMP_API_KEY", "test-key", raising=False)


@pytest.fixture
def guard():
    g = fg.FMPGuard(store=fg.MemoryStore(), clock=lambda: NOW)
    return g


def _http(monkeypatch, *responses):
    fake = FakeHTTP(*responses)
    monkeypatch.setattr(requests, "get", fake)
    return fake


QUOTE = [{"symbol": "AAPL", "price": 190.5, "previousClose": 189.0, "changePercentage": 0.79,
          "dayHigh": 191, "dayLow": 188, "open": 189.5, "volume": 1000}]
LIMIT_BODY = {"Error Message": "Limit Reach . Please upgrade your plan or visit our documentation"}
LEGACY_BODY = {"Error Message": "Legacy Endpoint : Due to Legacy endpoints being no longer supported - "
                                "This endpoint is only available for legacy users."}


# ── quota detection ──────────────────────────────────────────────────────

@pytest.mark.parametrize("status,body,verdict", [
    (200, b'[{"symbol":"AAPL"}]', fg.OK),
    (200, b'[{"description":"a premium brand"}]', fg.OK),      # marker words only count on errors
    (429, b"", fg.QUOTA),
    (200, json.dumps(LIMIT_BODY).encode(), fg.QUOTA),
    (403, json.dumps(LIMIT_BODY).encode(), fg.QUOTA),
    (401, b'{"Error Message": "Invalid API KEY."}', fg.KEY),
    (403, json.dumps(LEGACY_BODY).encode(), fg.PLAN),
    (402, b"", fg.PLAN),
    (503, b"", fg.OUTAGE),
    (None, b"", fg.OUTAGE),
    (404, b"", fg.CLIENT),
    (200, b'{"Error Message": "Unknown symbol"}', fg.CLIENT),
])
def test_classify(status, body, verdict):
    assert fg.classify(status, body) == verdict


def test_retry_after_and_reset_time():
    assert fg.next_utc_midnight(NOW) == datetime(2027, 1, 16, tzinfo=timezone.utc).timestamp()
    assert fg.quota_reset_at(None, NOW) == fg.next_utc_midnight(NOW)
    assert fg.quota_reset_at("3600", NOW) == NOW + 3600
    assert fg.quota_reset_at("1", NOW) == NOW + 60                 # clamped: never re-hammer within a minute
    assert fg.quota_reset_at("999999", NOW) == NOW + 36 * 3600
    assert fg.quota_reset_at("Sat, 16 Jan 2027 00:30:00 GMT", NOW) == \
        datetime(2027, 1, 16, 0, 30, tzinfo=timezone.utc).timestamp()
    assert fg.quota_reset_at("garbage", NOW) == fg.next_utc_midnight(NOW)


# ── breaker ──────────────────────────────────────────────────────────────

def test_429_opens_breaker_until_utc_midnight_and_stops_calls(monkeypatch, key, guard):
    http = _http(monkeypatch, Resp(429, LIMIT_BODY))
    assert guard.get_json("quote", {"symbol": "AAPL"}, ttl=60) is None
    st = guard.state()
    assert st["open"] and st["reason"] == fg.QUOTA and st["until"] == fg.next_utc_midnight(NOW)
    for sym in ("MSFT", "NVDA", "TSLA"):
        assert guard.get_json("quote", {"symbol": sym}, ttl=60) is None
    assert len(http.calls) == 1            # never hammered while open
    assert guard.stats["skipped"] == 3


def test_limit_reach_body_with_200_is_quota(monkeypatch, key, guard):
    _http(monkeypatch, Resp(200, LIMIT_BODY))
    assert guard.get_json("quote", {"symbol": "AAPL"}, ttl=60) is None
    assert guard.state()["reason"] == fg.QUOTA


def test_retry_after_header_is_honoured(monkeypatch, key, guard):
    _http(monkeypatch, Resp(429, LIMIT_BODY, headers={"Retry-After": "1800"}))
    guard.get_json("quote", {"symbol": "AAPL"}, ttl=60)
    assert guard.state()["until"] == NOW + 1800


def test_breaker_closes_after_reset(monkeypatch, key):
    t = [NOW]
    g = fg.FMPGuard(store=fg.MemoryStore(), clock=lambda: t[0])
    http = _http(monkeypatch, Resp(429, LIMIT_BODY), Resp(200, QUOTE))
    g.get_json("quote", {"symbol": "AAPL"}, ttl=60)
    assert g.is_open()
    t[0] = fg.next_utc_midnight(NOW) + 1
    assert not g.is_open()
    assert g.get_json("quote", {"symbol": "AAPL"}, ttl=60) == QUOTE
    assert len(http.calls) == 2


def test_breaker_is_shared_across_processes(monkeypatch, key):
    store = fg.MemoryStore()
    a = fg.FMPGuard(store=store, clock=lambda: NOW)
    b = fg.FMPGuard(store=store, clock=lambda: NOW)
    http = _http(monkeypatch, Resp(429, LIMIT_BODY))
    a.get_json("quote", {"symbol": "AAPL"}, ttl=60)
    assert b.get_json("quote", {"symbol": "MSFT"}, ttl=60) is None
    assert len(http.calls) == 1 and b.state()["reason"] == fg.QUOTA


def test_daily_budget_opens_breaker_before_fmp_says_no(monkeypatch, key, guard):
    monkeypatch.setenv("FMP_DAILY_BUDGET", "2")
    http = _http(monkeypatch, Resp(200, QUOTE))
    guard.get_json("quote", {"symbol": "A"}, ttl=60)
    guard.get_json("quote", {"symbol": "B"}, ttl=60)
    assert guard.get_json("quote", {"symbol": "C"}, ttl=60) is None
    assert len(http.calls) == 2
    st = guard.state()
    assert st["reason"] == fg.QUOTA and st["calls_today"] == 2 and "budget" in st["detail"]


def test_outage_streak_opens_short_breaker(monkeypatch, key, guard):
    http = _http(monkeypatch, Resp(503, body=b"oops"), requests.ConnectionError("down"), Resp(502, body=b""))
    for s in ("A", "B", "C"):
        guard.get_json("quote", {"symbol": s}, ttl=60)
    st = guard.state()
    assert st["open"] and st["reason"] == fg.OUTAGE and st["until"] == NOW + fg.OUTAGE_BASE_S
    guard.get_json("quote", {"symbol": "D"}, ttl=60)
    assert len(http.calls) == 3


def test_rejected_key_pauses_for_an_hour(monkeypatch, key, guard):
    _http(monkeypatch, Resp(401, {"Error Message": "Invalid API KEY."}))
    guard.get_json("quote", {"symbol": "A"}, ttl=60)
    st = guard.state()
    assert st["reason"] == fg.KEY and st["until"] == NOW + fg.KEY_COOLDOWN_S


def test_no_key_never_calls(monkeypatch, guard):
    monkeypatch.setattr(settings, "FMP_API_KEY", None, raising=False)
    http = _http(monkeypatch, Resp(200, QUOTE))
    assert guard.get_json("quote", {"symbol": "A"}, ttl=60) is None
    assert http.calls == []


# ── cache ────────────────────────────────────────────────────────────────

def test_positive_cache_serves_repeat_calls(monkeypatch, key, guard):
    http = _http(monkeypatch, Resp(200, QUOTE))
    for _ in range(5):
        assert guard.get_json("quote", {"symbol": "AAPL"}, ttl=60) == QUOTE
    assert len(http.calls) == 1 and guard.stats["cache_hits"] == 4
    assert http.calls[0][0] == fg.FMP_STABLE + "/quote"
    assert http.calls[0][1] == {"symbol": "AAPL", "apikey": "test-key"}


def test_cache_is_shared_through_the_store(monkeypatch, key):
    store = fg.MemoryStore()
    http = _http(monkeypatch, Resp(200, QUOTE))
    fg.FMPGuard(store=store).get_json("quote", {"symbol": "AAPL"}, ttl=60)
    assert fg.FMPGuard(store=store).get_json("quote", {"symbol": "AAPL"}, ttl=60) == QUOTE
    assert len(http.calls) == 1


def test_empty_and_plan_answers_are_negative_cached(monkeypatch, key, guard):
    http = _http(monkeypatch, Resp(200, []), Resp(403, LEGACY_BODY))
    assert guard.get_json("quote", {"symbol": "ZZZZ"}, ttl=60) is None
    assert guard.get_json("quote", {"symbol": "ZZZZ"}, ttl=60) is None
    assert guard.get_json("company-screener", {"exchange": "LON"}, ttl=60) is None
    assert guard.get_json("company-screener", {"exchange": "LON"}, ttl=60) is None
    assert len(http.calls) == 2
    assert not guard.state()["open"]        # a plan limit is per endpoint, not a global outage


def test_cache_expires(monkeypatch, key):
    g = fg.FMPGuard(store=fg.MemoryStore())
    http = _http(monkeypatch, Resp(200, QUOTE))
    g.get_json("quote", {"symbol": "AAPL"}, ttl=1)
    real = time.time
    monkeypatch.setattr(fg.time, "time", lambda: real() + 5)
    g.get_json("quote", {"symbol": "AAPL"}, ttl=1)
    assert len(http.calls) == 2


def test_concurrent_misses_share_one_request(monkeypatch, key, guard):
    gate = threading.Event()
    calls = []

    def slow_get(url, params=None, timeout=None, **kw):
        calls.append(url)
        gate.wait(2)
        return Resp(200, QUOTE)

    monkeypatch.setattr(requests, "get", slow_get)
    out = []
    threads = [threading.Thread(target=lambda: out.append(guard.get_json("quote", {"symbol": "AAPL"}, ttl=60)))
               for _ in range(6)]
    for t in threads:
        t.start()
    time.sleep(0.2)
    gate.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1
    assert out == [QUOTE] * 6


# ── call sites fall through to the other providers ───────────────────────

def test_quote_fallbacks_skip_fmp_while_breaker_open(monkeypatch, key):
    from app.services.market_data_service import market_data
    from app.services.quote_cache import QuoteCacheService

    fg.guard.trip_quota()
    http = _http(monkeypatch, Resp(200, QUOTE))
    assert asyncio.run(market_data._fmp_quote("AAPL")) is None
    svc = QuoteCacheService.__new__(QuoteCacheService)
    assert asyncio.run(svc._fetch_from_fmp("AAPL")) is None
    assert http.calls == []


def test_quote_parsers_read_stable_fields(monkeypatch, key):
    from app.services.market_data_service import market_data
    from app.services.quote_cache import QuoteCacheService

    http = _http(monkeypatch, Resp(200, QUOTE))
    q = asyncio.run(market_data._fmp_quote("AAPL"))
    assert q.price == 190.5 and q.change_pct == 0.79 and q.source == "fmp"
    svc = QuoteCacheService.__new__(QuoteCacheService)
    d = asyncio.run(svc._fetch_from_fmp("AAPL"))
    assert d["price"] == 190.5 and d["change_percent"] == 0.79
    assert len(http.calls) == 1   # second parser served from the 60 s cache


def test_fmp_is_last_in_the_quote_chains(monkeypatch):
    from app.services.market_data_service import market_data

    order = []

    def src(name, ok=False):
        async def f(symbol):
            order.append(name)
            return None
        return f

    for name in ("_finnhub_quote", "_public_quote", "_yf_quote", "_alpaca_quote", "_robinhood_quote", "_fmp_quote"):
        monkeypatch.setattr(market_data, name, src(name))

    async def no_cache(key, ttl, fn):
        return await fn()

    from app.services import market_data_service as mds
    monkeypatch.setattr(mds.cache_service, "get_or_fetch", no_cache)
    assert asyncio.run(market_data.get_quote("ZZZZ")) is None
    assert order[-1] == "_fmp_quote" and len(order) == 6


def test_screener_merges_exchanges_and_caches(monkeypatch, key):
    from app.services import exchange_universe_service as eus

    nyse = [{"symbol": "JPM", "marketCap": 6e11}, {"symbol": "KO", "marketCap": 2.5e11}]
    nasdaq = [{"symbol": "NVDA", "marketCap": 4e12}]
    http = _http(monkeypatch, Resp(200, nyse), Resp(200, nasdaq), Resp(403, LEGACY_BODY))
    rows = eus.fetch_fmp_screener(["NYSE", "NASDAQ", "AMEX"], 2)
    assert [r["symbol"] for r in rows] == ["NVDA", "JPM"]
    eus.fetch_fmp_screener(["NYSE", "NASDAQ", "AMEX"], 2)
    assert len(http.calls) == 3   # second run (e.g. a /market/universe seed) is all cache


def test_backtest_fmp_reads_stable_dividend_adjusted_rows(monkeypatch, key):
    from app.services.backtesting import data as bt

    rows = [{"symbol": "AAPL", "date": "2024-01-0%d" % d, "adjOpen": 10.0 + d, "adjHigh": 11.0 + d,
             "adjLow": 9.0 + d, "adjClose": 10.5 + d, "volume": 100} for d in range(2, 6)]
    http = _http(monkeypatch, Resp(200, rows))
    df = bt.fetch_fmp("AAPL", datetime(2024, 1, 1), datetime(2024, 1, 10))
    assert list(df["close"]) == [12.5, 13.5, 14.5, 15.5]
    assert http.calls[0][0].endswith("/historical-price-eod/dividend-adjusted")


# ── system-status mapping ────────────────────────────────────────────────

def _ctx(meter, daily=None):
    return ProbeContext(meter=meter, daily=daily or {}, now=lambda: NOW)


def _meter(*records):
    m = pm.ProviderMeter(clock=lambda: NOW)
    for ok, status, err, rl in records:
        m.record("fmp", ok, 50, status=status, error=err, rate_limited=rl)
    return m.snapshot()


def _fmp_result(snap, breaker, daily=None):
    res = meter_result(_ctx(snap, daily), "fmp", configured=True, label="FMP", day_limit=250)
    return fmp_status(res, breaker, snap.get("fmp") or {}, NOW)


CLOSED = {"open": False}
QUOTA_OPEN = {"open": True, "reason": fg.QUOTA, "until": fg.next_utc_midnight(NOW)}


def test_status_quota_breaker_is_degraded_not_down():
    snap = _meter(*[(False, 429, "rate limited (HTTP 429)", True)] * 5)
    r = _fmp_result(snap, QUOTA_OPEN)
    assert r.status == DEGRADED
    assert r.detail.startswith("Daily quota exhausted — fallbacks active, resets 00:00 UTC")


def test_status_quota_reset_time_follows_retry_after():
    r = _fmp_result(_meter((False, 429, "rate limited (HTTP 429)", True)),
                    {"open": True, "reason": fg.QUOTA, "until": NOW + 5400})
    assert "resets 09:30 UTC" in r.detail and r.status == DEGRADED


def test_status_own_counter_exhausted_is_degraded():
    r = _fmp_result(_meter((True, 200, None, False)), CLOSED, daily={"fmp": 272})
    assert r.status == DEGRADED and "Daily quota exhausted" in r.detail


def test_status_rate_limit_failures_without_breaker_are_degraded():
    snap = _meter(*[(False, 403, "rate limit / quota message in response body (HTTP 403)", True)] * 4)
    r = _fmp_result(snap, CLOSED)
    assert r.status == DEGRADED and "Daily quota exhausted" in r.detail


def test_status_real_outage_is_down():
    snap = _meter(*[(False, 503, "server error (HTTP 503)", False)] * 4)
    assert _fmp_result(snap, CLOSED).status == DOWN
    r = _fmp_result(snap, {"open": True, "reason": fg.OUTAGE, "until": NOW + 120, "detail": "HTTP 503"})
    assert r.status == DOWN and "Unreachable" in r.detail


def test_status_rejected_key_is_down():
    snap = _meter(*[(False, 401, "key rejected (HTTP 401)", False)] * 3)
    r = _fmp_result(snap, {"open": True, "reason": fg.KEY, "until": NOW + 3600})
    assert r.status == DOWN and "key rejected" in r.detail.lower()


def test_status_plan_errors_are_degraded():
    snap = _meter(*[(False, 403, "endpoint not on plan (HTTP 403)", False)] * 4)
    r = _fmp_result(snap, CLOSED)
    assert r.status == DEGRADED and "not on the free plan" in r.detail


def test_status_healthy_stays_ok():
    r = _fmp_result(_meter(*[(True, 200, None, False)] * 4), CLOSED, daily={"fmp": 12})
    assert r.status == OK and r.meta["breaker"]["open"] is False


def test_probe_fmp_reads_the_live_breaker(monkeypatch, key):
    fg.guard.trip_quota()
    snap = _meter(*[(False, 429, "rate limited (HTTP 429)", True)] * 3)
    r = asyncio.run(probe_fmp(ProbeContext(meter=snap, daily={}, now=time.time)))
    assert r.status == DEGRADED and "Daily quota exhausted — fallbacks active, resets 00:00 UTC" in r.detail
    assert r.detail.startswith("Free plan, 250 calls/day")


def test_probe_fmp_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "FMP_API_KEY", None, raising=False)
    assert asyncio.run(probe_fmp(ProbeContext(meter={}, daily={}))).status == NOT_CONFIGURED


def test_meter_classifies_fmp_403_bodies():
    ok, err, rl = pm.classify("fmp", 403, json.dumps(LIMIT_BODY).encode())
    assert not ok and rl
    ok, err, rl = pm.classify("fmp", 403, json.dumps(LEGACY_BODY).encode())
    assert not ok and not rl and "not on plan" in err
    assert pm.classify("fmp", 403, b"")[1] == "key rejected (HTTP 403)"
