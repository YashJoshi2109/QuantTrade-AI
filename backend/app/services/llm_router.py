"""
Smart LLM Router for QuantTrade AI Copilot

Routing hierarchy:
  1. OpenAI GPT-4o  (primary — highest quality)
  2. OpenAI GPT-4.1 (fallback if GPT-4o rate-limited)
  3. GROQ Llama 3.3 70B (free fallback)
  4. OpenRouter Gemini 2.0 Flash (last resort)

Features:
  - Per-user rate limiting (RPM/TPM)
  - Global budget guard with daily hard cap
  - Response caching (hash-based, TTL 5 min)
  - Token optimization (prompt compression)
  - Per-user usage tracking in DB
"""
import hashlib
import json
import time
import asyncio
import logging
from typing import AsyncGenerator, Dict, List, Optional, Tuple
from datetime import date, datetime, timedelta
from collections import defaultdict

import httpx
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)


# ── Cost Table (per 1K tokens) ─────────────────────────────────────────
MODEL_COSTS = {
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4.1": {"input": 0.002, "output": 0.008},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "groq": {"input": 0.0, "output": 0.0},
    "openrouter": {"input": 0.0001, "output": 0.0004},
    "deepseek-v3": {"input": 0.0003, "output": 0.0009},
}

# DeepSeek V3 financial persona — injected when it's the last-resort fallback
DEEPSEEK_FINANCE_SYSTEM = (
    "You are a senior institutional financial analyst with 20+ years on Wall Street. "
    "You think in terms of risk-adjusted returns, factor exposures, and macro regimes. "
    "Always back claims with data. Use precise numbers. Structure your analysis with "
    "clear sections: Thesis, Quantitative View, Risk Factors, and Actionable Insight. "
    "Never hedge with vague language — give a directional view with confidence level."
)


# ── In-Memory Rate Limiter ─────────────────────────────────────────────
class RateLimiter:
    """Sliding window rate limiter per user."""

    def __init__(self, rpm_limit: int = 8, tpm_limit: int = 30_000):
        self.rpm_limit = rpm_limit
        self.tpm_limit = tpm_limit
        self._requests: Dict[int, List[float]] = defaultdict(list)
        self._tokens: Dict[int, List[Tuple[float, int]]] = defaultdict(list)

    def _cleanup(self, user_id: int):
        now = time.time()
        cutoff = now - 60
        self._requests[user_id] = [t for t in self._requests[user_id] if t > cutoff]
        self._tokens[user_id] = [(t, n) for t, n in self._tokens[user_id] if t > cutoff]

    def check(self, user_id: int) -> Tuple[bool, str]:
        """Return (allowed, reason)."""
        self._cleanup(user_id)
        if len(self._requests[user_id]) >= self.rpm_limit:
            return False, f"Rate limit: {self.rpm_limit} requests/min exceeded"
        token_sum = sum(n for _, n in self._tokens[user_id])
        if token_sum >= self.tpm_limit:
            return False, f"Token limit: {self.tpm_limit} tokens/min exceeded"
        return True, ""

    def record_request(self, user_id: int):
        self._requests[user_id].append(time.time())

    def record_tokens(self, user_id: int, count: int):
        self._tokens[user_id].append((time.time(), count))


# ── Global Budget Guard ────────────────────────────────────────────────
class BudgetGuard:
    """Tracks daily spend and enforces hard cap."""

    def __init__(self, daily_cap_usd: float = 2.0):
        self.daily_cap = daily_cap_usd
        self._daily_spend: Dict[str, float] = {}
        self._user_daily_spend: Dict[str, float] = {}

    def _today(self) -> str:
        return date.today().isoformat()

    def get_daily_spend(self) -> float:
        return self._daily_spend.get(self._today(), 0.0)

    def get_user_daily_spend(self, user_id: int) -> float:
        key = f"{self._today()}:{user_id}"
        return self._user_daily_spend.get(key, 0.0)

    def can_spend(self) -> Tuple[bool, float]:
        spent = self.get_daily_spend()
        remaining = max(0, self.daily_cap - spent)
        return remaining > 0.001, remaining

    def record_cost(self, user_id: int, cost: float):
        today = self._today()
        self._daily_spend[today] = self._daily_spend.get(today, 0.0) + cost
        key = f"{today}:{user_id}"
        self._user_daily_spend[key] = self._user_daily_spend.get(key, 0.0) + cost


