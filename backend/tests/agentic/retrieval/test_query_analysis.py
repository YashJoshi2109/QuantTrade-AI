"""Tests for Stage 1: Query Analysis."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_analyze_query_extracts_ticker_and_section():
    """analyze_query() returns QueryAnalysisResult with tickers and sections."""
    llm_json = """{
        "tickers": ["AAPL"],
        "filing_types": ["10-K"],
        "sections": ["Risk Factors"],
        "date_from": "2023-01-01",
        "query_variants": [
            "Apple supply chain risk",
            "AAPL China manufacturing dependency",
            "Apple geographic revenue concentration"
        ]
    }"""
    mock_response = MagicMock()
    mock_response.content = llm_json

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("What are Apple's biggest risks in China?")

    assert result.tickers == ["AAPL"]
    assert "Risk Factors" in result.sections
    assert len(result.query_variants) == 3
    assert result.date_from == "2023-01-01"
    assert result.original_query == "What are Apple's biggest risks in China?"


@pytest.mark.asyncio
async def test_analyze_query_json_in_markdown_fence():
    """analyze_query() parses JSON even when wrapped in ```json fence."""
    llm_json = '```json\n{"tickers": ["MSFT"], "filing_types": ["10-Q"], "sections": ["MD&A"], "date_from": null, "query_variants": ["Microsoft cloud revenue", "Azure growth"]}\n```'
    mock_response = MagicMock()
    mock_response.content = llm_json

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("How is Microsoft cloud revenue growing?")

    assert result.tickers == ["MSFT"]
    assert result.date_from is None


@pytest.mark.asyncio
async def test_analyze_query_fallback_on_bad_json():
    """analyze_query() returns fallback with original query when JSON is malformed."""
    mock_response = MagicMock()
    mock_response.content = "Sorry, I cannot answer that."

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("some query")

    assert result.original_query == "some query"
    assert result.query_variants == ["some query"]
    assert result.tickers == []


@pytest.mark.asyncio
async def test_analyze_query_accepts_tickers_hint():
    """analyze_query() merges tickers_hint into result when provided."""
    llm_json = '{"tickers": [], "filing_types": ["10-K"], "sections": [], "date_from": null, "query_variants": ["risk analysis"]}'
    mock_response = MagicMock()
    mock_response.content = llm_json

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("risk analysis", tickers_hint=["NVDA"])

    assert "NVDA" in result.tickers
