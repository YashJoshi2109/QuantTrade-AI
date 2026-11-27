"""Copilot on-demand fundamentals / SEC statements sync.

Prod evaluation: for AMZN both get_fundamentals and get_financials errored
("no fundamentals for AMZN" / "not in data") because nobody had opened its
research page, which is what lazily syncs those tables.  The pack builder
(and the two tools) now trigger the same bounded sync and re-read once.
"""
from __future__ import annotations

import asyncio
import copy
import json
import threading
import time

import pytest

from app.services.copilot import data_sync
from app.services.copilot.context_pack import build_pack
from app.services.copilot.evalkit import FIXTURE_DATA, FixtureSources, ScriptedLLM, fixture_db
from app.services.copilot.registry import FactRegistry
from app.services.copilot.resolver import ResolvedTicker
from app.services.copilot.tools import ToolExecutor


def _data_without_amzn():
    data = json.loads(FIXTURE_DATA.read_text())
    full = copy.deepcopy(data["tickers"]["AMZN"])
    # the fixture has no AMZN statements; reuse another filer's rows as "what the sync fetched"
    full.setdefault("statements", copy.deepcopy(data["tickers"]["AAPL"]["statements"]))
    assert full.get("fundamentals") and full.get("statements")
    data["tickers"]["AMZN"].pop("fundamentals", None)
    data["tickers"]["AMZN"].pop("statements", None)
    return data, full


class SyncingSources(FixtureSources):
    """Fixture source whose AMZN fundamentals/statements only exist after a
    sync, like a ticker nobody has viewed yet."""

    def __init__(self, status="ok", delay_data=False):
        data, self.full = _data_without_amzn()
        super().__init__(data)
        self.status = status
        self.delay_data = delay_data
        self.synced = []

    async def sync(self, kind, ticker, budget=None):
        self.synced.append((kind, ticker))
        if not self.delay_data:
            self.publish(kind)
        return self.status

    def publish(self, kind):
        self.data["tickers"]["AMZN"][kind] = self.full[kind]


def _rt(sym="AMZN", asset_type="equity"):
    return ResolvedTicker(symbol=sym, name="Amazon.com, Inc.", asset_type=asset_type, source="explicit")


def test_pack_syncs_missing_fundamentals_and_statements_then_retries():
    src = SyncingSources()
    pack = asyncio.run(build_pack(_rt(), src, use_cache=False))
    assert sorted(src.synced) == [("fundamentals", "AMZN"), ("statements", "AMZN")]
    assert pack.fundamentals is not None and pack.fundamentals.pe_ratio is not None
    assert pack.statements
    assert "fundamentals" not in pack.errors and "statements" not in pack.errors
    # each loader ran twice: the miss, then the single retry
    assert [c for c in src.calls if c[0] == "fundamentals"] == [("fundamentals", "AMZN")] * 2


def test_no_sync_when_data_present():
    src = SyncingSources()
    src.publish("fundamentals")
    src.publish("statements")
    asyncio.run(build_pack(_rt(), src, use_cache=False))
    assert src.synced == []


def test_no_sync_for_etfs():
    src = SyncingSources()
    asyncio.run(build_pack(_rt("SPY", "etf"), src, use_cache=False))
    assert src.synced == []


def test_pending_sync_is_reported_and_tool_retries_once():
    src = SyncingSources(status="pending", delay_data=True)
    pack = asyncio.run(build_pack(_rt(), src, use_cache=False))
    assert pack.fundamentals is None
    assert "still running" in pack.errors["fundamentals"]
    # background sync finishes; the tool joins it and re-reads the DB
    src.delay_data = False
    src.status = "ok"
    ex = ToolExecutor(src, FactRegistry(), None, {"AMZN": pack}, None)
    content, facts, err = asyncio.run(ex.run("get_fundamentals", {"ticker": "AMZN"}))
    assert not err and facts[0].id == "fund:AMZN"
    content, facts, err = asyncio.run(ex.run("get_financials", {"ticker": "AMZN"}))
    assert not err and facts and facts[0].id.startswith("fs:AMZN:")
    assert ("fundamentals", "AMZN") in src.synced and ("statements", "AMZN") in src.synced


