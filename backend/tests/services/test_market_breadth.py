"""Market breadth must classify identically everywhere, and drop delisted tickers."""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.market_breadth import (
    FLAT_THRESHOLD_PCT,
    STALE_QUOTE_MAX_AGE,
    classify_change,
    is_stale_quote,
)

NOW = datetime(2026, 11, 25, 5, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "pct,expected",
    [
        (0.0, "flat"), (0.05, "flat"), (-0.05, "flat"),
        (0.1, "flat"), (-0.1, "flat"),          # boundary is inclusive-flat
        (0.11, "up"), (-0.11, "down"),
        (3.2, "up"), (-2.7, "down"),
        (None, "flat"),
    ],
)
def test_classify_change(pct, expected):
    assert classify_change(pct) == expected


def test_threshold_matches_frontend():
    """Desktop cards, heatmap and mobile import FLAT_THRESHOLD_PCT from marketBreadth.ts."""
    ts = Path(__file__).resolve().parents[3] / "frontend/src/lib/marketBreadth.ts"
    src = ts.read_text()
    m = re.search(r"export const FLAT_THRESHOLD_PCT = ([0-9.]+)", src)
    assert m and float(m.group(1)) == FLAT_THRESHOLD_PCT
    m = re.search(r"export const STALE_QUOTE_MAX_AGE_MS = ([0-9 *]+)", src)
    assert m and eval(m.group(1)) == STALE_QUOTE_MAX_AGE.total_seconds() * 1000  # noqa: S307 (constant arithmetic)


def test_delisted_ticker_is_stale():
    # EA's real last trade per Yahoo regularMarketTime: 2026-08-04
    ea = {"price": 209.7, "change_percent": 0.0, "market_time": "2026-08-04T20:00:00+00:00"}
    assert is_stale_quote(ea, now=NOW)


def test_recent_trade_not_stale_over_long_weekend():
    friday = NOW - timedelta(days=4)
    assert not is_stale_quote({"market_time": friday.isoformat()}, now=NOW)


def test_unknown_trade_time_is_kept():
    assert not is_stale_quote({"price": 10, "change_percent": 0}, now=NOW)
    assert not is_stale_quote({"market_time": None}, now=NOW)
    assert not is_stale_quote({"market_time": "garbage"}, now=NOW)
    assert not is_stale_quote(None, now=NOW)


def test_unix_seconds_and_naive_iso_supported():
    old = (NOW - timedelta(days=30)).timestamp()
    assert is_stale_quote({"market_time": old}, now=NOW)
    assert is_stale_quote({"market_time": "2026-08-04T20:00:00"}, now=NOW)


def test_live_snapshot_counts_agree():
    """Regression for the 503/251/12 vs 487/238/41 mismatch: one classifier → one answer."""
    pcts = [0.0, 0.01, -0.01, 0.05, 0.1, -0.1, 0.11, -0.11, 1.5, -2.0]
    counts = {"up": 0, "down": 0, "flat": 0}
    for p in pcts:
        counts[classify_change(p)] += 1
    assert counts == {"up": 2, "down": 2, "flat": 6}
