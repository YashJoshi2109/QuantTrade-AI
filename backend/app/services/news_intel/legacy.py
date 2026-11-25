"""
Sentiment for the legacy /news endpoints without loading any model in the API.

1. Look the article up in news_items (already FinBERT-scored by the news-worker)
   by canonical-URL hash or normalized-title hash.
2. Otherwise use the deterministic keyword rule.

Blocking (one indexed DB query per call); call from sync handlers or a thread.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Sequence, Tuple

from app.services.news_intel.dedupe import title_hash, url_hash
from app.services.news_intel.sentiment import Sentiment, keyword_sentiment, sentiment_text

logger = logging.getLogger(__name__)


def _lookup(url_hashes: List[str], title_hashes: List[str], session_factory=None) -> Tuple[Dict, Dict]:
    by_url: Dict[str, Sentiment] = {}
    by_title: Dict[str, Sentiment] = {}
    uh = [h for h in set(url_hashes) if h]
    th = [h for h in set(title_hashes) if h]
    if not uh and not th:
        return by_url, by_title
    try:
        if session_factory is None:
            from app.db.database import SessionLocal as session_factory  # noqa: N811
        if session_factory is None:
            return by_url, by_title
        from sqlalchemy import or_

        from app.models.news_item import NewsItem

        db = session_factory()
        try:
            conds = []
            if uh:
                conds.append(NewsItem.url_hash.in_(uh))
            if th:
                conds.append(NewsItem.title_hash.in_(th))
            rows = (
                db.query(NewsItem.url_hash, NewsItem.title_hash, NewsItem.sentiment_label,
                         NewsItem.sentiment_score, NewsItem.sentiment_confidence)
                .filter(or_(*conds))
                .limit(500)
                .all()
            )
        finally:
            db.close()
        for u, t, label, score, conf in rows:
            s = Sentiment(label or "neutral", float(score or 0.0), float(conf or 0.0), {}, "news_items")
            if u:
                by_url[u] = s
            if t:
                by_title[t] = s
    except Exception as e:
        logger.debug("news_items sentiment lookup failed: %s", e)
    return by_url, by_title


def sentiments_for(articles: Sequence[dict], *, title_key: str = "title", url_key: str = "url",
                   content_keys: Sequence[str] = ("content", "summary"),
                   session_factory=None) -> List[Sentiment]:
    titles = [(a.get(title_key) or "") for a in articles]
    uhs = [url_hash(a.get(url_key)) for a in articles]
    ths = [title_hash(t) if t else "" for t in titles]
    by_url, by_title = _lookup(uhs, ths, session_factory)
    out: List[Sentiment] = []
    for a, t, u, h in zip(articles, titles, uhs, ths):
        hit: Optional[Sentiment] = by_url.get(u) if u else None
        hit = hit or (by_title.get(h) if h else None)
        if hit is None:
            content = next((a.get(k) for k in content_keys if a.get(k)), "")
            hit = keyword_sentiment(sentiment_text(t, content))
        out.append(hit)
    return out


def apply_legacy_sentiment(articles: List[dict], *, score_key: Optional[str] = "sentiment_score", **kw) -> None:
    """Set 'sentiment' (Bullish/Bearish/Neutral) and optionally the score, in place."""
    if not articles:
        return
    for a, s in zip(articles, sentiments_for(articles, **kw)):
        a["sentiment"] = s.legacy_label()
        if score_key:
            a[score_key] = s.score
