"""LLM client factory: Bedrock inference-profile ids, copilot answer chain, fallbacks.

Bedrock is never called: fake static credentials make boto3 build a client
offline, and we only inspect the constructed LangChain model.
"""
import os
from unittest.mock import MagicMock, patch

import pytest

_CREDS_PATH = "app.services.agentic.bedrock_client._aws_credentials_available"
FAKE_AWS = {"AWS_ACCESS_KEY_ID": "AKIAFAKE", "AWS_SECRET_ACCESS_KEY": "fake", "AWS_REGION": "us-east-2",
            "PREFER_OPENAI": "0"}


@pytest.fixture(autouse=True)
def _hermetic_keys(monkeypatch):
    """No real provider keys leak in; breaker starts closed."""
    from app.config import settings
    from app.services.agentic import bedrock_client as bc
    for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "NEXT_PUBLIC_OPENROUTER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(bc, "bedrock_model_available", lambda m: True)
    bc.reset_breaker()
    yield
    bc.reset_breaker()


def chain(llm):
    """[primary, *fallbacks] of a factory result (plain model when single provider)."""
    return [llm.runnable, *llm.fallbacks] if hasattr(llm, "fallbacks") else [llm]


@pytest.fixture
def aws(monkeypatch):
    for k, v in FAKE_AWS.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with patch(_CREDS_PATH, return_value=True):
        yield


def test_model_ids_are_inference_profiles():
    """Bare anthropic.* ids fail on-demand for current Claude models; profiles are required."""
    from app.services.agentic import bedrock_client as bc
    for mid in (bc.BEDROCK_SONNET_MODEL, bc.BEDROCK_HAIKU_MODEL, bc.COPILOT_MODEL_PRIMARY, bc.COPILOT_MODEL_FALLBACK):
        assert mid.startswith(("us.", "global.", "eu.", "apac.")), mid
    assert bc.COPILOT_MODEL_PRIMARY == "us.anthropic.claude-sonnet-5"
    assert bc.COPILOT_MODEL_FALLBACK == "us.anthropic.claude-sonnet-4-6"
    assert bc.BEDROCK_HAIKU_MODEL == "us.anthropic.claude-haiku-4-5-20251001-v1:0"


def test_copilot_chain_order_and_bedrock_profile_used(aws, monkeypatch):
    """Sonnet 5 profile -> Sonnet 4.6 profile -> Anthropic direct -> OpenAI; the built
    Bedrock model is Converse with the profile id and NO sampling params (Sonnet 5 rejects them)."""
    from app.config import settings
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    from app.services.agentic import bedrock_client as bc
    chain = bc.copilot_llm_candidates()
    assert [(c.provider, c.model) for c in chain] == [
        ("bedrock", "us.anthropic.claude-sonnet-5"),
        ("bedrock", "us.anthropic.claude-sonnet-4-6"),
        ("anthropic", "claude-sonnet-5"),
        ("openai", "gpt-4o"),
    ]
    from langchain_aws import ChatBedrockConverse
    llm = bc.build_copilot_llm(chain[0])
    assert isinstance(llm, ChatBedrockConverse)
    assert llm.model_id == "us.anthropic.claude-sonnet-5"
    assert llm.provider == "anthropic"
    assert llm.temperature is None
    assert llm.region_name == bc.REGION
    assert any(type(cb).__name__ == "GuardCallbackHandler" for cb in llm.callbacks)
    # tools bind on the profile model (tool-use loop)
    bound = llm.bind_tools([{"name": "get_quote", "description": "q", "input_schema": {
        "type": "object", "properties": {"ticker": {"type": "string"}}, "required": ["ticker"]}}])
    assert bound is not None


def test_copilot_chain_env_override(aws, monkeypatch):
    monkeypatch.setattr("app.services.agentic.bedrock_client.COPILOT_MODEL_PRIMARY", "global.anthropic.claude-sonnet-5")
    from app.services.agentic import bedrock_client as bc
    assert bc.copilot_llm_candidates()[0].model == "global.anthropic.claude-sonnet-5"


