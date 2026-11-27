"""Offline institutional regression eval (recorded tool outputs + deterministic mock LLM).

No network, no LLM.  Each of the 24 questions runs through the real
CopilotEngine deep pipeline (planner -> parallel prefetch -> tool loop ->
grounding repair -> composer) and is scored against its rubric.
"""
import asyncio
import time

import pytest

from app.services.copilot import composer, planner

from .harness import MockAnalystLLM, answer_text, load_questions, recorded_tools, run_question, score

QUESTIONS = load_questions()
BY_ID = {q["id"]: q for q in QUESTIONS}


def _run(q, **kw):
    return asyncio.run(run_question(q, **kw))


def _done(events):
    return next(d for n, d in events if n == "done")


def test_question_set_is_complete():
    assert [q["id"] for q in QUESTIONS] == [f"Q{i:02d}" for i in range(1, 25)]
    for q in QUESTIONS:
        assert q["question"] and q["tickers"] and q["capabilities"] and q["tools"] and q["metrics"]


@pytest.mark.parametrize("q", QUESTIONS, ids=[q["id"] for q in QUESTIONS])
def test_institutional_question_passes_rubric(q):
    r = _run(q)
    checks = score(q, r["events"])
    failed = [k for k, v in checks.items() if not v]
    assert not failed, f"{q['id']} failed {failed}\n{answer_text(r['events'])[:3000]}"


def test_q22_unavailable_simulation_is_disclosed_not_fabricated():
    q = BY_ID["Q22"]
    r = _run(q, tools=recorded_tools(drop=["valuation_monte_carlo"]))
    checks = score(q, r["events"], unavailable_variant=True)
    assert all(checks.values()), [k for k, v in checks.items() if not v]
    step = next(s for s in r["plan"].steps if s.capability == "monte_carlo")
    assert step.status == "unavailable" and step.tools == []
    text = answer_text(r["events"])
    assert "Not executed: Monte Carlo simulation (no tool available)" in text
    assert "not_executed" in _done(r["events"])["postcheck"]
    # the model was told in the plan block that the step did not run
    human = r["llm"].seen[0][-1].content
    assert '"capability":"monte_carlo","status":"unavailable"' in human


def test_fabricated_simulation_figures_are_blocked():
    """A model that invents simulation output (and refuses to repair) never
    gets those figures to the user."""
    q = BY_ID["Q22"]
    llm = MockAnalystLLM(fabricate="Simulated median valuation is $187.42; 5th percentile $96.10.", honest_repair=False)
    r = _run(q, tools=recorded_tools(drop=["valuation_monte_carlo"]), llm=llm)
    text = answer_text(r["events"])
    assert llm.repair_requests == 1
    assert "187.42" not in text and "96.10" not in text
    assert composer.UNVERIFIED_TOKEN in text
    pc = _done(r["events"])["postcheck"]
    assert set(pc["removed_numbers"]) >= {"$187.42", "$96.10"}
    assert "figure(s) could not be traced to a tool output and were removed" in text


def test_repair_round_fixes_an_untraceable_figure():
    q = BY_ID["Q02"]
    llm = MockAnalystLLM(extra_text="Street models imply 23.7% upside.")
    r = _run(q, llm=llm)
    text = answer_text(r["events"])
    done = _done(r["events"])
    assert llm.repair_requests == 1 and done["usage"]["llm_calls"] >= 2
    assert "23.7" not in text and composer.UNVERIFIED_TOKEN not in text
    assert done["postcheck"]["unverified_numbers"] == []
    assert any(n == "progress" and d.get("id") == "verify" and d["status"] == "done" for n, d in r["events"])


def test_failed_tool_is_reported_as_not_executed():
    q = BY_ID["Q06"]
    r = _run(q, tools=recorded_tools(fail=["quant_risk_metrics"]))
    step = next(s for s in r["plan"].steps if s.capability == "risk_metrics")
    assert step.status in ("failed", "partial")
    errs = [d for n, d in r["events"] if n == "tool" and d["status"] == "error"]
    assert errs and errs[0]["name"] == "quant_risk_metrics" and "not available" in errs[0]["error"]
    if step.status == "failed":
        assert "Not executed: Risk metrics" in answer_text(r["events"])


def test_slow_tool_hits_its_per_step_timeout():
    q = BY_ID["Q07"]
    tools = recorded_tools(delay_s={"quant_event_study": 2.0}, timeout_s={"quant_event_study": 0.05})
    t0 = time.perf_counter()
    r = _run(q, tools=tools)
    assert time.perf_counter() - t0 < 1.5
    err = next(d for n, d in r["events"] if n == "tool" and d["name"] == "quant_event_study" and d["status"] != "running")
    assert err["status"] == "error" and "timed out" in err["error"]
    assert _done(r["events"])["refusal"] is None


def test_prefetch_runs_independent_calls_in_parallel():
    q = BY_ID["Q24"]
    names = list(recorded_tools())
    tools = recorded_tools(delay_s={n: 0.2 for n in names})
    t0 = time.perf_counter()
    r = _run(q, tools=tools)
    elapsed = time.perf_counter() - t0
    n_prefetched = sum(len(s.calls) for s in r["plan"].steps)
    assert n_prefetched >= 8
    # sequential would be >= n * 0.2s; bounded concurrency (DEEP_PARALLEL) is far faster
    assert elapsed < n_prefetched * 0.2 / 2, (elapsed, n_prefetched)


def test_progress_is_streamed_with_meaningful_labels():
    r22 = _run(BY_ID["Q22"])
    labels = [d["label"] for n, d in r22["events"] if n == "progress"]
    assert "Running 10,000 simulations for AMZN" in labels
    r01 = _run(BY_ID["Q01"])
    labels = [d["label"] for n, d in r01["events"] if n == "progress"]
    assert "Fetching 5y statements for NVDA" in labels
    names = [n for n, _ in r01["events"]]
    assert names.index("plan") < names.index("progress") < names.index("token") < names.index("done")


def test_tool_call_budget_is_enforced(monkeypatch):
    monkeypatch.setattr(planner, "DEEP_MAX_TOOL_CALLS", 2)
    q = BY_ID["Q13"]          # valuation_scenarios needs a model-issued call (not prefetchable)
    r = _run(q)
    errs = [d for n, d in r["events"] if n == "tool" and d["status"] == "error"]
    assert any("tool budget exhausted" in (d.get("error") or "") for d in errs)
