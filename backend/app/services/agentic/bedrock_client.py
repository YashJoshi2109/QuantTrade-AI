"""
LLM / embedding / rerank client factory — the ONLY place paid AI clients are built
(tests/test_ai_guard_coverage.py enforces it).  Every client carries a
GuardCallbackHandler (or reserves through ai_guard) so usage is budgeted.

Chat fallback chain for the generic factories: Bedrock -> OpenAI -> OpenRouter.
  1. Bedrock    — AWS credentials resolvable via the boto3 chain and PREFER_OPENAI != 1
  2. OpenAI     — OPENAI_API_KEY set
  3. OpenRouter — OPENROUTER_API_KEY (OpenAI-compatible API)

Copilot answer chain (copilot_llm_candidates):
  Bedrock Claude Sonnet 5 (inference profile) -> Bedrock Sonnet 4.6 (profile)
  -> direct Anthropic API -> OpenAI.

Bedrock model ids MUST be cross-region inference profiles (``us.``/``global.``
prefix).  Bare ``anthropic.claude-*`` ids are rejected for on-demand
throughput by the newer Claude models — that was why prod forced
PREFER_OPENAI=1.  All ids are env-configurable:

  BEDROCK_SONNET_MODEL      (default us.anthropic.claude-sonnet-4-6)
  BEDROCK_HAIKU_MODEL       (default us.anthropic.claude-haiku-4-5-20251001-v1:0)
  COPILOT_MODEL_PRIMARY     (default us.anthropic.claude-sonnet-5)
  COPILOT_MODEL_FALLBACK    (default us.anthropic.claude-sonnet-4-6)
  COPILOT_MODEL_ANTHROPIC   (default claude-sonnet-5, direct API)
  COPILOT_MODEL_OPENAI      (default gpt-4o)

Embeddings: ONE pinned model (EMBED_MODEL, default
``openai:text-embedding-3-small:1536``; ``bedrock:amazon.titan-embed-text-v2:0:1024``
also supported).  There is no silent zero-vector fallback — when the pinned
provider is unavailable, embed_* raise EmbeddingUnavailable and callers
degrade to lexical (BM25) retrieval.
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any, NamedTuple

logger = logging.getLogger(__name__)


_aws_creds_cache: bool | None = None


def _aws_credentials_available() -> bool:
    """True if boto3 can resolve AWS credentials via the standard credential chain.

    Cached for the process lifetime (instance-metadata lookups can be slow).
    """
    global _aws_creds_cache
    if _aws_creds_cache is not None:
        return _aws_creds_cache
    try:
        import boto3
        session = boto3.Session()
        creds = session.get_credentials()
        _aws_creds_cache = creds is not None and creds.get_frozen_credentials() is not None
    except Exception:
        _aws_creds_cache = False
    return _aws_creds_cache


def _env(name: str, default: str) -> str:
    v = os.getenv(name, "").strip()
    return v or default


def _flag(name: str) -> bool:
    return os.getenv(name, "0").lower() in ("1", "true", "yes")


# ─── Model constants ─────────────────────────────────────────────────────────
# Inference-profile ids (on-demand invocation of current Claude models on
# Bedrock requires a profile, not the bare foundation-model id).
BEDROCK_SONNET_MODEL    = _env("BEDROCK_SONNET_MODEL", "us.anthropic.claude-sonnet-4-6")
BEDROCK_HAIKU_MODEL     = _env("BEDROCK_HAIKU_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
BEDROCK_TITAN_MODEL     = "amazon.titan-embed-text-v2:0"

COPILOT_MODEL_PRIMARY   = _env("COPILOT_MODEL_PRIMARY", "us.anthropic.claude-sonnet-5")
COPILOT_MODEL_FALLBACK  = _env("COPILOT_MODEL_FALLBACK", "us.anthropic.claude-sonnet-4-6")
COPILOT_MODEL_ANTHROPIC = _env("COPILOT_MODEL_ANTHROPIC", "claude-sonnet-5")
COPILOT_MODEL_OPENAI    = _env("COPILOT_MODEL_OPENAI", "gpt-4o")
# Direct Anthropic API fallbacks for the helper factories (accept temperature).
ANTHROPIC_HAIKU_MODEL   = _env("ANTHROPIC_HAIKU_MODEL", "claude-haiku-4-5-20251001")
ANTHROPIC_SONNET_MODEL  = _env("ANTHROPIC_SONNET_MODEL", "claude-sonnet-4-6")

# Amazon Nova — opt-in Bedrock-native alternatives
BEDROCK_NOVA_MICRO_MODEL = "amazon.nova-micro-v1:0"
BEDROCK_NOVA_LITE_MODEL  = "amazon.nova-lite-v1:0"
BEDROCK_NOVA_PRO_MODEL   = "amazon.nova-pro-v1:0"
USE_NOVA_MICRO = _flag("USE_NOVA_MICRO")
USE_NOVA_LITE  = _flag("USE_NOVA_LITE")
USE_NOVA_PRO   = _flag("USE_NOVA_PRO")

OPENAI_SONNET_EQUIV     = "gpt-4o"
OPENAI_HAIKU_EQUIV      = "gpt-4o-mini"

OPENROUTER_SONNET_MODEL = "anthropic/claude-3.5-sonnet"
OPENROUTER_HAIKU_MODEL  = "anthropic/claude-3-haiku"
OPENROUTER_BASE_URL     = "https://openrouter.ai/api/v1"

REGION = os.getenv("AWS_REGION", "us-east-1")
COHERE_RERANK_MODEL = "rerank-v3-5"


# ─── Provider helpers ─────────────────────────────────────────────────────────
# Every chat model is built here and ONLY here (tests/test_ai_guard_coverage.py
# enforces it).  Each one carries a GuardCallbackHandler that reserves budget
# before the call and reconciles from the provider's usage metadata after,
# plus a hard max_tokens and request timeout.

def _guard(provider: str, model: str, max_tokens: int):
    from app.services.ai_guard import GuardCallbackHandler, current_context
    return [GuardCallbackHandler(provider, model, max_tokens, ctx=current_context())]


# ─── Bedrock circuit breaker ──────────────────────────────────────────────────
# "Model use case details have not been submitted", AccessDenied, an unknown /
# non-profile model id ... are not transient: every request would pay a failed
# Bedrock round-trip before falling back.  Such a model is marked unavailable
# for BEDROCK_BREAKER_TTL_S (default 600s) in-process and in Redis (via the
# ai_guard cache), and the chains skip it.  Throttling only falls back.

BREAKER_TTL_S = int(os.getenv("BEDROCK_BREAKER_TTL_S", "600"))
_breaker: dict[str, float] = {}
_NOT_ENABLED_MARKERS = (
    "resourcenotfoundexception", "accessdeniedexception", "use case details", "model access",
    "not authorized", "don't have access", "do not have access", "on-demand throughput",
    "model identifier is invalid", "invalid model identifier", "unrecognizedclientexception",
)


def _breaker_key(model_id: str) -> str:
    return f"bedrock_down:{model_id}"


def is_model_not_enabled_error(exc: BaseException) -> bool:
    code = ""
    resp = getattr(exc, "response", None)
    if isinstance(resp, dict):
        code = str((resp.get("Error") or {}).get("Code") or "")
    text = f"{type(exc).__name__} {code} {exc}".lower()
    if "cachepoint" in text or "prompt cach" in text:
        # The model is fine; only the cache breakpoints were rejected (the
        # copilot retries uncached).  Never trip the breaker for that.
        return False
    if code == "ValidationException" or "validationexception" in text:
        return any(m in text for m in ("model", "inference profile", "on-demand"))
    return any(m in text for m in _NOT_ENABLED_MARKERS)


def mark_bedrock_unavailable(model_id: str, exc: BaseException | None = None) -> None:
    import time as _t
    already = _breaker.get(model_id, 0) > _t.monotonic()
    _breaker[model_id] = _t.monotonic() + BREAKER_TTL_S
    try:
        from app.services import ai_guard
        ai_guard.cache_set(_breaker_key(model_id), str(exc)[:200] if exc else "down", BREAKER_TTL_S)
    except Exception:
        pass
    if not already:
        logger.error("Bedrock model %s unavailable (%s); skipping it for %ss",
                     model_id, (str(exc) or type(exc).__name__)[:200] if exc else "marked", BREAKER_TTL_S)


def bedrock_model_available(model_id: str) -> bool:
    import time as _t
    until = _breaker.get(model_id)
    if until is not None:
        if until > _t.monotonic():
            return False
        _breaker.pop(model_id, None)
    try:
        from app.services import ai_guard
        if ai_guard.cache_get(_breaker_key(model_id)) is not None:   # another worker tripped it
            _breaker[model_id] = _t.monotonic() + 60
            return False
    except Exception:
        pass
    return True


def reset_breaker() -> None:
    _breaker.clear()


try:
    from langchain_core.callbacks import BaseCallbackHandler as _BreakerBase
except Exception:  # pragma: no cover
    _BreakerBase = object  # type: ignore[assignment,misc]


class BedrockBreakerCallback(_BreakerBase):  # type: ignore[misc,valid-type]
    """Trips the breaker when a Bedrock call fails with a not-enabled error
    (invoke and stream both report through on_llm_error)."""

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id

    def on_llm_error(self, error, **kwargs):  # noqa: D401
        if is_model_not_enabled_error(error):
            mark_bedrock_unavailable(self.model_id, error)


def fallback_exceptions() -> tuple:
    """Provider errors that should fall over to the next provider.  AIQuotaError
    (budget / rate limit) is deliberately NOT included: it must surface."""
    out: list = [TimeoutError, ConnectionError]
    for mod, names in (("botocore.exceptions", ("ClientError", "BotoCoreError")),
                       ("anthropic", ("APIError",)), ("openai", ("APIError",)),
                       ("httpx", ("HTTPError",))):
        try:
            m = __import__(mod, fromlist=list(names))
            out += [getattr(m, n) for n in names if hasattr(m, n)]
        except Exception:
            pass
    return tuple(out)


def _timeout() -> int:
    from app.services.ai_guard import io_caps
    return io_caps()["timeout_s"]


def _bedrock_llm(model_id: str, temperature: float | None, max_tokens: int, streaming: bool):
    """Bedrock Converse API (tool use + streaming for every Claude model).
    ``streaming`` is accepted for signature parity; Converse streams on astream()."""
    from botocore.config import Config
    from langchain_aws import ChatBedrockConverse
    return ChatBedrockConverse(
        model=model_id,
        region_name=REGION,
        temperature=temperature,
        max_tokens=max_tokens,
        config=Config(read_timeout=_timeout(), connect_timeout=10, retries={"max_attempts": 2}),
        callbacks=_guard("bedrock", model_id, max_tokens) + [BedrockBreakerCallback(model_id)],
    )


def _openai_llm(model: str, temperature: float, max_tokens: int, streaming: bool):
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model,
        api_key=os.getenv("OPENAI_API_KEY", ""),
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
        stream_usage=True,
        timeout=_timeout(),
        max_retries=1,
        callbacks=_guard("openai", model, max_tokens),
    )


def _openrouter_llm(model: str, temperature: float, max_tokens: int, streaming: bool):
    """OpenAI-compatible client pointed at OpenRouter."""
    from langchain_openai import ChatOpenAI
    api_key = (
        os.getenv("OPENROUTER_API_KEY")
        or os.getenv("NEXT_PUBLIC_OPENROUTER_API_KEY")
        or ""
    )
    if not api_key:
        raise RuntimeError(
            "No OpenRouter API key found. Set OPENROUTER_API_KEY or NEXT_PUBLIC_OPENROUTER_API_KEY."
        )
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
        stream_usage=True,
        timeout=_timeout(),
        max_retries=1,
        callbacks=_guard("openrouter", model, max_tokens),
        default_headers={
            "HTTP-Referer": "https://quanttrade.ai",
            "X-Title": "QuantTrade AI Copilot",
        },
    )


def _pick_llm(
    *,
    bedrock_model: str,
    openai_model: str,
    openrouter_model: str,
    temperature: float,
    max_tokens: int,
    streaming: bool,
    anthropic_model: str | None = None,
):
    """Bedrock -> Anthropic API -> OpenAI -> OpenRouter, failing over at CALL time.

    The first available provider is primary; the rest are attached with
    ``with_fallbacks`` so a Bedrock ResourceNotFound/AccessDenied/throttle on
    invoke OR on the first streamed chunk falls over to the next provider.
    Every model in the chain carries its own GuardCallbackHandler, so each
    attempt is reserved/reconciled against the right provider (a failed
    attempt is released).  PREFER_OPENAI=1 skips Bedrock; Bedrock models
    tripped by the circuit breaker are skipped for BEDROCK_BREAKER_TTL_S.
    """
    chain = []
    if not _flag("PREFER_OPENAI") and _aws_credentials_available() and bedrock_model_available(bedrock_model):
        chain.append(lambda: _bedrock_llm(bedrock_model, temperature, max_tokens, streaming))
    if anthropic_model:
        chain.append(lambda: get_llm_anthropic(anthropic_model, max_tokens=max_tokens, temperature=temperature))
    if os.getenv("OPENAI_API_KEY"):
        chain.append(lambda: _openai_llm(openai_model, temperature, max_tokens, streaming))
    if os.getenv("OPENROUTER_API_KEY") or os.getenv("NEXT_PUBLIC_OPENROUTER_API_KEY") or not chain:
        chain.append(lambda: _openrouter_llm(openrouter_model, temperature, max_tokens, streaming))
    models = []
    for build in chain:
        try:
            m = build()
        except Exception as exc:  # e.g. missing key / package: skip this provider
            logger.warning("LLM provider unavailable at build: %s", exc)
            m = None
        if m is not None:
            models.append(m)
    if not models:
        raise RuntimeError("No LLM provider configured (Bedrock, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY).")
    if len(models) == 1:
        return models[0]
    return models[0].with_fallbacks(models[1:], exceptions_to_handle=fallback_exceptions())


# ─── Public LLM factories ─────────────────────────────────────────────────────

def _caps() -> dict:
    from app.services.ai_guard import io_caps
    return io_caps()


def get_llm_sonnet(streaming: bool = True):
    """Primary LLM — Claude Sonnet 4.6 via Bedrock (or Nova Pro if USE_NOVA_PRO=1),
    GPT-4o or OpenRouter as fallback.  max_tokens = LLM_MAX_TOKENS_SONNET (2048)."""
    # Nova Pro is a solid Bedrock-native alternative when Sonnet is blocked/throttled
    bedrock_model = BEDROCK_NOVA_PRO_MODEL if USE_NOVA_PRO else BEDROCK_SONNET_MODEL
    return _pick_llm(
        bedrock_model=bedrock_model,
        openai_model=OPENAI_SONNET_EQUIV,
        openrouter_model=OPENROUTER_SONNET_MODEL,
        temperature=0.1,
        max_tokens=_caps()["max_tokens_sonnet"],
        streaming=streaming,
        anthropic_model=ANTHROPIC_SONNET_MODEL,
    )


def get_llm_haiku(streaming: bool = False, max_tokens: int | None = None):
    """Fast LLM — Claude Haiku 4.5 via Bedrock (or Nova Micro/Lite if USE_NOVA_MICRO/LITE=1),
    GPT-4o-mini or OpenRouter as fallback.  max_tokens <= LLM_MAX_TOKENS_HAIKU (1024).
    Priority: USE_NOVA_MICRO > USE_NOVA_LITE > Haiku 4.5"""
    if USE_NOVA_MICRO:
        bedrock_model = BEDROCK_NOVA_MICRO_MODEL
    elif USE_NOVA_LITE:
        bedrock_model = BEDROCK_NOVA_LITE_MODEL
    else:
        bedrock_model = BEDROCK_HAIKU_MODEL
    cap = _caps()["max_tokens_haiku"]
    return _pick_llm(
        bedrock_model=bedrock_model,
        openai_model=OPENAI_HAIKU_EQUIV,
        openrouter_model=OPENROUTER_HAIKU_MODEL,
        temperature=0.0,
        max_tokens=min(max_tokens or cap, cap),
        streaming=streaming,
        anthropic_model=ANTHROPIC_HAIKU_MODEL,
    )




def _anthropic_llm(model: str, max_tokens: int, temperature: float | None, streaming: bool = False):
    """The one place a direct-Anthropic chat model is constructed (guarded)."""
    from app.config import settings
    from langchain_anthropic import ChatAnthropic
    kw = {} if temperature is None else {"temperature": temperature}
    return ChatAnthropic(
        model=model,
        api_key=settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY", ""),
        max_tokens=max_tokens,
        timeout=_timeout(),
        max_retries=1,
        streaming=streaming,
        stream_usage=True,
        callbacks=_guard("anthropic", model, max_tokens),
        **kw,
    )


def anthropic_configured() -> bool:
    from app.config import settings
    return bool(settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY"))


def get_llm_anthropic(model: str = ANTHROPIC_HAIKU_MODEL, max_tokens: int | None = None,
                      temperature: float = 0.0):
    """Direct Anthropic API (ANTHROPIC_API_KEY), guarded like the factories above.
    Returns None when no key / package is available."""
    if not anthropic_configured():
        return None
    try:
        import langchain_anthropic  # noqa: F401
    except ImportError:
        return None
    caps = _caps()
    cap = caps["max_tokens_sonnet"] if "sonnet" in model else caps["max_tokens_haiku"]
    mt = min(max_tokens or cap, cap)
    # Sonnet 5 / newer models reject sampling params; only send temperature where accepted.
    temp = None if any(x in model for x in ("sonnet-5", "opus-5", "haiku-5")) else temperature
    return _anthropic_llm(model, mt, temp)


# ─── Copilot answer-model chain ───────────────────────────────────────────────


class LLMCandidate(NamedTuple):
    provider: str   # bedrock | anthropic | openai
    model: str


def copilot_llm_candidates() -> list[LLMCandidate]:
    """Ordered answer-model chain for the copilot, filtered by what is configured.

    Bedrock Sonnet 5 (profile) -> Bedrock Sonnet 4.6 (profile) -> Anthropic API -> OpenAI.
    PREFER_OPENAI=1 is honoured as an emergency switch (skips Bedrock).
    """
    from app.config import settings
    out: list[LLMCandidate] = []
    if not _flag("PREFER_OPENAI") and _aws_credentials_available():
        for mid in dict.fromkeys(m for m in (COPILOT_MODEL_PRIMARY, COPILOT_MODEL_FALLBACK) if m):
            if bedrock_model_available(mid):        # circuit breaker
                out.append(LLMCandidate("bedrock", mid))
    if anthropic_configured():
        out.append(LLMCandidate("anthropic", COPILOT_MODEL_ANTHROPIC))
    if os.getenv("OPENAI_API_KEY"):
        out.append(LLMCandidate("openai", COPILOT_MODEL_OPENAI))
    return out


def build_copilot_llm(candidate: LLMCandidate, max_tokens: int | None = None):
    """Guarded chat model for one chain entry.  No temperature is sent to
    Claude: Sonnet 5 rejects sampling parameters."""
    cap = _caps()["max_tokens_sonnet"]
    mt = min(max_tokens or cap, cap)
    if candidate.provider == "bedrock":
        return _bedrock_llm(candidate.model, None, mt, True)
    if candidate.provider == "anthropic":
        return _anthropic_llm(candidate.model, mt, None, streaming=True)
    if candidate.provider == "openai":
        return _openai_llm(candidate.model, 0.1, mt, True)
    raise ValueError(f"unknown provider {candidate.provider}")


# ─── Embeddings ───────────────────────────────────────────────────────────────


class EmbeddingUnavailable(RuntimeError):
    """The pinned embedding provider is not configured / reachable."""


class EmbeddingSpec(NamedTuple):
    provider: str   # openai | bedrock
    model: str
    dim: int

    @property
    def key(self) -> str:
        return f"{self.provider}:{self.model}:{self.dim}"


def embedding_spec() -> EmbeddingSpec:
    """The single pinned embedding model (EMBED_MODEL=provider:model:dim)."""
    raw = _env("EMBED_MODEL", "openai:text-embedding-3-small:1536")
    provider, _, rest = raw.partition(":")
    model, _, dim = rest.rpartition(":")
    try:
        return EmbeddingSpec(provider, model, int(dim))
    except ValueError:
        raise EmbeddingUnavailable(f"bad EMBED_MODEL={raw!r} (want provider:model:dim)")


_embedder_cache: dict[str, Any] = {}


def get_embedder():
    """Embedder for the pinned spec, cached per process (no warm-up call).

    Raises EmbeddingUnavailable when the pinned provider is not configured —
    never substitutes another model or zero vectors (that silently poisons
    the index and makes every query match nothing)."""
    spec = embedding_spec()
    hit = _embedder_cache.get(spec.key)
    if hit is not None:
        return hit
    if spec.provider == "openai":
        if not os.getenv("OPENAI_API_KEY"):
            raise EmbeddingUnavailable("EMBED_MODEL is OpenAI but OPENAI_API_KEY is not set")
        from langchain_openai import OpenAIEmbeddings
        embedder = OpenAIEmbeddings(model=spec.model, api_key=os.getenv("OPENAI_API_KEY", ""),
                                    dimensions=spec.dim)
    elif spec.provider == "bedrock":
        if not _aws_credentials_available():
            raise EmbeddingUnavailable("EMBED_MODEL is Bedrock but no AWS credentials")
        from langchain_aws import BedrockEmbeddings
        embedder = BedrockEmbeddings(model_id=spec.model, region_name=REGION,
                                     model_kwargs={"dimensions": spec.dim})
    else:
        raise EmbeddingUnavailable(f"unsupported embedding provider {spec.provider!r}")
    logger.info("Embedder pinned: %s", spec.key)
    _embedder_cache[spec.key] = embedder
    return embedder


def _guarded_embed(texts: list[str], query: bool) -> list[list[float]]:
    """Cap input size, serve from the content-hash cache, reserve budget for the rest.
    Output dimension is verified against the pinned spec (fail closed)."""
    import json as _json
    from app.services import ai_guard

    spec = embedding_spec()
    caps = ai_guard.io_caps()
    if len(texts) > caps["embed_max_texts"]:
        raise ValueError(f"Too many texts to embed in one call (max {caps['embed_max_texts']})")
    texts = [(t or " ")[: caps["embed_max_chars"]] for t in texts]
    keys = [ai_guard.cache_key("emb", spec.key, t) for t in texts]
    out: list = [None] * len(texts)
    missing: list[int] = []
    for i, k in enumerate(keys):
        hit = ai_guard.cache_get(k)
        if hit is not None:
            out[i] = _json.loads(hit)
        else:
            missing.append(i)
    if missing:
        embedder = get_embedder()
        todo = [texts[i] for i in missing]
        est = sum(ai_guard.estimate_tokens(t) for t in todo)
        res = ai_guard.reserve(spec.provider, spec.model, est_input_tokens=est, units=est,
                               unit_kind="embed_tokens")
        try:
            vecs = [embedder.embed_query(todo[0])] if query and len(todo) == 1 else embedder.embed_documents(todo)
        except Exception:
            res.release()
            raise
        res.commit(input_tokens=est, units=est)
        for i, v in zip(missing, vecs):
            if len(v) != spec.dim or not any(v):
                raise EmbeddingUnavailable(
                    f"embedder returned dim={len(v)} (zero={not any(v)}), expected {spec.dim}")
            out[i] = v
            ai_guard.cache_set(keys[i], _json.dumps(v), 30 * 86400)
    return out


def embed_texts(texts: list[str]) -> list[list[float]]:
    return _guarded_embed(list(texts), query=False)


def embed_query(text: str) -> list[float]:
    return _guarded_embed([text], query=True)[0]


# ─── Cohere rerank ────────────────────────────────────────────────────────────


def rerank_configured() -> bool:
    from app.config import settings
    return bool(settings.COHERE_API_KEY or os.getenv("COHERE_API_KEY"))


@lru_cache(maxsize=1)
def _cohere_client():
    import cohere
    from app.config import settings
    api_key = settings.COHERE_API_KEY or os.getenv("COHERE_API_KEY", "")
    return cohere.Client(api_key=api_key)


def rerank(
    query: str,
    documents: list[str],
    top_n: int = 10,
) -> list[dict[str, Any]]:
    """Rerank documents using Cohere Rerank v3.5. Returns {index, score} list.
    One search unit per call (<=100 docs); guarded by ai_guard."""
    from app.services import ai_guard
    documents = [d[:4000] for d in documents[:100]]
    res = ai_guard.reserve("cohere", COHERE_RERANK_MODEL, units=1, unit_kind="searches")
    try:
        result = _cohere_client().rerank(
            model=COHERE_RERANK_MODEL,
            query=query[:2000],
            documents=documents,
            top_n=top_n,
        )
    except Exception:
        res.release()
        raise
    res.commit(units=1)
    return [
        {"index": r.index, "score": r.relevance_score}
        for r in result.results
    ]
