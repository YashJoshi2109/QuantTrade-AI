"""Tests for the public search_sec_filings RAG tool."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.retrieval.query_analysis import QueryAnalysisResult
from app.services.agentic.retrieval.hybrid_search import SearchResult
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_qr() -> QueryAnalysisResult:
    return QueryAnalysisResult(
        tickers=["AAPL"], filing_types=["10-K"], sections=["Risk Factors"],
        date_from=None,
        query_variants=["Apple China risk", "AAPL supply chain"],
        original_query="Apple China risk",
    )


def _make_search_result(cid: str = "c1") -> SearchResult:
    return SearchResult(
        chunk_id=cid, parent_chunk_id="p1", text="text", score=0.9,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024,
        section="Risk Factors", item_number="1A",
    )


def _make_cwc() -> ChunkWithCitation:
    return ChunkWithCitation(
        text="Full parent section text about Apple supply chain risks in China.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple Inc.", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=0.92,
    )


@pytest.mark.asyncio
async def test_search_sec_filings_calls_all_5_stages():
    """search_sec_filings() invokes all 5 pipeline stages in order."""
    qr  = _make_qr()
    sr  = [_make_search_result()]
    cwc = [_make_cwc()]

    with patch("app.services.agentic.tools.rag_tool.analyze_query",
               new_callable=AsyncMock, return_value=qr) as mock_s1, \
         patch("app.services.agentic.tools.rag_tool.get_hyde_embedding",
               new_callable=AsyncMock, return_value=[0.1] * 1536) as mock_s2, \
         patch("app.services.agentic.tools.rag_tool.hybrid_search",
               new_callable=AsyncMock, return_value=sr) as mock_s3, \
         patch("app.services.agentic.tools.rag_tool.rerank_results",
               new_callable=AsyncMock, return_value=sr) as mock_s4, \
         patch("app.services.agentic.tools.rag_tool.expand_to_parents",
               new_callable=AsyncMock, return_value=cwc) as mock_s5:

        from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

        result = await _search_sec_filings_impl(
            query="Apple China risk",
            tickers=["AAPL"],
        )

    mock_s1.assert_awaited_once()
    mock_s2.assert_awaited_once()
    mock_s3.assert_awaited_once()
    mock_s4.assert_awaited_once()
    mock_s5.assert_awaited_once()


@pytest.mark.asyncio
async def test_search_sec_filings_returns_chunk_with_citations():
    """search_sec_filings() returns list of ChunkWithCitation."""
    qr  = _make_qr()
    sr  = [_make_search_result()]
    cwc = [_make_cwc()]

    with patch("app.services.agentic.tools.rag_tool.analyze_query",
               new_callable=AsyncMock, return_value=qr), \
         patch("app.services.agentic.tools.rag_tool.get_hyde_embedding",
               new_callable=AsyncMock, return_value=None), \
         patch("app.services.agentic.tools.rag_tool.hybrid_search",
               new_callable=AsyncMock, return_value=sr), \
         patch("app.services.agentic.tools.rag_tool.rerank_results",
               new_callable=AsyncMock, return_value=sr), \
         patch("app.services.agentic.tools.rag_tool.expand_to_parents",
               new_callable=AsyncMock, return_value=cwc):

        from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

        result = await _search_sec_filings_impl(query="Apple China risk")

    assert len(result) == 1
    assert result[0].citation_label.startswith("[Source 1:")


@pytest.mark.asyncio
async def test_search_sec_filings_returns_empty_on_no_results():
    """search_sec_filings() returns [] when hybrid_search finds nothing."""
    qr = _make_qr()

    with patch("app.services.agentic.tools.rag_tool.analyze_query",
               new_callable=AsyncMock, return_value=qr), \
         patch("app.services.agentic.tools.rag_tool.get_hyde_embedding",
               new_callable=AsyncMock, return_value=None), \
         patch("app.services.agentic.tools.rag_tool.hybrid_search",
               new_callable=AsyncMock, return_value=[]), \
         patch("app.services.agentic.tools.rag_tool.rerank_results",
               new_callable=AsyncMock, return_value=[]), \
         patch("app.services.agentic.tools.rag_tool.expand_to_parents",
               new_callable=AsyncMock, return_value=[]):

        from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

        result = await _search_sec_filings_impl(query="obscure query")

    assert result == []
