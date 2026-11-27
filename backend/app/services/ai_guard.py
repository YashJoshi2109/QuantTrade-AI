"""
AI usage guard — the single choke point for every paid AI/ML provider call.

Covers LLMs (Anthropic direct, Bedrock, OpenAI, OpenRouter, Groq), embeddings
(Bedrock Titan, OpenAI), Cohere rerank, fal.ai image generation and ElevenLabs
text-to-speech.

Layers (all counters are UTC-day / UTC-hour / minute buckets):

  1. Per-user limits by tier (free / pro / admin): requests per minute (burst),
     requests per day, LLM tokens per day, images per day, TTS characters per
     day.  Plus a per-IP daily request cap (stops account farming).
  2. Global spend circuit breaker: every call *reserves* an estimated cost
     before it runs and *reconciles* with the provider's real usage after.
     Limits: global daily + hourly USD, per-provider daily USD, and a separate
     daily USD cap for system/background jobs.  Copilot evaluations
     (GuardContext.is_eval, e.g. scripts/run_institutional_eval.py --live)
     are charged ONLY to their own bucket, LLM_EVAL_DAILY_BUDGET_USD (default
     0 = evals cannot spend), never to the global, provider, system or
     per-user counters.  When a budget is exhausted,
     user-triggered calls get HTTP 503 "AI features are paused for today
     (budget reached)."
  3. Input/output caps (prompt chars, turns, max_tokens, TTS chars) are read
     from here by the client factories and endpoints.

Storage: Redis (atomic Lua check-and-increment).  If Redis is unreachable the
guard fails *closed* to an in-process store with every limit scaled down by
AI_FALLBACK_LIMIT_FACTOR (default 0.5) — never unlimited.

Every finished call is persisted to `ai_usage_events` (user id, feature,
provider, model, tokens, units, cost) — no PII beyond the user id; IPs are
only ever stored as a salted hash inside Redis counter keys.

System / background jobs (e.g. SEC insight pre-generation, news notes):

    from app.services.ai_guard import reserve_system, AIQuotaError
    try:
        res = reserve_system("news_notes", est_tokens=1500)   # Haiku by default
    except AIQuotaError:
        return  # system budget (LLM_SYSTEM_DAILY_BUDGET_USD) or global budget hit; skip
    llm = get_llm_haiku()          # guarded factory; usage is reconciled automatically
    ...                            # or, for a raw SDK call:
    res.commit(input_tokens=..., output_tokens=...)   # / res.release() on failure

  The LangChain factories in services/agentic/bedrock_client.py attach a
  callback that reserves/reconciles per call, so a background job only needs
  `with system_context("news_notes"):` around its get_llm_haiku() usage; the
  explicit reserve_system() call above is for gating a batch up front.

Prompt caching and token accounting:

  Usage is reconciled from the provider's metadata split into uncached input,
  cache reads, cache writes and output (usage_breakdown_from_langchain).  USD
  cost prices reads at CACHE_READ_PRICE_MULT (0.1x input) and writes at
  CACHE_WRITE_PRICE_MULT (1.25x); the per-user tokens_per_day counter uses
  the same weights (weighted_tokens: "input-equivalent tokens", output 1x).

Cost envelope (defaults, copilot on Claude Sonnet 5 at $2 / $10 per 1M):

  * Typical question: ~1.2k cached prefix (system + tool schemas, 0.1x),
    ~3-4.5k per-request context (history + ticker pack, written to cache at
    1.25x so a tool round re-reads it at 0.1x), ~400-600 output tokens
    => ~5-7k input-equivalent tokens, ~$0.015-0.022 per question.
  * Free tier: 20 requests/day, 160k tokens/day.  Expected spend per fully
    active free user ~$0.30-0.45/day.  Worst case (every counted token billed
    as output) is capped by tokens_per_day: 160k x $10/1M = $1.60/user/day.
  * The global breaker (LLM_DAILY_BUDGET_USD, default $5/day; hourly $1.5)
    still bounds the whole fleet: ~250-330 typical questions/day, or ~3 free
    users at the theoretical per-user worst case, before AI is paused (503).
"""
from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import logging
import math
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import HTTPException, status

logger = logging.getLogger("ai_guard")

BUDGET_PAUSED_DETAIL = "AI features are paused for today (budget reached)."
PROVIDERS = ("anthropic", "bedrock", "openai", "openrouter", "groq", "cohere", "fal", "elevenlabs")
TIERS = ("free", "pro", "admin")

# ─── Configuration ───────────────────────────────────────────────────────────


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return float(default)
    try:
        return float(raw)
    except ValueError:
        logger.warning("ai_guard: bad value for %s=%r, using %s", name, raw, default)
        return float(default)


def _env_int(name: str, default: int) -> int:
    return int(_env_float(name, default))


# tokens_per_day counts *input-equivalent* tokens (see weighted_tokens()):
# uncached input 1x, prompt-cache reads 0.1x, cache writes 1.25x, output 1x.
# A typical copilot question (prompt-cached system + tools, trimmed ticker
# pack, one or two model rounds) costs ~4-8k of these, so the free tier's
# tokens_per_day fits its 20 requests/day with headroom for the per-call
# reservation (prompt estimate + max_tokens) checked before every model call.
# Worst-case $/day at these defaults: "Cost envelope" in the module docstring.
_TIER_DEFAULTS: Dict[str, Dict[str, int]] = {
    "free":  {"req_per_min": 5,  "req_per_day": 20,   "tokens_per_day": 160_000,
              "images_per_day": 5,   "tts_chars_per_day": 3_000},
    "pro":   {"req_per_min": 15, "req_per_day": 200,  "tokens_per_day": 1_600_000,
              "images_per_day": 50,  "tts_chars_per_day": 30_000},
    "admin": {"req_per_min": 60, "req_per_day": 2000, "tokens_per_day": 5_000_000,
              "images_per_day": 500, "tts_chars_per_day": 300_000},
}

_PROVIDER_BUDGET_DEFAULTS: Dict[str, float] = {
    "anthropic": 3.0, "bedrock": 4.0, "openai": 2.0, "openrouter": 1.0,
    "groq": 1.0, "cohere": 0.5, "fal": 1.0, "elevenlabs": 1.5,
}


