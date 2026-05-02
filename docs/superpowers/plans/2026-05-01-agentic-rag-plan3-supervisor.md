# Agentic RAG — Plan 3: LangGraph Supervisor + SSE Endpoint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the LangGraph supervisor, 6 agent nodes, context builder, Redis memory, market/news/macro tools, and a new SSE endpoint at POST /api/v1/copilot/stream that replaces the old Groq-based pipeline.

**Architecture:** LangGraph `StateGraph` manages the preparation pipeline (supervisor → parallel agents → merge → context builder). LLM streaming happens outside the graph in the SSE generator via `ChatBedrock.astream()`. Guardrails run post-stream inline. Old `copilot_stream.py` route is disconnected and the new route takes over.

**Tech Stack:** langgraph>=1.0.0, langchain-aws 1.x (ChatBedrock.astream), redis.asyncio, FastAPI StreamingResponse (SSE)

---

## File Map

**Created:**
- `backend/app/services/agentic/memory.py` — Redis sliding-window conversation memory
- `backend/app/services/agentic/context_builder.py` — token-budgeted context + citation assembly
- `backend/app/services/agentic/agents/__init__.py`
- `backend/app/services/agentic/agents/shared.py` — AgentResult dataclass, agent helper types
- `backend/app/services/agentic/agents/research.py` — Research agent
- `backend/app/services/agentic/agents/comparison.py` — Comparison agent
- `backend/app/services/agentic/agents/screener.py` — Screener agent
- `backend/app/services/agentic/agents/portfolio.py` — Portfolio agent
- `backend/app/services/agentic/agents/earnings.py` — Earnings agent
- `backend/app/services/agentic/agents/general.py` — General agent
- `backend/app/services/agentic/tools/market_tool.py` — realtime_quote, fundamentals, technicals
- `backend/app/services/agentic/tools/news_tool.py` — news tool
- `backend/app/services/agentic/tools/macro_tool.py` — macro data tool
- `backend/app/services/agentic/supervisor.py` — LangGraph StateGraph + CopilotState
- `backend/app/api/agentic_stream.py` — POST /api/v1/copilot/stream SSE endpoint
- Test files for each module

**Modified:**
- `backend/app/main.py` — include new agentic_stream router, disconnect old copilot/stream POST route
- `backend/app/api/copilot_stream.py` — remove conflicting POST /copilot/stream route (keep /copilot/usage)

---

## Task 1: Redis Conversation Memory

**Files:**
- Create: `backend/app/services/agentic/memory.py`
- Create: `backend/tests/agentic/test_memory.py`

- [ ] **Step 1: Create test file**

Create `backend/tests/agentic/test_memory.py`:

```python
"""Tests for Redis conversation memory (sliding window + Haiku compression)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_load_memory_returns_empty_on_miss():
    """load_memory() returns empty ConversationMemory when key not in Redis."""
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=None)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis):
        from app.services.agentic.memory import load_memory
        mem = await load_memory(user_id=1, conversation_id="conv-1")

    assert mem.turns == []
    assert mem.summary == ""


@pytest.mark.asyncio
async def test_load_memory_deserializes_json():
    """load_memory() deserializes stored JSON back to ConversationMemory."""
    import json
    stored = json.dumps({"turns": [{"role": "user", "content": "Hi"}], "summary": "greeting"})
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=stored)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis):
        from app.services.agentic.memory import load_memory
        mem = await load_memory(user_id=1, conversation_id="conv-1")

    assert len(mem.turns) == 1
    assert mem.turns[0]["role"] == "user"
    assert mem.summary == "greeting"


@pytest.mark.asyncio
async def test_save_turn_appends_and_stores():
    """save_turn() appends both user and assistant turns, persists to Redis."""
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock(return_value=True)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis):
        from app.services.agentic.memory import ConversationMemory, save_turn
        mem = ConversationMemory(turns=[], summary="")
        await save_turn(mem, "user", "Hello", user_id=1, conversation_id="conv-1")
        await save_turn(mem, "assistant", "Hi there", user_id=1, conversation_id="conv-1")

    assert len(mem.turns) == 2
    assert mock_redis.setex.call_count == 2


@pytest.mark.asyncio
async def test_save_turn_triggers_compression_at_8_turns():
    """save_turn() calls _compress_oldest_turns when turn count reaches 8."""
    import json
    turns = [{"role": "user", "content": f"msg {i}"} for i in range(7)]
    stored = json.dumps({"turns": turns, "summary": ""})
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(return_value=stored)
    mock_redis.setex = AsyncMock(return_value=True)

    mock_haiku_response = MagicMock()
    mock_haiku_response.content = "Compressed: user asked about stocks"
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_haiku_response)

    with patch("app.services.agentic.memory._redis_client", return_value=mock_redis), \
         patch("app.services.agentic.memory.get_llm_haiku", return_value=mock_llm):
        from app.services.agentic.memory import ConversationMemory, save_turn
        mem = ConversationMemory(turns=list(turns), summary="")
        # Adding the 8th turn should trigger compression of first 4
        await save_turn(mem, "assistant", "8th message", user_id=1, conversation_id="conv-1")

    # After compression: 4 oldest replaced by summary, plus new turn = 5 total
    assert len(mem.turns) <= 5
    assert mem.summary != ""
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_memory.py -v 2>&1 | head -15
```

- [ ] **Step 3: Create memory.py**

Create `backend/app/services/agentic/memory.py`:

```python
"""Redis sliding-window conversation memory.

Maintains last 8 turns verbatim.
After 8 turns: Claude Haiku summarizes oldest 4 into a 200-token summary.
Key: copilot:memory:{user_id}:{conversation_id}
TTL: 24 hours
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import redis.asyncio as aioredis

from app.config import settings
from app.services.agentic.bedrock_client import get_llm_haiku

logger = logging.getLogger(__name__)

MEMORY_TTL_SECONDS = 86400  # 24 hours
MAX_TURNS         = 8
COMPRESS_COUNT    = 4       # compress oldest N turns when limit reached

_COMPRESS_PROMPT = """\
Summarize the following conversation turns in 1-3 sentences (max 200 words).
Focus on: what the user was asking about, tickers/topics discussed, key insights given.

Turns:
{turns_text}

Summary:"""


@lru_cache(maxsize=1)
def _redis_client() -> aioredis.Redis:
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


@dataclass
class ConversationMemory:
    turns:   list[dict[str, str]] = field(default_factory=list)
    summary: str = ""


def _memory_key(user_id: int, conversation_id: str) -> str:
    return f"copilot:memory:{user_id}:{conversation_id}"


async def load_memory(user_id: int, conversation_id: str) -> ConversationMemory:
    """Load conversation memory from Redis. Returns empty memory on cache miss."""
    client = _redis_client()
    try:
        raw = await client.get(_memory_key(user_id, conversation_id))
        if raw:
            data = json.loads(raw)
            return ConversationMemory(
                turns=data.get("turns", []),
                summary=data.get("summary", ""),
            )
    except Exception as exc:
        logger.warning("Memory load failed: %s", exc)
    return ConversationMemory()


async def save_turn(
    mem: ConversationMemory,
    role: str,
    content: str,
    user_id: int,
    conversation_id: str,
) -> None:
    """Append turn to memory, compress if over limit, persist to Redis."""
    mem.turns.append({"role": role, "content": content})

    if len(mem.turns) >= MAX_TURNS and role == "assistant":
        await _compress_oldest_turns(mem)

    client = _redis_client()
    try:
        payload = json.dumps({"turns": mem.turns, "summary": mem.summary})
        await client.setex(
            _memory_key(user_id, conversation_id),
            MEMORY_TTL_SECONDS,
            payload,
        )
    except Exception as exc:
        logger.warning("Memory save failed: %s", exc)


async def _compress_oldest_turns(mem: ConversationMemory) -> None:
    """Haiku summarizes oldest COMPRESS_COUNT turns; replaces them with summary."""
    if len(mem.turns) < COMPRESS_COUNT:
        return

    oldest = mem.turns[:COMPRESS_COUNT]
    mem.turns = mem.turns[COMPRESS_COUNT:]

    turns_text = "\n".join(
        f"{t['role'].upper()}: {t['content'][:300]}" for t in oldest
    )
    if mem.summary:
        turns_text = f"[Prior summary: {mem.summary}]\n\n" + turns_text

    try:
        llm = get_llm_haiku()
        resp = await llm.ainvoke([
            ("human", _COMPRESS_PROMPT.format(turns_text=turns_text))
        ])
        mem.summary = resp.content[:500]
        logger.debug("Compressed %d turns into summary", COMPRESS_COUNT)
    except Exception as exc:
        logger.warning("Memory compression failed: %s", exc)
        # Fallback: keep a crude summary
        mem.summary = f"[Prior conversation: {len(oldest)} turns about financial analysis]"


def format_history_for_llm(mem: ConversationMemory) -> str:
    """Format memory into a string for inclusion in the LLM system prompt."""
    parts = []
    if mem.summary:
        parts.append(f"[Conversation summary]\n{mem.summary}")
    for t in mem.turns[-MAX_TURNS:]:
        parts.append(f"{t['role'].upper()}: {t['content'][:400]}")
    return "\n\n".join(parts) if parts else ""
```

