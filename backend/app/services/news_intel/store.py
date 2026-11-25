"""
news_items persistence and feed queries. All functions are synchronous
(SQLAlchemy ORM); async callers run them with asyncio.to_thread.
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import String, cast, func
from sqlalchemy.orm import Session

from app.models.news_item import NewsItem

logger = logging.getLogger(__name__)

MAX_SOURCES_KEPT = 25
SORTS = {"latest", "impact", "bullish", "bearish"}
SENTIMENTS = {"bullish", "bearish", "neutral"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    dt = _aware(dt)
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def serialize(row: NewsItem) -> Dict[str, Any]:
    """API shape for /news/feed items and WebSocket pushes (do not change)."""
    sources = row.sources or []
    return {
        "id": row.id,
        "cluster_id": row.cluster_id,
        "title": row.title,
        "summary": row.summary or "",
        "url": row.url or "",
        "source": row.source or "",
        "sources_count": int(row.sources_count or len(sources) or 1),
        "sources": sources,
        "published_at": _iso(row.published_at),
        "ingested_at": _iso(row.ingested_at),
        "tickers": list(row.tickers or []),
        "categories": list(row.categories or []),
        "primary_category": row.primary_category or "other",
        "sentiment": {
            "label": row.sentiment_label or "neutral",
            "score": float(row.sentiment_score or 0.0),
            "confidence": float(row.sentiment_confidence or 0.0),
        },
        "impact": int(row.impact or 0),
        "ai": row.ai or None,
        "image_url": row.image_url or None,
    }


def _is_pg(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def _array_contains(db: Session, col, value: str):
    if _is_pg(db):
        from sqlalchemy.dialects.postgresql import ARRAY, array

        return col.op("@>")(cast(array([value]), ARRAY(String)))
    # SQLite/tests: JSON text column
    return cast(col, String).like(f'%"{value}"%')


# ── writes ──────────────────────────────────────────────────────────────

def insert_item(db: Session, data: Dict[str, Any]) -> NewsItem:
    row = NewsItem(**data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_by_cluster(db: Session, cluster_id: str) -> Optional[NewsItem]:
    return db.query(NewsItem).filter(NewsItem.cluster_id == cluster_id).first()


def add_source(db: Session, cluster_id: str, entry: Dict[str, Any],
               extra_tickers: Iterable[str] = (), image_url: Optional[str] = None) -> Optional[NewsItem]:
    """Attach another outlet's copy to a cluster. Returns the row, or None if
    the cluster is unknown or the source URL was already attached."""
    row = get_by_cluster(db, cluster_id)
    if row is None:
        return None
    sources = list(row.sources or [])
    url = entry.get("url")
    if url and any(s.get("url") == url for s in sources):
        return None
    if len(sources) < MAX_SOURCES_KEPT:
        sources.append(entry)
    row.sources = sources
    row.sources_count = int(row.sources_count or 1) + 1
    merged = list(row.tickers or [])
    for t in extra_tickers:
        if t not in merged:
            merged.append(t)
    row.tickers = merged[:10]
    if image_url and not row.image_url:
        row.image_url = image_url
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return row


def set_impact(db: Session, row: NewsItem, impact: int) -> None:
    row.impact = impact
    db.commit()


def set_ai(db: Session, cluster_id: str, ai: Dict[str, Any]) -> Optional[NewsItem]:
    row = get_by_cluster(db, cluster_id)
    if row is None:
        return None
    row.ai = ai
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return row


def prune(db: Session, days: int = 14) -> int:
    cutoff = utcnow() - timedelta(days=days)
    n = db.query(NewsItem).filter(NewsItem.published_at < cutoff).delete(synchronize_session=False)
    db.commit()
    return int(n or 0)


# ── reads ───────────────────────────────────────────────────────────────

def recent_for_seed(db: Session, hours: int = 24) -> List[NewsItem]:
    cutoff = utcnow() - timedelta(hours=hours)
    return (
        db.query(NewsItem)
        .filter(NewsItem.ingested_at >= cutoff)
        .order_by(NewsItem.ingested_at.asc())
        .limit(20000)
        .all()
    )


def _filtered(db: Session, *, category=None, ticker=None, sentiment=None, since=None):
    q = db.query(NewsItem)
    if since is not None:
        q = q.filter(NewsItem.published_at >= since)
    if category:
        q = q.filter(_array_contains(db, NewsItem.categories, category))
    if ticker:
        q = q.filter(_array_contains(db, NewsItem.tickers, ticker.upper()))
    if sentiment:
        q = q.filter(NewsItem.sentiment_label == sentiment)
    return q


def query_feed(db: Session, *, category: Optional[str] = None, ticker: Optional[str] = None,
               sentiment: Optional[str] = None, sort: str = "latest",
               since: Optional[datetime] = None, limit: int = 50) -> List[NewsItem]:
    q = _filtered(db, category=category, ticker=ticker, sentiment=sentiment, since=since)
    if sort == "impact":
        q = q.order_by(NewsItem.impact.desc().nullslast(), NewsItem.published_at.desc())
    elif sort == "bullish":
        q = q.order_by(NewsItem.sentiment_score.desc().nullslast(), NewsItem.published_at.desc())
    elif sort == "bearish":
        q = q.order_by(NewsItem.sentiment_score.asc().nullslast(), NewsItem.published_at.desc())
    else:
        q = q.order_by(NewsItem.published_at.desc(), NewsItem.id.desc())
    return q.limit(limit).all()


def category_counts(db: Session, *, ticker: Optional[str] = None, sentiment: Optional[str] = None,
                    since: Optional[datetime] = None) -> Dict[str, int]:
    """Multi-label counts (an item counts once in every category it carries),
    with every filter except `category` applied, so the counts match the tabs."""
    if _is_pg(db):
        sub = _filtered(db, ticker=ticker, sentiment=sentiment, since=since).with_entities(
            func.unnest(NewsItem.categories).label("c")
        ).subquery()
        rows = db.query(sub.c.c, func.count()).group_by(sub.c.c).all()
        return {c: int(n) for c, n in rows if c}
    counter: Counter = Counter()
    for (cats,) in _filtered(db, ticker=ticker, sentiment=sentiment, since=since).with_entities(NewsItem.categories):
        counter.update(cats or [])
    return dict(counter)


def top_without_ai(db: Session, *, since: datetime, min_impact: int, limit: int) -> List[NewsItem]:
    return (
        db.query(NewsItem)
        .filter(NewsItem.published_at >= since, NewsItem.ai.is_(None), NewsItem.impact >= min_impact)
        .order_by(NewsItem.impact.desc(), NewsItem.published_at.desc())
        .limit(limit)
        .all()
    )


def _percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (k - lo), 3)


def health_stats(db: Session, hours: int = 24) -> Dict[str, Any]:
    cutoff = utcnow() - timedelta(hours=hours)
    rows = (
        db.query(NewsItem.source_feed, NewsItem.published_at, NewsItem.ingested_at, NewsItem.classified_at)
        .filter(NewsItem.ingested_at >= cutoff)
        .limit(50000)
        .all()
    )
    per_feed: Counter = Counter()
    pub_ing: List[float] = []
    ing_cls: List[float] = []
    feed_pub_ing: Dict[str, List[float]] = {}
    feed_ing_cls: Dict[str, List[float]] = {}
    for feed, pub, ing, cls in rows:
        feed = feed or "unknown"
        per_feed[feed] += 1
        pub, ing, cls = _aware(pub), _aware(ing), _aware(cls)
        if pub and ing:
            d = (ing - pub).total_seconds()
            if 0 <= d <= 86400:  # ignore backfilled/old items and clock skew
                pub_ing.append(d)
                feed_pub_ing.setdefault(feed, []).append(d)
        if ing and cls:
            d = max(0.0, (cls - ing).total_seconds())
            ing_cls.append(d)
            feed_ing_cls.setdefault(feed, []).append(d)

    def pct(vals: List[float]) -> Dict[str, Any]:
        return {"p50": _percentile(vals, 0.5), "p95": _percentile(vals, 0.95), "n": len(vals)}

    return {
        "items_24h_by_feed": dict(per_feed),
        "latency_by_feed": {
            f: {"published_to_ingested": pct(feed_pub_ing.get(f, [])),
                "ingested_to_classified": pct(feed_ing_cls.get(f, []))}
            for f in per_feed
        },
        "items_24h": len(rows),
        "latency_seconds": {
            "published_to_ingested": {"p50": _percentile(pub_ing, 0.5), "p95": _percentile(pub_ing, 0.95),
                                      "n": len(pub_ing)},
            "ingested_to_classified": {"p50": _percentile(ing_cls, 0.5), "p95": _percentile(ing_cls, 0.95),
                                       "n": len(ing_cls)},
        },
    }
