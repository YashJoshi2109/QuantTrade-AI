"""Async report jobs (DungBeetle pattern): registry parsing, runner semantics, API."""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.models.portfolio import Portfolio, Transaction, TransactionType
from app.models.price import PriceBar
from app.models.report_job import ReportResult
from app.models.symbol import Symbol
from app.models.user import User
from app.services.reports import runner as runner_mod
from app.services.reports.registry import ArgError, load_tasks, parse_sql_tasks
from app.services.reports.runner import ReportRunner, TooManyActive, UnknownTask, job_id_for


# ---------------------------------------------------------------- fixtures ----
def _db(path):
    # A file DB with a real pool: the worker thread and the caller each get their
    # own connection, as on Postgres (a shared in-memory connection would race).
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 10})
    Base.metadata.create_all(eng, tables=[
        User.__table__, Symbol.__table__, PriceBar.__table__, Portfolio.__table__,
        Transaction.__table__, ReportResult.__table__,
    ])
    return sessionmaker(bind=eng)


def _seed(Session):
    db = Session()
    u1, u2 = User(email="a@example.com", username="a"), User(email="b@example.com", username="b")
    db.add_all([u1, u2])
    aapl, msft = Symbol(symbol="AAPL", name="Apple"), Symbol(symbol="MSFT", name="Microsoft")
    db.add_all([aapl, msft])
    db.flush()
    p1 = Portfolio(user_id=u1.id, name="=HYPERLINK(1)", currency="USD")
    p2 = Portfolio(user_id=u2.id, name="Other", currency="USD")
    db.add_all([p1, p2])
    db.flush()

    def tx(p, s, kind, q, px, day, fees=0.0, pnl=None, amount=None):
        db.add(Transaction(portfolio_id=p.id, symbol_id=s.id, transaction_type=kind, quantity=q, price=px,
                           fees=fees, total_amount=amount if amount is not None else q * px, realized_pnl=pnl,
                           transaction_date=datetime(2026, 3, day, 15, tzinfo=timezone.utc)))

    tx(p1, aapl, TransactionType.BUY, 10, 100.0, 2, fees=1.0, amount=1001.0)
    tx(p1, aapl, TransactionType.SELL, 4, 120.0, 10, fees=1.0, pnl=79.4, amount=479.0)
    tx(p1, aapl, TransactionType.SELL, 1, 90.0, 12, pnl=None, amount=90.0)
    tx(p1, msft, TransactionType.DIVIDEND, 0, 0.0, 15, amount=12.5)
    tx(p2, msft, TransactionType.BUY, 5, 300.0, 3, amount=1500.0)  # other user's row
    for i in range(3):
        db.add(PriceBar(symbol_id=aapl.id, timestamp=datetime(2026, 1, 2 + i, tzinfo=timezone.utc),
                        open=1, high=2, low=0.5, close=1.5, volume=100))
    db.add(PriceBar(symbol_id=msft.id, timestamp=datetime(2026, 1, 5, tzinfo=timezone.utc),
                    open=1, high=2, low=0.5, close=1.5, volume=100))
    db.commit()
    ids = (u1.id, u2.id)
    db.close()
    return ids


@pytest.fixture
def env(tmp_path):
    Session = _db(tmp_path / "reports.db")
    u1, u2 = _seed(Session)
    r = ReportRunner(session_factory=Session, tasks=load_tasks(), max_workers=1)
    yield r, Session, u1, u2
    r.shutdown()


def _run(r, task, uid, args=None):
    job = r.submit(task, uid, args or {})
    r.wait(job["id"], timeout=10)
    return job, r.get(job["id"], uid)


# ---------------------------------------------------------------- registry ----
def test_shipped_tasks_parse_and_are_scoped():
    tasks = load_tasks()
    assert {"tradebook", "realized_pnl_by_symbol", "dividend_income", "price_bar_coverage"} <= set(tasks)
    for t in tasks.values():
        if t.scope == "user":
            assert ":user_id" in t.sql
    assert tasks["price_bar_coverage"].scope == "public"


@pytest.mark.parametrize("sql", [
    "-- name: bad\n-- scope: public\nDELETE FROM users",
    "-- name: bad\n-- scope: public\nSELECT 1; DROP TABLE users",
    "-- name: bad\nSELECT * FROM transactions",  # user task without :user_id
    "-- name: bad\n-- args: user_id:int\nSELECT :user_id",  # reserved arg
])
def test_registry_rejects_unsafe_tasks(sql):
    with pytest.raises(ValueError):
        parse_sql_tasks(sql)


def test_args_are_validated():
    t = load_tasks()["tradebook"]
    with pytest.raises(ArgError):
        t.bind_args({"from_date": "not-a-date"})
    with pytest.raises(ArgError):
        t.bind_args({"user_id": 2})  # cannot be passed by a client
    b = t.bind_args({"from_date": "2026-03-01", "to_date": "2026-03-10"})
    assert b["from_date"] == datetime(2026, 3, 1, tzinfo=timezone.utc)
    assert b["to_date"] == datetime(2026, 3, 11, tzinfo=timezone.utc)  # inclusive end


