"""Reverse DCF round trips and Monte Carlo execution checks."""
import numpy as np
import pytest

from app.services.valuation import dcf as D, montecarlo as MC, reverse_dcf as RD
from app.services.valuation.provenance import DataUnavailable

A = D.DCFAssumptions(stage1_growth=0.08, terminal_growth=0.025, operating_margin_start=0.20,
                     target_operating_margin=0.22, tax_rate=0.21, sales_to_capital=2.5, wacc=0.09,
                     stage1_years=10, fade_years=0)
HIST = {"cagr_3y_pct": 9.0, "cagr_5y_pct": 11.0, "operating_margin_max_pct": 24.0}


def _bridge(price=None):
    return D.EquityBridge(total_debt=50.0, cash_and_sti=20.0, shares_outstanding=10.0, price=price)


@pytest.mark.parametrize("param,true", [("stage1_growth", 0.17), ("target_operating_margin", 0.31),
                                        ("sales_to_capital", 4.0)])
def test_reverse_dcf_recovers_the_driver_that_generated_the_price(param, true):
    a_true = D.with_(A, **{param: true})
    price = float(D.per_share(D.project(1000.0, a_true)["enterprise_value"][0], _bridge()))
    roots = RD.solve_roots(1000.0, A, _bridge(), price, param)
    assert len(roots) == 1
    assert roots[0] == pytest.approx(true, abs=1e-6)


def test_reverse_dcf_payload_and_checks():
    price = D.run_dcf(1000.0, D.with_(A, stage1_growth=0.20), _bridge())["value_per_share"]
    out = RD.reverse_dcf(1000.0, A, _bridge(price), "stage1_growth", 2025, HIST)
    assert out["solution"]["value_pct"] == pytest.approx(20.0, abs=0.05)
    path = out["implied_path"]
    assert len(path["projection"]) == 10
    assert path["value_per_share_check"] == pytest.approx(price, abs=0.01)
    assert path["implied_revenue_cagr_pct"] == pytest.approx(20.0, abs=0.05)
    assert path["final_year_revenue_multiple_of_base"] == pytest.approx(1.2 ** 10, rel=1e-3)
    names = {c["check"]: c for c in out["checks"]}
    assert names["revenue CAGR vs own 5y history"]["result"] == "exceeds benchmark"
    # return on new capital = 2.5 * 22% * 0.79 = 43.45% > WACC 9%
    assert path["return_on_new_capital_pct"] == pytest.approx(43.45)
    assert names["return on new capital vs WACC"]["result"] == "within benchmark"


def test_reverse_dcf_reports_no_solution_instead_of_guessing():
    out = RD.reverse_dcf(1000.0, A, _bridge(1e9), "target_operating_margin", 2025, HIST)
    assert out["solution"] is None and "No value" in out["note"]


def test_reverse_dcf_needs_price():
    with pytest.raises(DataUnavailable):
        RD.reverse_dcf(1000.0, A, _bridge(None), "stage1_growth", 2025, HIST)


def test_growth_destroys_value_when_roic_below_wacc():
    # return on new capital = 0.3 * 10% * 0.79 = 2.4% < WACC: higher growth -> lower value
    a = D.with_(A, sales_to_capital=0.3, target_operating_margin=0.10, operating_margin_start=0.10)
    v = [D.run_dcf(1000.0, D.with_(a, stage1_growth=g), _bridge())["value_per_share"] for g in (0.02, 0.10, 0.20)]
    assert v == sorted(v, reverse=True)
    price = D.run_dcf(1000.0, D.with_(a, stage1_growth=0.12), _bridge(1.0))["value_per_share"]
    out = RD.reverse_dcf(1000.0, a, _bridge(price), "stage1_growth", 2025, HIST)
    assert out["solution"]["value"] == pytest.approx(0.12, abs=2e-4)
    assert "below WACC" in out["note"]


