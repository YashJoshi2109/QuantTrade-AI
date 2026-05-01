"""Stage 4 — Cross-Encoder Reranking via Cohere.

Reranks top-50 hybrid-search results to top-10 using Cohere Rerank v3.
Falls back to returning the original list (truncated to top_n) on failure.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.agentic.bedrock_client import rerank
from .hybrid_search import SearchResult

logger = logging.getLogger(__name__)


async def rerank_results(
    query: str,
    results: list[SearchResult],
    top_n: int = 10,
) -> list[SearchResult]:
    """Rerank results using Cohere Rerank v3.

    Args:
        query:   The original user query string.
        results: Candidates from hybrid search (up to 50).
        top_n:   Number of results to return.

    Returns:
        top_n SearchResults with scores updated to Cohere relevance scores,
        sorted by descending score.
        Falls back to original results[:top_n] on Cohere failure.
    """
    if not results:
        return []

    texts = [r.text for r in results]

    try:
        loop = asyncio.get_running_loop()
        ranked = await loop.run_in_executor(None, rerank, query, texts, top_n)
    except Exception as exc:
        logger.warning("Cohere rerank failed (%s) — using original order", exc)
        return results[:top_n]

    reranked: list[SearchResult] = []
    for item in ranked:
        original = results[item["index"]]
        reranked.append(
            SearchResult(**{**vars(original), "score": item["score"]})
        )

    reranked.sort(key=lambda r: r.score, reverse=True)
    return reranked
