"""Tests for Bedrock client factory functions.

Adapted for langchain-aws 1.x:
  - ChatBedrock uses `model` param (exposed as .model_id) and treats
    `temperature` / `max_tokens` as first-class top-level fields, NOT
    stored inside model_kwargs.
  - BedrockEmbeddings keeps `model_id` as a first-class field.

Adapted for cohere 5.x:
  - `cohere.Client` still exists; mock path is
    `app.services.agentic.bedrock_client._cohere_client`.
"""
import os
import pytest
from unittest.mock import patch, MagicMock


def test_get_llm_sonnet_returns_chat_bedrock():
    """get_llm_sonnet() returns a ChatBedrock instance with correct model."""
    from app.services.agentic.bedrock_client import get_llm_sonnet
    llm = get_llm_sonnet(streaming=False)
    assert llm.model_id == "anthropic.claude-sonnet-4-5"
    # In langchain-aws 1.x temperature and max_tokens are first-class fields
    assert llm.temperature == 0.1
    assert llm.max_tokens == 4096


def test_get_llm_haiku_returns_chat_bedrock():
    """get_llm_haiku() returns a ChatBedrock instance with correct model."""
    from app.services.agentic.bedrock_client import get_llm_haiku
    llm = get_llm_haiku()
    assert llm.model_id == "anthropic.claude-haiku-4-5-20251001"
    assert llm.temperature == 0.0
    assert llm.max_tokens == 1024


def test_get_embedder_returns_bedrock_embeddings():
    """get_embedder() returns BedrockEmbeddings with Titan v2 model."""
    from app.services.agentic.bedrock_client import get_embedder
    embedder = get_embedder()
    assert embedder.model_id == "amazon.titan-embed-text-v2:0"


def test_embed_texts_returns_correct_dimension():
    """embed_texts() returns 1536-dimensional vectors."""
    from app.services.agentic.bedrock_client import embed_texts
    mock_vectors = [[0.1] * 1536, [0.2] * 1536]
    with patch("app.services.agentic.bedrock_client.get_embedder") as mock:
        mock.return_value.embed_documents.return_value = mock_vectors
        result = embed_texts(["hello world", "financial analysis"])
    assert len(result) == 2
    assert len(result[0]) == 1536


def test_rerank_returns_sorted_results():
    """rerank() returns results sorted by relevance score descending."""
    from app.services.agentic.bedrock_client import rerank
    mock_result = MagicMock()
    mock_result.results = [
        MagicMock(index=1, relevance_score=0.95),
        MagicMock(index=0, relevance_score=0.72),
    ]
    with patch("app.services.agentic.bedrock_client._cohere_client") as mock_co:
        mock_co.return_value.rerank.return_value = mock_result
        docs = ["doc A", "doc B"]
        result = rerank("test query", docs, top_n=2)
    assert result[0]["index"] == 1
    assert result[0]["score"] == 0.95
    assert result[1]["index"] == 0