- [ ] **Step 4: Run tests → pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_memory.py -v 2>&1 | tail -15
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add app/services/agentic/memory.py tests/agentic/test_memory.py
git commit -m "feat(supervisor): Redis sliding-window conversation memory with Haiku compression"
```

---

## Task 2: Context Builder

**Files:**
- Create: `backend/app/services/agentic/context_builder.py`
- Create: `backend/tests/agentic/test_context_builder.py`

- [ ] **Step 1: Create test file**

Create `backend/tests/agentic/test_context_builder.py`:

```python
"""Tests for token-budgeted context builder."""
import pytest
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_chunk(source_n: int, text: str = "x" * 200, score: float = 0.9) -> ChunkWithCitation:
    return ChunkWithCitation(
        text=text,
        citation_label=f"[Source {source_n}: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple Inc.", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=score,
    )


def test_build_context_includes_citations():
    """build_context() includes citation labels in output."""
    from app.services.agentic.context_builder import build_context
    chunks = [_make_chunk(1), _make_chunk(2)]
    ctx = build_context(chunks=chunks, live_data={}, history="")
    assert "[Source 1:" in ctx
    assert "[Source 2:" in ctx


def test_build_context_includes_live_data():
    """build_context() includes live market data section when provided."""
    from app.services.agentic.context_builder import build_context
    live = {"AAPL": {"price": 185.5, "change_pct": 1.2}}
    ctx = build_context(chunks=[], live_data=live, history="")
    assert "AAPL" in ctx
    assert "185.5" in ctx


def test_build_context_respects_token_budget():
    """build_context() truncates chunks to fit within token budget."""
    from app.services.agentic.context_builder import build_context, CHUNK_TOKEN_BUDGET
    # Create chunks that together exceed the budget
    big_text = "word " * 2000  # ~2000 tokens
    chunks = [_make_chunk(i, text=big_text) for i in range(1, 8)]
    ctx = build_context(chunks=chunks, live_data={}, history="")
    # Result should be within budget (approximate token count)
    approx_tokens = len(ctx.split()) * 1.3
    assert approx_tokens <= CHUNK_TOKEN_BUDGET * 1.2  # allow 20% overage for formatting


def test_build_context_includes_history():
    """build_context() appends conversation history when provided."""
    from app.services.agentic.context_builder import build_context
    history = "USER: What about AAPL risk?\nASSISTANT: Here is the analysis..."
    ctx = build_context(chunks=[], live_data={}, history=history)
    assert "AAPL risk" in ctx


def test_count_tokens_approximation():
    """count_tokens() returns reasonable approximation."""
    from app.services.agentic.context_builder import count_tokens
    text = "hello world " * 100  # 200 words
    tokens = count_tokens(text)
    # Should be roughly 200 * 1.3 = 260 tokens
    assert 200 <= tokens <= 350
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_context_builder.py -v 2>&1 | head -15
```

- [ ] **Step 3: Create context_builder.py**

Create `backend/app/services/agentic/context_builder.py`:

```python
"""Token-budgeted context assembly for the LLM node.

Assembles the system prompt context from:
  - Retrieved SEC filing chunks (with citations)
  - Live market data (quotes, fundamentals)
  - Conversation history (from Redis memory)

Token budget per slot (13,500 total):
  system base:       800
  agent instructions:200
  retrieved chunks: 6,000   <- CHUNK_TOKEN_BUDGET
  live market data:   800   <- LIVE_DATA_TOKEN_BUDGET
  conversation:     1,500   <- HISTORY_TOKEN_BUDGET
  format:             200
  response reserve: 4,000
"""
from __future__ import annotations

import logging
from typing import Any

from app.services.agentic.retrieval.parent_child import ChunkWithCitation

logger = logging.getLogger(__name__)

CHUNK_TOKEN_BUDGET     = 6_000
LIVE_DATA_TOKEN_BUDGET =   800
HISTORY_TOKEN_BUDGET   = 1_500

CITATION_SEPARATOR = "─" * 40


def count_tokens(text: str) -> int:
    """Approximate token count: word count * 1.3 (Sonnet tokenization approximation)."""
    return int(len(text.split()) * 1.3)


def _format_chunk(chunk: ChunkWithCitation, source_n: int) -> str:
    return (
        f"{chunk.citation_label}\n"
        f"{CITATION_SEPARATOR}\n"
        f"{chunk.text}\n"
        f"{CITATION_SEPARATOR}\n"
    )


def _format_live_data(live_data: dict[str, Any]) -> str:
    if not live_data:
        return ""
    lines = ["[LIVE MARKET DATA]"]
    for ticker, data in live_data.items():
        if isinstance(data, dict):
            price = data.get("price")
            chg   = data.get("change_pct")
            if price is not None:
                lines.append(f"{ticker}: ${price:.2f}  ({chg:+.2f}%)" if chg else f"{ticker}: ${price:.2f}")
            # Add fundamentals if present
            for key in ("pe_ratio", "eps", "revenue", "market_cap"):
                if key in data:
                    lines.append(f"  {key}: {data[key]}")
        else:
            lines.append(f"{ticker}: {data}")
    return "\n".join(lines)


def build_context(
    chunks: list[ChunkWithCitation],
    live_data: dict[str, Any],
    history: str,
) -> str:
    """Assemble token-budgeted context string for the LLM system prompt.

    Priority if over budget: live_data > chunks > history > format.
    """
    sections: list[str] = []

    # 1. Retrieved SEC chunks (token-budgeted)
    if chunks:
        chunk_parts: list[str] = []
        used_tokens = 0
        for i, chunk in enumerate(chunks, start=1):
            formatted = _format_chunk(chunk, i)
            chunk_tokens = count_tokens(formatted)
            if used_tokens + chunk_tokens > CHUNK_TOKEN_BUDGET:
                logger.debug(
                    "Chunk budget exhausted after %d/%d chunks", i - 1, len(chunks)
                )
                break
            chunk_parts.append(formatted)
            used_tokens += chunk_tokens
        if chunk_parts:
            sections.append("[RETRIEVED SEC FILINGS]\n" + "\n".join(chunk_parts))

    # 2. Live market data (always included if within budget)
    if live_data:
        live_str = _format_live_data(live_data)
        if count_tokens(live_str) <= LIVE_DATA_TOKEN_BUDGET:
            sections.append(live_str)
        else:
            # Truncate to budget
            words = live_str.split()
            budget_words = int(LIVE_DATA_TOKEN_BUDGET / 1.3)
            sections.append(" ".join(words[:budget_words]))

    # 3. Conversation history
    if history:
        hist_tokens = count_tokens(history)
        if hist_tokens <= HISTORY_TOKEN_BUDGET:
            sections.append(f"[CONVERSATION HISTORY]\n{history}")
        else:
            budget_words = int(HISTORY_TOKEN_BUDGET / 1.3)
            truncated = " ".join(history.split()[:budget_words])
            sections.append(f"[CONVERSATION HISTORY]\n{truncated}")

    return "\n\n".join(sections)
```

- [ ] **Step 4: Run tests → pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_context_builder.py -v 2>&1 | tail -12
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add app/services/agentic/context_builder.py tests/agentic/test_context_builder.py
git commit -m "feat(supervisor): token-budgeted context builder with citation formatting"
```

---

## Task 3: Market, News, Macro Tools

**Files:**
- Create: `backend/app/services/agentic/tools/market_tool.py`
- Create: `backend/app/services/agentic/tools/news_tool.py`
- Create: `backend/app/services/agentic/tools/macro_tool.py`
- Create: `backend/tests/agentic/test_market_tools.py`

- [ ] **Step 1: Read existing service clients to understand APIs**

