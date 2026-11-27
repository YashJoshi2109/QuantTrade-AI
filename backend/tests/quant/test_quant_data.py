"""Quant data providers: fallbacks and provenance (all providers mocked)."""
import sys
import types
from datetime import datetime

import numpy as np
import pandas as pd

from app.services.backtesting.data import PriceSeries
from app.services.quant import data as qd


def _bars(closes, start="2024-01-02"):
    idx = pd.bdate_range(start, periods=len(closes))
    c = np.asarray(closes, float)
    return pd.DataFrame({"open": c, "high": c * 1.01, "low": c * 0.99, "close": c, "volume": 1e6}, index=idx)


def test_classify_release_time():
    tz = "America/New_York"
    assert qd.classify_time(pd.Timestamp("2025-01-30 16:30", tz=tz)) == "amc"
    assert qd.classify_time(pd.Timestamp("2025-01-30 07:00", tz=tz)) == "bmo"
    assert qd.classify_time(pd.Timestamp("2025-01-30 12:00", tz=tz)) == "dmh"
    assert qd.classify_time(pd.Timestamp("2025-01-30 00:00", tz=tz)) is None


def test_prices_prefers_vendor_adjusted_bars(monkeypatch):
    ps = PriceSeries("AAPL", _bars(np.linspace(100, 110, 40)), "yfinance", True, [])
    monkeypatch.setattr(qd, "load_prices", lambda s, a, b, min_bars=20: ps)
    monkeypatch.setattr(qd, "_db_prices", lambda *a: (_ for _ in ()).throw(AssertionError("DB must not be read")))
    assert qd.LiveQuantData().prices("AAPL", datetime(2024, 1, 1), datetime(2024, 3, 1)).source == "yfinance"


def test_db_fallback_is_flagged_unadjusted_and_rejects_split_jumps(monkeypatch):
    monkeypatch.setattr(qd, "load_prices", lambda s, a, b, min_bars=20: None)
    monkeypatch.setattr(qd, "_db_prices", lambda s, a, b: _bars(np.linspace(100, 110, 40)))
    ps = qd.LiveQuantData().prices("AAPL", datetime(2024, 1, 1), datetime(2024, 3, 1))
    assert ps.source == "price_bars (database)" and ps.adjusted is False
    assert any("not split/dividend adjusted" in w for w in ps.warnings)
    split = np.r_[np.full(20, 400.0), np.full(20, 100.0)]          # unadjusted 4:1 split
    monkeypatch.setattr(qd, "_db_prices", lambda s, a, b: _bars(split))
    assert qd.LiveQuantData().prices("AAPL", datetime(2024, 1, 1), datetime(2024, 3, 1)) is None


def test_yfinance_earnings_events_parsing(monkeypatch):
    tz = "America/New_York"
    df = pd.DataFrame({"EPS Estimate": [2.5, 2.35, 1.6], "Reported EPS": [np.nan, 2.4, 1.5]},
                      index=pd.DatetimeIndex([pd.Timestamp("2099-01-29 16:30", tz=tz),
                                              pd.Timestamp("2025-10-30 16:30", tz=tz),
                                              pd.Timestamp("2025-07-31 07:00", tz=tz)]))
    fake = types.SimpleNamespace(Ticker=lambda s: types.SimpleNamespace(get_earnings_dates=lambda limit: df))
    monkeypatch.setitem(sys.modules, "yfinance", fake)
    ev = qd.LiveQuantData().earnings_events("AAPL", 12)
    assert ev.source.startswith("yfinance")
    assert [e["date"] for e in ev.events] == ["2025-07-31", "2025-10-30"]          # future row dropped
    assert ev.events[0]["timing"] == "bmo" and ev.events[1]["timing"] == "amc"
    assert ev.events[1]["surprise_pct"] == round((2.4 - 2.35) / 2.35 * 100, 2)
    assert ev.events[0]["surprise_pct"] == round((1.5 - 1.6) / 1.6 * 100, 2)


def test_earnings_events_unavailable_is_reported(monkeypatch):
    monkeypatch.setattr(qd, "_yf_events", lambda s, n: [])
    monkeypatch.setattr(qd, "_finnhub_events", lambda s: [])
    ev = qd.LiveQuantData().earnings_events("AAPL", 12)
    assert ev.events == [] and ev.source is None and len(ev.notes) == 2


def test_risk_free_without_key_is_none(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "FRED_API_KEY", None, raising=False)
    assert qd.LiveQuantData().risk_free(datetime(2024, 1, 1), datetime(2024, 6, 1)) is None
