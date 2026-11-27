"""Planner, tool discovery, composer and the strict grounding guard (unit level, no network)."""
import asyncio
import json

import pytest

from app.services.copilot import composer, planner, tools as tools_mod
from app.services.copilot.models import FilingChunkFact, StatementPeriod
from app.services.copilot.postcheck import ground_numbers
from app.services.copilot.provenance import ComputedFact, computed_fact, fact_id, provenance_of
from app.services.copilot.registry import FactRegistry

_T = {"type": "string"}


def _spec(name, desc, props=None, required=("ticker",)):
    return {"name": name, "description": desc,
            "input_schema": {"type": "object", "properties": props or {"ticker": _T}, "required": list(required)}}


# ── deep detection ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("q", ["What was AAPL's revenue last quarter?", "Analyze NVDA", "Is TSLA up today?",
                               "Compare AAPL vs MSFT margins", "What's the 20-day forecast for NVDA?"])
def test_short_questions_stay_on_the_fast_path(q):
    assert planner.is_deep(q) is False


def test_all_24_institutional_questions_are_deep():
    from pathlib import Path
    qs = json.loads((Path(__file__).parent / "institutional_eval" / "questions.json").read_text())["questions"]
    assert len(qs) == 24 and all(planner.is_deep(q["question"]) for q in qs)


# ── question hints (parameters parsed from the question) ─────────────────────
def test_question_hints_exact_values():
    h = planner.question_hints(
        "Run 10,000 simulations over the last five years of data using rolling 30-day, 90-day, and 252-day "
        "windows, 95% historical VaR against the S&P 500, last 12 quarterly earnings, a five-day event window, "
        "a 100-basis-point shock, the next ten years, and compare three most recent annual 10-K and 8-K filings.")
    assert h == {"lookback_years": 5, "horizon_years": 10, "n_simulations": 10000, "n_events": 12,
                 "windows": [30, 90, 252], "event_window": 5, "shock_bps": 100, "confidence": 0.95,
                 "benchmark": "SPY", "forms": ["10-K", "8-K"], "n_filings": 3}


# ── tool discovery is by family + keywords, never by name ────────────────────
def test_discovery_finds_a_newly_registered_tool_without_code_changes(monkeypatch):
    # start from a registry with no price-behaviour engine (the shipped one is analyze_price_behavior)
    monkeypatch.setattr(tools_mod, "TOOL_SPECS", [t for t in tools_mod.TOOL_SPECS
                                                  if t["name"] not in planner.QUANT and not t["name"].startswith("quant_")])
    q = ("Analyze TSM using rolling volatility, the Hurst exponent and autocorrelation to decide whether it "
         "mean-reverts or trends, and explain the statistical limitations in detail please.")
    before = planner.build_plan(q, ["TSM"])
    step = next(s for s in before.steps if s.capability == "volatility_regime")
    assert step.status == "unavailable" and step.tools == []

    spec = _spec("quant_hurst_v2", "Hurst exponent and autocorrelation of daily returns.",
                 {"ticker": _T, "windows": {"type": "array", "items": {"type": "integer"}}})

    async def handler(executor, args):
        f = computed_fact("quant_hurst_v2", args["ticker"], source="test", as_of="2026-11-24", args=args,
                          values={"hurst": 0.55})
        return [f], [f.model_dump()]

    tools_mod.register_tool(spec, handler, progress="Estimating Hurst exponent for {ticker}")
    try:
        after = planner.build_plan(q, ["TSM"])
        step = next(s for s in after.steps if s.capability == "volatility_regime")
        assert step.tools == ["quant_hurst_v2"] and step.status == "planned"
        assert step.calls[0].args == {"ticker": "TSM"}
        assert step.calls[0].label == "Estimating Hurst exponent for TSM"
        assert "quant_hurst_v2" in [t["name"] for t in tools_mod.lc_tools()]
        assert set(tools_mod.lc_tools()[-1]) == {"name", "description", "input_schema"}
    finally:
        tools_mod.unregister_tool("quant_hurst_v2")
    assert "quant_hurst_v2" not in [t["name"] for t in tools_mod.lc_tools()]