def test_prefer_openai_is_emergency_switch(aws, monkeypatch):
    monkeypatch.setenv("PREFER_OPENAI", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    from app.services.agentic import bedrock_client as bc
    assert [c.provider for c in bc.copilot_llm_candidates()][0] != "bedrock"


def test_get_llm_sonnet_uses_bedrock_profile_when_creds_available(aws):
    from app.services.agentic import bedrock_client as bc
    from langchain_aws import ChatBedrockConverse
    llm = chain(bc.get_llm_sonnet(streaming=False))[0]
    assert isinstance(llm, ChatBedrockConverse)
    assert llm.model_id == bc.BEDROCK_SONNET_MODEL
    assert llm.temperature == 0.1
    assert llm.max_tokens == 2048  # LLM_MAX_TOKENS_SONNET default (ai_guard)


def test_get_llm_haiku_bedrock_profile(aws):
    from app.services.agentic import bedrock_client as bc
    from langchain_aws import ChatBedrockConverse
    llm = chain(bc.get_llm_haiku())[0]
    assert isinstance(llm, ChatBedrockConverse)
    assert llm.model_id == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert llm.temperature == 0.0
    assert llm.max_tokens == 1024


def test_get_llm_sonnet_falls_back_to_openai():
    with patch(_CREDS_PATH, return_value=False), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "0"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        from langchain_openai import ChatOpenAI
        llm = bc.get_llm_sonnet(streaming=False)
        assert isinstance(llm, ChatOpenAI)
        assert llm.openai_api_base is None or "openrouter" not in str(llm.openai_api_base)


def test_get_llm_sonnet_falls_back_to_openrouter():
    env = {"OPENAI_API_KEY": "", "OPENROUTER_API_KEY": "or-test-key", "PREFER_OPENAI": "0"}
    with patch(_CREDS_PATH, return_value=False), patch.dict(os.environ, env, clear=False):
        from app.services.agentic import bedrock_client as bc
        from langchain_openai import ChatOpenAI
        llm = bc.get_llm_sonnet(streaming=False)
        assert isinstance(llm, ChatOpenAI)
        assert "openrouter" in str(llm.openai_api_base)


def test_get_llm_haiku_openai_fallback():
    with patch(_CREDS_PATH, return_value=False), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test", "PREFER_OPENAI": "0"}, clear=False):
        from app.services.agentic import bedrock_client as bc
        from langchain_openai import ChatOpenAI
        llm = bc.get_llm_haiku()
        assert isinstance(llm, ChatOpenAI)
        assert llm.model_name == bc.OPENAI_HAIKU_EQUIV


def test_embedding_spec_is_pinned(monkeypatch):
    from app.services.agentic import bedrock_client as bc
    monkeypatch.delenv("EMBED_MODEL", raising=False)
    spec = bc.embedding_spec()
    assert spec.key == "openai:text-embedding-3-small:1536"
    monkeypatch.setenv("EMBED_MODEL", "bedrock:amazon.titan-embed-text-v2:0:1024")
    assert bc.embedding_spec() == bc.EmbeddingSpec("bedrock", "amazon.titan-embed-text-v2:0", 1024)


def test_rerank_returns_sorted_results():
    from app.services.agentic.bedrock_client import rerank
    mock_result = MagicMock()
    mock_result.results = [MagicMock(index=1, relevance_score=0.95), MagicMock(index=0, relevance_score=0.72)]
    with patch("app.services.agentic.bedrock_client._cohere_client") as mock_co:
        mock_co.return_value.rerank.return_value = mock_result
        result = rerank("test query", ["doc A", "doc B"], top_n=2)
    assert result[0] == {"index": 1, "score": 0.95}
    assert result[1]["index"] == 0
