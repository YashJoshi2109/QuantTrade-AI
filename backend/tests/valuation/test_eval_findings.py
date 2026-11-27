"""Valuation regressions from the live copilot evaluation (no network)."""
from __future__ import annotations

import pytest

from app.services.copilot.composer import render_sources
from app.services.valuation import banks
from app.services.valuation import wacc as W
from app.services.valuation.financials import parse_companyfacts
from app.services.valuation.provenance import AssumptionLog, Datum

from .fixtures import B, YEARS, _dur, _inst, make_testco_facts
from .test_copilot_tools import FakeValuationData, _executor, _run


# ── 1b. the base-year accession reaches the citation ─────────────────────────

def test_valuation_fact_carries_the_xbrl_accession():
    ex, reg = _executor()
    _, facts, err, _ = _run(ex, "valuation_dcf", {"ticker": "TEST"})
    assert not err
    f = facts[0]
    assert f.accession == "0000000000-25-000001" and f.filing_type == "10-K"   # companyfacts "accn" of FY2025
    assert f.result["meta"]["base_accession"] == f.accession
    src = render_sources(reg, [f.id])
    assert "accession 0000000000-25-000001" in src and "filed 2025-08-01" in src


# ── 3. cost of debt ──────────────────────────────────────────────────────────

def _d(v, tag="InterestExpense"):
    return Datum(v, "x", tag=tag, accession="0001193125-26-323660")


def test_cost_of_debt_excludes_finance_lease_interest_and_flags_msft_like_rate():
    # MSFT FY2026 (companyfacts): InterestExpenseNonoperating 3,051m includes 2,547m of
    # finance-lease interest; debt 43.151bn -> 40.294bn. Old method: 3,051 / 41.72bn = 7.31%.
    log = AssumptionLog()
    kd = W.cost_of_debt(_d(3051e6, "InterestExpenseNonoperating"), Datum(40.294 * B, "x"), Datum(43.151 * B, "x"),
                        0.042, log, finance_lease_interest=_d(2547e6, "FinanceLeaseInterestExpense"),
                        operating_income=Datum(155.237 * B, "x"))
    assert kd["interest_expense"] == pytest.approx(504e6)                  # debt interest only
    assert kd["finance_lease_interest_excluded"] == pytest.approx(2547e6)
    assert kd["implied_pre_tax"] == pytest.approx(504e6 / 41.7225e9)
    # 1.21% is inconsistent with an AAA-coverage credit (rf 4.2% + 0.59%): labelled fallback
    assert kd["method"].startswith("assumption") and kd["synthetic_rating"] == "AAA"
    assert kd["pre_tax"] == pytest.approx(0.042 + 0.0059)
    assert "inconsistent with credit quality" in kd["note"]
    item = log.items[-1]
    assert item.name == "pre_tax_cost_of_debt" and "ASSUMPTION" in item.rationale and "synthetic rating" in item.rationale


def test_cost_of_debt_prefers_interest_expense_debt():
    kd = W.cost_of_debt(_d(9e9), Datum(100 * B, "x"), Datum(100 * B, "x"), 0.04, AssumptionLog(),
                        interest_expense_debt=_d(5e9, "InterestExpenseDebt"), operating_income=Datum(30 * B, "x"))
    assert kd["method"] == "implied from filings" and kd["pre_tax"] == pytest.approx(0.05)
    assert kd["interest_tag"] == "InterestExpenseDebt" and kd["synthetic_rating"] == "A+"   # coverage 30/5 = 6x


def test_cost_of_debt_bounds_and_caller_spread():
    # 0.5% implied: outside [1%, 15%] even without a coverage check
    kd = W.cost_of_debt(_d(0.5e9), Datum(100 * B, "x"), None, 0.04, AssumptionLog())
    assert kd["method"].startswith("assumption") and "implausible" in kd["note"] and kd["pre_tax"] == pytest.approx(0.05)
    # caller spread wins in the fallback
    kd = W.cost_of_debt(_d(30e9), Datum(100 * B, "x"), None, 0.04, AssumptionLog(), spread=0.03)
    assert kd["pre_tax"] == pytest.approx(0.07) and kd["spread_basis"] == "caller-supplied spread"
    assert W.synthetic_rating(1.6)["rating"] == "B" and W.synthetic_rating(None) is None


