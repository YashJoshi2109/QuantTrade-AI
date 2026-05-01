"""Integration test: full 5-stage retrieval pipeline with all external calls mocked."""
import asyncio
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

AAPL_CHUNK_ID    = "aapl-risk-child-001"
AAPL_PARENT_ID   = "aapl-risk-parent-001"
AAPL_PARENT_TEXT = (
    "Apple Inc. (AAPL) faces significant geographic concentration risk with China "
    "representing approximately 19% of net sales. The company's primary manufacturing "
    "partner, Foxconn, operates its largest assembly facility in Zhengzhou, China. "
    "Disruptions to these operations could materially affect production capacity."
)

HAIKU_QA_JSON = """{
    "tickers": ["AAPL"],
    "filing_types": ["10-K"],
    "sections": ["Risk Factors"],
    "date_from": "2023-01-01",
    "query_variants": [
        "Apple China supply chain risk",
        "AAPL geographic revenue concentration",
        "Apple Foxconn manufacturing dependency"
    ]
}"""

HAIKU_HYDE_TEXT = (
    "Apple faces concentrated China manufacturing risk. Approximately 19% of net sales "
    "originate from Greater China. Primary supplier Foxconn's Zhengzhou plant produces "
    "an estimated 85% of global iPhone volume."
)


def _make_qdrant_point(chunk_id: str, parent_id: str, score: float = 0.85) -> MagicMock:
    p = MagicMock()
    p.id = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_id))
    p.score = score
    p.payload = {
        "chunk_id":        chunk_id,
        "parent_chunk_id": parent_id,
        "text":            "Child chunk: Apple faces China manufacturing risk.",
        "ticker":          "AAPL",
        "company_name":    "Apple Inc.",
        "filing_type":     "10-K",
        "filed_date":      "2024-11-01",
        "fiscal_year":     2024,
        "section":         "Risk Factors",
        "item_number":     "1A",
    }
    return p


def _make_parent_record(parent_id: str, text: str) -> MagicMock:
    rec = MagicMock()
    rec.id = str(uuid.uuid5(uuid.NAMESPACE_DNS, parent_id))
    rec.payload = {
        "chunk_id":   parent_id,
        "text":       text,
        "ticker":     "AAPL",
        "section":    "Risk Factors",
        "filed_date": "2024-11-01",
    }
    return rec


@pytest.mark.asyncio
async def test_full_retrieval_pipeline_end_to_end():
    """Complete pipeline: query string -> ChunkWithCitation with correct text + citation."""
    qa_response   = MagicMock(); qa_response.content   = HAIKU_QA_JSON
    hyde_response = MagicMock(); hyde_response.content = HAIKU_HYDE_TEXT

    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=[qa_response, hyde_response])

    qdrant_point  = _make_qdrant_point(AAPL_CHUNK_ID, AAPL_PARENT_ID)
    search_resp   = MagicMock(); search_resp.points = [qdrant_point]
    parent_record = _make_parent_record(AAPL_PARENT_ID, AAPL_PARENT_TEXT)

    mock_client = MagicMock()
    mock_client.query_points.return_value = search_resp
    mock_client.retrieve.return_value     = [parent_record]

    cohere_result = [{"index": 0, "score": 0.95}]

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hyde.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hybrid_search._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.parent_child._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0, 3], values=[0.9, 0.5])]), \
         patch("app.services.agentic.retrieval.reranker.rerank",
               return_value=cohere_result):

        from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

        results = await _search_sec_filings_impl(
            query="What are Apple's biggest risks from China manufacturing?",
            tickers=["AAPL"],
        )

    assert len(results) >= 1
    top = results[0]
    assert top.text == AAPL_PARENT_TEXT
    assert "AAPL" in top.citation_label
    assert "10-K" in top.citation_label
    assert "Risk Factors" in top.citation_label
    assert top.score == pytest.approx(0.95)


@pytest.mark.asyncio
async def test_pipeline_graceful_on_haiku_failure():
    """Pipeline completes even when Haiku fails — fallback analysis still allows search."""
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=Exception("Bedrock throttled"))

    qdrant_point = _make_qdrant_point(AAPL_CHUNK_ID, AAPL_PARENT_ID)
    search_resp  = MagicMock(); search_resp.points = [qdrant_point]
    parent_rec   = _make_parent_record(AAPL_PARENT_ID, AAPL_PARENT_TEXT)

    mock_client = MagicMock()
    mock_client.query_points.return_value = search_resp
    mock_client.retrieve.return_value     = [parent_rec]

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hyde.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hybrid_search._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.parent_child._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0], values=[0.8])]), \
         patch("app.services.agentic.retrieval.reranker.rerank",
               return_value=[{"index": 0, "score": 0.80}]):

        from app.services.agentic.tools.rag_tool import _search_sec_filings_impl

        results = await _search_sec_filings_impl(
            query="Apple China risk",
            tickers=["AAPL"],
        )

    assert isinstance(results, list)
