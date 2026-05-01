"""
LLM client factory.
Fallback chain: Bedrock → OpenAI → OpenRouter.

Priority rules:
  1. Bedrock   — AWS_BEARER_TOKEN_BEDROCK set and PREFER_OPENAI != 1
  2. OpenAI    — OPENAI_API_KEY set
  3. OpenRouter— OPENROUTER_API_KEY or NEXT_PUBLIC_OPENROUTER_API_KEY set
     (uses OpenAI-compatible API at https://openrouter.ai/api/v1)

Override: PREFER_OPENAI=1 skips Bedrock and goes straight to OpenAI/OpenRouter.

Bedrock model IDs (auto-enabled on first invocation in account):
  - anthropic.claude-sonnet-4-6
  - anthropic.claude-haiku-4-5-20251001-v1:0
  - amazon.titan-embed-text-v2:0

cohere 5.x: cohere.Client still exists and exposes .rerank().
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import cohere

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
        or os.getenv("NEXT_PUBLIC_OPENROUTER_API_KEY", "")
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
    """
    prefer_openai = os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")

    if not prefer_openai and os.getenv("AWS_BEARER_TOKEN_BEDROCK"):
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

@lru_cache(maxsize=1)
def get_embedder():
    """Titan Embeddings v2 — 1536d via Bedrock, zero-vector stub as fallback."""
    try:
        from langchain_aws import BedrockEmbeddings
        return BedrockEmbeddings(model_id=BEDROCK_TITAN_MODEL, region_name=REGION)
    except Exception:
        return _FallbackEmbedder()


class _FallbackEmbedder:
    """Zero-vector stub — used when Bedrock embeddings unavailable."""
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
    api_key = os.getenv("COHERE_API_KEY", "")
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
