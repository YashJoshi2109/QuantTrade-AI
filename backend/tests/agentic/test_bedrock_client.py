"""Tests for LLM client factory — provider selection logic.

Priority: Bedrock (AWS_BEARER_TOKEN_BEDROCK) → Anthropic → OpenAI.
PREFER_OPENAI=1 forces OpenAI regardless.
"""
import os
import pytest
from unittest.mock import patch, MagicMock


def test_get_llm_sonnet_uses_bedrock_when_token_set():
    """get_llm_sonnet() returns ChatBedrock when AWS_BEARER_TOKEN_BEDROCK is set."""
    env = {"AWS_BEARER_TOKEN_BEDROCK": "test-token", "PREFER_OPENAI": "0"}
    with patch.dict(os.environ, env, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_aws import ChatBedrock
        assert isinstance(llm, ChatBedrock)
        assert llm.model_id == bc.BEDROCK_SONNET_MODEL
        assert llm.temperature == 0.1
        assert llm.max_tokens == 4096


def test_get_llm_sonnet_falls_back_to_anthropic():
    """get_llm_sonnet() uses ChatAnthropic when no Bedrock token but Anthropic key set."""
    env = {"AWS_BEARER_TOKEN_BEDROCK": "", "ANTHROPIC_API_KEY": "sk-ant-test", "PREFER_OPENAI": "0"}
    with patch.dict(os.environ, env, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_anthropic import ChatAnthropic
        assert isinstance(llm, ChatAnthropic)


def test_get_llm_sonnet_openai_when_prefer_openai():
    """get_llm_sonnet() uses ChatOpenAI when PREFER_OPENAI=1."""
    env = {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "1"}
    with patch.dict(os.environ, env, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_openai import ChatOpenAI
        assert isinstance(llm, ChatOpenAI)
        model_name = getattr(llm, "model_name", llm.model)
        assert model_name == "gpt-4o"


def test_get_llm_haiku_bedrock():
    """get_llm_haiku() returns ChatBedrock with correct model and temperature."""
    env = {"AWS_BEARER_TOKEN_BEDROCK": "test-token", "PREFER_OPENAI": "0"}
    with patch.dict(os.environ, env, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_haiku()
        from langchain_aws import ChatBedrock
        assert isinstance(llm, ChatBedrock)
        assert llm.model_id == bc.BEDROCK_HAIKU_MODEL
        assert llm.temperature == 0.0
        assert llm.max_tokens == 1024


def test_get_embedder_returns_embedder():
    """get_embedder() returns an object with embed_documents and embed_query."""
    from app.services.agentic.bedrock_client import get_embedder
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
        result = rerank("test query", ["doc A", "doc B"], top_n=2)
    assert result[0]["index"] == 1
    assert result[0]["score"] == 0.95
    assert result[1]["index"] == 0
