"""Suggested alerts: thresholds, no-immediate-trigger, dedupe, ranking, and the API route."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import alert_suggestions as sg
from app.services.alert_suggestions import BarStats, Holding, Suggestion
from app.services.price_alert_service import is_met

TODAY = date(2026, 11, 25)


def _metrics(s: Suggestion):
    if s.condition == "earnings_within_days":
        return {"earnings": s.meta["days_until"]}
    return {"price": s.current_price, "change": s.change_percent}


def _assert_safe(sugs):
    for s in sugs:
        assert is_met(s.condition, s.threshold, _metrics(s)) is not True, s
        if s.condition in ("price_above", "price_below"):
            gap = abs(s.threshold - s.current_price) / s.current_price * 100
            assert gap >= sg.MIN_GAP_PCT - 1e-9, s


# ── thresholds ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("price,tick", [(0.5, 0.01), (7.3, 0.05), (42, 0.25), (88, 0.5), (230, 1.0), (1500, 5.0)])
def test_tick_sizes(price, tick):
    assert sg.tick_for(price) == tick


def test_levels_round_away_from_price_and_keep_a_gap():
    assert sg.level_above(230.4, 233.2) == 234
    assert sg.level_below(230.4, 218.7) == 218
    # raw level too close (or on the wrong side): pushed out to MIN_GAP_PCT, still on the tick
    assert sg.level_above(100.0, 100.1) == 101
    assert sg.level_below(100.0, 101.0) == 99
    assert sg.level_above(99.0, 99.1) == 99.5
    assert sg.level_above(42.0, 43.1) == 43.25
    assert sg.level_below(7.32, 6.97) == 6.95


def test_atr_and_stop_distance():
    bars = [{"high": 101 + i, "low": 99 + i, "close": 100 + i} for i in range(20)]
    a = sg.atr(bars)
    assert a == pytest.approx(2.0)
    assert sg.atr(bars[:10]) is None
    # 2xATR clamped to 3%-10% of price
    assert sg.stop_distance(100, 2.0) == pytest.approx(4.0)
    assert sg.stop_distance(100, 0.5) == pytest.approx(3.0)
    assert sg.stop_distance(100, 9.0) == pytest.approx(10.0)
    assert sg.stop_distance(100, None) == pytest.approx(5.0)


def test_portfolio_stop_uses_atr_and_cost_basis():
    st = BarStats(atr14=4.0, high_20d=212.0, low_20d=190.0)
    out = sg.portfolio_suggestions(Holding("AAPL", 10, 190.0), 200.0, 0.4, st)
    by = {(s.label): s for s in out}
    assert by["Stop-loss"].condition == "price_below" and by["Stop-loss"].threshold == 192
    assert by["Protect gains"].threshold == 190
    assert by["Resistance"].condition == "price_above" and by["Resistance"].threshold == 212
    assert "ATR" in by["Stop-loss"].reason
    _assert_safe(out)


def test_near_52w_reason_and_requires_history():
    st = BarStats(high_52w=202.4, low_52w=120.0, bars_52w=250)
    out = sg.near_52w_suggestions("AAPL", 200.0, 0.2, st)
    assert len(out) == 1
    s = out[0]
    assert s.source == "near_52w_high" and s.condition == "price_above" and s.threshold == 203
    assert s.reason.startswith("AAPL is 1.2% below its 52-week high of $202.40")
    assert sg.near_52w_suggestions("AAPL", 200.0, 0.2, BarStats(high_52w=202.4, bars_52w=40)) == []
    # already at / above the high: nothing (it would trigger immediately)
    assert sg.near_52w_suggestions("AAPL", 203.0, 0.2, st) == []


def test_mover_half_reversal_levels():
    up = sg.mover_suggestion("NVDA", 106.0, 6.0)
    prev = 106.0 / 1.06
    assert up.condition == "price_below" and prev < up.threshold < 106.0
    down = sg.mover_suggestion("INTC", 47.0, -6.0)
    assert down.condition == "price_above" and 47.0 < down.threshold < 47.0 / 0.94
    assert sg.mover_suggestion("KO", 60.0, 0.8) is None
    _assert_safe([up, down])


def test_earnings_lead_never_fires_immediately():
    s = sg.earnings_suggestion("AAPL", {"date": "2026-12-01", "hour": "amc"}, TODAY, 200.0, 0.1)
    assert s.threshold == 3 and s.repeat and "after the close" in s.reason and "in 6 days" in s.reason
    s2 = sg.earnings_suggestion("AAPL", {"date": "2026-11-28"}, TODAY, 200.0, 0.1)  # 3 days out
    assert s2.threshold == 2
    assert sg.earnings_suggestion("AAPL", {"date": "2026-11-26"}, TODAY, 200.0, 0.1) is None  # tomorrow
    assert sg.earnings_suggestion("AAPL", {"date": "2026-12-30"}, TODAY, 200.0, 0.1) is None  # too far
    _assert_safe([s, s2])


def test_would_trigger_now_blocks_crossed_levels():
    mk = lambda c, t, p=100.0, ch=0.0: Suggestion("X", c, t, "r", "watchlist", "l", p, ch)
    assert sg.would_trigger_now(mk("price_above", 99.0))
    assert sg.would_trigger_now(mk("price_below", 101.0))
    assert sg.would_trigger_now(mk("price_above", 100.2))  # inside MIN_GAP
    assert not sg.would_trigger_now(mk("price_above", 101.0))
    assert sg.would_trigger_now(mk("change_down_pct", 3.0, ch=-4.0))
    assert not sg.would_trigger_now(mk("change_down_pct", 3.0, ch=-1.0))
    assert sg.would_trigger_now(mk("price_above", 101.0, p=None))


# ── ranking & dedupe ─────────────────────────────────────────────────────────

def _world():
    rows = [
        {"symbol": "NVDA", "name": "NVIDIA", "price": 106.0, "change_percent": 6.0, "market_cap": 3e12},
        {"symbol": "INTC", "name": "Intel", "price": 47.0, "change_percent": -5.0, "market_cap": 2e11},
        {"symbol": "KO", "name": "Coca-Cola", "price": 60.0, "change_percent": 0.3, "market_cap": 2.6e11},
        {"symbol": "WMT", "name": "Walmart", "price": 98.0, "change_percent": 0.1, "market_cap": 7e11},
        {"symbol": "PFE", "name": "Pfizer", "price": 25.5, "change_percent": -0.2, "market_cap": 1.4e11},
    ]
    quotes = {r["symbol"]: {"price": r["price"], "change": r["change_percent"]} for r in rows}
    quotes.update({"AAPL": {"price": 200.0, "change": 0.5}, "TSLA": {"price": 300.0, "change": -1.0}})
    stats = {
        "AAPL": BarStats(high_52w=230, low_52w=150, bars_52w=250, atr14=4.0, high_20d=208, low_20d=190),
        "TSLA": BarStats(high_52w=400, low_52w=200, bars_52w=250, atr14=12.0, high_20d=320, low_20d=280),
        "WMT": BarStats(high_52w=99.5, low_52w=70, bars_52w=250, atr14=1.5),   # 1.5% below 52w high
        "PFE": BarStats(high_52w=40, low_52w=25.0, bars_52w=250, atr14=0.6),   # 2% above 52w low
        "KO": BarStats(high_52w=75, low_52w=50, bars_52w=250),
    }
    earnings = {"KO": {"date": "2026-12-02", "hour": "bmo"}, "AAPL": {"date": "2026-12-03"}}
    return dict(
        holdings=[Holding("AAPL", 10, 185.0)], watchlist=["TSLA", "AAPL"], quotes=quotes, stats=stats,
        market_rows=rows, earnings=earnings, today=TODAY,
    )


def test_ranking_follows_source_priority_and_caps():
    cands = sg.build_candidates(**_world())
    out = sg.finalize(cands, [])
    _assert_safe(out)
    assert 6 <= len(out) <= sg.DEFAULT_LIMIT
    order = [sg.SOURCES.index(s.source) for s in out if s.source != "upcoming_earnings"]
    assert out[0].source == "portfolio" and out[0].symbol == "AAPL"
    assert order == sorted(order), [(s.source, s.symbol) for s in out]
    srcs = {s.source for s in out}
    assert {"portfolio", "watchlist", "near_52w_high", "near_52w_low", "top_mover", "upcoming_earnings"} <= srcs
    per_symbol = {}
    for s in out:
        per_symbol[s.symbol] = per_symbol.get(s.symbol, 0) + 1
        assert s.reason and s.current_price is not None
    assert max(per_symbol.values()) <= sg.PER_SYMBOL
    ids = [s.id for s in out]
    assert len(ids) == len(set(ids))
    # watchlist duplicates of a held symbol are folded into the portfolio source
    assert not any(s.symbol == "AAPL" and s.source == "watchlist" for s in out)


def test_dedupes_against_existing_alerts():
    cands = sg.build_candidates(**_world())
    first = sg.finalize(cands, [])
    top = first[0]
    existing = [{"symbol": top.symbol, "condition": top.condition, "status": "active"}]
    again = sg.finalize(cands, existing)
    assert all((s.symbol, s.condition) != (top.symbol, top.condition) for s in again)
    # a triggered (finished) alert does not block a fresh suggestion
    done = [{"symbol": top.symbol, "condition": top.condition, "status": "triggered"}]
    assert any(s.id == top.id for s in sg.finalize(cands, done))


def test_finalize_drops_immediate_triggers_and_dupes():
    a = Suggestion("X", "price_above", 99.0, "r", "watchlist", "l", 100.0, 0.0, score=99)
    b = Suggestion("Y", "price_above", 110.0, "r", "watchlist", "l", 100.0, 0.0, score=50)
    c = Suggestion("Y", "price_above", 120.0, "r", "near_52w_high", "l", 100.0, 0.0, score=70)
    out = sg.finalize([a, b, c], [])
    assert [s.id for s in out] == ["Y:price_above:120"]


def test_cache_roundtrip():
    cands = sg.build_candidates(**_world())
    back = sg.from_cache(sg.to_cache(cands))
    assert [s.id for s in back] == [s.id for s in cands]
    assert back[0].as_dict()["condition_label"]


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    from app.api import alerts as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.portfolio import Portfolio, Position
    from app.models.price import PriceBar
    from app.models.price_alert import PriceAlert
    from app.models.symbol import Symbol
    from app.models.user import User
    from app.models.watchlist import Watchlist

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, PriceAlert.__table__, PriceBar.__table__,
        Portfolio.__table__, Position.__table__, Watchlist.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        Symbol(id=1, symbol="AAPL", name="Apple Inc."),
        Symbol(id=2, symbol="NVDA", name="NVIDIA"),
    ])
    s.flush()
    s.add(Portfolio(id=1, user_id=1, name="Main"))
    s.flush()
    s.add(Position(portfolio_id=1, symbol_id=1, quantity=10, avg_cost_basis=185.0))
    now = datetime.now(timezone.utc)
    for i in range(30):
        s.add(PriceBar(symbol_id=1, timestamp=now - timedelta(days=30 - i), open=198, high=203 + (i == 25) * 5,
                       low=196, close=200, volume=1000))
    s.commit()
    s.close()

    rows = [{"symbol": "NVDA", "name": "NVIDIA", "price": 106.0, "change_percent": 6.0, "market_cap": 3e12}]
    monkeypatch.setattr(api, "_market_inputs", lambda db, today: {"today": today, "rows": rows, "stats": {}, "earnings": {}})
    monkeypatch.setattr(api, "_load_quotes", lambda db, syms: {"AAPL": {"price": 200.0, "change_percent": 0.5}})
    monkeypatch.setattr(api, "_user_earnings", lambda syms, today, known: {})
    store = {}

    async def cget(key):
        return store.get(key)

    async def cset(key, value, ttl):
        store[key] = value

    monkeypatch.setattr(api, "_cache_get", cget)
    monkeypatch.setattr(api, "_cache_set", cset)

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
    c.hdr = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.store = store
    return c


def test_api_personalized_then_excludes_added_alert(client):
    r = client.get("/api/v1/alerts/suggestions", headers=client.hdr)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["signed_in"] and body["personalized"]
    sugs = body["suggestions"]
    assert sugs[0]["source"] == "portfolio" and sugs[0]["symbol"] == "AAPL"
    for s in sugs:
        assert {"id", "symbol", "condition", "threshold", "reason", "source", "current_price"} <= set(s)
    stop = next(s for s in sugs if s["label"] == "Stop-loss")
    assert stop["threshold"] < 200

    created = client.post("/api/v1/alerts", headers=client.hdr, json={
        "symbol": "AAPL", "condition": stop["condition"], "threshold": stop["threshold"], "note": stop["note"],
    })
    assert created.status_code == 201, created.text
    again = client.get("/api/v1/alerts/suggestions", headers=client.hdr).json()["suggestions"]
    assert not any(s["symbol"] == "AAPL" and s["condition"] == "price_below" for s in again)


def test_api_anonymous_gets_market_only(client):
    r = client.get("/api/v1/alerts/suggestions")
    assert r.status_code == 200
    body = r.json()
    assert not body["signed_in"]
    assert body["suggestions"] and all(s["source"] not in ("portfolio", "watchlist") for s in body["suggestions"])
