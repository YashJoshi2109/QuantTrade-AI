"""Regression tests for intent classification.

Each test case is a (message, expected_intent) pair covering real-world
phrasing patterns and known-bug examples.
"""

from __future__ import annotations

import pytest

from app.services.copilot.intent_classifier import Intent, IntentClassifier


@pytest.fixture
def classifier():
    return IntentClassifier()


# ── General advice (the original bug) ─────────────────────────────────
GENERAL_ADVICE_CASES = [
    "I have 500 dollar with me which stock do you think i should invest in",
    "I have $500 and I'm a student — which stock for long-term growth?",
    "I'm a beginner, what stock should I buy for growth?",
    "where should I invest with $1000?",
    "how should I invest 2000 dollars?",
    "any good stock picks for long term?",
    "recommend me a stock for dividend income",
    "suggest me something for retirement",
    "which stock do you think i should invest in looking for good amount of growth",
    "I have $100 to invest for long term growth",
]


@pytest.mark.parametrize("message", GENERAL_ADVICE_CASES)
def test_general_advice_detection(classifier, message):
    result = classifier.classify(message, has_resolved_tickers=False)
    assert result.intent == Intent.GENERAL_ADVICE, (
        f"{message!r} should be GENERAL_ADVICE, got {result.intent}"
    )
    assert result.confidence >= 0.6


# ── Stock analysis (legitimate) ──────────────────────────────────────
STOCK_ANALYSIS_CASES = [
    ("Analyze NVDA stock", True),
    ("Deep dive on AAPL fundamentals", True),
    ("What are TSLA's technicals looking like?", True),
    ("Give me the outlook for MSFT", True),
    ("Research AMD valuation", True),
]


@pytest.mark.parametrize("message,has_ticker", STOCK_ANALYSIS_CASES)
def test_stock_analysis(classifier, message, has_ticker):
    result = classifier.classify(message, has_resolved_tickers=has_ticker, num_resolved_tickers=1)
    assert result.intent == Intent.STOCK_ANALYSIS


# ── Comparison ───────────────────────────────────────────────────────
def test_comparison_two_tickers(classifier):
    result = classifier.classify(
        "Compare AAPL vs MSFT",
        has_resolved_tickers=True,
        num_resolved_tickers=2,
    )
    assert result.intent == Intent.COMPARISON


def test_comparison_needs_multiple_tickers(classifier):
    # Only 1 ticker + "vs" keyword → should NOT be comparison
    result = classifier.classify(
        "Is TSLA overvalued?",
        has_resolved_tickers=True,
        num_resolved_tickers=1,
    )
    assert result.intent != Intent.COMPARISON


# ── Screener / Sector / Market Overview ───────────────────────────────
def test_screener(classifier):
    result = classifier.classify("Show me top gainers today")
    assert result.intent == Intent.SCREENER


def test_sector(classifier):
    result = classifier.classify("Which sectors are rotating right now?")
    assert result.intent == Intent.SECTOR


def test_market_overview(classifier):
    result = classifier.classify("How is the market today?")
    assert result.intent == Intent.MARKET_OVERVIEW


# ── Education ─────────────────────────────────────────────────────────
EDUCATION_CASES = [
    "What is a P/E ratio?",
    "Explain dollar-cost averaging",
    "What does EBITDA mean?",
    "How do options work?",
]


@pytest.mark.parametrize("message", EDUCATION_CASES)
def test_education(classifier, message):
    result = classifier.classify(message, has_resolved_tickers=False)
    assert result.intent == Intent.EDUCATION


# ── Portfolio advice ─────────────────────────────────────────────────
PORTFOLIO_CASES = [
    "How should I diversify my portfolio?",
    "My portfolio is down 10%, what should I do?",
    "What asset allocation do you recommend for a 25-year-old?",
    "When should I rebalance?",
]


@pytest.mark.parametrize("message", PORTFOLIO_CASES)
def test_portfolio_advice(classifier, message):
    result = classifier.classify(message, has_resolved_tickers=False)
    assert result.intent == Intent.PORTFOLIO_ADVICE


# ── Greeting ──────────────────────────────────────────────────────────
def test_greeting(classifier):
    for msg in ["hi", "hello", "hey there", "good morning"]:
        result = classifier.classify(msg)
        assert result.intent == Intent.GREETING


# ── Off-topic ─────────────────────────────────────────────────────────
OFF_TOPIC_CASES = [
    "Tell me a joke",
    "What's the weather in LA?",
    "Give me a recipe for pasta",
    "Write a poem about dogs",
]


@pytest.mark.parametrize("message", OFF_TOPIC_CASES)
def test_off_topic(classifier, message):
    result = classifier.classify(message, has_resolved_tickers=False)
    assert result.intent == Intent.OFF_TOPIC


# ── Confidence scoring ───────────────────────────────────────────────
def test_high_confidence_for_clear_general_advice(classifier):
    # Multiple patterns should match → high confidence
    result = classifier.classify(
        "I'm a student with $500, which stock should I pick for long term growth?",
        has_resolved_tickers=False,
    )
    assert result.intent == Intent.GENERAL_ADVICE
    assert result.is_high_confidence()


def test_ambiguous_stock_no_keyword(classifier):
    # Ticker mentioned but no clear analysis verb — medium confidence
    result = classifier.classify(
        "AAPL",
        has_resolved_tickers=True,
        num_resolved_tickers=1,
    )
    assert result.intent == Intent.STOCK_ANALYSIS
    # Medium confidence is expected here
    assert 0.5 <= result.confidence <= 0.95
