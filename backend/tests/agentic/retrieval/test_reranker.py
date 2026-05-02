"""Tests for Stage 4: Cohere Reranker."""
import pytest
from unittest.mock import patch

from app.services.agentic.retrieval.hybrid_search import SearchResult


def _make_result(cid: str, text: str, score: float = 0.5) -> SearchResult:
    return SearchResult(
        chunk_id=cid, parent_chunk_id="p1", text=text, score=score,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024,
        section="Risk Factors", item_number="1A",
    )


@pytest.mark.asyncio
async def test_rerank_results_returns_top_n():
    """rerank_results() returns at most top_n SearchResults."""
    results = [_make_result(f"c{i}", f"text {i}") for i in range(5)]

    with patch("app.services.agentic.retrieval.reranker.rerank") as mock_rerank:
        mock_rerank.return_value = [
            {"index": 2, "score": 0.95},
            {"index": 0, "score": 0.88},
            {"index": 4, "score": 0.72},
        ]

        from app.services.agentic.retrieval.reranker import rerank_results

        reranked = await rerank_results("Apple China risk", results, top_n=3)

    assert len(reranked) == 3


@pytest.mark.asyncio
async def test_rerank_results_score_is_updated():
    """rerank_results() replaces original scores with Cohere relevance scores."""
    results = [_make_result("c0", "text0", score=0.1)]

    with patch("app.services.agentic.retrieval.reranker.rerank") as mock_rerank:
        mock_rerank.return_value = [{"index": 0, "score": 0.92}]

        from app.services.agentic.retrieval.reranker import rerank_results

        reranked = await rerank_results("Apple China risk", results, top_n=1)

    assert reranked[0].score == pytest.approx(0.92)


@pytest.mark.asyncio
async def test_rerank_results_preserves_order_by_score():
    """rerank_results() returns results sorted by descending Cohere score."""
    results = [_make_result(f"c{i}", f"text {i}") for i in range(3)]

    with patch("app.services.agentic.retrieval.reranker.rerank") as mock_rerank:
        mock_rerank.return_value = [
            {"index": 1, "score": 0.95},
            {"index": 0, "score": 0.80},
            {"index": 2, "score": 0.60},
        ]

        from app.services.agentic.retrieval.reranker import rerank_results

        reranked = await rerank_results("query", results, top_n=3)

    assert reranked[0].chunk_id == "c1"
    assert reranked[1].chunk_id == "c0"
    assert reranked[2].chunk_id == "c2"


@pytest.mark.asyncio
async def test_rerank_results_handles_empty_input():
    """rerank_results() returns empty list when given empty input."""
    from app.services.agentic.retrieval.reranker import rerank_results
    result = await rerank_results("query", [], top_n=10)
    assert result == []


@pytest.mark.asyncio
async def test_rerank_results_falls_back_on_cohere_error():
    """rerank_results() returns original results (truncated) on Cohere failure."""
    results = [_make_result(f"c{i}", f"text {i}", score=float(i)) for i in range(5)]

    with patch("app.services.agentic.retrieval.reranker.rerank",
               side_effect=Exception("Cohere API error")):
        from app.services.agentic.retrieval.reranker import rerank_results
        reranked = await rerank_results("query", results, top_n=3)

    assert len(reranked) == 3