Read these files to understand what's available:
- `backend/app/services/fmp_client.py` (first 60 lines)
- `backend/app/services/quote_cache.py` (first 40 lines)

- [ ] **Step 2: Create test file**

Create `backend/tests/agentic/test_market_tools.py`:

```python
"""Tests for market, news, and macro tools."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_get_realtime_quote_returns_dict():
    """get_realtime_quote() returns price data dict for a ticker."""
    mock_quote = {"price": 185.5, "change_pct": 1.2, "volume": 55000000}

    with patch("app.services.agentic.tools.market_tool.QuoteCacheService") as mock_qcs:
        mock_svc = MagicMock()
        mock_svc.get_quote = AsyncMock(return_value=mock_quote)
        mock_qcs.return_value = mock_svc

        from app.services.agentic.tools.market_tool import get_realtime_quote_impl

        result = await get_realtime_quote_impl("AAPL")

    assert result["price"] == pytest.approx(185.5)
    assert result["change_pct"] == pytest.approx(1.2)


@pytest.mark.asyncio
async def test_get_realtime_quote_handles_error():
    """get_realtime_quote() returns error dict on failure."""
    with patch("app.services.agentic.tools.market_tool.QuoteCacheService") as mock_qcs:
        mock_svc = MagicMock()
        mock_svc.get_quote = AsyncMock(side_effect=Exception("Finnhub timeout"))
        mock_qcs.return_value = mock_svc

        from app.services.agentic.tools.market_tool import get_realtime_quote_impl

        result = await get_realtime_quote_impl("AAPL")

    assert "error" in result


@pytest.mark.asyncio
async def test_get_news_returns_list():
    """get_news() returns list of news items."""
    mock_articles = [
        {"title": "Apple Reports Record Q4", "url": "https://example.com/1"},
        {"title": "AAPL Beats Estimates", "url": "https://example.com/2"},
    ]

    with patch("app.services.agentic.tools.news_tool._fetch_news",
               new_callable=AsyncMock, return_value=mock_articles):
        from app.services.agentic.tools.news_tool import get_news_impl

        result = await get_news_impl("AAPL", limit=2)

    assert len(result) == 2
    assert result[0]["title"] == "Apple Reports Record Q4"


@pytest.mark.asyncio
async def test_get_macro_data_returns_dict():
    """get_macro_data() returns macro indicators dict."""
    with patch("app.services.agentic.tools.macro_tool._fetch_fred",
               new_callable=AsyncMock, return_value={"GDP_GROWTH": 2.8, "CPI": 3.1}):
        from app.services.agentic.tools.macro_tool import get_macro_data_impl

        result = await get_macro_data_impl(["GDP_GROWTH", "CPI"])

    assert result["GDP_GROWTH"] == pytest.approx(2.8)
```

- [ ] **Step 3: Create market_tool.py**

Create `backend/app/services/agentic/tools/market_tool.py`:

```python
"""Market data tools — realtime quotes, fundamentals, technical indicators.

Wraps existing QuoteCacheService and fmp_client services.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


async def get_realtime_quote_impl(ticker: str) -> dict[str, Any]:
    """Fetch realtime quote for ticker. Returns dict with price, change_pct, volume."""
    try:
        from app.services.quote_cache import QuoteCacheService
        from app.db.database import SessionLocal
        with SessionLocal() as db:
            svc = QuoteCacheService(db)
            data = await svc.get_quote(ticker.upper())
            return data or {"ticker": ticker, "error": "no data"}
    except Exception as exc:
        logger.warning("Quote fetch failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "error": str(exc)}


async def get_fundamentals_impl(ticker: str) -> dict[str, Any]:
    """Fetch fundamental data (P/E, EPS, revenue) for ticker."""
    try:
        from app.services.fmp_client import get_fundamentals_snapshot
        data = get_fundamentals_snapshot(ticker.upper())
        return {"ticker": ticker, "fundamentals": data} if data else {"ticker": ticker}
    except Exception as exc:
        logger.warning("Fundamentals fetch failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "error": str(exc)}


@tool
async def get_realtime_quote(ticker: str) -> dict[str, Any]:
    """Get current stock price, change, and volume for a ticker symbol."""
    return await get_realtime_quote_impl(ticker)


@tool
async def get_fundamentals(ticker: str) -> dict[str, Any]:
    """Get fundamental metrics (P/E ratio, EPS, revenue) for a stock ticker."""
    return await get_fundamentals_impl(ticker)
```

- [ ] **Step 4: Create news_tool.py**

Create `backend/app/services/agentic/tools/news_tool.py`:

```python
"""News tool — recent market news and sentiment."""
from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.tools import tool

from app.config import settings

logger = logging.getLogger(__name__)

NEWSAPI_URL = "https://newsapi.org/v2/everything"


async def _fetch_news(ticker: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch recent news articles for ticker from NewsAPI."""
    api_key = getattr(settings, "NEWS_API_KEY", None) or getattr(settings, "NEWSAPI_KEY", None)
    if not api_key:
        return []
    params = {
        "q": ticker,
        "sortBy": "publishedAt",
        "pageSize": limit,
        "language": "en",
        "apiKey": api_key,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(NEWSAPI_URL, params=params)
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
        return [
            {
                "title":       a.get("title", ""),
                "description": a.get("description", ""),
                "url":         a.get("url", ""),
                "published_at": a.get("publishedAt", ""),
                "source":      a.get("source", {}).get("name", ""),
            }
            for a in articles
        ]


async def get_news_impl(ticker: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch news; gracefully returns empty list on failure."""
    try:
        return await _fetch_news(ticker, limit)
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", ticker, exc)
        return []


@tool
async def get_news(ticker: str, limit: int = 10) -> list[dict[str, Any]]:
    """Get recent news articles for a stock ticker. Returns title, description, url."""
    return await get_news_impl(ticker, limit)
```

- [ ] **Step 5: Create macro_tool.py**

Create `backend/app/services/agentic/tools/macro_tool.py`:

```python
"""Macro data tool — FRED economic indicators."""
from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain_core.tools import tool

from app.config import settings

logger = logging.getLogger(__name__)

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

INDICATOR_SERIES = {
    "GDP_GROWTH":   "A191RL1Q225SBEA",
    "CPI":          "CPIAUCSL",
    "FED_RATE":     "FEDFUNDS",
    "UNEMPLOYMENT": "UNRATE",
    "10Y_YIELD":    "DGS10",
    "VIX":          "VIXCLS",
}


async def _fetch_fred(indicators: list[str]) -> dict[str, Any]:
    """Fetch latest observation for each indicator from FRED."""
    api_key = getattr(settings, "FRED_API_KEY", None)
    if not api_key:
        return {ind: "API key not configured" for ind in indicators}

    results: dict[str, Any] = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for ind in indicators:
            series_id = INDICATOR_SERIES.get(ind)
            if not series_id:
                results[ind] = "Unknown indicator"
                continue
            params = {
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "limit": 1,
                "sort_order": "desc",
            }
            try:
                resp = await client.get(FRED_URL, params=params)
                resp.raise_for_status()
                obs = resp.json().get("observations", [])
                results[ind] = float(obs[0]["value"]) if obs else None
            except Exception as exc:
                logger.warning("FRED fetch failed for %s: %s", ind, exc)
                results[ind] = None
    return results


async def get_macro_data_impl(indicators: list[str]) -> dict[str, Any]:
    """Fetch macro indicators; gracefully handles failures."""
    try:
        return await _fetch_fred(indicators)
    except Exception as exc:
        logger.warning("Macro data fetch failed: %s", exc)
        return {ind: None for ind in indicators}


@tool
async def get_macro_data(indicators: list[str]) -> dict[str, Any]:
    """Get macroeconomic indicators from FRED. Available: GDP_GROWTH, CPI, FED_RATE, UNEMPLOYMENT, 10Y_YIELD, VIX."""
    return await get_macro_data_impl(indicators)
```

- [ ] **Step 6: Run tests → pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_market_tools.py -v 2>&1 | tail -12
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add app/services/agentic/tools/market_tool.py \
        app/services/agentic/tools/news_tool.py \
        app/services/agentic/tools/macro_tool.py \
        tests/agentic/test_market_tools.py
