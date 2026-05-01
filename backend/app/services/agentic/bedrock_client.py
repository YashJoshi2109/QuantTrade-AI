"""
LLM client factory.
Primary: AWS Bedrock via langchain-aws (uses AWS_BEARER_TOKEN_BEDROCK env var).

Model access must be enabled in AWS Console → Amazon Bedrock → Model access:
  - anthropic.claude-sonnet-4-6
  - anthropic.claude-haiku-4-5-20251001-v1:0
  - amazon.titan-embed-text-v2:0

Fallback chain (if PREFER_BEDROCK=0 or Bedrock call fails at runtime):
  Bedrock → Anthropic (ANTHROPIC_API_KEY) → OpenAI (OPENAI_API_KEY)

cohere 5.x notes:
  - cohere.Client still exists and exposes .rerank().
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import cohere

# ─── Bedrock model IDs ────────────────────────────────────────────────────────
# These require model access enabled in AWS Console → Bedrock → Model access.

BEDROCK_SONNET_MODEL = "anthropic.claude-sonnet-4-6"
BEDROCK_HAIKU_MODEL  = "anthropic.claude-haiku-4-5-20251001-v1:0"
BEDROCK_TITAN_MODEL  = "amazon.titan-embed-text-v2:0"

# Anthropic direct API fallback model IDs
ANTHROPIC_SONNET_MODEL = "claude-sonnet-4-6"
ANTHROPIC_HAIKU_MODEL  = "claude-haiku-4-5-20251001"

REGION = os.getenv("AWS_REGION", "us-east-1")
COHERE_RERANK_MODEL = "rerank-v3-5"


# ─── LLM factories ───────────────────────────────────────────────────────────

def _bedrock_llm(model_id: str, temperature: float, max_tokens: int, streaming: bool):
    from langchain_aws import ChatBedrock
    return ChatBedrock(
        model=model_id,
        region_name=REGION,
        temperature=temperature,
        max_tokens=max_tokens,
        streaming=streaming,
    )


def _anthropic_llm(model: str, temperature: float, max_tokens: int, streaming: bool):
    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(
        model=model,
        api_key=os.getenv("ANTHROPIC_API_KEY", ""),
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


def _pick_llm(
    *,
    bedrock_model: str,
    anthropic_model: str,
    openai_model: str,
    temperature: float,
    max_tokens: int,
    streaming: bool,
):
    """
    Priority: Bedrock → Anthropic → OpenAI.
    Set PREFER_OPENAI=1 to skip straight to OpenAI (dev convenience).
    AWS_BEARER_TOKEN_BEDROCK must be set for Bedrock path to work.
    """
    prefer_openai = os.getenv("PREFER_OPENAI", "0").lower() in ("1", "true", "yes")
    if prefer_openai:
        return _openai_llm(openai_model, temperature, max_tokens, streaming)

    bedrock_token = os.getenv("AWS_BEARER_TOKEN_BEDROCK", "")
    if bedrock_token:
        return _bedrock_llm(bedrock_model, temperature, max_tokens, streaming)

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if anthropic_key:
        return _anthropic_llm(anthropic_model, temperature, max_tokens, streaming)

    return _openai_llm(openai_model, temperature, max_tokens, streaming)


def get_llm_sonnet(streaming: bool = True):
    """Primary LLM — Claude Sonnet 4.6 via Bedrock (or fallback)."""
    return _pick_llm(
        bedrock_model=BEDROCK_SONNET_MODEL,
        anthropic_model=ANTHROPIC_SONNET_MODEL,
        openai_model="gpt-4o",
        temperature=0.1,
        max_tokens=4096,
        streaming=streaming,
    )


def get_llm_haiku(streaming: bool = False):
    """Fast LLM — Claude Haiku 4.5 via Bedrock (or fallback)."""
    return _pick_llm(
        bedrock_model=BEDROCK_HAIKU_MODEL,
        anthropic_model=ANTHROPIC_HAIKU_MODEL,
        openai_model="gpt-4o-mini",
        temperature=0.0,
        max_tokens=1024,
        streaming=streaming,
    )


# ─── Embeddings ───────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embedder():
    """Titan Embeddings v2 — 1536d via Bedrock, or zero-vector stub."""
    try:
        from langchain_aws import BedrockEmbeddings
        return BedrockEmbeddings(model_id=BEDROCK_TITAN_MODEL, region_name=REGION)
    except Exception:
        return _FallbackEmbedder()


class _FallbackEmbedder:
    """Zero-vector stub — returned when Bedrock embeddings unavailable."""
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
