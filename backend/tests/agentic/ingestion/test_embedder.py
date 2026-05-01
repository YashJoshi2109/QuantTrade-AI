"""Tests for the Titan Embeddings v2 batch embedder."""
import asyncio
import pytest
from unittest.mock import patch, MagicMock
from app.services.agentic.ingestion.embedder import embed_chunks_async, BATCH_SIZE
from app.services.agentic.ingestion.chunker import Chunk


def make_chunks(n: int) -> list[Chunk]:
    return [
        Chunk(
            chunk_id=f"chunk-{i}",
            parent_chunk_id=f"parent-{i}",
            text=f"Apple Inc financial risk number {i}",
            token_count=8,
            section="Risk Factors",
            item_number="1A",
            is_parent=False,
            ticker="AAPL",
            company_name="Apple Inc.",
            filing_type="10-K",
            filed_date="2024-11-01",
            fiscal_year=2024,
            cik="0000320193",
        )
        for i in range(n)
    ]


def test_embed_chunks_returns_dict_keyed_by_chunk_id():
    """embed_chunks_async returns {chunk_id: vector} for each chunk."""
    chunks = make_chunks(3)
    fake_vectors = [[0.1] * 1536] * 3

    with patch("app.services.agentic.ingestion.embedder.embed_texts", return_value=fake_vectors), \
         patch("app.services.agentic.ingestion.embedder.chunk_exists", return_value=False):
        result = asyncio.run(embed_chunks_async(chunks))

    assert set(result.keys()) == {c.chunk_id for c in chunks}
    assert all(len(v) == 1536 for v in result.values())


def test_embed_chunks_skips_already_indexed():
    """embed_chunks_async skips chunks whose content_hash exists in Qdrant."""
    chunks = make_chunks(2)

    with patch("app.services.agentic.ingestion.embedder.embed_texts") as mock_embed, \
         patch("app.services.agentic.ingestion.embedder.chunk_exists", return_value=True):
        result = asyncio.run(embed_chunks_async(chunks))

    assert result == {}
    mock_embed.assert_not_called()


def test_embed_chunks_batches_correctly():
    """embed_chunks_async calls embed_texts in batches of BATCH_SIZE."""
    chunks = make_chunks(BATCH_SIZE + 5)
    fake_batch = [[0.1] * 1536] * BATCH_SIZE
    fake_remainder = [[0.2] * 1536] * 5

    call_count = 0
    def mock_embed(texts):
        nonlocal call_count
        call_count += 1
        return fake_batch if len(texts) == BATCH_SIZE else fake_remainder

    with patch("app.services.agentic.ingestion.embedder.embed_texts", side_effect=mock_embed), \
         patch("app.services.agentic.ingestion.embedder.chunk_exists", return_value=False):
        result = asyncio.run(embed_chunks_async(chunks))

    assert call_count == 2
    assert len(result) == BATCH_SIZE + 5
