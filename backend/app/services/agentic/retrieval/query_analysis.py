"""Stage 1 — Query Analysis.

Claude Haiku extracts structured metadata from the user query and generates
3-5 search query variants for parallel retrieval.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.services.agentic.bedrock_client import get_llm_haiku

logger = logging.getLogger(__name__)

_PROMPT = """\
You are a financial document search assistant. Extract structured search metadata \
from the user's query about SEC filings.

Return ONLY a valid JSON object with these fields:
- tickers: list of stock tickers mentioned (uppercase, e.g. ["AAPL", "MSFT"]), empty list if none
- filing_types: relevant SEC filing types, subset of ["10-K", "10-Q", "8-K", "DEF 14A"]
- sections: relevant sections, subset of ["Business", "Risk Factors", "MD&A", \
"Quantitative Market Risk", "Financial Statements", "Controls & Procedures"]
- date_from: ISO date "YYYY-MM-DD" for earliest relevant filing, or null
- query_variants: list of 3-5 search query phrasings covering different angles

User query: {query}

Respond with ONLY the JSON object, no explanation or markdown."""


@dataclass
class QueryAnalysisResult:
    tickers: list[str]
    filing_types: list[str]
    sections: list[str]
    date_from: str | None
    query_variants: list[str]
    original_query: str


def _extract_json(text: str) -> dict:
    """Extract JSON from LLM response, handling optional markdown code fences."""
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"No JSON found in LLM response: {text[:200]!r}")


def _fallback(query: str, tickers_hint: list[str] | None) -> QueryAnalysisResult:
    return QueryAnalysisResult(
        tickers=list(tickers_hint or []),
        filing_types=["10-K", "10-Q"],
        sections=[],
        date_from=None,
        query_variants=[query],
        original_query=query,
    )


async def analyze_query(
    query: str,
    tickers_hint: list[str] | None = None,
    filing_types_hint: list[str] | None = None,
) -> QueryAnalysisResult:
    """Use Claude Haiku to extract metadata and generate query variants.

    Falls back to a minimal result if the LLM response is unparseable.
    """
    llm = get_llm_haiku()
    try:
        response = await llm.ainvoke([("human", _PROMPT.format(query=query))])
        data = _extract_json(response.content)
    except Exception as exc:
        logger.warning("Query analysis failed (%s) — using fallback", exc)
        return _fallback(query, tickers_hint)

    tickers = data.get("tickers") or []
    if tickers_hint:
        for t in tickers_hint:
            if t not in tickers:
                tickers.append(t)

    return QueryAnalysisResult(
        tickers=tickers,
        filing_types=data.get("filing_types") or (filing_types_hint or ["10-K", "10-Q"]),
        sections=data.get("sections") or [],
        date_from=data.get("date_from"),
        query_variants=data.get("query_variants") or [query],
        original_query=query,
    )
