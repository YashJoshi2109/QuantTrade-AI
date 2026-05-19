"""Tests for the point-in-time join: PIT constraints, NaN handling, audit output."""
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest

from data.features.pit_join import PointInTimeJoin


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ohlcv(symbols: list, dates: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        for d in dates:
            rows.append({
                "symbol": sym,
                "date": d,
                "open": 100.0,
                "high": 102.0,
                "low": 99.0,
                "close": 101.0,
                "volume": 1_000_000.0,
                "source": "test",
            })
    return pd.DataFrame(rows)


def _make_sec_features(symbols: list, dates: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        for d in dates:
            rows.append({
                "symbol": sym,
                "date": d,
                "days_since_10k": 30.0,
                "negative_word_ratio": 0.05,
            })
    return pd.DataFrame(rows).set_index(["symbol", "date"])


def _make_news_features(symbols: list, dates: pd.DatetimeIndex) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        for d in dates:
            rows.append({
                "symbol": sym,
                "date": d,
                "news_count_7d": 5.0,
                "news_avg_tone_7d": 1.2,
            })
    return pd.DataFrame(rows).set_index(["symbol", "date"])


# ---------------------------------------------------------------------------
# test_no_future_sec_feature
# ---------------------------------------------------------------------------

def test_no_future_sec_feature(tmp_path: Path):
    """After join, no SEC feature date should exceed the prediction date."""
    dates = pd.DatetimeIndex([
        pd.Timestamp("2022-01-03"),
        pd.Timestamp("2022-01-04"),
        pd.Timestamp("2022-01-05"),
    ])
    ohlcv = _make_ohlcv(["AAPL"], dates)
    sec_feats = _make_sec_features(["AAPL"], dates)

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, output_dir=str(tmp_path))
    result = joiner.run()

    # All rows should have aligned dates
    assert not result.empty
    assert (result["date"].isin(dates)).all()


# ---------------------------------------------------------------------------
# test_no_future_news_feature
# ---------------------------------------------------------------------------

def test_no_future_news_feature(tmp_path: Path):
    """After join, no news feature date should exceed the prediction date."""
    dates = pd.DatetimeIndex([pd.Timestamp("2022-03-01")])
    ohlcv = _make_ohlcv(["MSFT"], dates)
    news_feats = _make_news_features(["MSFT"], dates)

    joiner = PointInTimeJoin(ohlcv, news_features_df=news_feats, output_dir=str(tmp_path))
    result = joiner.run()
    assert not result.empty


# ---------------------------------------------------------------------------
# test_no_ohlcv_target_in_features
# ---------------------------------------------------------------------------

def test_no_ohlcv_target_in_features(tmp_path: Path):
    """Target column fwd_return_h20 must not appear in the merged feature DataFrame."""
    dates = pd.DatetimeIndex([pd.Timestamp("2022-05-01")])
    ohlcv = _make_ohlcv(["AAPL"], dates)
    # Inject a target column (should be dropped)
    ohlcv["fwd_return_h20"] = 0.05
    sec_feats = _make_sec_features(["AAPL"], dates)

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, horizon=20, output_dir=str(tmp_path))
    result = joiner.run()
    assert "fwd_return_h20" not in result.columns, (
        "Target column must be excluded from the feature DataFrame"
    )


# ---------------------------------------------------------------------------
# test_missing_handled_with_nan
# ---------------------------------------------------------------------------

def test_missing_handled_with_nan(tmp_path: Path):
    """Symbols with no SEC data should get NaN in sec_feature columns."""
    dates = pd.DatetimeIndex([pd.Timestamp("2022-06-01")])
    # OHLCV for both AAPL and GOOG
    ohlcv = _make_ohlcv(["AAPL", "GOOG"], dates)
    # SEC features only for AAPL
    sec_feats = _make_sec_features(["AAPL"], dates)

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, output_dir=str(tmp_path))
    result = joiner.run()

    goog_rows = result[result["symbol"] == "GOOG"]
    assert not goog_rows.empty

    # All SEC feature columns for GOOG should be NaN
    sec_cols = [c for c in result.columns if c.startswith("sec_")]
    for col in sec_cols:
        goog_val = goog_rows[col].iloc[0]
        assert (goog_val is None) or (isinstance(goog_val, float) and math.isnan(goog_val)), (
            f"GOOG should have NaN in '{col}', got {goog_val}"
        )


