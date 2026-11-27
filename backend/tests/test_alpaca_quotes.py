"""Alpaca as a keyed fallback: SIP daily bars for the regular session, the IEX
trade (with its time) for the live / extended print. Fixtures are the live
responses seen from prod on 2026-11-27 (paper data plan)."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.services import alpaca_client as ac
from app.services import canonical_quote as cq
from app.services import public_client as pc

UTC = timezone.utc
THANKSGIVING_NIGHT = datetime(2026, 11, 27, 2, 48, tzinfo=UTC)

BARS = {"bars": {"NVDA": [
    {"t": "2026-11-24T05:00:00Z", "o": 158.0, "h": 159.0, "l": 153.0, "c": 155.38, "v": 386991625},
    {"t": "2026-11-25T05:00:00Z", "o": 154.9, "h": 156.2, "l": 147.9, "c": 149.30, "v": 367325480},
]}}
TRADE_AH = {"trade": {"p": 149.73, "t": "2026-11-25T21:27:06.412140711Z"}}


def _fake_get(trade):
    def get(path, params):
        return BARS if path == "/v2/stocks/bars" else trade
    return get


@pytest.fixture(autouse=True)
def _keys(monkeypatch):
    monkeypatch.setattr(ac.settings, "ALPACA_API_KEY", "PKTEST")
    monkeypatch.setattr(ac.settings, "ALPACA_SECRET_KEY", "secret")


def test_after_hours_iex_trade_is_extended_and_sip_bar_is_the_session():
    with patch.object(ac, "_data_get", _fake_get(TRADE_AH)), \
            patch.object(cq, "_now", return_value=THANKSGIVING_NIGHT):
        q = cq.canonicalize(ac.AlpacaClient().get_quote("NVDA"), now=THANKSGIVING_NIGHT)
    assert q["price"] == 149.30 and q["previous_close"] == 155.38
    assert q["change_percent"] == pytest.approx(-3.913, abs=1e-3)
    assert q["volume"] == 367325480                    # consolidated, not IEX-only
    assert (q["open"], q["high"], q["low"]) == (154.9, 156.2, 147.9)
    assert q["extended"]["price"] == 149.73 and q["extended"]["session"] == "after-hours"
    assert q["source"] == "alpaca"


def test_bars_only_when_no_trade():
    with patch.object(ac, "_data_get", _fake_get({})):
        q = cq.canonicalize(ac.AlpacaClient().get_quote("NVDA"), now=THANKSGIVING_NIGHT)
    assert q["price"] == 149.30 and q["previous_close"] == 155.38 and q["extended"] is None


def test_no_keys_no_calls(monkeypatch):
    monkeypatch.setattr(ac.settings, "ALPACA_API_KEY", None)
    assert ac.AlpacaClient().get_daily_bars_sip(["NVDA"]) == {}


def test_reference_closes_fall_back_to_alpaca_when_yfinance_is_empty():
    import pandas as pd
    from datetime import date

    for c in (pc._prev_close_cache, pc._prior_close_cache, pc._ref_bar_cache):
        c.clear()
    ref = {"NVDA": date(2026, 11, 25)}
    with patch("yfinance.download", return_value=pd.DataFrame()), \
            patch.object(ac, "_data_get", _fake_get({})):
        out = pc._fetch_previous_closes(["NVDA"], ref)
    assert out == {"NVDA": 149.30}
    assert pc._prior_close_cache[("NVDA", date(2026, 11, 25))] == 155.38
    assert pc._ref_bar_cache[("NVDA", date(2026, 11, 25))]["volume"] == 367325480
    for c in (pc._prev_close_cache, pc._prior_close_cache, pc._ref_bar_cache):
        c.clear()


def test_empty_env_value_does_not_shadow_secrets_manager(monkeypatch):
    from app import config_aws

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALPACA_API_KEY", "")
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    with patch.object(config_aws, "load_secrets_from_aws",
                      return_value={"ALPACA_API_KEY": "PKX", "ALPACA_SECRET_KEY": "s"}):
        config_aws.inject_aws_secrets()
    assert os.environ["ALPACA_API_KEY"] == "PKX" and os.environ["ALPACA_SECRET_KEY"] == "s"
