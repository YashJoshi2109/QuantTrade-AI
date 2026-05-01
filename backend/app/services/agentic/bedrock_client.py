"""
AWS Bedrock client factory.
Provides Claude Sonnet (primary), Claude Haiku (fast ops),
Titan Embeddings v2 (1536d), and Cohere Rerank v3.

langchain-aws 1.x notes:
  - ChatBedrock uses `model` constructor param (exposed as .model_id).
  - `temperature` and `max_tokens` are first-class top-level fields on
    ChatBedrock; they must NOT be nested inside model_kwargs or they will
    be silently dropped from that dict.
  - Extra model-level kwargs (e.g. top_p) still go in model_kwargs.

cohere 5.x notes:
  - cohere.Client still exists and exposes .rerank().
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import cohere
from langchain_aws import ChatBedrock, BedrockEmbeddings

REGION = os.getenv("AWS_REGION", "us-east-1")

# Model IDs
SONNET_MODEL_ID = "anthropic.claude-sonnet-4-5"
HAIKU_MODEL_ID = "anthropic.claude-haiku-4-5-20251001"
TITAN_MODEL_ID = "amazon.titan-embed-text-v2:0"
COHERE_RERANK_MODEL = "rerank-v3-5"  # Cohere Python SDK model name


def get_llm_sonnet(streaming: bool = True) -> ChatBedrock:
    """Claude Sonnet — primary agent reasoning, 200K context."""
    return ChatBedrock(
        model=SONNET_MODEL_ID,
        region_name=REGION,
        temperature=0.1,
        max_tokens=4096,
        model_kwargs={"top_p": 0.9},
        streaming=streaming,
    )


def get_llm_haiku(streaming: bool = False) -> ChatBedrock:
    """Claude Haiku — fast ops: HyDE, query analysis, memory summarization."""
    return ChatBedrock(
        model=HAIKU_MODEL_ID,
        region_name=REGION,
        temperature=0.0,
        max_tokens=1024,
        streaming=streaming,
    )


@lru_cache(maxsize=1)
def get_embedder() -> BedrockEmbeddings:
    """Titan Embeddings v2 — 1536d, cached singleton."""
    return BedrockEmbeddings(
        model_id=TITAN_MODEL_ID,
        region_name=REGION,
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts using Titan v2. Returns list of 1536-dim vectors."""
    return get_embedder().embed_documents(texts)


def embed_query(text: str) -> list[float]:
    """Embed a single query string. Returns 1536-dim vector."""
    return get_embedder().embed_query(text)


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
    The Cohere API already returns results sorted by relevance_score desc.
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
