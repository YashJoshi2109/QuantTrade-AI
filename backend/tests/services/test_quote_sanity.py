"""Bogus movers (PARA +8116%, SBNY +1087%) must never reach movers, sectors or breadth."""
from datetime import datetime, timedelta, timezone

import pytest

from app.services.market_breadth import (
    MAX_PLAUSIBLE_MOVE_PCT,
    is_implausible_move,
    is_usable_quote,
    robust_sector_change,
)

NOW = datetime(2026, 11, 25, 5, 0, tzinfo=timezone.utc)
FRESH = (NOW - timedelta(hours=6)).isoformat()


@pytest.mark.parametrize(
    "pct,expected",
    [
        (0.0, False), (12.5, False), (-24.55, False),
        (MAX_PLAUSIBLE_MOVE_PCT, False), (-MAX_PLAUSIBLE_MOVE_PCT, False),
        (50.01, True), (-50.01, True),
        (8116.22, True), (1087.5, True),
        (float("nan"), True), ("bad", True),
    ],
)
def test_implausible_move(pct, expected):
    assert is_implausible_move(pct) is expected


def test_usable_quote_filters_bogus_rows():
    para = {"price": 2.95, "change_percent": 8116.22, "market_time": FRESH}
    sbny = {"price": 0.95, "change_percent": 1087.5, "market_time": FRESH}
    ok = {"price": 384.39, "change_percent": 22.96, "market_time": FRESH}
    stale = {"price": 209.7, "change_percent": 1.0, "market_time": "2026-08-04T20:00:00+00:00"}
    assert not is_usable_quote(para, now=NOW)
    assert not is_usable_quote(sbny, now=NOW)
    assert not is_usable_quote(stale, now=NOW)
    assert not is_usable_quote({"price": 0, "change_percent": 1}, now=NOW)
    assert not is_usable_quote({"price": 10, "unavailable": True}, now=NOW)
    assert not is_usable_quote(None, now=NOW)
    assert is_usable_quote(ok, now=NOW)


def test_sector_median_robust_to_single_outlier():
    """Communication Services showed +204.51% from one PARA row under a raw mean."""
    moves = [0.4, -0.2, 1.1, 0.3, -0.5, 8116.22]
    mean = sum(moves) / len(moves)
    assert mean > 1000
    assert robust_sector_change(moves) == pytest.approx(0.35)


def test_sector_median_edge_cases():
    assert robust_sector_change([]) == 0.0
    assert robust_sector_change([1.5]) == 1.5
    assert robust_sector_change([3.0, -1.0, 2.0]) == 2.0
    assert robust_sector_change([None, float("nan"), 1.0]) == 1.0


def test_dead_tickers_removed_from_universe():
    from app.api.market import SP500_STOCKS

    symbols = {s for rows in SP500_STOCKS.values() for s, _ in rows}
    for dead in ("PARA", "SBNY", "SIVB", "FRC", "X", "EA", "WBD", "HES", "MRO", "SQ"):
        assert dead not in symbols
    assert {"AAPL", "MSFT", "NVDA"} <= symbols
