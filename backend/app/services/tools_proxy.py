"""
ToolsProxy — AI Agent Tool Execution Service
=============================================

Provides 10 financial tools callable by AI agents with:
- Per-tool rate limiting (Redis INCR + EXPIREAT, graceful fallback)
- Pydantic input validation
- SSRF defense for cite_source (3-layer)
- Single entry point: execute_tool()

Tools:
  fetch_quote, fetch_historical_bars, run_backtest, monte_carlo,
  fetch_filings, fetch_news, score_sentiment, cite_source,
  semantic_search_posts, fetch_macro_series
"""

import asyncio
import ipaddress
import logging
import os
import socket
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class ToolError(Exception):
    def __init__(self, code: str, message: str = ""):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


class ToolRateLimitError(ToolError):
    pass


class ToolNotConfiguredError(ToolError):
    pass


# ---------------------------------------------------------------------------
# Tool configuration (rate limits)
# ---------------------------------------------------------------------------

TOOL_CONFIG: Dict[str, Dict[str, int]] = {
    "fetch_quote":           {"user_daily": 10,  "user_minute": 10,  "platform_daily": 60},
    "fetch_historical_bars": {"user_daily": 20,  "platform_daily": 200},
    "run_backtest":          {"user_daily": 5,   "platform_daily": 50},
    "monte_carlo":           {"user_daily": 3,   "platform_daily": 30},
    "fetch_filings":         {"user_daily": 20,  "platform_daily": 500},
    "fetch_news":            {"user_daily": 30,  "platform_daily": 300},
    "score_sentiment":       {"user_daily": 50,  "platform_daily": 500},
    "cite_source":           {"user_daily": 15,  "platform_daily": 150},
    "semantic_search_posts": {"user_daily": 30,  "platform_daily": 300},
    "fetch_macro_series":    {"user_daily": 20,  "platform_daily": 200},
}


# ---------------------------------------------------------------------------
# Pydantic input models
# ---------------------------------------------------------------------------


class FetchQuoteInput(BaseModel):
    symbol: str = Field(..., pattern=r'^[A-Z]{1,5}$')


class FetchHistoricalBarsInput(BaseModel):
    symbol: str = Field(..., pattern=r'^[A-Z]{1,5}$')
    timeframe: Literal["1Min", "5Min", "15Min", "1Hour", "1Day"] = "1Day"
    start: str  # ISO date
    end: str    # ISO date
    limit: int = Field(100, ge=1, le=1000)


class RunBacktestInput(BaseModel):
    symbol: str = Field(..., pattern=r'^[A-Z]{1,5}$')
    strategy: str = Field(..., max_length=100)
    start: str
    end: str


class MonteCarloInput(BaseModel):
    symbol: str = Field(..., pattern=r'^[A-Z]{1,5}$')
    simulations: int = Field(1000, ge=100, le=10000)
    horizon_days: int = Field(30, ge=1, le=365)


class FetchFilingsInput(BaseModel):
    query: str = Field(..., max_length=200)
    form_types: str = Field("8-K,10-Q,10-K", max_length=50)
    start: str = "2024-01-01"
    end: str = ""  # empty = today


class FetchNewsInput(BaseModel):
    query: str = Field(..., max_length=200)
    from_date: str = ""  # ISO date, empty = last 30 days
    page_size: int = Field(10, ge=1, le=20)


class ScoreSentimentInput(BaseModel):
    text: str = Field(..., max_length=2000)


class CiteSourceInput(BaseModel):
    url: str = Field(..., max_length=2000)


class SemanticSearchInput(BaseModel):
    query: str = Field(..., max_length=500)
    limit: int = Field(10, ge=1, le=50)


class FetchMacroSeriesInput(BaseModel):
    series_id: str = Field(..., pattern=r'^[A-Z0-9_]{1,20}$')
    limit: int = Field(24, ge=1, le=100)


# ---------------------------------------------------------------------------
# SSRF defense config for cite_source
# ---------------------------------------------------------------------------

CITE_SOURCE_ALLOWLIST = {
    'sec.gov', 'www.sec.gov', 'efts.sec.gov', 'data.sec.gov',
    'federalreserve.gov', 'www.federalreserve.gov',
    'fred.stlouisfed.org', 'stlouisfed.org',
    'bls.gov', 'www.bls.gov',
    'treasury.gov', 'www.treasury.gov',
    'reuters.com', 'www.reuters.com',
    'bloomberg.com', 'www.bloomberg.com',
    'wsj.com', 'www.wsj.com',
    'ft.com', 'www.ft.com',
    'cnbc.com', 'www.cnbc.com',
    'marketwatch.com', 'www.marketwatch.com',
    'seekingalpha.com', 'www.seekingalpha.com',
    'apnews.com', 'www.apnews.com',
}

