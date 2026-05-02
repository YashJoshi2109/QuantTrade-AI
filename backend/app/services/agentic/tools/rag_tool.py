"""RAG Tool — search_sec_filings.

Public LangChain @tool that composes the 5-stage retrieval pipeline.
Called by LangGraph agents (Research, Comparison, Earnings, General, etc.).

Stages:
  1. Query Analysis  — Claude Haiku, multi-query expansion
  2. HyDE            — hypothetical doc embedding (parallel with Stage 1)
  3. Hybrid Search   — dense + sparse + section-targeted + RRF
  4. Reranking       — Cohere Rerank top-50 to top-10
  5. Parent-Child    — fetch full parent sections + citations
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from langchain_core.tools import tool

from app.services.agentic.retrieval.hybrid_search import hybrid_search
from app.services.agentic.retrieval.hyde import get_hyde_embedding
from app.services.agentic.retrieval.parent_child import ChunkWithCitation, expand_to_parents
from app.services.agentic.retrieval.query_analysis import analyze_query
from app.services.agentic.retrieval.reranker import rerank_results

logger = logging.getLogger(__name__)


async def _search_sec_filings_impl(
    query: str,
    tickers: Optional[list[str]] = None,
    filing_types: Optional[list[str]] = None,
    sections: Optional[list[str]] = None,
    date_from: Optional[str] = None,
    limit: int = 10,
) -> list[ChunkWithCitation]:
    """Core 5-stage RAG pipeline implementation (testable without @tool decorator)."""
    # Stage 1 + 2 run concurrently
    stage1_task = asyncio.create_task(
        analyze_query(query, tickers_hint=tickers, filing_types_hint=filing_types)
    )
    stage2_task = asyncio.create_task(get_hyde_embedding(query))

    query_result, hyde_embedding = await asyncio.gather(stage1_task, stage2_task)

    # Apply explicit parameter overrides
    if sections and not query_result.sections:
        query_result.sections = sections
    if date_from and not query_result.date_from:
        query_result.date_from = date_from

    # Stage 3: Hybrid search
    candidates = await hybrid_search(query_result, hyde_embedding, top_k=50)
    if not candidates:
        return []

    # Stage 4: Rerank
    reranked = await rerank_results(query, candidates, top_n=limit)
    if not reranked:
        return []

    # Stage 5: Expand to parents + citations
    return await expand_to_parents(reranked)


@tool
async def search_sec_filings(
    query: str,
    tickers: Optional[list[str]] = None,
    filing_types: Optional[list[str]] = None,
    sections: Optional[list[str]] = None,
    date_from: Optional[str] = None,
    limit: int = 10,
) -> list[ChunkWithCitation]:
    """Search SEC filings corpus using 5-stage RAG pipeline.

    Args:
        query:        Natural language search query.
        tickers:      Optional list of stock tickers to filter (e.g. ["AAPL"]).
        filing_types: Optional list of filing types (e.g. ["10-K", "10-Q"]).
        sections:     Optional list of SEC sections (e.g. ["Risk Factors"]).
        date_from:    Optional ISO date string for earliest filing (e.g. "2023-01-01").
        limit:        Max number of results to return (default 10).

    Returns:
        List of ChunkWithCitation with full parent section text and structured citations.
    """
    return await _search_sec_filings_impl(
        query=query,
        tickers=tickers,
        filing_types=filing_types,
        sections=sections,
        date_from=date_from,
        limit=limit,
    )