git commit -m "feat(supervisor): market/news/macro tools wrapping existing data services"
```

---

## Task 4: 6 Agent Functions + Shared Primitives

**Files:**
- Create: `backend/app/services/agentic/agents/__init__.py`
- Create: `backend/app/services/agentic/agents/shared.py`
- Create: `backend/app/services/agentic/agents/research.py`
- Create: `backend/app/services/agentic/agents/comparison.py`
- Create: `backend/app/services/agentic/agents/screener.py`
- Create: `backend/app/services/agentic/agents/portfolio.py`
- Create: `backend/app/services/agentic/agents/earnings.py`
- Create: `backend/app/services/agentic/agents/general.py`
- Create: `backend/tests/agentic/test_agents.py`

- [ ] **Step 1: Create test file**

Create `backend/tests/agentic/test_agents.py`:

```python
"""Tests for the 6 agent functions."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.agents.shared import AgentResult


def _make_state(intent: str = "STOCK_ANALYSIS", tickers: list = None) -> dict:
    return {
        "message": "What are Apple's risks in China?",
        "routing_decision": {
            "intent": intent,
            "primary_ticker": (tickers or ["AAPL"])[0] if tickers or ["AAPL"] else None,
            "all_tickers": tickers or ["AAPL"],
            "use_stock_context": True,
            "inject_general_knowledge": False,
        },
        "conversation_history": [],
        "active_agents": [],
        "agent_results": {},
        "all_chunks": [],
        "final_context": "",
        "response": "",
        "citations": [],
        "error": None,
    }


def _make_cwc():
    from app.services.agentic.retrieval.parent_child import ChunkWithCitation
    return ChunkWithCitation(
        text="Apple faces supply chain risk in China.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=0.92,
    )


@pytest.mark.asyncio
async def test_research_agent_calls_sec_search():
    """research agent calls search_sec_filings for the primary ticker."""
    state = _make_state()
    chunks = [_make_cwc()]

    with patch("app.services.agentic.agents.research._search_sec_filings_impl",
               new_callable=AsyncMock, return_value=chunks), \
         patch("app.services.agentic.agents.research.get_realtime_quote_impl",
               new_callable=AsyncMock, return_value={"price": 185.0}):
        from app.services.agentic.agents.research import run_research_agent
        result = await run_research_agent(state)

    assert isinstance(result, AgentResult)
    assert len(result.chunks) == 1
    assert result.chunks[0].ticker == "AAPL"


@pytest.mark.asyncio
async def test_comparison_agent_searches_each_ticker():
    """comparison agent calls search_sec_filings for each ticker."""
    state = _make_state(intent="COMPARISON", tickers=["AAPL", "MSFT"])

    def _make_cwc_for(ticker):
        from app.services.agentic.retrieval.parent_child import ChunkWithCitation
        return ChunkWithCitation(
            text=f"{ticker} risk section.",
            citation_label=f"[Source 1: {ticker} 10-K 2024]",
            ticker=ticker, company_name=ticker, filing_type="10-K",
            filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
            score=0.9,
        )

    call_count = 0
    async def _mock_search(query, tickers=None, **kwargs):
        nonlocal call_count
        call_count += 1
        return [_make_cwc_for((tickers or ["AAPL"])[0])]

    with patch("app.services.agentic.agents.comparison._search_sec_filings_impl",
               side_effect=_mock_search):
        from app.services.agentic.agents.comparison import run_comparison_agent
        result = await run_comparison_agent(state)

    assert call_count == 2  # one per ticker
    assert isinstance(result, AgentResult)


@pytest.mark.asyncio
async def test_general_agent_searches_without_ticker_filter():
    """general agent calls search_sec_filings with tickers=None."""
    state = _make_state(intent="GENERAL_ADVICE", tickers=[])
    state["routing_decision"]["use_stock_context"] = False
    state["routing_decision"]["inject_general_knowledge"] = True
    chunks = [_make_cwc()]

    captured_call = {}
    async def _mock_search(query, tickers=None, **kwargs):
        captured_call["tickers"] = tickers
        return chunks

    with patch("app.services.agentic.agents.general._search_sec_filings_impl",
               side_effect=_mock_search), \
         patch("app.services.agentic.agents.general.get_macro_data_impl",
               new_callable=AsyncMock, return_value={"FED_RATE": 5.25}):
        from app.services.agentic.agents.general import run_general_agent
        result = await run_general_agent(state)

    assert captured_call.get("tickers") is None or captured_call.get("tickers") == []
    assert isinstance(result, AgentResult)
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_agents.py -v 2>&1 | head -15
```

- [ ] **Step 3: Create agents package**

Create `backend/app/services/agentic/agents/__init__.py` (empty).

Create `backend/app/services/agentic/agents/shared.py`:

```python
"""Shared types for agent functions."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.agentic.retrieval.parent_child import ChunkWithCitation


@dataclass
class AgentResult:
    chunks:    list[ChunkWithCitation] = field(default_factory=list)
    live_data: dict[str, Any]          = field(default_factory=dict)
    error:     str | None              = None
```

Create `backend/app/services/agentic/agents/research.py`:

```python
"""Research agent — deep 10-K analysis for STOCK_ANALYSIS intent."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.market_tool import get_realtime_quote_impl, get_fundamentals_impl
from app.services.agentic.tools.news_tool import get_news_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_research_agent(state: dict) -> AgentResult:
    """Research agent: SEC filings + realtime quote + fundamentals + news."""
    routing = state.get("routing_decision", {})
    ticker  = routing.get("primary_ticker") or ""
    message = state.get("message", "")

    if not ticker:
        return AgentResult(error="No ticker for research agent")

    try:
        chunks_task = asyncio.create_task(
            _search_sec_filings_impl(
                query=message,
                tickers=[ticker],
                filing_types=["10-K", "10-Q"],
                limit=8,
            )
        )
        quote_task = asyncio.create_task(get_realtime_quote_impl(ticker))
        fund_task  = asyncio.create_task(get_fundamentals_impl(ticker))
        news_task  = asyncio.create_task(get_news_impl(ticker, limit=5))

        chunks, quote, fund, news = await asyncio.gather(
            chunks_task, quote_task, fund_task, news_task,
            return_exceptions=True,
        )

        live_data = {}
        if not isinstance(quote, Exception):
            live_data[ticker] = {**(quote or {}), "type": "quote"}
        if not isinstance(fund, Exception) and fund:
            live_data.setdefault(ticker, {}).update(fund.get("fundamentals", {}))
        if not isinstance(news, Exception):
            live_data["news"] = news

        return AgentResult(
            chunks=chunks if not isinstance(chunks, Exception) else [],
            live_data=live_data,
        )
    except Exception as exc:
        logger.error("Research agent failed for %s: %s", ticker, exc)
        return AgentResult(error=str(exc))
```

Create `backend/app/services/agentic/agents/comparison.py`:

```python
"""Comparison agent — multi-ticker parallel SEC + quote analysis."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.market_tool import get_realtime_quote_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_comparison_agent(state: dict) -> AgentResult:
    """Comparison agent: parallel SEC search + quotes for each ticker."""
    routing = state.get("routing_decision", {})
    tickers = routing.get("all_tickers") or []
    message = state.get("message", "")

    if len(tickers) < 2:
        return AgentResult(error=f"Comparison needs 2+ tickers, got {len(tickers)}")

    tasks = [
        _search_sec_filings_impl(query=message, tickers=[t], filing_types=["10-K", "10-Q"], limit=4)
        for t in tickers
    ]
    quote_tasks = [get_realtime_quote_impl(t) for t in tickers]

    results      = await asyncio.gather(*tasks, return_exceptions=True)
    quote_results = await asyncio.gather(*quote_tasks, return_exceptions=True)

    all_chunks = []
    for r in results:
        if not isinstance(r, Exception):
            all_chunks.extend(r)

    live_data = {}
    for ticker, q in zip(tickers, quote_results):
        if not isinstance(q, Exception):
            live_data[ticker] = q or {}

    return AgentResult(chunks=all_chunks, live_data=live_data)