def test_family_prefix_and_keywords_rank_tools():
    cap = next(c for c in planner.CAPABILITIES if c.key == "monte_carlo")
    good = _spec("valuation_monte_carlo", "Monte Carlo DCF simulation of value per share.")
    off_family = _spec("misc_tool", "Monte Carlo simulation of something.")
    unrelated = _spec("valuation_dcf", "Discounted cash flow valuation.")
    assert planner.score_tool(cap, good) > planner.score_tool(cap, off_family) >= planner.MIN_TOOL_SCORE
    assert planner.score_tool(cap, unrelated) == 0          # family alone is never enough
    assert planner.discover_tools(cap, [unrelated, off_family, good])[0]["name"] == "valuation_monte_carlo"


def test_suggest_calls_fills_schema_and_skips_unfillable_required():
    cap = next(c for c in planner.CAPABILITIES if c.key == "monte_carlo")
    hints = {"n_simulations": 10000, "lookback_years": 5}
    spec = _spec("valuation_monte_carlo", "x", {"ticker": _T, "n_simulations": {"type": "integer"},
                                                 "unused": {"type": "string"}})
    assert planner.suggest_calls(spec, ["AMZN", "MSFT"], hints, cap) == [
        {"n_simulations": 10000, "ticker": "AMZN"}, {"n_simulations": 10000, "ticker": "MSFT"}]
    multi = _spec("quant_portfolio_risk", "x", {"tickers": {"type": "array", "maxItems": 3}}, ["tickers"])
    assert planner.suggest_calls(multi, ["A", "B", "C", "D"], {}, cap) == [{"tickers": ["A", "B", "C"]}]
    needs_model = _spec("valuation_scenarios", "x", {"ticker": _T, "scenario_set": {"type": "string"}},
                        ["ticker", "scenario_set"])
    assert planner.suggest_calls(needs_model, ["TSLA"], hints, cap) == []
    enum_arg = _spec("t", "x", {"ticker": _T, "forms": {"type": "array", "items": {"enum": ["10-K", "10-Q"]}}})
    assert planner.suggest_calls(enum_arg, ["X"], {"forms": ["10-K", "8-K"]}, cap) == [{"forms": ["10-K"], "ticker": "X"}]


def test_progress_labels():
    assert planner.progress_label("valuation_monte_carlo", {"ticker": "AMZN", "n_simulations": 10000}) == \
        "Running 10,000 simulations for AMZN"
    assert planner.progress_label("fundamentals_statements", {"ticker": "NVDA", "years": 5}) == \
        "Fetching 5y statements for NVDA"
    assert planner.progress_label("x", {"ticker": "A"}, template="Doing {missing}") == "Running x for A"
    assert planner.progress_label("get_quote", {"ticker": "A"}) == "Fetching quote for A"


# ── executor plugin path ─────────────────────────────────────────────────────
def test_executor_runs_plugins_with_per_tool_timeout():
    async def slow(executor, args):
        await asyncio.sleep(1)
        return [], []

    async def fast(executor, args):
        f = computed_fact("t_fast", "A", source="s", as_of="2026-01-01", args=args, values={"v": 1.5})
        return [f], [f.model_dump()]

    extra = {"t_slow": {"spec": _spec("t_slow", "s"), "handler": slow, "timeout_s": 0.05},
             "t_fast": {"spec": _spec("t_fast", "f"), "handler": fast}}
    reg = FactRegistry()
    ex = tools_mod.ToolExecutor(None, reg, None, {}, None, timeout_s=30, extra=extra)
    assert ex.timeout_for("t_slow") == 0.05 and ex.timeout_for("t_fast") == 30
    out = asyncio.run(ex.run("t_slow", {"ticker": "A"}))
    assert out[2] is True and "timed out" in out[0]
    content, facts, err = asyncio.run(ex.run("t_fast", {"ticker": "A"}))
    assert not err and facts[0].id in reg and '<context source="tool:t_fast"' in content
    assert asyncio.run(ex.run("nope", {}))[2] is True


