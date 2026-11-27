"""XBRL parsing, base-case derivation, scenario engine, bank and geo parsers."""
import pandas as pd
import pytest

from app.services.valuation import banks, geo, scenarios as SC
from app.services.valuation.data import parse_treasury_csv
from app.services.valuation.dcf import run_dcf
from app.services.valuation.financials import parse_companyfacts
from app.services.valuation.model import MarketInputs, build_base_case, sales_to_capital
from app.services.valuation.provenance import DataUnavailable, Datum

from .fixtures import B, REVENUE, make_ifrs_facts, make_testco_facts


@pytest.fixture
def fin():
    return parse_companyfacts(make_testco_facts(), "TEST", "0000000001")


def _market(price=100.0):
    return MarketInputs(price=Datum(price, "quote cache", "2026-11-25T21:00:00Z", tag="quote:TEST"),
                        rf=Datum(0.04, "FRED DGS10", "2026-11-24", tag="DGS10"))


# ── XBRL parsing ────────────────────────────────────────────────────────────
def test_annual_periods_ignore_10q_ytd_and_take_restatements(fin):
    assert [y.fiscal_year for y in fin.years] == [2020, 2021, 2022, 2023, 2024, 2025]
    assert fin.latest.get("revenue") == pytest.approx(REVENUE[2025])       # not the 999bn 9-month YTD value
    fy24 = fin.years[-2].datum("revenue")
    assert fy24.value == pytest.approx(146.0 * B)                          # restated in the FY2025 10-K
    assert fy24.accession == "0000000000-25-000001" and fy24.tag == "RevenueFromContractWithCustomerExcludingAssessedTax"
    assert fin.latest.datum("operating_income").form == "10-K"


def test_latest_balance_sheet_and_cover_shares(fin):
    assert fin.balance_date == "2026-03-31"                                # 10-Q balance sheet is newer
    assert fin.balance["total_debt"].value == 40 * B
    assert fin.balance["cash_and_sti"].value == 35 * B                     # 25 cash + 10 short-term investments
    assert "cash and equivalents + short-term investments" in fin.balance["cash_and_sti"].formula
    assert fin.shares_outstanding.value == 9.9 * B and fin.shares_outstanding.as_of == "2026-04-15"


def test_ifrs_filer_detected_with_currency():
    f = parse_companyfacts(make_ifrs_facts(), "TSM")
    assert (f.taxonomy, f.currency) == ("ifrs-full", "TWD")
    assert [(y.fiscal_year, y.get("revenue")) for y in f.years] == [(2023, 2000 * B), (2024, 2800 * B)]
    assert f.latest.get("operating_income") == 1300 * B


def test_sales_to_capital_hand_computed(fin):
    # sum dRev = 161.051 - 100 (telescopes); reinvestment_t = (8% - 5%) * R_t + 10% * dR_t
    rs = [100 * 1.1 ** i for i in range(6)]
    reinv = sum(0.03 * rs[i] + 0.1 * (rs[i] - rs[i - 1]) for i in range(1, 6))
    stc = sales_to_capital(fin)
    assert stc["method"] == "incremental"
    assert stc["value"] == pytest.approx((rs[-1] - rs[0]) / reinv, rel=1e-9)


