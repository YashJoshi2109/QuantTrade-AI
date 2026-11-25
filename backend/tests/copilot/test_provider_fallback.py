"""Call-time provider fallback + Bedrock circuit breaker.

Simulates the exact error Bedrock returns while Anthropic model access is not
enabled for the account:
  ResourceNotFoundException: Model use case details have not been submitted for
  this account. Fill out the Anthropic use case details form before using the model.
and asserts answers come from the direct Anthropic fallback, with ai_guard
accounting on provider "anthropic" (the failed Bedrock attempt is released).
"""
import asyncio
from typing import Any, List

import pytest
from botocore.exceptions import ClientError
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import PrivateAttr

from app.services import ai_guard
from app.services.agentic import bedrock_client as bc

USE_CASE_MSG = ("Model use case details have not been submitted for this account. "
                "Fill out the Anthropic use case details form before using the model.")


def rnf(op="ConverseStream"):
    return ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": USE_CASE_MSG}}, op)


class FailingBedrock(BaseChatModel):
    model_id: str
    _calls: int = PrivateAttr(default=0)

    @property
    def _llm_type(self) -> str:
        return "fake-bedrock"

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        self._calls += 1
        raise rnf("Converse")

    async def _astream(self, messages, stop=None, run_manager=None, **kw):
        self._calls += 1
        raise rnf()
        yield  # pragma: no cover

    def bind_tools(self, tools, **kw):
        return self


USAGE = {"input_tokens": 120, "output_tokens": 30, "total_tokens": 150}


class FakeAnthropic(BaseChatModel):
    """Streams scripted turns: {"text": ...} or {"tool_calls": [{name, args}]}."""
    model: str = "claude-fake"
    _script: List[dict] = PrivateAttr(default_factory=list)
    _i: int = PrivateAttr(default=0)

    @property
    def _llm_type(self) -> str:
        return "fake-anthropic"

    def _next(self) -> dict:
        self._i += 1
        return self._script.pop(0) if self._script else {"text": "ok"}   # script shared across instances

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        step = self._next()
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=step.get("text", ""),
                                                                        usage_metadata=USAGE))])

    async def _astream(self, messages, stop=None, run_manager=None, **kw):
        import json
        step = self._next()
        text = step.get("text", "")
        for k in range(0, len(text), 25):
            yield ChatGenerationChunk(message=AIMessageChunk(content=text[k:k + 25]))
        for n, c in enumerate(step.get("tool_calls") or []):
            yield ChatGenerationChunk(message=AIMessageChunk(content="", tool_call_chunks=[{
                "name": c["name"], "args": json.dumps(c["args"]), "id": f"tc{self._i}{n}", "index": n}]))
        yield ChatGenerationChunk(message=AIMessageChunk(content="", usage_metadata=USAGE))

    def bind_tools(self, tools, **kw):
        return self


@pytest.fixture
def providers(monkeypatch):
    """Bedrock 'enabled' by credentials but every Claude model not enabled; Anthropic key set."""
    from app.config import settings
    bc.reset_breaker()
    built = {"bedrock": [], "anthropic": []}
    script: List[dict] = []

    def bedrock(model_id, temperature, max_tokens, streaming):
        m = FailingBedrock(model_id=model_id,
                           callbacks=bc._guard("bedrock", model_id, max_tokens) + [bc.BedrockBreakerCallback(model_id)])
        built["bedrock"].append(m)
        return m

    def anthropic(model, max_tokens, temperature, streaming=False):
        m = FakeAnthropic(model=model, callbacks=bc._guard("anthropic", model, max_tokens))
        m._script = script
        built["anthropic"].append(m)
        return m

    monkeypatch.setattr(bc, "_aws_credentials_available", lambda: True)
    monkeypatch.setattr(bc, "_bedrock_llm", bedrock)
    monkeypatch.setattr(bc, "_anthropic_llm", anthropic)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    for k in ("OPENAI_API_KEY", "OPENROUTER_API_KEY", "NEXT_PUBLIC_OPENROUTER_API_KEY", "PREFER_OPENAI"):
        monkeypatch.delenv(k, raising=False)
    events: List[dict] = []
    ai_guard.set_persist_sink(events.append)
    yield built, script, events
    bc.reset_breaker()


def _ctx():
    return ai_guard.GuardContext("copilot", user_id=1, tier="pro", ip="10.0.0.9")


