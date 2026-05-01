"""
Integration test for the full ingestion pipeline.
Uses a small synthetic SEC filing — no real network calls.
"""
import asyncio
import pytest
from unittest.mock import patch, MagicMock

SAMPLE_10K_TEXT = """
ITEM 1. BUSINESS

Apple Inc. designs, manufactures, and markets smartphones, personal computers,
tablets, wearables, and accessories. The Company also sells various related
services. The Company's products include iPhone, Mac, iPad, and Wearables.

ITEM 1A. RISK FACTORS

The Company faces significant risks related to global supply chains.
Manufacturing is concentrated in China through third-party manufacturers.
Geopolitical tensions between the United States and China could adversely
affect the Company's ability to produce and sell products in China.
Revenue from Greater China represented approximately 19% of total net sales.

ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS

Net sales for fiscal 2024 were $391.0 billion, an increase of 2% year over year.
iPhone net sales increased 6% year over year to $201.2 billion.
Services net sales set an all-time record of $96.2 billion.
"""

SAMPLE_META = {
    "ticker":       "AAPL",
    "company_name": "Apple Inc.",
    "filing_type":  "10-K",
    "filed_date":   "2024-11-01",
    "fiscal_year":  2024,
    "cik":          "0000320193",
}


def test_chunk_filing_produces_children_and_parents():
    """chunk_filing() produces both child and parent chunks from sample 10-K."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    children, parents = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)

    assert len(children) >= 2
    assert len(parents) >= 2
    assert all(not c.is_parent for c in children)
    assert all(p.is_parent for p in parents)
    assert all(c.ticker == "AAPL" for c in children)
    assert all(p.ticker == "AAPL" for p in parents)
    assert all(c.parent_chunk_id != "" for c in children)


def test_full_pipeline_end_to_end():
    """Full pipeline: chunk -> embed -> upsert (all external calls mocked)."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    from app.services.agentic.ingestion.embedder import embed_chunks_async
    from app.services.agentic.ingestion.indexer import upsert_chunks

    children, parents = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)
    assert len(children) > 0

    # Build a side_effect that always returns one vector per text in the batch,
    # regardless of how many children the chunker produces.
    def fake_embed_texts(texts):
        return [[0.1] * 1536] * len(texts)

    with patch("app.services.agentic.ingestion.embedder.embed_texts",
               side_effect=fake_embed_texts), \
         patch("app.services.agentic.ingestion.embedder.chunk_exists",
               return_value=False), \
         patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_q:

        vectors = asyncio.run(embed_chunks_async(children))
        assert len(vectors) == len(children)
        assert all(len(v) == 1536 for v in vectors.values())

        upsert_chunks(children, parents, vectors)
        assert mock_q.return_value.upsert.call_count == 2  # children + parents


def test_risk_factors_section_detected():
    """Risk Factors section is detected and chunked separately."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    children, _ = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)
    sections = {c.section for c in children}
    assert "Risk Factors" in sections


def test_mda_section_detected():
    """MD&A section is detected and chunked separately."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    children, _ = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)
    sections = {c.section for c in children}
    assert "MD&A" in sections
