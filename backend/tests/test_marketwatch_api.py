"""Marketwatch API: multiple named watchlists, classic-watchlist mirror, Holdings list."""
import ast
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

QUOTES = {
    "AAPL": {"price": 200.0, "change_percent": 1.0, "previous_close": 198.0, "data_source": "test"},
    "MSFT": {"price": 400.0, "change_percent": -0.5, "previous_close": 402.0, "data_source": "test"},
}


@pytest.fixture
def client(monkeypatch):
    from app.api import marketwatch as mw_api
    from app.api import portfolios as p_api
    from app.api import watchlist as wl_api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.marketwatch import MarketwatchItem, MarketwatchList
    from app.models.portfolio import Portfolio, PortfolioSnapshot, Position, Transaction
    from app.models.symbol import Symbol
    from app.models.user import User
    from app.models.watchlist import Watchlist
    from app.models.price import PriceBar

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, Watchlist.__table__, MarketwatchList.__table__,
        MarketwatchItem.__table__, Portfolio.__table__, Position.__table__, Transaction.__table__,
        PortfolioSnapshot.__table__, PriceBar.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        User(id=2, email="b@example.com", username="b", is_verified=True),
        Symbol(id=1, symbol="AAPL", name="Apple Inc.", exchange="NASDAQ", sector="Technology"),
        Symbol(id=2, symbol="MSFT", name="Microsoft", exchange="NASDAQ", sector="Technology"),
        Symbol(id=3, symbol="XOM", name="Exxon", exchange="NYSE", sector="Energy"),
    ])
    s.commit()
    s.close()

    async def fake_fetch(db, symbols):
        return {sym: dict(QUOTES[sym]) for sym in symbols if sym in QUOTES}

    monkeypatch.setattr(p_api, "fetch_quotes", fake_fetch)

    app = FastAPI()
    app.include_router(mw_api.router, prefix="/api/v1")
    app.include_router(p_api.router, prefix="/api/v1")
    app.include_router(wl_api.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    c.a = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.b = {"Authorization": f"Bearer {create_access_token(2)}"}
    return c


def _get(c, h=None):
    r = c.get("/api/v1/marketwatch", headers=h or c.a)
    assert r.status_code == 200, r.text
    return r.json()


def _syms(lst):
    return [i["symbol"] for i in lst["items"]]


def test_requires_auth(client):
    assert client.get("/api/v1/marketwatch").status_code == 401
    assert client.get("/api/v1/marketwatch/holdings").status_code == 401


def test_default_list_seeded_from_classic_watchlist(client):
    for sym in ("AAPL", "MSFT"):
        assert client.post("/api/v1/watchlist", json={"symbol": sym}, headers=client.a).status_code == 201
    body = _get(client)
    assert len(body["lists"]) == 1
    d = body["lists"][0]
    assert d["is_default"] and d["name"] == "Watchlist 1"
    assert set(_syms(d)) == {"AAPL", "MSFT"}
    assert d["items"][0]["name"] in ("Apple Inc.", "Microsoft")
    # second read does not duplicate
    assert len(_get(client)["lists"][0]["items"]) == 2


def test_classic_add_and_remove_mirror_into_default_list(client):
    d = _get(client)["lists"][0]
    assert d["items"] == []
    client.post("/api/v1/watchlist", json={"symbol": "XOM"}, headers=client.a)
    assert _syms(_get(client)["lists"][0]) == ["XOM"]
    assert client.delete("/api/v1/watchlist/XOM", headers=client.a).status_code == 204
    assert _syms(_get(client)["lists"][0]) == []


def test_default_list_writes_back_to_classic_watchlist(client):
    d = _get(client)["lists"][0]
    r = client.post(f"/api/v1/marketwatch/lists/{d['id']}/items", json={"symbol": "aapl"}, headers=client.a)
    assert r.status_code == 201, r.text
    assert r.json()["symbol"] == "AAPL"
    assert [i["symbol"] for i in client.get("/api/v1/watchlist", headers=client.a).json()] == ["AAPL"]
    assert client.delete(f"/api/v1/marketwatch/lists/{d['id']}/items/AAPL", headers=client.a).status_code == 204
    assert client.get("/api/v1/watchlist", headers=client.a).json() == []


def test_named_lists_are_independent_and_allow_same_symbol(client):
    default_id = _get(client)["lists"][0]["id"]
    r = client.post("/api/v1/marketwatch/lists", json={"name": "  Tech   names "}, headers=client.a)
    assert r.status_code == 201
    tech = r.json()
    assert tech["name"] == "Tech names" and not tech["is_default"]
    for lid in (default_id, tech["id"]):
        assert client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": "MSFT"}, headers=client.a).status_code == 201
    dup = client.post(f"/api/v1/marketwatch/lists/{tech['id']}/items", json={"symbol": "MSFT"}, headers=client.a)
    assert dup.status_code == 409
    # a non-default list never touches the classic watchlist
    client.delete(f"/api/v1/marketwatch/lists/{tech['id']}/items/MSFT", headers=client.a)
    assert [i["symbol"] for i in client.get("/api/v1/watchlist", headers=client.a).json()] == ["MSFT"]
    # duplicate list name (case-insensitive)
    assert client.post("/api/v1/marketwatch/lists", json={"name": "tech NAMES"}, headers=client.a).status_code == 409


def test_unknown_and_invalid_symbols(client):
    lid = _get(client)["lists"][0]["id"]
    assert client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": "ZZZZ"}, headers=client.a).status_code == 404
    assert client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": "BAD SYM"}, headers=client.a).status_code == 400
    assert client.delete(f"/api/v1/marketwatch/lists/{lid}/items/AAPL", headers=client.a).status_code == 404


def test_reorder_items_and_lists(client):
    lid = _get(client)["lists"][0]["id"]
    for s in ("AAPL", "MSFT", "XOM"):
        client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": s}, headers=client.a)
    r = client.put(f"/api/v1/marketwatch/lists/{lid}/items/order", json={"symbols": ["xom", "AAPL", "MSFT"]}, headers=client.a)
    assert r.status_code == 200, r.text
    assert _syms(_get(client)["lists"][0]) == ["XOM", "AAPL", "MSFT"]
    # must be a full permutation
    bad = client.put(f"/api/v1/marketwatch/lists/{lid}/items/order", json={"symbols": ["XOM", "AAPL"]}, headers=client.a)
    assert bad.status_code == 400
    bad = client.put(f"/api/v1/marketwatch/lists/{lid}/items/order", json={"symbols": ["XOM", "XOM", "AAPL"]}, headers=client.a)
    assert bad.status_code == 400

    b = client.post("/api/v1/marketwatch/lists", json={"name": "B"}, headers=client.a).json()
    r = client.put("/api/v1/marketwatch/lists/order", json={"ids": [b["id"], lid]}, headers=client.a)
    assert r.status_code == 200
    assert [l["id"] for l in _get(client)["lists"]] == [b["id"], lid]
    assert client.put("/api/v1/marketwatch/lists/order", json={"ids": [lid]}, headers=client.a).status_code == 400


def test_rename_delete_and_default_protection(client):
    lid = _get(client)["lists"][0]["id"]
    other = client.post("/api/v1/marketwatch/lists", json={"name": "Energy"}, headers=client.a).json()
    assert client.patch(f"/api/v1/marketwatch/lists/{lid}", json={"name": "Core"}, headers=client.a).json()["name"] == "Core"
    assert client.patch(f"/api/v1/marketwatch/lists/{other['id']}", json={"name": "Core"}, headers=client.a).status_code == 409
    assert client.delete(f"/api/v1/marketwatch/lists/{lid}", headers=client.a).status_code == 400
    client.post(f"/api/v1/marketwatch/lists/{other['id']}/items", json={"symbol": "XOM"}, headers=client.a)
    assert client.delete(f"/api/v1/marketwatch/lists/{other['id']}", headers=client.a).status_code == 204
    assert [l["name"] for l in _get(client)["lists"]] == ["Core"]


def test_list_limit(client, monkeypatch):
    from app.services import marketwatch as mw
    monkeypatch.setattr(mw, "MAX_LISTS_PER_USER", 2)
    _get(client)
    assert client.post("/api/v1/marketwatch/lists", json={"name": "Two"}, headers=client.a).status_code == 201
    assert client.post("/api/v1/marketwatch/lists", json={"name": "Three"}, headers=client.a).status_code == 409


def test_item_limit(client, monkeypatch):
    from app.services import marketwatch as mw
    monkeypatch.setattr(mw, "MAX_ITEMS_PER_LIST", 1)
    lid = _get(client)["lists"][0]["id"]
    assert client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": "AAPL"}, headers=client.a).status_code == 201
    assert client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": "MSFT"}, headers=client.a).status_code == 409


def test_other_users_lists_are_404(client):
    lid = _get(client)["lists"][0]["id"]
    assert client.post(f"/api/v1/marketwatch/lists/{lid}/items", json={"symbol": "AAPL"}, headers=client.b).status_code == 404
    assert client.patch(f"/api/v1/marketwatch/lists/{lid}", json={"name": "x"}, headers=client.b).status_code == 404
    assert client.delete(f"/api/v1/marketwatch/lists/{lid}", headers=client.b).status_code == 404
    assert [l["id"] for l in _get(client, client.b)["lists"]] != [lid]


def test_holdings_match_portfolio_summary(client):
    pid = client.post("/api/v1/portfolios", json={"name": "Brokerage", "kind": "tracked"}, headers=client.a).json()["id"]
    for body in (
        {"symbol": "AAPL", "type": "BUY", "quantity": 10, "price": 150, "trade_date": "2026-01-05"},
        {"symbol": "XOM", "type": "BUY", "quantity": 2, "price": 100, "trade_date": "2026-01-05"},
    ):
        assert client.post(f"/api/v1/portfolios/{pid}/transactions", json=body, headers=client.a).status_code == 201
    r = client.get("/api/v1/marketwatch/holdings", headers=client.a)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = {h["symbol"]: h for h in body["holdings"]}
    aapl = rows["AAPL"]
    assert aapl["quantity"] == 10 and aapl["avg_cost"] == 150
    assert aapl["price"] == 200 and aapl["market_value"] == 2000
    assert aapl["unrealized_pnl"] == 500 and aapl["portfolio_name"] == "Brokerage"
    # XOM has no quote: never valued at a made-up price
    assert rows["XOM"]["price"] is None and rows["XOM"]["market_value"] is None
    assert body["stale_quotes"] == ["XOM"]
    # identical numbers to the Portfolio page
    summary = client.get(f"/api/v1/portfolios/{pid}", headers=client.a).json()
    ph = next(h for h in summary["holdings"] if h["symbol"] == "AAPL")
    for k in ("quantity", "avg_cost", "price", "market_value", "unrealized_pnl", "unrealized_pnl_percent", "day_change"):
        assert aapl[k] == ph[k], k
    assert body["portfolios"][0]["unrealized_pnl"] == summary["unrealized_pnl"]
    # another user sees nothing
    assert client.get("/api/v1/marketwatch/holdings", headers=client.b).json()["holdings"] == []


def test_marketwatch_module_never_touches_orders():
    """No order placement: the module must not call the paper-order route or a broker."""
    src = (Path(__file__).resolve().parent.parent / "app" / "api" / "marketwatch.py").read_text()
    tree = ast.parse(src)
    names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} | {
        n.id for n in ast.walk(tree) if isinstance(n, ast.Name)
    }
    assert "place_paper_order" not in names
    for mod in ("alpaca", "kiteconnect", "broker"):
        assert f"import {mod}" not in src and f"from {mod}" not in src


