"""Copilot token cost: prompt budget, compact payload, prompt caching, and
cache-aware usage accounting in ai_guard.  No real LLM is called."""
from __future__ import annotations

import asyncio
import json

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.services import ai_guard
from app.services.ai_guard import GuardContext
from app.services.copilot.evalkit import FixtureSources, ScriptedLLM, fixture_db
from app.services.copilot.prompt import (cache_call_kwargs, history_messages, system_message,
                                         system_prompt, user_turn)
from app.services.copilot.tools import lc_tools
from .prod_like import prod_like_history, prod_like_pack

QUESTION = "What is Apple's P/E and how did revenue grow last quarter?"


def _est(s: str) -> int:
    return ai_guard.estimate_tokens(s)          # char/4, the guard's own estimator


def _prompt_parts(with_filings: bool):
    pack = prod_like_pack(with_filings=with_filings)
    prefix = system_prompt() + json.dumps(lc_tools(), separators=(",", ":"))
    hist = "".join(c for _, c in history_messages(prod_like_history()))
    turn = user_turn(QUESTION, [pack])
    return prefix, hist, turn


# ── prompt budget ────────────────────────────────────────────────────────────
# Before the trim a production-sized AAPL pack + history was ~8.2k tokens per
# model call (~10.1k with filing passages), re-sent on every tool round.

@pytest.mark.parametrize("with_filings,budget,uncached_budget", [(False, 4600, 3400), (True, 6000, 4800)])
def test_representative_aapl_prompt_stays_under_budget(with_filings, budget, uncached_budget):
    prefix, hist, turn = _prompt_parts(with_filings)
    total = _est(prefix) + _est(hist) + _est(turn)
    assert total <= budget, f"prompt {total} tokens > {budget}"
    # the part that is not served from the prompt cache
    assert _est(hist) + _est(turn) <= uncached_budget
    # the cached prefix must clear Anthropic's 1024-token minimum to be cacheable at all
    assert _est(prefix) >= 1024


def test_prompt_budget_with_real_tokenizer():
    tiktoken = pytest.importorskip("tiktoken")
    enc = tiktoken.get_encoding("cl100k_base")
    prefix, hist, turn = _prompt_parts(True)
    assert len(enc.encode(prefix + hist + turn)) <= 6000


def test_compact_payload_keeps_grounding():
    pack = prod_like_pack(with_filings=True)
    p = pack.llm_payload()
    shown = p["financial_statements"]
    assert [s["id"] for s in shown][:4] == [s.id for s in pack.statements if s.fiscal_quarter][:4]
    assert sum(1 for s in shown if s["period_label"].startswith("FY")) == 2
    latest = shown[0]
    assert {"revenue", "net_income", "gross_margin_pct", "revenue_yoy_pct", "period_end", "filed"} <= set(latest)
    assert "source" not in latest and "fiscal_year" not in latest and "period" not in latest
    assert "get_financials" in p["financial_statements_more"]
    assert len(p["news_last_7d"]) == 5
    assert all("url" not in n and len(n.get("summary", "")) <= 250 for n in p["news_last_7d"])
    assert all(len(c["text"]) <= 1410 and c["id"].startswith("filing:") for c in p["filing_excerpts"])
    # nulls / empty sections are dropped entirely
    assert "identity" not in p and all(v is not None for v in p.values())
    # fundamentals keep the valuation fields the evaluation asked about
    assert p["fundamentals"]["pe_ratio"] == 35.2 and p["fundamentals"]["ev_to_ebitda"] == 26.1
    # numbers are serialised without float noise but still match the registry within tolerance
    assert isinstance(latest["revenue"], int)
    assert abs(latest["revenue"] - pack.statements[0].revenue) < 1