```

Create `backend/app/services/agentic/agents/screener.py`:

```python
"""Screener agent — NL -> filter -> ranked universe."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_screener_agent(state: dict) -> AgentResult:
    """Screener agent: get top movers + relevant SEC search."""
    message = state.get("message", "")
    live_data: dict = {}

    try:
        from app.api.market import get_top_gainers, get_top_losers
        from app.db.database import SessionLocal
        async with asyncio.timeout(5.0):
            with SessionLocal() as db:
                gainers = await get_top_gainers(10, db)
                losers  = await get_top_losers(10, db)
        live_data["gainers"] = [g.dict() if hasattr(g, "dict") else g for g in (gainers or [])]
        live_data["losers"]  = [l.dict() if hasattr(l, "dict") else l for l in (losers or [])]
    except Exception as exc:
        logger.warning("Screener market data failed: %s", exc)
        live_data = {"gainers": [], "losers": []}

    chunks = await _search_sec_filings_impl(
        query=message, tickers=None, filing_types=["8-K"], limit=5
    )
    return AgentResult(chunks=chunks, live_data=live_data)
```

Create `backend/app/services/agentic/agents/portfolio.py`:

```python
"""Portfolio agent — holdings critique + risk analysis."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.market_tool import get_fundamentals_impl
from app.services.agentic.tools.macro_tool import get_macro_data_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_portfolio_agent(state: dict) -> AgentResult:
    """Portfolio agent: fundamentals for each mentioned ticker + macro context."""
    routing = state.get("routing_decision", {})
    tickers = routing.get("all_tickers") or []
    message = state.get("message", "")

    fund_tasks  = [get_fundamentals_impl(t) for t in tickers[:5]]
    macro_task  = asyncio.create_task(get_macro_data_impl(["FED_RATE", "10Y_YIELD", "VIX"]))
    chunks_task = asyncio.create_task(
        _search_sec_filings_impl(query=message, tickers=tickers or None,
                                 sections=["Risk Factors"], limit=6)
    )

    fund_results, macro, chunks = await asyncio.gather(
        asyncio.gather(*fund_tasks, return_exceptions=True),
        macro_task, chunks_task, return_exceptions=True,
    )

    live_data: dict = {}
    if isinstance(fund_results, list):
        for t, f in zip(tickers, fund_results):
            if not isinstance(f, Exception) and f:
                live_data[t] = f.get("fundamentals", {})
    if not isinstance(macro, Exception):
        live_data["macro"] = macro

    return AgentResult(
        chunks=chunks if not isinstance(chunks, Exception) else [],
        live_data=live_data,
    )
```

Create `backend/app/services/agentic/agents/earnings.py`:

```python
"""Earnings agent — calendar + guidance + estimates."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_earnings_agent(state: dict) -> AgentResult:
    """Earnings agent: SEC guidance sections + earnings data."""
    routing = state.get("routing_decision", {})
    tickers = routing.get("all_tickers") or []
    message = state.get("message", "")

    chunks = await _search_sec_filings_impl(
        query=message,
        tickers=tickers or None,
        filing_types=["10-Q", "8-K"],
        sections=["MD&A"],
        limit=8,
    )
    live_data: dict = {}
    # Try Finnhub earnings data if available
    for ticker in tickers[:3]:
        try:
            from app.services.fmp_client import get_fundamentals_snapshot
            snap = get_fundamentals_snapshot(ticker)
            if snap:
                live_data[ticker] = {"earnings_snapshot": snap}
        except Exception:
            pass

    return AgentResult(chunks=chunks, live_data=live_data)
```

Create `backend/app/services/agentic/agents/general.py`:

```python
"""General agent — education, market overview, macro context."""
from __future__ import annotations

import asyncio
import logging

from .shared import AgentResult
from app.services.agentic.tools.macro_tool import get_macro_data_impl
from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

logger = logging.getLogger(__name__)


async def run_general_agent(state: dict) -> AgentResult:
    """General agent: broad SEC search (no ticker filter) + macro data."""
    routing = state.get("routing_decision", {})
    message = state.get("message", "")

    chunks_task = asyncio.create_task(
        _search_sec_filings_impl(
            query=message,
            tickers=None,  # cross-company search
            filing_types=["10-K"],
            limit=6,
        )
    )
    macro_task = asyncio.create_task(
        get_macro_data_impl(["FED_RATE", "CPI", "GDP_GROWTH", "10Y_YIELD"])
    )

    chunks, macro = await asyncio.gather(chunks_task, macro_task, return_exceptions=True)

    live_data = {}
    if not isinstance(macro, Exception):
        live_data["macro"] = macro

    return AgentResult(
        chunks=chunks if not isinstance(chunks, Exception) else [],
        live_data=live_data,
    )
```

- [ ] **Step 4: Run tests → pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_agents.py -v 2>&1 | tail -15
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add app/services/agentic/agents/ tests/agentic/test_agents.py
git commit -m "feat(supervisor): 6 agent functions (research/comparison/screener/portfolio/earnings/general)"
```

---

## Task 5: LangGraph Supervisor

**Files:**
- Create: `backend/app/services/agentic/supervisor.py`
- Create: `backend/tests/agentic/test_supervisor.py`

- [ ] **Step 1: Create test file**

Create `backend/tests/agentic/test_supervisor.py`:

```python
"""Tests for LangGraph supervisor state machine."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.agents.shared import AgentResult
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_cwc(ticker: str = "AAPL") -> ChunkWithCitation:
    return ChunkWithCitation(
        text="Apple faces supply chain risks.",
        citation_label=f"[Source 1: {ticker} 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker=ticker, company_name=ticker, filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=0.9,
    )


def _make_routing(intent: str = "STOCK_ANALYSIS", ticker: str = "AAPL") -> dict:
    return {
        "intent": intent,
        "primary_ticker": ticker,
        "all_tickers": [ticker],
        "use_stock_context": True,
        "inject_general_knowledge": False,
    }


def test_supervisor_node_sets_active_agents_for_stock_analysis():
    """supervisor_node() sets active_agents=['research'] for STOCK_ANALYSIS."""
    from app.services.agentic.supervisor import supervisor_node

    state = {
        "message": "Analyze AAPL",
        "routing_decision": _make_routing("STOCK_ANALYSIS"),
        "conversation_history": [],
        "active_agents": [],
        "agent_results": {},
        "all_chunks": [],
        "final_context": "",
        "response": "",
        "citations": [],
        "error": None,
    }
    result = supervisor_node(state)
    assert "research" in result["active_agents"]


def test_supervisor_node_sets_comparison_agents():
    """supervisor_node() sets active_agents=['comparison'] for COMPARISON intent."""
    from app.services.agentic.supervisor import supervisor_node

    state = {
        "message": "Compare AAPL vs MSFT",
        "routing_decision": {**_make_routing("COMPARISON"), "all_tickers": ["AAPL", "MSFT"]},
        "conversation_history": [], "active_agents": [], "agent_results": {},
        "all_chunks": [], "final_context": "", "response": "", "citations": [], "error": None,
    }
    result = supervisor_node(state)
    assert "comparison" in result["active_agents"]


@pytest.mark.asyncio
async def test_parallel_dispatch_node_runs_all_active_agents():
    """parallel_dispatch_node() calls each active agent and collects results."""
    agent_result = AgentResult(chunks=[_make_cwc()], live_data={"AAPL": {"price": 185.0}})

    with patch("app.services.agentic.supervisor.AGENT_REGISTRY",
               {"research": AsyncMock(return_value=agent_result)}):
        from app.services.agentic.supervisor import parallel_dispatch_node

        state = {
            "message": "Analyze AAPL",
            "routing_decision": _make_routing(),
            "conversation_history": [],
            "active_agents": ["research"],
            "agent_results": {},
            "all_chunks": [],
            "final_context": "",
            "response": "",
            "citations": [],
            "error": None,
        }
        result = await parallel_dispatch_node(state)

    assert "research" in result["agent_results"]
    assert result["agent_results"]["research"].chunks[0].ticker == "AAPL"


@pytest.mark.asyncio
async def test_merge_node_deduplicates_chunks():
    """merge_node() deduplicates chunks with same citation_label across agents."""
    from app.services.agentic.supervisor import merge_node

    chunk = _make_cwc()
    state = {
        "message": "", "routing_decision": {}, "conversation_history": [],
        "active_agents": ["research"],
        "agent_results": {
            "research": AgentResult(chunks=[chunk, chunk]),  # duplicate
        },
        "all_chunks": [], "final_context": "", "response": "", "citations": [], "error": None,
    }
    result = await merge_node(state)
    # Dedup: same citation_label → should appear once
    labels = [c.citation_label for c in result["all_chunks"]]
    assert labels.count(chunk.citation_label) == 1


