"""Portfolios API: tracked holdings, cost basis/P&L, simulated paper trading, CSV export."""
import ast
import csv
import io
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services.portfolio_ledger import LedgerError, LedgerTxn, Quote, replay, summarize

QUOTES = {
    "AAPL": {"price": 200.0, "change_percent": 1.0, "previous_close": 198.0, "data_source": "test"},
    "MSFT": {"price": 400.0, "change_percent": -0.5, "previous_close": 402.0, "data_source": "test"},
}


@pytest.fixture
def client(monkeypatch):
    from app.api import portfolios as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.portfolio import Portfolio, PortfolioSnapshot, Position, Transaction
    from app.models.symbol import Symbol
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, Portfolio.__table__, Position.__table__,
        Transaction.__table__, PortfolioSnapshot.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        User(id=2, email="b@example.com", username="b", is_verified=True),
        Symbol(id=1, symbol="AAPL", name="Apple Inc.", sector="Technology"),
        Symbol(id=2, symbol="MSFT", name="Microsoft", sector="Technology"),
        Symbol(id=3, symbol="XOM", name="Exxon", sector="Energy"),
    ])
    s.commit()
    s.close()

    # Exercise the real sync->async bridge in _load_quotes with a fake provider.
    async def fake_fetch(db, symbols):
        return {sym: dict(QUOTES[sym]) for sym in symbols if sym in QUOTES}

    monkeypatch.setattr(api, "fetch_quotes", fake_fetch)

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
    c.b = {"Authorization": f"Bearer {create_access_token(2)}"}
    return c


def _mk(client, kind="tracked", **kw):
    r = client.post("/api/v1/portfolios", json={"name": f"My {kind}", "kind": kind, **kw}, headers=client.a)
    assert r.status_code == 201, r.text
    return r.json()


def _txn(client, pid, **body):
    body.setdefault("trade_date", "2026-01-05")
    return client.post(f"/api/v1/portfolios/{pid}/transactions", json=body, headers=client.a)


# ── ledger math ──────────────────────────────────────────────────────────────

def _t(i, typ, qty, price, day, fees=0.0, sym="AAPL", amount=0.0):
    return LedgerTxn(id=i, symbol=sym, type=typ, quantity=qty, price=price, fees=fees,
                     date=datetime(2026, 1, day, tzinfo=timezone.utc), amount=amount)


def test_ledger_average_cost_and_realized_pnl():
    st = replay([
        _t(1, "BUY", 10, 100, 1, fees=5),   # cost 1005
        _t(2, "BUY", 10, 120, 2),           # cost 2205 for 20 -> avg 110.25
        _t(3, "SELL", 5, 130, 3, fees=1),   # proceeds 649, cost out 551.25 -> +97.75
        _t(4, "DIVIDEND", 0, 0, 4, amount=12.5),
    ])
    lot = st.lots["AAPL"]
    assert lot.quantity == pytest.approx(15)
    assert lot.avg_cost == pytest.approx(110.25)
    assert st.realized_pnl == pytest.approx(97.75)
    assert st.sell_pnl[3] == pytest.approx(97.75)
    assert st.dividends == pytest.approx(12.5)


def test_ledger_rejects_oversell_and_overspend():
    with pytest.raises(LedgerError, match="only 0"):
        replay([_t(1, "SELL", 1, 10, 1)])
    # order matters: the sell predates the buy
    with pytest.raises(LedgerError):
        replay([_t(1, "BUY", 5, 10, 5), _t(2, "SELL", 5, 10, 1)])
    with pytest.raises(LedgerError, match="buying power"):
        replay([_t(1, "BUY", 11, 100, 1)], starting_cash=1000, enforce_cash=True)


def test_summary_never_invents_a_price():
    st = replay([_t(1, "BUY", 2, 50, 1), _t(2, "BUY", 1, 10, 1, sym="XOM")])
    s = summarize(st, {"AAPL": Quote(price=60.0, previous_close=55.0)}, kind="tracked", starting_cash=0)
    xom = next(h for h in s["holdings"] if h["symbol"] == "XOM")
    assert xom["price"] is None and xom["market_value"] is None
    assert s["stale_quotes"] == ["XOM"]
    assert s["market_value"] == 120.0 and s["unrealized_pnl"] == 20.0
    assert s["day_change"] == 10.0


# ── auth + ownership ─────────────────────────────────────────────────────────

