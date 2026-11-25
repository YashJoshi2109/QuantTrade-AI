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
        callbacks=_guard("bedrock", model_id, max_tokens),
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
):
    """
    Bedrock → OpenAI → OpenRouter fallback chain.
    PREFER_OPENAI=1 skips Bedrock.
    Bedrock uses the boto3 credential chain (IAM role, env vars, ~/.aws).
    """
    prefer_openai = os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")

    if not prefer_openai and _aws_credentials_available():
        return _bedrock_llm(bedrock_model, temperature, max_tokens, streaming)

    if os.getenv("OPENAI_API_KEY"):
        return _openai_llm(openai_model, temperature, max_tokens, streaming)

    # Last resort: OpenRouter
    return _openrouter_llm(openrouter_model, temperature, max_tokens, streaming)


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
    )


ANTHROPIC_HAIKU_MODEL = "claude-haiku-4-5-20251001"


def get_llm_anthropic(model: str = ANTHROPIC_HAIKU_MODEL, max_tokens: int | None = None,
                      temperature: float = 0.0):
    """Direct Anthropic API (ANTHROPIC_API_KEY), guarded like the factories above.
    Returns None when no key / package is available."""
    from app.config import settings
    api_key = settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError:
        return None
    caps = _caps()
    cap = caps["max_tokens_sonnet"] if "sonnet" in model else caps["max_tokens_haiku"]
    mt = min(max_tokens or cap, cap)
    return ChatAnthropic(
        model=model,
        api_key=api_key,
        temperature=temperature,
        max_tokens=mt,
        timeout=_timeout(),
        max_retries=1,
        callbacks=_guard("anthropic", model, mt),
    )


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
        out.append(LLMCandidate("bedrock", COPILOT_MODEL_PRIMARY))
        if COPILOT_MODEL_FALLBACK and COPILOT_MODEL_FALLBACK != COPILOT_MODEL_PRIMARY:
            out.append(LLMCandidate("bedrock", COPILOT_MODEL_FALLBACK))
    if settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY"):
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
        from app.config import settings
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=candidate.model,
            api_key=settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY", ""),
            max_tokens=mt,
            timeout=_timeout(),
            max_retries=1,
            streaming=True,
            stream_usage=True,
            callbacks=_guard("anthropic", candidate.model, mt),
        )
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