def test_base_case_defaults_are_derived_and_logged(fin):
    case = build_base_case(fin, _market(), {"beta": 1.1})
    a = case.assumptions
    assert a.stage1_growth == pytest.approx(0.10)                          # 5y CAGR 100 -> 161.051
    assert a.operating_margin_start == pytest.approx(0.25)
    assert a.tax_rate == pytest.approx(0.20)
    assert a.terminal_growth == pytest.approx(0.03)                        # min(rf 4%, 3%)
    # Ke = 4% + 1.1*5% = 9.5%; Kd = 2/40 = 5% -> 3.95% after tax; E = 100 * 9.9bn, D = 40bn
    e, d = 100 * 9.9 * B, 40 * B
    assert a.wacc == pytest.approx(e / (e + d) * 0.095 + d / (e + d) * 0.0395)
    kinds = {x.name: x.kind for x in case.log.items}
    assert kinds["erp"] == "assumption" and kinds["terminal_growth"] == "assumption"
    assert kinds["stage1_growth"] == "derived_default" and kinds["beta"] == "user_input"
    assert case.bridge.cash_and_sti == 35 * B and case.bridge.long_term_investments == 5 * B
    assert case.inputs["revenue_base_year"]["accession"] == "0000000000-25-000001"
    d = run_dcf(case.revenue0, a, case.bridge, 2025)
    assert d["vs_market"]["market_cap"] == round(100 * 9.9 * B, 0)


def test_base_case_refuses_without_beta_or_quote(fin):
    with pytest.raises(DataUnavailable):
        build_base_case(fin, _market(), {})                                # no regression, no beta
    with pytest.raises(DataUnavailable):
        build_base_case(fin, MarketInputs(price=None, rf=Datum(0.04, "x")), {"beta": 1.0})


def test_foreign_filer_without_adr_ratio_has_no_market_comparison():
    f = parse_companyfacts(make_ifrs_facts(), "TSM")
    with pytest.raises(DataUnavailable):                                   # no price in TWD -> no WACC weights
        build_base_case(f, _market(), {"beta": 1.2, "stage1_growth": 0.1, "sales_to_capital": 1.0})
    case = build_base_case(f, _market(), {"beta": 1.2, "stage1_growth": 0.1, "sales_to_capital": 1.0, "wacc": 0.09})
    assert case.bridge.price is None
    assert any("ADR ratio" in w for w in case.warnings)


# ── scenario engine ─────────────────────────────────────────────────────────
BASE = {"revenue": 1000.0, "cogs": 600.0, "gross_profit": 400.0, "opex": 250.0, "ebit": 150.0,
        "net_income": 120.0, "shares_diluted": 100.0, "eps_computed": 1.2, "tax_rate": 0.2, "capex": 50.0,
        "total_debt": 0.0}
ST = {"foreign_revenue_share": 0.6, "foreign_cost_share": 0.0, "hedge_ratio": 0.0, "variable_cogs_share": 1.0,
      "tariff_exposed_cogs_share": 0.4, "tariff_pass_through": 0.0, "floating_rate_debt_share": 0.0,
      "capex_shock_years": 3}


@pytest.mark.parametrize("shocks,eps", [
    ({"reporting_currency_appreciation": 0.10}, 1.2 + (1000 * 0.6 * 0.1 / 1.1) * -0.8 / 100),  # -54.545 EBIT
    ({"tariff_rate": 0.25}, 1.2 - 600 * 0.4 * 0.25 * 0.8 / 100),                           # -60 EBIT
    ({"demand_decline": 0.05}, 1.2 - (50 - 30) * 0.8 / 100),                               # -20 EBIT
    ({"cogs_inflation": 0.03}, 1.2 - 18 * 0.8 / 100),                                      # -18 EBIT
])
def test_individual_shocks_hand_computed(shocks, eps):
    assert SC.pro_forma(BASE, shocks, ST)["eps"] == pytest.approx(eps)


def test_combined_shocks_and_interaction_hand_computed():
    shocks = {"reporting_currency_appreciation": 0.10, "tariff_rate": 0.25, "demand_decline": 0.05,
              "cogs_inflation": 0.03}
    pf = SC.pro_forma(BASE, shocks, ST)
    # revenue = 1000 * 0.95 * (1 - 0.6*0.1/1.1); cogs = 570*1.03 + 570*0.4*0.25
    rev = 950 * (1 - 0.06 / 1.1)
    cogs = 570 * 1.03 + 57
    ebit = rev - cogs - 250
    assert pf["revenue"] == pytest.approx(rev)
    assert pf["ebit"] == pytest.approx(ebit)
    assert pf["eps"] == pytest.approx(1.2 + (ebit - 150) * 0.8 / 100)


