"""Tests for the 3-pass document chunker."""
import pytest
from app.services.agentic.ingestion.chunker import (
    detect_section,
    split_into_sentences,
    semantic_chunk,
    build_parent_child_pairs,
    Chunk,
    SEC_SECTION_PATTERNS,
)


def test_detect_section_risk_factors():
    text = "ITEM 1A. RISK FACTORS\nApple faces..."
    section, item = detect_section(text)
    assert section == "Risk Factors"
    assert item == "1A"


def test_detect_section_mda():
    text = "Item 7. Management's Discussion and Analysis"
    section, item = detect_section(text)
    assert section == "MD&A"
    assert item == "7"


def test_detect_section_unknown():
    text = "Some random text with no SEC item header"
    section, item = detect_section(text)
    assert section == "Unknown"
    assert item == ""


def test_split_into_sentences_basic():
    text = "Apple Inc. reported revenue. The company grew 12%. Risks remain."
    sentences = split_into_sentences(text)
    assert len(sentences) >= 2
    assert all(len(s) > 0 for s in sentences)


def test_split_into_sentences_handles_abbreviations():
    """Should not split on 'Inc.' mid-sentence."""
    text = "Apple Inc. is a technology company. It was founded in 1976."
    sentences = split_into_sentences(text)
    assert len(sentences) == 2


def test_semantic_chunk_respects_max_tokens():
    """No chunk should exceed MAX_CHUNK_TOKENS."""
    from app.services.agentic.ingestion.chunker import MAX_CHUNK_TOKENS
    long_text = " ".join(["word"] * 2000)
    chunks = semantic_chunk(long_text, section="Risk Factors", item="1A")
    for c in chunks:
        assert c.token_count <= MAX_CHUNK_TOKENS


def test_semantic_chunk_produces_non_empty_chunks():
    text = (
        "Apple faces supply chain risks in China. "
        "Manufacturing is concentrated in Foxconn facilities. "
        "Geopolitical tensions could disrupt production. "
        "Revenue in Greater China represents 19% of total revenue."
    )
    chunks = semantic_chunk(text, section="Risk Factors", item="1A")
    assert len(chunks) >= 1
    assert all(len(c.text.strip()) > 0 for c in chunks)


def test_semantic_chunk_sets_section_metadata():
    text = "Apple supply chain risk factors are significant."
    chunks = semantic_chunk(text, section="Risk Factors", item="1A")
    assert all(c.section == "Risk Factors" for c in chunks)
    assert all(c.item_number == "1A" for c in chunks)


def test_build_parent_child_pairs_links_correctly():
    """Each child chunk's parent_chunk_id should match its parent's chunk_id."""
    section_text = "Long section text " + " ".join(["word"] * 100)
    child_chunks = semantic_chunk(section_text, section="Business", item="1")

    filing_meta = {
        "ticker": "AAPL",
        "company_name": "Apple Inc.",
        "filing_type": "10-K",
        "filed_date": "2024-11-01",
        "fiscal_year": 2024,
        "cik": "0000320193",
    }

    children, parent = build_parent_child_pairs(child_chunks, section_text, filing_meta)

    assert parent.is_parent is True
    assert all(c.parent_chunk_id == parent.chunk_id for c in children)
    assert all(c.ticker == "AAPL" for c in children)


def test_chunk_content_hash_deterministic():
    """Same text produces same content_hash."""
    c1 = Chunk(
        chunk_id="id1", parent_chunk_id="pid", text="hello world",
        token_count=2, section="S", item_number="1", is_parent=False,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-01-01", fiscal_year=2024, cik="123",
    )
    c2 = Chunk(
        chunk_id="id2", parent_chunk_id="pid", text="hello world",
        token_count=2, section="S", item_number="1", is_parent=False,
        ticker="MSFT", company_name="Microsoft", filing_type="10-K",
        filed_date="2024-01-01", fiscal_year=2024, cik="456",
    )
    assert c1.content_hash == c2.content_hash  # hash is text-only
