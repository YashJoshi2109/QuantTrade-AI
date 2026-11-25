"""
LLM client factory.
Fallback chain: Bedrock → OpenAI → OpenRouter.

Priority rules:
  1. Bedrock   — AWS credentials available via credential chain (IAM role, env, ~/.aws)
                 and PREFER_OPENAI != 1
  2. OpenAI    — OPENAI_API_KEY set
  3. OpenRouter— OPENROUTER_API_KEY or NEXT_PUBLIC_OPENROUTER_API_KEY set
     (uses OpenAI-compatible API at https://openrouter.ai/api/v1)

Override: PREFER_OPENAI=1 skips Bedrock and goes straight to OpenAI/OpenRouter.

Bedrock credentials: boto3 standard chain — env vars (AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY),
  ~/.aws/credentials, or EC2 instance metadata (IAM role). No custom env var needed.

Bedrock model IDs (auto-enabled on first invocation in account):
  - anthropic.claude-sonnet-4-6
  - anthropic.claude-haiku-4-5-20251001-v1:0
  - amazon.titan-embed-text-v2:0

cohere 5.x: cohere.Client still exists and exposes .rerank().
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

import cohere

logger = logging.getLogger(__name__)


_aws_creds_cache: bool | None = None


def _aws_credentials_available() -> bool:
    """True if boto3 can resolve AWS credentials via the standard credential chain.

    Result is cached for the process lifetime — avoids repeated boto3 I/O on
    every LLM call (instance metadata lookups can be slow / unreachable on EC2).
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

# ─── Model constants ─────────────────────────────────────────────────────────

BEDROCK_SONNET_MODEL    = "anthropic.claude-sonnet-4-6"
BEDROCK_HAIKU_MODEL     = "anthropic.claude-haiku-4-5-20251001-v1:0"
BEDROCK_TITAN_MODEL     = "amazon.titan-embed-text-v2:0"

# Amazon Nova — cost-effective Bedrock-native models
# Nova Micro: text-only, ~20x cheaper than Sonnet; ideal for routing/intent/HyDE
# Nova Lite:  text+image+video, ~10x cheaper than Sonnet; multimodal haiku-class
# Nova Pro:   most capable Nova, mid-tier between Haiku and Sonnet
BEDROCK_NOVA_MICRO_MODEL = "amazon.nova-micro-v1:0"
BEDROCK_NOVA_LITE_MODEL  = "amazon.nova-lite-v1:0"
BEDROCK_NOVA_PRO_MODEL   = "amazon.nova-pro-v1:0"

# USE_NOVA_MICRO=1 → Nova Micro for haiku-class calls (text-only, cheapest)
# USE_NOVA_LITE=1  → Nova Lite for haiku-class calls (multimodal, cheap)
# USE_NOVA_PRO=1   → Nova Pro for sonnet-class calls (mid-tier)
# Priority for haiku-class: MICRO > LITE > Haiku 4.5
USE_NOVA_MICRO = os.getenv("USE_NOVA_MICRO", "0").lower() in ("1", "true", "yes")
USE_NOVA_LITE  = os.getenv("USE_NOVA_LITE",  "0").lower() in ("1", "true", "yes")
USE_NOVA_PRO   = os.getenv("USE_NOVA_PRO",   "0").lower() in ("1", "true", "yes")

OPENAI_SONNET_EQUIV     = "gpt-4o"
OPENAI_HAIKU_EQUIV      = "gpt-4o-mini"

# OpenRouter model slugs (routed to best available provider)
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


