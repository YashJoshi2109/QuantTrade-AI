"""Tests for SEC feature generation: PIT correctness, LM sentiment, section extraction."""
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest

from data.features.sec_features import (
    LM_NEGATIVE_WORDS,
    LM_UNCERTAINTY_WORDS,
    SECFeatureGenerator,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_filings_df(symbol: str, available_ats: list, forms: list = None) -> pd.DataFrame:
    """Create a minimal filings DataFrame for one symbol."""
    if forms is None:
        forms = ["10-K"] * len(available_ats)
    return pd.DataFrame({
        "symbol": symbol,
        "cik": "0000320193",
        "accessionNumber": [f"acc-{i:04d}" for i in range(len(available_ats))],
        "form": forms,
        "filingDate": available_ats,
        "acceptedDatetime": available_ats,
        "primaryDocument": [f"doc{i}.htm" for i in range(len(available_ats))],
        "available_at": available_ats,
    })


# ---------------------------------------------------------------------------
# test_days_since_10k_point_in_time
# ---------------------------------------------------------------------------

def test_days_since_10k_point_in_time():
    """Feature for date d should only use filings with available_at <= d."""
    filing_date = pd.Timestamp("2022-03-01")
    filings_df = _make_filings_df("AAPL", [filing_date], ["10-K"])
    filing_texts = {"acc-0000": "Sample 10-K text with some words."}

    gen = SECFeatureGenerator(filings_df, filing_texts)

    # Date after filing — should have finite days_since_10k
    dates_after = pd.DatetimeIndex([pd.Timestamp("2022-03-10")])
    features_after = gen.build_daily_features(["AAPL"], dates_after)
    days_after = features_after.loc[("AAPL", pd.Timestamp("2022-03-10")), "days_since_10k"]
    assert not math.isnan(days_after), "days_since_10k should be defined when filing is available"
    assert days_after == pytest.approx(9.0)

    # Date before filing — should be NaN
    dates_before = pd.DatetimeIndex([pd.Timestamp("2022-02-28")])
    features_before = gen.build_daily_features(["AAPL"], dates_before)
    days_before = features_before.loc[("AAPL", pd.Timestamp("2022-02-28")), "days_since_10k"]
    assert math.isnan(days_before), "days_since_10k should be NaN before filing is available"


# ---------------------------------------------------------------------------
# test_future_filing_not_used
# ---------------------------------------------------------------------------

def test_future_filing_not_used():
    """Filing with available_at = d+1 must NOT affect features for date d."""
    today = pd.Timestamp("2022-06-01")
    tomorrow = today + pd.Timedelta(days=1)

    filings_df = _make_filings_df("MSFT", [tomorrow], ["10-K"])
    gen = SECFeatureGenerator(filings_df, {"acc-0000": "future filing text"})

    dates = pd.DatetimeIndex([today])
    features = gen.build_daily_features(["MSFT"], dates)
    days = features.loc[("MSFT", today), "days_since_10k"]
    assert math.isnan(days), "Future filing must not appear in features for date d"


# ---------------------------------------------------------------------------
# test_lm_negative_word_ratio
# ---------------------------------------------------------------------------

def test_lm_negative_word_ratio():
    """Known text with exactly 5 LM negative words out of 100 → ratio ~0.05."""
    # Pick 5 words from LM_NEGATIVE_WORDS
    neg_words = list(LM_NEGATIVE_WORDS)[:5]
    # Build text: 5 negative words + 95 neutral filler words
    words = neg_words + ["company"] * 95
    text = " ".join(words)

    gen = SECFeatureGenerator(pd.DataFrame(), {})
    result = gen.compute_text_sentiment(text)

    assert "negative_word_ratio" in result
    ratio = result["negative_word_ratio"]
    assert ratio == pytest.approx(5 / 100, abs=0.01), (
        f"Expected ~0.05 negative word ratio, got {ratio}"
    )


def test_lm_uncertainty_word_ratio():
    """Text with 10 uncertainty words out of 100 → ratio 0.10."""
    unc_words = list(LM_UNCERTAINTY_WORDS)[:10]
    words = unc_words + ["revenue"] * 90
    text = " ".join(words)

    gen = SECFeatureGenerator(pd.DataFrame(), {})
    result = gen.compute_text_sentiment(text)
    ratio = result["uncertainty_word_ratio"]
    assert ratio == pytest.approx(10 / 100, abs=0.01)


# ---------------------------------------------------------------------------
# test_section_extraction_risk_factors
# ---------------------------------------------------------------------------

def test_section_extraction_risk_factors(sample_filing_text: str):
    """extract_section should return text containing 'risk' content."""
    gen = SECFeatureGenerator(pd.DataFrame(), {})
    section = gen.extract_section(sample_filing_text, "risk_factors")
    assert len(section) > 0, "Expected non-empty Risk Factors section"
    assert "risk" in section.lower() or "adverse" in section.lower(), (
        "Extracted Risk Factors section should contain risk-related content"
    )


def test_section_extraction_mdna(sample_filing_text: str):
    """extract_section should return text containing MD&A content."""
    gen = SECFeatureGenerator(pd.DataFrame(), {})
    section = gen.extract_section(sample_filing_text, "mdna")
    assert len(section) > 0, "Expected non-empty MD&A section"


def test_section_extraction_unknown_returns_empty():
    gen = SECFeatureGenerator(pd.DataFrame(), {})
    result = gen.extract_section("some text", "unknown_section")
    assert result == ""


# ---------------------------------------------------------------------------
# test_nan_not_zero_for_missing
# ---------------------------------------------------------------------------

def test_nan_not_zero_for_missing():
    """Symbol with no SEC filings must get NaN (not 0) in all sec feature columns."""
    # Empty filings DataFrame
    gen = SECFeatureGenerator(pd.DataFrame(columns=["symbol", "cik", "accessionNumber",
                                                      "form", "available_at"]), {})
    dates = pd.DatetimeIndex([pd.Timestamp("2022-06-01")])
    features = gen.build_daily_features(["AAPL"], dates)
    assert not features.empty

    for col in features.columns:
        val = features.iloc[0][col]
        assert math.isnan(val), (
            f"Expected NaN for symbol with no filings in column '{col}', got {val}"
        )


# ---------------------------------------------------------------------------
# test_coverage_report_saved
# ---------------------------------------------------------------------------

def test_coverage_report_saved(tmp_path: Path, sample_filings_df: pd.DataFrame, sample_filing_text: str):
    """save_coverage_report must write sec_feature_coverage.json."""
    # Build a small feature set
    filing_texts = {row["accessionNumber"]: sample_filing_text for _, row in sample_filings_df.iterrows()}
    gen = SECFeatureGenerator(sample_filings_df, filing_texts)

    dates = pd.DatetimeIndex([pd.Timestamp("2022-06-01"), pd.Timestamp("2022-09-01")])
    features = gen.build_daily_features(["AAPL", "MSFT"], dates)

    out_dir = str(tmp_path / "coverage")
    gen.save_coverage_report(features, out_dir)

    coverage_file = Path(out_dir) / "sec_feature_coverage.json"
    assert coverage_file.exists(), "sec_feature_coverage.json was not written"

    with open(coverage_file) as f:
        report = json.load(f)
    assert "coverage_pct" in report
    assert "per_feature_coverage" in report

    sample_csv = Path(out_dir) / "sec_feature_matrix_sample.csv"
    assert sample_csv.exists(), "sec_feature_matrix_sample.csv was not written"