def tier_limits(tier: str) -> Dict[str, int]:
    """Per-user limits for a tier (env: LLM_<TIER>_REQ_PER_MIN / _REQ_PER_DAY /
    _TOKENS_PER_DAY, AI_<TIER>_IMAGES_PER_DAY, AI_<TIER>_TTS_CHARS_PER_DAY)."""
    tier = tier if tier in _TIER_DEFAULTS else "free"
    d = _TIER_DEFAULTS[tier]
    T = tier.upper()
    return {
        "req_per_min": _env_int(f"LLM_{T}_REQ_PER_MIN", d["req_per_min"]),
        "req_per_day": _env_int(f"LLM_{T}_REQ_PER_DAY", d["req_per_day"]),
        "tokens_per_day": _env_int(f"LLM_{T}_TOKENS_PER_DAY", d["tokens_per_day"]),
        "images_per_day": _env_int(f"AI_{T}_IMAGES_PER_DAY", d["images_per_day"]),
        "tts_chars_per_day": _env_int(f"AI_{T}_TTS_CHARS_PER_DAY", d["tts_chars_per_day"]),
    }


def global_limits() -> Dict[str, float]:
    out = {
        "daily_usd": _env_float("LLM_DAILY_BUDGET_USD", 5.0),
        "hourly_usd": _env_float("LLM_HOURLY_BUDGET_USD", 1.5),
        "system_daily_usd": _env_float("LLM_SYSTEM_DAILY_BUDGET_USD", 1.0),
        # dedicated bucket for offline/live copilot evaluations; 0 = evals cannot spend
        "eval_daily_usd": _env_float("LLM_EVAL_DAILY_BUDGET_USD", 0.0),
        "ip_req_per_day": _env_float("AI_IP_REQ_PER_DAY", 60),
        "og_images_per_day": _env_float("AI_OG_IMAGES_PER_DAY", 20),
        "embed_tokens_per_day": _env_float("AI_EMBED_TOKENS_PER_DAY", 20_000_000),
    }
    for p in PROVIDERS:
        out[f"provider_daily_usd:{p}"] = _env_float(
            f"AI_DAILY_BUDGET_USD_{p.upper()}", _PROVIDER_BUDGET_DEFAULTS[p]
        )
    return out


def io_caps() -> Dict[str, int]:
    """Input/output caps used by factories and endpoints."""
    return {
        "max_prompt_chars": _env_int("LLM_MAX_PROMPT_CHARS", 4000),
        "max_turns": _env_int("LLM_MAX_TURNS", 10),
        "max_tokens_haiku": _env_int("LLM_MAX_TOKENS_HAIKU", 1024),
        "max_tokens_sonnet": _env_int("LLM_MAX_TOKENS_SONNET", 2048),
        "timeout_s": _env_int("LLM_TIMEOUT_S", 60),
        "embed_max_chars": _env_int("AI_EMBED_MAX_CHARS", 8000),
        "embed_max_texts": _env_int("AI_EMBED_MAX_TEXTS", 256),
        "tts_max_chars": _env_int("AI_TTS_MAX_CHARS_PER_REQUEST", 1000),
    }


# ─── Prices ──────────────────────────────────────────────────────────────────
# Token models: USD per 1M tokens (input, output).  Matched by longest
# substring of the lower-cased model id.  Override/extend with
# AI_PRICES_JSON='{"claude-haiku-4-5": [1, 5], "flux/schnell": 0.003}'.
TOKEN_PRICES: Dict[str, Tuple[float, float]] = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4": (3.0, 15.0),
    "claude-3.5-sonnet": (3.0, 15.0),
    "claude-3-5-sonnet": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-3-5-haiku": (0.8, 4.0),
    "claude-3-haiku": (0.25, 1.25),
    "nova-micro": (0.035, 0.14),
    "nova-lite": (0.06, 0.24),
    "nova-pro": (0.8, 3.2),
    "gpt-4o-mini": (0.15, 0.6),
    "gpt-4o": (2.5, 10.0),
    "gpt-4.1": (2.0, 8.0),
    "llama-3.3-70b": (0.59, 0.79),
    "llama-3.1-8b": (0.05, 0.08),
    "mixtral-8x7b": (0.24, 0.24),
    "gemini-flash-1.5-8b": (0.0375, 0.15),
    "gemini-2.0-flash": (0.1, 0.4),
    "deepseek": (0.3, 0.9),
    "titan-embed": (0.02, 0.0),
    "text-embedding-3-small": (0.02, 0.0),
}
# Unit-priced models: USD per unit (rerank search, image megapixel, TTS character).
UNIT_PRICES: Dict[str, float] = {
    "rerank": 0.002,          # Cohere Rerank v3.5: $2 / 1k searches
    "flux/schnell": 0.003,    # fal.ai: per megapixel
    "flux/dev": 0.025,        # fal.ai: per megapixel
    "eleven": 0.0003,         # ElevenLabs: ~$0.30 / 1k characters (overage rate)
}
_FALLBACK_TOKEN_PRICE = (3.0, 15.0)  # unknown model → priced like Sonnet (conservative)

# Anthropic prompt caching (direct API and Bedrock): reading a cached prefix
# costs 10% of the input price, writing it (5-minute TTL) 125%.
CACHE_READ_PRICE_MULT = _env_float("AI_CACHE_READ_PRICE_MULT", 0.1)
CACHE_WRITE_PRICE_MULT = _env_float("AI_CACHE_WRITE_PRICE_MULT", 1.25)


def _price_tables() -> Tuple[Dict[str, Tuple[float, float]], Dict[str, float]]:
    tok, unit = dict(TOKEN_PRICES), dict(UNIT_PRICES)
    raw = os.getenv("AI_PRICES_JSON")
    if raw:
        try:
            for k, v in json.loads(raw).items():
                if isinstance(v, (list, tuple)) and len(v) == 2:
                    tok[k.lower()] = (float(v[0]), float(v[1]))
                else:
                    unit[k.lower()] = float(v)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ai_guard: ignoring bad AI_PRICES_JSON: %s", exc)
    return tok, unit


def _longest_match(model: str, keys: Iterable[str]) -> Optional[str]:
    m = (model or "").lower()
    best = None
    for k in keys:
        if k in m and (best is None or len(k) > len(best)):
            best = k
    return best


