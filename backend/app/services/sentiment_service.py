"""
Financial sentiment analysis service using FinBERT.

Provides bullish/bearish/neutral scoring for community posts and news.
Uses ProsusAI/finbert — pretrained on financial text, zero training needed.
Falls back to keyword heuristics if model unavailable.
"""
import logging
import hashlib
from typing import Optional, List, Dict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class SentimentResult:
    label: str          # bullish, bearish, neutral
    confidence: float   # 0.0 - 1.0
    scores: Dict[str, float]  # {bullish: 0.8, bearish: 0.1, neutral: 0.1}


# Keyword fallback when model is unavailable
BULLISH_WORDS = frozenset({
    "buy", "long", "bull", "calls", "moon", "rocket", "breakout",
    "undervalued", "upside", "gains", "rally", "surge", "green",
    "accumulate", "support", "oversold", "dip", "opportunity",
})
BEARISH_WORDS = frozenset({
    "sell", "short", "bear", "puts", "crash", "overvalued", "dump",
    "downside", "red", "correction", "resistance", "overbought",
    "decline", "drop", "plunge", "recession", "bubble",
})


def _keyword_sentiment(text: str) -> SentimentResult:
    """Simple keyword-based fallback sentiment."""
    words = set(text.lower().split())
    bull = len(words & BULLISH_WORDS)
    bear = len(words & BEARISH_WORDS)
    total = bull + bear
    if total == 0:
        return SentimentResult("neutral", 0.5, {"bullish": 0.33, "bearish": 0.33, "neutral": 0.34})
    if bull > bear:
        conf = min(bull / (total + 1), 0.85)
        return SentimentResult("bullish", conf, {"bullish": conf, "bearish": 1 - conf - 0.1, "neutral": 0.1})
    if bear > bull:
        conf = min(bear / (total + 1), 0.85)
        return SentimentResult("bearish", conf, {"bullish": 1 - conf - 0.1, "bearish": conf, "neutral": 0.1})
    return SentimentResult("neutral", 0.5, {"bullish": 0.4, "bearish": 0.4, "neutral": 0.2})


class SentimentService:
    """Financial sentiment analysis with FinBERT + keyword fallback."""

    def __init__(self):
        self._pipeline = None
        self._cache: Dict[str, SentimentResult] = {}
        self._model_loaded = False

    def _load_model(self):
        """Lazy-load FinBERT. Falls back to keywords if unavailable."""
        if self._model_loaded:
            return
        self._model_loaded = True
        try:
            from transformers import pipeline
            self._pipeline = pipeline(
                "sentiment-analysis",
                model="ProsusAI/finbert",
                tokenizer="ProsusAI/finbert",
                device=-1,  # CPU
                truncation=True,
                max_length=512,
            )
            logger.info("FinBERT model loaded successfully")
        except Exception as e:
            logger.warning(f"FinBERT unavailable, using keyword fallback: {e}")
            self._pipeline = None

    def _cache_key(self, text: str) -> str:
        return hashlib.md5(text[:500].encode()).hexdigest()

    def score_text(self, text: str) -> SentimentResult:
        """Score a single text for financial sentiment."""
        if not text or len(text.strip()) < 10:
            return SentimentResult("neutral", 0.5, {"bullish": 0.33, "bearish": 0.33, "neutral": 0.34})

        # Check cache
        key = self._cache_key(text)
        if key in self._cache:
            return self._cache[key]

        self._load_model()

        if self._pipeline is None:
            result = _keyword_sentiment(text)
        else:
            try:
                # FinBERT outputs: positive, negative, neutral
                output = self._pipeline(text[:512])[0]
                label_map = {"positive": "bullish", "negative": "bearish", "neutral": "neutral"}
                label = label_map.get(output["label"], "neutral")
                confidence = round(output["score"], 4)

                # Get all scores
                all_outputs = self._pipeline(text[:512], top_k=3)
                scores = {}
                for o in all_outputs:
                    mapped = label_map.get(o["label"], o["label"])
                    scores[mapped] = round(o["score"], 4)

                result = SentimentResult(label, confidence, scores)
            except Exception as e:
                logger.error(f"FinBERT inference failed: {e}")
                result = _keyword_sentiment(text)

        # Cache (limit size)
        if len(self._cache) > 5000:
            self._cache.clear()
        self._cache[key] = result
        return result

    def score_batch(self, texts: List[str]) -> List[SentimentResult]:
        """Score multiple texts."""
        return [self.score_text(t) for t in texts]


# Module-level singleton
sentiment_service = SentimentService()