def test_run_scenarios_integration(fin):
    case = build_base_case(fin, _market(), {"beta": 1.1})
    geo_mix = {"foreign_share": 0.5, "formula": "1 - country:US revenue / total revenue", "source": "SEC XBRL instance",
               "accession": "acc", "period_end": "2025-06-30"}
    out = SC.run_scenarios(case, {"reporting_currency_appreciation": 0.1, "tariff_rate": 0.2, "rate_shock": 0.01},
                           None, {"tariff_exposed_cogs_share": 0.5}, geo_mix)
    assert [r["scenario"] for r in out["individual"]] == ["reporting_currency_appreciation", "tariff_rate", "rate_shock"]
    rate = out["individual"][2]
    assert rate["eps_change"] == 0.0 and rate["value_change_pct"] < 0     # fixed-rate debt: EPS flat, value down
    comb = out["combined"]
    assert comb["interaction_eps"] == pytest.approx(comb["eps_change"] - comb["sum_of_individual_eps_changes"], abs=1e-4)
    names = {a["name"]: a for a in out["assumptions"]}
    assert names["foreign_revenue_share"]["kind"] == "derived_default"
    assert names["tariff_exposed_cogs_share"]["kind"] == "user_input"
    assert names["tariff_pass_through"]["kind"] == "assumption"
    with pytest.raises(DataUnavailable):
        SC.run_scenarios(case, {"tariff_rate": 0.2}, None, {}, None)       # exposure must be supplied
    with pytest.raises(DataUnavailable):
        SC.run_scenarios(case, {"reporting_currency_appreciation": 0.1}, None, {}, None)
    named = SC.run_scenarios(case, None, [{"name": "restrictions", "shocks": {"revenue_change": -0.1,
                                                                           "capex_change": 0.2}}], {}, None)
    row = named["scenarios"][0]
    assert row["revenue_change_pct"] == pytest.approx(-10.0)
    assert row["capex"] == round(fin.latest.get("capex") * 1.2, 0)


def test_bull_base_bear_and_drawdowns(fin):
    case = build_base_case(fin, _market(), {"beta": 1.1})
    idx = pd.bdate_range("2024-01-01", periods=6)
    dd = SC.drawdown_periods(pd.Series([100, 120, 90, 130, 104, 140.0], index=idx))
    assert dd["max_drawdown_pct"] == -25.0
    assert [p["drawdown_pct"] for p in dd["worst_periods"]] == [-25.0, -20.0]
    assert dd["worst_periods"][0]["peak_close"] == 120 and dd["worst_periods"][0]["recovered_date"] == idx[3].date().isoformat()
    out = SC.bull_base_bear(case, None, dd, [{"fiscal_year": 2024, "pe": 20.0}, {"fiscal_year": 2025, "pe": 30.0}])
    v = {c["case"]: c["value_per_share"] for c in out["cases"]}
    assert v["bear"] < v["base"] < v["bull"]
    eps = fin.latest.get("eps_diluted")
    assert out["multiple_compression"]["value_at_min_pe"] == round(eps * 20, 2)
    assert out["multiple_compression"]["value_at_median_pe"] == round(eps * 25, 2)


# ── banks ───────────────────────────────────────────────────────────────────
EAR_TEXT = """Earnings-at-risk
The following table reflects the Firm's 12-month sensitivity of net interest income to instantaneous parallel shifts.
(in billions) December 31, 2024 +200 bps +100 bps -100 bps -200 bps
Net interest income sensitivity $ 2.1 $ 1.4 $ (1.8) $ (3.9)
"""


