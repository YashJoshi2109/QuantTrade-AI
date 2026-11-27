"""Every metric is compared with a value computed by hand from tests/fundamentals/helpers.ROWS.

FY2023 is year t, FY2022 is t-1, FY2021 is t-2.  The arithmetic is written out
in each test so a reviewer can re-check it without running code.
"""
import math

import pytest

from app.services.fundamentals import metrics as M
from app.services.fundamentals.wacc import compute_wacc

from .helpers import ROWS, make_statements

T = 2      # index of FY2023 in the context


@pytest.fixture
def c():
    st = make_statements()
    return M.Ctx(st=st, periods=list(st.annual))


def test_derived_total_debt_fcf_ebitda(c):
    # total_debt = ltd_noncurrent + debt_current_total = 250 + 30
    assert c.g(T, "total_debt") == 280
    assert "ltd_noncurrent + debt_current_total" in c.st.x("2023-FY", "total_debt").derived
    assert c.g(T, "free_cash_flow") == 150 - 50
    assert c.g(T, "ebitda") == 216 + 36


def test_accrual_ratios(c):
    t = M.accruals_table(c, [T])["FY2023"]
    # NOA_t = (1200-180-60) - (620-280) = 620 ; NOA_t-1 = (1000-150-50) - (550-230) = 480
    assert t["noa"] == 620
    # (620-480) / ((620+480)/2) = 140/550 = 25.4545 %
    assert t["bs_accrual_ratio_pct"] == 25.45
    # (160 - (150 + -60)) / 550 = 70/550 = 12.7273 %
    assert t["cf_accrual_ratio_pct"] == 12.73
    # (160-150) / ((1200+1000)/2) = 10/1100 = 0.909 %
    assert t["sloan_accrual_pct"] == 0.91


def test_net_income_vs_cash(c):
    t = M.income_vs_cash_table(c, [T])["FY2023"]
    assert t["ocf_to_net_income"] == pytest.approx(150 / 160, abs=1e-3)       # 0.9375
    assert t["net_income_growth_pct"] == 42.86                                 # 160/112-1
    assert t["ocf_growth_pct"] == 15.38                                        # 150/130-1
    assert t["growth_gap_pp"] == 27.47                                         # 42.857-15.385


def test_working_capital_days(c):
    t = M.working_capital_table(c, [T])["FY2023"]
    assert t["dso_days"] == 38.0          # (150+100)/2 / 1200 * 365 = 38.02
    assert t["dio_days"] == 60.3          # (130+100)/2 / 696 * 365 = 60.31
    assert t["dpo_days"] == 44.6          # (90+80)/2 / 696 * 365 = 44.58
    assert t["ccc_days"] == 53.8          # 38.02 + 60.31 - 44.58 = 53.75
    assert t["receivables_growth_pct"] == 50.0
    # NWC_t = (600-180-60) - (300-30) = 90
    assert t["non_cash_working_capital"] == 90


def test_beneish_all_eight_variables(c):
    b = M.beneish(c, T)
    v = b["variables"]
    assert v["DSRI"] == pytest.approx(1.25, abs=1e-4)              # (150/1200)/(100/1000)
    assert v["GMI"] == pytest.approx(0.40 / 0.42, abs=1e-4)        # 0.9524
    assert v["AQI"] == pytest.approx(0.2 / 0.18, abs=1e-4)         # (1-960/1200)/(1-820/1000)
    assert v["SGI"] == pytest.approx(1.2, abs=1e-4)
    assert v["DEPI"] == pytest.approx((25 / 345) / (30 / 390), abs=1e-4)   # 0.9420
    assert v["SGAI"] == pytest.approx(0.11 / 0.12, abs=1e-4)       # 0.9167
    assert v["LVGI"] == pytest.approx((550 / 1200) / 0.45, abs=1e-4)  # 1.0185
    assert v["TATA"] == pytest.approx(10 / 1200, abs=1e-4)          # (160-150)/1200
    # -4.84 + 1.15 + 0.502857 + 0.448889 + 1.0704 + 0.108333 - 0.157667 + 0.038992 - 0.333056
    assert b["m_score"] == pytest.approx(-2.011, abs=1e-3)
    assert b["flag_likely_manipulator"] is False
    assert any("TATA uses net_income" in a for a in c.assumption_notes())


