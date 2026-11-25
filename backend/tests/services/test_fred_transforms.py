"""FRED unit transforms for the Global Monitor Economic Indicators panel."""
from app.services.fred_transforms import (
    format_usd_billions,
    obs_limit,
    transform_observations,
    yoy_percent,
)


def _obs(values):
    """Monthly observations, newest first (FRED sort_order=desc), ending 2026-12."""
    out = []
    y, m = 2026, 12
    for v in values:
        out.append({"date": f"{y:04d}-{m:02d}-01", "value": str(v)})
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def test_walcl_millions_are_shown_as_trillions_not_billions():
    # WALCL is millions of USD: 6,741,452 M = $6.74T; a -17,415 M week = -$17.4B
    shown = transform_observations("usd_millions", _obs([6741452, 6758867]))
    assert shown.value == "$6.74T"
    assert shown.change == "-$17.4B"
    assert shown.change_direction == "down"


def test_usd_billions_series_m2():
    shown = transform_observations("usd_billions", _obs([22100.5, 22000.0]))
    assert shown.value == "$22.10T"
    assert shown.change == "+$100.5B"


def test_cpi_index_is_converted_to_yoy_percent():
    # 14 monthly index levels, newest first. YoY = (x_t / x_{t-12} - 1) * 100
    levels = [337.48, 336.9] + [330.0] * 10 + [327.0, 326.5]
    shown = transform_observations("yoy_pct", _obs(levels))
    expected = (337.48 / 327.0 - 1) * 100
    assert shown.value == f"{expected:.2f}%"
    assert shown.date == "2026-12-01"
    prev = (336.9 / 326.5 - 1) * 100
    assert shown.change == f"{expected - prev:+.2f}pp"
    # never the raw index level
    assert shown.value != "337.48%"


def test_cpi_yoy_matches_calendar_month_across_missing_values():
    # Real FRED shape: 2025-10 is "." (shutdown). Oct-2026 has no year-ago value,
    # so the newest valid YoY is Sep-2026 vs Sep-2025, never Oct-2026 vs Sep-2025.
    obs = [
        {"date": "2026-10-01", "value": "337.476"},
        {"date": "2026-09-01", "value": "336.298"},
        {"date": "2026-08-01", "value": "334.131"},
        {"date": "2026-07-01", "value": "332.813"},
        {"date": "2026-06-01", "value": "332.568"},
        {"date": "2026-05-01", "value": "333.979"},
        {"date": "2026-04-01", "value": "332.407"},
        {"date": "2026-03-01", "value": "330.293"},
        {"date": "2026-02-01", "value": "327.460"},
        {"date": "2026-01-01", "value": "326.588"},
        {"date": "2025-12-01", "value": "326.031"},
        {"date": "2025-11-01", "value": "325.063"},
        {"date": "2025-10-01", "value": "."},
        {"date": "2025-09-01", "value": "324.245"},
        {"date": "2025-08-01", "value": "323.291"},
    ]
    shown = transform_observations("yoy_pct", obs)
    sep = (336.298 / 324.245 - 1) * 100
    aug = (334.131 / 323.291 - 1) * 100
    assert shown.date == "2026-09-01"
    assert shown.value == f"{sep:.2f}%"
    assert shown.change == f"{sep - aug:+.2f}pp"


def test_cpi_needs_a_year_of_history():
    assert transform_observations("yoy_pct", _obs([337.48] * 12)) is None
    assert obs_limit("yoy_pct") >= 25


def test_yoy_percent():
    assert abs(yoy_percent(103.0, 100.0) - 3.0) < 1e-9
    assert yoy_percent(1.0, 0) is None


def test_missing_values_are_skipped():
    shown = transform_observations("pct", [{"date": "2026-11-20", "value": "."}, {"date": "2026-11-19", "value": "4.10"}, {"date": "2026-11-18", "value": "4.00"}])
    assert shown.value == "4.10%"
    assert shown.date == "2026-11-19"
    assert shown.change == "+0.10pp"
    assert transform_observations("pct", [{"date": "x", "value": "."}]) is None


def test_usd_price():
    shown = transform_observations("usd", _obs([3.12, 3.15]))
    assert shown.value == "$3.12"
    assert shown.change == "-0.03"


def test_format_usd_billions():
    assert format_usd_billions(950.0) == "$950.0B"
    assert format_usd_billions(-1500.0) == "-$1.50T"
    assert format_usd_billions(0.0, signed=True) == "$0.0B"