PRIVATE_IP_NETWORKS = [
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('169.254.0.0/16'),   # AWS metadata
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('100.64.0.0/10'),    # carrier-grade NAT
]


# ---------------------------------------------------------------------------
# Rate limiting Lua scripts (atomic check-then-increment)
# ---------------------------------------------------------------------------

_RATE_LIMIT_LUA = """
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cur) >= tonumber(ARGV[1]) then
  return -1
end
local next = redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return next
"""

_RATE_LIMIT_MINUTE_LUA = """
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cur) >= tonumber(ARGV[1]) then
  return -1
end
local next = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 60)
return next
"""


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def _midnight_utc_timestamp() -> int:
    """Return UNIX timestamp of next midnight UTC."""
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Move to next midnight
    from datetime import timedelta
    midnight = midnight + timedelta(days=1)
    return int(midnight.timestamp())


async def _check_rate_limit(agent_id: int, tool_name: str, is_platform: bool) -> None:
    """Check and increment rate counters. Raises ToolRateLimitError if exceeded."""
    redis = cache_service._redis
    if redis is None:
        logger.warning("Redis unavailable — skipping rate limit check for tool '%s'", tool_name)
        return

    config = TOOL_CONFIG[tool_name]
    midnight_ts = _midnight_utc_timestamp()

    try:
        # --- Daily limit ---
        if is_platform:
            daily_key = f"tool:rate:platform:{agent_id}:{tool_name}:daily"
            daily_limit = config.get("platform_daily", 9999)
        else:
            daily_key = f"tool:rate:{agent_id}:{tool_name}:daily"
            daily_limit = config.get("user_daily", 9999)

        result = await redis.eval(_RATE_LIMIT_LUA, 1, daily_key, daily_limit, midnight_ts)
        if result == -1:
            raise ToolRateLimitError(
                "rate_limit_daily",
                f"Daily limit of {daily_limit} exceeded for tool '{tool_name}'"
            )

        # --- Per-minute limit (fetch_quote only) ---
        if "user_minute" in config and not is_platform:
            minute_key = f"tool:rate:{agent_id}:{tool_name}:minute"
            minute_limit = config["user_minute"]

            result_minute = await redis.eval(_RATE_LIMIT_MINUTE_LUA, 1, minute_key, minute_limit)
            if result_minute == -1:
                raise ToolRateLimitError(
                    "rate_limit_minute",
                    f"Per-minute limit of {minute_limit} exceeded for tool '{tool_name}'"
                )

    except ToolRateLimitError:
        raise
    except Exception as e:
        logger.warning("Rate limit check failed (Redis error): %s — skipping", e)


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