def test_get_financials_tool_still_returns_every_period():
    from app.services.copilot.registry import FactRegistry
    from app.services.copilot.tools import ToolExecutor
    pack = prod_like_pack()
    ex = ToolExecutor(None, FactRegistry(), None, {"AAPL": pack}, None)
    content, facts, err = asyncio.run(ex.run("get_financials", {"ticker": "AAPL"}))
    assert not err and len(facts) == len(pack.statements) == 11
    assert content.count('"id":"fs:AAPL:') == 11


def test_history_is_capped():
    h = history_messages(prod_like_history())
    assert len(h) == 4 and all(len(c) <= 905 for _, c in h)


# ── prompt caching ───────────────────────────────────────────────────────────

def test_cache_breakpoints_per_provider():
    a = system_message("anthropic")
    assert isinstance(a.content, list) and a.content[0]["cache_control"] == {"type": "ephemeral"}
    assert a.content[0]["text"] == system_prompt()
    assert cache_call_kwargs("anthropic") == {"cache_control": {"type": "ephemeral"}}
    assert cache_call_kwargs("bedrock") == {"cache_control": {"type": "ephemeral"}}
    assert isinstance(system_message("bedrock").content, str)
    for p in ("openai", "openrouter", "scripted"):
        assert cache_call_kwargs(p) == {} and isinstance(system_message(p).content, str)


def test_cache_can_be_disabled(monkeypatch):
    monkeypatch.setenv("COPILOT_PROMPT_CACHE", "0")
    assert cache_call_kwargs("anthropic") == {} and isinstance(system_message("anthropic").content, str)