@pytest.mark.asyncio
async def test_context_builder_node_sets_final_context():
    """context_builder_node() sets final_context from chunks + live_data."""
    from app.services.agentic.supervisor import context_builder_node

    chunk = _make_cwc()
    state = {
        "message": "test", "routing_decision": {}, "conversation_history": [],
        "active_agents": ["research"],
        "agent_results": {
            "research": AgentResult(chunks=[chunk], live_data={"AAPL": {"price": 185.0}}),
        },
        "all_chunks": [chunk], "final_context": "", "response": "", "citations": [], "error": None,
    }
    result = await context_builder_node(state)
    assert "[Source 1:" in result["final_context"]
    assert "AAPL" in result["final_context"]
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_supervisor.py -v 2>&1 | head -15
```

- [ ] **Step 3: Create supervisor.py**

Create `backend/app/services/agentic/supervisor.py`:

```python
"""LangGraph supervisor state machine for the Agentic RAG Copilot.

Graph:
  START -> supervisor_node -> parallel_dispatch_node -> merge_node
        -> context_builder_node -> END

LLM streaming happens outside the graph in the SSE endpoint.

CopilotState fields:
  message              — raw user message
  routing_decision     — dict from CopilotRouter.route()
  conversation_history — list[dict] serialized turns
  active_agents        — list[str] agents to run
  agent_results        — dict[str, AgentResult] per-agent output
  all_chunks           — deduplicated ChunkWithCitation list
  final_context        — assembled context string for LLM
  response             — final response (set by SSE handler post-stream)
  citations            — list[dict] for frontend citation cards
  error                — error message if pipeline failed
"""
from __future__ import annotations

import asyncio
import logging
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.services.agentic.agents.shared import AgentResult
from app.services.agentic.agents.research   import run_research_agent
from app.services.agentic.agents.comparison import run_comparison_agent
from app.services.agentic.agents.screener   import run_screener_agent
from app.services.agentic.agents.portfolio  import run_portfolio_agent
from app.services.agentic.agents.earnings   import run_earnings_agent
from app.services.agentic.agents.general    import run_general_agent
from app.services.agentic.context_builder   import build_context
from app.services.agentic.retrieval.parent_child import ChunkWithCitation

logger = logging.getLogger(__name__)

# ── Agent registry ─────────────────────────────────────────────────────────────
AGENT_REGISTRY: dict = {
    "research":   run_research_agent,
    "comparison": run_comparison_agent,
    "screener":   run_screener_agent,
    "portfolio":  run_portfolio_agent,
    "earnings":   run_earnings_agent,
    "general":    run_general_agent,
}

# ── Intent → agents mapping ────────────────────────────────────────────────────
INTENT_TO_AGENTS: dict[str, list[str]] = {
    "STOCK_ANALYSIS":   ["research"],
    "COMPARISON":       ["comparison"],
    "SCREENER":         ["screener"],
    "PORTFOLIO_ADVICE": ["portfolio"],
    "EARNINGS":         ["earnings"],
    "GENERAL_ADVICE":   ["general"],
    "EDUCATION":        ["general"],
    "MARKET_OVERVIEW":  ["general"],
    "SECTOR":           ["general"],
    "TEXT":             ["general"],
    "GREETING":         ["general"],
    "OFF_TOPIC":        ["general"],
}

# ── State schema ───────────────────────────────────────────────────────────────
class CopilotState(TypedDict):
    message:              str
    routing_decision:     dict
    conversation_history: list[dict]
    active_agents:        list[str]
    agent_results:        dict[str, AgentResult]
    all_chunks:           list[ChunkWithCitation]
    final_context:        str
    response:             str
    citations:            list[dict]
    error:                str | None


# ── Graph nodes ────────────────────────────────────────────────────────────────

def supervisor_node(state: CopilotState) -> dict:
    """Route: pick active agents based on intent from routing_decision."""
    intent = state["routing_decision"].get("intent", "GENERAL_ADVICE")
    intent_str = intent.value if hasattr(intent, "value") else str(intent)
    active = INTENT_TO_AGENTS.get(intent_str, ["general"])

    # High-complexity STOCK_ANALYSIS may also run earnings agent
    rd = state["routing_decision"]
    if intent_str == "STOCK_ANALYSIS" and rd.get("use_stock_context"):
        if "earnings" not in active:
            active = list(active) + ["earnings"]

    logger.info("Supervisor: intent=%s → agents=%s", intent_str, active)
    return {"active_agents": active}


async def parallel_dispatch_node(state: CopilotState) -> dict:
    """Fan-out: run all active agents in parallel via asyncio.gather."""
    active = state.get("active_agents", ["general"])
    tasks  = [
        AGENT_REGISTRY[name](state)
        for name in active
        if name in AGENT_REGISTRY
    ]

    if not tasks:
        return {"agent_results": {}}

    results = await asyncio.gather(*tasks, return_exceptions=True)

    agent_results: dict[str, AgentResult] = {}
    for name, result in zip(active, results):
        if isinstance(result, Exception):
            logger.warning("Agent %s failed: %s", name, result)
            agent_results[name] = AgentResult(error=str(result))
        else:
            agent_results[name] = result

    return {"agent_results": agent_results}


async def merge_node(state: CopilotState) -> dict:
    """Merge + deduplicate chunks from all agents, build citations list."""
    seen_labels: set[str] = set()
    all_chunks:  list[ChunkWithCitation] = []

    for agent_result in state.get("agent_results", {}).values():
        if isinstance(agent_result, AgentResult) and agent_result.chunks:
            for chunk in agent_result.chunks:
                if chunk.citation_label not in seen_labels:
                    seen_labels.add(chunk.citation_label)
                    all_chunks.append(chunk)

    # Sort by score descending
    all_chunks.sort(key=lambda c: c.score, reverse=True)

    citations = [
        {
            "label":       c.citation_label,
            "ticker":      c.ticker,
            "filing_type": c.filing_type,
            "fiscal_year": c.fiscal_year,
            "section":     c.section,
            "filed_date":  c.filed_date,
            "score":       c.score,
        }
        for c in all_chunks
    ]

    return {"all_chunks": all_chunks, "citations": citations}


async def context_builder_node(state: CopilotState) -> dict:
    """Assemble token-budgeted context string for the LLM node."""
    # Aggregate live_data from all agents
    live_data: dict = {}
    for agent_result in state.get("agent_results", {}).values():
        if isinstance(agent_result, AgentResult):
            live_data.update(agent_result.live_data or {})

    history = ""
    for turn in state.get("conversation_history", []):
        role    = turn.get("role", "")
        content = turn.get("content", "")[:400]
        history += f"{role.upper()}: {content}\n\n"

    final_context = build_context(
        chunks=state.get("all_chunks", []),
        live_data=live_data,
        history=history.strip(),
    )

    return {"final_context": final_context}


# ── Compiled graph ─────────────────────────────────────────────────────────────

def _build_graph() -> StateGraph:
    g = StateGraph(CopilotState)
    g.add_node("supervisor_node",         supervisor_node)
    g.add_node("parallel_dispatch_node",  parallel_dispatch_node)
    g.add_node("merge_node",              merge_node)
    g.add_node("context_builder_node",    context_builder_node)

    g.add_edge(START,                    "supervisor_node")
    g.add_edge("supervisor_node",        "parallel_dispatch_node")
    g.add_edge("parallel_dispatch_node", "merge_node")
    g.add_edge("merge_node",             "context_builder_node")
    g.add_edge("context_builder_node",   END)
    return g


_compiled_graph = None


def get_compiled_graph():
    """Lazy-compile the LangGraph graph once."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_graph().compile()
    return _compiled_graph
```

- [ ] **Step 4: Run tests → pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_supervisor.py -v 2>&1 | tail -15
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add app/services/agentic/supervisor.py tests/agentic/test_supervisor.py
git commit -m "feat(supervisor): LangGraph StateGraph — supervisor+dispatch+merge+context nodes"
```

---

## Task 6: New SSE Endpoint

**Files:**
- Create: `backend/app/api/agentic_stream.py`
- Create: `backend/tests/agentic/test_agentic_stream.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/copilot_stream.py`

- [ ] **Step 1: Create test file**

Create `backend/tests/agentic/test_agentic_stream.py`:

```python
"""Tests for the new agentic SSE stream endpoint."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


def _make_final_state() -> dict:
    from app.services.agentic.retrieval.parent_child import ChunkWithCitation
    from app.services.agentic.agents.shared import AgentResult
    cwc = ChunkWithCitation(
        text="Apple faces supply chain risks.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", score=0.9,
    )
    return {
        "message": "Analyze AAPL",
        "routing_decision": {"intent": "STOCK_ANALYSIS", "primary_ticker": "AAPL",
                              "all_tickers": ["AAPL"], "use_stock_context": True},
        "conversation_history": [],
        "active_agents": ["research"],
        "agent_results": {"research": AgentResult(chunks=[cwc], live_data={})},
        "all_chunks": [cwc],
        "final_context": "[Source 1: AAPL 10-K 2024]\n---\nApple faces supply chain risks.",
        "response": "",
        "citations": [{"label": "[Source 1: AAPL 10-K 2024]", "ticker": "AAPL"}],
        "error": None,
    }


