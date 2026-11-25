"""
Google News RSS search: free, keyless headline fallback for the Global Monitor.

Used when The Guardian (needs GUARDIAN_API_KEY; the old "test" key now
returns 401) and GDELT (rate limited to one request every 5 seconds, so a
9-column parallel sweep gets HTTP 429) both return nothing.
"""
from __future__ import annotations

import calendar
import logging
import time
from typing import Dict, List, Optional
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger(__name__)

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"


def google_news_url(query: str) -> str:
    return f"{GOOGLE_NEWS_RSS}?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"


def time_ago(published_ts: Optional[float], now_ts: Optional[float] = None) -> str:
    if not published_ts:
        return "recently"
    now_ts = now_ts if now_ts is not None else time.time()
    secs = max(0, int(now_ts - published_ts))
    if secs < 3600:
        return f"{max(1, secs // 60)}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


def parse_google_news_rss(xml_text: str, limit: int = 30) -> List[Dict[str, object]]:
    """Parse Google News RSS into plain dicts.

    Keys: title, source, url, published_ts (epoch seconds or None), date (YYYY-MM-DD or "").
    Google appends " - Publisher" to titles; it is split off into `source`.
    """
    import feedparser

    feed = feedparser.parse(xml_text or "")
    out: List[Dict[str, object]] = []
    for entry in feed.entries[:limit]:
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        source = ""
        src = entry.get("source")
        if isinstance(src, dict):
            source = str(src.get("title") or "")
        if " - " in title:
            head, tail = title.rsplit(" - ", 1)
            if not source:
                source = tail
            if tail == source:
                title = head
        parsed = entry.get("published_parsed")
        ts = float(calendar.timegm(parsed)) if parsed else None
        out.append({
            "title": title,
            "source": source or "Google News",
            "url": entry.get("link"),
            "published_ts": ts,
            "date": time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else "",
        })
    return out


async def fetch_google_news(client: httpx.AsyncClient, query: str, limit: int = 30) -> List[Dict[str, object]]:
    try:
        resp = await client.get(
            google_news_url(query),
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
            follow_redirects=True,
        )
        if resp.status_code != 200:
            logger.warning("Google News RSS HTTP %s for %r", resp.status_code, query)
            return []
        return parse_google_news_rss(resp.text, limit=limit)
    except Exception as exc:
        logger.warning("Google News RSS failed for %r: %s", query, exc)
        return []