def test_anthropic_request_payload_has_stable_prefix_breakpoint():
    """The real langchain-anthropic payload: breakpoint on the system block
    (caches tools + system) and on the newest message; per-request data comes
    after the stable prefix."""
    pytest.importorskip("langchain_anthropic")
    from langchain_anthropic import ChatAnthropic
    llm = ChatAnthropic(model="claude-sonnet-5", api_key="sk-test-not-used", max_tokens=64)
    msgs = [system_message("anthropic"), HumanMessage(user_turn(QUESTION, [prod_like_pack()]))]
    payload = llm._get_request_payload(msgs, tools=lc_tools(), **cache_call_kwargs("anthropic"))
    assert payload["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "<context source=" not in json.dumps(payload["system"])
    assert payload["messages"][-1]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert [t["name"] for t in payload["tools"]] == [t["name"] for t in lc_tools()]


def test_bedrock_converse_gets_cache_points():
    pytest.importorskip("langchain_aws")
    from langchain_aws import ChatBedrockConverse
    llm = ChatBedrockConverse(model="us.anthropic.claude-sonnet-5", region_name="us-east-1",
                              aws_access_key_id="x", aws_secret_access_key="y")
    system = [{"text": system_prompt()}]
    msgs = [{"role": "user", "content": [{"text": "q"}]}]
    params = {"toolConfig": {"tools": [{"toolSpec": {"name": t["name"]}} for t in lc_tools()]}}
    llm._apply_cache_points(cache_call_kwargs("bedrock")["cache_control"], system, msgs, params)
    assert system[-1] == {"cachePoint": {"type": "default"}}
    assert msgs[-1]["content"][-1] == {"cachePoint": {"type": "default"}}
    assert params["toolConfig"]["tools"][-1] == {"cachePoint": {"type": "default"}}


class RecordingLLM(ScriptedLLM):
    def __init__(self, steps, fail_with=None):
        super().__init__(steps)
        self.kwargs = []
        self.fail_with = fail_with

    async def astream(self, messages, **kw):
        self.kwargs.append(kw)
        if self.fail_with is not None:
            err, self.fail_with = self.fail_with, None
            self.seen.append(list(messages))
            raise err
        async for ch in super().astream(messages, **kw):
            yield ch


def _run(provider, llm, model="m"):
    from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
    from app.services.copilot.memory import InMemoryStore
    eng = CopilotEngine(fixture_db(), sources=FixtureSources(), memory_store=InMemoryStore(),
                        llm_chain=[LLMHandle(provider, model, lambda: llm)], use_pack_cache=False)

    async def go():
        return [ev async for ev in eng.run(CopilotRequest(message="What is AAPL's P/E?", user_id=1))]
    return asyncio.run(go()), eng


def test_engine_sends_cache_breakpoints_every_round_for_anthropic():
    llm = RecordingLLM([{"tool_calls": [{"name": "get_quote", "args": {"ticker": "MSFT"}}]},
                        {"text": "Apple P/E is in data [fund:AAPL]."}])
    events, eng = _run("anthropic", llm)
    assert not [d for n, d in events if n == "error"]
    assert llm.kwargs == [{"cache_control": {"type": "ephemeral"}}] * 2
    for msgs in llm.seen:
        assert msgs[0].content[0]["cache_control"] == {"type": "ephemeral"}
    assert eng.last_trace["prompt_cache"] is True


def test_engine_sends_no_cache_params_to_openai():
    llm = RecordingLLM([{"text": "Apple [fund:AAPL]."}])
    _run("openai", llm)
    assert llm.kwargs == [{}] and isinstance(llm.seen[0][0].content, str)


def test_engine_retries_uncached_when_cache_points_rejected():
    from app.services.copilot import engine as eng_mod
    eng_mod._CACHE_REJECTED.discard("nocache-model")
    err = RuntimeError("ValidationException: cachePoint is not supported for this model")
    llm = RecordingLLM([{"text": "Apple [fund:AAPL]."}], fail_with=err)
    events, eng = _run("bedrock", llm, model="nocache-model")
    assert not [d for n, d in events if n == "error"]
    assert llm.kwargs[0] == {"cache_control": {"type": "ephemeral"}} and llm.kwargs[1] == {}
    assert "nocache-model" in eng_mod._CACHE_REJECTED
    eng_mod._CACHE_REJECTED.discard("nocache-model")


def test_cache_rejection_does_not_trip_bedrock_breaker():
    from app.services.agentic.bedrock_client import is_model_not_enabled_error
    assert not is_model_not_enabled_error(RuntimeError("ValidationException: cachePoint not supported by model"))


# ── cache-aware accounting ──────────────────────────────────────────────────

def _msg(um):
    return AIMessage(content="ok", usage_metadata=um)


def test_usage_breakdown_anthropic_inclusive_input():
    # langchain-anthropic: input_tokens = uncached + cache_read + cache_creation
    u = ai_guard.usage_breakdown_from_langchain(_msg({
        "input_tokens": 5300, "output_tokens": 400, "total_tokens": 5700,
        "input_token_details": {"cache_read": 1200, "cache_creation": 4000}}))
    assert (u.input_tokens, u.cache_read_tokens, u.cache_write_tokens, u.output_tokens) == (100, 1200, 4000, 400)


def test_usage_breakdown_bedrock_exclusive_input():
    # langchain-aws passes Bedrock inputTokens through (excludes cache), totalTokens counts it
    u = ai_guard.usage_breakdown_from_langchain(_msg({
        "input_tokens": 100, "output_tokens": 400, "total_tokens": 5700,
        "input_token_details": {"cache_read": 1200, "cache_creation": 4000}}))
    assert (u.input_tokens, u.cache_read_tokens, u.cache_write_tokens) == (100, 1200, 4000)


def test_usage_breakdown_raw_anthropic_response_metadata():
    m = AIMessage(content="x", response_metadata={"usage": {
        "input_tokens": 50, "output_tokens": 10, "cache_read_input_tokens": 900, "cache_creation_input_tokens": 0}})
    u = ai_guard.usage_breakdown_from_langchain(m)
    assert (u.input_tokens, u.cache_read_tokens, u.output_tokens) == (50, 900, 10)


def test_cost_prices_cache_reads_and_writes():
    m = "claude-sonnet-5"        # $2 / $10 per 1M
    assert ai_guard.estimate_cost(m, cache_read_tokens=1_000_000) == pytest.approx(0.2)
    assert ai_guard.estimate_cost(m, cache_write_tokens=1_000_000) == pytest.approx(2.5)
    assert ai_guard.estimate_cost(m, 1_000_000, 1_000_000) == pytest.approx(12.0)
    assert ai_guard.weighted_tokens(100, 400, 1200, 4000) == 100 + 400 + 120 + 5000


def test_commit_charges_user_cost_equivalent_tokens():
    events = []
    ai_guard.set_persist_sink(events.append)
    ctx = GuardContext(feature="copilot", user_id=7, tier="free")
    res = ai_guard.reserve("anthropic", "claude-sonnet-5", est_input_tokens=6000, est_output_tokens=2048, ctx=ctx)
    cost = res.commit(100, 400, cache_read_tokens=1200, cache_write_tokens=4000)
    assert cost == pytest.approx((100 + 120 + 5000) / 1e6 * 2 + 400 / 1e6 * 10)
    u = ai_guard.usage_summary(7, "free")
    assert u["tokens_used"] == 5620                       # not 5700 raw tokens
    assert u["input_tokens"] == 5300 and u["output_tokens"] == 400
    assert u["cost_usd"] == pytest.approx(cost, abs=1e-4)
    assert events[-1]["input_tokens"] == 5300 and events[-1]["cost_usd"] == pytest.approx(cost, abs=1e-6)
    g = ai_guard.global_summary()
    assert g["today_spent_usd"] == pytest.approx(cost, abs=1e-4)   # global $ budget still reconciled


class _CachedChat(BaseChatModel):
    @property
    def _llm_type(self):
        return "fake-cached"

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        return ChatResult(generations=[ChatGeneration(message=_msg({
            "input_tokens": 1500, "output_tokens": 300, "total_tokens": 1800,
            "input_token_details": {"cache_read": 1400, "cache_creation": 0}}))])


def test_callback_reconciles_cache_reads():
    ctx = GuardContext(feature="copilot", user_id=8, tier="free")
    llm = _CachedChat(callbacks=[ai_guard.GuardCallbackHandler("anthropic", "claude-sonnet-5", 2048, ctx=ctx)])
    llm.invoke([SystemMessage("s"), HumanMessage("q")])
    u = ai_guard.usage_summary(8, "free")
    assert u["tokens_used"] == 100 + 140 + 300


# ── tier defaults fit the question allowance ────────────────────────────────

def test_free_tier_tokens_fit_its_requests(monkeypatch):
    for k in ("LLM_FREE_TOKENS_PER_DAY", "LLM_FREE_REQ_PER_DAY"):
        monkeypatch.delenv(k, raising=False)
    lim = ai_guard.tier_limits("free")
    prefix, hist, turn = _prompt_parts(True)
    out = 600
    # round 0: prefix read from cache, history + pack written; round 1 (tool
    # call): everything so far read, ~800 tokens of tool result written.
    one_round = ai_guard.weighted_tokens(0, out, _est(prefix), _est(hist) + _est(turn))
    two_rounds = one_round + ai_guard.weighted_tokens(0, out, _est(prefix + hist + turn), 800)
    per_q = (one_round + two_rounds) / 2
    reservation = _est(prefix + hist + turn) + ai_guard.io_caps()["max_tokens_sonnet"]
    assert lim["req_per_day"] * per_q + reservation <= lim["tokens_per_day"]
    # and the token cap is not so loose that it no longer bounds spend: <= 2x the allowance
    assert lim["tokens_per_day"] <= 2 * lim["req_per_day"] * two_rounds


def test_token_env_override_still_wins(monkeypatch):
    monkeypatch.setenv("LLM_FREE_TOKENS_PER_DAY", "12345")
    assert ai_guard.tier_limits("free")["tokens_per_day"] == 12345
