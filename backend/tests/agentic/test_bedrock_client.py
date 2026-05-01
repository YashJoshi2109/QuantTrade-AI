"""Tests for LLM client factory functions.

LLM selection: prefers Anthropic when ANTHROPIC_API_KEY set and PREFER_OPENAI!=1,
otherwise uses OpenAI.  Tests use env-patching to control which provider is chosen.
"""
import os
import pytest
from unittest.mock import patch, MagicMock


def test_get_llm_sonnet_with_anthropic():
    """get_llm_sonnet() returns ChatAnthropic when Anthropic key set."""
    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-ant-test", "PREFER_OPENAI": "0"}):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        model_name = getattr(llm, "model", getattr(llm, "model_name", ""))
        assert "claude" in model_name.lower() or "sonnet" in model_name.lower()
        assert llm.temperature == 0.1
        assert llm.max_tokens == 4096


def test_get_llm_sonnet_openai_fallback():
    """get_llm_sonnet() returns ChatOpenAI when PREFER_OPENAI=1."""
    with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "1"}):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        model_name = getattr(llm, "model_name", getattr(llm, "model", ""))
        assert "gpt" in model_name.lower()
        assert llm.temperature == 0.1
        assert llm.max_tokens == 4096


def test_get_llm_haiku_returns_fast_model():
    """get_llm_haiku() returns a fast model with low temperature."""
    llm = None
    with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "1"}):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_haiku()
    assert llm is not None
    assert llm.temperature == 0.0
    assert llm.max_tokens == 1024


def test_get_embedder_returns_embedder():
    """get_embedder() returns an object with embed_documents and embed_query."""
    from app.services.agentic.bedrock_client import get_embedder
    # lru_cache — clear to avoid stale instance from previous test
    get_embedder.cache_clear()
    embedder = get_embedder()
    assert hasattr(embedder, "embed_documents")
    assert hasattr(embedder, "embed_query")


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
