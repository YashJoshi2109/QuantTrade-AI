"""
AI Moderation Service for financial community content.

3-stage pipeline:
  1. Keyword Filter (~1ms)  -- catches obvious spam, slurs, prohibited content
  2. AI Content Analysis (~500ms) -- Claude-based financial claim detection
  3. Decision Engine -- score thresholds -> auto-approve / queue / auto-remove

Uses the Anthropic Python SDK (already a project dependency).
"""
import json
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class ModerationResult:
    score: float = 0.0          # 0-1, higher = more likely violation
    action: str = "approve"     # approve | review | remove
    flags: List[str] = field(default_factory=list)
    explanation: str = ""
    claims_detected: List[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# ModerationService
# ---------------------------------------------------------------------------

class ModerationService:
    """Three-stage content moderation pipeline for a financial community."""

    # ── Stage 1: Keyword patterns ────────────────────────────────────────

    BLOCKED_PATTERNS: List[re.Pattern] = [
        # Spam / scam patterns
        re.compile(r"\b(buy\s+now|act\s+fast|guaranteed\s+returns?|risk.?free)\b", re.I),
        re.compile(r"\b(100%\s+profit|double\s+your\s+money|get\s+rich\s+quick)\b", re.I),
        re.compile(r"\b(send\s+me\s+money|wire\s+transfer|crypto\s+giveaway)\b", re.I),
        re.compile(r"\b(limited\s+time\s+offer|once\s+in\s+a\s+lifetime)\b", re.I),
        # Pump-and-dump signals (urgency + micro-cap context)
        re.compile(
            r"\b(to\s+the\s+moon|diamond\s+hands|YOLO|all\s+in)\b.*"
            r"\b(small.?cap|penny\s+stock|micro.?cap|OTC)\b",
            re.I | re.S,
        ),
        re.compile(
            r"\b(small.?cap|penny\s+stock|micro.?cap|OTC)\b.*"
            r"\b(to\s+the\s+moon|diamond\s+hands|YOLO|all\s+in)\b",
            re.I | re.S,
        ),
        # Insider trading language
        re.compile(r"\b(insider\s+info|inside\s+information|leaked\s+earnings)\b", re.I),
        re.compile(r"\b(before\s+(?:the\s+)?announcement|non.?public\s+info)\b", re.I),
        # Slurs / hate speech (basic set)
        re.compile(r"\b(f[a@]gg?[o0]t|n[i1!]gg?[e3]r|k[i1]ke|sp[i1]c)\b", re.I),
        re.compile(r"\b(kill\s+yourself|kys)\b", re.I),
    ]

    # Patterns that raise the score but are not auto-block
    ELEVATED_RISK_PATTERNS: List[re.Pattern] = [
        re.compile(r"\b(price\s+target\s+\$?\d)", re.I),
        re.compile(r"\b(short\s+squeeze|gamma\s+squeeze)\b", re.I),
        re.compile(r"\b(trust\s+me|i\s+guarantee|can'?t\s+lose)\b", re.I),
        re.compile(r"\b(financial\s+advis[oe]r|certified\s+analyst)\b", re.I),
        re.compile(r"\b(not\s+a\s+dead\s+cat|infinite\s+money\s+glitch)\b", re.I),
    ]

    # ── Claude prompt for Stage 2 ────────────────────────────────────────

    FINANCIAL_CLAIM_PROMPT = """You are a financial content moderator for a SEC/FINRA-compliant trading community.

Analyze this community post for:
1. Financial claims that could be misleading (price targets, return guarantees, insider info claims)
2. Pump-and-dump patterns (coordinated buying signals for small-cap stocks)
3. Manipulation signals (urgency language + specific ticker + new account pattern)
4. Undisclosed positions (recommending without disclosing holdings)
5. Impersonation of financial advisors or analysts
6. Spam, scam, or phishing content

Post title: {title}
Post body: {body}
Tickers mentioned: {tickers}
Author account age in days: {account_age}

Respond ONLY with valid JSON (no markdown fences):
{{
  "risk_score": <float 0.0-1.0>,
  "flags": ["flag1", "flag2"],
  "claims": [
    {{"claim": "text of the claim", "type": "price_target|fundamental|short_interest|insider|guarantee", "verified": null}}
  ],
  "explanation": "Brief explanation of risk assessment"
}}"""

    COMMENT_CLAIM_PROMPT = """You are a financial content moderator for a SEC/FINRA-compliant trading community.

Analyze this comment for:
1. Misleading financial claims or guarantees
2. Harassment, hate speech, or personal attacks
3. Spam or scam content
4. Manipulation signals

Comment body: {body}
Author account age in days: {account_age}

Respond ONLY with valid JSON (no markdown fences):
{{
  "risk_score": <float 0.0-1.0>,
  "flags": ["flag1", "flag2"],
  "claims": [
    {{"claim": "text", "type": "misleading|spam|harassment|manipulation", "verified": null}}
  ],
  "explanation": "Brief explanation"
}}"""

    def __init__(self):
        self._client = None
        self._client_initialized = False

    @property
    def _anthropic(self):
        """Lazy-init Anthropic client."""
        if not self._client_initialized:
            self._client_initialized = True
            if settings.ANTHROPIC_API_KEY:
                try:
                    from anthropic import Anthropic
                    self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
                    logger.info("Moderation AI client initialized")
                except Exception as exc:
                    logger.warning("Anthropic client init failed: %s", exc)
            else:
                logger.warning("ANTHROPIC_API_KEY not set -- AI moderation disabled")
        return self._client

    # ── Stage 1: keyword filter ──────────────────────────────────────────

    def _keyword_filter(self, text: str) -> tuple[float, list[str]]:
        """Return (score_delta, flags) from keyword matching."""
        combined = text.lower()
        flags: list[str] = []
        score = 0.0

        for pat in self.BLOCKED_PATTERNS:
            if pat.search(combined):
                flags.append(f"blocked_keyword:{pat.pattern[:40]}")
                score = max(score, 0.85)

        for pat in self.ELEVATED_RISK_PATTERNS:
            if pat.search(combined):
                flags.append(f"elevated_risk:{pat.pattern[:40]}")
                score = max(score, 0.4)

        return score, flags

    # ── Stage 2: AI analysis ─────────────────────────────────────────────

    async def _ai_analyze(self, prompt: str) -> dict:
        """Call Claude for content analysis. Returns parsed JSON or empty dict on failure."""
        client = self._anthropic
        if not client:
            return {}

        try:
            import asyncio
            response = await asyncio.to_thread(
                client.messages.create,
                model="claude-3-haiku-20240307",
                max_tokens=512,
                temperature=0.0,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.warning("AI moderation JSON parse error: %s", exc)
            return {}
        except Exception as exc:
            logger.error("AI moderation call failed: %s", exc)
            return {}

    # ── Stage 3: decision engine ─────────────────────────────────────────

    @staticmethod
    def _decide(score: float) -> str:
        if score > 0.7:
            return "remove"
        if score >= 0.3:
            return "review"
        return "approve"

    # ── Public API ───────────────────────────────────────────────────────

    async def moderate_post(
        self,
        title: str,
        body: str,
        tickers: list[str],
        author_account_age_days: int,
    ) -> ModerationResult:
        """Full 3-stage moderation for a post."""
        combined_text = f"{title} {body}"

        # Stage 1 -- keyword filter
        kw_score, kw_flags = self._keyword_filter(combined_text)

        # Account age risk bump (new accounts < 7 days)
        if author_account_age_days < 7:
            kw_score = min(kw_score + 0.15, 1.0)
            kw_flags.append("new_account")

        # Stage 2 -- AI analysis (skip if keyword filter already certain)
        ai_data: dict = {}
        if kw_score < 0.85:
            prompt = self.FINANCIAL_CLAIM_PROMPT.format(
                title=title,
                body=body or "",
                tickers=", ".join(tickers) if tickers else "none",
                account_age=author_account_age_days,
            )
            ai_data = await self._ai_analyze(prompt)

        ai_score = float(ai_data.get("risk_score", 0.0))
        ai_flags = ai_data.get("flags", [])
        ai_claims = ai_data.get("claims", [])
        ai_explanation = ai_data.get("explanation", "")

        # Stage 3 -- combine scores (max of keyword and AI)
        final_score = round(max(kw_score, ai_score), 3)
        all_flags = kw_flags + ai_flags
        action = self._decide(final_score)

        return ModerationResult(
            score=final_score,
            action=action,
            flags=all_flags,
            explanation=ai_explanation or ("Keyword filter triggered" if kw_flags else ""),
            claims_detected=ai_claims,
        )

    async def moderate_comment(
        self,
        body: str,
        author_account_age_days: int,
    ) -> ModerationResult:
        """Lighter moderation for comments (no title, no tickers context)."""
        # Stage 1
        kw_score, kw_flags = self._keyword_filter(body)

        if author_account_age_days < 3:
            kw_score = min(kw_score + 0.1, 1.0)
            kw_flags.append("very_new_account")

        # Stage 2 -- AI (skip if keyword already decisive)
        ai_data: dict = {}
        if kw_score < 0.85:
            prompt = self.COMMENT_CLAIM_PROMPT.format(
                body=body,
                account_age=author_account_age_days,
            )
            ai_data = await self._ai_analyze(prompt)

        ai_score = float(ai_data.get("risk_score", 0.0))
        ai_flags = ai_data.get("flags", [])
        ai_claims = ai_data.get("claims", [])
        ai_explanation = ai_data.get("explanation", "")

        final_score = round(max(kw_score, ai_score), 3)
        all_flags = kw_flags + ai_flags
        action = self._decide(final_score)

        return ModerationResult(
            score=final_score,
            action=action,
            flags=all_flags,
            explanation=ai_explanation or ("Keyword filter triggered" if kw_flags else ""),
            claims_detected=ai_claims,
        )


# Module-level singleton
moderation_service = ModerationService()
