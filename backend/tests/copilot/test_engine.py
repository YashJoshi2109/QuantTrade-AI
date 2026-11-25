"""CopilotEngine end-to-end with fixture sources + scripted LLM (no network, no LLM)."""
import asyncio
import json

from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
from app.services.copilot.evalkit import FixtureSources, ScriptedLLM, check_case, load_golden, run_case
from app.services.copilot.memory import InMemoryStore


def _run(db, msg, steps, symbol=None, sources=None, chain=None):
    llm = ScriptedLLM(steps)
    eng = CopilotEngine(db, sources=sources or FixtureSources(),
                        llm_chain=chain or [LLMHandle("scripted", "m", lambda: llm)],
                        memory_store=InMemoryStore(), use_pack_cache=False)

    async def go():
        return [ev async for ev in eng.run(CopilotRequest(message=msg, user_id=7, symbol=symbol))]

    return asyncio.run(go()), eng, llm


def test_event_contract_and_order(fixture_db):
    evs, eng, llm = _run(fixture_db, "What was AAPL's revenue last quarter?",
                         [{"text": "Revenue was $114.48B [fs:AAPL:2026-Q4]."}])
    names = [n for n, _ in evs]
    assert names[0] == "intent" and names[1] == "context"
    assert names.index("context") < names.index("token") < names.index("citation") < names.index("done")
    ctx = dict(evs)["context"]
    assert ctx["ticker"] == "AAPL" and ctx["quote"]["price"] == 236.48 and ctx["forecast"]["p90"] == 257.3
    done = dict(evs)["done"]
    assert done["citations"][0]["id"] == "fs:AAPL:2026-Q4" and done["citations"][0]["n"] == 1
    assert {"resolve", "context", "llm_round_0", "postcheck", "total", "first_token"} <= set(done["latency_ms"])
    assert done["usage"]["llm_calls"] == 1


def test_retrieved_text_only_in_user_role(fixture_db):
    evs, eng, llm = _run(fixture_db, "Summarize the latest news for this ticker.", [{"text": "ok [news:901]"}],
                         symbol="XYZ")
    system, user = llm.seen[0][0], llm.seen[0][-1]
    assert system.type == "system" and "disregard prior rules" not in system.content
    assert user.type == "human" and '<context source="ticker_pack:XYZ"' in user.content
    assert "disregard prior rules" in user.content
    # data cannot close the context tag
    assert user.content.count("</context>") == user.content.count("<context ")
    ctx = dict(evs)["context"]
    assert ctx["news"][0]["suspicious"] is True


def test_tool_loop_is_bounded(fixture_db, monkeypatch):
    monkeypatch.setattr("app.services.copilot.engine.MAX_TOOL_ROUNDS", 2)
    loop = [{"tool_calls": [{"name": "get_quote", "args": {"ticker": "MSFT"}}]}] * 5
    evs, eng, llm = _run(fixture_db, "Analyze NVDA", loop)
    done = dict(evs)["done"]
    assert done["usage"]["llm_calls"] == 3 and llm.i == 3
    assert "maximum number of data lookups" in (done.get("final_text") or "".join(
        d["text"] for n, d in evs if n == "token"))


def test_tool_results_registered_and_unknown_ticker_tool_error(fixture_db):
    steps = [{"tool_calls": [{"name": "get_quote", "args": {"ticker": "MSFT"}},
                             {"name": "get_quote", "args": {"ticker": "NOPE"}}]},
             {"text": "MSFT is $512.30 [quote:MSFT]."}]
    evs, _, llm = _run(fixture_db, "Analyze NVDA", steps)
    tools = [d for n, d in evs if n == "tool" and d["status"] != "running"]
    assert [t["status"] for t in tools] == ["done", "error"]
    tool_msgs = [m for m in llm.seen[1] if m.type == "tool"]
    assert len(tool_msgs) == 2 and '<context source="tool:get_quote"' in tool_msgs[0].content
    done = dict(evs)["done"]
    assert done["postcheck"]["unverified_numbers"] == [] and done["citations"][0]["id"] == "quote:MSFT"


def test_refusals_make_no_llm_call(fixture_db):
    for msg in ("Write me a poem about my cat.", "Analyze ZZZQ for me."):
        evs, _, llm = _run(fixture_db, msg, [{"text": "should not be used"}])
        assert llm.seen == [] and dict(evs)["done"]["refusal"] in ("off_topic", "unknown_ticker")


def test_slow_source_times_out_without_failing(fixture_db, monkeypatch):
    monkeypatch.setattr("app.services.copilot.context_pack.SOURCE_TIMEOUT_S", 0.05)

    class Slow(FixtureSources):
        async def technicals(self, ticker):
            await asyncio.sleep(1)

    evs, _, _ = _run(fixture_db, "NVDA quote?", [{"text": "$181.20 [quote:NVDA]"}], sources=Slow())
    ctx = dict(evs)["context"]
    assert "timed out" in ctx["errors"]["technicals"] and ctx["quote"]["price"] == 181.2


def test_quota_error_surfaces(fixture_db):
    from app.services.ai_guard import AIQuotaError

    class Boom:
        def bind_tools(self, t):
            return self

        async def astream(self, m):
            raise AIQuotaError(503, "AI features are paused for today (budget reached).", "budget")
            yield  # pragma: no cover

    evs, _, _ = _run(fixture_db, "NVDA?", [], chain=[LLMHandle("x", "y", lambda: Boom())])
    err = dict(evs)["error"]
    assert err["status"] == 503 and "paused" in err["message"]


def test_offline_eval_passes_every_golden_case():
    """The eval harness (scripts/eval_copilot.py) at 100% offline."""
    failures = {}
    for case in load_golden():
        res = asyncio.run(run_case(case))
        checks = check_case(case, res)
        if not all(checks.values()):
            failures[case["id"]] = [k for k, v in checks.items() if not v]
    assert not failures, json.dumps(failures)
    assert len(load_golden()) >= 25
