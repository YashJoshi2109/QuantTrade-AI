"""Rule-based SEC summary must compare like-for-like spans (no FY vs quarter)."""
import json

from app.services.sec_edgar_service import _fallback_insights


def _row(period, form, **vals):
    return {"period": period, "form": form,
            **{k: json.dumps({"value": v}) for k, v in vals.items()}}


# Shape of AAPL rows on prod (2026-11-25): newest first, FY and quarters mixed.
AAPL = [
    _row("2026-FY", "10-K", revenue=478_834e6, net_income=132_175e6,
         operating_cash_flow=145_100e6, free_cash_flow=136_060e6),
    _row("2026-Q3", "10-Q", revenue=109_420e6, net_income=27_000e6),
    _row("2026-Q2", "10-Q", revenue=105_000e6),
    _row("2026-Q1", "10-Q", revenue=143_700e6),
    _row("2025-FY", "10-K", revenue=416_161e6, net_income=112_010e6),
    _row("2025-Q3", "10-Q", revenue=94_040e6),
]


def test_no_cross_span_growth():
    text = _fallback_insights("AAPL", AAPL, {"company_name": "Apple Inc."})
    assert "233" not in text and "periods ago" not in text
    # FY vs prior FY: 478.834 / 416.161 - 1 = +15.1%
    assert "FY2026 revenue $478.83B (+15.1% YoY)" in text
    # Q3 vs prior-year Q3: 109.42 / 94.04 - 1 = +16.4%
    assert "Q3 FY2026 revenue $109.42B (+16.4% YoY)" in text
    assert "net income $132.18B (+18.0% YoY)" in text
    assert "Cash Flow (FY2026)" in text and "Free cash flow $136.06B" in text


def test_missing_prior_period_has_no_growth_claim():
    text = _fallback_insights("NEWCO", [_row("2026-Q2", "10-Q", revenue=5e8)], {})
    assert "Q2 FY2026 revenue $500.0M." in text
    assert "YoY" not in text


def test_empty():
    assert "No financial data" in _fallback_insights("X", [], {})