# ── provenance ───────────────────────────────────────────────────────────────
def test_computed_fact_ids_are_deterministic_and_carry_provenance():
    a = fact_id("valuation_dcf", "msft", {"ticker": "MSFT", "g": 0.025})
    assert a == fact_id("valuation_dcf", "MSFT", {"g": 0.025, "ticker": "MSFT"}) and a.startswith("calc:valuation_dcf:MSFT:")
    f = computed_fact("filings_x", "MSFT", source="SEC 10-K", as_of="2025-07-30", accession="0000950170-25-100235",
                      section="Item 8", url="https://www.sec.gov/x", formulas={"fcf": "OCF - capex"},
                      assumptions={"erp": 0.05}, values={"fcf": 1.0})
    p = provenance_of(f)
    assert p["accession"] == "0000950170-25-100235" and p["section"] == "Item 8" and p["url"].startswith("https://")
    assert p["formulas"] == {"fcf": "OCF - capex"} and p["assumptions"] == {"erp": 0.05}
    assert f.ui()["accession"] == "0000950170-25-100235"


# ── strict grounding: hand-computed matches ──────────────────────────────────
def _reg(**values):
    r = FactRegistry()
    r.add(ComputedFact(id="calc:t:X:1", tool="t", source="s", as_of="2026-01-01", ticker="X", values=values))
    return r


@pytest.mark.parametrize("text,ok", [
    ("WACC is 9.12% [calc:t:X:1]", True),          # 0.0912 stored as a fraction
    ("WACC is 9.1%", True),                         # display rounding: 9.12 within 0.05 of 9.1
    ("WACC is 9.2%", False),                        # 9.12 is 0.08 away from 9.2
    ("EV is $3.3T", True),                          # 3,297,000,000,000 -> 3.3T within 0.05T
    ("EV is $3.5T", False),
    ("EV is $3,297,000,000,000", True),
    ("Value per share $431.17", True),
    ("Value per share $431", True),                 # integer display: within 0.5
    ("Value per share $433", False),
])
def test_strict_grounding_against_hand_computed_values(text, ok):
    r = _reg(wacc=0.0912, enterprise_value=3297000000000.0, value_per_share=431.17)
    _, _, bad = ground_numbers(text, r, strict=True)
    assert (bad == []) is ok, bad


def test_strict_mode_rejects_derived_matches_that_lenient_mode_allows():
    r = FactRegistry()
    for i, rev in enumerate((100.0, 125.0)):
        r.add(StatementPeriod(id=f"fs:X:{2024 + i}-FY", source="SEC", ticker="X", period=f"{2024 + i}-FY",
                              period_label=f"FY{2024 + i}", revenue=rev))
    text = "Revenue grew 25.0%"                     # (125 / 100 - 1) = 25% is derived, not a tool value
    assert ground_numbers(text, r)[2] == []
    assert ground_numbers(text, r, strict=True)[2] == ["25.0%"]


def test_block_mode_replaces_only_untraceable_figures():
    r = _reg(sharpe=1.62)
    out, checked, bad = ground_numbers("Sharpe 1.62 and Sortino 2.75.", r, strict=True, block_with="n/a")
    assert out == "Sharpe 1.62 and Sortino n/a." and bad == ["2.75"] and checked == 2


# ── composer ─────────────────────────────────────────────────────────────────
GOOD = """## Summary
Intrinsic value is $431.17 per share [calc:t:X:1].

## Data & Method
EV = sum of discounted FCFF.

## Results
| Metric | Value | Source |
|---|---|---|
| Value per share | 431.17 | [calc:t:X:1] |

## Interpretation
Above market.

## Verified facts vs assumptions/interpretation
- Fact: value per share [calc:t:X:1].

## Limitations
- Model risk.

## Sources
1. [calc:t:X:1] made up source https://evil.example/fake 2019-01-01
"""


