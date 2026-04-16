"""Stage 1: Intent classification.

Hybrid approach:
    1. Rule-based fast path (covers ~80% of queries)
    2. Confidence scoring to know when rules are uncertain

Intents are ENUMs so downstream code can pattern-match safely.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from app.services.copilot.constants import (
    COMPARISON_KEYWORDS,
    SCREENER_KEYWORDS,
    SECTOR_KEYWORDS,
    ANALYSIS_KEYWORDS,
    GREETING_KEYWORDS,
    EDUCATION_KEYWORDS,
    GENERAL_ADVICE_PATTERNS,
    PORTFOLIO_ADVICE_PATTERNS,
    OFF_TOPIC_PATTERNS,
    HIGH_CONFIDENCE,
    MEDIUM_CONFIDENCE,
    LOW_CONFIDENCE,
)


class Intent(str, Enum):
    """Canonical intent labels used throughout the pipeline."""
    STOCK_ANALYSIS = "stock_analysis"
    COMPARISON = "comparison"
    SCREENER = "screener"
    SECTOR = "sector"
    GENERAL_ADVICE = "general_advice"      # "which stock should I buy with $500"
    PORTFOLIO_ADVICE = "portfolio_advice"  # diversification, rebalancing
    EDUCATION = "education"                # "what is a P/E ratio"
    MARKET_OVERVIEW = "market_overview"    # "how is the market today"
    GREETING = "greeting"
    OFF_TOPIC = "off_topic"
    TEXT = "text"                          # unclassified / generic Q&A


@dataclass
class IntentResult:
    intent: Intent
    confidence: float          # [0, 1]
    reasoning: str             # human-readable explanation
    matched_rules: List[str]   # which rules fired

    def is_high_confidence(self) -> bool:
        return self.confidence >= HIGH_CONFIDENCE

    def is_ambiguous(self) -> bool:
        return self.confidence < MEDIUM_CONFIDENCE


class IntentClassifier:
    """Deterministic rule-based classifier with confidence scoring."""

    def classify(
        self,
        message: str,
        has_resolved_tickers: bool = False,
        num_resolved_tickers: int = 0,
    ) -> IntentResult:
        """Classify a user message into an Intent.

        Args:
            message: Raw user message
            has_resolved_tickers: Whether entity extractor found any tickers
            num_resolved_tickers: Count of extracted tickers (for comparison detection)
        """
        lower = message.lower().strip()
        matched: List[str] = []

        # ── Priority 0: Off-topic filter ────────────────────────────
        if self._matches_any_pattern(lower, OFF_TOPIC_PATTERNS):
            return IntentResult(
                intent=Intent.OFF_TOPIC,
                confidence=HIGH_CONFIDENCE,
                reasoning="Query matches off-topic patterns (not financial)",
                matched_rules=["off_topic_pattern"],
            )

        # ── Priority 1: Greeting (short, no ticker, matches greeting word) ──
        if self._is_greeting(lower):
            return IntentResult(
                intent=Intent.GREETING,
                confidence=HIGH_CONFIDENCE,
                reasoning="Short greeting message",
                matched_rules=["greeting_keyword"],
            )

        # ── Priority 2: Education ("what is X", "explain Y") ──────────
        if self._is_education(lower):
            matched.append("education_keyword")
            # Education + no ticker = clear education intent
            if not has_resolved_tickers:
                return IntentResult(
                    intent=Intent.EDUCATION,
                    confidence=HIGH_CONFIDENCE,
                    reasoning="Educational question without ticker context",
                    matched_rules=matched,
                )

        # ── Priority 3: Portfolio advice (check BEFORE general_advice) ──
        # Portfolio keywords (diversification, allocation, rebalance) are
        # specific enough that even if general_advice patterns also match,
        # portfolio_advice is the better label.
        if self._matches_any_pattern(lower, PORTFOLIO_ADVICE_PATTERNS):
            return IntentResult(
                intent=Intent.PORTFOLIO_ADVICE,
                confidence=HIGH_CONFIDENCE,
                reasoning="Portfolio-level keywords (diversification, allocation)",
                matched_rules=["portfolio_advice_pattern"],
            )

        # ── Priority 4: General investment advice ─────────────────────
        general_matches = self._count_pattern_matches(lower, GENERAL_ADVICE_PATTERNS)
        if general_matches >= 1:
            matched.append(f"general_advice_patterns:{general_matches}")
            # Multiple matches = very high confidence
            conf = HIGH_CONFIDENCE if general_matches >= 2 else MEDIUM_CONFIDENCE + 0.1
            return IntentResult(
                intent=Intent.GENERAL_ADVICE,
                confidence=conf,
                reasoning=f"Matched {general_matches} general-advice patterns",
                matched_rules=matched,
            )

        # ── Priority 5: Comparison (must have >= 2 tickers + comparison word) ──
        if num_resolved_tickers >= 2 and self._has_keyword(lower, COMPARISON_KEYWORDS):
            return IntentResult(
                intent=Intent.COMPARISON,
                confidence=HIGH_CONFIDENCE,
                reasoning=f"Comparison keyword + {num_resolved_tickers} tickers",
                matched_rules=["comparison_keyword", "multi_ticker"],
            )

        # ── Priority 6: Screener (gainers/losers/movers) ──────────────
        if self._has_keyword(lower, SCREENER_KEYWORDS):
            return IntentResult(
                intent=Intent.SCREENER,
                confidence=HIGH_CONFIDENCE,
                reasoning="Screener keyword matched",
                matched_rules=["screener_keyword"],
            )

        # ── Priority 7: Sector ───────────────────────────────────────
        if self._has_keyword(lower, SECTOR_KEYWORDS):
            return IntentResult(
                intent=Intent.SECTOR,
                confidence=HIGH_CONFIDENCE,
                reasoning="Sector keyword matched",
                matched_rules=["sector_keyword"],
            )

        # ── Priority 8: Market overview ──────────────────────────────
        if self._is_market_overview(lower) and not has_resolved_tickers:
            return IntentResult(
                intent=Intent.MARKET_OVERVIEW,
                confidence=HIGH_CONFIDENCE,
                reasoning="Market-wide overview question",
                matched_rules=["market_overview_pattern"],
            )

        # ── Priority 9: Stock analysis (has ticker + analysis intent) ──
        if has_resolved_tickers:
            if self._has_keyword(lower, ANALYSIS_KEYWORDS):
                return IntentResult(
                    intent=Intent.STOCK_ANALYSIS,
                    confidence=HIGH_CONFIDENCE,
                    reasoning="Analysis keyword + ticker resolved",
                    matched_rules=["analysis_keyword", "ticker_resolved"],
                )
            # Ticker resolved but no explicit analysis verb — medium confidence
            return IntentResult(
                intent=Intent.STOCK_ANALYSIS,
                confidence=MEDIUM_CONFIDENCE,
                reasoning="Ticker resolved but no explicit analysis verb",
                matched_rules=["ticker_resolved"],
            )

        # ── Fallback ──────────────────────────────────────────────────
        return IntentResult(
            intent=Intent.TEXT,
            confidence=LOW_CONFIDENCE,
            reasoning="No rule fired — fallback to generic text",
            matched_rules=[],
        )

    # ── Helpers ────────────────────────────────────────────────────────
    @staticmethod
    def _matches_any_pattern(text: str, patterns: List[str]) -> bool:
        return any(re.search(pat, text) for pat in patterns)

    @staticmethod
    def _count_pattern_matches(text: str, patterns: List[str]) -> int:
        return sum(1 for pat in patterns if re.search(pat, text))

    @staticmethod
    def _has_keyword(text: str, keywords: List[str]) -> bool:
        return any(kw in text for kw in keywords)

    @staticmethod
    def _is_greeting(text: str) -> bool:
        # Short message (<=5 words) matching a greeting keyword
        words = text.split()
        if len(words) > 5:
            return False
        return any(text.startswith(g) or f" {g} " in f" {text} " for g in GREETING_KEYWORDS)

    @staticmethod
    def _is_education(text: str) -> bool:
        # Educational questions often start with "what is", "explain", etc.
        for kw in EDUCATION_KEYWORDS:
            if text.startswith(kw) or f" {kw} " in text:
                return True
        return False

    @staticmethod
    def _is_market_overview(text: str) -> bool:
        patterns = [
            r"\bhow\s+is\s+the\s+market",
            r"\bmarket\s+(?:today|now|doing)",
            r"\boverall\s+market",
            r"\bs&p\s+500",
            r"\bstock\s+market\s+(?:today|outlook)",
        ]
        return any(re.search(p, text) for p in patterns)