def test_job_id_is_deterministic_and_owner_bound():
    a = job_id_for("tradebook", "1", {"from_date": "2026-01-01"})
    assert a == job_id_for("tradebook", "1", {"from_date": "2026-01-01"})
    assert a != job_id_for("tradebook", "2", {"from_date": "2026-01-01"})


# ------------------------------------------------------------------ runner ----
def test_tradebook_returns_only_callers_rows_in_range(env):
    r, _S, u1, _u2 = env
    job, out = _run(r, "tradebook", u1, {"from_date": "2026-03-01", "to_date": "2026-03-10"})
    assert out["status"] == "done", out
    cols = out["columns"]
    assert cols[:5] == ["date", "portfolio", "currency", "symbol", "type"]
    rows = [dict(zip(cols, row)) for row in out["rows"]]
    # BUY on 3/2 and SELL on 3/10 (inclusive end); not 3/12, not the other user's buy
    assert [(x["symbol"], x["type"], x["amount"]) for x in rows] == [("AAPL", "BUY", 1001.0), ("AAPL", "SELL", 479.0)]
    assert out["row_count"] == 2 and out["truncated"] is False


def test_realized_pnl_flags_unpriced_sells(env):
    r, _S, u1, _u2 = env
    _job, out = _run(r, "realized_pnl_by_symbol", u1)
    rows = [dict(zip(out["columns"], row)) for row in out["rows"]]
    assert len(rows) == 1
    row = rows[0]
    assert row["symbol"] == "AAPL" and row["sells"] == 2 and row["quantity_sold"] == 5
    assert row["net_proceeds"] == pytest.approx(569.0)
    assert row["realized_pnl"] == pytest.approx(79.4)
    assert row["sells_missing_pnl"] == 1  # honest: total is incomplete


def test_dividend_income(env):
    r, _S, u1, u2 = env
    _job, out = _run(r, "dividend_income", u1)
    rows = [dict(zip(out["columns"], row)) for row in out["rows"]]
    assert [(x["symbol"], x["payments"], x["amount"]) for x in rows] == [("MSFT", 1, 12.5)]
    _job, other = _run(r, "dividend_income", u2)
    assert other["rows"] == []


def test_fresh_result_is_served_from_cache(env):
    r, S, u1, _u2 = env
    job, _ = _run(r, "tradebook", u1)
    again = r.submit("tradebook", u1, {})
    assert again["id"] == job["id"] and again["cached"] is True and again["status"] == "done"
    # once expired it runs again
    db = S()
    db.get(ReportResult, job["id"]).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    db.close()
    rerun = r.submit("tradebook", u1, {})
    assert rerun["cached"] is False
    r.wait(rerun["id"], timeout=10)


def test_public_task_is_shared_across_users(env):
    r, _S, u1, u2 = env
    job, out = _run(r, "price_bar_coverage", u1, {"min_bars": "2"})
    assert [row[:2] for row in out["rows"]] == [["AAPL", 3]]  # MSFT has 1 bar
    other = r.submit("price_bar_coverage", u2, {"min_bars": 2})
    assert other["id"] == job["id"] and other["cached"] is True
    assert r.get(job["id"], u2)["rows"] == out["rows"]


def test_user_results_are_private(env):
    r, _S, u1, u2 = env
    job, _ = _run(r, "tradebook", u1)
    assert r.get(job["id"], u2) is None
    assert r.full_result(job["id"], u2) is None
    assert r.cancel(job["id"], u2) is None


def test_unknown_task_and_paging(env):
    r, _S, u1, _u2 = env
    with pytest.raises(UnknownTask):
        r.submit("nope", u1, {})
    job, _ = _run(r, "tradebook", u1)
    page = r.get(job["id"], u1, offset=1, limit=1)
    assert len(page["rows"]) == 1 and page["offset"] == 1


def test_interrupted_job_reported_as_error_then_reruns(env):
    r, S, u1, _u2 = env
    jid = job_id_for("tradebook", str(u1), load_tasks()["tradebook"].canonical_args({}))
    db = S()
    db.add(ReportResult(job_id=jid, task="tradebook", owner_key=str(u1), submitted_by=u1, args_json={},
                        status="running", created_at=datetime.now(timezone.utc)))
    db.commit()
    db.close()
    st = r.get(jid, u1)
    assert st["status"] == "error" and "restart" in st["error"]
    job, out = _run(r, "tradebook", u1)
    assert job["id"] == jid and out["status"] == "done"


def test_per_owner_active_limit(env, monkeypatch):
    r, _S, u1, _u2 = env
    monkeypatch.setattr(runner_mod, "MAX_ACTIVE_PER_OWNER", 0)
    with pytest.raises(TooManyActive):
        r.submit("tradebook", u1, {})


