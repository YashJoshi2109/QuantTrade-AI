"""Shared constants for the copilot NLP pipeline.

Keep word lists deduplicated here so intent classification, entity extraction,
and routing all use the same vocabulary.
"""

# ── Stop words — pure English grammar ──────────────────────────────────
STOP_WORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "his", "how",
    "its", "may", "new", "now", "old", "see", "way", "who", "did",
    "get", "let", "say", "she", "too", "use", "give", "show", "tell",
    "what", "which", "about", "please",
    "with", "from", "this", "that", "have", "will", "been", "some",
    "like", "just", "also", "more", "much", "very", "most", "make",
    # Pronouns / determiners / filler
    "am", "is", "be", "do", "me", "my", "we", "us", "they", "them",
    "he", "him", "it", "if", "so", "as", "or", "to", "on", "at", "by",
    "in", "of", "up", "an", "a",
    "should", "would", "could", "might", "must",
}

# ── Finance vocabulary that SHOULDN'T resolve to a ticker ─────────────
FINANCE_VOCAB_STOP = {
    "stock", "stocks", "price", "share", "shares", "market", "trade",
    "buy", "sell", "hold", "analysis", "analyze", "research", "review",
    "comprehensive", "deep", "dive",
    "top", "best", "worst", "compare", "versus", "sector", "sectors",
    "gainers", "losers", "performance", "prediction", "forecast",
    "overview", "insight", "breakdown", "today", "current",
    "bullish", "bearish", "neutral", "volatile", "volatility",
    "dividend", "dividends", "yield", "earnings", "revenue",
    "valuation", "valuations", "undervalued", "overvalued",
}

# ── Currency / money / amount words — NEVER treat as company names ────
CURRENCY_AND_MONEY_WORDS = {
    "dollar", "dollars", "usd", "cent", "cents", "buck", "bucks",
    "money", "cash", "amount", "budget", "savings", "saving",
    "capital", "fund", "funds", "investment", "invest", "investing",
    "invested", "portfolio", "wealth", "income", "salary", "pay",
    "euro", "euros", "pound", "pounds", "rupee", "rupees", "yen",
    "crypto", "coin", "coins",  # generic — specific ones like BTC are tickers
}

# ── Common English words that commonly fuzzy-match company names badly ──
COMMON_ENGLISH_WORDS = {
    "good", "growth", "student", "students", "beginner", "beginners",
    "long", "term", "short", "fast", "slow", "safe", "risky",
    "small", "large", "big", "huge", "tiny", "great", "nice",
    "think", "know", "want", "need", "like", "love", "hate",
    "easy", "hard", "quick", "strong", "weak", "high", "low",
    "year", "years", "month", "months", "week", "weeks", "day", "days",
    "time", "times", "wait", "waiting", "waits", "future", "past",
    "start", "started", "starting", "begin", "began", "beginning",
    "help", "helps", "helping", "thanks", "thank",
    "really", "actually", "maybe", "probably", "possibly",
    "first", "second", "third", "last", "next", "previous",
    "ones", "once", "only", "even", "still", "always", "never",
    "onces",  # common typo for "once"
    "looking", "look", "looked", "looks", "found", "find", "finding",
    "think", "about", "really", "quite", "into", "over", "under",
    "down", "well", "very", "just", "many", "any", "some", "every",
    "advice", "advise", "suggest", "recommend", "recommendation",
    "question", "answer", "answers", "questions", "explain", "explanation",
    "please", "kindly", "maybe", "perhaps",
}

# Merge all blocked-as-company-name sets for fast lookup
BLOCKED_AS_COMPANY_NAME = (
    STOP_WORDS
    | FINANCE_VOCAB_STOP
    | CURRENCY_AND_MONEY_WORDS
    | COMMON_ENGLISH_WORDS
)


# ── Intent keyword hints ───────────────────────────────────────────────
COMPARISON_KEYWORDS = [
    "compare", "vs", "versus", "against", "difference between",
    "better than", "worse than", "side by side",
]

SCREENER_KEYWORDS = [
    "top gainers", "top losers", "gainers", "losers", "screener",
    "movers", "biggest movers", "hot stocks", "trending stocks",
    "most active", "volume leaders",
]

SECTOR_KEYWORDS = [
    "sector performance", "sectors", "sector breakdown", "which sectors",
    "sector rotation", "industry group", "sector allocation",
]

ANALYSIS_KEYWORDS = [
    "analyze", "analysis", "research", "deep dive", "breakdown",
    "review", "overview", "insight", "outlook", "forecast",
    "fundamentals", "technicals", "valuation",
]

GREETING_KEYWORDS = [
    "hi", "hello", "hey", "good morning", "good afternoon",
    "good evening", "yo", "sup", "howdy",
]

EDUCATION_KEYWORDS = [
    "what is", "what are", "explain", "definition", "define",
    "how does", "how do", "what does", "meaning of",
]

# Phrases that indicate the user wants GENERAL investing guidance,
# not analysis of any specific ticker.
GENERAL_ADVICE_PATTERNS = [
    r"\bwhich\s+stock",
    r"\bwhat\s+stock",
    r"\bshould\s+i\s+(?:buy|invest|put|hold|pick)",
    r"\brecommend(?:\s+me)?\b",
    r"\bsuggest(?:\s+me)?\b",
    r"\bi\s+(?:am|'m)\s+(?:a\s+)?(?:student|beginner|new)",
    r"\bi\s+have\s+\$?\d",  # "I have $500" / "I have 500"
    r"\bwhere\s+should\s+i\s+(?:invest|put)",
    r"\bhow\s+(?:do|should|can)\s+i\s+(?:invest|start|begin)",
    r"\bany\s+(?:good|hot|top)\s+(?:stock|pick)",
    r"\bfor\s+(?:long\s+term|growth|dividend|retirement|beginners)",
    r"\bgood\s+(?:amount\s+of\s+)?growth",
    r"\bwith\s+\$?\d+",  # "with $500"
    r"\binvestment\s+idea",
]

# Portfolio-level questions (diversification, rebalancing, allocation)
PORTFOLIO_ADVICE_PATTERNS = [
    r"\bdiversif",
    r"\brebalanc",
    r"\ballocation",
    r"\basset\s+allocation",
    r"\bmy\s+portfolio",
    r"\brisk\s+tolerance",
    r"\bhow\s+much\s+(?:should|to\s+)?allocate",
]

# Off-topic filter — clearly non-financial queries
OFF_TOPIC_PATTERNS = [
    r"\brecipe",
    r"\bcook",
    r"\bweather",
    r"\bsports\s+score",
    r"\btell\s+me\s+a\s+joke",
    r"\bwrite\s+a\s+poem",
    r"\bcode\s+me",
]

# Confidence thresholds
HIGH_CONFIDENCE = 0.9
MEDIUM_CONFIDENCE = 0.6
LOW_CONFIDENCE = 0.3
