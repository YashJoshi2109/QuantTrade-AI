"""Stage 2: Entity extraction with confidence scoring.

Extracts stock tickers from free text with three confidence tiers:

    HIGH     — Explicit ticker syntax: $AAPL, $BRK.B, uppercase ticker matching DB
    MEDIUM   — Capitalized company name (first letter upper, rest lower) matching DB
    LOW      — Lowercase word fuzzy-matching a company name (ONLY if not blocked)
    BLOCKED  — Word is in the banned list (dollar, money, growth, student, etc.)

Downstream routing uses confidence to decide whether to trust the entity.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import IntEnum
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.symbol import Symbol
from app.services.copilot.constants import (
    BLOCKED_AS_COMPANY_NAME,
    STOP_WORDS,
    CURRENCY_AND_MONEY_WORDS,
    COMMON_ENGLISH_WORDS,
    FINANCE_VOCAB_STOP,
)


class EntityConfidence(IntEnum):
    """Confidence tiers for extracted entities."""
    HIGH = 3      # $AAPL, explicit uppercase ticker
    MEDIUM = 2    # Capitalized name match (Apple, Tesla)
    LOW = 1       # Lowercase fuzzy match (fallback)
    BLOCKED = 0   # Would match but word is banned


@dataclass
class Entity:
    """A single extracted stock entity."""
    ticker: str                  # Resolved ticker (e.g. "AAPL")
    source_token: str            # Original word from user message
    confidence: EntityConfidence
    match_type: str              # "ticker_exact" | "name_capitalized" | "name_fuzzy" | "dollar_ticker"
    name: Optional[str] = None   # Company name for display

    def is_trustworthy(self) -> bool:
        return self.confidence >= EntityConfidence.MEDIUM


class EntityExtractor:
    """Extract stock entities from free text with confidence scoring."""

    def __init__(self, db: Session):
        self.db = db

    def extract(self, message: str, explicit_symbol: Optional[str] = None) -> List[Entity]:
        """Extract all stock entities from a message.

        Args:
            message: User's raw message
            explicit_symbol: Symbol passed via API parameter (always HIGH)

        Returns:
            List of Entity objects, deduplicated by ticker, sorted by confidence DESC.
        """
        entities: List[Entity] = []
        seen_tickers: set[str] = set()

        # ── Tier 0: Explicit symbol parameter (always HIGH) ────────────
        if explicit_symbol and explicit_symbol.strip():
            sym = self._resolve_exact_ticker(explicit_symbol.strip())
            if sym:
                entities.append(Entity(
                    ticker=sym.symbol.upper(),
                    source_token=explicit_symbol,
                    confidence=EntityConfidence.HIGH,
                    match_type="explicit_param",
                    name=sym.name,
                ))
                seen_tickers.add(sym.symbol.upper())

        # ── Tier 1: $TICKER syntax (HIGH) ─────────────────────────────
        dollar_tickers = re.findall(r"\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)", message)
        for tok in dollar_tickers:
            sym = self._resolve_exact_ticker(tok)
            if sym and sym.symbol.upper() not in seen_tickers:
                entities.append(Entity(
                    ticker=sym.symbol.upper(),
                    source_token=f"${tok}",
                    confidence=EntityConfidence.HIGH,
                    match_type="dollar_ticker",
                    name=sym.name,
                ))
                seen_tickers.add(sym.symbol.upper())

        # ── Tier 2: UPPERCASE tickers (HIGH) ──────────────────────────
        # 1-5 uppercase letters, must be a real ticker in DB
        upper_tokens = re.findall(r"\b[A-Z]{1,5}\b", message)
        for tok in upper_tokens:
            if tok in seen_tickers:
                continue
            # Skip all-uppercase common English words mistakenly typed
            if tok.lower() in STOP_WORDS or tok.lower() in FINANCE_VOCAB_STOP:
                continue
            # Also skip single-letter tokens (too ambiguous)
            if len(tok) < 2:
                continue
            sym = self._resolve_exact_ticker(tok)
            if sym:
                entities.append(Entity(
                    ticker=sym.symbol.upper(),
                    source_token=tok,
                    confidence=EntityConfidence.HIGH,
                    match_type="ticker_exact",
                    name=sym.name,
                ))
                seen_tickers.add(sym.symbol.upper())

        # ── Tier 3: Capitalized names (MEDIUM) ────────────────────────
        # Words like "Apple", "Tesla", "Microsoft"
        # Extract sequences of capitalized words (handles multi-word names)
        capitalized = re.findall(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+){0,2}\b", message)
        for phrase in capitalized:
            phrase_lower = phrase.lower()
            # Skip if it's in the blocked list
            if phrase_lower in BLOCKED_AS_COMPANY_NAME:
                continue
            # Skip sentence-start words that are common English ("Good", "The", etc.)
            first_word = phrase.split()[0].lower()
            if first_word in BLOCKED_AS_COMPANY_NAME:
                continue
            sym = self._resolve_fuzzy_name(phrase)
            if sym and sym.symbol.upper() not in seen_tickers:
                entities.append(Entity(
                    ticker=sym.symbol.upper(),
                    source_token=phrase,
                    confidence=EntityConfidence.MEDIUM,
                    match_type="name_capitalized",
                    name=sym.name,
                ))
                seen_tickers.add(sym.symbol.upper())

        # ── Tier 4: Lowercase fuzzy (LOW, strictly gated) ─────────────
        # Only for tokens that are 4+ chars AND not in the blocked set AND
        # look specifically like a company name token (not a generic word).
        # This tier is the riskiest — only used when HIGH/MEDIUM found nothing.
        if not any(e.confidence >= EntityConfidence.MEDIUM for e in entities):
            lower_tokens = re.findall(r"\b[a-z]{4,15}\b", message)
            for tok in lower_tokens:
                if tok in seen_tickers or tok in BLOCKED_AS_COMPANY_NAME:
                    continue
                sym = self._resolve_fuzzy_name_strict(tok)
                if sym and sym.symbol.upper() not in seen_tickers:
                    entities.append(Entity(
                        ticker=sym.symbol.upper(),
                        source_token=tok,
                        confidence=EntityConfidence.LOW,
                        match_type="name_fuzzy",
                        name=sym.name,
                    ))
                    seen_tickers.add(sym.symbol.upper())

        # Sort by confidence DESC so consumers get strongest first
        entities.sort(key=lambda e: -int(e.confidence))
        return entities

    # ── DB resolvers ──────────────────────────────────────────────────
    def _resolve_exact_ticker(self, candidate: str) -> Optional[Symbol]:
        return (
            self.db.query(Symbol)
            .filter(Symbol.symbol == candidate.upper())
            .first()
        )

    def _resolve_fuzzy_name(self, candidate: str) -> Optional[Symbol]:
        """Fuzzy name match for capitalized phrases — permissive."""
        if len(candidate) < 3:
            return None
        return (
            self.db.query(Symbol)
            .filter(Symbol.name.ilike(f"%{candidate}%"))
            .order_by(Symbol.market_cap.desc().nullslast())
            .first()
        )

    def _resolve_fuzzy_name_strict(self, candidate: str) -> Optional[Symbol]:
        """Strict fuzzy — requires whole-word-like match in company name.

        This prevents 'dollar' from matching 'Dollar General' (already blocked
        in BLOCKED_AS_COMPANY_NAME, but defense in depth).
        """
        if len(candidate) < 4:
            return None
        # Only match if candidate starts the company name OR is a standalone
        # word within it (bounded by space or hyphen).
        return (
            self.db.query(Symbol)
            .filter(
                (Symbol.name.ilike(f"{candidate}%"))      # starts with
                | (Symbol.name.ilike(f"% {candidate} %"))  # standalone word
                | (Symbol.name.ilike(f"% {candidate}"))    # ends with
            )
            .order_by(Symbol.market_cap.desc().nullslast())
            .first()
        )
