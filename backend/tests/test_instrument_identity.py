"""Regression tests: instrument identity, share classes, valuation units, search caps.

QT-02 (reassigned PARA), QT-09 (stale search market cap), QT-11 (index overview),
D9 (BRK.B / BF.B provider symbols), D10 (PEG sign, earnings dates, D/E units).
"""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_db
from app.models.edgar import CompanyEDGAR
from app.models.fundamentals import Fundamentals
from app.models.price import PriceBar
from app.models.symbol import Symbol
from app.models.symbols_master import SymbolsMaster
from app.services.finviz_fetcher import FinvizFetcher, meaningful_peg, normalize_earnings_date
from app.services.instrument_identity import identity_check, names_match
from app.services.ticker_validation import classify_asset_type, finviz_symbol, yahoo_symbol


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    tables = [Symbol, SymbolsMaster, PriceBar, Fundamentals, CompanyEDGAR]
    Base.metadata.create_all(bind=engine, tables=[t.__table__ for t in tables])
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    from app.api import enhanced_endpoints, research, symbols

    app = FastAPI()
    app.include_router(symbols.router, prefix="/api/v1")
    app.include_router(research.router)
    app.include_router(enhanced_endpoints.router, prefix="/api/v1/enhanced")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


# ── D9: share-class provider symbols ──────────────────────────────────────

@pytest.mark.parametrize("sym,expected", [
    ("BRK.B", "BRK-B"), ("BF.B", "BF-B"), ("brk.a", "BRK-A"),
    ("AAPL", "AAPL"), ("0700.HK", "0700.HK"), ("SHOP.TO", "SHOP.TO"), ("VOD.L", "VOD.L"),
])
def test_yahoo_and_finviz_symbols(sym, expected):
    assert yahoo_symbol(sym) == expected
    assert finviz_symbol(sym) == expected


def test_finviz_and_yfinance_fetchers_use_dash_for_share_classes():
    seen = {}

    class _Resp:
        content = b"<html></html>"

        def raise_for_status(self):
            pass

    def fake_get(url, **kw):
        seen["url"] = url
        return _Resp()

    with patch("app.services.finviz_fetcher.requests.get", side_effect=fake_get):
        FinvizFetcher.fetch_stock_fundamentals("BRK.B")
    assert seen["url"].endswith("t=BRK-B")

    class _Ticker:
        def __init__(self, s):
            seen["yf"] = s
            self.info = {"longName": "Berkshire Hathaway Inc.", "marketCap": 1.0e12, "pegRatio": -3.1}

    with patch("yfinance.Ticker", _Ticker):
        out = FinvizFetcher.fetch_yfinance_fundamentals("BF.B")
    assert seen["yf"] == "BF-B"
    assert out["company_name"] == "Berkshire Hathaway Inc."
    assert out["peg_ratio"] is None  # negative PEG is not meaningful


# ── D10: units / signs / dates ─────────────────────────────────────────────

def test_meaningful_peg():
    assert meaningful_peg(-12.62) is None
    assert meaningful_peg(0) is None
    assert meaningful_peg(1.89) == 1.89
    assert meaningful_peg(None) is None


def test_normalize_earnings_date():
    today = date(2026, 11, 25)
    assert normalize_earnings_date("Nov 02", today) == "2026-11-02"  # past, not "next"
    assert normalize_earnings_date("Nov 02 AMC", today) == "2026-11-02"
    assert normalize_earnings_date("Jan 28 BMO", today) == "2027-01-28"
    assert normalize_earnings_date("2027-01-29", today) == "2027-01-29"
    assert normalize_earnings_date(1801440000, today) == "2027-02-01"
    assert normalize_earnings_date("-", today) == ""
    assert normalize_earnings_date(None, today) == ""


def test_fundamentals_endpoint_sanitises_cached_rows(client, db):
    sym = Symbol(symbol="SOFI", name="SoFi Technologies", asset_type="Equity")
    db.add(sym)
    db.commit()
    db.add(Fundamentals(
        symbol_id=sym.id, company_name="SoFi Technologies, Inc.", market_cap=1.6e10,
        peg_ratio=-12.62, debt_to_equity=0.353, dividend_yield=None,
        earnings_date="Oct 27", fetched_at=datetime.now(timezone.utc),
    ))
    db.commit()
    body = client.get("/api/v1/enhanced/fundamentals/SOFI").json()
    assert body["peg_ratio"] is None
    assert body["debt_to_equity"] == 0.353
    assert body["asset_type"] == "equity"
    assert "dividend_yield" in body
    assert body["earnings_date"].endswith("-10-27")  # ISO with a year, not "Oct 27"