def test_requires_auth(client):
    assert client.get("/api/v1/portfolios").status_code == 401
    assert client.post("/api/v1/portfolios", json={"name": "x"}).status_code == 401


def test_other_users_portfolio_is_404(client):
    p = _mk(client)
    assert client.get(f"/api/v1/portfolios/{p['id']}", headers=client.b).status_code == 404
    assert client.delete(f"/api/v1/portfolios/{p['id']}", headers=client.b).status_code == 404
    assert _txn(client, p["id"], symbol="AAPL", type="BUY", quantity=1, price=1).status_code == 201
    r = client.get(f"/api/v1/portfolios/{p['id']}/export", headers=client.b)
    assert r.status_code == 404
    assert client.get("/api/v1/portfolios", headers=client.b).json()["portfolios"] == []


def test_portfolio_limit(client):
    from app.api.portfolios import MAX_PORTFOLIOS_PER_USER
    for i in range(MAX_PORTFOLIOS_PER_USER):
        _mk(client)
    assert client.post("/api/v1/portfolios", json={"name": "one more"}, headers=client.a).status_code == 409


# ── tracked portfolios ───────────────────────────────────────────────────────

def test_tracked_holdings_pnl_and_allocation(client):
    pid = _mk(client)["id"]
    assert _txn(client, pid, symbol="aapl", type="BUY", quantity=10, price=150, fees=1).status_code == 201
    assert _txn(client, pid, symbol="MSFT", type="BUY", quantity=5, price=300).status_code == 201
    r = _txn(client, pid, symbol="AAPL", type="SELL", quantity=4, price=180, trade_date="2026-02-01")
    assert r.status_code == 201 and r.json()["realized_pnl"] == pytest.approx(4 * 180 - 4 * 150.1)
    assert _txn(client, pid, symbol="AAPL", type="DIVIDEND", amount=3.0).status_code == 201

    s = client.get(f"/api/v1/portfolios/{pid}", headers=client.a).json()
    assert s["simulated"] is False and s["cash"] is None
    aapl = next(h for h in s["holdings"] if h["symbol"] == "AAPL")
    assert aapl["quantity"] == 6
    assert aapl["avg_cost"] == pytest.approx(150.1)
    assert aapl["market_value"] == 1200.0
    assert s["market_value"] == 1200.0 + 2000.0
    assert s["realized_pnl"] == pytest.approx(119.6)
    assert s["dividends"] == 3.0
    assert sum(h["weight"] for h in s["holdings"]) == pytest.approx(100.0, abs=0.05)
    assert s["allocation"] == [{"label": "Technology", "value": 3200.0, "weight": 100.0}]
    assert s["day_change"] == pytest.approx(6 * 2.0 + 5 * -2.0)

    listing = client.get("/api/v1/portfolios", headers=client.a).json()["portfolios"]
    assert listing[0]["holding_count"] == 2 and "holdings" not in listing[0]


def test_tracked_rejects_impossible_trades(client):
    pid = _mk(client)["id"]
    r = _txn(client, pid, symbol="AAPL", type="SELL", quantity=1, price=100)
    assert r.status_code == 400 and "only 0" in r.json()["detail"]
    tomorrow2 = (date.today() + timedelta(days=3)).isoformat()
    assert _txn(client, pid, symbol="AAPL", type="BUY", quantity=1, price=1, trade_date=tomorrow2).status_code == 422
    assert _txn(client, pid, symbol="AAPL", type="BUY", quantity=0, price=1).status_code == 422
    assert _txn(client, pid, symbol="ZZZZ", type="BUY", quantity=1, price=1).status_code == 404
    assert _txn(client, pid, symbol="bad sym!", type="BUY", quantity=1, price=1).status_code == 400
    # orders are paper-only
    r = client.post(f"/api/v1/portfolios/{pid}/orders", json={"symbol": "AAPL", "side": "BUY", "quantity": 1},
                    headers=client.a)
    assert r.status_code == 400


def test_delete_transaction_keeps_ledger_consistent(client):
    pid = _mk(client)["id"]
    buy = _txn(client, pid, symbol="AAPL", type="BUY", quantity=5, price=100).json()
    _txn(client, pid, symbol="AAPL", type="SELL", quantity=5, price=110, trade_date="2026-01-06")
    r = client.delete(f"/api/v1/portfolios/{pid}/transactions/{buy['id']}", headers=client.a)
    assert r.status_code == 409
    txns = client.get(f"/api/v1/portfolios/{pid}/transactions", headers=client.a).json()["transactions"]
    assert len(txns) == 2
    sell = next(t for t in txns if t["type"] == "SELL")
    assert client.delete(f"/api/v1/portfolios/{pid}/transactions/{sell['id']}", headers=client.a).status_code == 204
    s = client.get(f"/api/v1/portfolios/{pid}", headers=client.a).json()
    assert s["holdings"][0]["quantity"] == 5 and s["realized_pnl"] == 0