# ── Monte Carlo ─────────────────────────────────────────────────────────────
MC_A = D.with_(A, stage1_years=5, fade_years=5)


def test_mc_zero_variance_equals_point_estimate():
    fixed = {k: {"dist": "fixed", "value": getattr(MC_A, k)} for k in MC.VARS}
    point = float(D.per_share(D.project(1000.0, MC_A)["enterprise_value"][0], _bridge()))
    out = MC.simulate(1000.0, MC_A, _bridge(), n=500, seed=1, distributions=fixed, price=point + 1)
    v = out["value_per_share"]
    assert v["median"] == v["p5"] == v["p95"] == round(point, 2)
    assert out["prob_value_below_price_pct"] == 100.0
    out2 = MC.simulate(1000.0, MC_A, _bridge(), n=500, seed=1, distributions=fixed, price=point - 1)
    assert out2["prob_value_below_price_pct"] == 0.0


def test_mc_really_executes_n_draws_reproducibly():
    out = MC.simulate(1000.0, MC_A, _bridge(), n=10_000, seed=7, price=50.0)
    assert out["executed"] and out["n_requested"] == 10_000 and out["n_valid"] == 10_000 and out["seed"] == 7
    assert out == {**MC.simulate(1000.0, MC_A, _bridge(), n=10_000, seed=7, price=50.0), "runtime_ms": out["runtime_ms"]}
    assert MC.simulate(1000.0, MC_A, _bridge(), n=10_000, seed=8)["value_per_share"]["median"] != out["value_per_share"]["median"]
    v = out["value_per_share"]
    assert v["p5"] < v["p25"] < v["median"] < v["p75"] < v["p95"]
    assert sum(out["histogram"]["counts"]) <= 10_000
    assert out["distributions"]["wacc"]["sd"] == 1.0          # reported in percent
    # independent re-computation with the same generator and draw order
    rng = np.random.default_rng(7)
    d = MC.merge_distributions(MC_A, None)
    draws = {k: np.clip(rng.normal(d[k]["mean"], d[k]["sd"], 10_000), d[k]["min"], d[k]["max"]) for k in MC.VARS}
    tg = np.minimum(draws["terminal_growth"], draws["wacc"] - MC.MIN_SPREAD)
    ev = D.project(1000.0, MC_A, g1=draws["stage1_growth"], m_target=draws["target_operating_margin"],
                   wacc=draws["wacc"], g_t=tg)["enterprise_value"]
    vals = D.per_share(ev, _bridge())
    assert v["median"] == round(float(np.median(vals)), 2)
    assert out["prob_value_below_price_pct"] == round(float((vals < 50.0).mean()) * 100, 2)


def test_mc_distribution_overrides_and_validation():
    out = MC.simulate(1000.0, MC_A, _bridge(), n=1000, seed=3,
                      distributions={"wacc": {"dist": "uniform", "min": 0.08, "max": 0.10},
                                     "stage1_growth": {"sd": 0.0}})
    assert out["distributions"]["wacc"] == {"dist": "uniform", "min": 8.0, "max": 10.0}
    assert out["distributions"]["stage1_growth"]["sd"] == 0.0
    with pytest.raises(ValueError):
        MC.simulate(1000.0, MC_A, _bridge(), n=10, seed=1)
    with pytest.raises(ValueError):
        MC.simulate(1000.0, MC_A, _bridge(), n=1000, distributions={"beta": {"sd": 1}})


def test_mc_terminal_growth_capped_below_wacc():
    out = MC.simulate(1000.0, MC_A, _bridge(), n=2000, seed=5,
                      distributions={"terminal_growth": {"dist": "fixed", "value": 0.085}})
    # WACC ~ N(9%, 1%): every draw with WACC < 9.5% has g capped at WACC - 1pp
    assert out["clipped_draws"]["terminal_growth_capped_at_wacc_minus_1pp"] > 0
    assert out["n_valid"] == 2000
