"""Symbols identity refresh (SEC ticker map) and the Research identity endpoint."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_db
from app.models.edgar import CompanyEDGAR, FinancialStatement
from app.models.symbol import Symbol
from app.services.instrument_identity import ticker_identity
from app.services.symbol_identity_refresh import (
    SymbolRow, apply_plan, display_name, load_rows, parse_sec_ticker_map, plan_refresh,
)

# Shape of https://www.sec.gov/files/company_tickers.json (values as of Nov 2026).
SEC_JSON = {
    "0": {"cik_str": 1826011, "ticker": "PARA", "title": "Parabolic Technologies, Inc."},
    "1": {"cik_str": 2041610, "ticker": "SKYD", "title": "Skydance Corp"},
    "2": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
    "3": {"cik_str": 1067983, "ticker": "BRK-B", "title": "BERKSHIRE HATHAWAY INC"},
    "4": {"cik_str": 1512673, "ticker": "XYZ", "title": "Block, Inc."},
}
SEC = parse_sec_ticker_map(SEC_JSON)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[Symbol.__table__, CompanyEDGAR.__table__,
                                                  FinancialStatement.__table__])
    s = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield s
    finally:
        s.close()


def test_parse_sec_map_pads_cik():
    assert SEC["PARA"] == {"cik": "0001826011", "title": "Parabolic Technologies, Inc."}


def test_plan_renames_reassigned_ticker_purges_stale_edgar_and_adds_successor():
    rows = [
        SymbolRow("PARA", "Paramount Global", "Equity", edgar_cik="813828", edgar_name="Paramount Global"),
        SymbolRow("AAPL", "Apple Inc", "Equity", edgar_cik="0000320193"),
        SymbolRow("BRK.B", "Berkshire Hathaway Inc Class B", "Equity"),
        SymbolRow("SPY", "SPDR S&P 500 ETF", "ETF"),
    ]
    plan = plan_refresh(rows, SEC)
    by_kind = {a.kind: a for a in plan.actions}
    assert by_kind["rename"].symbol == "PARA"
    assert by_kind["rename"].new == "Parabolic Technologies, Inc."
    assert by_kind["purge_edgar"].symbol == "PARA" and by_kind["purge_edgar"].new == "0001826011"
    assert by_kind["add_successor"].symbol == "SKYD" and by_kind["add_successor"].new == "Skydance Corp"
    # AAPL / BRK.B agree with SEC; SPY is an ETF and is skipped.
    assert {a.symbol for a in plan.actions} == {"PARA", "SKYD"}
    assert plan.checked == 3


def test_plan_flags_known_changed_ticker_missing_from_sec():
    plan = plan_refresh([SymbolRow("PSKY", "Paramount Skydance Corp", "Equity")], SEC)
    kinds = [a.kind for a in plan.actions]
    assert "flag_delisted" in kinds
    assert any(a.kind == "add_successor" and a.symbol == "SKYD" for a in plan.actions)


def test_plan_does_not_readd_successor_already_listed_when_checking_subset():
    plan = plan_refresh([SymbolRow("SQ", "Block Inc", "Equity")], SEC, existing={"SQ", "XYZ"})
    assert [a.kind for a in plan.actions] == ["flag_delisted"]


def test_display_name_softens_all_caps_but_keeps_acronyms():
    assert display_name("PARABOLIC TECHNOLOGIES INC") == "Parabolic Technologies Inc"
    assert display_name("IBM CORP") == "IBM Corp"
    assert display_name("Apple Inc.") == "Apple Inc."
    assert display_name("SLB Limited/nv") == "SLB Limited"
    assert display_name("ACME HOLDINGS CORP /DE/") == "Acme Holdings Corp"


def test_brand_built_on_acronym_is_not_a_mismatch():
    from app.services.instrument_identity import names_match

    assert names_match("GE Aerospace", "General Electric Co")
    assert not names_match("Paramount Global", "Parabolic Technologies, Inc.")


def test_apply_plan_writes_changes(db):
    para = Symbol(symbol="PARA", name="Paramount Global", asset_type="Equity")
    db.add(para)
    db.commit()
    db.add(CompanyEDGAR(symbol_id=para.id, cik="0000813828", company_name="Paramount Global"))
    db.add(FinancialStatement(symbol_id=para.id, cik="0000813828", period="2025-Q1"))
    db.commit()

    plan = plan_refresh(load_rows(db), SEC)
    done = apply_plan(db, plan)
    assert done == {"rename": 1, "add_successor": 1, "purge_edgar": 1}
    assert db.query(Symbol).filter_by(symbol="PARA").one().name == "Parabolic Technologies, Inc."
    assert db.query(Symbol).filter_by(symbol="SKYD").one().name == "Skydance Corp"
    assert db.query(CompanyEDGAR).count() == 0 and db.query(FinancialStatement).count() == 0
    # Idempotent: a second run has nothing left to do except the known-change note.
    assert [a.kind for a in plan_refresh(load_rows(db), SEC).actions] == []


def test_ticker_identity_statuses():
    assert ticker_identity("PARA", "Paramount Global", None)["status"] == "changed"
    assert ticker_identity("PARA", "Paramount Global", None)["successor_symbol"] == "SKYD"
    m = ticker_identity("ZZZZ", "Old Name Corp", "Totally Different Holdings")
    assert m["status"] == "mismatch" and "Totally Different" in m["note"]
    assert ticker_identity("AAPL", "Apple Inc", "Apple Inc.")["status"] == "ok"


def test_identity_endpoint(db):
    from app.api import research

    app = FastAPI()
    app.include_router(research.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    db.add_all([Symbol(symbol="PARA", name="Paramount Global"), Symbol(symbol="SKYD", name="Skydance Corp"),
                Symbol(symbol="AAPL", name="Apple Inc")])
    db.commit()
    body = client.get("/api/v1/research/para/identity").json()
    assert body["status"] == "changed" and body["successor_symbol"] == "SKYD"
    assert body["successor_listed"] is True and body["listed_name"] == "Paramount Global"

    ok = client.get("/api/v1/research/AAPL/identity").json()
    assert ok["status"] == "ok" and ok["known_symbol"] is True

    unknown = client.get("/api/v1/research/NOPE/identity").json()
    assert unknown["status"] == "ok" and unknown["known_symbol"] is False


# --- CLI: runnable as a module in the prod image, guarded by DB host ---------

import pytest

from app.services import symbol_identity_refresh as sir


@pytest.mark.parametrize("host,remote", [
    ("localhost", False), ("127.0.0.1", False), ("db", False), (None, False),
    ("quanttrade-prod.cza20sq2wktv.us-east-2.rds.amazonaws.com", True), ("10.0.0.5", True),
])
def test_is_remote_db_host(host, remote):
    assert sir.is_remote_db_host(host) is remote


def test_main_refuses_remote_db_without_flag(monkeypatch, capsys):
    """APP_ENV is unset in the prod container, so the guard must key off the DB host."""
    monkeypatch.delenv("APP_ENV", raising=False)

    class _URL:
        host = "quanttrade-prod.example.rds.amazonaws.com"

    class _Bind:
        url = _URL()

    class _Session:
        def get_bind(self):
            return _Bind()

        def close(self):
            pass

    import app.config_aws as config_aws
    import app.db.database as database

    monkeypatch.setattr(config_aws, "inject_aws_secrets", lambda: None)
    monkeypatch.setattr(database, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(sir, "fetch_sec_ticker_map", lambda path=None: {})
    assert sir.main(["--apply"]) == 2
    assert "--allow-production" in capsys.readouterr().err


def test_module_is_executable():
    import runpy  # noqa: F401  (python -m entry point exists)

    assert callable(sir.main)