def test_rename_clash_is_case_insensitive(client):
    _get(client)
    other = client.post("/api/v1/marketwatch/lists", json={"name": "Energy"}, headers=client.a).json()
    assert client.patch(f"/api/v1/marketwatch/lists/{other['id']}", json={"name": "watchlist 1"}, headers=client.a).status_code == 409
    # renaming a list to a new casing of its own name is fine
    assert client.patch(f"/api/v1/marketwatch/lists/{other['id']}", json={"name": "ENERGY"}, headers=client.a).status_code == 200


def test_sparklines_from_stored_bars(client):
    from datetime import datetime, timedelta, timezone
    from app.db.database import get_db
    from app.models.price import PriceBar

    gen = client.app.dependency_overrides[get_db]()
    db = next(gen)
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(40):
        c = 100.0 + i
        db.add(PriceBar(symbol_id=1, timestamp=t0 + timedelta(days=i), open=c, high=c, low=c, close=c, volume=1))
    db.add(PriceBar(symbol_id=2, timestamp=t0, open=1, high=1, low=1, close=1, volume=1))  # one bar only
    db.commit()
    db.close()

    assert client.get("/api/v1/marketwatch/sparklines?symbols=AAPL", headers={}).status_code == 401
    r = client.get("/api/v1/marketwatch/sparklines?symbols=aapl,MSFT,ZZZZ,bad sym", headers=client.a)
    assert r.status_code == 200, r.text
    sp = r.json()["sparklines"]
    assert sp["AAPL"] == [100.0 + i for i in range(10, 40)]  # last 30, oldest first
    assert sp["MSFT"] == [] and sp["ZZZZ"] == []
    assert "BAD SYM" not in sp
    many = ",".join(f"S{i}" for i in range(51))
    assert client.get(f"/api/v1/marketwatch/sparklines?symbols={many}", headers=client.a).status_code == 400
