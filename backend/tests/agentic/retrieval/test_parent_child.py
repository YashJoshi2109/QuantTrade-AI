"""Tests for Stage 5: Parent-Child Expansion."""
import pytest
import uuid
from unittest.mock import MagicMock, patch

from app.services.agentic.retrieval.hybrid_search import SearchResult


def _make_result(
    chunk_id: str = "child-001",
    parent_chunk_id: str = "parent-001",
    ticker: str = "AAPL",
    filed_date: str = "2024-11-01",
    fiscal_year: int = 2024,
    section: str = "Risk Factors",
) -> SearchResult:
    return SearchResult(
        chunk_id=chunk_id, parent_chunk_id=parent_chunk_id,
        text="Child text about supply chain.",
        score=0.92,
        ticker=ticker, company_name="Apple Inc.", filing_type="10-K",
        filed_date=filed_date, fiscal_year=fiscal_year,
        section=section, item_number="1A",
    )


def _make_parent_record(chunk_id: str, text: str, ticker: str = "AAPL") -> MagicMock:
    parent_qdrant_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_id))
    rec = MagicMock()
    rec.id = parent_qdrant_id
    rec.payload = {
        "chunk_id":   chunk_id,
        "text":       text,
        "ticker":     ticker,
        "section":    "Risk Factors",
        "filed_date": "2024-11-01",
    }
    return rec


@pytest.mark.asyncio
async def test_expand_to_parents_fetches_parent_text():
    """expand_to_parents() returns parent section text, not child snippet text."""
    child = _make_result()
    parent_text = "Full parent section: Apple faces concentrated supply chain risks. " * 10

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = [
            _make_parent_record("parent-001", parent_text)
        ]

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child])

    assert len(chunks) == 1
    assert chunks[0].text == parent_text


@pytest.mark.asyncio
async def test_expand_to_parents_citation_format():
    """expand_to_parents() attaches correctly formatted citation label."""
    child = _make_result(ticker="AAPL", filed_date="2024-11-01", section="Risk Factors")

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = [
            _make_parent_record("parent-001", "Parent text.")
        ]

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child])

    label = chunks[0].citation_label
    assert "AAPL" in label
    assert "10-K" in label
    assert "2024" in label
    assert "Risk Factors" in label
    assert "2024-11-01" in label


@pytest.mark.asyncio
async def test_expand_to_parents_falls_back_to_child_text():
    """expand_to_parents() uses child text when parent not found in Qdrant."""
    child = _make_result()

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = []

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child])

    assert len(chunks) == 1
    assert chunks[0].text == child.text


@pytest.mark.asyncio
async def test_expand_to_parents_deduplicates_parent_id():
    """expand_to_parents() fetches each unique parent once even if multiple children share it."""
    child1 = _make_result("child-001", "parent-001")
    child2 = _make_result("child-002", "parent-001")

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = [
            _make_parent_record("parent-001", "Shared parent text.")
        ]

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child1, child2])

    assert mock_qd.return_value.retrieve.call_count == 1
    assert len(chunks) == 2
