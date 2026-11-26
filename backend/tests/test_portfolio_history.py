"""Portfolio performance history (snapshots, backfill, TWR, drawdown) and CSV trade import."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import portfolio_history as ph
from app.services.portfolio_import import ImportFormatError, parse_csv, parse_number
from app.services.portfolio_ledger import LedgerTxn

D0 = date(2026, 3, 2)  # a Monday


def _d(i):
    return D0 + timedelta(days=i)


def _t(i, typ, qty, price, day, sym="AAPL", fees=0.0, amount=0.0):
    return LedgerTxn(id=i, symbol=sym, type=typ, quantity=qty, price=price, fees=fees,
                     date=datetime.combine(_d(day), datetime.min.time(), tzinfo=timezone.utc).replace(hour=21),
                     amount=amount)


# ── pure math ────────────────────────────────────────────────────────────────

def test_twr_ignores_deposits():
    # Day 0 buy 10 @100 -> close 100. Day 1 close 110 (+10%). Day 2 buy 10 more @110
    # (a deposit), close 110 (0%). Day 3 close 99 (-10%). TWR = 1.1*1.0*0.9 - 1 = -1%.
    txns = [_t(1, "BUY", 10, 100, 0), _t(2, "BUY", 10, 110, 2)]
    closes = ph.Closes({"AAPL": {_d(0): 100, _d(1): 110, _d(2): 110, _d(3): 99}})
    s = ph.build_series(txns, closes, [_d(i) for i in range(4)], kind="tracked")
    assert [p.total_value for p in s] == [1000, 1100, 2200, 1980]
    assert [p.net_flow for p in s] == [1000, 0, 1100, 0]
    assert [p.cost_basis for p in s] == [1000, 1000, 2100, 2100]
    perf = ph.performance([p.total_value for p in s], [p.net_flow for p in s])
    assert perf["twr"] == pytest.approx(-0.01)
    # a simple value-based return would call the deposit a +98% gain
    assert perf["curve"] == pytest.approx([0.0, 0.1, 0.1, -0.01])
    assert perf["max_drawdown"] == pytest.approx(0.99 / 1.1 - 1)


def test_twr_first_day_fill_to_close_and_full_sell():
    # Buy @100, closes at 105 the same day: +5% on day 0. Sell everything at 110 next day.
    txns = [_t(1, "BUY", 10, 100, 0), _t(2, "SELL", 10, 110, 1)]
    closes = ph.Closes({"AAPL": {_d(0): 105, _d(1): 120}})
    s = ph.build_series(txns, closes, [_d(0), _d(1), _d(2)], kind="tracked")
    assert [p.total_value for p in s] == [1050, 0, 0]
    assert s[1].net_flow == pytest.approx(-1100)
    perf = ph.performance([p.total_value for p in s], [p.net_flow for p in s])
    # +5% then 1050 -> sold for 1100 (+4.76%); flat afterwards (no capital)
    assert perf["twr"] == pytest.approx(1.10 - 1)
    assert perf["max_drawdown"] == pytest.approx(0.0)


def test_dividend_counts_as_return_for_tracked():
    txns = [_t(1, "BUY", 10, 100, 0), _t(2, "DIVIDEND", 0, 0, 1, amount=20)]
    closes = ph.Closes({"AAPL": {_d(0): 100, _d(1): 100}})
    s = ph.build_series(txns, closes, [_d(0), _d(1)], kind="tracked")
    perf = ph.performance([p.total_value for p in s], [p.net_flow for p in s])
    assert perf["twr"] == pytest.approx(0.02)


def test_paper_series_includes_cash_and_has_no_flows():
    txns = [_t(1, "BUY", 10, 100, 1)]
    closes = ph.Closes({"AAPL": {_d(1): 100, _d(2): 90}})
    s = ph.build_series(txns, closes, [_d(0), _d(1), _d(2)], kind="paper", starting_cash=10_000)
    assert [p.total_value for p in s] == [10_000, 10_000, 9_900]
    assert [p.cash for p in s] == [10_000, 9_000, 9_000]
    assert all(p.net_flow == 0 for p in s)
    perf = ph.performance([p.total_value for p in s], [0, 0, 0], initial=10_000)
    assert perf["twr"] == pytest.approx(-0.01)
    assert perf["max_drawdown"] == pytest.approx(-0.01)


def test_missing_close_values_at_cost_and_is_flagged():
    txns = [_t(1, "BUY", 2, 50, 0, sym="XYZ")]
    s = ph.build_series(txns, ph.Closes({}), [_d(0), _d(1)], kind="tracked")
    assert s[0].total_value == 100 and s[0].missing == ["XYZ"]


def test_forward_fill_uses_last_close_on_or_before():
    c = ph.Closes({"AAPL": {_d(0): 10, _d(3): 13}})
    assert c.on_or_before("AAPL", _d(2)) == 10
    assert c.on_or_before("AAPL", _d(3)) == 13
    assert c.on_or_before("AAPL", _d(-1)) is None


def test_drawdown_recovers_peak():
    values = [100, 120, 90, 130, 104]
    perf = ph.performance(values, [100, 0, 0, 0, 0])
    assert perf["max_drawdown"] == pytest.approx(-0.25)
    assert perf["twr"] == pytest.approx(0.04)


def test_range_start():
    last = date(2026, 11, 20)
    assert ph.range_start("1M", date(2020, 1, 1), last) == date(2026, 10, 21)
    assert ph.range_start("YTD", date(2020, 1, 1), last) == date(2026, 1, 1)
    assert ph.range_start("1Y", date(2026, 6, 1), last) == date(2026, 6, 1)
    assert ph.range_start("ALL", date(2020, 1, 1), last) == date(2020, 1, 1)


def test_benchmark_curve_normalises_from_first_close():
    c = ph.Closes({"SPY": {_d(1): 400, _d(2): 420}})
    assert ph.benchmark_curve(c, [_d(0), _d(1), _d(2)]) == [None, 0.0, pytest.approx(0.05)]


# ── CSV parsing ──────────────────────────────────────────────────────────────

def test_parse_number_formats():
    assert parse_number("$1,234.50") == 1234.5
    assert parse_number("(12.00)") == -12.0
    assert parse_number("") is None
    with pytest.raises(ValueError):
        parse_number("abc")


def test_parse_csv_aliases_and_row_errors():
    text = (
        "Trade Date,Ticker,Action,Shares,Price,Commission,Notes\n"
        "01/05/2026,aapl,Bought,10,$150.00,1,first\n"
        "2026-01-06,MSFT,sold,-2,400,,\n"
        "2026-13-01,AAPL,BUY,1,1,,\n"
        "2026-01-07,AAPL,transfer,1,1,,\n"
        "2026-01-08,AAPL,BUY,0,1,,\n"
        "2099-01-01,AAPL,BUY,1,1,,\n"
        "2026-01-09,TOO$BAD,BUY,1,1,,\n"
        "\n"
    )
    rows = parse_csv(text, today=date(2026, 6, 1))
    assert len(rows) == 7
    a, b, bad_date, bad_type, zero, future, bad_sym = rows
    assert (a.row, a.date, a.symbol, a.type, a.quantity, a.price, a.fees, a.notes) == \
        (2, "2026-01-05", "AAPL", "BUY", 10, 150, 1, "first")
    assert b.type == "SELL" and b.quantity == 2 and b.ok
    assert any("date" in e for e in bad_date.errors)
    assert any("unknown type" in e for e in bad_type.errors)
    assert any("quantity" in e for e in zero.errors)
    assert any("future" in e for e in future.errors)
    assert any("invalid symbol" in e for e in bad_sym.errors)


def test_parse_csv_dividend_and_derived_price():
    rows = parse_csv("date,symbol,type,quantity,price,amount\n"
                     "2026-01-05,KO,DIVIDEND,,,12.40\n"
                     "2026-01-05,KO,BUY,4,,200\n", today=date(2026, 6, 1))
    assert rows[0].type == "DIVIDEND" and rows[0].amount == 12.4 and rows[0].ok
    assert rows[1].price == 50 and rows[1].warnings


def test_parse_csv_rejects_unusable_files():
    with pytest.raises(ImportFormatError, match="empty"):
        parse_csv("  ")
    with pytest.raises(ImportFormatError, match="header"):
        parse_csv("a,b,c\n1,2,3\n")
    with pytest.raises(ImportFormatError, match="Missing"):
        parse_csv("symbol,type,quantity\nAAPL,BUY,1\n")


# ── API (SQLite) ─────────────────────────────────────────────────────────────

@pytest.fixture
def env(monkeypatch):
    from app.api import portfolios as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.portfolio import Portfolio, PortfolioSnapshot, Position, Transaction
    from app.models.price import PriceBar
    from app.models.symbol import Symbol
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, Portfolio.__table__, Position.__table__,
        Transaction.__table__, PortfolioSnapshot.__table__, PriceBar.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        User(id=2, email="b@example.com", username="b", is_verified=True),
        Symbol(id=1, symbol="AAPL", name="Apple Inc.", sector="Technology"),
        Symbol(id=2, symbol="SPY", name="SPDR S&P 500", sector="ETF"),
        Symbol(id=3, symbol="MSFT", name="Microsoft", sector="Technology"),
    ])
    # 10 weekdays of closes from D0: AAPL 100,101,...; SPY 400 -> +0.5%/day
    day, n = D0, 0
    while n < 10:
        if day.weekday() < 5:
            ts = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).replace(hour=5)
            s.add(PriceBar(symbol_id=1, timestamp=ts, open=1, high=1, low=1, close=100 + n, volume=1))
            s.add(PriceBar(symbol_id=2, timestamp=ts, open=1, high=1, low=1, close=400 * (1.005 ** n), volume=1))
            n += 1
        day += timedelta(days=1)
    s.commit()
    s.close()

    async def fake_fetch(db, symbols):
        return {sym: {"price": 150.0, "previous_close": 149.0} for sym in symbols if sym in ("AAPL", "MSFT")}

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
    c.SL = SL
    c.eng = eng
    return c


def _mk(c, kind="tracked", **kw):
    r = c.post("/api/v1/portfolios", json={"name": kind, "kind": kind, **kw}, headers=c.a)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_history_backfills_from_ledger_and_closes(env):
    pid = _mk(env)
    r = env.post(f"/api/v1/portfolios/{pid}/transactions", headers=env.a, json={
        "symbol": "AAPL", "type": "BUY", "quantity": 10, "price": 100, "trade_date": D0.isoformat()})
    assert r.status_code == 201, r.text
    end = D0 + timedelta(days=13)  # 10 weekdays later
    with env.SL() as db:
        from app.models.portfolio import Portfolio
        p = db.get(Portfolio, pid)
        h = ph.history(db, p, "ALL", today=end)
    assert h["rebuilt"] is True
    pts = h["points"]
    assert len(pts) == 10
    assert pts[0]["value"] == 1000 and pts[-1]["value"] == 1090
    assert pts[0]["cost_basis"] == 1000
    assert h["stats"]["twr_percent"] == pytest.approx(9.0, abs=1e-6)
    assert h["stats"]["max_drawdown_percent"] == pytest.approx(0.0)
    assert h["stats"]["benchmark_return_percent"] == pytest.approx((1.005 ** 9 - 1) * 100, abs=1e-3)
    assert h["benchmark_available"] is True
    assert h["simulated"] is False
    # snapshots were stored as a backfill
    with env.SL() as db:
        from app.models.portfolio import PortfolioSnapshot
        rows = db.query(PortfolioSnapshot).filter_by(portfolio_id=pid).all()
        assert len(rows) == 10 and {r.source for r in rows} == {"backfill"}
        # second read uses the stored rows
        h2 = ph.history(db, db.get(Portfolio, pid), "ALL", today=end)
        assert h2["rebuilt"] is False and h2["stats"] == h["stats"]


def test_trades_before_stored_closes_roll_into_a_carry_in(env):
    """A buy months before the first stored close must not show as a one-day gain."""
    pid = _mk(env)
    early = D0 - timedelta(days=120)
    r = env.post(f"/api/v1/portfolios/{pid}/transactions", headers=env.a, json={
        "symbol": "AAPL", "type": "BUY", "quantity": 10, "price": 50, "trade_date": early.isoformat()})
    assert r.status_code == 201
    end = D0 + timedelta(days=13)
    from app.models.portfolio import Portfolio
    with env.SL() as db:
        h = ph.history(db, db.get(Portfolio, pid), "ALL", today=end)
        assert h["history_start"] == early.isoformat()
        assert h["coverage_start"] == D0.isoformat()
        assert h["points"][0]["date"] == D0.isoformat()
        assert h["points"][0]["value"] == 1000  # 10 x first stored close (100), not cost
        # +9% from the first stored close, not +118% from the 50 fill
        assert h["stats"]["twr_percent"] == pytest.approx(9.0, abs=1e-6)
        again = ph.history(db, db.get(Portfolio, pid), "ALL", today=end)
        assert again["rebuilt"] is False


def test_ledger_write_invalidates_later_snapshots(env):
    pid = _mk(env)
    env.post(f"/api/v1/portfolios/{pid}/transactions", headers=env.a, json={
        "symbol": "AAPL", "type": "BUY", "quantity": 10, "price": 100, "trade_date": D0.isoformat()})
    from app.models.portfolio import Portfolio, PortfolioSnapshot
    end = D0 + timedelta(days=13)
    with env.SL() as db:
        ph.history(db, db.get(Portfolio, pid), "ALL", today=end)
    sell_day = D0 + timedelta(days=7)
    r = env.post(f"/api/v1/portfolios/{pid}/transactions", headers=env.a, json={
        "symbol": "AAPL", "type": "SELL", "quantity": 5, "price": 105, "trade_date": sell_day.isoformat()})
    assert r.status_code == 201
    with env.SL() as db:
        left = db.query(PortfolioSnapshot).filter_by(portfolio_id=pid).count()
        assert 0 < left < 10
        h = ph.history(db, db.get(Portfolio, pid), "ALL", today=end)
        assert h["rebuilt"] is True
        assert h["points"][-1]["value"] == pytest.approx(5 * 109)


def test_history_route_and_ownership(env):
    pid = _mk(env)
    r = env.get(f"/api/v1/portfolios/{pid}/history?range=1M", headers=env.a)
    assert r.status_code == 200 and r.json()["points"] == []
    assert env.get(f"/api/v1/portfolios/{pid}/history", headers=env.b).status_code == 404
    assert env.get(f"/api/v1/portfolios/{pid}/history?range=5Y", headers=env.a).status_code == 422
    assert env.post(f"/api/v1/portfolios/{pid}/history/backfill", headers=env.a).json()["days"] == 0


def test_paper_history_labelled_simulated(env):
    pid = _mk(env, kind="paper", starting_cash=10_000)
    r = env.get(f"/api/v1/portfolios/{pid}/history?range=ALL", headers=env.a)
    body = r.json()
    assert body["simulated"] is True and body["kind"] == "paper"
    assert body["points"] and body["points"][0]["cash"] == 10_000


def test_daily_snapshot_job(env):
    pid = _mk(env)
    env.post(f"/api/v1/portfolios/{pid}/transactions", headers=env.a, json={
        "symbol": "AAPL", "type": "BUY", "quantity": 10, "price": 100, "trade_date": D0.isoformat()})
    paper = _mk(env, kind="paper", starting_cash=5_000)
    today = D0 + timedelta(days=14)
    from app.models.portfolio import PortfolioSnapshot
    with env.SL() as db:
        res = ph.run_daily_snapshots(db, lambda syms: {"AAPL": {"price": 150.0}}, today=today)
        assert res == {"portfolios": 2, "written": 2, "failed": 0}
        row = db.query(PortfolioSnapshot).filter_by(portfolio_id=pid, source="job").one()
        assert row.total_value == 1500 and row.cost_basis == 1000 and row.net_flow == 0
        # previous day came from the backfill, so the daily return is relative to the last close (109)
        assert row.daily_return_percent == pytest.approx((1500 / 1090 - 1) * 100, rel=1e-6)
        prow = db.query(PortfolioSnapshot).filter_by(portfolio_id=paper, source="job").one()
        assert prow.total_value == 5000 and prow.cash_balance == 5000
        # re-running the same day replaces, never duplicates
        ph.run_daily_snapshots(db, lambda syms: {"AAPL": {"price": 151.0}}, today=today)
        assert db.query(PortfolioSnapshot).filter_by(portfolio_id=pid, source="job").count() == 1


CSV_OK = (
    "date,symbol,type,quantity,price,fees\n"
    f"{D0.isoformat()},AAPL,BUY,10,100,1\n"
    f"{(D0 + timedelta(days=2)).isoformat()},AAPL,SELL,4,110,0\n"
    f"{(D0 + timedelta(days=3)).isoformat()},MSFT,BUY,1,400,0\n"
)


def test_import_preview_then_commit(env):
    pid = _mk(env)
    r = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a, json={"csv": CSV_OK})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["can_commit"] is True and body["summary"]["valid"] == 3
    # preview writes nothing
    assert env.get(f"/api/v1/portfolios/{pid}/transactions", headers=env.a).json()["transactions"] == []
    r = env.post(f"/api/v1/portfolios/{pid}/import/commit", headers=env.a, json={"csv": CSV_OK})
    assert r.status_code == 201 and r.json()["imported"] == 3
    s = env.get(f"/api/v1/portfolios/{pid}", headers=env.a).json()
    aapl = next(h for h in s["holdings"] if h["symbol"] == "AAPL")
    assert aapl["quantity"] == 6
    assert s["realized_pnl"] == pytest.approx(4 * 110 - 4 * 100.1)
    # importing the same file again flags duplicates
    again = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a, json={"csv": CSV_OK}).json()
    assert again["summary"]["warnings"] == 3


def test_import_rejects_oversell_with_row_number(env):
    pid = _mk(env)
    csv_text = ("date,symbol,type,quantity,price\n"
                f"{(D0 + timedelta(days=2)).isoformat()},AAPL,SELL,5,110\n"   # before the buy
                f"{(D0 + timedelta(days=3)).isoformat()},AAPL,BUY,5,100\n")
    body = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a, json={"csv": csv_text}).json()
    assert body["can_commit"] is False
    assert body["rows"][0]["status"] == "error" and "Cannot sell" in body["rows"][0]["errors"][0]
    r = env.post(f"/api/v1/portfolios/{pid}/import/commit", headers=env.a, json={"csv": csv_text})
    assert r.status_code == 400
    assert env.get(f"/api/v1/portfolios/{pid}/transactions", headers=env.a).json()["transactions"] == []


def test_import_reports_oversell_alongside_other_row_errors(env):
    pid = _mk(env)
    csv_text = ("date,symbol,type,quantity,price\n"
                f"{D0.isoformat()},AAPL,BUY,10,100\n"
                f"{(D0 + timedelta(days=1)).isoformat()},AAPL,SELL,400,110\n"
                f"{(D0 + timedelta(days=1)).isoformat()},ZZZZ,BUY,1,1\n")
    body = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a, json={"csv": csv_text}).json()
    assert [r["status"] for r in body["rows"]] == ["ok", "error", "error"]
    assert "Cannot sell 400" in body["rows"][1]["errors"][0]


def test_import_oversell_against_existing_ledger(env):
    pid = _mk(env)
    env.post(f"/api/v1/portfolios/{pid}/transactions", headers=env.a, json={
        "symbol": "AAPL", "type": "BUY", "quantity": 3, "price": 100, "trade_date": D0.isoformat()})
    csv_text = f"date,symbol,type,quantity,price\n{(D0 + timedelta(days=1)).isoformat()},AAPL,SELL,4,110\n"
    body = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a, json={"csv": csv_text}).json()
    assert body["can_commit"] is False and "only 3" in body["rows"][0]["errors"][0]


def test_import_unknown_symbol_paper_and_ownership(env):
    pid = _mk(env)
    body = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a,
                    json={"csv": "date,symbol,type,quantity,price\n2026-01-05,ZZZZ,BUY,1,1\n"}).json()
    assert "unknown symbol" in body["rows"][0]["errors"][0]
    paper = _mk(env, kind="paper")
    r = env.post(f"/api/v1/portfolios/{paper}/import/preview", headers=env.a, json={"csv": CSV_OK})
    assert r.status_code == 400
    assert env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.b,
                    json={"csv": CSV_OK}).status_code == 404
    r = env.post(f"/api/v1/portfolios/{pid}/import/preview", headers=env.a, json={"csv": "x,y\n1,2\n"})
    assert r.status_code == 400 and "header" in r.json()["detail"]


def test_snapshot_column_migration_is_idempotent(env):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "scripts" / "add_portfolio_snapshot_columns.py"
    spec = importlib.util.spec_from_file_location("add_cols", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # old table without the new columns
    old = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with old.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE portfolio_snapshots (id INTEGER PRIMARY KEY, portfolio_id INTEGER NOT NULL, "
            "snapshot_date TIMESTAMP NOT NULL, total_value FLOAT NOT NULL, cash_balance FLOAT NOT NULL, "
            "invested_value FLOAT NOT NULL)")
    mod.migrate(old)
    mod.migrate(old)
    cols = {c["name"] for c in inspect(old).get_columns("portfolio_snapshots")}
    assert {"cost_basis", "net_flow", "source", "missing_symbols"} <= cols
