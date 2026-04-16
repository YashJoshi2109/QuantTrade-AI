"""Copilot NLP Pipeline.

Production-grade intent classification, entity extraction, routing guardrails,
and knowledge-enhanced retrieval for the QuantTrade AI Copilot.

Pipeline:
    user message
      -> IntentClassifier (Stage 1)
      -> EntityExtractor (Stage 2)
      -> Router (Stage 3, guardrails)
      -> Retrieval (Stage 4, hybrid + re-ranking)
      -> Knowledge (Stage 6, curated finance topics)
      -> LLM
"""

from app.services.copilot.intent_classifier import (
    Intent,
    IntentClassifier,
    IntentResult,
)
from app.services.copilot.entity_extractor import (
    EntityExtractor,
    Entity,
    EntityConfidence,
)
from app.services.copilot.router import CopilotRouter, RoutingDecision
from app.services.copilot.knowledge_base import FinanceKnowledgeBase, get_knowledge_snippets

__all__ = [
    "Intent",
    "IntentClassifier",
    "IntentResult",
    "EntityExtractor",
    "Entity",
    "EntityConfidence",
    "CopilotRouter",
    "RoutingDecision",
    "FinanceKnowledgeBase",
    "get_knowledge_snippets",
]
