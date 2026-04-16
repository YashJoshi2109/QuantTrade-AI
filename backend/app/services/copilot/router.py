"""Stage 3: Routing guardrails.

The Router reconciles Intent × Entities to produce a final RoutingDecision.

It enforces invariants:
    - general_advice: NEVER use fuzzy-resolved tickers as primary context
    - stock_analysis: requires trustworthy entity (>= MEDIUM)
    - comparison: requires at least 2 trustworthy entities
    - off_topic: politely decline
    - greeting: short canned response path

If the intent and entities conflict, the Router picks the safer interpretation
and sets a `clarification_needed` flag so the UI can ask the user.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from app.services.copilot.intent_classifier import (
    Intent,
    IntentClassifier,
    IntentResult,
)
from app.services.copilot.entity_extractor import (
    Entity,
    EntityConfidence,
    EntityExtractor,
)
from app.services.copilot.constants import HIGH_CONFIDENCE, MEDIUM_CONFIDENCE


@dataclass
class RoutingDecision:
    """Final routing decision — what the downstream pipeline should do."""
    intent: Intent
    intent_confidence: float
    intent_reasoning: str

    primary_entity: Optional[Entity] = None
    all_entities: List[Entity] = field(default_factory=list)

    # Should downstream build stock_analysis structured_data?
    use_stock_context: bool = False
    # Should we inject general-investing knowledge snippets?
    inject_general_knowledge: bool = False
    # If True, ask the user to clarify before running
    clarification_needed: bool = False
    clarification_message: Optional[str] = None
    # For logging / debugging
    notes: List[str] = field(default_factory=list)

    @property
    def primary_ticker(self) -> Optional[str]:
        return self.primary_entity.ticker if self.primary_entity else None

    @property
    def all_tickers(self) -> List[str]:
        return [e.ticker for e in self.all_entities]


class CopilotRouter:
    """Combines IntentClassifier + EntityExtractor with safety rules."""

    def __init__(self, db):
        self.db = db
        self.classifier = IntentClassifier()
        self.extractor = EntityExtractor(db)

    def route(self, message: str, explicit_symbol: Optional[str] = None) -> RoutingDecision:
        """Produce a RoutingDecision from a user message."""
        # ── Step 1: Extract entities ──────────────────────────────────
        entities = self.extractor.extract(message, explicit_symbol)
        trustworthy = [e for e in entities if e.is_trustworthy()]
        has_trustworthy = len(trustworthy) > 0

        # ── Step 2: Classify intent (pass entity awareness) ───────────
        intent_result = self.classifier.classify(
            message,
            has_resolved_tickers=has_trustworthy,
            num_resolved_tickers=len(trustworthy),
        )

        decision = RoutingDecision(
            intent=intent_result.intent,
            intent_confidence=intent_result.confidence,
            intent_reasoning=intent_result.reasoning,
            all_entities=entities,
        )

        # ── Step 3: Apply guardrails per intent ───────────────────────
        if intent_result.intent == Intent.OFF_TOPIC:
            decision.use_stock_context = False
            decision.notes.append("Off-topic: returning polite decline")
            return decision

        if intent_result.intent == Intent.GREETING:
            decision.use_stock_context = False
            decision.notes.append("Greeting: short canned path")
            return decision

        if intent_result.intent == Intent.GENERAL_ADVICE:
            # CRITICAL: discard fuzzy-resolved tickers entirely for general advice.
            # This is what fixes the "dollar -> Dollar General / DG" bug.
            decision.use_stock_context = False
            decision.inject_general_knowledge = True
            decision.primary_entity = None
            decision.all_entities = [e for e in entities if e.confidence == EntityConfidence.HIGH]
            decision.notes.append(
                "General advice: discarded LOW/MEDIUM entities, injecting knowledge base"
            )
            return decision

        if intent_result.intent == Intent.PORTFOLIO_ADVICE:
            decision.use_stock_context = False
            decision.inject_general_knowledge = True
            decision.all_entities = [e for e in entities if e.confidence == EntityConfidence.HIGH]
            decision.notes.append("Portfolio advice: knowledge-driven, no stock deep-dive")
            return decision

        if intent_result.intent == Intent.EDUCATION:
            decision.use_stock_context = False
            decision.inject_general_knowledge = True
            decision.notes.append("Education: knowledge-driven response")
            return decision

        if intent_result.intent == Intent.COMPARISON:
            # Need >= 2 trustworthy entities
            if len(trustworthy) >= 2:
                decision.primary_entity = trustworthy[0]
                decision.all_entities = trustworthy[:4]  # cap at 4
                decision.use_stock_context = True
                decision.notes.append(f"Comparison: {len(decision.all_entities)} tickers")
            else:
                decision.clarification_needed = True
                decision.clarification_message = (
                    "Which stocks would you like to compare? "
                    "Please provide at least 2 ticker symbols (e.g. AAPL vs MSFT)."
                )
                decision.notes.append(f"Comparison needs 2+ tickers, got {len(trustworthy)}")
            return decision

        if intent_result.intent == Intent.SCREENER:
            decision.use_stock_context = False
            decision.notes.append("Screener: routed to screener handler")
            return decision

        if intent_result.intent == Intent.SECTOR:
            decision.use_stock_context = False
            decision.notes.append("Sector: routed to sector handler")
            return decision

        if intent_result.intent == Intent.MARKET_OVERVIEW:
            decision.use_stock_context = False
            decision.inject_general_knowledge = True
            decision.notes.append("Market overview: general context")
            return decision

        if intent_result.intent == Intent.STOCK_ANALYSIS:
            # Must have at least one trustworthy entity
            if trustworthy:
                decision.primary_entity = trustworthy[0]
                decision.all_entities = trustworthy
                decision.use_stock_context = True
                decision.notes.append(f"Stock analysis: primary={trustworthy[0].ticker}")
            elif entities:  # only LOW confidence matches
                # Downgrade: the fuzzy match is probably wrong. Ask for clarification.
                decision.intent = Intent.TEXT
                decision.clarification_needed = True
                decision.clarification_message = (
                    f"I'm not sure which stock you meant. "
                    f"Did you mean {entities[0].ticker} ({entities[0].name})? "
                    f"If yes, please confirm with the ticker symbol."
                )
                decision.notes.append("Only LOW confidence entity — requesting clarification")
            else:
                decision.intent = Intent.TEXT
                decision.notes.append("Stock analysis intent but no entities — fallback to text")
            return decision

        # Default TEXT intent — just let the LLM answer freely
        decision.notes.append("Generic text response")
        return decision
