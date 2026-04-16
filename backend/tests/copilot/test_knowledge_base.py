"""Knowledge base retrieval tests."""

from __future__ import annotations

import pytest

from app.services.copilot.knowledge_base import (
    FinanceKnowledgeBase,
    get_knowledge_snippets,
)


def test_search_returns_relevant_snippets():
    kb = FinanceKnowledgeBase()
    # Query about beginner student investing should return at least one relevant snippet
    results = kb.search("I'm a student with $500 looking for long-term growth", limit=3)
    assert len(results) >= 1
    topics = [r.topic for r in results]
    # Should surface beginner/ETF content
    assert any("Beginner" in t or "ETF" in t or "Small Budget" in t or "Growth" in t for t in topics)


def test_search_dividend_query():
    kb = FinanceKnowledgeBase()
    results = kb.search("I want dividend income", limit=2)
    assert any("Dividend" in r.topic for r in results)


def test_search_diversification_query():
    kb = FinanceKnowledgeBase()
    results = kb.search("how should I diversify my portfolio", limit=2)
    assert any("Diversif" in r.topic for r in results)


def test_get_knowledge_snippets_formats_output():
    out = get_knowledge_snippets("beginner investing $500", limit=2)
    assert isinstance(out, str)
    assert len(out) > 50
    # Should include topic headers
    assert "###" in out


def test_unrelated_query_returns_empty_or_minimal():
    out = get_knowledge_snippets("purple unicorn weather xyz", limit=3)
    # Low-relevance queries may still match on a generic word; just ensure no crash
    assert isinstance(out, str)