def estimate_cost(model: str, input_tokens: int = 0, output_tokens: int = 0, units: float = 0.0,
                  cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> float:
    """USD cost for one call.  ``input_tokens`` are the *uncached* input tokens;
    prompt-cache reads / writes are priced at CACHE_READ/WRITE_PRICE_MULT x input."""
    tok, unit = _price_tables()
    cost = 0.0
    if units:
        k = _longest_match(model, unit)
        cost += units * (unit[k] if k else 0.01)
    if input_tokens or output_tokens or cache_read_tokens or cache_write_tokens:
        k = _longest_match(model, tok)
        pin, pout = tok[k] if k else _FALLBACK_TOKEN_PRICE
        cost += (input_tokens + cache_read_tokens * CACHE_READ_PRICE_MULT
                 + cache_write_tokens * CACHE_WRITE_PRICE_MULT) / 1e6 * pin
        cost += output_tokens / 1e6 * pout
    return cost


def weighted_tokens(input_tokens: int = 0, output_tokens: int = 0, cache_read_tokens: int = 0,
                    cache_write_tokens: int = 0) -> int:
    """Input-equivalent tokens charged to a user's tokens_per_day: prompt-cache
    reads and writes are weighted by their price relative to uncached input."""
    return int(input_tokens + output_tokens
               + math.ceil(cache_read_tokens * CACHE_READ_PRICE_MULT)
               + math.ceil(cache_write_tokens * CACHE_WRITE_PRICE_MULT))


def estimate_tokens(text_or_chars: Any) -> int:
    n = text_or_chars if isinstance(text_or_chars, int) else len(text_or_chars or "")
    return max(1, math.ceil(n / 4))


def _micro(usd: float) -> int:
    return int(math.ceil(usd * 1_000_000))


# ─── Errors ──────────────────────────────────────────────────────────────────


class AIQuotaError(HTTPException):
    """Raised when a call is refused. 429 = per-user/IP limit, 503 = budget paused."""

    def __init__(self, status_code: int, detail: str, reason: str, retry_after: Optional[int] = None):
        headers = {"Retry-After": str(retry_after)} if retry_after else None
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.reason = reason

    @property
    def budget_paused(self) -> bool:
        return self.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


def _seconds_to_midnight() -> int:
    now = datetime.now(timezone.utc)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(60, int((nxt - now).total_seconds()))


_REASON_MESSAGES = {
    "rpm": ("Too many AI requests. Please wait a minute and try again.", 60),
    "req_day": ("Daily AI request limit reached ({limit} requests/day on the {tier} tier). "
                "Upgrade to Pro for more.", None),
    "tokens_day": ("Daily AI token limit reached for the {tier} tier. Try again tomorrow.", None),
    "images_day": ("Daily image generation limit reached ({limit}/day on the {tier} tier).", None),
    "tts_day": ("Daily voice limit reached ({limit} characters/day on the {tier} tier).", None),
    "ip_day": ("Too many AI requests from this network today. Try again tomorrow.", None),
}


def _user_error(reason: str, tier: str = "free", limit: Any = "") -> AIQuotaError:
    msg, retry = _REASON_MESSAGES[reason]
    return AIQuotaError(
        status.HTTP_429_TOO_MANY_REQUESTS,
        msg.format(tier=tier, limit=limit),
        reason,
        retry_after=retry or _seconds_to_midnight(),
    )


def _budget_error(reason: str) -> AIQuotaError:
    return AIQuotaError(status.HTTP_503_SERVICE_UNAVAILABLE, BUDGET_PAUSED_DETAIL, reason,
                        retry_after=3600 if reason == "global_hour" else _seconds_to_midnight())


# ─── Counter stores ──────────────────────────────────────────────────────────

CheckItem = Tuple[str, int, int, int]  # key, increment, limit (<0 = unlimited), ttl seconds

_LUA_CHECK_INCR = """
for i = 1, #KEYS do
  local cur = tonumber(redis.call('GET', KEYS[i]) or '0')
  local inc = tonumber(ARGV[3*i-2])
  local lim = tonumber(ARGV[3*i-1])
  if lim >= 0 and inc > 0 and cur + inc > lim then return i end
end
for i = 1, #KEYS do
  redis.call('INCRBY', KEYS[i], ARGV[3*i-2])
  redis.call('EXPIRE', KEYS[i], ARGV[3*i])
end
return 0
"""


class MemoryStore:
    """In-process counter store (tests, and the fail-closed fallback)."""

    is_fallback = False

    def __init__(self) -> None:
        self._data: Dict[str, Tuple[int, float]] = {}
        self._lock = threading.Lock()

    def _get(self, key: str, now: float) -> int:
        v = self._data.get(key)
        if not v:
            return 0
        if v[1] <= now:
            self._data.pop(key, None)
            return 0
        return v[0]

    def check_and_incr(self, items: Sequence[CheckItem]) -> int:
        now = time.time()
        with self._lock:
            for i, (key, inc, lim, _ttl) in enumerate(items, 1):
                if lim >= 0 and inc > 0 and self._get(key, now) + inc > lim:
                    return i
            for key, inc, _lim, ttl in items:
                self._data[key] = (self._get(key, now) + inc, now + ttl)
            if len(self._data) > 200_000:
                for k in [k for k, v in self._data.items() if v[1] <= now]:
                    self._data.pop(k, None)
        return 0

    def incr(self, key: str, delta: int, ttl: int) -> int:
        now = time.time()
        with self._lock:
            val = self._get(key, now) + delta
            self._data[key] = (val, now + ttl)
            return val

    def get_many(self, keys: Sequence[str]) -> List[int]:
        now = time.time()
        with self._lock:
            return [self._get(k, now) for k in keys]


class RedisStore:
    is_fallback = False

    def __init__(self, client) -> None:
        self._client = client
        self._script = client.register_script(_LUA_CHECK_INCR)

    def check_and_incr(self, items: Sequence[CheckItem]) -> int:
        keys = [k for k, _, _, _ in items]
        args: List[int] = []
        for _k, inc, lim, ttl in items:
            args += [int(inc), int(lim), int(ttl)]
        return int(self._script(keys=keys, args=args))

    def incr(self, key: str, delta: int, ttl: int) -> int:
        pipe = self._client.pipeline()
        pipe.incrby(key, int(delta))
        pipe.expire(key, int(ttl))
        return int(pipe.execute()[0])

    def get_many(self, keys: Sequence[str]) -> List[int]:
        return [int(float(v)) if v is not None else 0 for v in self._client.mget(list(keys))]


class _FallbackStore(MemoryStore):
    is_fallback = True


_store_override: Optional[Any] = None
_redis_store: Optional[RedisStore] = None
_redis_down_until = 0.0
_fallback_store = _FallbackStore()
_store_lock = threading.Lock()


def set_store(store: Optional[Any]) -> None:
    """Force a store (tests). None = default Redis-with-fallback behaviour."""
    global _store_override
    _store_override = store


def _mark_redis_down(exc: Exception) -> None:
    global _redis_down_until, _redis_store
    _redis_down_until = time.time() + 30
    _redis_store = None
    logger.error("ai_guard: Redis unavailable (%s) — failing closed to in-process limiter", type(exc).__name__)


def _store():
    global _redis_store
    if _store_override is not None:
        return _store_override
    if time.time() < _redis_down_until:
        return _fallback_store
    if _redis_store is None:
        with _store_lock:
            if _redis_store is None:
                try:
                    import redis  # sync client; calls are sub-millisecond

                    url = os.getenv("AI_GUARD_REDIS_URL") or os.getenv("REDIS_URL") or "redis://localhost:6379/0"
                    client = redis.Redis.from_url(
                        url, socket_timeout=0.5, socket_connect_timeout=0.5, decode_responses=True
                    )
                    client.ping()
                    _redis_store = RedisStore(client)
                except Exception as exc:  # noqa: BLE001
                    _mark_redis_down(exc)
                    return _fallback_store
    return _redis_store


def _run(op: Callable[[Any], Any]) -> Tuple[Any, Any]:
    """Run op(store); on Redis failure retry on the fallback store."""
    st = _store()
    try:
        return op(st), st
    except Exception as exc:  # noqa: BLE001
        if not isinstance(st, RedisStore):
            raise
        _mark_redis_down(exc)
        return op(_fallback_store), _fallback_store


def _scale(limit: float, st) -> int:
    if limit < 0:
        return -1
    if getattr(st, "is_fallback", False):
        return int(limit * _env_float("AI_FALLBACK_LIMIT_FACTOR", 0.5))
    return int(limit)


# ─── Keys ────────────────────────────────────────────────────────────────────

_PREFIX = os.getenv("AI_GUARD_PREFIX", "aig")
_DAY_TTL = 2 * 86400
_HOUR_TTL = 2 * 3600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day(now: Optional[datetime] = None) -> str:
    return (now or _now()).strftime("%Y%m%d")


def _hour(now: Optional[datetime] = None) -> str:
    return (now or _now()).strftime("%Y%m%d%H")


def _minute(now: Optional[datetime] = None) -> str:
    return (now or _now()).strftime("%Y%m%d%H%M")


def _ip_hash(ip: Optional[str]) -> str:
    salt = os.getenv("SECRET_KEY", "") or "ai-guard"
    return hashlib.sha256(f"{salt}:{ip or 'unknown'}".encode()).hexdigest()[:16]


def _k(*parts: Any) -> str:
    return ":".join([_PREFIX, *[str(p) for p in parts]])


# ─── Context ─────────────────────────────────────────────────────────────────


@dataclass
class GuardContext:
    feature: str
    user_id: Optional[int] = None
    tier: str = "free"
    ip: Optional[str] = None
    system: bool = False
    # evaluation run: charged ONLY to the eval bucket (LLM_EVAL_DAILY_BUDGET_USD),
    # never to the global / provider / system / per-user counters
    is_eval: bool = False

    def snapshot(self) -> "GuardContext":
        return GuardContext(self.feature, self.user_id, self.tier, self.ip, self.system, self.is_eval)


_ctx: contextvars.ContextVar[Optional[GuardContext]] = contextvars.ContextVar("ai_guard_ctx", default=None)


def current_context() -> Optional[GuardContext]:
    return _ctx.get()


@contextlib.contextmanager
def use_context(ctx: GuardContext):
    token = _ctx.set(ctx)
    try:
        yield ctx
    finally:
        _ctx.reset(token)


def set_context(ctx: GuardContext) -> None:
    """Bind ctx for the rest of the current task (use inside a generator)."""
    _ctx.set(ctx)


@contextlib.contextmanager
def system_context(feature: str):
    with use_context(GuardContext(feature=feature, system=True, tier="system")) as c:
        yield c


def eval_guard_context(feature: str = "copilot_eval") -> GuardContext:
    return GuardContext(feature=feature, tier="eval", is_eval=True)


@contextlib.contextmanager
def eval_context(feature: str = "copilot_eval"):
    """Charge every AI call inside to the eval bucket only (see GuardContext.is_eval)."""
    with use_context(eval_guard_context(feature)) as c:
        yield c


EVAL_DISABLED_DETAIL = ("Evaluation budget is not enabled (LLM_EVAL_DAILY_BUDGET_USD=0); evals never spend "
                        "the system or user budgets.")
EVAL_EXHAUSTED_DETAIL = "Evaluation budget for today (LLM_EVAL_DAILY_BUDGET_USD) is exhausted."


def _eval_error(reason: str) -> AIQuotaError:
    detail = EVAL_DISABLED_DETAIL if reason == "eval_disabled" else EVAL_EXHAUSTED_DETAIL
    return AIQuotaError(status.HTTP_503_SERVICE_UNAVAILABLE, detail, reason, retry_after=_seconds_to_midnight())


def _eval_key(now: Optional[datetime] = None) -> str:
    return _k("eval", "cost", _day(now))


def _resolve_ctx(ctx: Optional[GuardContext]) -> GuardContext:
    # No context = an unattributed call: it is charged to the system budget,
    # so even a forgotten wiring can never spend more than the system cap.
    return ctx or _ctx.get() or GuardContext(feature="unattributed", system=True, tier="system")


# ─── Abuse logging ───────────────────────────────────────────────────────────

_ABUSE_THRESHOLDS = (5, 20, 100, 500)


def _record_denial(ctx: GuardContext, reason: str) -> None:
    if ctx.user_id is None:
        logger.warning("ai_guard: denied %s call (feature=%s reason=%s)",
                       "system" if ctx.system else "anonymous", ctx.feature, reason)
        return
    try:
        n, _ = _run(lambda st: st.incr(_k("u", ctx.user_id, "denied", _day()), 1, _DAY_TTL))
    except Exception:  # noqa: BLE001
        n = 0
    if n in _ABUSE_THRESHOLDS:
        logger.warning("ai_guard abuse: user_id=%s hit AI limits %d times today (last reason=%s feature=%s tier=%s)",
                       ctx.user_id, n, reason, ctx.feature, ctx.tier)


# ─── Admission (one per user request) ───────────────────────────────────────


def _global_state(st) -> Dict[str, int]:
    now = _now()
    keys = [_k("g", "cost", _day(now)), _k("g", "costh", _hour(now)), _k("sys", "cost", _day(now))]
    vals = st.get_many(keys)
    return {"day": vals[0], "hour": vals[1], "system": vals[2]}


def budget_paused() -> Optional[str]:
    """Reason string when the global breaker is open, else None."""
    lim = global_limits()
    try:
        state, st = _run(_global_state)
    except Exception:  # noqa: BLE001
        return "store_error"
    if state["day"] >= _scale(_micro(lim["daily_usd"]), st):
        return "global_day"
    if state["hour"] >= _scale(_micro(lim["hourly_usd"]), st):
        return "global_hour"
    return None


def admit_request(ctx: GuardContext, kind: str = "llm") -> None:
    """Count one user-triggered AI request: global breaker, burst, daily and IP caps.

    kind="llm"   — counts toward requests/minute and requests/day (LLM features).
    kind="media" — image / voice: its own burst bucket (4x the LLM one) and no
                   daily request count; images/day and TTS chars/day are enforced
                   per call by reserve().  Both kinds count toward the IP cap.
    Raises AIQuotaError (503 budget / 429 limits).

    An eval context only checks the eval bucket (it never counts toward user,
    IP or global request limits)."""
    if ctx.is_eval:
        lim = global_limits()["eval_daily_usd"]
        if lim <= 0:
            raise _eval_error("eval_disabled")
        try:
            (spent,), st = _run(lambda st: st.get_many([_eval_key()]))
        except Exception:  # noqa: BLE001
            raise _eval_error("eval_day") from None
        if spent >= _scale(_micro(lim), st):
            raise _eval_error("eval_day")
        return
    paused = budget_paused()
    if paused:
        _record_denial(ctx, paused)
        raise _budget_error(paused)
    if ctx.system or ctx.user_id is None:
        return
    lim = tier_limits(ctx.tier)
    glim = global_limits()
    now = _now()
    reasons = ["rpm"]

    def op(st):
        reasons[:] = ["rpm"]  # op may be re-run on the fallback store
        if kind == "media":
            items: List[CheckItem] = [
                (_k("u", ctx.user_id, "rpm_media", _minute(now)), 1, _scale(lim["req_per_min"] * 4, st), 120),
            ]
        else:
            items = [
                (_k("u", ctx.user_id, "rpm", _minute(now)), 1, _scale(lim["req_per_min"], st), 120),
                (_k("u", ctx.user_id, "req", _day(now)), 1, _scale(lim["req_per_day"], st), _DAY_TTL),
            ]
            reasons.append("req_day")
        if ctx.ip:
            items.append((_k("ip", _ip_hash(ctx.ip), "req", _day(now)), 1, _scale(glim["ip_req_per_day"], st), _DAY_TTL))
            reasons.append("ip_day")
        return st.check_and_incr(items)

    failed, _ = _run(op)
    if failed:
        reason = reasons[failed - 1]
        _record_denial(ctx, reason)
        raise _user_error(reason, ctx.tier, lim["req_per_day"] if reason == "req_day" else "")


# ─── Reservations (one per provider call) ───────────────────────────────────

_persist_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-usage")


def _default_persist(event: Dict[str, Any]) -> None:
    def _write():
        try:
            from app.db.database import SessionLocal
            from app.models.ai_usage import AIUsageEvent

            if SessionLocal is None:
                return
            db = SessionLocal()
            try:
                db.add(AIUsageEvent(**event))
                db.commit()
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001
            logger.debug("ai_guard: usage persist failed: %s", exc)

    _persist_pool.submit(_write)


persist_sink: Callable[[Dict[str, Any]], None] = _default_persist


def set_persist_sink(fn: Optional[Callable[[Dict[str, Any]], None]]) -> None:
    global persist_sink
    persist_sink = fn or _default_persist


@dataclass
class Reservation:
    ctx: GuardContext
    provider: str
    model: str
    reserved_micro: int
    reserved_tokens: int
    unit_kind: Optional[str]
    reserved_units: float
    keys: Dict[str, str] = field(default_factory=dict)
    done: bool = False
    cost_usd: float = 0.0
    cost_per_unit_usd: Optional[float] = None

    def _adjust(self, cost_delta: int, token_delta: int, unit_delta: int) -> None:
        def op(st):
            if cost_delta:
                for name in ("g_day", "g_hour", "p_day", "sys_day", "eval_day"):
                    if name in self.keys:
                        st.incr(self.keys[name], cost_delta, _HOUR_TTL if name == "g_hour" else _DAY_TTL)
            if token_delta and "u_tok" in self.keys:
                st.incr(self.keys["u_tok"], token_delta, _DAY_TTL)
            if unit_delta:
                for name in ("u_units", "g_units"):
                    if name in self.keys:
                        st.incr(self.keys[name], unit_delta, _DAY_TTL)
            return True

        try:
            _run(op)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ai_guard: reconcile failed: %s", exc)

    def commit(self, input_tokens: int = 0, output_tokens: int = 0, units: Optional[float] = None,
               status_: str = "ok", cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> float:
        """Reconcile with real usage. Returns the actual USD cost.

        ``input_tokens`` are uncached input tokens; prompt-cache reads/writes
        are passed separately and charged at their relative price, both in
        USD and in the user's input-equivalent tokens_per_day."""
        if self.done:
            return self.cost_usd
        self.done = True
        units = self.reserved_units if units is None else units
        priced_units = 0.0 if self.unit_kind == "embed_tokens" else units
        if self.cost_per_unit_usd is not None:
            cost = float(units or 0) * self.cost_per_unit_usd
        else:
            cost = estimate_cost(self.model, input_tokens, output_tokens, priced_units,
                                 cache_read_tokens=cache_read_tokens, cache_write_tokens=cache_write_tokens)
        self.cost_usd = cost
        actual_micro = _micro(cost)
        charged = weighted_tokens(input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
        total_in = int(input_tokens) + int(cache_read_tokens) + int(cache_write_tokens)
        self._adjust(
            actual_micro - self.reserved_micro,
            charged - self.reserved_tokens if self.unit_kind is None else 0,
            int(units) - int(self.reserved_units) if self.unit_kind else 0,
        )
        if self.ctx.user_id is not None:
            try:
                _run(lambda st: st.incr(_k("u", self.ctx.user_id, "cost", _day()), actual_micro, _DAY_TTL))
                _run(lambda st: st.incr(_k("u", self.ctx.user_id, "in", _day()), total_in, _DAY_TTL))
                _run(lambda st: st.incr(_k("u", self.ctx.user_id, "out", _day()), int(output_tokens), _DAY_TTL))
                if cache_read_tokens:
                    _run(lambda st: st.incr(_k("u", self.ctx.user_id, "cache_read", _day()),
                                            int(cache_read_tokens), _DAY_TTL))
            except Exception:  # noqa: BLE001
                pass
        try:
            persist_sink({
                "user_id": self.ctx.user_id,
                "feature": (self.ctx.feature or "unknown")[:64],
                "provider": self.provider,
                "model": (self.model or "unknown")[:120],
                "input_tokens": total_in,
                "output_tokens": int(output_tokens),
                "units": float(units or 0),
                "cost_usd": round(cost, 6),
                "status": status_,
                "is_system": bool(self.ctx.system),
            } if not self.ctx.is_eval else {
                "user_id": None, "feature": ("eval:" + (self.ctx.feature or "unknown"))[:64],
                "provider": self.provider, "model": (self.model or "unknown")[:120], "input_tokens": total_in,
                "output_tokens": int(output_tokens), "units": float(units or 0), "cost_usd": round(cost, 6),
                "status": status_, "is_system": False,
            })
        except Exception:  # noqa: BLE001
            pass
        return cost

    def release(self) -> None:
        """The call failed before producing anything billable: refund the reservation."""
        if self.done:
            return
        self.done = True
        self._adjust(-self.reserved_micro,
                     -self.reserved_tokens if self.unit_kind is None else 0,
                     -int(self.reserved_units) if self.unit_kind else 0)


def reserve(
    provider: str,
    model: str,
    *,
    est_input_tokens: int = 0,
    est_output_tokens: int = 0,
    units: float = 0.0,
    unit_kind: Optional[str] = None,   # "images" | "tts_chars" | "og_images" | "embed_tokens" | "searches"
    ctx: Optional[GuardContext] = None,
    cost_per_unit_usd: Optional[float] = None,  # explicit unit price (e.g. fal image at its size)
) -> Reservation:
    """Reserve the estimated cost of one provider call (raises AIQuotaError)."""
    ctx = _resolve_ctx(ctx)
    provider = provider if provider in PROVIDERS else "openai"
    priced_units = 0.0 if unit_kind == "embed_tokens" else units  # embeddings are token-priced
    if cost_per_unit_usd is not None:
        est_cost = _micro(units * cost_per_unit_usd)
    else:
        est_cost = _micro(estimate_cost(model, est_input_tokens, est_output_tokens, priced_units))
    est_tokens = int(est_input_tokens + est_output_tokens)
    glim = global_limits()
    now = _now()
    if ctx.is_eval:
        return _reserve_eval(ctx, provider, model, est_cost, est_tokens, unit_kind, units, cost_per_unit_usd,
                             glim["eval_daily_usd"], now)
    keys = {
        "g_day": _k("g", "cost", _day(now)),
        "g_hour": _k("g", "costh", _hour(now)),
        "p_day": _k("p", provider, "cost", _day(now)),
    }
    reasons = ["global_day", "global_hour", "provider_day"]
    if ctx.system:
        keys["sys_day"] = _k("sys", "cost", _day(now))
        reasons.append("system_day")

    lim = tier_limits(ctx.tier) if not ctx.system and ctx.user_id is not None else None
    unit_key_limit = None
    if lim is not None:
        if unit_kind is None:
            keys["u_tok"] = _k("u", ctx.user_id, "tok", _day(now))
            reasons.append("tokens_day")
        elif unit_kind in ("images", "tts_chars"):
            keys["u_units"] = _k("u", ctx.user_id, unit_kind, _day(now))
            unit_key_limit = lim["images_per_day" if unit_kind == "images" else "tts_chars_per_day"]
            reasons.append("images_day" if unit_kind == "images" else "tts_day")
    global_unit_key = None
    if unit_kind in ("og_images", "embed_tokens"):
        global_unit_key = _k("g", unit_kind, _day(now))
        reasons.append("og_day" if unit_kind == "og_images" else "embed_day")

    def op(st):
        items: List[CheckItem] = [
            (keys["g_day"], est_cost, _scale(_micro(glim["daily_usd"]), st), _DAY_TTL),
            (keys["g_hour"], est_cost, _scale(_micro(glim["hourly_usd"]), st), _HOUR_TTL),
            (keys["p_day"], est_cost, _scale(_micro(glim[f"provider_daily_usd:{provider}"]), st), _DAY_TTL),
        ]
        if "sys_day" in keys:
            items.append((keys["sys_day"], est_cost, _scale(_micro(glim["system_daily_usd"]), st), _DAY_TTL))
        if "u_tok" in keys:
            items.append((keys["u_tok"], est_tokens, _scale(lim["tokens_per_day"], st), _DAY_TTL))
        if "u_units" in keys:
            items.append((keys["u_units"], int(math.ceil(units)), _scale(unit_key_limit, st), _DAY_TTL))
        if global_unit_key:
            g_lim = glim["og_images_per_day"] if unit_kind == "og_images" else glim["embed_tokens_per_day"]
            items.append((global_unit_key, int(math.ceil(units)), _scale(g_lim, st), _DAY_TTL))
        return st.check_and_incr(items)

    failed, _ = _run(op)
    if failed:
        reason = reasons[failed - 1]
        _record_denial(ctx, reason)
        if reason in ("tokens_day", "images_day", "tts_day"):
            limit = unit_key_limit if reason != "tokens_day" else lim["tokens_per_day"]
            raise _user_error(reason, ctx.tier, limit)
        raise _budget_error(reason)
    if global_unit_key:
        keys["g_units"] = global_unit_key
    return Reservation(
        ctx=ctx, provider=provider, model=model, reserved_micro=est_cost,
        reserved_tokens=est_tokens if unit_kind is None else 0,
        unit_kind=unit_kind, reserved_units=float(units), keys=keys,
        cost_per_unit_usd=cost_per_unit_usd,
    )


def _reserve_eval(ctx: GuardContext, provider: str, model: str, est_cost: int, est_tokens: int,
                  unit_kind: Optional[str], units: float, cost_per_unit_usd: Optional[float],
                  limit_usd: float, now: datetime) -> Reservation:
    """Eval calls: one counter (eval:cost:<day>) against LLM_EVAL_DAILY_BUDGET_USD.
    Nothing is charged to the global, provider, system or per-user counters."""
    if limit_usd <= 0:
        _record_denial(ctx, "eval_disabled")
        raise _eval_error("eval_disabled")
    key = _eval_key(now)
    failed, _ = _run(lambda st: st.check_and_incr([(key, est_cost, _scale(_micro(limit_usd), st), _DAY_TTL)]))
    if failed:
        _record_denial(ctx, "eval_day")
        raise _eval_error("eval_day")
    return Reservation(ctx=ctx, provider=provider, model=model, reserved_micro=est_cost,
                       reserved_tokens=est_tokens if unit_kind is None else 0, unit_kind=unit_kind,
                       reserved_units=float(units), keys={"eval_day": key}, cost_per_unit_usd=cost_per_unit_usd)


def reserve_system(feature: str, est_tokens: int, provider: str = "bedrock",
                   model: str = "claude-haiku-4-5") -> Reservation:
    """Reserve budget for a non-user (background) job; capped by LLM_SYSTEM_DAILY_BUDGET_USD.
    est_tokens is split 3:1 input:output for the estimate."""
    est_in = int(est_tokens * 0.75)
    return reserve(provider, model, est_input_tokens=est_in, est_output_tokens=est_tokens - est_in,
                   ctx=GuardContext(feature=feature, system=True, tier="system"))


# ─── Usage-metadata extraction ───────────────────────────────────────────────


def usage_from_langchain(result: Any) -> Tuple[int, int]:
    """(input_tokens, output_tokens) from a LangChain LLMResult or AIMessage."""
    msgs = []
    if hasattr(result, "generations"):
        for gen_list in result.generations or []:
            for g in gen_list or []:
                if getattr(g, "message", None) is not None:
                    msgs.append(g.message)
    else:
        msgs.append(result)
    tin = tout = 0
    for m in msgs:
        um = getattr(m, "usage_metadata", None) or {}
        if um:
            tin += int(um.get("input_tokens") or 0)
            tout += int(um.get("output_tokens") or 0)
            continue
        rm = getattr(m, "response_metadata", None) or {}
        u = rm.get("usage") or rm.get("token_usage") or {}
        tin += int(u.get("input_tokens") or u.get("prompt_tokens") or u.get("prompt_token_count") or 0)
        tout += int(u.get("output_tokens") or u.get("completion_tokens") or 0)
    if not (tin or tout):
        lo = getattr(result, "llm_output", None) or {}
        u = lo.get("usage") or lo.get("token_usage") or {}
        tin = int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
        tout = int(u.get("output_tokens") or u.get("completion_tokens") or 0)
    return tin, tout


@dataclass
class UsageBreakdown:
    """Provider usage normalised so ``input_tokens`` is the UNCACHED input only."""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def total_input(self) -> int:
        return self.input_tokens + self.cache_read_tokens + self.cache_write_tokens

    def __bool__(self) -> bool:
        return bool(self.total_input or self.output_tokens)


def usage_breakdown_from_langchain(result: Any) -> UsageBreakdown:
    """Uncached input / cache read / cache write / output from a LangChain
    LLMResult or AIMessage.

    The integrations disagree on what ``usage_metadata.input_tokens`` means:
    langchain-anthropic adds cache reads + writes into it (total_tokens ==
    input + output), langchain-aws passes Bedrock's ``inputTokens`` through,
    which EXCLUDES cached tokens (totalTokens counts them).  Decide per
    message from total_tokens; without it, treat input_tokens as inclusive
    only when it is large enough to contain the cache tokens."""
    msgs = []
    if hasattr(result, "generations"):
        for gen_list in result.generations or []:
            for g in gen_list or []:
                if getattr(g, "message", None) is not None:
                    msgs.append(g.message)
    else:
        msgs.append(result)
    out = UsageBreakdown()
    for m in msgs:
        um = getattr(m, "usage_metadata", None) or {}
        if um:
            tin = int(um.get("input_tokens") or 0)
            tout = int(um.get("output_tokens") or 0)
            det = um.get("input_token_details") or {}
            cr, cw = int(det.get("cache_read") or 0), int(det.get("cache_creation") or 0)
            if cr or cw:
                total = um.get("total_tokens")
                inclusive = (int(total) == tin + tout) if total is not None else tin >= cr + cw
                if inclusive:
                    tin = max(0, tin - cr - cw)
            out.input_tokens += tin
            out.output_tokens += tout
            out.cache_read_tokens += cr
            out.cache_write_tokens += cw
            continue
        rm = getattr(m, "response_metadata", None) or {}
        u = rm.get("usage") or rm.get("token_usage") or {}
        # raw Anthropic usage: input_tokens already excludes the cache fields
        out.input_tokens += int(u.get("input_tokens") or u.get("prompt_tokens") or u.get("prompt_token_count") or 0)
        out.output_tokens += int(u.get("output_tokens") or u.get("completion_tokens") or 0)
        out.cache_read_tokens += int(u.get("cache_read_input_tokens") or 0)
        out.cache_write_tokens += int(u.get("cache_creation_input_tokens") or 0)
    if not out:
        lo = getattr(result, "llm_output", None) or {}
        u = lo.get("usage") or lo.get("token_usage") or {}
        out.input_tokens = int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
        out.output_tokens = int(u.get("output_tokens") or u.get("completion_tokens") or 0)
    return out


def usage_from_anthropic(resp: Any) -> Tuple[int, int]:
    u = getattr(resp, "usage", None)
    return (int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0)) if u else (0, 0)


# ─── LangChain callback (attached by the guarded factories) ─────────────────

try:
    from langchain_core.callbacks import BaseCallbackHandler as _BaseCB
except Exception:  # pragma: no cover
    _BaseCB = object  # type: ignore[misc,assignment]


def _messages_chars(messages: Any) -> int:
    total = 0
    for batch in messages or []:
        for m in batch if isinstance(batch, (list, tuple)) else [batch]:
            c = getattr(m, "content", m)
            total += len(c) if isinstance(c, str) else len(json.dumps(c, default=str))
    return total


class GuardCallbackHandler(_BaseCB):  # type: ignore[misc]
    """Reserve before every chat-model call, reconcile from usage metadata after.

    raise_error=True makes a refused reservation abort the call; run_inline keeps
    it on the caller's thread/context.
    """

    raise_error = True
    run_inline = True

    def __init__(self, provider: str, model: str, max_output_tokens: int,
                 ctx: Optional[GuardContext] = None) -> None:
        super().__init__()
        self.provider = provider
        self.model = model
        self.max_output_tokens = max_output_tokens
        self._ctx = ctx.snapshot() if ctx else None
        self._runs: Dict[Any, Tuple[Reservation, List[int]]] = {}

    def _start(self, run_id: Any, prompt_chars: int) -> None:
        res = reserve(self.provider, self.model,
                      est_input_tokens=estimate_tokens(prompt_chars),
                      est_output_tokens=self.max_output_tokens,
                      ctx=self._ctx or current_context())
        self._runs[run_id] = (res, [0])

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):  # noqa: D401
        self._start(run_id, _messages_chars(messages))

    def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
        self._start(run_id, sum(len(p) for p in prompts or []))

    def on_llm_new_token(self, token, *, run_id, **kwargs):
        entry = self._runs.get(run_id)
        if entry:
            entry[1][0] += len(token or "")

    def on_llm_end(self, response, *, run_id, **kwargs):
        entry = self._runs.pop(run_id, None)
        if not entry:
            return
        res, streamed = entry
        u = usage_breakdown_from_langchain(response)
        if not u:  # provider returned no usage → estimate conservatively
            text = ""
            try:
                text = response.generations[0][0].text
            except Exception:  # noqa: BLE001
                pass
            res.commit(res.reserved_tokens - self.max_output_tokens,
                       estimate_tokens(max(streamed[0], len(text or ""))))
            return
        res.commit(u.input_tokens, u.output_tokens, cache_read_tokens=u.cache_read_tokens,
                   cache_write_tokens=u.cache_write_tokens)

    def on_llm_error(self, error, *, run_id, **kwargs):
        entry = self._runs.pop(run_id, None)
        if not entry:
            return
        res, streamed = entry
        if streamed[0]:  # partial stream was billed by the provider
            res.commit(res.reserved_tokens - self.max_output_tokens, estimate_tokens(streamed[0]), status_="partial")
        else:
            res.release()


# ─── Streaming output meter ─────────────────────────────────────────────────


class StreamMeter:
    """Counts streamed output; `add()` returns False once the token cap is reached."""

    def __init__(self, max_tokens: int) -> None:
        self.max_chars = max_tokens * 4
        self.chars = 0
        self.cut = False

    def add(self, text: str) -> bool:
        self.chars += len(text or "")
        if self.chars >= self.max_chars:
            self.cut = True
            return False
        return True

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.chars)