def test_altman_z_and_z_double_prime(c):
    a = M.altman(c, T, market_value_equity=2000, sic="3674")
    # X1 = 300/1200 = .25, X2 = 400/1200 = .3333, X3 = 216/1200 = .18, X4 = 2000/620 = 3.2258, X5 = 1
    # Z = .3 + .46667 + .594 + 1.93548 + 1 = 4.2962
    assert a["z"]["score"] == pytest.approx(4.296, abs=1e-3)
    assert a["z"]["zone"] == "safe"
    # Z'' = 6.56*.25 + 3.26*.3333 + 6.72*.18 + 1.05*(580/620) = 1.64 + 1.08667 + 1.2096 + .98226 = 4.9185
    assert a["z_double_prime"]["score"] == pytest.approx(4.919, abs=1e-3)
    assert "manufacturer" in a["applicability"]


def test_altman_textbook_zones():
    # Grey-zone and distress boundaries straight from Altman (1968)
    assert M._zone(1.80, M.ALTMAN_Z_ZONES) == "distress"
    assert M._zone(2.50, M.ALTMAN_Z_ZONES) == "grey"
    assert M._zone(3.00, M.ALTMAN_Z_ZONES) == "safe"
    assert M._zone(1.09, M.ALTMAN_Z2_ZONES) == "distress"
    assert M._zone(2.61, M.ALTMAN_Z2_ZONES) == "safe"


def test_altman_not_applicable_for_banks_and_no_market_cap(c):
    a = M.altman(c, T, market_value_equity=None, sic="6021")
    assert a["applicability"].startswith("Not applicable")
    assert a["z"] is None
    assert any("market value of equity" in u for u in c.unavailable)


def test_piotroski_nine_signals(c):
    p = M.piotroski(c, T)
    s = p["signals"]
    assert s["1_roa_positive"]["roa"] == 0.16 and s["1_roa_positive"]["point"] == 1   # 160/1000
    assert s["2_cfo_positive"]["point"] == 1
    assert s["3_roa_improving"]["roa_prior"] == pytest.approx(112 / 900, abs=1e-4) and s["3_roa_improving"]["point"] == 1
    assert s["4_accrual_cfo_exceeds_roa"]["point"] == 0                                # .15 < .16
    # leverage 250/1100 = .2273 vs 200/950 = .2105 -> rising
    assert s["5_leverage_falling"]["leverage"] == pytest.approx(0.2273, abs=1e-4)
    assert s["5_leverage_falling"]["point"] == 0
    assert s["6_current_ratio_rising"]["point"] == 0                                   # 2.0 vs 2.0
    assert s["7_no_new_shares"]["point"] == 1                                          # 94 <= 97
    assert s["8_gross_margin_rising"]["point"] == 1                                    # .42 > .40
    assert s["9_asset_turnover_rising"]["point"] == 1                                  # 1.2 > 1.111
    assert p["score"] == 6 and p["computable_signals"] == 9


def test_piotroski_reports_uncomputable_signals(c):
    p = M.piotroski(c, 1)          # FY2022: no FY2020 balance sheet for prior ROA
    assert p["signals"]["3_roa_improving"]["point"] is None
    assert p["computable_signals"] < 9 and "lower bound" in p["interpretation"]