def test_wacc_tool_reports_the_debt_only_inputs():
    facts = make_testco_facts()
    facts["facts"]["us-gaap"]["FinanceLeaseInterestExpense"] = {"units": {"USD": [_dur(fy, 0.4 * B) for fy in YEARS]}}

    class VD(FakeValuationData):
        async def financials(self, ticker):
            return parse_companyfacts(facts, "TEST", "0000000001")

    ex, _ = _executor(VD())
    _, _, err, p = _run(ex, "valuation_wacc", {"ticker": "TEST"})
    assert not err
    cod = p["result"]["wacc"]["cost_of_debt"]
    assert cod["interest_expense"] == pytest.approx(1.6 * B, rel=1e-6)     # 2bn - 0.4bn lease interest
    assert cod["pre_tax"] == pytest.approx(4.0)                             # 1.6bn / 40bn, in percent


# ── 2. scenario tool defaults ────────────────────────────────────────────────

def test_scenarios_without_shocks_run_the_documented_default_set():
    ex, _ = _executor()
    _, _, err, p = _run(ex, "valuation_scenarios", {"ticker": "TEST"})
    assert not err, p
    r = p["result"]
    assert set(r["default_shocks_applied"]) == {"reporting_currency_appreciation", "demand_decline",
                                                "cogs_inflation", "rate_shock"}
    assert len(r["individual"]) == 4 and r["combined"]["eps_change"] < 0
    names = [a["name"] for a in p["assumptions"]]
    assert "shock_size:demand_decline" in names
    a = next(a for a in p["assumptions"] if a["name"] == "shock_size:demand_decline")
    assert a["kind"] == "assumption" and "ASSUMPTION" in a["rationale"] and a["value"] == 0.05


def test_scenarios_named_shocks_and_uncomputable_tariff_are_reported_not_failed():
    ex, _ = _executor(FakeValuationData(geo_share=None))
    _, _, err, p = _run(ex, "valuation_scenarios", {
        "ticker": "TEST", "use_default_shocks": ["tariff_rate", "demand_decline", "reporting_currency_appreciation"]})
    assert not err, p
    r = p["result"]
    assert set(r["default_shocks_applied"]) == {"demand_decline"}
    assert any(s.startswith("tariff_rate") for s in r["shocks_not_computed"])
    assert any(s.startswith("reporting_currency_appreciation") for s in r["shocks_not_computed"])
    # explicit sizes from the question win over defaults
    _, _, err, p = _run(ex, "valuation_scenarios", {"ticker": "TEST", "shocks": {"demand_decline": 0.15},
                                                   "use_default_shocks": ["demand_decline", "cogs_inflation"]})
    assert not err and p["result"]["combined"]["shocks"]["demand_decline"] == 0.15
    assert set(p["result"]["default_shocks_applied"]) == {"cogs_inflation"}


# ── 2. banks: FCFF tools refuse with an explanation ──────────────────────────

class BankData(FakeValuationData):
    async def financials(self, ticker):
        facts = make_testco_facts()
        facts["facts"]["us-gaap"]["Deposits"] = {"units": {"USD": [_inst(fy, 200 * B) for fy in YEARS]}}
        return parse_companyfacts(facts, "TEST", "0000000001")


def test_bank_profile_detects_deposit_funding():
    fin = parse_companyfacts(make_testco_facts(), "TEST")
    assert banks.bank_profile(fin) is None


@pytest.mark.parametrize("tool", ["valuation_dcf", "valuation_monte_carlo", "valuation_scenarios",
                                  "valuation_reverse_dcf", "valuation_bull_bear"])
def test_fcff_tools_refuse_banks_with_a_clear_explanation(tool):
    ex, _ = _executor(BankData())
    content, _, err, _ = _run(ex, tool, {"ticker": "TEST"})
    assert err
    assert "not applicable to TEST: it is a bank" in content and "valuation_rate_sensitivity" in content
    assert "excess-return" in content and "62.5% of total assets" in content


def test_wacc_on_a_bank_warns_instead_of_refusing():
    ex, _ = _executor(BankData())
    _, _, err, p = _run(ex, "valuation_wacc", {"ticker": "TEST"})
    assert not err and any("is a bank" in w for w in p["warnings"])
