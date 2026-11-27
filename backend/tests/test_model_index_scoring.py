"""AI Baskets (/ideas-lab, model-index refresh) scoring pipeline.

Prod bug (2026-11-26): every "Generate Basket" click answered
"No stocks scored successfully". DataCollector.collect_universe gathered 166
``collect_stock`` coroutines that shared one Session with the quote service's
``asyncio.to_thread`` worker; 164/166 stocks failed with
"This session is in 'prepared' state; no further SQL can be emitted" and were
silently scored as 0 % complete.

These tests pin: no concurrent use of the Session, one batched quote call,
DB fundamentals first with an external fallback, per-stock failure reasons,
and partial baskets instead of all-or-nothing.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.models.fundamentals import Fundamentals
from app.models.price import PriceBar
from app.models.quote_snapshot import QuoteSnapshot
from app.models.symbol import Symbol
from app.services.model_index import data_collector as dc_mod
from app.services.model_index.data_collector import DataCollector, summarize_collection
from app.services.model_index.factor_engine import FactorEngine
from app.services.model_index.orchestrator import Orchestrator

DB_TICKERS = ["AAPL", "MSFT", "JPM", "XOM", "KO", "PG", "NVDA", "UNH", "HD", "CAT",
              "LLY", "COST", "V", "MA", "PEP"]
FALLBACK_TICKERS = ["UBER", "VRTX", "D"]
EMPTY_TICKERS = ["ZZZZ"]  # in the symbols table, but no data anywhere
ALL = DB_TICKERS + FALLBACK_TICKERS + EMPTY_TICKERS


def _fund_fields(i: int) -> dict:
    return dict(
        company_name=f"Co {i}", pe_ratio=15 + i, forward_pe=14 + i, peg_ratio=1.2,
        profit_margin=10 + i, operating_margin=15 + i, roe=12 + i, roa=6 + i % 5,
        debt_to_equity=0.5 + i / 20, eps=3 + i / 4, revenue=1e10 + i * 1e9, beta=1.0 + i / 30,
        target_price=120 + i, recommendation="2.0", market_cap=1e11 + i * 1e10, price=100 + i,
        gross_margin=40.0, current_ratio=1.5,
    )


@pytest.fixture
def db(tmp_path):
    # File-backed SQLite with a real pool: the Session can be touched from the
    # quote service's worker thread exactly like Postgres in prod.
    eng = create_engine(f"sqlite:///{tmp_path / 'mi.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=eng, tables=[
        Symbol.__table__, Fundamentals.__table__, PriceBar.__table__, QuoteSnapshot.__table__,
    ])
    state = {"inflight": 0, "max_inflight": 0, "threads": set()}
    lock = threading.Lock()

    @event.listens_for(eng, "before_cursor_execute")
    def _before(*_a, **_k):
        with lock:
            state["inflight"] += 1
            state["max_inflight"] = max(state["max_inflight"], state["inflight"])
            state["threads"].add(threading.get_ident())
        time.sleep(0.001)  # widen the window so overlapping use is caught

    @event.listens_for(eng, "after_cursor_execute")
    def _after(*_a, **_k):
        with lock:
            state["inflight"] -= 1

    S = sessionmaker(bind=eng)
    s = S()
    rng = np.random.default_rng(7)
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    sym_id = 0
    for i, t in enumerate(["SPY"] + ALL):
        sym_id += 1
        s.add(Symbol(id=sym_id, symbol=t, name=f"{t} Inc", sector="Technology" if i % 2 else "Energy"))
        if t in DB_TICKERS:
            s.add(Fundamentals(symbol_id=sym_id, sector="Technology", **_fund_fields(i)))
        if t in DB_TICKERS[:6] or t == "SPY":
            px = 100.0
            for d in range(260):
                px *= 1 + rng.normal(0.0005, 0.012)
                s.add(PriceBar(symbol_id=sym_id, timestamp=start + timedelta(days=d), open=px,
                               high=px * 1.01, low=px * 0.99, close=px, volume=1_000_000))
    s.commit()
    s.state = state
    yield s
    s.close()


@pytest.fixture
def providers(monkeypatch):
    """Fake quote provider + yfinance fundamentals + in-memory Redis."""
    calls = {"quote_symbols": [], "fallback": []}

    async def fake_fetch_quote(self, symbol):
        calls["quote_symbols"].append(symbol)
        if symbol in EMPTY_TICKERS:
            return None
        return {"symbol": symbol, "price": 101.0, "change_percent": 0.5, "volume": 1e6, "market_cap": 5e10}

    async def no_tv(symbols):
        return {}

    from app.services import quote_cache, tradingview_fetcher
    monkeypatch.setattr(quote_cache.QuoteCacheService, "_fetch_quote", fake_fetch_quote)
    monkeypatch.setattr(tradingview_fetcher.TradingViewFetcher, "get_quotes_bulk", staticmethod(no_tv))

    def fake_yf(symbol):
        calls["fallback"].append(symbol)
        if symbol in FALLBACK_TICKERS:
            d = _fund_fields(3)
            d.update(symbol=symbol, sector="Healthcare", data_source="yfinance")
            return d
        return {"symbol": symbol, "error": "404 Not Found"}

    monkeypatch.setattr(dc_mod.FinvizFetcher, "fetch_yfinance_fundamentals", staticmethod(fake_yf))

    store: dict = {}

    class FakeCache:
        async def get(self, key):
            return store.get(key)

        async def set(self, key, value, ttl=60):
            store[key] = value

    import app.services.redis_cache_service as rcs
    monkeypatch.setattr(rcs, "cache_service", FakeCache())
    calls["store"] = store
    return calls


async def test_session_never_used_concurrently_and_quotes_batched(db, providers, monkeypatch):
    c = DataCollector(db)
    batches = []
    real = c.quote_service.get_quotes

    async def spy(symbols, force_refresh=False):
        batches.append(list(symbols))
        return await real(symbols, force_refresh)

    monkeypatch.setattr(c.quote_service, "get_quotes", spy)
    data = await c.collect_universe(ALL)

    assert db.state["max_inflight"] == 1, "request Session was used by two statements at once"
    assert len(batches) == 1 and set(batches[0]) == set(ALL), "quotes must be one batched call"
    assert not any("collect error" in (d.get("_failure_reason") or "") for d in data.values())
    for t in DB_TICKERS:
        assert data[t]["fundamentals_source"] == "db"
        assert data[t]["data_completeness"] >= 30


async def test_db_first_then_external_fallback(db, providers):
    c = DataCollector(db)
    data = await c.collect_universe(ALL)

    # External provider only asked about stocks without a DB fundamentals row.
    assert set(providers["fallback"]) == set(FALLBACK_TICKERS + EMPTY_TICKERS)
    for t in FALLBACK_TICKERS:
        assert data[t]["fundamentals_source"] == "yfinance"
        assert "_failure_reason" not in data[t]
    # Price history comes from DB price_bars.
    assert data["AAPL"]["rsi"] is not None and "price_bars" in data["AAPL"]["data_sources"]

    # Fallback results are cached: a second run does not hit the provider again.
    providers["fallback"].clear()
    await DataCollector(db).collect_universe(ALL)
    assert set(providers["fallback"]) == set(EMPTY_TICKERS)


async def test_per_stock_failure_reasons_are_logged(db, providers, caplog):
    caplog.set_level("INFO", logger="app.services.model_index.data_collector")
    c = DataCollector(db)
    data = await c.collect_universe(ALL)

    reason = data["ZZZZ"]["_failure_reason"]
    assert "no quote/price" in reason and "no fundamentals" in reason and "no price_bars" in reason
    assert "404 Not Found" in reason
    assert c.last_diagnostics["failed"] == 1
    assert c.last_diagnostics["scoreable"] == len(ALL) - 1
    assert "ZZZZ not scoreable" in caplog.text
    assert "stocks not scoreable; top reasons" in caplog.text


async def test_one_stock_crashing_does_not_sink_the_rest(db, providers, monkeypatch):
    c = DataCollector(db)
    real = c._assemble_stock

    def boom(ticker, *a, **k):
        if ticker == "MSFT":
            raise RuntimeError("provider exploded")
        return real(ticker, *a, **k)

    monkeypatch.setattr(c, "_assemble_stock", boom)
    data = await c.collect_universe(ALL)
    assert data["MSFT"]["_failure_reason"].startswith("collect error: RuntimeError")
    assert data["AAPL"]["data_completeness"] >= 30


def test_factor_scoring_error_skips_only_that_stock(monkeypatch):
    real = FactorEngine.score_stock

    def flaky(stock_data, *a, **k):
        if stock_data["ticker"] == "BAD":
            raise ZeroDivisionError("x")
        return real(stock_data, *a, **k)

    monkeypatch.setattr(FactorEngine, "score_stock", staticmethod(flaky))
    base = dict(price=100, market_cap=1e11, sector="Technology", **{k: v for k, v in _fund_fields(1).items()
                                                                    if k not in ("market_cap", "price")})
    universe = {t: {"ticker": t, **base, "data_completeness": 80.0} for t in ("GOOD", "BAD")}
    regime = {"regime": "neutral", "regime_label": "Neutral", "confidence": 50}
    scored = FactorEngine.score_universe(universe, regime, "balanced_core")
    assert set(scored) == {"GOOD"}
    assert "factor scoring error" in universe["BAD"]["_failure_reason"]


async def test_pipeline_returns_partial_basket_with_coverage(db, providers, monkeypatch):
    monkeypatch.setattr(dc_mod, "get_full_universe", lambda: list(ALL))
    snap = await Orchestrator(db).run_full_pipeline("qt_balanced_core", skip_monte_carlo=True,
                                                    skip_scenarios=True)
    assert "error" not in snap, snap.get("error")
    assert snap["num_holdings"] > 0
    cov = snap["data_coverage"]
    assert cov["universe_size"] == len(ALL)
    assert cov["partial"] is True and cov["scored"] == len(ALL) - 1
    assert cov["fallback_fundamentals"] == len(FALLBACK_TICKERS)


async def test_pipeline_error_explains_why_nothing_scored(db, providers, monkeypatch):
    async def nothing(self, tickers):
        return {}

    monkeypatch.setattr(DataCollector, "_safe_quotes", nothing)
    c = Orchestrator(db)
    # Only the empty ticker in the universe -> nothing can be scored.
    real = c.collector.collect_universe

    async def only_empty(tickers=None, **k):
        return await real(EMPTY_TICKERS, **k)

    monkeypatch.setattr(c.collector, "collect_universe", only_empty)
    snap = await c.run_full_pipeline("qt_balanced_core", skip_monte_carlo=True, skip_scenarios=True)
    assert snap["error"].startswith("No stocks scored: 0 of 1")
    assert "no fundamentals" in snap["error"]
    assert snap["data_coverage"]["scored"] == 0


def test_summarize_collection_groups_reasons():
    res = {
        "A": {"data_completeness": 10, "_failure_reason": "completeness 10% < 30% (no fundamentals, no price_bars)"},
        "B": {"data_completeness": 15, "_failure_reason": "completeness 15% < 30% (no fundamentals, no price_bars)"},
        "C": {"data_completeness": 90},
    }
    s = summarize_collection(res)
    assert s["scoreable"] == 1 and s["failed"] == 2
    assert s["top_reasons"][0] == {"reason": "no fundamentals, no price_bars", "count": 2}
