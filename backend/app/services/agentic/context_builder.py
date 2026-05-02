"""Token-budgeted context assembly for the LLM node.

Assembles the system prompt context from:
  - Retrieved SEC filing chunks (with citations)
  - Live market data (quotes, fundamentals)
  - Conversation history (from Redis memory)

Token budget per slot (13,500 total):
  system base:       800
  agent instructions:200
  retrieved chunks: 6,000   <- CHUNK_TOKEN_BUDGET
  live market data:   800   <- LIVE_DATA_TOKEN_BUDGET
  conversation:     1,500   <- HISTORY_TOKEN_BUDGET
  format:             200
  response reserve: 4,000
"""
from __future__ import annotations

import logging
from typing import Any

from app.services.agentic.retrieval.parent_child import ChunkWithCitation

logger = logging.getLogger(__name__)

CHUNK_TOKEN_BUDGET     = 6_000
LIVE_DATA_TOKEN_BUDGET =   800
HISTORY_TOKEN_BUDGET   = 1_500

CITATION_SEPARATOR = "─" * 40


def count_tokens(text: str) -> int:
    """Approximate token count: word count * 1.3 (Sonnet tokenization approximation)."""
    return int(len(text.split()) * 1.3)


def _format_chunk(chunk: ChunkWithCitation, source_n: int) -> str:
    return (
        f"{chunk.citation_label}\n"
        f"{CITATION_SEPARATOR}\n"
        f"{chunk.text}\n"
        f"{CITATION_SEPARATOR}\n"
    )


def _format_live_data(live_data: dict[str, Any]) -> str:
    if not live_data:
        return ""
    lines = ["[LIVE MARKET DATA]"]
    for ticker, data in live_data.items():
        if isinstance(data, dict):
            price = data.get("price")
            chg   = data.get("change_pct")
            if price is not None:
                lines.append(f"{ticker}: ${price:.2f}  ({chg:+.2f}%)" if chg else f"{ticker}: ${price:.2f}")
            # Add fundamentals if present
            for key in ("pe_ratio", "eps", "revenue", "market_cap"):
                if key in data:
                    lines.append(f"  {key}: {data[key]}")
        else:
            lines.append(f"{ticker}: {data}")
    return "\n".join(lines)


def build_context(
    chunks: list[ChunkWithCitation],
    live_data: dict[str, Any],
    history: str,
) -> str:
    """Assemble token-budgeted context string for the LLM system prompt.

    Priority if over budget: live_data > chunks > history > format.
    """
    sections: list[str] = []

    # 1. Retrieved SEC chunks (token-budgeted)
    if chunks:
        chunk_parts: list[str] = []
        used_tokens = 0
        for i, chunk in enumerate(chunks, start=1):
            formatted = _format_chunk(chunk, i)
            chunk_tokens = count_tokens(formatted)
            if used_tokens + chunk_tokens > CHUNK_TOKEN_BUDGET:
                logger.debug(
                    "Chunk budget exhausted after %d/%d chunks", i - 1, len(chunks)
                )
                break
            chunk_parts.append(formatted)
            used_tokens += chunk_tokens
        if chunk_parts:
            sections.append("[RETRIEVED SEC FILINGS]\n" + "\n".join(chunk_parts))

    # 2. Live market data (always included if within budget)
    if live_data:
        live_str = _format_live_data(live_data)
        if count_tokens(live_str) <= LIVE_DATA_TOKEN_BUDGET:
            sections.append(live_str)
        else:
            # Truncate to budget
            words = live_str.split()
            budget_words = int(LIVE_DATA_TOKEN_BUDGET / 1.3)
            sections.append(" ".join(words[:budget_words]))

    # 3. Conversation history
    if history:
        hist_tokens = count_tokens(history)
        if hist_tokens <= HISTORY_TOKEN_BUDGET:
            sections.append(f"[CONVERSATION HISTORY]\n{history}")
        else:
            budget_words = int(HISTORY_TOKEN_BUDGET / 1.3)
            truncated = " ".join(history.split()[:budget_words])
            sections.append(f"[CONVERSATION HISTORY]\n{truncated}")

    return "\n\n".join(sections)