def test_failed_query_is_an_error_not_a_crash(tmp_path):
    Session = _db(tmp_path / "reports.db")
    tasks = {t.name: t for t in parse_sql_tasks("-- name: broken\n-- scope: public\nSELECT * FROM no_such_table")}
    r = ReportRunner(session_factory=Session, tasks=tasks)
    try:
        job, out = _run(r, "broken", 1)
        assert out["status"] == "error" and out["error"] == "The report failed to run."
    finally:
        r.shutdown()


def test_sweep_deletes_expired(env):
    r, S, u1, _u2 = env
    job, _ = _run(r, "tradebook", u1)
    db = S()
    db.get(ReportResult, job["id"]).expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.commit()
    db.close()
    assert r.sweep_expired() == 1
    assert r.get(job["id"], u1) is None


# --------------------------------------------------------------------- API ----
def test_api_end_to_end(env, monkeypatch):
    r, _S, u1, u2 = env
    from app.api import reports as api
    from app.api.auth import _guard_token

    monkeypatch.setattr(api, "runner", r)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    who = {"id": u1}
    app.dependency_overrides[_guard_token] = lambda: who["id"]
    c = TestClient(app)

    names = {t["name"] for t in c.get("/api/v1/reports/tasks").json()["tasks"]}
    assert "tradebook" in names
    assert c.post("/api/v1/reports/tasks/nope/jobs", json={}).status_code == 404
    assert c.post("/api/v1/reports/tasks/tradebook/jobs", json={"args": {"from_date": "x"}}).status_code == 400
    res = c.post("/api/v1/reports/tasks/tradebook/jobs", json={"args": {}})
    assert res.status_code == 202
    jid = res.json()["id"]
    r.wait(jid, timeout=10)
    body = c.get(f"/api/v1/reports/jobs/{jid}").json()
    assert body["status"] == "done" and body["row_count"] == 4
    csv_text = c.get(f"/api/v1/reports/jobs/{jid}/csv").text
    assert csv_text.splitlines()[0].startswith("date,portfolio,currency,symbol,type")
    assert "'=HYPERLINK(1)" in csv_text  # formula injection neutralised
    who["id"] = u2
    assert c.get(f"/api/v1/reports/jobs/{jid}").status_code == 404
    who["id"] = u1
    assert c.delete(f"/api/v1/reports/jobs/{jid}").json()["status"] == "deleted"
    assert c.get(f"/api/v1/reports/jobs/{jid}").status_code == 404


def test_api_requires_auth():
    from app.api import reports as api

    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    assert TestClient(app).get("/api/v1/reports/tasks").status_code == 401


# ------------------------------------------------- optional: real Postgres ----
@pytest.mark.skipif(not os.environ.get("REPORTS_TEST_PG_URL"),
                    reason="set REPORTS_TEST_PG_URL to a throwaway Postgres database")
def test_runs_read_only_on_postgres():
    from sqlalchemy import text

    eng = create_engine(os.environ["REPORTS_TEST_PG_URL"])
    tables = [User.__table__, Symbol.__table__, PriceBar.__table__, Portfolio.__table__,
              Transaction.__table__, ReportResult.__table__]
    Base.metadata.drop_all(eng, tables=tables)
    Base.metadata.create_all(eng, tables=tables)
    Session = sessionmaker(bind=eng)
    u1, _u2 = _seed(Session)
    r = ReportRunner(session_factory=Session, tasks=load_tasks(), statement_timeout_ms=5000)
    try:
        for name in ("tradebook", "realized_pnl_by_symbol", "dividend_income"):
            _job, out = _run(r, name, u1)
            assert out["status"] == "done", (name, out)
        _job, out = _run(r, "realized_pnl_by_symbol", u1)
        row = dict(zip(out["columns"], out["rows"][0]))
        assert row["sells"] == 2 and row["sells_missing_pnl"] == 1
        _job, out = _run(r, "price_bar_coverage", u1, {"min_bars": 2})
        assert [x[:2] for x in out["rows"]] == [["AAPL", 3]]
        # a statement that writes is refused by the READ ONLY transaction
        sneaky = parse_sql_tasks("-- name: sneaky\n-- scope: public\n"
                                 "SELECT nextval('symbols_id_seq')")
        r2 = ReportRunner(session_factory=Session, tasks={t.name: t for t in sneaky})
        _job, out = _run(r2, "sneaky", u1)
        assert out["status"] == "error"
        r2.shutdown()
        # statement_timeout stops a runaway query
        slow = parse_sql_tasks("-- name: slow\n-- scope: public\nSELECT pg_sleep(3)")
        r3 = ReportRunner(session_factory=Session, tasks={t.name: t for t in slow}, statement_timeout_ms=200)
        _job, out = _run(r3, "slow", u1)
        assert out["status"] == "error" and "too long" in out["error"]
        r3.shutdown()
        with eng.connect() as c:
            assert c.execute(text("SELECT count(*) FROM report_results")).scalar() >= 4
    finally:
        r.shutdown()
        Base.metadata.drop_all(eng, tables=tables)
        eng.dispose()
