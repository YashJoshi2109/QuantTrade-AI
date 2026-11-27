"""Regression: Research SEC panel classification (AEIS / INSM / TENB shown as
"not applicable — ETFs ... foreign issuers" although they are US 10-K filers).

Root cause: /company-overview answered 404 both for "no Symbol row yet" and
for a failed first EDGAR sync, and the UI read every 404 as "no company
financials". Now: SEC's ticker registry vouches for unknown tickers, sync
failures are 503 ``sec_unavailable``, and ``filer_type`` separates domestic,
foreign (20-F / 6-K) and fund filers.
"""
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_db
from app.models.edgar import CompanyEDGAR, FinancialStatement
from app.models.symbol import Symbol
from app.services import sec_filer
from app.services.sec_filer import classify_forms, classify_submissions


def _subs(forms, name="Some Co", entity="operating"):
    return {"name": name, "entityType": entity, "filings": {"recent": {"form": list(forms)}}}


# ── Pure classification ─────────────────────────────────────────────────

@pytest.mark.parametrize("ticker,forms,expected", [
    ("AEIS", ["8-K", "10-Q", "4", "8-K", "10-K"], "domestic"),
    ("INSM", ["8-K", "4", "10-Q", "S-8"], "domestic"),
    ("ENTG", ["10-Q", "8-K"], "domestic"),
    ("DLTR", ["8-K", "8-K", "10-Q"], "domestic"),
    ("TENB", ["4", "4", "10-Q", "8-K", "10-K"], "domestic"),
    ("TSM", ["6-K", "6-K", "20-F", "6-K"], "foreign"),
    ("ASML", ["6-K", "SC 13G", "20-F"], "foreign"),
    ("SHOP", ["6-K", "40-F"], "foreign"),
    ("SPY", ["N-CSR", "NPORT-P", "485BPOS"], "fund"),
    ("QQQ", ["NPORT-P", "N-CEN", "N-CSRS"], "fund"),
    ("NEWCO", ["S-1", "8-K"], "unknown"),
])
def test_classify_forms(ticker, forms, expected):
    assert classify_forms(forms) == expected, ticker


def test_newest_periodic_form_wins_after_regime_change():
    # Moved from 20-F to 10-K reporting: the newest periodic report decides.
    assert classify_forms(["8-K", "10-Q", "6-K", "20-F"]) == "domestic"
    assert classify_forms(["6-K", "20-F", "10-K"]) == "foreign"


def test_classify_submissions_fallbacks():
    assert classify_submissions(None) == "unknown"
    assert classify_submissions({}) == "unknown"
    assert classify_submissions(_subs([], entity="investment company")) == "fund"
    assert classify_submissions(_subs(["8-K"])) == "unknown"


def test_filer_type_cache_and_fetch_failure():
    sec_filer.clear_cache()
    calls = []

    def fetch(cik):
        calls.append(cik)
        return _subs(["10-Q"])

    assert sec_filer.filer_type_for_cik("0000927003", fetch) == "domestic"
    assert sec_filer.filer_type_for_cik("0000927003", fetch) == "domestic"
    assert calls == ["0000927003"]

    def boom(_cik):
        raise RuntimeError("SEC down")

    assert sec_filer.filer_type_for_cik("0000000001", boom) == "unknown"
    assert sec_filer.filer_type_for_cik(None, fetch) == "unknown"
    sec_filer.clear_cache()


# ── Endpoint ────────────────────────────────────────────────────────────

CIKS = {"AEIS": "0000927003", "INSM": "0001104506", "TENB": "0001660280", "ENTG": "0001101302",
        "DLTR": "0000935703", "TSM": "0001046179", "ASML": "0000937966", "SPY": "0000884394"}
SUBS = {
    "0000927003": _subs(["10-Q", "8-K"], "ADVANCED ENERGY INDUSTRIES, INC."),
    "0001104506": _subs(["8-K", "10-Q"], "INSMED Inc"),
    "0001660280": _subs(["10-Q"], "Tenable Holdings, Inc."),
    "0001101302": _subs(["10-Q"], "Entegris, Inc."),
    "0000935703": _subs(["10-Q"], "DOLLAR TREE, INC."),
    "0001046179": _subs(["6-K", "20-F"], "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD"),
    "0000937966": _subs(["6-K", "20-F"], "ASML HOLDING NV"),
    "0000884394": _subs(["N-CSR", "NPORT-P"], "SPDR S&P 500 ETF TRUST", entity="other"),
}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [Symbol, CompanyEDGAR, FinancialStatement]
    Base.metadata.create_all(bind=engine, tables=[t.__table__ for t in tables])
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        yield session, Session
    finally:
        session.close()