def test_parse_nii_table():
    t = banks.parse_nii_table(EAR_TEXT)
    assert t["shocks_bp"] == [200, 100, -100, -200]
    assert t["values"] == [2.1, 1.4, -1.8, -3.9]
    assert t["multiplier"] == 1e9
    assert banks.parse_nii_table("Net interest income rose 5% to $90 billion.") is None
    # unknown unit -> refuse rather than guess
    assert banks.parse_nii_table(EAR_TEXT.replace("(in billions)", "")) is None


def test_rate_sensitivity_eps_from_disclosed_table():
    class Chunk:
        id, filing_type, filed_date, accession, section = "filing:jpm-1", "10-K", "2025-02-14", "acc-1", "MD&A"
        text = EAR_TEXT
    from app.services.valuation.financials import AnnualFinancials, CompanyFinancials
    y = AnnualFinancials(2024, "2024-12-31", values={
        "net_interest_income": Datum(92 * B, "x"), "shares_diluted": Datum(2.9 * B, "x"),
        "deposits": Datum(2400 * B, "x"), "interest_expense_deposits": Datum(60 * B, "x")})
    y0 = AnnualFinancials(2023, "2023-12-31", values={"deposits": Datum(2400 * B, "x")})
    f = CompanyFinancials("JPM", "1", "JPMorgan", "us-gaap", "USD", [y0, y])
    out = banks.rate_sensitivity(f, [Chunk()], 100, {}, 0.2)
    up, down = out["disclosed_nii_sensitivity"]["up"], out["disclosed_nii_sensitivity"]["down"]
    assert up["nii_change"] == 1.4 * B and down["nii_change"] == -1.8 * B
    assert up["eps_impact"] == round(1.4 * B * 0.8 / (2.9 * B), 4)
    assert out["deposits"]["cost_of_deposits_pct"] == 2.5
    assert out["securities"]["note"] and out["credit_losses"]["rate_sensitivity"] is None
    none = banks.rate_sensitivity(f, [], 100, {}, 0.2)
    assert none["disclosed_nii_sensitivity"] is None and "Nothing was computed" in none["nii_unavailable_reason"]
    nonbank = CompanyFinancials("ACME", "2", "Acme", "us-gaap", "USD",
                                [AnnualFinancials(2024, "2024-12-31", values={"revenue": Datum(1.0, "x")})])
    with pytest.raises(DataUnavailable):
        banks.rate_sensitivity(nonbank, [], 100, {}, 0.2)


# ── geographic mix / treasury ───────────────────────────────────────────────
INSTANCE = b"""<?xml version="1.0"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
  xmlns:us-gaap="http://fasb.org/us-gaap/2024" xmlns:srt="http://fasb.org/srt/2024">
 <xbrli:context id="FY"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="US"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
  <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="CN"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
  <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:CN</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="PRODxUS"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
  <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember>
  <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">x:PhoneMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
  <xbrli:period><xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate></xbrli:period></xbrli:context>
 <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="FY" unitRef="usd" decimals="-6">400000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
 <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="US" unitRef="usd" decimals="-6">170000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
 <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="CN" unitRef="usd" decimals="-6">60000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
 <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="PRODxUS" unitRef="usd" decimals="-6">90000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
</xbrli:xbrl>"""


def test_geo_mix_from_instance():
    parsed = geo.parse_instance(INSTANCE, "2025-09-27", "USD")
    assert parsed["total"] == 400e6 and parsed["members"] == {"country:US": 170e6, "country:CN": 60e6}
    m = geo.mix(parsed, "USD")
    assert m["foreign_share"] == pytest.approx(1 - 170 / 400)
    assert geo.parse_instance(INSTANCE, "2024-09-28", "USD") is None


def test_treasury_csv_parse_picks_latest_date():
    csv = ('Date,"1 Mo","10 Yr","30 Yr"\n11/25/2026,4.30,4.12,4.60\n11/24/2026,4.31,4.15,4.61\n'
           '11/26/2026,4.29,,4.58\n')
    d = parse_treasury_csv(csv)
    assert d.value == pytest.approx(0.0412) and d.as_of == "2026-11-25"
