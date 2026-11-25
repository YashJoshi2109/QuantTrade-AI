"""
Headline categorizer: high-precision regex rules first, then a MiniLM
nearest-centroid fallback for anything the rules miss.

Centroids = mean L2-normalised embedding of the SEEDS headlines per category.
A headline whose best cosine similarity is below EMBED_MIN_SIM is "other".

The embedding model is all-MiniLM-L6-v2 exported to int8 ONNX at build time
(onnxruntime + tokenizers at runtime, no torch). It loads only when
NEWS_INTEL_MODELS=1 (the news-worker); otherwise the categorizer is rules-only.

Env: NEWS_INTEL_EMBED_MIN_SIM (default 0.30), NEWS_MODELS_DIR.
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from app.services.news_intel.categories import CATEGORY_KEYS, PRIORITY, SEEDS, rule_categories

logger = logging.getLogger(__name__)

EMBED_MIN_SIM = float(os.environ.get("NEWS_INTEL_EMBED_MIN_SIM", "0.30"))


@dataclass
class CategoryResult:
    categories: List[str]
    primary: str
    method: str  # rules | embedding | none
    similarity: Optional[float] = None
    extra: Dict[str, float] = field(default_factory=dict)


class Categorizer:
    def __init__(self, model_dir=None, min_sim: float = EMBED_MIN_SIM):
        self.model_dir = model_dir
        self.min_sim = min_sim
        self._model = None
        self._centroids = None  # np.ndarray [n_cat, dim]
        self._centroid_keys: List[str] = []
        self._lock = threading.Lock()
        self._attempted = False
        self.load_error: Optional[str] = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> bool:
        if self._model is not None:
            return True
        from app.services.news_intel.sentiment import models_enabled

        if not models_enabled():
            return False
        with self._lock:
            if self._model is not None or self._attempted:
                return self._model is not None
            self._attempted = True
            try:
                import numpy as np
                from app.services.news_intel.onnx_models import MiniLMOnnx

                model = MiniLMOnnx(self.model_dir)
                keys, cents = [], []
                for key in CATEGORY_KEYS:
                    seeds = SEEDS.get(key) or []
                    if not seeds:
                        continue
                    # "other" gets a centroid too (generic market wraps), so
                    # those don't get forced into the nearest real category.
                    emb = model.embed(seeds)
                    c = emb.mean(axis=0)
                    cents.append(c / (np.linalg.norm(c) or 1.0))
                    keys.append(key)
                self._centroids = np.vstack(cents)
                self._centroid_keys = keys
                self._model = model
                logger.info("Categorizer embedding model loaded (%d centroids)", len(keys))
                return True
            except Exception as e:
                self.load_error = f"{type(e).__name__}: {e}"
                logger.warning("Categorizer embedding model unavailable, rules only: %s", self.load_error)
                return False

    def _embed_classify(self, texts: List[str]) -> List[tuple]:
        import numpy as np

        emb = np.vstack([self._model.embed(texts[i:i + 32]) for i in range(0, len(texts), 32)])
        sims = emb @ self._centroids.T
        out = []
        for row in sims:
            i = int(row.argmax())
            out.append((self._centroid_keys[i], float(row[i])))
        return out

    def classify(self, texts: Sequence[str], use_embeddings: bool = True) -> List[CategoryResult]:
        results: List[Optional[CategoryResult]] = []
        pending: List[int] = []
        for i, t in enumerate(texts):
            cats = rule_categories(t or "")
            if cats:
                results.append(CategoryResult(cats, cats[0], "rules"))
            else:
                results.append(None)
                pending.append(i)
        if pending and use_embeddings and self.load():
            try:
                preds = self._embed_classify([texts[i] or "" for i in pending])
                for i, (key, sim) in zip(pending, preds):
                    if sim >= self.min_sim:
                        results[i] = CategoryResult([key], key, "embedding", round(sim, 4))
                    else:
                        results[i] = CategoryResult(["other"], "other", "embedding", round(sim, 4))
            except Exception as e:
                logger.error("Embedding categorization failed: %s", e)
        return [r or CategoryResult(["other"], "other", "none") for r in results]


def order_categories(cats: Sequence[str]) -> List[str]:
    return sorted(set(cats), key=lambda k: PRIORITY.get(k, 999))


_categorizer: Optional[Categorizer] = None


def get_categorizer() -> Categorizer:
    global _categorizer
    if _categorizer is None:
        _categorizer = Categorizer()
    return _categorizer


def set_categorizer(c) -> None:
    global _categorizer
    _categorizer = c