def test_copilot_answers_amzn_valuation_without_tool_errors():
    from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
    from app.services.copilot.memory import InMemoryStore
    src = SyncingSources()
    llm = ScriptedLLM([{"tool_calls": [{"name": "get_fundamentals", "args": {"ticker": "AMZN"}},
                                       {"name": "get_financials", "args": {"ticker": "AMZN"}}]},
                       {"text": "Amazon's P/E is in the data [fund:AMZN]."}])
    eng = CopilotEngine(fixture_db(src.data), sources=src, memory_store=InMemoryStore(),
                        llm_chain=[LLMHandle("scripted", "s", lambda: llm)], use_pack_cache=False)

    async def go():
        return [ev async for ev in eng.run(CopilotRequest(message="What is AMZN's P/E and EV/EBITDA?", user_id=1))]
    events = asyncio.run(go())
    tools = [d for n, d in events if n == "tool" and d.get("status") != "running"]
    assert tools and all(t["status"] == "done" for t in tools), tools
    ctx = next(d for n, d in events if n == "context")
    assert ctx["key_stats_id"] == "fund:AMZN" and ctx["latest_statement"]


# ── data_sync: thread, own session, budget, single flight, cool-down ────────

@pytest.fixture(autouse=True)
def _reset_sync():
    data_sync.reset()
    yield
    data_sync.reset()


def test_sync_runs_off_loop_with_its_own_session(monkeypatch):
    import app.db.database as dbmod
    from app.services import enhanced_data_fetcher as edf
    loop_thread = threading.get_ident()
    made = []

    class FakeSession:
        def __init__(self):
            self.thread = threading.get_ident()
            self.closed = False
            made.append(self)

        def close(self):
            self.closed = True

    seen = {}

    def fake_sync(symbol, db):
        seen["thread"] = threading.get_ident()
        seen["db"] = db
        return object()

    monkeypatch.setattr(dbmod, "SessionLocal", FakeSession)
    monkeypatch.setattr(edf.EnhancedDataFetcher, "sync_fundamentals", staticmethod(fake_sync))
    status = asyncio.run(data_sync.ensure("fundamentals", "amzn", budget=5))
    assert status == "ok"
    assert seen["thread"] != loop_thread                       # never on the event loop
    assert len(made) == 1 and seen["db"] is made[0]            # its own session ...
    assert made[0].thread == seen["thread"] and made[0].closed  # ... opened + closed in the worker


def test_statements_sync_uses_research_single_flight(monkeypatch):
    import app.api.research as research
    calls = []
    monkeypatch.setattr(research, "_sync_once", lambda t, wait=25.0: calls.append((t, wait)) or {"status": "ok"})
    assert asyncio.run(data_sync.ensure("statements", "AMZN", budget=5)) == "ok"
    assert calls == [("AMZN", 0.0)]


def test_budget_returns_pending_and_sync_keeps_running(monkeypatch):
    done = threading.Event()

    def slow(ticker):
        time.sleep(0.4)
        done.set()
        return "ok"

    monkeypatch.setitem(data_sync.SYNCERS, "fundamentals", slow)
    assert asyncio.run(data_sync.ensure("fundamentals", "AMZN", budget=0.05)) == "pending"
    assert done.wait(2.0)                                     # not cancelled by the timeout


def test_single_flight_and_cooldown(monkeypatch):
    n = []

    def once(ticker):
        n.append(ticker)
        time.sleep(0.1)
        return "ok"

    monkeypatch.setitem(data_sync.SYNCERS, "statements", once)

    async def two():
        return await asyncio.gather(data_sync.ensure("statements", "AMZN", 2),
                                    data_sync.ensure("statements", "AMZN", 2))
    assert asyncio.run(two()) == ["ok", "ok"]
    assert n == ["AMZN"]
    assert asyncio.run(data_sync.ensure("statements", "AMZN", 2)) == "skipped"


def test_sync_errors_are_contained(monkeypatch):
    def boom(ticker):
        raise RuntimeError("finviz 403")

    monkeypatch.setitem(data_sync.SYNCERS, "fundamentals", boom)
    assert asyncio.run(data_sync.ensure("fundamentals", "AMZN", 2)).startswith("error")


def test_yfinance_fallback_carries_ev_multiples(monkeypatch):
    import sys
    import types
    from app.services.finviz_fetcher import FinvizFetcher
    info = {"longName": "Amazon.com, Inc.", "marketCap": 2.3e12, "trailingPE": 38.0,
            "enterpriseValue": 2.4e12, "enterpriseToEbitda": 19.5, "enterpriseToRevenue": 3.6}
    fake = types.SimpleNamespace(Ticker=lambda s: types.SimpleNamespace(info=info))
    monkeypatch.setitem(sys.modules, "yfinance", fake)
    d = FinvizFetcher.fetch_yfinance_fundamentals("AMZN")
    assert (d["ev_to_ebitda"], d["ev_to_sales"], d["enterprise_value"]) == (19.5, 3.6, 2.4e12)