def test_guardrails_injects_disclaimer_when_missing():
    """apply_guardrails() adds disclaimer if not present in response."""
    from app.api.agentic_stream import apply_guardrails
    response = "Apple stock analysis here. Buy AAPL."
    result = apply_guardrails(response)
    assert "informational purposes" in result.lower() or "not financial advice" in result.lower()


def test_guardrails_does_not_duplicate_disclaimer():
    """apply_guardrails() does not add disclaimer if already present."""
    from app.api.agentic_stream import apply_guardrails
    response = "Analysis here. *This is AI-generated analysis for informational purposes only.*"
    result = apply_guardrails(response)
    count = result.lower().count("informational purposes")
    assert count == 1


def test_check_budget_raises_on_daily_limit():
    """_check_budget() raises HTTPException when user has hit free tier limit."""
    from app.api.agentic_stream import _check_budget
    from fastapi import HTTPException
    mock_db = MagicMock()
    with pytest.raises(HTTPException) as exc_info:
        _check_budget(user_id=99, db=mock_db, daily_count=6, daily_limit=5)
    assert exc_info.value.status_code == 429
```

- [ ] **Step 2: Create agentic_stream.py**

Create `backend/app/api/agentic_stream.py`:

```python
"""New Agentic RAG Copilot SSE Endpoint.

POST /api/v1/copilot/stream  (replaces old GROQ-based endpoint)

Flow:
  1. Auth + budget guard
  2. CopilotRouter.route() → RoutingDecision
  3. Load Redis memory
  4. Run LangGraph prep graph (supervisor → agents → merge → context)
  5. Stream Claude Sonnet response via ChatBedrock.astream()
  6. Apply guardrails inline
  7. Save to Redis memory + PostgreSQL chat history
  8. Emit citations + done events
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import require_auth
from app.db.database import get_db
from app.models.user import User
from app.services.agentic.bedrock_client import get_llm_sonnet
from app.services.agentic.memory import (
    ConversationMemory,
    format_history_for_llm,
    load_memory,
    save_turn,
)
from app.services.agentic.supervisor import CopilotState, get_compiled_graph
from app.services.copilot.router import CopilotRouter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["agentic-copilot"])

FREE_TIER_DAILY_LIMIT = 5
RATE_LIMIT_RPM        = 8

DISCLAIMER = (
    "\n\n*This is AI-generated analysis for informational purposes only. "
    "Not financial advice. Always consult a qualified financial professional.*"
)

SYSTEM_PROMPT_BASE = """\
You are QuantTrade AI Copilot — an institutional-grade financial analyst powered by \
quantitative models, real-time market data, and SEC filings.

Rules:
- ONLY use data provided in the context below — never hallucinate financial numbers
- Reference retrieved SEC sections as [Source N] inline
- Always end analysis with a risk disclaimer
- Be precise, structured, and cite sources

{agent_instructions}

{context}
"""


# ── Request model ──────────────────────────────────────────────────────────────
class AgenticStreamRequest(BaseModel):
    message: str
    symbol:          Optional[str] = None
    conversation_id: Optional[str] = None


# ── Budget guard ───────────────────────────────────────────────────────────────
def _check_budget(user_id: int, db: Session, daily_count: int, daily_limit: int) -> None:
    if daily_count >= daily_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily copilot limit reached ({daily_limit} requests/day on free tier). "
                   f"Upgrade to Pro for unlimited access.",
        )


def _get_daily_count(user_id: int, db: Session) -> int:
    """Count today's copilot requests for this user from chat history."""
    try:
        from app.models.chat_history import ChatHistory
        from sqlalchemy import func
        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        count = (
            db.query(func.count(ChatHistory.id))
            .filter(
                ChatHistory.user_id   == user_id,
                ChatHistory.role      == "user",
                ChatHistory.created_at >= today_start,
            )
            .scalar()
        )
        return count or 0
    except Exception:
        return 0


# ── Guardrails ─────────────────────────────────────────────────────────────────
def apply_guardrails(response: str) -> str:
    """Apply post-stream guardrails inline (never blocks, only fixes)."""
    lower = response.lower()
    # 1. Inject disclaimer if missing
    if "informational purposes" not in lower and "not financial advice" not in lower:
        response += DISCLAIMER
    return response


# ── SSE helper ─────────────────────────────────────────────────────────────────
def _sse(event: str, data) -> str:
    payload = json.dumps(data, default=str) if not isinstance(data, str) else data
    return f"event: {event}\ndata: {payload}\n\n"


# ── Main SSE generator ──────────────────────────────────────────────────────────
async def _stream_generator(
    req: AgenticStreamRequest,
    db: Session,
    user: User,
) -> AsyncGenerator[str, None]:
    """Main SSE generator: prep graph → Sonnet stream → guardrails → persist."""
    request_id      = str(uuid.uuid4())
    conversation_id = req.conversation_id or str(uuid.uuid4())

    # ── 1. Budget guard ────────────────────────────────────────────────────────
    daily_count = _get_daily_count(user.id, db)
    try:
        _check_budget(user.id, db, daily_count, FREE_TIER_DAILY_LIMIT)
    except HTTPException as e:
        yield _sse("error", {"message": e.detail})
        return

    # ── 2. Route ───────────────────────────────────────────────────────────────
    copilot_router   = CopilotRouter(db)
    routing_decision = copilot_router.route(req.message, explicit_symbol=req.symbol)

    rd_dict = {
        "intent":                routing_decision.intent.value
                                 if hasattr(routing_decision.intent, "value")
                                 else str(routing_decision.intent),
        "primary_ticker":        routing_decision.primary_ticker,
        "all_tickers":           routing_decision.all_tickers,
        "use_stock_context":     routing_decision.use_stock_context,
        "inject_general_knowledge": routing_decision.inject_general_knowledge,
    }
    yield _sse("intent", {"intent": rd_dict["intent"], "symbol": rd_dict["primary_ticker"]})

    # ── 3. Load memory ─────────────────────────────────────────────────────────
    memory: ConversationMemory = await load_memory(user.id, conversation_id)
    history_str = format_history_for_llm(memory)

    # ── 4. Run prep graph ──────────────────────────────────────────────────────
    yield _sse("tool_call", {"message": "Running analysis pipeline..."})

    initial_state: CopilotState = {
        "message":              req.message,
        "routing_decision":     rd_dict,
        "conversation_history": memory.turns[-8:],
        "active_agents":        [],
        "agent_results":        {},
        "all_chunks":           [],
        "final_context":        "",
        "response":             "",
        "citations":            [],
        "error":                None,
    }

    try:
        graph  = get_compiled_graph()
        state  = await graph.ainvoke(initial_state)
    except Exception as exc:
        logger.error("Prep graph failed: %s", exc)
        yield _sse("error", {"message": f"Analysis pipeline error: {exc}"})
        return

    final_context = state.get("final_context", "")
    citations     = state.get("citations", [])

    yield _sse("tool_result", {"message": f"Found {len(state.get('all_chunks', []))} relevant sections"})

    # Emit citations early (frontend can start rendering)
    for i, cit in enumerate(citations[:10]):
        yield _sse("citation", {**cit, "source_n": i + 1})

    # ── 5. Stream LLM response ────────────────────────────────────────────────
    system_prompt = SYSTEM_PROMPT_BASE.format(
        agent_instructions=f"You are answering a {rd_dict['intent']} query.",
        context=final_context,
    )
    messages = [
        ("system", system_prompt),
        ("human",  req.message),
    ]

    llm = get_llm_sonnet(streaming=True)
    full_response = ""

    try:
        async for chunk in llm.astream(messages):
            token = chunk.content if hasattr(chunk, "content") else str(chunk)
            if token:
                full_response += token
                yield _sse("token", {"text": token})
    except Exception as exc:
        logger.error("LLM stream failed: %s", exc)
        yield _sse("error", {"message": f"LLM streaming error: {exc}"})
        return

    # ── 6. Guardrails ─────────────────────────────────────────────────────────
    full_response = apply_guardrails(full_response)

    # ── 7. Save memory + chat history ─────────────────────────────────────────
    try:
        await save_turn(memory, "user",      req.message,   user.id, conversation_id)
        await save_turn(memory, "assistant", full_response, user.id, conversation_id)
    except Exception as exc:
        logger.warning("Memory save failed: %s", exc)

    try:
        from app.models.chat_history import ChatHistory, Conversation
        now = datetime.now(timezone.utc)

        conv = (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user.id)
            .first()
        )
        if not conv:
            conv = Conversation(id=conversation_id, user_id=user.id, title=req.message[:80])
            db.add(conv)
            db.flush()

        db.add_all([
            ChatHistory(user_id=user.id, session_id=request_id, conversation_id=conversation_id,
                        symbol=rd_dict["primary_ticker"], role="user",
                        content=req.message, created_at=now),
            ChatHistory(user_id=user.id, session_id=request_id, conversation_id=conversation_id,
                        symbol=rd_dict["primary_ticker"], role="assistant",
                        content=full_response, intent_type=rd_dict["intent"],
                        created_at=now),
        ])
        conv.updated_at = now
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Chat history save failed: %s", exc)

    # ── 8. Done ───────────────────────────────────────────────────────────────
    yield _sse("done", {
        "request_id":      request_id,
        "conversation_id": conversation_id,
        "citations":       citations,
    })


