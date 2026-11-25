"""
Regression tests for the backend reliability sweep:

- symbol search ILIKE fallback (no pg_trgm / SQLite) + rollback on failure
- Finnhub CACHE_TTL key mismatch ('recommendations' KeyError -> 500)
- /feed/ticker/{T} PortableARRAY filter on SQLite (and PostgreSQL SQL shape)
- invalid tickers -> 404 with no Symbol row created
- /prices newest-first limit, backfill and refresh decisions
- Public.com quote parse self-consistency
- Finnhub profile unit conversion, Finviz header remap
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_db
from app.models.symbol import Symbol
from app.models.symbols_master import SymbolsMaster
from app.models.price import PriceBar


# ---------------------------------------------------------------------------
# SQLite fixtures
# ---------------------------------------------------------------------------

def _make_session(tables):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=[t.__table__ for t in tables])
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture
def market_db():
    Session = _make_session([Symbol, SymbolsMaster, PriceBar])
    db = Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Bug 2: symbol search
# ---------------------------------------------------------------------------

def _seed_master(db):
    rows = [
        ("AAPL", "Apple Inc."),
        ("AAP", "Advance Auto Parts"),
        ("PAA", "Plains All American"),
        ("MSFT", "Microsoft Corporation"),
        ("APLE", "Apple Hospitality REIT"),
    ]
    for sym, name in rows:
        db.add(SymbolsMaster(symbol=sym, name=name, exchange="NASDAQ", is_active="Y"))
    db.commit()


def test_trigram_disabled_on_sqlite(market_db):
    from app.api import symbols as symbols_api
    symbols_api._TRGM_AVAILABLE = None
    assert symbols_api._trigram_available(market_db) is False


def test_search_ilike_ranking_on_sqlite(market_db):
    from app.api.symbols import universal_search
    _seed_master(market_db)

    res = universal_search(q="aap", limit=10, db=market_db)
    syms = [r.symbol for r in res]
    # exact first, then symbol prefix, then symbol contains
    assert syms[0] == "AAP" and res[0].match_type == "exact"
    assert syms[1] == "AAPL" and res[1].match_type == "prefix"
    assert "PAA" not in syms  # 'PAA' doesn't contain 'AAP'

    res = universal_search(q="apple", limit=10, db=market_db)
    assert {r.symbol for r in res} == {"AAPL", "APLE"}
    assert all(r.match_type == "prefix" for r in res)


def test_search_like_wildcards_escaped(market_db):
    from app.api.symbols import universal_search
    _seed_master(market_db)
    assert universal_search(q="%", limit=10, db=market_db) == []
    assert universal_search(q="_", limit=10, db=market_db) == []


def test_search_rolls_back_and_falls_back_to_symbols_table(market_db):
    from app.api import symbols as symbols_api
    market_db.add(Symbol(symbol="NVDA", name="NVIDIA Corp"))
    market_db.commit()

    rollback_spy = MagicMock(wraps=market_db.rollback)
    market_db.rollback = rollback_spy
    with patch.object(symbols_api, "_search_symbols_master", side_effect=RuntimeError("no pg_trgm")):
        res = symbols_api.universal_search(q="nvd", limit=5, db=market_db)
    assert rollback_spy.called
    assert [r.symbol for r in res] == ["NVDA"]


# ---------------------------------------------------------------------------
# Bug 3: CACHE_TTL keys
# ---------------------------------------------------------------------------

def test_all_finnhub_cache_ttl_keys_exist():
    from app.services.rate_limiter import CACHE_TTL
    src = Path(__file__).resolve().parents[1] / "app" / "services" / "finnhub_fetcher.py"
    used = set(re.findall(r"CACHE_TTL\['([a-z_]+)'\]", src.read_text()))
    assert used, "expected CACHE_TTL lookups in finnhub_fetcher"
    assert used <= set(CACHE_TTL), f"missing keys: {used - set(CACHE_TTL)}"


def test_recommendations_endpoint_no_keyerror():
    from app.services import rate_limiter
    from app.services.finnhub_fetcher import FinnhubFetcher
    rate_limiter.finnhub_cache.clear()
    payload = [{"buy": 10, "hold": 5, "sell": 1, "period": "2026-11-01", "symbol": "AAPL"}]
    with patch.object(FinnhubFetcher, "_make_request", side_effect=[payload, {"targetMean": 250.0}]):
        recs = FinnhubFetcher.get_recommendation_trends("AAPL", priority="high")
        target = FinnhubFetcher.get_price_target("AAPL", priority="high")
    assert recs == payload
    assert target == {"targetMean": 250.0}


# ---------------------------------------------------------------------------
# Bug 4: /feed/ticker/{T}
# ---------------------------------------------------------------------------

@pytest.fixture
def feed_client():
    from app.models.user import User
    from app.models.community import Community, Post, Vote
    from app.api import posts as posts_api
    from app.api.auth import get_current_user

    Session = _make_session([User, Community, Post, Vote])
    db = Session()

    app = FastAPI()
    app.include_router(posts_api.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: None
    try:
        yield TestClient(app), db
    finally:
        db.close()


def test_ticker_feed_empty_returns_200(feed_client):
    client, _ = feed_client
    r = client.get("/api/v1/feed/ticker/AAPL")
    assert r.status_code == 200, r.text
    assert r.json() == {"items": [], "next_cursor": None}


def test_ticker_feed_matches_exact_ticker_on_sqlite(feed_client):
    from app.models.user import User
    from app.models.community import Community, Post
    client, db = feed_client

    user = User(email="t@example.com", username="tester")
    db.add(user)
    db.flush()
    comm = Community(slug="stocks", name="Stocks", category="stocks",
                     created_by=user.id, settings={})
    db.add(comm)
    db.flush()
    db.add(Post(author_id=user.id, community_id=comm.id, title="AAPL + TSLA", tickers=["AAPL", "TSLA"]))
    db.add(Post(author_id=user.id, community_id=comm.id, title="AAP only", tickers=["AAP"]))
    db.commit()

    aapl = client.get("/api/v1/feed/ticker/aapl").json()["items"]
    assert [p["title"] for p in aapl] == ["AAPL + TSLA"]
    aap = client.get("/api/v1/feed/ticker/AAP").json()["items"]
    assert [p["title"] for p in aap] == ["AAP only"]
    assert client.get("/api/v1/feed/ticker/NVDA").json()["items"] == []


def test_ticker_filter_uses_any_on_postgres():
    from sqlalchemy.dialects import postgresql
    from app.api.posts import _tickers_contains
    fake_db = MagicMock()
    fake_db.get_bind.return_value.dialect.name = "postgresql"
    clause = _tickers_contains(fake_db, "AAPL")
    sql = str(clause.compile(dialect=postgresql.dialect()))
    assert "= ANY(posts.tickers)" in sql


# ---------------------------------------------------------------------------
# Bug 5: invalid tickers
# ---------------------------------------------------------------------------

@pytest.fixture
def prices_client(market_db):
    from app.api import prices as prices_api, symbols as symbols_api, risk as risk_api
    app = FastAPI()
    app.include_router(prices_api.router, prefix="/api/v1")
    app.include_router(symbols_api.router, prefix="/api/v1")
    app.include_router(risk_api.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: market_db
    return TestClient(app)


@pytest.mark.parametrize("path", [
    "/api/v1/prices/ZZZZZ",
    "/api/v1/symbols/ZZZZZ",
    "/api/v1/risk/ZZZZZ",
])
def test_unknown_ticker_404_no_row(prices_client, market_db, path):
    with patch("app.services.ticker_validation.ticker_exists_upstream", return_value=False), \
         patch("app.services.data_fetcher.DataFetcher.fetch_symbol_info") as info:
        r = prices_client.get(path)
    assert r.status_code == 404, r.text
    assert "Unknown ticker" in r.json()["detail"]
    info.assert_not_called()
    assert market_db.query(Symbol).count() == 0


def test_malformed_ticker_rejected(prices_client, market_db):
    with patch("app.services.ticker_validation.ticker_exists_upstream") as exists:
        r = prices_client.get("/api/v1/prices/BAD$TICKER")
    assert r.status_code == 404
    exists.assert_not_called()
    assert market_db.query(Symbol).count() == 0


def test_normalize_ticker_accepts_class_shares():
    from app.services.ticker_validation import normalize_ticker, UnknownTickerError
    assert normalize_ticker(" brk.b ") == "BRK.B"
    assert normalize_ticker("bf-b") == "BF-B"
    for bad in ("", "TOOLONGTICKER", "A B", "AAPL;", "../x"):
        with pytest.raises(UnknownTickerError):
            normalize_ticker(bad)


def test_valid_ticker_creates_row(market_db):
    from app.services.data_fetcher import DataFetcher
    with patch("app.services.ticker_validation.ticker_exists_upstream", return_value=True), \
         patch.object(DataFetcher, "fetch_symbol_info",
                      return_value={"symbol": "AAPL", "name": "Apple", "sector": None,
                                    "industry": None, "market_cap": None}):
        row = DataFetcher.sync_symbol_to_db(market_db, "aapl")
    assert row.symbol == "AAPL"
    assert market_db.query(Symbol).count() == 1


def test_company_profile_unknown_and_units():
    from app.api import enhanced_endpoints as ee
    with patch.object(ee.FinnhubFetcher, "get_company_profile", return_value={}), \
         patch("app.services.ticker_validation.ticker_exists_upstream", return_value=False):
        with pytest.raises(HTTPException) as exc:
            ee.get_company_profile("ZZZZZ", priority="normal")
    assert exc.value.status_code == 404

    profile = {"name": "Apple Inc", "ticker": "AAPL", "marketCapitalization": 3744658.5,
               "shareOutstanding": 14840.39}
    with patch.object(ee.FinnhubFetcher, "get_company_profile", return_value=profile), \
         patch.object(ee.FinnhubFetcher, "get_basic_financials", return_value={"metric": {}}):
        out = ee.get_company_profile("AAPL", priority="normal")
    assert out["market_cap"] == pytest.approx(3_744_658_500_000)
    assert out["shares_outstanding"] == pytest.approx(14_840_390_000)


def test_finviz_unknown_ticker_404():
    import requests
    from app.api import finviz as finviz_api
    resp = MagicMock(status_code=404)
    err = requests.exceptions.HTTPError("404 Client Error: Not Found", response=resp)
    with patch.object(finviz_api.finviz, "get_stock", side_effect=err):
        with pytest.raises(HTTPException) as exc:
            finviz_api.get_finviz_data("ZZZZZ")
    assert exc.value.status_code == 404


def test_finviz_header_fields_mapped_by_href():
    from lxml import html
    from app.api.finviz import _fix_header_fields
    page = html.fromstring(
        '<div class="quote-header_categories">'
        '<a href="/screener/stocks?v=111&f=sec_technology">Technology</a>'
        '<a href="/screener/stocks?v=111&f=industry_consumerelectronics">Consumer Electronics</a>'
        '<a href="/screener/stocks?v=111&f=geo_usa">USA</a>'
        '<a href="/screener/stocks?v=111&f=exch_nasd">NASD</a></div>'
    )
    shifted = {"Sector": "Technology", "Industry": "USA", "Country": ""}
    fixed = _fix_header_fields(shifted, page)
    assert fixed["Sector"] == "Technology"
    assert fixed["Industry"] == "Consumer Electronics"
    assert fixed["Country"] == "USA"


# ---------------------------------------------------------------------------
# Bug 6: /prices ordering, backfill and refresh
# ---------------------------------------------------------------------------

def _seed_bars(db, n, newest):
    sym = Symbol(symbol="AAPL", name="Apple")
    db.add(sym)
    db.flush()
    for i in range(n):
        ts = newest - timedelta(days=n - 1 - i)
        db.add(PriceBar(symbol_id=sym.id, timestamp=ts, open=1, high=1, low=1, close=float(i), volume=1))
    db.commit()
    return sym


def _call_prices(db, limit=500, auto_sync=True):
    from app.api.prices import get_prices
    return get_prices(symbol="AAPL", start=None, end=None, limit=limit, auto_sync=auto_sync, db=db)


@pytest.fixture(autouse=True)
def _reset_price_throttle():
    from app.api import prices as prices_api
    prices_api._last_sync_attempt.clear()
    yield
    prices_api._last_sync_attempt.clear()


def test_prices_keep_newest_bars_ascending(market_db):
    newest = datetime(2026, 11, 20)
    _seed_bars(market_db, 600, newest)
    bars = _call_prices(market_db, limit=500, auto_sync=False)
    assert len(bars) == 500
    ts = [b.timestamp for b in bars]
    assert ts == sorted(ts)
    assert ts[-1].replace(tzinfo=None) == newest  # newest bar not dropped
    assert bars[-1].close == 599.0


def test_prices_backfill_when_history_short(market_db):
    from app.services.data_fetcher import DataFetcher
    newest = datetime.now(timezone.utc).replace(tzinfo=None)
    _seed_bars(market_db, 63, newest)
    with patch.object(DataFetcher, "sync_price_data_to_db", return_value=0) as sync, \
         patch("app.api.prices._last_trading_day", return_value=newest.date()):
        _call_prices(market_db, limit=500)
    assert sync.call_count == 1
    _, _, start, end = sync.call_args.args
    assert (newest - start).days >= 700  # ~2y backfill
    assert end <= newest - timedelta(days=60)  # only the missing older span


def test_prices_refresh_when_stale(market_db):
    from app.services.data_fetcher import DataFetcher
    newest = datetime(2026, 11, 10)
    _seed_bars(market_db, 800, newest)  # long enough: no backfill
    with patch.object(DataFetcher, "sync_price_data_to_db", return_value=0) as sync, \
         patch("app.api.prices._last_trading_day", return_value=datetime(2026, 11, 24).date()):
        _call_prices(market_db, limit=500)
    assert sync.call_count == 1
    _, _, start, _ = sync.call_args.args
    assert start == newest - timedelta(days=5)


def test_prices_no_sync_when_fresh(market_db):
    from app.services.data_fetcher import DataFetcher
    newest = datetime(2026, 11, 24)
    _seed_bars(market_db, 800, newest)
    with patch.object(DataFetcher, "sync_price_data_to_db") as sync, \
         patch("app.api.prices._last_trading_day", return_value=newest.date()):
        _call_prices(market_db, limit=500)
    sync.assert_not_called()


def test_last_trading_day():
    from app.api.prices import _last_trading_day
    # Tue 2026-11-24 15:00 ET (20:00 UTC) -> session not closed -> Mon
    assert str(_last_trading_day(datetime(2026, 11, 24, 20, 0, tzinfo=timezone.utc))) == "2026-11-23"
    # Tue 2026-11-24 17:00 ET -> Tue
    assert str(_last_trading_day(datetime(2026, 11, 24, 22, 0, tzinfo=timezone.utc))) == "2026-11-24"
    # Sun -> Fri
    assert str(_last_trading_day(datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc))) == "2026-11-20"


# ---------------------------------------------------------------------------
# Bug 7: Public.com quote consistency
# ---------------------------------------------------------------------------

def test_public_quote_change_consistent_with_price():
    from app.services.public_client import _parse_quote
    raw = {
        "instrument": {"symbol": "NVDA"},
        "outcome": "SUCCESS",
        "last": 151.33,                      # extended-hours last
        "previousClose": 165.05,
        "oneDayChange": {"change": -9.67, "percentChange": -5.86},  # regular-session change
    }
    q = _parse_quote(raw)
    assert q["price"] == 151.33
    assert q["previous_close"] == 165.05
    assert q["change"] == pytest.approx(q["price"] - q["previous_close"], abs=0.01)
    assert q["change_percent"] == pytest.approx(q["change"] / q["previous_close"] * 100, abs=0.01)


def test_public_quote_prefers_regular_session_last():
    from app.services.public_client import _parse_quote
    raw = {"instrument": {"symbol": "NVDA"}, "outcome": "SUCCESS",
           "last": 151.33, "regularMarketLast": 155.38, "previousClose": 165.05}
    q = _parse_quote(raw)
    assert q["price"] == 155.38
    assert q["change"] == pytest.approx(-9.67, abs=0.01)


def test_public_quote_without_prev_close_has_no_bogus_change():
    from app.services.public_client import _parse_quote, _apply_previous_close
    q = _parse_quote({"instrument": {"symbol": "NVDA"}, "outcome": "SUCCESS", "last": 151.33})
    assert q["change"] == 0 and q["previous_close"] == 0
    _apply_previous_close(q, 165.05)
    assert q["change"] == pytest.approx(-13.72, abs=0.01)
    assert q["previous_close"] == 165.05
