"""Unit normalisation of `fundamentals` rows (finviz percents vs yfinance ratios)."""
import pytest

from app.services.fundamental_units import is_ratio_row, normalize_fundamental_units

PERCENT_STYLE = {"roe": 142.26, "roa": 28.1, "profit_margin": 27.6, "operating_margin": 33.01,
                 "gross_margin": 48.79, "dividend_yield": 0.30, "debt_to_equity": 1.87}
RATIO_STYLE = {"roe": 1.4226, "roa": 0.281, "profit_margin": 0.276, "operating_margin": 0.3301,
               "gross_margin": 0.4879, "dividend_yield": 0.003, "debt_to_equity": 187.0}


@pytest.mark.parametrize("row", [PERCENT_STYLE, RATIO_STYLE])
def test_both_styles_normalise_to_percentage_points(row):
    out = normalize_fundamental_units(row)
    assert out["roe"] == pytest.approx(142.26)
    assert out["roa"] == pytest.approx(28.1)
    assert out["profit_margin"] == pytest.approx(27.6)
    assert out["operating_margin"] == pytest.approx(33.01)
    assert out["gross_margin"] == pytest.approx(48.79)
    assert out["dividend_yield"] == pytest.approx(0.30)
    assert out["debt_to_equity"] == pytest.approx(1.87)


def test_detection_and_edge_cases():
    assert not is_ratio_row(PERCENT_STYLE) and is_ratio_row(RATIO_STYLE)
    # dividend-only rows (ETFs) are finviz percents
    assert normalize_fundamental_units({"dividend_yield": 1.2})["dividend_yield"] == 1.2
    assert normalize_fundamental_units({"roe": None, "debt_to_equity": None}) == {"roe": None, "debt_to_equity": None}
    assert normalize_fundamental_units({"debt_to_equity": 0.66})["debt_to_equity"] == 0.66


def test_copilot_fact_uses_same_units():
    from app.services.copilot.sources import fundamentals_fact
    for row in (PERCENT_STYLE, RATIO_STYLE):
        f = fundamentals_fact("AAPL", row)
        assert f.roe_pct == pytest.approx(142.26) and f.dividend_yield_pct == pytest.approx(0.3)
        assert f.debt_to_equity == pytest.approx(1.87)
