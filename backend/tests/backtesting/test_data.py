"""Price loading: validation, provider fallback, adjustment flags, cache."""
from datetime import datetime

import pandas as pd
import pytest

from bt_fixtures import random_walk
from app.services.backtesting import data


@pytest.fixture(autouse=True)
def _clean():
    data.clear_cache()
    yield
    data.clear_cache()


def test_validate_drops_bad_rows_and_repairs_ranges():
    df = random_walk(50, seed=1)
    df.iloc[3, df.columns.get_loc("close")] = float("nan")
    df.iloc[4, df.columns.get_loc("open")] = -1
    df.iloc[5, df.columns.get_loc("high")] = df["low"].iloc[5] * 0.5  # high below low
    df = pd.concat([df, df.iloc[[10]]])  # duplicate date
    out, warns = data.validate_ohlcv(df, "X")
    assert len(out) == 48
    assert out.index.is_monotonic_increasing and not out.index.duplicated().any()
    assert (out["high"] >= out[["open", "close"]].max(axis=1)).all()
    assert (out["low"] <= out[["open", "close"]].min(axis=1)).all()
    assert any("dropped 2" in w for w in warns)


def test_validate_flags_probable_unadjusted_split():
    df = random_walk(40, seed=2)
    df.iloc[20:, :4] = df.iloc[20:, :4] / 4
    _, warns = data.validate_ohlcv(df, "X")
    assert any("unadjusted split" in w for w in warns)


def test_provider_fallback_and_unadjusted_warning(monkeypatch):
    px = random_walk(100, seed=3, start="2020-01-01")
    calls = []

    def empty(t, s, e):
        calls.append("a")
        return pd.DataFrame()

    def raw(t, s, e):
        calls.append("b")
        return px

    monkeypatch.setattr(data, "PROVIDERS", [("a", empty, True), ("b", raw, False)])
    ps = data.load_prices("xyz", datetime(2020, 1, 1), datetime(2020, 12, 31))
    assert ps.source == "b" and ps.adjusted is False and ps.symbol == "XYZ"
    assert any("not split/dividend adjusted" in w for w in ps.warnings)
    data.load_prices("XYZ", datetime(2020, 1, 1), datetime(2020, 12, 31))
    assert calls == ["a", "b"], "second call should hit the cache"


def test_fmp_rows_scale_all_prices():
    rows = [{"date": "2020-01-02", "open": 400, "high": 404, "low": 396, "close": 400, "adjClose": 100, "volume": 10},
            {"date": "2020-01-03", "open": 100, "high": 101, "low": 99, "close": 100, "adjClose": 100, "volume": 40}]
    df = data.adjust_fmp_rows(rows)
    assert df["open"].tolist() == [100, 100] and df["high"].iloc[0] == 101 and df["volume"].iloc[0] == 40