# ── Endpoint ───────────────────────────────────────────────────────────────────
@router.post("/stream")
async def agentic_stream(
    req: AgenticStreamRequest,
    db: Session   = Depends(get_db),
    user: User    = Depends(require_auth),
):
    """Agentic RAG copilot streaming endpoint. Returns Server-Sent Events."""
    return StreamingResponse(
        _stream_generator(req, db, user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection":    "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 3: Run unit tests → pass**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_agentic_stream.py -v 2>&1 | tail -15
```

Expected: 3 passed.

- [ ] **Step 4: Wire new router in main.py + disconnect old stream route**

Read `backend/app/main.py` around line 480-525 to see existing router includes.

In `backend/app/main.py`:

Add import after the existing agentic_copilot import:

```python
from app.api.agentic_stream import router as agentic_stream_router
```

Add include after the existing agentic_router include:

```python
app.include_router(agentic_stream_router, prefix="/api/v1")
```

In `backend/app/api/copilot_stream.py`, find and REMOVE (or comment out) the conflicting route:

```python
@router.post("/copilot/stream")
async def copilot_stream(...):
```

Replace the route decorator with a comment explaining it was replaced, but keep the `/copilot/usage` GET route intact. The body of the function can be removed to avoid any import errors from unused references.

Specifically, delete or comment out lines from `@router.post("/copilot/stream")` through the end of the `copilot_stream` function (but keep `@router.get("/copilot/usage")` and everything after it).

- [ ] **Step 5: Verify server starts cleanly**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -c "from app.main import app; print('OK')" 2>&1 | tail -5
```

Expected: `OK` (no import errors).

- [ ] **Step 6: Verify the new route is registered**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -c "
from app.main import app
routes = [r.path for r in app.routes if hasattr(r, 'path')]
for r in sorted(routes):
    if 'copilot' in r:
        print(r)
" 2>&1
```

Expected output includes `/api/v1/copilot/stream` (from new router).

- [ ] **Step 7: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add app/api/agentic_stream.py \
        app/api/copilot_stream.py \
        app/main.py \
        tests/agentic/test_agentic_stream.py
git commit -m "feat(supervisor): new agentic SSE endpoint at /api/v1/copilot/stream"
```

---

## Task 7: Full Pipeline Integration Test

**Files:**
- Create: `backend/tests/agentic/test_integration_supervisor.py`

- [ ] **Step 1: Create integration test**

Create `backend/tests/agentic/test_integration_supervisor.py`:

```python
"""Integration test: full supervisor pipeline with all external calls mocked."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.agents.shared import AgentResult
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_cwc() -> ChunkWithCitation:
    return ChunkWithCitation(
        text="Apple faces significant geographic concentration risk with China representing 19% of net sales.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple Inc.", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", score=0.95,
    )


@pytest.mark.asyncio
async def test_supervisor_graph_runs_end_to_end():
    """Full graph: supervisor → dispatch → merge → context_builder returns valid state."""
    chunk = _make_cwc()
    mock_agent_result = AgentResult(
        chunks=[chunk],
        live_data={"AAPL": {"price": 185.5, "change_pct": 1.2}},
    )

    with patch("app.services.agentic.supervisor.AGENT_REGISTRY",
               {
                   "research": AsyncMock(return_value=mock_agent_result),
                   "earnings": AsyncMock(return_value=AgentResult()),
               }):
        from app.services.agentic.supervisor import _build_graph

        graph = _build_graph().compile()
        state = await graph.ainvoke({
            "message":              "What are Apple's biggest risks in China?",
            "routing_decision":     {
                "intent": "STOCK_ANALYSIS",
                "primary_ticker": "AAPL",
                "all_tickers": ["AAPL"],
                "use_stock_context": True,
                "inject_general_knowledge": False,
            },
            "conversation_history": [],
            "active_agents":        [],
            "agent_results":        {},
            "all_chunks":           [],
            "final_context":        "",
            "response":             "",
            "citations":            [],
            "error":                None,
        })

    assert "research" in state["active_agents"] or "research" in state["agent_results"]
    assert len(state["all_chunks"]) >= 1
    assert "[Source 1:" in state["final_context"]
    assert "AAPL" in state["final_context"]
    assert len(state["citations"]) >= 1


@pytest.mark.asyncio
async def test_supervisor_handles_agent_failure_gracefully():
    """Graph continues even if one agent raises an exception."""
    with patch("app.services.agentic.supervisor.AGENT_REGISTRY",
               {"research": AsyncMock(side_effect=Exception("Qdrant timeout"))}):
        from app.services.agentic.supervisor import _build_graph

        graph = _build_graph().compile()
        state = await graph.ainvoke({
            "message":              "Analyze AAPL",
            "routing_decision":     {
                "intent": "STOCK_ANALYSIS",
                "primary_ticker": "AAPL",
                "all_tickers": ["AAPL"],
                "use_stock_context": True,
                "inject_general_knowledge": False,
            },
            "conversation_history": [],
            "active_agents":        [],
            "agent_results":        {},
            "all_chunks":           [],
            "final_context":        "",
            "response":             "",
            "citations":            [],
            "error":                None,
        })

    # Should not raise — error captured in agent_results
    assert "research" in state["agent_results"]
    assert state["agent_results"]["research"].error is not None
```

- [ ] **Step 2: Run integration tests**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_integration_supervisor.py -v 2>&1 | tail -15
```

Expected: 2 passed.

- [ ] **Step 3: Run full agentic test suite**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/ -v --tb=short 2>&1 | tail -25
```

Expected: all tests pass (~80+ total across both plans).

- [ ] **Step 4: Commit**

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
git add tests/agentic/test_integration_supervisor.py
git commit -m "test(supervisor): integration test — full LangGraph pipeline end-to-end"
```

---

## Self-Review Checklist

**Spec coverage:**
- LangGraph supervisor state machine: ✅ Task 5 (StateGraph with typed CopilotState)
- 6 sub-agents (research/comparison/screener/portfolio/earnings/general): ✅ Task 4
- parallel agent dispatch via asyncio.gather: ✅ supervisor.py `parallel_dispatch_node`
- Merge + dedup chunks: ✅ `merge_node`
- Token-budgeted context assembly: ✅ Task 2 (context_builder.py)
- Redis memory (sliding window + Haiku compression): ✅ Task 1
- SSE events (intent, tool_call, tool_result, citation, token, done): ✅ Task 6
- Budget guards (5 req/day free tier, 429 on limit): ✅ Task 6 (`_check_budget`)
- Claude Sonnet streaming via `llm.astream()`: ✅ Task 6
- Guardrail node (disclaimer injection): ✅ Task 6 (`apply_guardrails`)
- POST /api/v1/copilot/stream endpoint: ✅ Task 6 (agentic_stream.py)
- Old route disconnected: ✅ Task 6 (copilot_stream.py modified)
- Market/news/macro tools: ✅ Task 3

**Type consistency:**
- `AgentResult` defined in Task 4 (`agents/shared.py`), used in all 6 agents + supervisor
- `CopilotState` defined in Task 5 (`supervisor.py`), used in all graph nodes + SSE generator
- `ChunkWithCitation` from Plan 2 (`parent_child.py`), flows through agents → merge → context