# ── paper trading (simulated) ────────────────────────────────────────────────

def _order(client, pid, **body):
    return client.post(f"/api/v1/portfolios/{pid}/orders", json=body, headers=client.a)


def test_paper_order_fills_at_server_price_and_is_marked_simulated(client):
    p = _mk(client, kind="paper")
    assert p["simulated"] is True and p["cash"] == 100_000.0
    # a client-supplied price is ignored: fills at the quote (200)
    r = _order(client, p["id"], symbol="AAPL", side="BUY", quantity=10, price=1.0)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["simulated"] is True and "No real order" in body["notice"]
    assert body["order"]["fill_price"] == 200.0 and body["order"]["status"] == "filled"
    assert body["cash"] == 98_000.0

    r = _order(client, p["id"], symbol="AAPL", side="SELL", quantity=4)
    assert r.status_code == 201 and r.json()["cash"] == 98_800.0
    s = client.get(f"/api/v1/portfolios/{p['id']}", headers=client.a).json()
    assert s["holdings"][0]["quantity"] == 6
    assert s["total_value"] == pytest.approx(98_800 + 1200)
    assert s["total_return_percent"] == 0.0
    assert any(a["label"] == "Cash" for a in s["allocation"])


def test_paper_cash_and_share_limits(client):
    p = _mk(client, kind="paper", starting_cash=1000)
    r = _order(client, p["id"], symbol="MSFT", side="BUY", quantity=3)  # $1,200 > $1,000
    assert r.status_code == 400 and "buying power" in r.json()["detail"]
    assert _order(client, p["id"], symbol="AAPL", side="SELL", quantity=1).status_code == 400
    assert _order(client, p["id"], symbol="AAPL", side="BUY", quantity=-1).status_code == 422
    # no quote -> refuse, never fill at a guessed price
    assert _order(client, p["id"], symbol="XOM", side="BUY", quantity=1).status_code == 503
    # manual ledger entries / deletes are not allowed on paper accounts
    assert _txn(client, p["id"], symbol="AAPL", type="BUY", quantity=1, price=1).status_code == 400


def test_paper_reset_restores_cash(client):
    p = _mk(client, kind="paper", starting_cash=50_000)
    _order(client, p["id"], symbol="AAPL", side="BUY", quantity=10)
    r = client.post(f"/api/v1/portfolios/{p['id']}/reset", headers=client.a)
    assert r.status_code == 200 and r.json()["cash"] == 50_000.0 and r.json()["holdings"] == []
    tracked = _mk(client)
    assert client.post(f"/api/v1/portfolios/{tracked['id']}/reset", headers=client.a).status_code == 400


# ── export ───────────────────────────────────────────────────────────────────

def test_csv_export_and_formula_injection_guard(client):
    pid = _mk(client)["id"]
    _txn(client, pid, symbol="AAPL", type="BUY", quantity=2, price=100, notes="=HYPERLINK(\"x\")")
    r = client.get(f"/api/v1/portfolios/{pid}/export?type=transactions", headers=client.a)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0][:3] == ["date", "symbol", "type"]
    assert rows[1][1] == "AAPL" and rows[1][-1].startswith("'=")

    r = client.get(f"/api/v1/portfolios/{pid}/export?type=holdings", headers=client.a)
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[1][0] == "AAPL" and float(rows[1][7]) == 400.0


# ── paper trading can never reach a broker ───────────────────────────────────

BROKER_MODULES = ("alpaca", "robinhood", "public_client", "broker", "connect")


@pytest.mark.parametrize("rel", [
    "app/api/portfolios.py",
    "app/services/portfolio_ledger.py",
    "app/services/portfolio_pricing.py",
])
def test_portfolio_modules_import_no_brokerage_client(rel):
    src = (Path(__file__).resolve().parents[1] / rel).read_text()
    names = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names.append(node.module or "")
    bad = [n for n in names if any(b in n.lower() for b in BROKER_MODULES)]
    assert bad == [], f"{rel} imports brokerage code: {bad}"
