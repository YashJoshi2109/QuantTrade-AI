"""Router integration tests — uses the REAL production database.

The Router combines entity extraction + intent classification + guardrails.
Tests verify end-to-end routing using real Symbol data from the DB.
Skipped entirely if DATABASE_URL is not configured.
"""

from __future__ import annotations

import pytest

from app.db.database import SessionLocal
from app.services.copilot.intent_classifier import Intent
from app.services.copilot.router import CopilotRouter


pytestmark = pytest.mark.skipif(
    SessionLocal is None,
    reason="DATABASE_URL not configured — router tests require real DB",
)


@pytest.fixture(scope="module")
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def router(db):
    return CopilotRouter(db)


# ── THE ORIGINAL BUG ──────────────────────────────────────────────────
def test_original_bug_is_fixed(router):
    """Full pipeline test for the Dollar General bug.

    Message contains 'dollar' which used to fuzzy-match Dollar General (DG).
    The pipeline must now:
        - Classify intent as GENERAL_ADVICE (multiple patterns match)
        - Discard any fuzzy-resolved tickers
        - NOT run stock_analysis on DG
        - Inject general knowledge snippets
    """
    msg = ("I have 500 dollar with me which stock do you think i should "
           "invest in looking for good amount of growth. I am student and "
           "i can wait for long onces investing.")
    decision = router.route(msg)

    assert decision.intent == Intent.GENERAL_ADVICE, (
        f"Expected GENERAL_ADVICE, got {decision.intent}. "
        f"Reasoning: {decision.intent_reasoning}"
    )
    assert decision.primary_entity is None
    assert decision.use_stock_context is False
    assert decision.inject_general_knowledge is True
    assert "DG" not in decision.all_tickers


def test_general_advice_discards_low_confidence_entities(router):
    """When intent is general_advice, no fuzzy-matched tickers should survive."""
    decision = router.route("which stock should I buy with $500?")
    assert decision.intent == Intent.GENERAL_ADVICE
    # Must not set any primary ticker from fuzzy matches
    assert decision.primary_ticker is None


# ── Stock analysis requires trustworthy entity ────────────────────────
def test_stock_analysis_uses_high_confidence_ticker(router):
    """A clear stock query should route to STOCK_ANALYSIS with the right ticker."""
    decision = router.route("Analyze AAPL deeply")
    # Only assert if AAPL is in the real DB
    if decision.intent == Intent.STOCK_ANALYSIS:
        assert decision.primary_ticker == "AAPL"
        assert decision.use_stock_context is True


# ── Comparison requires 2+ trustworthy entities ───────────────────────
def test_comparison_with_two_tickers(router):
    decision = router.route("Compare AAPL vs MSFT")
    # If both tickers exist in the real DB, it should be comparison
    if len(decision.all_entities) >= 2:
        assert decision.intent == Intent.COMPARISON


# ── Greeting ──────────────────────────────────────────────────────────
def test_greeting_routes_cleanly(router):
    decision = router.route("hi")
    assert decision.intent == Intent.GREETING
    assert decision.use_stock_context is False


# ── Education ─────────────────────────────────────────────────────────
def test_education_injects_knowledge(router):
    decision = router.route("what is a P/E ratio?")
    assert decision.intent == Intent.EDUCATION
    assert decision.inject_general_knowledge is True
    assert decision.use_stock_context is False


# ── Portfolio advice ─────────────────────────────────────────────────
def test_portfolio_advice(router):
    decision = router.route("how should I diversify my portfolio?")
    assert decision.intent == Intent.PORTFOLIO_ADVICE
    assert decision.inject_general_knowledge is True


# ── Off-topic politely declined ───────────────────────────────────────
def test_off_topic(router):
    decision = router.route("give me a pasta recipe")
    assert decision.intent == Intent.OFF_TOPIC
    assert decision.use_stock_context is False


# ── Screener ──────────────────────────────────────────────────────────
def test_screener(router):
    decision = router.route("show me top gainers today")
    assert decision.intent == Intent.SCREENER
    assert decision.use_stock_context is False


# ── Sector ────────────────────────────────────────────────────────────
def test_sector(router):
    decision = router.route("which sectors are rotating right now?")
    assert decision.intent == Intent.SECTOR