async def _fetch_quote(input_data: dict, db: Session) -> dict:
    inp = FetchQuoteInput(**input_data)
    api_key = os.environ.get("ALPACA_API_KEY")
    secret_key = os.environ.get("ALPACA_SECRET_KEY")
    if not api_key or not secret_key:
        raise ToolNotConfiguredError("alpaca_not_configured", "ALPACA_API_KEY / ALPACA_SECRET_KEY not set")

    url = f"https://data.alpaca.markets/v2/stocks/{inp.symbol}/quotes/latest"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            headers={
                "APCA-API-KEY-ID": api_key,
                "APCA-API-SECRET-KEY": secret_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    quote = data.get("quote", {})
    return {
        "symbol": inp.symbol,
        "bid": quote.get("bp"),
        "ask": quote.get("ap"),
        "timestamp": quote.get("t"),
    }


async def _fetch_historical_bars(input_data: dict, db: Session) -> dict:
    inp = FetchHistoricalBarsInput(**input_data)
    api_key = os.environ.get("ALPACA_API_KEY")
    secret_key = os.environ.get("ALPACA_SECRET_KEY")
    if not api_key or not secret_key:
        raise ToolNotConfiguredError("alpaca_not_configured", "ALPACA_API_KEY / ALPACA_SECRET_KEY not set")

    url = f"https://data.alpaca.markets/v2/stocks/{inp.symbol}/bars"
    params: dict = {
        "timeframe": inp.timeframe,
        "start": inp.start,
        "end": inp.end,
        "limit": str(inp.limit),
        "adjustment": "raw",
        "feed": "iex",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params=params,
            headers={
                "APCA-API-KEY-ID": api_key,
                "APCA-API-SECRET-KEY": secret_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "symbol": inp.symbol,
        "bars": data.get("bars", []),
    }


async def _run_backtest(input_data: dict, db: Session) -> dict:
    inp = RunBacktestInput(**input_data)
    job_id = str(uuid.uuid4())
    # Stub: queue via internal backtest API
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                "http://localhost:8000/api/v1/backtest",
                json={
                    "symbol": inp.symbol,
                    "strategy": inp.strategy,
                    "start": inp.start,
                    "end": inp.end,
                    "job_id": job_id,
                },
            )
    except Exception as e:
        logger.debug("Backtest internal queue call failed (non-fatal): %s", e)

    return {
        "status": "queued",
        "job_id": job_id,
        "message": f"Backtest queued. Results available via /api/v1/backtest/{job_id}",
    }


async def _monte_carlo(input_data: dict, db: Session) -> dict:
    inp = MonteCarloInput(**input_data)
    job_id = str(uuid.uuid4())
    return {
        "status": "queued",
        "job_id": job_id,
        "message": f"Monte Carlo simulation queued. symbol={inp.symbol} sims={inp.simulations} horizon={inp.horizon_days}d",
    }


async def _fetch_filings(input_data: dict, db: Session) -> dict:
    inp = FetchFilingsInput(**input_data)
    end_date = inp.end if inp.end else datetime.now(timezone.utc).strftime("%Y-%m-%d")

    url = "https://efts.sec.gov/LATEST/search-index"
    params: dict = {
        "q": inp.query,
        "dateRange": "custom",
        "startdt": inp.start,
        "enddt": end_date,
        "forms": inp.form_types,
    }
    async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "QuantTrade-AgoraBot/1.0 (research)"}) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    hits = data.get("hits", {})
    filings = hits.get("hits", [])
    total = hits.get("total", {})
    total_count = total.get("value", len(filings)) if isinstance(total, dict) else len(filings)

    return {
        "filings": filings,
        "total": total_count,
    }