def test_dupont_three_and_five_step_multiply_to_roe(c):
    d = M.dupont_table(c, [T])["FY2023"]
    assert d["roe_pct"] == 31.07                               # 160 / ((580+450)/2) = 160/515
    s3, s5 = d["three_step"], d["five_step"]
    assert s3["net_margin_pct"] == 13.33 and s3["asset_turnover"] == 1.091 and s3["equity_multiplier"] == 2.136
    assert s5["tax_burden"] == 0.8 and s5["interest_burden"] == 0.926 and s5["ebit_margin_pct"] == 18.0
    raw = M.dupont_components(c, T)
    assert raw["net_margin"] * raw["asset_turnover"] * raw["equity_multiplier"] == pytest.approx(raw["roe"])
    assert math.prod(raw[k] for k in ("tax_burden", "interest_burden", "ebit_margin", "asset_turnover",
                                      "equity_multiplier")) == pytest.approx(raw["roe"])


def test_dupont_flags_thin_equity():
    rows = {fy: dict(r) for fy, r in ROWS.items()}
    rows[2022]["total_equity"] = 100
    rows[2023]["total_equity"] = 80
    st = make_statements(rows)
    d = M.dupont_table(M.Ctx(st=st, periods=st.annual), [2])["FY2023"]
    assert d["three_step"]["equity_multiplier"] > 5
    assert any("thin" in f for f in d["flags"])


def test_roe_change_attribution_is_exact(c):
    a = M.roe_change_attribution(c, 1, 2)
    total = sum(a["log_change_by_component"].values())
    assert total == pytest.approx(a["log_change_total"], abs=1e-3)
    assert sum(a["share_of_change_pct"].values()) == pytest.approx(100, abs=0.5)


def test_roic_nopat_invested_capital(c):
    r = M.roic_table(c, [T], wacc_pct=9.0)["FY2023"]
    assert r["tax_rate_used_pct"] == 20.0                     # 40/200
    assert r["nopat"] == 173                                  # 216 * 0.8 = 172.8 (rounded to units)
    assert r["invested_capital"] == 620                       # 280 + 580 - 180 - 60
    assert r["roic_pct"] == 31.42                             # 172.8 / ((620+480)/2)
    assert r["roic_ending_pct"] == 27.87                      # 172.8 / 620
    assert r["incremental_roic_pct"] == 37.71                 # (172.8-120) / (620-480)
    assert r["reinvestment"] == 24                            # 50 - 36 + (90-80) + 0
    assert r["reinvestment_rate_pct"] == 13.89                # 24 / 172.8
    assert r["roic_minus_wacc_pp"] == 22.42                   # 31.418 - 9
    assert r["economic_profit"] == 123                        # (0.31418-0.09)*550 = 123.3
    assert any("acquisitions not tagged for FY2023" in a for a in c.assumption_notes())


def test_statutory_tax_rate_used_when_effective_rate_not_meaningful():
    rows = {fy: dict(r) for fy, r in ROWS.items()}
    rows[2023]["income_tax"] = -30                            # tax benefit -> negative effective rate
    st = make_statements(rows)
    c = M.Ctx(st=st, periods=st.annual)
    r = M.roic_table(c, [T])["FY2023"]
    assert r["tax_rate_used_pct"] == 21.0
    assert r["nopat"] == round(216 * 0.79)
    assert any("statutory tax rate 21.0%" in a for a in c.assumptions)


def test_per_share_decomposition(c):
    d = M.per_share_decomposition(c, 1, 2)
    # EPS 112/98 = 1.142857 -> 160/95 = 1.684211 ; growth 47.37 %
    assert d["eps_growth_pct"] == 47.37
    assert d["share_count_change_pct"] == -3.06               # 95/98 - 1
    # ln(EPS ratio) = .387766 ; -ln(95/98) = .031091 -> 8.0 % of EPS growth from the lower share count
    assert d["share_of_eps_growth_from_share_count_pct"] == 8.0
    assert d["share_of_eps_growth_from_net_income_pct"] == 92.0
    assert d["log_eps"] == pytest.approx(d["log_net_income"] - d["log_share_count"], abs=1e-4)


