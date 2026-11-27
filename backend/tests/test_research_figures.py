"""Research-page figures audited against yfinance on 2026-11-27.

- Volume: an overnight Public.com quote carried the overnight venue's volume
  (NVDA 1,675,198 vs 366,571,900 for the Nov 25 session).
- Option Greeks: the chain was solved against the overnight print (NVDA
  156.65) while option quotes are regular-session (close 149.30).
- Expiry: the day after Thanksgiving closes at 13:00 ET, not 16:00.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from unittest.mock import patch

import pandas as pd
import pytest

from app.services import canonical_quote as cq
from app.services import public_client as pc
from app.services import option_greeks as og

UTC = timezone.utc
THANKSGIVING_NIGHT = datetime(2026, 11, 27, 2, 48, tzinfo=UTC)

NVDA_RAW = {
    "instrument": {"symbol": "NVDA", "type": "EQUITY"}, "outcome": "SUCCESS",
    "last": "156.65", "last_timestamp": datetime(2026, 11, 27, 2, 47, 50, tzinfo=UTC),
    "bid": "156.60", "ask": "156.70", "volume": 1675198, "previous_close": "155.38",
    "one_day_change": {"change": "-6.08", "percent_change": "-3.91"},
}


def _clear():
    pc._prev_close_cache.clear()
    pc._prior_close_cache.clear()
    pc._ref_bar_cache.clear()


def _public_nvda(with_bars=True):
    q = pc._parse_quote(NVDA_RAW)
    _clear()
    idx = pd.to_datetime(["2026-11-21", "2026-11-24", "2026-11-25"])
    frame = pd.DataFrame({
        "Open": [150.0, 158.0, 154.9], "High": [152.0, 159.0, 156.2],
        "Low": [148.0, 153.0, 147.9], "Close": [151.0, 155.38, 149.30],
        "Volume": [300e6, 280e6, 366_571_900],
    }, index=idx)
    results = {"NVDA": q}
    with patch("yfinance.download", return_value=frame if with_bars else pd.DataFrame()):
        asyncio.run(pc.PublicClient()._fill_previous_closes(results))
    _clear()
    return results["NVDA"]


def test_overnight_quote_reports_regular_session_volume_and_range():
    c = cq.canonicalize(_public_nvda(), now=THANKSGIVING_NIGHT)
    assert c["price"] == 149.30 and c["previous_close"] == 155.38
    assert c["volume"] == 366_571_900                 # the Nov 25 session, not overnight
    assert (c["open"], c["high"], c["low"]) == (154.9, 156.2, 147.9)
    assert c["extended"]["price"] == 156.65
    assert c["extended"]["volume"] == 1_675_198       # overnight volume stays with its print
    assert "reference_bar" not in c


def test_overnight_quote_without_bars_never_shows_overnight_volume_as_daily():
    raw = _public_nvda(with_bars=False)
    c = cq.canonicalize(raw, now=THANKSGIVING_NIGHT)
    assert c["volume"] is None
    assert c["extended"]["volume"] == 1_675_198


def test_option_spot_is_the_canonical_regular_price():
    from app.api import options

    class FakeCache:
        def __init__(self, db):
            pass

        async def get_quote(self, symbol):
            return {"price": 149.30, "extended": {"price": 156.65}}

    with patch("app.services.quote_cache.QuoteCacheService", FakeCache):
        spot = asyncio.run(options._spot_price("NVDA"))
    assert spot == 149.30


def test_greeks_against_regular_spot_are_sane():
    """149 call / put at the Nov 25 close: IV solvable, |delta| near 0.5."""
    now = datetime(2026, 11, 27, 6, 18, tzinfo=UTC)
    with patch.object(og, "datetime", wraps=datetime) as dt:
        dt.now.return_value = now
        calls = [{"strike": 149.0, "bid": 3.30, "ask": 3.50}]
        puts = [{"strike": 149.0, "bid": 2.98, "ask": 3.05}]
        og.enrich_contracts(calls, spot=149.30, expiration="2026-11-27", is_call=True)
        og.enrich_contracts(puts, spot=149.30, expiration="2026-11-27", is_call=False)
    c, p = calls[0], puts[0]
    assert c["implied_volatility"] is not None and p["implied_volatility"] is not None
    assert 0.4 < c["delta"] < 0.7 and -0.6 < p["delta"] < -0.3


def test_expiry_uses_the_early_close():
    # Fri 2026-11-27 closes at 13:00 ET (18:00 UTC): from 12:00 ET one hour is left.
    t = og.year_fraction("2026-11-27", now=datetime(2026, 11, 27, 17, 0, tzinfo=UTC))
    assert t == pytest.approx(1 / (365 * 24), rel=1e-6)
    # A normal day still expires at 16:00 ET.
    t = og.year_fraction(date(2026, 12, 4), now=datetime(2026, 12, 4, 20, 0, tzinfo=UTC))
    assert t == pytest.approx(1 / (365 * 24), rel=1e-6)


def test_cached_row_from_an_older_contract_version_is_a_miss():
    from app.services.quote_cache import _canonical_or_none

    v2 = {"symbol": "NVDA", "price": 149.30, "previous_close": 155.38, "volume": 1_911_616,
          "session": "regular", "market_time": "2026-11-25T21:00:00+00:00",
          "regular": {"price": 149.30}, "quote_version": cq.QUOTE_VERSION - 1}
    assert _canonical_or_none(v2) is None
    current = {**v2, "quote_version": cq.QUOTE_VERSION}
    assert _canonical_or_none(current) is current
