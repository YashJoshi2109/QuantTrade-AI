"""Regression tests for the live-evaluation findings (no network, no LLM spend).

1. numeric grounding never treats identifiers (accession numbers, CIKs, CUSIPs,
   dates, fiscal labels, fact ids) as claims, and never writes "(unverified)"
   or "n/a (unverified)" inside a token;
2. planner routing: scenario shocks filled from the question, banks routed away
   from FCFF tools, DuPont "financial leverage" not routed to distress models,
   one-name questions never planned as portfolios;
4. eval budget bucket in ai_guard;
5. SSE heartbeat for long tool phases.
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

import pytest

from app.services import ai_guard
from app.services.copilot import composer, planner
from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
from app.services.copilot.evalkit import FixtureSources, ScriptedLLM
from app.services.copilot.memory import InMemoryStore
from app.services.copilot.models import QuoteFact
from app.services.copilot.postcheck import ground_numbers, mask_identifiers, run_postcheck
from app.services.copilot.registry import FactRegistry

QUESTIONS = {q["id"]: q for q in json.loads(
    (Path(__file__).parent / "institutional_eval" / "questions.json").read_text())["questions"]}


def _reg():
    r = FactRegistry()
    r.add(QuoteFact(id="quote:MSFT", source="t", ticker="MSFT", price=512.34, change_percent=1.25))
    return r


# ── 1. identifiers are never claims ──────────────────────────────────────────

IDENTIFIER_TEXTS = [
    "Base year: FY2026 10-K, accession 0001193125-26-323660.",
    "accession 0000950170-25-012345 (filed 2025-07-30)",
    "SEC CIK 0000789019 for Microsoft; CIK: 789019.",
    "CUSIP 594918104; ISIN US5949181045; alt CUSIP 02079K305.",
    "For the fiscal year ended June 30, 2026 (30 June 2026, 6/30/2026).",
    "Q3 FY2026, 3Q26, FY2025/26 and fiscal year 2024 comparatives.",
    "Value per share from the DCF [val:dcf:MSFT] and calc:valuation_dcf:MSFT:1a2b3c45 are cited.",
]


@pytest.mark.parametrize("text", IDENTIFIER_TEXTS)
def test_identifiers_are_not_checked_as_figures(text):
    out, checked, bad = ground_numbers(text, _reg())
    assert bad == [] and checked == 0, (text, bad)
    assert out == text


@pytest.mark.parametrize("text", IDENTIFIER_TEXTS)
def test_block_mode_never_corrupts_identifiers(text):
    out, _, removed = composer.block_numbers(text, _reg(), "")
    assert removed == [] and out == text


def test_eval_finding_accession_is_kept_intact():
    # live eval: "accession n/a (unverified)3125-26-323660" (a date-shaped run inside the
    # accession was masked first and the leading "000119" was blocked as a figure)
    text = "The DCF is anchored on the FY2026 10-K (accession 0001193125-26-323660) [quote:MSFT]."
    out, _, removed = composer.block_numbers(text, _reg(), "")
    assert "0001193125-26-323660" in out and "n/a (unverified)" not in out and removed == []
    pc = run_postcheck(text, _reg())
    assert "(unverified)" not in pc.text and pc.unverified_numbers == []


def test_masks_keep_length_and_fill_identifiers():
    t = "accession 0001193125-26-323660, price $512.34 [quote:MSFT]"
    m = mask_identifiers(t)
    assert len(m) == len(t)
    assert "0001193125" not in m and "$512.34" in m


def test_real_figures_are_still_checked_and_marked_outside_tokens():
    text = "Price $512.34 but EPS $99.99, range 5-10% and A1-5 tranche; ratio 100/200."
    out, checked, bad = ground_numbers(text, _reg())
    assert "$99.99" in bad and "10%" in bad            # a range is still a claim
    assert "$512.34" not in bad
    assert all("A1" not in b and "100" not in b for b in bad)
    assert "$99.99 (unverified)" in out and "5-10% (unverified)" in out
    # "(unverified)" never lands inside a token
    assert not re.search(r"\S\(unverified\)|\(unverified\)[\w-]", out)
    out2, _, removed = composer.block_numbers("EPS $99.99 per accession 0001193125-26-323660.", _reg(), "")
    assert removed == ["$99.99"] and "n/a (unverified) per accession 0001193125-26-323660" in out2


# ── 2. planner routing ───────────────────────────────────────────────────────

def _calls(plan, tool=None):
    return [(s.capability, c.tool, c.args) for s in plan.steps for c in s.calls if tool is None or c.tool == tool]


def test_question_shocks_parse_sizes_and_named_shocks():
    q = QUESTIONS["Q16"]["question"]      # 10% USD appreciation, tariffs, discretionary spending, manufacturing costs
    s = planner.question_shocks(q)
    assert s["shocks"] == {"reporting_currency_appreciation": 0.10}
    assert set(s["default_shocks"]) == {"tariff_rate", "demand_decline", "cogs_inflation"}
    s2 = planner.question_shocks("Model a 15% decline in demand, 25% tariffs on 40% of COGS and a 50 basis point "
                                 "rise in rates, plus a 5% depreciation of the US dollar.")
    assert s2["shocks"]["demand_decline"] == pytest.approx(0.15)
    assert s2["shocks"]["tariff_rate"] == pytest.approx(0.25)
    assert s2["structure"] == {"tariff_exposed_cogs_share": pytest.approx(0.40)}
    assert s2["shocks"]["rate_shock"] == pytest.approx(0.005)
    assert planner.question_shocks("What is NVDA's ROIC?") == {}


def test_scenarios_tool_is_planned_with_shock_arguments():
    plan = planner.build_plan(QUESTIONS["Q16"]["question"], ["AAPL"])
    (_, _, args), = _calls(plan, "valuation_scenarios")
    assert args["shocks"] == {"reporting_currency_appreciation": 0.10}
    assert set(args["use_default_shocks"]) == {"tariff_rate", "demand_decline", "cogs_inflation"}
    # a question with no shock names still plans it: the tool runs its documented default set
    plan = planner.build_plan(QUESTIONS["Q21"]["question"].replace("distress", "stress scenario"), ["INTC"])
    assert all(set(a) <= {"ticker"} for _, _, a in _calls(plan, "valuation_scenarios"))


def test_misrouted_capabilities_fixed():
    # DuPont "financial leverage" is not a distress / liquidity question
    p20 = planner.build_plan(QUESTIONS["Q20"]["question"], ["AAPL", "MSFT", "NVDA"])
    assert not _calls(p20, "assess_financial_distress")
    assert "leverage_liquidity" not in [s.capability for s in p20.steps]
    # "downside beta" is a risk metric, not a DCF scenario
    p06 = planner.build_plan(QUESTIONS["Q06"]["question"], ["NVDA"])
    assert not _calls(p06, "valuation_scenarios") and not _calls(p06, "valuation_bull_bear")
    # "autocorrelation" is not a portfolio correlation; one name is never a portfolio
    p05 = planner.build_plan(QUESTIONS["Q05"]["question"], ["TSM"])
    assert "portfolio" not in [s.capability for s in p05.steps]
    # "Altman ... distress" does not contain a "stress" scenario request
    p21 = planner.build_plan(QUESTIONS["Q21"]["question"], ["INTC"])
    assert "scenarios" not in [s.capability for s in p21.steps]
    # "free cash flow yield" is a multiple, not a rates factor
    p17 = planner.build_plan(QUESTIONS["Q17"]["question"], ["NVDA", "AMD", "AVGO", "TSM"])
    assert "macro_factors" not in [s.capability for s in p17.steps]
    # the 6-name portfolio question runs the portfolio tool, not 12 company DCF scenario runs
    p24 = planner.build_plan(QUESTIONS["Q24"]["question"], ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "TSLA"])
    t24 = [t for _, t, _ in _calls(p24)]
    assert t24.count("analyze_portfolio_risk") == 1 and not [t for t in t24 if t.startswith("valuation_")]
    (_, _, a24), = _calls(p24, "analyze_portfolio_risk")
    assert len(a24["tickers"]) == 6


def test_bank_question_routes_to_rate_sensitivity_not_fcff_dcf():
    plan = planner.build_plan(QUESTIONS["Q14"]["question"], ["JPM"])
    tools = [t for _, t, _ in _calls(plan)]
    assert not set(tools) & set(planner.FCFF_TOOLS)
    assert tools.count("valuation_rate_sensitivity") == 1
    (_, _, args), = _calls(plan, "valuation_rate_sensitivity")
    assert args == {"ticker": "JPM", "shock_bp": 100}
    sens = next(s for s in plan.steps if s.capability == "sensitivity")
    assert sens.note and "excess-return" in sens.note
    bank = next(s for s in plan.steps if s.capability == "bank_rate_sensitivity")
    assert bank.shared_with == [sens.id] and bank.public()["covered_by"] == [sens.id]


def test_shared_step_takes_the_status_of_the_step_that_ran_it():
    plan = planner.build_plan(QUESTIONS["Q14"]["question"], ["JPM"])

    class Ex:
        async def run(self, name, args):
            return "ok", [QuoteFact(id=f"x:{name}", source="t", ticker="JPM", price=1.0)], False

    async def go():
        return [e async for e in planner.prefetch(plan, Ex())]

    asyncio.run(go())
    bank = next(s for s in plan.steps if s.capability == "bank_rate_sensitivity")
    assert bank.status == "done" and bank.fact_ids


# ── 4. eval budget ───────────────────────────────────────────────────────────

def _counter(key: str) -> int:
    (v,), _ = ai_guard._run(lambda st: st.get_many([key]))
    return v


def _global_keys():
    d = ai_guard._day()
    return [ai_guard._k("g", "cost", d), ai_guard._k("sys", "cost", d), ai_guard._k("p", "bedrock", "cost", d)]


def test_eval_budget_defaults_to_disabled(monkeypatch):
    monkeypatch.delenv("LLM_EVAL_DAILY_BUDGET_USD", raising=False)
    ctx = ai_guard.eval_guard_context()
    with pytest.raises(ai_guard.AIQuotaError) as e:
        ai_guard.reserve("bedrock", "claude-sonnet-4-6", est_input_tokens=1000, est_output_tokens=500, ctx=ctx)
    assert e.value.reason == "eval_disabled" and e.value.status_code == 503
    with pytest.raises(ai_guard.AIQuotaError):
        ai_guard.admit_request(ctx)
    assert [_counter(k) for k in _global_keys()] == [0, 0, 0]


def test_eval_spend_only_hits_the_eval_bucket(monkeypatch):
    monkeypatch.setenv("LLM_EVAL_DAILY_BUDGET_USD", "2")
    events = []
    ai_guard.set_persist_sink(events.append)
    with ai_guard.eval_context():
        ai_guard.admit_request(ai_guard.current_context())
        res = ai_guard.reserve("bedrock", "claude-sonnet-4-6", est_input_tokens=1000, est_output_tokens=500)
    assert set(res.keys) == {"eval_day"}
    cost = res.commit(input_tokens=800, output_tokens=300)
    assert cost > 0
    assert _counter(ai_guard._eval_key()) == ai_guard._micro(cost)
    assert [_counter(k) for k in _global_keys()] == [0, 0, 0]
    assert events[-1]["feature"].startswith("eval:") and events[-1]["is_system"] is False
    assert ai_guard.global_summary()["eval_spent_usd"] == round(cost, 4)


def test_eval_budget_exhaustion(monkeypatch):
    monkeypatch.setenv("LLM_EVAL_DAILY_BUDGET_USD", "0.0001")
    with ai_guard.eval_context():
        with pytest.raises(ai_guard.AIQuotaError) as e:
            ai_guard.reserve("bedrock", "claude-sonnet-4-6", est_input_tokens=100_000, est_output_tokens=10_000)
    assert e.value.reason == "eval_day"


def test_engine_eval_request_runs_under_the_eval_context(fixture_db):
    seen = []
    llm = ScriptedLLM([{"text": "AAPL price is $236.48 [quote:AAPL]."}])

    def make():
        seen.append(ai_guard.current_context())
        return llm

    eng = CopilotEngine(fixture_db, sources=FixtureSources(), llm_chain=[LLMHandle("scripted", "m", make)],
                        memory_store=InMemoryStore(), use_pack_cache=False)

    async def go(flag):
        return [ev async for ev in eng.run(CopilotRequest(message="AAPL price?", user_id=0, eval=flag))]

    asyncio.run(go(True))
    assert seen[-1] is not None and seen[-1].is_eval and seen[-1].user_id is None
    asyncio.run(go(False))
    assert seen[-1] is None or not seen[-1].is_eval


# ── 5. SSE heartbeat ─────────────────────────────────────────────────────────

def test_heartbeat_fills_silent_gaps_and_preserves_order():
    from app.api.copilot import with_heartbeat

    async def slow():
        yield "intent", {"n": 1}
        await asyncio.sleep(0.25)
        yield "done", {"n": 2}

    async def go():
        return [ev async for ev in with_heartbeat(slow(), interval=0.05)]

    evs = asyncio.run(go())
    names = [n for n, _ in evs]
    assert names[0] == "intent" and names[-1] == "done"
    assert names.count("heartbeat") >= 2 and set(names) == {"intent", "heartbeat", "done"}
    assert "ts" in dict(evs)["heartbeat"]


def test_heartbeat_reraises_engine_errors_and_cancels_on_close():
    from app.api.copilot import with_heartbeat

    async def boom():
        yield "intent", {}
        raise RuntimeError("engine failed")

    async def go():
        return [ev async for ev in with_heartbeat(boom(), interval=1)]

    with pytest.raises(RuntimeError, match="engine failed"):
        asyncio.run(go())

    cancelled = []

    async def forever():
        try:
            yield "intent", {}
            await asyncio.sleep(30)
            yield "never", {}
        finally:
            cancelled.append(True)

    async def close_early():
        g = with_heartbeat(forever(), interval=1)
        assert (await g.__anext__())[0] == "intent"
        await g.aclose()

    asyncio.run(close_early())
    assert cancelled == [True]