def test_coverage_and_liquidity(c):
    t = M.coverage_liquidity_table(c, [T])["FY2023"]
    assert t["interest_coverage"] == 18.0                     # 216/12
    assert t["ebitda_interest_coverage"] == 21.0              # 252/12
    assert t["current_ratio"] == 2.0
    assert t["quick_ratio"] == 1.3                            # (180+60+150)/300
    assert t["cash_ratio"] == 0.8
    assert t["net_debt"] == 40                                # 280-240
    assert t["debt_to_ebitda"] == 1.111
    assert t["debt_to_equity"] == 0.483


def test_debt_maturities(c):
    d = M.debt_maturities(c, T)
    assert d["schedule"]["next_12_months"] == 30
    assert d["total_scheduled"] == 280
    assert d["due_within_24_months"] == 80
    assert d["liquidity_to_next_12m_maturities"] == 8.0      # 240/30
    assert d["fcf_to_24m_maturities"] == 1.25                # 100/80


def test_debt_maturities_unavailable_is_explicit(c):
    d = M.debt_maturities(c, 1)
    assert "unavailable" in d and "LongTermDebtMaturities" in d["unavailable"]


def test_fcf_sustainability(c):
    t = M.fcf_table(c, [T])["FY2023"]
    assert t["free_cash_flow"] == 100
    assert t["fcf_margin_pct"] == 8.33
    assert t["fcf_conversion"] == 0.625
    assert t["fcf_after_sbc"] == 88
    assert t["shareholder_payouts"] == 42
    assert t["payout_to_fcf_pct"] == 42.0
    assert t["capex_to_da"] == 1.389
    assert t["fcf_after_finance_leases"] is None              # not tagged -> unavailable, never 0
    assert any("fcf_after_finance_leases FY2023" in u for u in c.unavailable)


def test_operating_leverage(c):
    # op income growth 216/150-1 = .44 ; revenue growth .2 -> 2.2x
    assert M.operating_leverage(c, T) == 2.2


def test_missing_inputs_are_reported_not_defaulted(c):
    t = M.income_vs_cash_table(c, [0])["FY2021"]
    assert t["net_income_growth_pct"] is None
    assert any("net_income_growth_pct FY2021" in u for u in c.unavailable)


def test_quality_flags(c):
    acc = M.accruals_table(c, [1, 2])
    cash = M.income_vs_cash_table(c, [1, 2])
    wc = M.working_capital_table(c, [1, 2])
    ben = M.beneish(c, 2)
    flags = {f["flag"]: f for f in M.quality_flags("FY2023", cash, acc, wc, ben, None)}
    assert flags["high_accruals"]["triggered"] is True          # 25.45 % > 10 %
    assert flags["ni_growth_outpaces_ocf"]["triggered"] is True  # 27.47 pp > 20
    assert flags["low_cash_conversion"]["triggered"] is False    # 0.9375
    assert flags["receivables_outpace_revenue"]["triggered"] is True   # 50 % vs 20 %
    assert flags["beneish_above_threshold"]["triggered"] is False


def test_wacc_textbook():
    # Ke = 4 + 1.2*5 = 10 ; Kd after tax = 5*(1-.2) = 4 ; WACC = .8*10 + .2*4 = 8.8
    w = compute_wacc(risk_free_pct=4.0, beta=1.2, equity_risk_premium_pct=5.0, pre_tax_cost_of_debt_pct=5.0,
                     tax_rate_pct=20.0, market_value_equity=800, total_debt=200)
    assert w["wacc_pct"] == 8.8 and w["cost_of_equity_pct"] == 10.0 and w["after_tax_cost_of_debt_pct"] == 4.0
    assert w["weight_equity_pct"] == 80.0


def test_wacc_requires_cost_of_debt_when_levered():
    with pytest.raises(ValueError):
        compute_wacc(risk_free_pct=4, beta=1, equity_risk_premium_pct=5, pre_tax_cost_of_debt_pct=None,
                     tax_rate_pct=21, market_value_equity=100, total_debt=10)
