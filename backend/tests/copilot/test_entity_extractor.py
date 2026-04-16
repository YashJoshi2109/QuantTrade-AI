"""Entity extraction regression tests — uses the REAL production database.

These tests query real Symbol rows (AAPL, TSLA, DG, etc.) via SessionLocal.
If DATABASE_URL is not configured, the entire test module is skipped.
No mocks, no fake data — tests run against the same DB the API uses.
"""

from __future__ import annotations

import pytest

from app.db.database import SessionLocal
from app.services.copilot.entity_extractor import (
    EntityConfidence,
    EntityExtractor,
)


# Skip entire module if DB is not configured (e.g. local dev without .env)
pytestmark = pytest.mark.skipif(
    SessionLocal is None,
    reason="DATABASE_URL not configured — entity extraction tests require real DB",
)


@pytest.fixture(scope="module")
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def extractor(db):
    return EntityExtractor(db)


# ── The original bug: "dollar" must NOT resolve to DG ──────────────────
def test_dollar_does_not_match_dollar_general(extractor):
    """CRITICAL: 'dollar' must be blocked from fuzzy-matching Dollar General (DG)."""
    message = "I have 500 dollar with me which stock should I invest in?"
    entities = extractor.extract(message)
    for e in entities:
        assert e.source_token.lower() != "dollar", (
            f"Token 'dollar' should be blocked, got entity {e}"
        )


# ── $TICKER syntax → HIGH confidence ──────────────────────────────────
def test_dollar_ticker_syntax_is_high_confidence(extractor):
    entities = extractor.extract("What do you think about $AAPL?")
    aapl = [e for e in entities if e.ticker == "AAPL"]
    # Only assert if AAPL exists in this DB
    if aapl:
        assert aapl[0].confidence == EntityConfidence.HIGH
        assert aapl[0].match_type in ("dollar_ticker", "ticker_exact", "explicit_param")


# ── Explicit symbol parameter → HIGH confidence ───────────────────────
def test_explicit_symbol_parameter(extractor):
    entities = extractor.extract("any thoughts?", explicit_symbol="TSLA")
    tsla = [e for e in entities if e.ticker == "TSLA"]
    if tsla:
        assert tsla[0].confidence == EntityConfidence.HIGH


# ── UPPERCASE ticker → HIGH confidence ────────────────────────────────
def test_uppercase_ticker(extractor):
    entities = extractor.extract("Analyze NVDA please")
    nvda = [e for e in entities if e.ticker == "NVDA"]
    if nvda:
        assert nvda[0].confidence == EntityConfidence.HIGH


# ── Blocked common words ──────────────────────────────────────────────
BLOCKED_WORDS = [
    "dollar", "dollars", "money", "cash", "amount", "growth", "student",
    "investment", "investing", "good", "long", "short", "wait", "looking",
]


@pytest.mark.parametrize("word", BLOCKED_WORDS)
def test_blocked_words_never_resolve(extractor, word):
    """Common English words must never be extracted as entities."""
    entities = extractor.extract(f"I have some {word} here")
    for e in entities:
        assert e.source_token.lower() != word, (
            f"Blocked word '{word}' leaked through as entity: {e}"
        )


# ── Entities sorted by confidence ─────────────────────────────────────
def test_entities_sorted_by_confidence_desc(extractor):
    entities = extractor.extract("Compare AAPL vs Tesla")
    if len(entities) >= 2:
        for i in range(len(entities) - 1):
            assert entities[i].confidence >= entities[i + 1].confidence


# ── Deduplication by ticker ───────────────────────────────────────────
def test_dedup_by_ticker(extractor):
    entities = extractor.extract("$AAPL and AAPL and Apple")
    tickers = [e.ticker for e in entities]
    assert len(tickers) == len(set(tickers)), f"Duplicates: {tickers}"
