"""
LLM client factory.
Primary: langchain-anthropic ChatAnthropic (uses ANTHROPIC_API_KEY).
Fallback: AWS Bedrock via langchain-aws (uses AWS_BEARER_TOKEN_BEDROCK).

Embeddings: AWS Titan v2 via BedrockEmbeddings (when AWS creds available)
            otherwise falls back to a no-op stub that returns random vectors
            for dev/test (Qdrant collection will still be usable offline).

cohere 5.x notes:
  - cohere.Client still exists and exposes .rerank().
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import cohere

# ─── Model constants ─────────────────────────────────────────────────────────

ANTHROPIC_SONNET_MODEL = "claude-sonnet-4-6"        # latest Sonnet 4.6
ANTHROPIC_HAIKU_MODEL  = "claude-haiku-4-5-20251001"  # Haiku 4.5

REGION = os.getenv("AWS_REGION", "us-east-1")
TITAN_MODEL_ID = "amazon.titan-embed-text-v2:0"
COHERE_RERANK_MODEL = "rerank-v3-5"


# ─── LLM factories ───────────────────────────────────────────────────────────

def _pick_llm(
    *,
    anthropic_model: str,
    openai_model: str,
    temperature: float,
    max_tokens: int,
    streaming: bool,
):
    """
    LLM selection: OpenAI when PREFER_OPENAI=1 or Anthropic key absent/empty,
    otherwise Anthropic.  Set PREFER_OPENAI=1 in .env when Anthropic credits
    are exhausted.
    """
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    prefer_openai  = os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")

    if anthropic_key and not prefer_openai:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=anthropic_model,
            api_key=anthropic_key,
            temperature=temperature,
            max_tokens=max_tokens,
            streaming=streaming,
        )

    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=openai_model,
        api_key=os.getenv("OPENAI_API_KEY", ""),
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
    )


def get_llm_sonnet(streaming: bool = True):
    """Primary LLM — Claude Sonnet 4.6 or GPT-4o."""
    return _pick_llm(
        anthropic_model=ANTHROPIC_SONNET_MODEL,
        openai_model="gpt-4o",
        temperature=0.1,
        max_tokens=4096,
        streaming=streaming,
    )


def get_llm_haiku(streaming: bool = False):
    """Fast LLM — Claude Haiku 4.5 or GPT-4o-mini."""
    return _pick_llm(
        anthropic_model=ANTHROPIC_HAIKU_MODEL,
        openai_model="gpt-4o-mini",
        temperature=0.0,
        max_tokens=1024,
        streaming=streaming,
    )


# ─── Embeddings ───────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embedder():
    """Titan Embeddings v2 — 1536d via Bedrock, or stub when unavailable."""
    try:
        from langchain_aws import BedrockEmbeddings
        return BedrockEmbeddings(model_id=TITAN_MODEL_ID, region_name=REGION)
    except Exception:
        return _FallbackEmbedder()


class _FallbackEmbedder:
    """Zero-dependency stub — returns zero vectors (1536d) when Bedrock unavailable."""
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 1536 for _ in texts]

    def embed_query(self, text: str) -> list[float]:
        return [0.0] * 1536


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts. Returns list of 1536-dim vectors."""
    return get_embedder().embed_documents(texts)


def embed_query(text: str) -> list[float]:
    """Embed a single query string. Returns 1536-dim vector."""
    return get_embedder().embed_query(text)


# ─── Cohere rerank ────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _cohere_client() -> cohere.Client:
    """Cohere client — uses COHERE_API_KEY env var."""
    api_key = os.getenv("COHERE_API_KEY", "")
    return cohere.Client(api_key=api_key)


def rerank(
    query: str,
    documents: list[str],
    top_n: int = 10,
) -> list[dict[str, Any]]:
    """
    Rerank documents against query using Cohere Rerank v3.
    Returns list of {index: int, score: float} sorted by score descending.
    """
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