# ─── Deterministic-result cache (memory → Redis → DB) ───────────────────────

_mem_cache: "OrderedDict[str, Tuple[float, str]]" = OrderedDict()
_mem_lock = threading.Lock()
_MEM_MAX = 2000


def _redis_client():
    st = _store()
    return getattr(st, "_client", None)


def cache_get(key: str, *, persistent: bool = False) -> Optional[str]:
    now = time.time()
    with _mem_lock:
        hit = _mem_cache.get(key)
        if hit and hit[0] > now:
            _mem_cache.move_to_end(key)
            return hit[1]
    try:
        cli = _redis_client()
        if cli is not None:
            v = cli.get(_k("cache", key))
            if v is not None:
                _mem_put(key, v, 3600)
                return v
    except Exception:  # noqa: BLE001
        pass
    if persistent:
        try:
            from app.db.database import SessionLocal
            from app.models.ai_usage import AIResultCache

            db = SessionLocal()
            try:
                row = db.get(AIResultCache, key[:200])
                if row and (row.expires_at is None or row.expires_at.replace(tzinfo=timezone.utc) > _now()):
                    _mem_put(key, row.value, 3600)
                    return row.value
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001
            logger.debug("ai_guard cache db read failed: %s", exc)
    return None


def _mem_put(key: str, value: str, ttl: int) -> None:
    with _mem_lock:
        _mem_cache[key] = (time.time() + ttl, value)
        _mem_cache.move_to_end(key)
        while len(_mem_cache) > _MEM_MAX:
            _mem_cache.popitem(last=False)


