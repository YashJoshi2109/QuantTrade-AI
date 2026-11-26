"""Typed tools the answer model can call (max COPILOT_MAX_TOOL_ROUNDS rounds).

Most questions are answered from the ticker context pack that is already in
the prompt; tools exist for data that is not in it (another ticker, older
statements, filing text, macro, market movers).  Every tool result is a list
of facts with ids, registered for citation / grounding checks, and returned to
the model as JSON inside a <context> block (data, never instructions).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from app.services.copilot.models import Fact, TickerContextPack
from app.services.copilot.registry import FactRegistry

logger = logging.getLogger(__name__)

TOOL_TIMEOUT_S = 8.0
SYNC_BUDGET_S = 6.0          # a tool waiting on a fundamentals/SEC sync (inside TOOL_TIMEOUT_S)

_T = {"type": "string", "description": "Ticker symbol, e.g. AAPL or BRK.B"}

TOOL_SPECS: List[Dict[str, Any]] = [
    {"name": "get_quote", "description": "Latest price, change % and timestamp for a ticker.",
     "input_schema": {"type": "object", "properties": {"ticker": _T}, "required": ["ticker"], "additionalProperties": False}},
    {"name": "get_fundamentals", "description": "Valuation and key stats (P/E, EV/EBITDA, margins, market cap, analyst target) for a ticker.",
     "input_schema": {"type": "object", "properties": {"ticker": _T}, "required": ["ticker"], "additionalProperties": False}},
    {"name": "get_financials", "description": "SEC financial statements (last 8 fiscal quarters + 3 fiscal years, with margins and YoY growth) for a company.",
     "input_schema": {"type": "object", "properties": {"ticker": _T}, "required": ["ticker"], "additionalProperties": False}},
    {"name": "get_forecast", "description": "QuantTrade statistical price forecast: p10/p50/p90 bands for 1, 5, 20 trading days plus backtest skill.",
     "input_schema": {"type": "object", "properties": {"ticker": _T}, "required": ["ticker"], "additionalProperties": False}},
    {"name": "get_news", "description": "Classified news for a ticker from the last N days (impact, sentiment, category).",
     "input_schema": {"type": "object", "properties": {"ticker": _T, "days": {"type": "integer", "minimum": 1, "maximum": 14}},
                      "required": ["ticker"], "additionalProperties": False}},
    {"name": "search_filings", "description": "Search one company's SEC filings (10-K/10-Q/8-K) for passages. Always scoped to the given ticker.",
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "query": {"type": "string"},
         "filing_type": {"type": "string", "enum": ["10-K", "10-Q", "8-K"]},
         "section": {"type": "string", "enum": ["Business", "Risk Factors", "MD&A", "Quantitative Market Risk", "Financial Statements"]}},
         "required": ["ticker", "query"], "additionalProperties": False}},
    {"name": "compare_tickers", "description": "Side-by-side quote, key stats and latest statement for 2-3 tickers.",
     "input_schema": {"type": "object", "properties": {"tickers": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3}},
                      "required": ["tickers"], "additionalProperties": False}},
    {"name": "get_macro", "description": "Latest US macro indicators from FRED with observation dates.",
     "input_schema": {"type": "object", "properties": {"indicators": {"type": "array", "items": {
         "type": "string", "enum": ["FED_RATE", "10Y_YIELD", "CPI_YOY", "UNEMPLOYMENT", "GDP_GROWTH", "VIX"]}}},
         "required": ["indicators"], "additionalProperties": False}},
    {"name": "get_market_movers", "description": "Today's top gainers or losers, optionally filtered by sector and minimum market cap (USD).",
     "input_schema": {"type": "object", "properties": {
         "direction": {"type": "string", "enum": ["gainers", "losers"]},
         "sector": {"type": "string"}, "min_market_cap": {"type": "number"}},
         "required": ["direction"], "additionalProperties": False}},
]
TOOL_NAMES = {t["name"] for t in TOOL_SPECS}


def lc_tools() -> List[Dict[str, Any]]:
    """Anthropic-format tool dicts (accepted by bind_tools on Bedrock/Anthropic/OpenAI)."""
    return [{"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]} for t in TOOL_SPECS]


def _escape(s: str) -> str:
    # '<' inside data can never open/close a context tag
    return s.replace("<", "\\u003c").replace(">", "\\u003e")


def context_block(source: str, as_of: Optional[str], payload: Any) -> str:
    body = _escape(json.dumps(payload, default=str, separators=(",", ":")))
    return f'<context source="{source}" as_of="{as_of or "n/a"}">\n{body}\n</context>'


class ToolExecutor:
    def __init__(self, sources, registry: FactRegistry, resolver, packs: Dict[str, TickerContextPack],
                 build_pack):
        self.sources = sources
        self.registry = registry
        self.resolver = resolver           # TickerResolver (for symbol validation)
        self.packs = packs                 # already-built packs, reused
        self.build_pack = build_pack       # async (ResolvedTicker) -> pack
        self.calls: List[Dict[str, Any]] = []
        # Tool calls in one model turn run concurrently (asyncio.gather), but the
        # resolver uses the request's single SQLAlchemy Session, which must never
        # be used from two threads at once. Serialize the lookups.
        self._db_lock = asyncio.Lock()

    async def _pack(self, ticker: str) -> Optional[TickerContextPack]:
        from app.services.copilot.resolver import normalize_symbol
        t = normalize_symbol(ticker)
        if t in self.packs:
            return self.packs[t]
        async with self._db_lock:
            row = await asyncio.to_thread(self.resolver.lookup, t)
        if row is None:
            return None
        rt = self.resolver._make(row, t, "tool")
        pack = await self.build_pack(rt)
        self.packs[rt.symbol] = pack
        return pack

    async def _refill(self, pack: TickerContextPack, kind: str) -> None:
        """The pack was built without this section (its sync may still be
        running in the background): join/trigger the bounded sync, then
        re-read the DB once.  Equities only."""
        sync = getattr(self.sources, "sync", None)
        if pack.asset_type != "equity" or sync is None:
            return
        if pack.errors.get(kind, "").startswith("not applicable"):
            return
        status = await sync(kind, pack.ticker, SYNC_BUDGET_S)
        loader = self.sources.fundamentals if kind == "fundamentals" else self.sources.statements
        val = await loader(pack.ticker)
        if val:
            setattr(pack, kind, val)
            pack.errors.pop(kind, None)
            self.registry.add_all([val] if kind == "fundamentals" else val)
        elif status == "pending":
            pack.errors[kind] = "not in data yet (data sync still running; ask again shortly)"

    async def run(self, name: str, args: Dict[str, Any]) -> tuple[str, List[Fact], bool]:
        """Returns (tool_result_text, facts, is_error)."""
        if name not in TOOL_NAMES:
            return f"unknown tool {name}", [], True
        try:
            facts, payload = await asyncio.wait_for(self._dispatch(name, args or {}), TOOL_TIMEOUT_S)
        except asyncio.TimeoutError:
            return f"{name} timed out", [], True
        except LookupError as e:
            return str(e), [], True
        except Exception as e:
            logger.warning("tool %s failed: %s", name, e)
            return f"{name} unavailable ({type(e).__name__})", [], True
        self.registry.add_all(facts)
        as_of = max((f.as_of or "" for f in facts), default="") or None
        return context_block(f"tool:{name}", as_of, payload), facts, False

    async def _dispatch(self, name: str, a: Dict[str, Any]):
        if name == "get_macro":
            facts = await self.sources.macro(list(a.get("indicators") or []))
            if not facts:
                raise LookupError("macro data not available (FRED not configured or no observations)")
            return facts, [f.model_dump(exclude_none=True) for f in facts]
        if name == "get_market_movers":
            f = await self.sources.movers(a.get("direction", "losers"), a.get("sector"), a.get("min_market_cap"))
            if f is None:
                raise LookupError("market movers not available")
            return [f], f.model_dump(exclude_none=True)
        if name == "compare_tickers":
            packs = [await self._pack(t) for t in (a.get("tickers") or [])[:3]]
            missing = [t for t, p in zip(a.get("tickers") or [], packs) if p is None]
            if missing:
                raise LookupError(f"unknown ticker(s): {', '.join(missing)}")
            facts, rows = [], []
            for p in packs:
                for f in (p.quote, p.fundamentals, p.statements[0] if p.statements else None):
                    if f is not None:
                        facts.append(f)
                rows.append({"ticker": p.ticker, "quote": p.quote.model_dump(exclude_none=True) if p.quote else None,
                             "fundamentals": p.fundamentals.model_dump(exclude_none=True) if p.fundamentals else None,
                             "latest_statement": p.statements[0].model_dump(exclude_none=True) if p.statements else None})
            return facts, rows

        ticker = a.get("ticker") or ""
        pack = await self._pack(ticker)
        if pack is None:
            raise LookupError(f"ticker {ticker!r} not found in our symbol universe")
        t = pack.ticker
        # section missing from the pack: join/trigger its sync, re-read once
        if name == "get_fundamentals" and pack.fundamentals is None:
            await self._refill(pack, "fundamentals")
        elif name == "get_financials" and not pack.statements:
            await self._refill(pack, "statements")

        if name == "get_quote":
            if pack.quote is None:
                raise LookupError(f"no quote for {t}: {pack.errors.get('quote', 'not in data')}")
            return [pack.quote], pack.quote.model_dump(exclude_none=True)
        if name == "get_fundamentals":
            if pack.fundamentals is None:
                raise LookupError(f"no fundamentals for {t}")
            return [pack.fundamentals], pack.fundamentals.model_dump(exclude_none=True)
        if name == "get_financials":
            if not pack.statements:
                raise LookupError(f"no SEC financial statements for {t}: {pack.errors.get('statements', 'not in data')}")
            return list(pack.statements), [s.model_dump(exclude_none=True) for s in pack.statements]
        if name == "get_forecast":
            if pack.forecast is None:
                raise LookupError(f"no forecast for {t} yet ({pack.errors.get('forecast', 'not computed')})")
            return [pack.forecast], pack.forecast.model_dump(exclude_none=True)
        if name == "get_news":
            days = int(a.get("days") or 7)
            news = pack.news if days == 7 else await self.sources.news(t, days=days)
            return list(news), [n.model_dump(exclude_none=True) for n in news]
        if name == "search_filings":
            if pack.asset_type != "equity":
                raise LookupError(f"{t} is an {pack.asset_type}; it has no SEC company filings")
            ft = [a["filing_type"]] if a.get("filing_type") else None
            chunks = await self.sources.filings(t, a.get("query") or "", filing_types=ft,
                                                section=a.get("section"), limit=4)
            return list(chunks), [c.model_dump(exclude_none=True) for c in chunks]
        raise LookupError(f"unhandled tool {name}")
