"""Tests for token-budgeted context builder."""
import pytest
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_chunk(source_n: int, text: str = "x" * 200, score: float = 0.9) -> ChunkWithCitation:
    return ChunkWithCitation(
        text=text,
        citation_label=f"[Source {source_n}: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple Inc.", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=score,
    )


def test_build_context_includes_citations():
    """build_context() includes citation labels in output."""
    from app.services.agentic.context_builder import build_context
    chunks = [_make_chunk(1), _make_chunk(2)]
    ctx = build_context(chunks=chunks, live_data={}, history="")
    assert "[Source 1:" in ctx
    assert "[Source 2:" in ctx


def test_build_context_includes_live_data():
    """build_context() includes live market data section when provided."""
    from app.services.agentic.context_builder import build_context
    live = {"AAPL": {"price": 185.5, "change_pct": 1.2}}
    ctx = build_context(chunks=[], live_data=live, history="")
    assert "AAPL" in ctx
    assert "185.5" in ctx


def test_build_context_respects_token_budget():
    """build_context() truncates chunks to fit within token budget."""
    from app.services.agentic.context_builder import build_context, CHUNK_TOKEN_BUDGET
    # Create chunks that together exceed the budget
    big_text = "word " * 2000  # ~2000 tokens
    chunks = [_make_chunk(i, text=big_text) for i in range(1, 8)]
    ctx = build_context(chunks=chunks, live_data={}, history="")
    # Result should be within budget (approximate token count)
    approx_tokens = len(ctx.split()) * 1.3
    assert approx_tokens <= CHUNK_TOKEN_BUDGET * 1.2  # allow 20% overage for formatting


def test_build_context_includes_history():
    """build_context() appends conversation history when provided."""
    from app.services.agentic.context_builder import build_context
    history = "USER: What about AAPL risk?\nASSISTANT: Here is the analysis..."
    ctx = build_context(chunks=[], live_data={}, history=history)
    assert "AAPL risk" in ctx


def test_count_tokens_approximation():
    """count_tokens() returns reasonable approximation."""
    from app.services.agentic.context_builder import count_tokens
    text = "hello world " * 100  # 200 words
    tokens = count_tokens(text)
    # Should be roughly 200 * 1.3 = 260 tokens
    assert 200 <= tokens <= 350
