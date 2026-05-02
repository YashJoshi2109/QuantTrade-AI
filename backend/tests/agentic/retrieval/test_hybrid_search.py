"""Tests for Stage 3: Hybrid Search + RRF Fusion."""
import pytest
from unittest.mock import MagicMock, patch

from app.services.agentic.retrieval.query_analysis import QueryAnalysisResult


def _make_qr(
    tickers=None, sections=None, query_variants=None, date_from=None
) -> QueryAnalysisResult:
    return QueryAnalysisResult(
        tickers=tickers or ["AAPL"],
        filing_types=["10-K"],
        sections=sections or ["Risk Factors"],
        date_from=date_from,
        query_variants=query_variants or ["Apple supply chain risk"],
        original_query="Apple supply chain risk",
    )


def _make_scored_point(chunk_id: str, score: float, parent_id: str = "parent-1") -> MagicMock:
    p = MagicMock()
    p.id = chunk_id
    p.score = score
    p.payload = {
        "chunk_id":        chunk_id,
        "parent_chunk_id": parent_id,
        "text":            f"Text for {chunk_id}",
        "ticker":          "AAPL",
        "company_name":    "Apple Inc.",
        "filing_type":     "10-K",
        "filed_date":      "2024-11-01",
        "fiscal_year":     2024,
        "section":         "Risk Factors",
        "item_number":     "1A",
    }
    return p


def test_rrf_fusion_merges_and_deduplicates():
    """rrf_fusion() combines two ranked lists, deduplicates by chunk_id, returns by score."""
    from app.services.agentic.retrieval.hybrid_search import SearchResult, rrf_fusion

    r_a = SearchResult(
        chunk_id="c1", parent_chunk_id="p1", text="text1", score=0.9,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", item_number="1A",
    )
    r_b = SearchResult(
        chunk_id="c2", parent_chunk_id="p1", text="text2", score=0.8,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", item_number="1A",
    )
    merged = rrf_fusion([[r_a, r_b], [r_b, r_a]])
    ids = [r.chunk_id for r in merged]
    assert ids.count("c1") == 1
    assert ids.count("c2") == 1


def test_rrf_fusion_top_ranked_chunk_has_higher_score():
    """rrf_fusion() assigns higher score to chunk ranked first in more lists."""
    from app.services.agentic.retrieval.hybrid_search import SearchResult, rrf_fusion

    def _r(cid: str) -> SearchResult:
        return SearchResult(
            chunk_id=cid, parent_chunk_id="p", text="t", score=0.5,
            ticker="AAPL", company_name="Apple", filing_type="10-K",
            filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", item_number="1A",
        )

    merged = rrf_fusion([[_r("c1"), _r("c2")], [_r("c1"), _r("c2")]])
    assert merged[0].chunk_id == "c1"
    assert merged[0].score > merged[1].score


@pytest.mark.asyncio
async def test_hybrid_search_calls_qdrant_three_times():
    """hybrid_search() fires dense + sparse + section-targeted queries per variant."""
    qr = _make_qr()

    mock_point = _make_scored_point("c1", 0.9)
    mock_response = MagicMock()
    mock_response.points = [mock_point]

    with patch("app.services.agentic.retrieval.hybrid_search._qdrant_client") as mock_qd, \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0], values=[0.9])]):
        mock_qd.return_value.query_points.return_value = mock_response

        from app.services.agentic.retrieval.hybrid_search import hybrid_search

        results = await hybrid_search(qr, hyde_embedding=None, top_k=50)

    num_variants = len(qr.query_variants)
    assert mock_qd.return_value.query_points.call_count == 3 * num_variants


@pytest.mark.asyncio
async def test_hybrid_search_returns_search_results():
    """hybrid_search() returns list[SearchResult] with required fields."""
    qr = _make_qr()

    mock_point = _make_scored_point("c1", 0.9)
    mock_response = MagicMock()
    mock_response.points = [mock_point]

    with patch("app.services.agentic.retrieval.hybrid_search._qdrant_client") as mock_qd, \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0], values=[0.9])]):
        mock_qd.return_value.query_points.return_value = mock_response

        from app.services.agentic.retrieval.hybrid_search import SearchResult, hybrid_search

        results = await hybrid_search(qr, hyde_embedding=None)

    assert len(results) > 0
    assert isinstance(results[0], SearchResult)
    assert results[0].chunk_id == "c1"
    assert results[0].ticker == "AAPL"