@pytest.fixture
def client(db):
    from app.api import research

    session, Session = db
    app = FastAPI()
    app.include_router(research.router)
    app.dependency_overrides[get_db] = lambda: session
    sec_filer.clear_cache()
    research._sync_ok_at.clear()

    def fake_sync(ticker, sdb, force_refresh=False):
        sym = sdb.query(Symbol).filter(Symbol.symbol == ticker.upper()).first()
        cik = CIKS[ticker.upper()]
        sdb.add(CompanyEDGAR(symbol_id=sym.id, cik=cik, company_name=SUBS[cik]["name"], sic="3679"))
        if SUBS[cik]["filings"]["recent"]["form"][0] != "6-K":
            sdb.add(FinancialStatement(symbol_id=sym.id, cik=cik, period="2026-Q3", fiscal_year=2026,
                                       fiscal_quarter=3, form="10-Q", period_end_date="2026-09-30"))
        sdb.commit()
        return {"status": "ok", "cik": cik}

    with patch.object(research._database, "SessionLocal", Session), \
         patch("app.api.research.get_cik", side_effect=lambda t: CIKS.get(t.upper())), \
         patch.object(research._sec_mod, "_CIK_CACHE", {"AEIS": "0000927003"}), \
         patch("app.api.research.get_submissions", side_effect=lambda cik: SUBS.get(cik)), \
         patch("app.api.research.sync_edgar_data", side_effect=fake_sync) as sync, \
         patch("app.services.copilot.viewed.record_view"):
        tc = TestClient(app)
        tc.sync_mock = sync
        yield tc
    sec_filer.clear_cache()
    research._sync_ok_at.clear()


@pytest.mark.parametrize("ticker", ["AEIS", "INSM", "ENTG", "DLTR", "TENB"])
def test_us_operating_company_without_symbol_row_gets_full_panel(client, db, ticker):
    """Unknown-to-us US filers used to 404 → "not applicable (ETF / foreign)"."""
    r = client.get(f"/api/v1/research/{ticker}/company-overview")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["asset_type"] == "equity"
    assert body["filer_type"] == "domestic"
    assert body["edgar_status"] == "ok"
    assert body["cik"] == CIKS[ticker]
    session, _ = db
    assert session.query(Symbol).filter(Symbol.symbol == ticker).one().name == SUBS[CIKS[ticker]]["name"]
    fin = client.get(f"/api/v1/research/{ticker}/financials?period_type=quarterly")
    assert fin.status_code == 200 and fin.json()["count"] == 1


def test_existing_symbol_failed_sync_is_retryable_not_not_applicable(client, db):
    session, _ = db
    session.add(Symbol(symbol="AEIS", name="Advanced Energy Industries, Inc.", asset_type="Equity"))
    session.commit()
    client.sync_mock.side_effect = lambda *a, **k: {"status": "error", "message": "Could not fetch EDGAR data for AEIS"}
    r = client.get("/api/v1/research/AEIS/company-overview")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "sec_unavailable"
    assert r.headers.get("retry-after") == "30"


@pytest.mark.parametrize("ticker", ["TSM", "ASML"])
def test_foreign_private_issuer_is_flagged_foreign(client, ticker):
    r = client.get(f"/api/v1/research/{ticker}/company-overview")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["asset_type"] == "equity"
    assert body["filer_type"] == "foreign"
    assert body["edgar_status"] == "ok"


@pytest.mark.parametrize("ticker,stored", [("SPY", "ETF"), ("QQQ", "ETF")])
def test_listed_etf_is_not_applicable_without_sec_calls(client, db, ticker, stored):
    session, _ = db
    session.add(Symbol(symbol=ticker, name=f"{ticker} Trust", asset_type=stored))
    session.commit()
    r = client.get(f"/api/v1/research/{ticker}/company-overview")
    assert r.status_code == 200
    assert r.json()["asset_type"] == "etf"
    assert r.json()["filer_type"] == "fund"
    assert r.json()["edgar_status"] == "not_applicable"
    client.sync_mock.assert_not_called()


def test_unlisted_sec_registered_fund_is_not_registered_as_equity(client, db):
    r = client.get("/api/v1/research/SPY/company-overview")
    assert r.status_code == 200
    assert r.json()["filer_type"] == "fund"
    assert r.json()["edgar_status"] == "not_applicable"
    session, _ = db
    assert session.query(Symbol).filter(Symbol.symbol == "SPY").first() is None
    client.sync_mock.assert_not_called()


def test_ticker_unknown_to_sec_is_typed_404(client):
    r = client.get("/api/v1/research/ZZZZ/company-overview")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "no_sec_filer"


def test_sec_ticker_map_unreachable_is_503_not_404(client):
    from app.api import research

    with patch.object(research._sec_mod, "_CIK_CACHE", {}):
        r = client.get("/api/v1/research/ZZZZ/company-overview")
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "sec_unavailable"