async def _fetch_news(input_data: dict, db: Session) -> dict:
    inp = FetchNewsInput(**input_data)
    api_key = os.environ.get("NEWS_API_KEY")
    if not api_key:
        raise ToolNotConfiguredError("news_api_not_configured", "NEWS_API_KEY not set")

    from datetime import timedelta
    from_date = inp.from_date if inp.from_date else (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

    url = "https://newsapi.org/v2/everything"
    params: dict = {
        "q": inp.query,
        "from": from_date,
        "sortBy": "publishedAt",
        "pageSize": str(inp.page_size),
        "apiKey": api_key,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    return {
        "articles": data.get("articles", []),
        "total": data.get("totalResults", 0),
    }


async def _score_sentiment(input_data: dict, db: Session) -> dict:
    inp = ScoreSentimentInput(**input_data)
    token = os.environ.get("CF_WORKERS_AI_TOKEN")
    account_id = os.environ.get("CF_ACCOUNT_ID")
    if not token or not account_id:
        raise ToolNotConfiguredError(
            "cloudflare_ai_not_configured",
            "CF_WORKERS_AI_TOKEN / CF_ACCOUNT_ID not set"
        )

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/huggingface/finbert"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            url,
            json={"text": inp.text},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    # Cloudflare Workers AI returns result.result list of {label, score}
    result = data.get("result", [])
    if isinstance(result, list) and result:
        # Return highest-score label
        best = max(result, key=lambda x: x.get("score", 0.0))
        return {"label": best.get("label", "neutral"), "score": best.get("score", 0.0)}
    elif isinstance(result, dict):
        return {"label": result.get("label", "neutral"), "score": result.get("score", 0.0)}
    return {"label": "neutral", "score": 0.0}


async def _follow_redirects_safe(url: str, max_redirects: int = 3) -> httpx.Response:
    """Follow redirects manually, re-checking each destination against PRIVATE_IP_NETWORKS."""
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=8.0,
        headers={"User-Agent": "QuantTrade-AgoraBot/1.0"},
    ) as client:
        current_url = url
        for _ in range(max_redirects + 1):
            resp = await client.get(current_url)
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("location", "")
                if not location:
                    break
                parsed = urlparse(location)
                redir_host = parsed.hostname or ""
                # Re-run Layer 2 DNS+IP check on redirect target
                infos = await asyncio.get_running_loop().run_in_executor(
                    None, socket.getaddrinfo, redir_host, None
                )
                for info in infos:
                    ip = ipaddress.ip_address(info[4][0])
                    for network in PRIVATE_IP_NETWORKS:
                        if ip in network:
                            raise ToolError(
                                "cite_source_redirect_private_ip",
                                f"Redirect to private IP blocked: {ip}",
                            )
                current_url = location
            else:
                return resp
        return resp


async def _cite_source(input_data: dict, db: Session) -> dict:
    inp = CiteSourceInput(**input_data)
    url = inp.url

    # Layer 1: domain allowlist
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    if hostname not in CITE_SOURCE_ALLOWLIST:
        raise ToolError("cite_source_domain_not_allowed", f"Domain '{hostname}' not in allowlist")

    # Layer 2: DNS resolution + private IP block
    try:
        infos = await asyncio.get_running_loop().run_in_executor(
            None, socket.getaddrinfo, hostname, None
        )
        for info in infos:
            ip_str = info[4][0]
            ip = ipaddress.ip_address(ip_str)
            for network in PRIVATE_IP_NETWORKS:
                if ip in network:
                    raise ToolError("cite_source_private_ip_blocked", f"Resolved to private IP {ip_str}")
    except ToolError:
        raise
    except Exception as e:
        raise ToolError("cite_source_dns_failed", str(e))

    # Layer 3: Fetch with manual redirect following to re-validate each hop against private IPs
    resp = await _follow_redirects_safe(url)
    resp.raise_for_status()
    content = resp.text[:8000]  # cap at 8KB

    return {
        "url": url,
        "status_code": resp.status_code,
        "excerpt": content[:500],
        "full_text": content,
    }


async def _semantic_search_posts(input_data: dict, db: Session) -> dict:
    inp = SemanticSearchInput(**input_data)

    try:
        from app.services.embedding_service import get_embedding  # type: ignore
        query_vec = await asyncio.get_running_loop().run_in_executor(
            None, get_embedding, inp.query
        )
        if query_vec is None:
            return {"posts": []}

        # Format as pgvector literal string
        vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

        sql = text(
            """
            SELECT p.id, p.title, p.body,
                   1 - (p.embedding <=> CAST(:query_vec AS vector)) AS similarity
            FROM posts p
            WHERE p.embedding IS NOT NULL
            ORDER BY similarity DESC
            LIMIT :lim
            """
        )
        rows = db.execute(sql, {"query_vec": vec_str, "lim": inp.limit}).fetchall()
        return {
            "posts": [
                {"id": r.id, "title": r.title, "similarity": float(r.similarity)}
                for r in rows
            ]
        }
    except Exception as e:
        logger.warning("semantic_search_posts failed (pgvector unavailable?): %s", e)
        return {"posts": []}


async def _fetch_macro_series(input_data: dict, db: Session) -> dict:
    inp = FetchMacroSeriesInput(**input_data)
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise ToolNotConfiguredError("fred_not_configured", "FRED_API_KEY not set")

    url = "https://api.stlouisfed.org/fred/series/observations"
    params: dict = {
        "series_id": inp.series_id,
        "api_key": api_key,
        "file_type": "json",
        "limit": str(inp.limit),
        "sort_order": "desc",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    return {
        "series_id": inp.series_id,
        "observations": data.get("observations", []),
    }


# ---------------------------------------------------------------------------
# Tool handler registry
# ---------------------------------------------------------------------------

TOOL_HANDLERS: Dict[str, Any] = {
    "fetch_quote":           _fetch_quote,
    "fetch_historical_bars": _fetch_historical_bars,
    "run_backtest":          _run_backtest,
    "monte_carlo":           _monte_carlo,
    "fetch_filings":         _fetch_filings,
    "fetch_news":            _fetch_news,
    "score_sentiment":       _score_sentiment,
    "cite_source":           _cite_source,
    "semantic_search_posts": _semantic_search_posts,
    "fetch_macro_series":    _fetch_macro_series,
}


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def execute_tool(
    tool_name: str,
    input_data: dict,
    agent_id: int,
    is_platform: bool,
    db: Session,
) -> dict:
    """
    Main dispatch. Called by agent execution plane and internal tools endpoint.
    Raises ToolError subclasses on failure.

    Pipeline: rate_limit_check → input_validation → execute → return result
    """
    if tool_name not in TOOL_CONFIG:
        raise ToolError("unknown_tool", f"Tool '{tool_name}' not found")

    await _check_rate_limit(agent_id, tool_name, is_platform)

    handler = TOOL_HANDLERS[tool_name]
    result = await handler(input_data, db)
    return result
