"""Stage 2 — Hypothetical Document Embeddings (HyDE).

Generates a hypothetical answer to the query using Claude Haiku,
then embeds it with Titan v2. The resulting vector captures the
semantic space of answers, not just the question.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.agentic.bedrock_client import embed_query, get_llm_haiku

logger = logging.getLogger(__name__)

_HYDE_PROMPT = """\
You are a financial analyst. Write a short excerpt (150-200 words) from a hypothetical \
SEC filing section that would directly answer the following question.

Write as if it were real text from a 10-K or 10-Q filing. Use specific numbers \
and financial language. Do NOT add any preamble - start directly with the document text.

Question: {query}"""


async def generate_hypothetical_document(query: str) -> str:
    """Use Claude Haiku to produce a hypothetical SEC filing excerpt for the query."""
    llm = get_llm_haiku()
    response = await llm.ainvoke([("human", _HYDE_PROMPT.format(query=query))])
    return response.content


async def get_hyde_embedding(query: str) -> list[float] | None:
    """Generate hypothetical document and embed it with Titan v2.

    Returns 1536-dim vector, or None if Haiku/Bedrock call fails.
    """
    try:
        hypo_doc = await generate_hypothetical_document(query)
        loop = asyncio.get_running_loop()
        vector = await loop.run_in_executor(None, embed_query, hypo_doc)
        return vector
    except Exception as exc:
        logger.warning("HyDE failed for query %r: %s", query[:60], exc)
        return None
