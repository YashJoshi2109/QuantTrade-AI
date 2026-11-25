"""
Shared financial-news sentiment classifier (ProsusAI/finbert, int8 ONNX).

Runtime is onnxruntime + `tokenizers` only (no torch/transformers import).
The model files are exported at image build time (app/services/news_intel/export_models.py).

The model is loaded ONLY in processes that opt in with NEWS_INTEL_MODELS=1 —
the news-worker sets it; the API process never does. Without it (or if the
model files are missing) every call uses the deterministic keyword fallback.

score = P(positive) - P(negative)  in [-1, 1]
confidence = max class probability
label = bullish | bearish | neutral (argmax)

Env:
  NEWS_INTEL_MODELS=1     allow loading the ONNX models in this process (default 0)
  NEWS_MODELS_DIR         model directory (default /opt/news-models)
  NEWS_INTEL_THREADS=1    onnxruntime intra-op threads
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

MAX_TOKENS = 96  # headlines + short summaries; FinBERT allows 512 but cost is quadratic
DEFAULT_BATCH = 16


def models_enabled() -> bool:
    return os.environ.get("NEWS_INTEL_MODELS", "0") == "1"


@dataclass
class Sentiment:
    label: str          # bullish | bearish | neutral
    score: float        # P(pos) - P(neg), [-1, 1]
    confidence: float   # max class probability, [0, 1]
    probs: Dict[str, float]  # {"bullish", "bearish", "neutral"}
    model: str = "finbert"

    def as_api(self) -> Dict[str, float | str]:
        return {"label": self.label, "score": self.score, "confidence": self.confidence}

    def legacy_label(self) -> str:
        """Capitalised label used by the old /news endpoints."""
        return self.label.capitalize()

    def to_dict(self) -> dict:
        return asdict(self)


# ── Deterministic keyword fallback (API process, or model unavailable) ─────
_BULL = re.compile(
    r"\b(surges?|soars?|jumps?|rall(?:y|ies)|gains?|climbs?|rises?|record high|all-time high|"
    r"beats?|tops?|exceeds?|upgrades?d?|outperform|raises? (?:guidance|outlook|forecast|dividend)|"
    r"boosts?|strong|growth|profit(?:able)?|rebounds?|recover(?:y|s)?|bullish|buyback)\b",
    re.I,
)
_BEAR = re.compile(
    r"\b(plunges?|plummets?|crash(?:es)?|tumbles?|drops?|falls?|declines?|slumps?|sinks?|slides?|"
    r"sell-?off|misses?|downgrades?d?|underperform|cuts? (?:guidance|outlook|forecast|dividend|jobs)|"
    r"warns?|warning|loss(?:es)?|weak|layoffs?|lawsuit|probe|fraud|recession|bankrupt(?:cy)?|bearish|recall)\b",
    re.I,
)


def keyword_sentiment(text: str) -> Sentiment:
    bull = len(_BULL.findall(text or ""))
    bear = len(_BEAR.findall(text or ""))
    if bull == bear:
        return Sentiment("neutral", 0.0, 0.5, {"bullish": 0.25, "bearish": 0.25, "neutral": 0.5}, "keyword")
    total = bull + bear
    score = round((bull - bear) / (total + 1), 4)
    conf = round(min(0.5 + abs(score) / 2, 0.8), 4)
    label = "bullish" if score > 0 else "bearish"
    p_pos = max(score, 0.0) + (1 - abs(score)) / 3
    p_neg = max(-score, 0.0) + (1 - abs(score)) / 3
    return Sentiment(label, score, conf,
                     {"bullish": round(p_pos, 4), "bearish": round(p_neg, 4),
                      "neutral": round(1 - p_pos - p_neg, 4)}, "keyword")


def sentiment_text(title: str, summary: Optional[str] = None) -> str:
    """Text fed to the model: the title, plus the summary when it is short."""
    title = (title or "").strip()
    summary = (summary or "").strip()
    if summary and len(summary) <= 240 and summary.lower() != title.lower():
        return f"{title}. {summary}"
    return title


class SentimentClassifier:
    """Thread-safe lazy FinBERT (ONNX int8) wrapper with batching and a keyword fallback."""

    def __init__(self, model_dir=None):
        self.model_dir = model_dir
        self._model = None           # FinbertOnnx, or any object with .probs(texts)
        self._id2label: Dict[int, str] = {}
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()
        self._load_attempted = False
        self.load_seconds: Optional[float] = None
        self.load_error: Optional[str] = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def backend(self) -> str:
        return "finbert-onnx-int8" if self.loaded else "keyword"

    def load(self) -> bool:
        """Load FinBERT once (only when NEWS_INTEL_MODELS=1). True when usable."""
        if self._model is not None:
            return True
        if not models_enabled():
            return False
        with self._load_lock:
            if self._model is not None or self._load_attempted:
                return self._model is not None
            self._load_attempted = True
            t0 = time.perf_counter()
            try:
                from app.services.news_intel.onnx_models import FinbertOnnx

                model = FinbertOnnx(self.model_dir, max_length=MAX_TOKENS)
                self._id2label = model.id2label
                self._model = model
                self.load_seconds = round(time.perf_counter() - t0, 2)
                logger.info("FinBERT (ONNX int8) loaded in %.2fs", self.load_seconds)
                return True
            except Exception as e:
                self.load_error = f"{type(e).__name__}: {e}"
                logger.warning("FinBERT unavailable, using keyword fallback: %s", self.load_error)
                return False

    def _infer(self, texts: List[str]) -> List[Sentiment]:
        with self._infer_lock:
            probs = self._model.probs(texts)
        name_map = {"positive": "bullish", "negative": "bearish", "neutral": "neutral"}
        out: List[Sentiment] = []
        for row in probs:
            p = {name_map.get(self._id2label.get(i, ""), f"c{i}"): float(v) for i, v in enumerate(row)}
            pos, neg, neu = p.get("bullish", 0.0), p.get("bearish", 0.0), p.get("neutral", 0.0)
            label = max(("bullish", pos), ("bearish", neg), ("neutral", neu), key=lambda kv: kv[1])[0]
            out.append(Sentiment(
                label=label,
                score=round(pos - neg, 4),
                confidence=round(max(pos, neg, neu), 4),
                probs={"bullish": round(pos, 4), "bearish": round(neg, 4), "neutral": round(neu, 4)},
                model=self.backend,
            ))
        return out

    def classify(self, texts: Sequence[str], batch_size: int = DEFAULT_BATCH,
                 load: bool = True) -> List[Sentiment]:
        """Classify texts (blocking; call from a worker thread in async code)."""
        texts = [(t or "").strip() for t in texts]
        if not texts:
            return []
        ready = self.load() if load else self.loaded
        if not ready:
            return [keyword_sentiment(t) for t in texts]
        results: List[Sentiment] = []
        for i in range(0, len(texts), max(1, batch_size)):
            chunk = texts[i:i + batch_size]
            try:
                results.extend(self._infer([t or "." for t in chunk]))
            except Exception as e:
                logger.error("FinBERT inference failed, keyword fallback: %s", e)
                results.extend(keyword_sentiment(t) for t in chunk)
        return results

    def classify_one(self, text: str) -> Sentiment:
        return self.classify([text])[0]


_classifier: Optional[SentimentClassifier] = None
_singleton_lock = threading.Lock()


def get_sentiment_classifier() -> SentimentClassifier:
    global _classifier
    if _classifier is None:
        with _singleton_lock:
            if _classifier is None:
                _classifier = SentimentClassifier()
    return _classifier


def set_sentiment_classifier(clf) -> None:
    """Test hook: swap the process-wide classifier."""
    global _classifier
    _classifier = clf


def classify_texts(texts: Sequence[str]) -> List[Sentiment]:
    return get_sentiment_classifier().classify(texts)


def legacy_labels(titles: Sequence[str], contents: Optional[Sequence[str]] = None) -> List[str]:
    """'Bullish' / 'Bearish' / 'Neutral' for the legacy /news endpoints."""
    contents = contents or [""] * len(titles)
    texts = [sentiment_text(t, c) for t, c in zip(titles, contents)]
    return [s.legacy_label() for s in classify_texts(texts)]
