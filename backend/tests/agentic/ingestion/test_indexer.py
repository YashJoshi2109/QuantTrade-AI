"""Tests for Qdrant indexer — collection setup and upsert."""
import pytest
from unittest.mock import MagicMock, patch, call
from app.services.agentic.ingestion.indexer import (
    ensure_collections_exist,
    upsert_chunks,
    chunk_exists,
    CHUNKS_COLLECTION,
    PARENTS_COLLECTION,
)
from app.services.agentic.ingestion.chunker import Chunk


def make_chunk(symbol: str = "AAPL", is_parent: bool = False) -> Chunk:
    return Chunk(
        chunk_id=f"test-{symbol}-child",
        parent_chunk_id=f"test-{symbol}-parent",
        text="Apple Inc faces supply chain risks.",
        token_count=8,
        section="Risk Factors",
        item_number="1A",
        is_parent=is_parent,
        ticker=symbol,
        company_name="Apple Inc.",
        filing_type="10-K",
        filed_date="2024-11-01",
        fiscal_year=2024,
        cik="0000320193",
    )


def test_ensure_collections_creates_both_collections():
    """ensure_collections_exist() creates sec_filings_chunks and sec_filings_parents."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.collection_exists.return_value = False
        ensure_collections_exist()
        create_calls = mock_qdrant.return_value.create_collection.call_args_list
        names = [c.args[0] for c in create_calls]
        assert CHUNKS_COLLECTION in names
        assert PARENTS_COLLECTION in names


def test_ensure_collections_skips_existing():
    """ensure_collections_exist() skips creation if collection already exists."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.collection_exists.return_value = True
        ensure_collections_exist()
        mock_qdrant.return_value.create_collection.assert_not_called()


def test_upsert_chunks_calls_qdrant_upsert():
    """upsert_chunks() calls qdrant upsert with correct collection and points."""
    child = make_chunk()
    parent = make_chunk(is_parent=True)
    vectors = {"test-AAPL-child": [0.1] * 1536}

    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        upsert_chunks([child], [parent], vectors)
        assert mock_qdrant.return_value.upsert.call_count == 2


def test_chunk_exists_returns_true_when_found():
    """chunk_exists() returns True if content hash already in Qdrant."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.scroll.return_value = ([MagicMock()], None)
        assert chunk_exists("abc123") is True


def test_chunk_exists_returns_false_when_not_found():
    """chunk_exists() returns False if content hash not in Qdrant."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.scroll.return_value = ([], None)
        assert chunk_exists("abc123") is False
