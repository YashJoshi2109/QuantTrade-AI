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

OPENAI_SONNET_EQUIV     = "gpt-4o"
OPENAI_HAIKU_EQUIV      = "gpt-4o-mini"

# OpenRouter model slugs (routed to best available provider)
OPENROUTER_SONNET_MODEL = "anthropic/claude-3.5-sonnet"
OPENROUTER_HAIKU_MODEL  = "anthropic/claude-3-haiku"
OPENROUTER_BASE_URL     = "https://openrouter.ai/api/v1"

REGION = os.getenv("AWS_REGION", "us-east-1")
COHERE_RERANK_MODEL = "rerank-v3-5"


# ─── Provider helpers ─────────────────────────────────────────────────────────

def _bedrock_llm(model_id: str, temperature: float, max_tokens: int, streaming: bool):
    from langchain_aws import ChatBedrock
    return ChatBedrock(
        model=model_id,
        region_name=REGION,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
    )


def _openai_llm(model: str, temperature: float, max_tokens: int, streaming: bool):
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model,
        api_key=os.getenv("OPENAI_API_KEY", ""),
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
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

def get_llm_sonnet(streaming: bool = True):
    """Primary LLM — Claude Sonnet 4.6 via Bedrock, GPT-4o or OpenRouter as fallback."""
    return _pick_llm(
        bedrock_model=BEDROCK_SONNET_MODEL,
        openai_model=OPENAI_SONNET_EQUIV,
        openrouter_model=OPENROUTER_SONNET_MODEL,
        temperature=0.1,
        max_tokens=4096,
        streaming=streaming,
    )


def get_llm_haiku(streaming: bool = False):
    """Fast LLM — Claude Haiku 4.5 via Bedrock, GPT-4o-mini or OpenRouter as fallback."""
    return _pick_llm(
        bedrock_model=BEDROCK_HAIKU_MODEL,
        openai_model=OPENAI_HAIKU_EQUIV,
        openrouter_model=OPENROUTER_HAIKU_MODEL,
        temperature=0.0,
        max_tokens=1024,
        streaming=streaming,
    )


# ─── Embeddings ───────────────────────────────────────────────────────────────

def get_embedder():
    """
    Embedding provider chain: Bedrock Titan v2 → OpenAI text-embedding-3-small → zero stub.
    All return 1536-dim vectors so Qdrant collection schema stays consistent.

    NOT cached with lru_cache — avoids baking in _FallbackEmbedder if credentials
    are not yet available at first import. Called only at embed time.
    """
    prefer_openai = os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")

    # 1. Bedrock Titan v2 — uses boto3 credential chain (IAM role, env, ~/.aws)
    if not prefer_openai and _aws_credentials_available():
        try:
            from langchain_aws import BedrockEmbeddings
            embedder = BedrockEmbeddings(model_id=BEDROCK_TITAN_MODEL, region_name=REGION)
            # Warm-test — raises immediately if Bedrock model access is blocked
            embedder.embed_query("ping")
            logger.info("Embedder: Bedrock Titan v2")
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
            logger.info("Embedder: OpenAI text-embedding-3-small")
            return embedder
        except Exception as exc:
            logger.warning("OpenAI embedder unavailable (%s), using zero stub", exc)

    # 3. Zero stub — OpenRouter doesn't provide embeddings
    logger.error(
        "No embedding provider available (no AWS credentials, no OPENAI_API_KEY). "
        "Falling back to zero vectors — RAG search will be degraded!"
    )
    return _FallbackEmbedder()


class _FallbackEmbedder:
    """Zero-vector stub — last resort when no embedding provider available."""
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 1536 for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return [0.0] * 1536


def embed_texts(texts: list[str]) -> list[list[float]]:
    return get_embedder().embed_documents(texts)


def embed_query(text: str) -> list[float]:
    return get_embedder().embed_query(text)


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
    """Rerank documents using Cohere Rerank v3. Returns {index, score} list."""
    result = _cohere_client().rerank(
        model=COHERE_RERANK_MODEL,
        query=query,
        documents=documents,
        top_n=top_n,
    )
    return [
        {"index": r.index, "score": r.relevance_score}
        for r in result.results
    ]