def test_sections_detection_accepts_numbering_and_aliases():
    assert composer.missing_sections(GOOD) == []
    t = "## 1. Executive summary\nx\n## Methodology\nx\n## Findings\nx\n## Discussion\nx\n" \
        "## Facts vs. assumptions\nx\n## Caveats\nx\n## References\nx"
    assert composer.missing_sections(t) == []
    assert composer.missing_sections("## Summary\nx") == ["data_method", "results", "interpretation",
                                                           "facts_vs_assumptions", "limitations", "sources"]


def _plan_with_unavailable():
    p = planner.Plan(question="q", tickers=["X"], deep=True)
    p.steps.append(planner.PlanStep(id="S1", capability="monte_carlo", need="Monte Carlo simulation",
                                    computation=True, status="unavailable"))
    return p


def test_finalize_renders_server_sources_and_discloses_unavailable_steps():
    r = FactRegistry()
    r.add(ComputedFact(id="calc:t:X:1", tool="valuation_dcf", source="DCF engine", as_of="2026-11-24", ticker="X",
                       title="X DCF", values={"value_per_share": 431.17}, assumptions={"terminal_growth": 0.025},
                       formulas={"tv": "FCFF / (WACC - g)"}))
    r.add(FilingChunkFact(id="filing:abc", source="SEC 10-K", ticker="X", filing_type="10-K", fiscal_year=2025,
                          section="Item 1A", filed_date="2025-07-30", accession="0000950170-25-100235",
                          url="https://www.sec.gov/Archives/x", text="risk text"))
    text = GOOD.replace("Model risk.", "Model risk [filing:abc] [bogus:id].")
    out = composer.finalize(text, r, "q", _plan_with_unavailable())
    assert "evil.example" not in out.text and "2019-01-01" not in out.text        # model-written Sources dropped
    assert "1. [calc:t:X:1] X DCF — DCF engine; as of 2026-11-24" in out.text
    assert "Formula: tv: FCFF / (WACC - g)" in out.text
    assert "10-K; section: Item 1A; filed 2025-07-30; accession 0000950170-25-100235" in out.text
    assert "<https://www.sec.gov/Archives/x>" in out.text
    assert out.invalid_citations == ["bogus:id"] and out.cited_ids == ["calc:t:X:1", "filing:abc"]
    assert "Not executed: Monte Carlo simulation (no tool available)" in out.text
    assert out.not_executed == ["Monte Carlo simulation (no tool available)"]
    # tool assumption not stated by the model is added, labelled as an assumption
    assert "Assumptions reported by the tools (parameters, not facts)" in out.text
    assert "- terminal_growth: 0.025 [calc:t:X:1]" in out.text
    assert out.unverified_numbers == []


def test_finalize_blocks_untraceable_and_fills_missing_sections_without_inventing_a_summary():
    r = _reg(value_per_share=431.17)
    out = composer.finalize("## Results\nValue $431.17 [calc:t:X:1], peers trade at 18.4x.", r, "q")
    assert "18.4x" not in out.text and composer.UNVERIFIED_TOKEN in out.text
    assert out.removed_numbers == ["18.4x"]
    assert "## Limitations" in out.text and "were removed" in out.text
    assert "## Summary" not in out.text
    assert set(out.added_sections) >= {"limitations", "data_method", "interpretation", "facts_vs_assumptions"}


def test_repair_instruction_lists_figures_sections_and_unavailable_steps():
    s = composer.repair_instruction(["18.4x"], ["limitations"], _plan_with_unavailable())
    assert s.startswith("Revise your previous answer") and '"18.4x"' in s and "Limitations" in s
    assert "Monte Carlo simulation" in s


def test_deep_system_prompt_is_static_and_allows_tables():
    from app.services.copilot.prompt import system_prompt
    deep = system_prompt(True)
    assert deep == system_prompt(True) and deep.startswith(system_prompt(False)[:200])
    assert "Do not fabricate simulation" in deep and "not render markdown tables" not in deep
    assert "not render markdown tables" in system_prompt(False)