def _bedrock_llm(model_id: str, temperature: float, max_tokens: int, streaming: bool):
    from botocore.config import Config
    from langchain_aws import ChatBedrock
    return ChatBedrock(
        model=model_id,
        region_name=REGION,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
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


# ─── Embeddings ───────────────────────────────────────────────────────────────

_embedder_cache: Any = None


def get_embedder():
    """
    Embedding provider chain: Bedrock Titan v2 → OpenAI text-embedding-3-small → zero stub.
    All return 1536-dim vectors so Qdrant collection schema stays consistent.

    The first real provider is cached for the process (no per-call warm-up
    embedding).  The zero stub is never cached, so a provider that becomes
    available later is picked up.
    """
    global _embedder_cache
    if _embedder_cache is not None:
        return _embedder_cache
    prefer_openai = os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")

    # 1. Bedrock Titan v2 — uses boto3 credential chain (IAM role, env, ~/.aws)
    if not prefer_openai and _aws_credentials_available():
        try:
            from langchain_aws import BedrockEmbeddings
            embedder = BedrockEmbeddings(model_id=BEDROCK_TITAN_MODEL, region_name=REGION)
            _EMBED_PROVIDER[id(embedder)] = ("bedrock", BEDROCK_TITAN_MODEL)
            logger.info("Embedder: Bedrock Titan v2")
            _embedder_cache = embedder
            return embedder
        except Exception as exc:
            logger.warning("Bedrock embedder unavailable (%s), trying OpenAI", exc)

    # 2. OpenAI text-embedding-3-small — 1536d, same dim as Titan v2
    if os.getenv("OPENAI_API_KEY"):
        try:
            from langchain_openai import OpenAIEmbeddings
            embedder = OpenAIEmbeddings(
                model="text-embedding-3-small",
                api_key=os.getenv("OPENAI_API_KEY", ""),
                dimensions=1536,
            )
            _EMBED_PROVIDER[id(embedder)] = ("openai", "text-embedding-3-small")
            logger.info("Embedder: OpenAI text-embedding-3-small")
            _embedder_cache = embedder
            return embedder
        except Exception as exc:
            logger.warning("OpenAI embedder unavailable (%s), using zero stub", exc)

    # 3. Zero stub — OpenRouter doesn't provide embeddings
    logger.error(
        "No embedding provider available (no AWS credentials, no OPENAI_API_KEY). "
        "Falling back to zero vectors — RAG search will be degraded!"
    )
    return _FallbackEmbedder()


_EMBED_PROVIDER: dict[int, tuple[str, str]] = {}


class _FallbackEmbedder:
    """Zero-vector stub — last resort when no embedding provider available."""
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 1536 for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return [0.0] * 1536


def _guarded_embed(texts: list[str], query: bool) -> list[list[float]]:
    """Cap input size, serve from the content-hash cache, reserve budget for the rest."""
    import json as _json
    from app.services import ai_guard

    caps = ai_guard.io_caps()
    if len(texts) > caps["embed_max_texts"]:
        raise ValueError(f"Too many texts to embed in one call (max {caps['embed_max_texts']})")
    texts = [(t or " ")[: caps["embed_max_chars"]] for t in texts]
    embedder = get_embedder()
    provider = _EMBED_PROVIDER.get(id(embedder))
    if provider is None:  # zero stub / test double: nothing billable
        return [embedder.embed_query(t) for t in texts] if query else embedder.embed_documents(texts)
    prov, model = provider
    keys = [ai_guard.cache_key("emb", model, t) for t in texts]
    out: list = [None] * len(texts)
    missing: list[int] = []
    for i, k in enumerate(keys):
        hit = ai_guard.cache_get(k)
        if hit is not None:
            out[i] = _json.loads(hit)
        else:
            missing.append(i)
    if missing:
        todo = [texts[i] for i in missing]
        est = sum(ai_guard.estimate_tokens(t) for t in todo)
        res = ai_guard.reserve(prov, model, est_input_tokens=est, units=est, unit_kind="embed_tokens")
        try:
            vecs = [embedder.embed_query(todo[0])] if query and len(todo) == 1 else embedder.embed_documents(todo)
        except Exception:
            res.release()
            raise
        res.commit(input_tokens=est, units=est)
        for i, v in zip(missing, vecs):
            out[i] = v
            ai_guard.cache_set(keys[i], _json.dumps(v), 30 * 86400)
    return out


def embed_texts(texts: list[str]) -> list[list[float]]:
    return _guarded_embed(list(texts), query=False)


def embed_query(text: str) -> list[float]:
    return _guarded_embed([text], query=True)[0]


# ─── Cohere rerank ────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _cohere_client() -> cohere.Client:
    from app.config import settings
    api_key = settings.COHERE_API_KEY or os.getenv("COHERE_API_KEY", "")
    return cohere.Client(api_key=api_key)


def rerank(
    query: str,
    documents: list[str],
    top_n: int = 10,
) -> list[dict[str, Any]]:
    """Rerank documents using Cohere Rerank v3. Returns {index, score} list.
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
