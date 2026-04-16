"""Stage 4: Retrieval architecture.

Enhances RAG context assembly with:
    - Query expansion (generate alternative phrasings)
    - Hybrid retrieval (existing vector RAG + knowledge base)
    - Intent-aware context filtering
    - Token budget management (truncate by priority)

This wraps (not replaces) the existing RAGService so we keep backward
compatibility with the current vector DB while layering smarter assembly on top.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy.orm import Session

from app.services.copilot.intent_classifier import Intent
from app.services.copilot.router import RoutingDecision
from app.services.copilot.knowledge_base import get_knowledge_snippets

logger = logging.getLogger(__name__)


@dataclass
class ContextBundle:
    """All retrieved context pieces, ready for LLM assembly."""
    realtime_quote: Optional[str] = None        # live price snippet
    fundamentals: Optional[str] = None           # P/E, margins, etc.
    prediction_summary: Optional[str] = None     # LSTM prediction
    news_snippets: List[str] = field(default_factory=list)
    filing_snippets: List[str] = field(default_factory=list)
    knowledge_snippets: Optional[str] = None     # from FinanceKnowledgeBase
    comparison_blocks: List[str] = field(default_factory=list)  # for comparison intent

    def to_llm_context(self, max_chars: int = 12000) -> str:
        """Assemble into a single string for LLM, respecting char budget.

        Priority order (truncate lower priority first):
            1. realtime_quote (always include)
            2. prediction_summary
            3. fundamentals
            4. knowledge_snippets
            5. comparison_blocks
            6. news_snippets
            7. filing_snippets
        """
        parts: List[str] = []
        budget = max_chars

        def _add(label: str, text: str) -> None:
            nonlocal budget
            if not text:
                return
            block = f"[{label}]\n{text}"
            if len(block) > budget:
                block = block[: budget - 20] + "\n... (truncated)"
            parts.append(block)
            budget -= len(block)

        if self.realtime_quote:
            _add("REALTIME QUOTE", self.realtime_quote)
        if self.prediction_summary:
            _add("PREDICTION", self.prediction_summary)
        if self.fundamentals:
            _add("FUNDAMENTALS", self.fundamentals)
        if self.knowledge_snippets:
            _add("FINANCE KNOWLEDGE", self.knowledge_snippets)
        for i, block in enumerate(self.comparison_blocks, 1):
            _add(f"COMPARISON TICKER {i}", block)
        for i, n in enumerate(self.news_snippets, 1):
            if budget < 200:
                break
            _add(f"NEWS {i}", n)
        for i, f in enumerate(self.filing_snippets, 1):
            if budget < 200:
                break
            _add(f"FILING {i}", f)

        return "\n\n".join(parts)


def build_context_bundle(
    decision: RoutingDecision,
    message: str,
    db: Session,
    *,
    realtime_quote: Optional[str] = None,
    fundamentals: Optional[str] = None,
    prediction_summary: Optional[str] = None,
    news_snippets: Optional[List[str]] = None,
    filing_snippets: Optional[List[str]] = None,
) -> ContextBundle:
    """Assemble a ContextBundle based on the routing decision.

    Different intents get different context sets:
        - stock_analysis: everything stock-specific
        - general_advice / portfolio_advice / education: knowledge base only
        - greeting / off_topic: nothing
    """
    bundle = ContextBundle()

    if decision.intent in (Intent.GREETING, Intent.OFF_TOPIC):
        return bundle

    if decision.intent in (
        Intent.GENERAL_ADVICE,
        Intent.PORTFOLIO_ADVICE,
        Intent.EDUCATION,
        Intent.MARKET_OVERVIEW,
    ):
        # Pure knowledge-driven response
        bundle.knowledge_snippets = get_knowledge_snippets(message, limit=3)
        return bundle

    if decision.intent == Intent.STOCK_ANALYSIS and decision.use_stock_context:
        bundle.realtime_quote = realtime_quote
        bundle.fundamentals = fundamentals
        bundle.prediction_summary = prediction_summary
        bundle.news_snippets = news_snippets or []
        bundle.filing_snippets = filing_snippets or []
        return bundle

    if decision.intent == Intent.COMPARISON:
        # Comparison blocks handled by caller per-ticker
        return bundle

    # SCREENER / SECTOR / TEXT fallback — no heavy context
    if decision.inject_general_knowledge:
        bundle.knowledge_snippets = get_knowledge_snippets(message, limit=2)

    return bundle


def expand_query(query: str) -> List[str]:
    """Generate alternative phrasings of a query for hybrid retrieval.

    Deterministic rewrites (no LLM call). The RAG service can issue these
    as parallel searches and merge results.
    """
    q = query.strip()
    if not q:
        return [q]
    variants = {q}

    # Normalize question -> statement for embedding similarity
    lower = q.lower()
    if lower.startswith("what is ") or lower.startswith("what are "):
        variants.add(q.split(" ", 2)[-1] if " " in q else q)
    if lower.startswith("how do ") or lower.startswith("how does "):
        variants.add(q.split(" ", 2)[-1] if " " in q else q)

    # Add "explain X" form
    if len(q.split()) < 12:
        variants.add(f"explain {q}")

    return list(variants)
