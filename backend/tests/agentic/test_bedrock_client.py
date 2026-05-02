"""Tests for LLM client factory — Bedrock → OpenAI → OpenRouter fallback chain."""
import os
import pytest
from unittest.mock import patch, MagicMock


# Helper: patch _aws_credentials_available at the module level so tests control Bedrock availability
_CREDS_PATH = "app.services.agentic.bedrock_client._aws_credentials_available"


def test_get_llm_sonnet_uses_bedrock_when_creds_available():
    """Bedrock wins when AWS credentials are available and PREFER_OPENAI=0."""
    with patch(_CREDS_PATH, return_value=True), \
         patch.dict(os.environ, {"PREFER_OPENAI": "0"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_aws import ChatBedrock
        assert isinstance(llm, ChatBedrock)
        assert llm.model_id == bc.BEDROCK_SONNET_MODEL
        assert llm.temperature == 0.1
        assert llm.max_tokens == 4096


def test_get_llm_sonnet_falls_back_to_openai():
    """OpenAI wins when AWS credentials unavailable."""
    with patch(_CREDS_PATH, return_value=False), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "0"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_openai import ChatOpenAI
        assert isinstance(llm, ChatOpenAI)
        assert llm.openai_api_base is None or "openrouter" not in str(llm.openai_api_base)


def test_get_llm_sonnet_falls_back_to_openrouter():
    """OpenRouter wins when no AWS credentials and no OpenAI key."""
    env = {
        "OPENAI_API_KEY": "",
        "OPENROUTER_API_KEY": "or-test-key",
        "PREFER_OPENAI": "0",
    }
    with patch(_CREDS_PATH, return_value=False), \
         patch.dict(os.environ, env, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_openai import ChatOpenAI
        assert isinstance(llm, ChatOpenAI)
        assert "openrouter" in str(llm.openai_api_base)


def test_prefer_openai_flag_skips_bedrock():
    """PREFER_OPENAI=1 forces OpenAI even when AWS credentials present."""
    with patch(_CREDS_PATH, return_value=True), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "1"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_sonnet(streaming=False)
        from langchain_openai import ChatOpenAI
        assert isinstance(llm, ChatOpenAI)


def test_get_llm_haiku_bedrock():
    """get_llm_haiku() returns ChatBedrock with correct model and temperature."""
    with patch(_CREDS_PATH, return_value=True), \
         patch.dict(os.environ, {"PREFER_OPENAI": "0"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_haiku()
        from langchain_aws import ChatBedrock
        assert isinstance(llm, ChatBedrock)
        assert llm.model_id == bc.BEDROCK_HAIKU_MODEL
        assert llm.temperature == 0.0
        assert llm.max_tokens == 1024


def test_get_llm_haiku_openai_fallback():
    """get_llm_haiku() falls back to gpt-4o-mini when no AWS credentials."""
    with patch(_CREDS_PATH, return_value=False), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "0"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        llm = bc.get_llm_haiku()
        from langchain_openai import ChatOpenAI
        assert isinstance(llm, ChatOpenAI)
        assert llm.model_name == bc.OPENAI_HAIKU_EQUIV


def test_get_embedder_returns_embedder():
    """get_embedder() returns object with embed_documents and embed_query."""
    from app.services.agentic.bedrock_client import get_embedder
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