def test_error_classifier():
    assert bc.is_model_not_enabled_error(rnf())
    assert bc.is_model_not_enabled_error(ClientError({"Error": {"Code": "AccessDeniedException",
                                                                "Message": "You don't have access to the model"}}, "Converse"))
    assert bc.is_model_not_enabled_error(ClientError({"Error": {"Code": "ValidationException", "Message":
        "Invocation of model ID anthropic.claude-sonnet-4-6 with on-demand throughput isn't supported."}}, "Converse"))
    assert not bc.is_model_not_enabled_error(ClientError({"Error": {"Code": "ThrottlingException",
                                                                    "Message": "Too many requests"}}, "Converse"))


def test_plain_invoke_and_stream_fall_back_to_anthropic(providers):
    built, script, events = providers
    script += [{"text": "summary from anthropic"}, {"text": "streamed from anthropic"}]

    async def go():
        with ai_guard.use_context(_ctx()):
            llm = bc.get_llm_haiku()
            first = await llm.ainvoke("summarise")
            # breaker tripped -> the next factory call skips Bedrock entirely
            llm2 = bc.get_llm_haiku()
            chunks = [c.content async for c in llm2.astream("again")]
        return first, llm2, "".join(chunks)

    first, llm2, streamed = asyncio.run(go())
    assert first.content == "summary from anthropic"
    assert streamed == "streamed from anthropic"
    assert not bc.bedrock_model_available(bc.BEDROCK_HAIKU_MODEL)
    assert isinstance(llm2, FakeAnthropic)                       # Bedrock skipped while tripped
    assert len(built["bedrock"]) == 1 and built["bedrock"][0]._calls == 1
    assert events and all(e["provider"] == "anthropic" for e in events)   # failed Bedrock attempt released
    assert events[0]["input_tokens"] == 120 and events[0]["output_tokens"] == 30


def test_bedrock_stream_failure_before_first_token_falls_back(providers):
    """Stream path of the helper factory: error on the first chunk -> next provider."""
    built, script, events = providers
    script += [{"text": "fallback stream"}]

    async def go():
        with ai_guard.use_context(_ctx()):
            return "".join([c.content async for c in bc.get_llm_sonnet().astream("hi")])

    assert asyncio.run(go()) == "fallback stream"
    assert not bc.bedrock_model_available(bc.BEDROCK_SONNET_MODEL)
    assert [e["provider"] for e in events] == ["anthropic"]


def test_copilot_streaming_tool_use_falls_back_to_anthropic(providers):
    """Default copilot chain: Sonnet 5 profile and Sonnet 4.6 profile both fail with
    ResourceNotFoundException before any token; the Anthropic API runs the tool-use
    loop and streams the answer; both profiles are tripped for the next request."""
    from app.services.copilot.engine import CopilotEngine, CopilotRequest
    from app.services.copilot.evalkit import FixtureSources, fixture_db
    from app.services.copilot.memory import InMemoryStore
    built, script, events = providers
    script += [{"tool_calls": [{"name": "get_quote", "args": {"ticker": "MSFT"}}]},
               {"text": "NVIDIA is at $181.20 [quote:NVDA]; MSFT is $512.30 [quote:MSFT]."}]
    db = fixture_db()
    eng = CopilotEngine(db, sources=FixtureSources(), memory_store=InMemoryStore(), use_pack_cache=False)

    async def go():
        with ai_guard.use_context(_ctx()):
            return [ev async for ev in eng.run(CopilotRequest(message="NVDA vs MSFT price?", user_id=1, symbol="NVDA"))]

    evs = asyncio.run(go())
    names = [n for n, _ in evs]
    assert "error" not in names
    done = dict(evs)["done"]
    assert done["provider"] == "anthropic" and done["model"] == bc.COPILOT_MODEL_ANTHROPIC
    text = "".join(d["text"] for n, d in evs if n == "token")
    assert "$181.20" in text and "$512.30" in text
    assert [d["name"] for n, d in evs if n == "tool" and d["status"] == "done"] == ["get_quote"]
    assert eng.last_trace["provider_errors"] == [
        f"bedrock:{bc.COPILOT_MODEL_PRIMARY}:ClientError", f"bedrock:{bc.COPILOT_MODEL_FALLBACK}:ClientError"]
    assert not bc.bedrock_model_available(bc.COPILOT_MODEL_PRIMARY)
    assert not bc.bedrock_model_available(bc.COPILOT_MODEL_FALLBACK)
    assert events and all(e["provider"] == "anthropic" for e in events)
    assert len(events) == 2                                   # two Anthropic rounds, each reconciled
    # next request: breaker open -> Bedrock not even attempted
    assert [c.provider for c in bc.copilot_llm_candidates()] == ["anthropic"]
