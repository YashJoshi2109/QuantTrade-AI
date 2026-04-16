"""Stage 6: Curated finance knowledge base.

Hand-curated snippets for common investing topics. Injected into the LLM
context for general_advice / education / portfolio_advice / market_overview
intents so the model always has accurate, grounded information.

This is NOT a vector DB — it's a small, deterministic, well-edited reference
that supplements whatever the LLM already knows. Future: embed these for
semantic retrieval at scale.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass
class KnowledgeSnippet:
    topic: str
    tags: List[str]
    content: str


# ── Curated knowledge snippets ─────────────────────────────────────────
KNOWLEDGE_BASE: List[KnowledgeSnippet] = [
    KnowledgeSnippet(
        topic="Broad Market ETFs (Beginners & Long-Term)",
        tags=["etf", "beginner", "student", "long_term", "growth", "diversification"],
        content=(
            "For beginners or long-term investors, broad market index ETFs are the "
            "most common starting point:\n"
            "- VOO (Vanguard S&P 500 ETF): tracks the 500 largest US companies; "
            "expense ratio ~0.03%.\n"
            "- VTI (Vanguard Total Stock Market): owns ~all US public stocks; "
            "expense ratio ~0.03%.\n"
            "- SPY (SPDR S&P 500 Trust): same benchmark as VOO but higher expense "
            "ratio (~0.09%).\n"
            "- QQQ (Invesco QQQ Trust): tech-heavy, tracks NASDAQ-100; more growth, "
            "more volatility.\n"
            "- VT (Vanguard Total World): global diversification.\n"
            "These are diversified by design, so a single stock blow-up has minimal impact."
        ),
    ),
    KnowledgeSnippet(
        topic="Growth Stocks for Long Horizons",
        tags=["growth", "long_term", "student"],
        content=(
            "Individual growth stocks that historically compounded over long horizons "
            "(but with MUCH higher volatility than index ETFs): NVDA, MSFT, GOOGL, "
            "META, AAPL, AMZN, AVGO, TSLA. High-conviction picks should typically "
            "be a small slice (5-15%) of a diversified portfolio. Growth stocks can "
            "drop 30-50% during corrections; only hold what you can stomach through "
            "drawdowns."
        ),
    ),
    KnowledgeSnippet(
        topic="Small Budget Investing ($100 - $1000)",
        tags=["small_budget", "student", "beginner", "starting"],
        content=(
            "With a small starting amount:\n"
            "1. Commission-free brokers (Fidelity, Schwab, Robinhood, Public) make "
            "small investments viable.\n"
            "2. Fractional shares let you buy 1/10th of a $500 stock with $50.\n"
            "3. A single broad ETF (VOO/VTI) is often more efficient than building "
            "a 10-stock portfolio at small sizes because it's already diversified.\n"
            "4. Dollar-cost averaging (DCA): invest a fixed amount monthly rather "
            "than timing the market.\n"
            "5. Consider a Roth IRA if you have earned income — tax-free growth."
        ),
    ),
    KnowledgeSnippet(
        topic="Diversification Principles",
        tags=["diversification", "portfolio", "risk"],
        content=(
            "Diversification reduces unsystematic risk (risk of any single company "
            "failing). Common frameworks:\n"
            "- 60/40 (Bogle classic): 60% stocks, 40% bonds.\n"
            "- Three-fund portfolio: US total market + international total market + "
            "bonds.\n"
            "- Core + satellite: 70-80% in broad index ETFs, 20-30% in conviction "
            "picks.\n"
            "Avoid over-concentrating in a single stock (>15% of portfolio) or "
            "sector (>40%). Correlation matters: holding 20 tech stocks isn't real "
            "diversification."
        ),
    ),
    KnowledgeSnippet(
        topic="Risk and Time Horizon",
        tags=["risk", "time_horizon", "long_term", "short_term"],
        content=(
            "Time horizon drives appropriate risk level:\n"
            "- <3 years: capital preservation (HYSA, T-bills, short-term bonds).\n"
            "- 3-10 years: moderate stock allocation (40-70%), balanced funds.\n"
            "- 10+ years: heavier stock tilt (80-100%), growth bias acceptable.\n"
            "Historical S&P 500 annualized returns: ~10% nominal, ~7% real. "
            "But 20-40% drawdowns happen every 5-10 years. Don't invest money "
            "you'll need within 3 years."
        ),
    ),
    KnowledgeSnippet(
        topic="Tax-Advantaged Accounts (US)",
        tags=["tax", "roth", "ira", "401k", "hsa"],
        content=(
            "Prioritize these before taxable brokerage accounts:\n"
            "- 401(k): employer match is a 100% instant return. Always capture "
            "the match first.\n"
            "- Roth IRA: up to $7,000/year (2025); tax-free growth and tax-free "
            "withdrawals in retirement. Best for young investors with long horizons.\n"
            "- HSA (if eligible): triple tax-advantaged (deductible, tax-free growth, "
            "tax-free for qualified medical).\n"
            "- Traditional IRA: tax-deductible contributions, taxed on withdrawal.\n"
            "Taxable brokerage: no contribution limits, full flexibility, less tax-efficient."
        ),
    ),
    KnowledgeSnippet(
        topic="Dividend Investing",
        tags=["dividend", "income", "retirement"],
        content=(
            "Dividend strategies pay regular cash income:\n"
            "- Dividend Aristocrats: S&P 500 companies with 25+ years of "
            "consecutive dividend increases.\n"
            "- ETFs: SCHD (Schwab US Dividend), VYM (Vanguard High Yield), "
            "NOBL (Aristocrats).\n"
            "- Individual: JNJ, PG, KO, PEP, VZ, T, O (monthly).\n"
            "Total return (price appreciation + dividends) matters more than "
            "yield in isolation. A 6% yielder losing 20% of share price underperforms "
            "a 2% yielder that grows."
        ),
    ),
    KnowledgeSnippet(
        topic="Common Beginner Mistakes",
        tags=["beginner", "mistakes", "student"],
        content=(
            "Common pitfalls for new investors:\n"
            "1. Timing the market instead of time IN the market.\n"
            "2. Over-trading — each trade has cost, tax, and emotional drag.\n"
            "3. Chasing recent winners (performance reversion is real).\n"
            "4. No emergency fund first (3-6 months expenses in HYSA).\n"
            "5. Concentrated single-stock positions.\n"
            "6. Paying high expense ratios (>0.5% is expensive in 2026).\n"
            "7. Panic-selling during drawdowns — most bull runs happen from "
            "the depths of bear markets.\n"
            "8. Not automating contributions (friction = inaction)."
        ),
    ),
    KnowledgeSnippet(
        topic="Growth vs Value Investing",
        tags=["growth", "value", "style"],
        content=(
            "- Growth: companies with above-average earnings expansion (tech, "
            "biotech). Higher P/E, lower dividends. Examples: NVDA, AMD, SHOP.\n"
            "- Value: undervalued companies relative to fundamentals (low P/E, "
            "stable cash flows). Examples: BRK-B, JPM, XOM.\n"
            "Growth outperforms in low-rate, high-liquidity regimes. Value tends "
            "to outperform when rates rise or in recovery phases. Factor ETFs: "
            "VUG (growth), VTV (value)."
        ),
    ),
    KnowledgeSnippet(
        topic="Market Regimes and Macro",
        tags=["macro", "fed", "rates", "regime", "market"],
        content=(
            "Interest rates drive asset prices heavily:\n"
            "- Low rates: favor growth stocks, long-duration assets (tech, "
            "biotech).\n"
            "- Rising rates: pressure growth, favor value, financials, and "
            "commodities.\n"
            "- Inverted yield curve: historically precedes recessions (but "
            "timing is uncertain).\n"
            "- VIX (volatility index): >30 signals fear, <15 signals complacency.\n"
            "The Fed's dual mandate (price stability + employment) drives "
            "rate policy. Watch FOMC meetings and dot plots."
        ),
    ),
    KnowledgeSnippet(
        topic="Options and Leverage — Caution",
        tags=["options", "leverage", "risk", "beginner"],
        content=(
            "Options, margin, and leveraged ETFs (TQQQ, SOXL) can amplify "
            "gains AND losses significantly. Beginners should avoid:\n"
            "- Naked call/put selling.\n"
            "- Short-dated options (0DTE).\n"
            "- Margin trading without understanding maintenance calls.\n"
            "- Leveraged ETFs held long-term (they suffer from volatility decay).\n"
            "Start with long stock/ETF positions. Once comfortable with cash "
            "investing, covered calls and cash-secured puts are reasonable "
            "entry points to options."
        ),
    ),
    KnowledgeSnippet(
        topic="Key Financial Ratios",
        tags=["ratio", "fundamentals", "education"],
        content=(
            "Core valuation ratios:\n"
            "- P/E (Price/Earnings): price ÷ earnings per share. Lower = cheaper "
            "relative to earnings.\n"
            "- P/B (Price/Book): price ÷ book value. <1 often signals distressed "
            "or undervalued.\n"
            "- P/S (Price/Sales): useful when earnings are negative (growth stocks).\n"
            "- EV/EBITDA: enterprise value ÷ EBITDA; accounts for debt.\n"
            "- PEG: P/E ÷ earnings growth rate; <1 is attractive.\n"
            "- ROE: net income ÷ equity; measures capital efficiency.\n"
            "- Debt/Equity: leverage indicator; <1 is typically healthy."
        ),
    ),
]


class FinanceKnowledgeBase:
    """Keyword + tag based snippet retriever."""

    def __init__(self, snippets: List[KnowledgeSnippet] = None):
        self.snippets = snippets or KNOWLEDGE_BASE

    def search(self, query: str, limit: int = 3) -> List[KnowledgeSnippet]:
        """Return snippets whose tags or topic match query keywords."""
        lower = query.lower()
        scored = []
        for snip in self.snippets:
            score = 0
            # Tag matches are strong
            for tag in snip.tags:
                if tag.replace("_", " ") in lower or tag in lower:
                    score += 3
            # Topic word matches
            for word in snip.topic.lower().split():
                if len(word) > 3 and word in lower:
                    score += 1
            # Content word matches (weak signal)
            content_lower = snip.content.lower()
            for word in lower.split():
                if len(word) > 4 and word in content_lower:
                    score += 0.5

            if score > 0:
                scored.append((score, snip))

        scored.sort(key=lambda x: -x[0])
        return [s for _, s in scored[:limit]]


_kb = FinanceKnowledgeBase()


def get_knowledge_snippets(query: str, limit: int = 3) -> str:
    """Get formatted knowledge snippets for LLM context injection."""
    snippets = _kb.search(query, limit)
    if not snippets:
        return ""
    formatted = []
    for s in snippets:
        formatted.append(f"### {s.topic}\n{s.content}")
    return "\n\n".join(formatted)