# ── QT-11: asset type ─────────────────────────────────────────────────────

@pytest.mark.parametrize("sym,stored,expected", [
    ("^GSPC", None, "index"), ("SPY", "ETF", "etf"), ("CL=F", None, "future"),
    ("BTC-USD", None, "crypto"), ("AAPL", "Equity", "equity"), ("AAPL", None, "equity"),
])
def test_classify_asset_type(sym, stored, expected):
    assert classify_asset_type(sym, stored) == expected


def test_company_overview_index_returns_asset_type_without_sec(client):
    with patch("app.api.research.sync_edgar_data") as sync:
        r = client.get("/api/v1/research/^GSPC/company-overview")
    assert r.status_code == 200, r.text
    assert r.json()["asset_type"] == "index"
    assert r.json()["cik"] is None
    sync.assert_not_called()


# ── QT-02: reassigned ticker ──────────────────────────────────────────────

def test_names_match():
    assert names_match("NVIDIA Corp", "NVIDIA CORP")
    assert names_match("Berkshire Hathaway Inc.", "BERKSHIRE HATHAWAY INC")
    assert names_match("IBM", "International Business Machines Corp")
    assert not names_match("Paramount Global", "Parabolic Technologies, Inc.")


def test_identity_check_flags_para_reassignment():
    out = identity_check("PARA", "Paramount Global", "Parabolic Technologies, Inc.")
    assert out["identity_status"] == "mismatch"
    assert out["successor_symbol"] == "SKYD"
    assert "Parabolic Technologies" in out["identity_note"]
    assert identity_check("AAPL", "Apple Inc.", "Apple Inc.") == {"identity_status": "ok"}


def test_company_overview_reports_identity_mismatch(client, db):
    sym = Symbol(symbol="PARA", name="Paramount Global", asset_type="Equity")
    db.add(sym)
    db.commit()
    db.add(CompanyEDGAR(symbol_id=sym.id, cik="0001826011", company_name="Parabolic Technologies, Inc."))
    db.commit()
    body = client.get("/api/v1/research/PARA/company-overview").json()
    assert body["asset_type"] == "equity"
    assert body["identity_status"] == "mismatch"
    assert body["listed_name"] == "Paramount Global"
    assert body["successor_symbol"] == "SKYD"


def test_quote_404_when_no_price_anywhere(client, db):
    db.add(Symbol(symbol="PARA", name="Paramount Global"))
    db.commit()
    with patch("app.api.enhanced_endpoints.EnhancedDataFetcher.fetch_realtime_quote",
               return_value={"symbol": "PARA", "last_price": 0, "data_source": "yfinance"}):
        r = client.get("/api/v1/enhanced/quote/PARA")
    assert r.status_code == 404
    assert "delisted" in r.json()["detail"]


# ── QT-09: search market cap ──────────────────────────────────────────────

def test_search_uses_fresh_fundamentals_market_cap_not_stale_symbols_column(client, db):
    nvda = Symbol(symbol="NVDA", name="NVIDIA Corp", market_cap=2.2e12)  # stale column
    old = Symbol(symbol="OLDC", name="Old Cap Co", market_cap=5e9)
    db.add_all([nvda, old])
    db.commit()
    db.add_all([
        Fundamentals(symbol_id=nvda.id, market_cap=3.4296e12, fetched_at=datetime.now(timezone.utc)),
        Fundamentals(symbol_id=old.id, market_cap=4e9,
                     fetched_at=datetime.now(timezone.utc) - timedelta(days=30)),
    ])
    db.commit()

    listed = {r["symbol"]: r for r in client.get("/api/v1/symbols?search=NVDA").json()}
    assert listed["NVDA"]["market_cap"] == pytest.approx(3.4296e12)

    stale = {r["symbol"]: r for r in client.get("/api/v1/symbols?search=OLDC").json()}
    assert stale["OLDC"]["market_cap"] is None  # stale -> not shown, never the old column

    found = client.get("/api/v1/symbols/search?q=NVDA").json()
    assert found[0]["symbol"] == "NVDA"
    assert found[0]["market_cap"] == pytest.approx(3.4296e12)
