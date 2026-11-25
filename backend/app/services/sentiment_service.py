"""
Financial sentiment for community posts.

Thin adapter over the shared FinBERT classifier in
app.services.news_intel.sentiment, so the process holds ONE copy of the model
(news pipeline, legacy news endpoints and community posts all share it).
The deterministic keyword fallback lives there too and is used only if the
model cannot load.
"""
import hashlib
import logging
from dataclasses import dataclass
from typing import Dict, List

from app.services.news_intel.sentiment import get_sentiment_classifier

logger = logging.getLogger(__name__)


@dataclass
class SentimentResult:
    label: str          # bullish, bearish, neutral
    confidence: float   # 0.0 - 1.0
    scores: Dict[str, float]  # {bullish: 0.8, bearish: 0.1, neutral: 0.1}


_NEUTRAL = SentimentResult("neutral", 0.5, {"bullish": 0.33, "bearish": 0.33, "neutral": 0.34})


class SentimentService:
    """Community-post sentiment backed by the shared news classifier."""

    def __init__(self):
        self._cache: Dict[str, SentimentResult] = {}

    def _cache_key(self, text: str) -> str:
        return hashlib.md5(text[:500].encode()).hexdigest()

    def score_batch(self, texts: List[str]) -> List[SentimentResult]:
        out: List[SentimentResult] = [_NEUTRAL] * len(texts)
        todo = []
        for i, t in enumerate(texts):
            if not t or len(t.strip()) < 10:
                continue
            k = self._cache_key(t)
            if k in self._cache:
                out[i] = self._cache[k]
            else:
                todo.append((i, k, t[:1000]))
        if todo:
            results = get_sentiment_classifier().classify([t for _, _, t in todo])
            if len(self._cache) > 5000:
                self._cache.clear()
            for (i, k, _), r in zip(todo, results):
                res = SentimentResult(r.label, r.confidence, dict(r.probs))
                self._cache[k] = res
                out[i] = res
        return out

    def score_text(self, text: str) -> SentimentResult:
        """Score a single text (blocking; call from a worker thread in async code)."""
        return self.score_batch([text])[0]


# Module-level singleton
sentiment_service = SentimentService()