# ---------------------------------------------------------------------------
# test_join_audit_saved
# ---------------------------------------------------------------------------

def test_join_audit_saved(tmp_path: Path):
    """run() must write point_in_time_join_audit.json."""
    dates = pd.DatetimeIndex([pd.Timestamp("2022-01-03")])
    ohlcv = _make_ohlcv(["AAPL"], dates)
    sec_feats = _make_sec_features(["AAPL"], dates)

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, output_dir=str(tmp_path))
    joiner.run()

    audit_path = tmp_path / "point_in_time_join_audit.json"
    assert audit_path.exists(), "point_in_time_join_audit.json was not written"

    with open(audit_path) as f:
        audit = json.load(f)
    assert "total_rows" in audit
    assert "violations" in audit


# ---------------------------------------------------------------------------
# test_available_at_constraint (edge cases)
# ---------------------------------------------------------------------------

def test_available_at_same_day(tmp_path: Path):
    """Filing available_at == prediction_date: should be included."""
    d = pd.Timestamp("2022-04-01")
    ohlcv = _make_ohlcv(["AAPL"], pd.DatetimeIndex([d]))
    sec_feats = _make_sec_features(["AAPL"], pd.DatetimeIndex([d]))

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, output_dir=str(tmp_path))
    result = joiner.run()
    assert not result.empty
    sec_cols = [c for c in result.columns if c.startswith("sec_")]
    for col in sec_cols:
        val = result[col].iloc[0]
        # Same-day features should be present (not NaN), because the left join
        # matches on exact date
        assert not (isinstance(val, float) and math.isnan(val)), (
            f"Same-day SEC feature '{col}' should not be NaN"
        )


def test_available_at_day_before(tmp_path: Path):
    """Filing available_at = d-1: feature row exists for d-1, not d."""
    d = pd.Timestamp("2022-04-02")
    d_minus_1 = pd.Timestamp("2022-04-01")

    ohlcv = _make_ohlcv(["AAPL"], pd.DatetimeIndex([d]))
    # SEC features only defined for d-1
    sec_feats = _make_sec_features(["AAPL"], pd.DatetimeIndex([d_minus_1]))

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, output_dir=str(tmp_path))
    result = joiner.run()
    assert not result.empty
    # For date d, there is no matching sec feature row (different date) → NaN
    sec_cols = [c for c in result.columns if c.startswith("sec_")]
    for col in sec_cols:
        val = result[col].iloc[0]
        assert (val is None) or (isinstance(val, float) and math.isnan(val)), (
            f"Feature '{col}' for date {d} should be NaN when only d-1 row exists"
        )


def test_available_at_day_after(tmp_path: Path):
    """Filing available_at = d+1: must NOT appear in features for date d."""
    d = pd.Timestamp("2022-04-01")
    d_plus_1 = pd.Timestamp("2022-04-02")

    ohlcv = _make_ohlcv(["AAPL"], pd.DatetimeIndex([d]))
    # SEC features only defined for d+1 (future)
    sec_feats = _make_sec_features(["AAPL"], pd.DatetimeIndex([d_plus_1]))

    joiner = PointInTimeJoin(ohlcv, sec_features_df=sec_feats, output_dir=str(tmp_path))
    result = joiner.run()
    assert not result.empty
    sec_cols = [c for c in result.columns if c.startswith("sec_")]
    for col in sec_cols:
        val = result[col].iloc[0]
        assert (val is None) or (isinstance(val, float) and math.isnan(val)), (
            f"Future feature '{col}' must not appear in row for date {d}"
        )
