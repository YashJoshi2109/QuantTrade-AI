"""DCF kernel vs hand-computed and closed-form values."""
import pytest

from app.services.valuation import dcf as D


def _a(**kw):
    base = dict(stage1_growth=0.10, terminal_growth=0.02, operating_margin_start=0.20, target_operating_margin=0.20,
                tax_rate=0.25, sales_to_capital=2.0, wacc=0.10, stage1_years=1, fade_years=0)
    base.update(kw)
    return D.DCFAssumptions(**base)


def test_one_year_gordon_hand_computed():
    # Year 1: revenue 110, EBIT 22, NOPAT 16.5, reinvestment 10/2 = 5, FCFF 11.5, PV 11.5/1.1
    # Terminal: revenue 112.2, NOPAT 16.83, FCFF 16.83*(1-0.02/0.10) = 13.464, TV = 13.464/0.08 = 168.3
    p = D.project(100.0, _a())
    assert p["fcff"][0, 0] == pytest.approx(11.5)
    assert p["pv_fcff"][0, 0] == pytest.approx(11.5 / 1.1)
    assert p["fcff_terminal_year"][0] == pytest.approx(13.464)
    assert p["terminal_value"][0] == pytest.approx(168.3)
    assert p["enterprise_value"][0] == pytest.approx(11.5 / 1.1 + 168.3 / 1.1)


def test_exit_multiple_hand_computed():
    # EBITDA_1 = 22 + 5% * 110 = 27.5; TV = 10x = 275; EV = 11.5/1.1 + 275/1.1
    p = D.project(100.0, _a(terminal_method="exit_multiple", exit_ev_ebitda=10.0, da_pct_revenue=0.05))
    assert p["terminal_value"][0] == pytest.approx(275.0)
    assert p["enterprise_value"][0] == pytest.approx((11.5 + 275.0) / 1.1)


def test_zero_growth_is_a_perpetuity():
    # No growth -> no reinvestment -> constant FCFF = NOPAT = 15; EV = 15 / 10% = 150 for any horizon
    for n1, n2 in ((1, 0), (5, 5), (10, 3)):
        p = D.project(100.0, _a(stage1_growth=0.0, terminal_growth=0.0, stage1_years=n1, fade_years=n2))
        assert p["enterprise_value"][0] == pytest.approx(150.0)


def test_constant_growth_without_reinvestment_equals_gordon_closed_form():
    # g = 3% throughout, no reinvestment: EV = NOPAT_0 * (1+g) / (WACC - g) = 15 * 1.03 / 0.07
    a = _a(stage1_growth=0.03, terminal_growth=0.03, sales_to_capital=1e15, terminal_roic=1e15,
           stage1_years=5, fade_years=5)
    assert D.project(100.0, a)["enterprise_value"][0] == pytest.approx(15 * 1.03 / 0.07, rel=1e-9)


def test_fade_path_and_margin_convergence():
    a = _a(stage1_years=1, fade_years=2, target_operating_margin=0.30, margin_convergence_years=2)
    p = D.project(100.0, a)
    # fade: year 2 = 10% + (2% - 10%) * 1/2 = 6%, year 3 = 2%
    assert p["growth"][0].tolist() == pytest.approx([0.10, 0.06, 0.02])
    # margin: 20% -> 30% over 2 years, then flat
    assert p["margin"][0].tolist() == pytest.approx([0.25, 0.30, 0.30])
    assert p["revenue"][0, -1] == pytest.approx(100 * 1.10 * 1.06 * 1.02)


def test_losses_are_not_tax_credited():
    p = D.project(100.0, _a(operating_margin_start=-0.10, target_operating_margin=-0.10))
    assert p["nopat"][0, 0] == pytest.approx(-11.0)          # EBIT -11, no tax credit


def test_mid_year_convention():
    p = D.project(100.0, _a(mid_year=True))
    assert p["discount_factor"][0, 0] == pytest.approx(1.1 ** -0.5)


def test_run_dcf_bridge_and_market_comparison():
    bridge = D.EquityBridge(total_debt=20.0, cash_and_sti=10.0, long_term_investments=5.0, minority_interest=1.0,
                            shares_outstanding=10.0, price=15.0)
    d = D.run_dcf(100.0, _a(), bridge, 2025)
    ev = 11.5 / 1.1 + 168.3 / 1.1
    eq = ev - 20 + 10 + 5 - 1
    assert d["enterprise_value"] == round(ev, 0)
    assert d["value_per_share"] == round(eq / 10, 2)
    assert d["vs_market"]["upside_downside_pct"] == round((eq / 10 / 15 - 1) * 100, 2)
    assert d["projection"][0]["fiscal_year"] == 2026
    assert d["terminal"]["share_of_enterprise_value_pct"] == round(168.3 / 1.1 / ev * 100, 2)


def test_sensitivity_center_matches_point_and_flags_undefined_cells():
    a = _a(stage1_years=5, fade_years=5)
    bridge = D.EquityBridge(shares_outstanding=10.0)
    point = D.run_dcf(100.0, a, bridge)["value_per_share"]
    s = D.sensitivity(100.0, a, bridge, "wacc", D.default_grid(0.10, 0.01), "terminal_growth",
                      D.default_grid(0.02, 0.005))
    assert s["value_per_share"][2][2] == point
    # value falls as WACC rises (each column)
    col = [row[2] for row in s["value_per_share"]]
    assert col == sorted(col, reverse=True)
    s2 = D.sensitivity(100.0, a, bridge, "wacc", [0.03, 0.10], "terminal_growth", [0.03, 0.02])
    assert s2["value_per_share"][0][0] is None                # g == WACC -> undefined
    s3 = D.sensitivity(100.0, a, bridge, "wacc", [0.10], "stage1_growth", [0.05, 0.10, 0.15])
    assert s3["value_per_share"][0][1] == point


def test_validate_rejects_g_above_wacc():
    with pytest.raises(ValueError):
        D.run_dcf(100.0, _a(terminal_growth=0.12), D.EquityBridge(shares_outstanding=1.0))