# ── Response Cache ─────────────────────────────────────────────────────
class ResponseCache:
    """Hash-based cache with TTL for identical queries."""

    def __init__(self, ttl_seconds: int = 300, max_entries: int = 500):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._cache: Dict[str, Tuple[float, str, str]] = {}  # hash -> (timestamp, response, model)

    def _hash(self, messages: List[Dict]) -> str:
        content = json.dumps(messages, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def get(self, messages: List[Dict]) -> Optional[Tuple[str, str]]:
        """Return (cached_response, model) or None."""
        h = self._hash(messages)
        if h in self._cache:
            ts, resp, model = self._cache[h]
            if time.time() - ts < self.ttl:
                return resp, model
            del self._cache[h]
        return None

    def put(self, messages: List[Dict], response: str, model: str):
        h = self._hash(messages)
        # Evict oldest if full
        if len(self._cache) >= self.max_entries:
            oldest_key = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest_key]
        self._cache[h] = (time.time(), response, model)


# ── Token Optimizer ────────────────────────────────────────────────────
class TokenOptimizer:
    """Compress prompts to reduce token usage."""

    @staticmethod
    def optimize_messages(messages: List[Dict], max_tokens: int = 1200) -> List[Dict]:
        """Trim system prompt and truncate user content to fit budget."""
        optimized = []
        for msg in messages:
            content = msg.get("content", "")
            if msg["role"] == "system":
                # Keep system prompt but cap at 2500 chars
                if len(content) > 2500:
                    content = content[:2500] + "\n\n[System prompt truncated for efficiency]"
            elif msg["role"] == "user":
                # Cap user context at 4000 chars
                if len(content) > 4000:
                    content = content[:4000] + "\n\n[Context truncated — focus on the core question]"
            optimized.append({"role": msg["role"], "content": content})
        return optimized

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Rough token estimate: ~4 chars per token."""
        return len(text) // 4


# ── Singleton Instances ────────────────────────────────────────────────
rate_limiter = RateLimiter(rpm_limit=8, tpm_limit=30_000)
budget_guard = BudgetGuard(daily_cap_usd=2.0)
response_cache = ResponseCache(ttl_seconds=300, max_entries=500)
token_optimizer = TokenOptimizer()


# ── Usage Tracker (DB) ─────────────────────────────────────────────────
def record_usage_db(
    db: Session,
    user_id: int,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost: float,
):
    """Upsert daily usage row for user+model."""
    from app.models.api_usage import APIUsage

    today = date.today()
    row = db.query(APIUsage).filter(
        APIUsage.user_id == user_id,
        APIUsage.date == today,
        APIUsage.model == model,
    ).first()

    if row:
        row.requests += 1
        row.input_tokens += input_tokens
        row.output_tokens += output_tokens
        row.estimated_cost_usd += cost
    else:
        row = APIUsage(
            user_id=user_id,
            date=today,
            model=model,
            requests=1,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=cost,
        )
        db.add(row)

    try:
        db.commit()
    except Exception:
        db.rollback()


FREE_DAILY_LIMIT = 5  # Free users get 5 copilot requests per day


def is_pro_user(db: Session, user_id: int) -> bool:
    """Check if user has an active pro subscription."""
    try:
        from app.models.billing import Subscription
        sub = db.query(Subscription).filter(
            Subscription.user_id == user_id,
            Subscription.status == "active",
        ).first()
        return sub is not None
    except Exception:
        return False


def check_free_limit(db: Session, user_id: int) -> tuple:
    """
    Check if free user has exceeded daily limit.
    Returns (allowed: bool, remaining: int, is_pro: bool)
    """
    if is_pro_user(db, user_id):
        return True, 999, True

    from app.models.api_usage import APIUsage
    today = date.today()
    rows = db.query(APIUsage).filter(
        APIUsage.user_id == user_id,
        APIUsage.date == today,
    ).all()
    total_requests = sum(r.requests for r in rows)
    remaining = max(0, FREE_DAILY_LIMIT - total_requests)
    return remaining > 0, remaining, False


def get_user_usage_summary(db: Session, user_id: int) -> Dict:
    """Get usage summary for display in copilot."""
    from app.models.api_usage import APIUsage

    today = date.today()
    rows = db.query(APIUsage).filter(
        APIUsage.user_id == user_id,
        APIUsage.date == today,
    ).all()

    total_requests = sum(r.requests for r in rows)
    total_input = sum(r.input_tokens for r in rows)
    total_output = sum(r.output_tokens for r in rows)
    total_cost = sum(r.estimated_cost_usd for r in rows)

    can_spend, remaining = budget_guard.can_spend()

    pro = is_pro_user(db, user_id)
    free_remaining = max(0, FREE_DAILY_LIMIT - total_requests) if not pro else 999

    return {
        "today_requests": total_requests,
        "today_input_tokens": total_input,
        "today_output_tokens": total_output,
        "today_cost_usd": round(total_cost, 4),
        "daily_budget_usd": budget_guard.daily_cap,
        "budget_remaining_usd": round(remaining, 4),
        "budget_ok": can_spend,
        "is_pro": pro,
        "free_limit": FREE_DAILY_LIMIT,
        "free_remaining": free_remaining,
    }


# ── Smart Model Router ─────────────────────────────────────────────────
def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    costs = MODEL_COSTS.get(model, MODEL_COSTS["gpt-4o"])
    return (input_tokens / 1000) * costs["input"] + (output_tokens / 1000) * costs["output"]


async def _stream_openai(
    messages: List[Dict],
    model: str = "gpt-4o",
    max_tokens: int = 1200,
) -> AsyncGenerator[Tuple[str, int], None]:
    """Stream from OpenAI, yielding (token_text, output_token_count)."""
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        return

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.4,
        "stream": True,
    }

    total_out = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        ) as response:
            if response.status_code == 429:
                logger.warning(f"OpenAI {model} rate limited (429)")
                return
            if response.status_code != 200:
                error_body = await response.aread()
                logger.error(f"OpenAI {model} error {response.status_code}: {error_body[:200]}")
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    text = delta.get("content", "")
                    if text:
                        total_out += 1
                        yield text, total_out
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


async def _stream_groq(
    messages: List[Dict],
    model: str = "llama-3.3-70b-versatile",
) -> AsyncGenerator[Tuple[str, int], None]:
    """Stream from GROQ."""
    api_key = settings.GROQ_API_KEY
    if not api_key:
        return

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 2000,
        "temperature": 0.5,
        "stream": True,
    }

    total_out = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        async with client.stream(
            "POST",
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        ) as response:
            if response.status_code != 200:
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    text = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if text:
                        total_out += 1
                        yield text, total_out
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


async def _stream_openrouter(
    messages: List[Dict],
) -> AsyncGenerator[Tuple[str, int], None]:
    """Stream from OpenRouter (Gemini 2.0 Flash)."""
    api_key = settings.OPENROUTER_API_KEY
    if not api_key:
        return

    payload = {
        "model": "google/gemini-2.0-flash-001",
        "messages": messages,
        "max_tokens": 2000,
        "temperature": 0.5,
        "stream": True,
    }

    total_out = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        async with client.stream(
            "POST",
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        ) as response:
            if response.status_code != 200:
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    text = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if text:
                        total_out += 1
                        yield text, total_out
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


async def _stream_deepseek(
    messages: List[Dict],
) -> AsyncGenerator[Tuple[str, int], None]:
    """Stream DeepSeek V3.2 via OpenRouter as final financial-analyst fallback."""
    api_key = settings.OPENROUTER_API_KEY
    if not api_key:
        return

    # Inject financial persona into system prompt
    finance_messages = []
    has_system = False
    for msg in messages:
        if msg["role"] == "system":
            has_system = True
            finance_messages.append({
                "role": "system",
                "content": DEEPSEEK_FINANCE_SYSTEM + "\n\n" + msg["content"],
            })
        else:
            finance_messages.append(msg)

    if not has_system:
        finance_messages.insert(0, {"role": "system", "content": DEEPSEEK_FINANCE_SYSTEM})

    payload = {
        "model": "deepseek/deepseek-chat-v3-0324",
        "messages": finance_messages,
        "max_tokens": 2000,
        "temperature": 0.3,
        "stream": True,
    }

    total_out = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
        async with client.stream(
            "POST",
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://quanttrade.us",
                "X-Title": "QuantTrade AI Copilot",
            },
            json=payload,
        ) as response:
            if response.status_code != 200:
                logger.error(f"DeepSeek V3 error {response.status_code}")
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    text = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if text:
                        total_out += 1
                        yield text, total_out
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


# ── Main Smart Router ──────────────────────────────────────────────────
async def smart_stream_llm(
    messages: List[Dict],
    user_id: int,
    db: Optional[Session] = None,
) -> AsyncGenerator[Tuple[str, str], None]:
    """
    Smart LLM streaming with routing, rate limiting, budget guard, and caching.

    Yields: (token_text, model_used)

    Routing order:
      1. Check cache → return cached if hit
      2. Check rate limit → reject if exceeded
      3. Check budget → downgrade model if near cap
      4. OpenAI GPT-4o (primary)
      5. OpenAI GPT-4o-mini (if budget tight)
      6. GROQ Llama 3.3 70B (free fallback)
      7. OpenRouter Gemini 2.0 Flash
      8. DeepSeek V3.2 via OpenRouter (financial analyst persona — last resort)
    """

    # ── 1. Check cache ──
    cached = response_cache.get(messages)
    if cached:
        resp, model = cached
        logger.info(f"Cache hit for user {user_id}, model={model}")
        # Yield entire cached response at once
        yield resp, f"{model}_cached"
        return

    # ── 2. Free user daily limit ──
    if db:
        free_ok, free_remaining, is_pro = check_free_limit(db, user_id)
        if not free_ok:
            yield (
                f"You've reached your free daily limit of {FREE_DAILY_LIMIT} AI requests. "
                f"Upgrade to **Pro** for unlimited analysis at [/pricing](/pricing)."
            ), "free_limit"
            return

    # ── 3. Rate limit check ──
    allowed, reason = rate_limiter.check(user_id)
    if not allowed:
        yield f"[Rate limited] {reason}. Please wait a moment and try again.", "rate_limited"
        return

    rate_limiter.record_request(user_id)

    # ── 3. Optimize tokens ──
    optimized = token_optimizer.optimize_messages(messages, max_tokens=1200)
    input_tokens = sum(token_optimizer.estimate_tokens(m.get("content", "")) for m in optimized)

    # ── 4. Budget-aware model selection ──
    can_spend, remaining = budget_guard.can_spend()
    estimated_cost = _estimate_cost("gpt-4o", input_tokens, 1200)

    model_queue: List[Tuple[str, str]] = []  # (provider, model_name)

    if can_spend and settings.OPENAI_API_KEY:
        if remaining > estimated_cost * 2:
            model_queue.append(("openai", "gpt-4o"))
        else:
            # Budget tight → use cheaper model
            model_queue.append(("openai", "gpt-4o-mini"))
            logger.info(f"Budget tight (${remaining:.3f} left), routing to gpt-4o-mini")

    if settings.GROQ_API_KEY:
        model_queue.append(("groq", "llama-3.3-70b-versatile"))

    if settings.OPENROUTER_API_KEY:
        model_queue.append(("openrouter", "gemini-2.0-flash"))

    # DeepSeek V3.2 via OpenRouter — last-resort financial analyst fallback
    if settings.OPENROUTER_API_KEY:
        model_queue.append(("deepseek", "deepseek-v3"))

    if not model_queue:
        yield "No LLM API keys configured.", "none"
        return

    # ── 5. Try each model in order ──
    full_response = ""
    model_used = "none"

    for provider, model_name in model_queue:
        streamed = False

        if provider == "openai":
            max_tok = 1200 if "mini" not in model_name else 800
            async for text, out_count in _stream_openai(optimized, model_name, max_tok):
                if not streamed:
                    streamed = True
                    model_used = model_name
                full_response += text
                yield text, model_name

            if streamed:
                # Record cost
                output_tokens = token_optimizer.estimate_tokens(full_response)
                cost = _estimate_cost(model_name, input_tokens, output_tokens)
                budget_guard.record_cost(user_id, cost)
                rate_limiter.record_tokens(user_id, input_tokens + output_tokens)

                if db:
                    record_usage_db(db, user_id, model_name, input_tokens, output_tokens, cost)

                # Cache the response
                response_cache.put(messages, full_response, model_name)
                return

        elif provider == "groq":
            async for text, out_count in _stream_groq(optimized):
                if not streamed:
                    streamed = True
                    model_used = "groq"
                full_response += text
                yield text, "groq"

            if streamed:
                rate_limiter.record_tokens(user_id, input_tokens + token_optimizer.estimate_tokens(full_response))
                if db:
                    record_usage_db(db, user_id, "groq", input_tokens, token_optimizer.estimate_tokens(full_response), 0.0)
                response_cache.put(messages, full_response, "groq")
                return

        elif provider == "openrouter":
            async for text, out_count in _stream_openrouter(optimized):
                if not streamed:
                    streamed = True
                    model_used = "openrouter"
                full_response += text
                yield text, "openrouter"

            if streamed:
                output_tokens = token_optimizer.estimate_tokens(full_response)
                cost = _estimate_cost("openrouter", input_tokens, output_tokens)
                budget_guard.record_cost(user_id, cost)
                rate_limiter.record_tokens(user_id, input_tokens + output_tokens)
                if db:
                    record_usage_db(db, user_id, "openrouter", input_tokens, output_tokens, cost)
                response_cache.put(messages, full_response, "openrouter")
                return

        elif provider == "deepseek":
            async for text, out_count in _stream_deepseek(optimized):
                if not streamed:
                    streamed = True
                    model_used = "deepseek-v3"
                    logger.info(f"DeepSeek V3 fallback activated for user {user_id}")
                full_response += text
                yield text, "deepseek-v3"

            if streamed:
                output_tokens = token_optimizer.estimate_tokens(full_response)
                cost = _estimate_cost("deepseek-v3", input_tokens, output_tokens)
                budget_guard.record_cost(user_id, cost)
                rate_limiter.record_tokens(user_id, input_tokens + output_tokens)
                if db:
                    record_usage_db(db, user_id, "deepseek-v3", input_tokens, output_tokens, cost)
                response_cache.put(messages, full_response, "deepseek-v3")
                return

    # If we get here, no model worked
    if not full_response:
        yield "All LLM providers are currently unavailable. Please try again shortly.", "error"