def cache_set(key: str, value: str, ttl: int, *, persistent: bool = False) -> None:
    _mem_put(key, value, min(ttl, 86400))
    try:
        cli = _redis_client()
        if cli is not None:
            cli.setex(_k("cache", key), ttl, value)
    except Exception:  # noqa: BLE001
        pass
    if persistent:
        try:
            from app.db.database import SessionLocal
            from app.models.ai_usage import AIResultCache

            db = SessionLocal()
            try:
                row = db.get(AIResultCache, key[:200])
                exp = _now() + timedelta(seconds=ttl)
                if row:
                    row.value, row.expires_at = value, exp
                else:
                    db.add(AIResultCache(key=key[:200], value=value, expires_at=exp))
                db.commit()
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001
            logger.debug("ai_guard cache db write failed: %s", exc)


def cache_key(*parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


# ─── Read-side helpers (usage endpoints) ─────────────────────────────────────


def usage_summary(user_id: int, tier: str) -> Dict[str, Any]:
    lim = tier_limits(tier)
    d = _day()
    names = ["req", "tok", "in", "out", "cost", "images", "tts_chars"]
    try:
        vals, st = _run(lambda s: s.get_many([_k("u", user_id, n, d) for n in names]))
    except Exception:  # noqa: BLE001
        vals, st = [0] * len(names), None
    v = dict(zip(names, vals))
    scale = (lambda x: _scale(x, st)) if st is not None else (lambda x: x)
    req_lim, tok_lim = scale(lim["req_per_day"]), scale(lim["tokens_per_day"])
    paused = budget_paused()
    return {
        "tier": tier,
        "paused": bool(paused),
        "paused_message": BUDGET_PAUSED_DETAIL if paused else None,
        "requests_used": v["req"],
        "requests_limit": req_lim,
        "requests_remaining": max(0, req_lim - v["req"]),
        "tokens_used": v["tok"],
        "tokens_limit": tok_lim,
        "tokens_remaining": max(0, tok_lim - v["tok"]),
        "input_tokens": v["in"],
        "output_tokens": v["out"],
        "cost_usd": round(v["cost"] / 1e6, 4),
        "images_used": v["images"],
        "images_limit": scale(lim["images_per_day"]),
        "tts_chars_used": v["tts_chars"],
        "tts_chars_limit": scale(lim["tts_chars_per_day"]),
        "requests_per_minute": scale(lim["req_per_min"]),
        "resets_in_seconds": _seconds_to_midnight(),
    }


def global_summary() -> Dict[str, Any]:
    glim = global_limits()
    d, h = _day(), _hour()
    keys = [_k("g", "cost", d), _k("g", "costh", h), _k("sys", "cost", d), _k("g", "og_images", d),
            _k("g", "embed_tokens", d)] + [_k("p", p, "cost", d) for p in PROVIDERS] + [_eval_key()]
    try:
        vals, st = _run(lambda s: s.get_many(keys))
    except Exception:  # noqa: BLE001
        vals, st = [0] * len(keys), None
    providers = {
        p: {"spent_usd": round(vals[5 + i] / 1e6, 4), "budget_usd": glim[f"provider_daily_usd:{p}"]}
        for i, p in enumerate(PROVIDERS)
    }
    return {
        "today_spent_usd": round(vals[0] / 1e6, 4),
        "daily_budget_usd": glim["daily_usd"],
        "this_hour_spent_usd": round(vals[1] / 1e6, 4),
        "hourly_budget_usd": glim["hourly_usd"],
        "system_spent_usd": round(vals[2] / 1e6, 4),
        "system_budget_usd": glim["system_daily_usd"],
        "eval_spent_usd": round(vals[5 + len(PROVIDERS)] / 1e6, 4),
        "eval_budget_usd": glim["eval_daily_usd"],
        "og_images_today": vals[3],
        "embed_tokens_today": vals[4],
        "providers": providers,
        "paused": budget_paused(),
        "store": "fallback" if getattr(st, "is_fallback", False) else "redis" if isinstance(st, RedisStore) else "memory",
    }
