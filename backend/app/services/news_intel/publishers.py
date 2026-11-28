"""
Publisher registry + publisher-feed lookup for aggregator (Google News) stories.

Google News items link to news.google.com wrappers. Those are never fetched or
decoded (robots.txt disallows them; decoding needs Google's internal
endpoints). Each item does carry the publisher (<source url="https://www.wsj.com">)
and the publisher's exact headline, so the direct article is found in the
publisher's OWN public RSS feed instead:

    domain -> Publisher.feeds -> entries indexed by normalized title
    Google item (domain, title, time) -> matching entry -> direct URL + feed image

Only feeds listed here are read, each through ImageEnricher.fetch_feed
(robots.txt honoured, SSRF-safe, per-host throttle, 2 MB cap), at most once per
FEED_TTL per feed and only when a story from that publisher still lacks an
image. Entries are kept for ENTRY_MAX_AGE so a story Google surfaces hours
after the publisher posted it still matches.

Not listed on purpose: Reuters (no public RSS since 2020), Yahoo Finance (no
public news RSS; finance.yahoo.com/news/rssindex is gone), Morningstar (feed
403s automated clients), Fox Business (robots.txt disallows its feed host).
"""
from __future__ import annotations

import asyncio
import calendar
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from app.services.news_intel.images import entry_image, host_in_domain, is_generic_image, site_domain

logger = logging.getLogger(__name__)

FEED_TTL = 15 * 60                 # seconds between re-reads of one publisher feed
ENTRY_MAX_AGE = timedelta(hours=72)
MATCH_WINDOW = timedelta(hours=48)  # |feed published - aggregator published|
FUZZY_MIN_TOKENS = 5
FUZZY_MIN_JACCARD = 0.85

AGGREGATOR_HOSTS = ("news.google.com",)


@dataclass(frozen=True)
class Publisher:
    key: str
    domains: Tuple[str, ...]                 # article/site domains (first = home)
    names: Tuple[str, ...]                   # names Google News / feeds use
    feeds: Tuple[str, ...] = ()              # the publisher's own public RSS feeds
    cdns: Tuple[str, ...] = ()               # the publisher's own image CDN domains


_DJ = "https://feeds.content.dowjones.io/public/rss/"
_CNBC = "https://www.cnbc.com/id/{}/device/rss/rss.html"
_NYT = "https://rss.nytimes.com/services/xml/rss/nyt/{}.xml"

PUBLISHERS: Tuple[Publisher, ...] = (
    Publisher("wsj", ("wsj.com",), ("WSJ", "The Wall Street Journal", "Wall Street Journal"),
              tuple(_DJ + f for f in ("RSSMarketsMain", "WSJcomUSBusiness", "RSSWSJD", "RSSUSnews",
                                      "RSSWorldNews", "socialeconomyfeed", "socialpoliticsfeed",
                                      "RSSPersonalFinance", "RSSOpinion")), ("wsj.net",)),
    Publisher("marketwatch", ("marketwatch.com",), ("MarketWatch",),
              tuple(_DJ + f for f in ("mw_topstories", "mw_marketpulse", "mw_realtimeheadlines")), ("wsj.net", "mktw.net")),
    Publisher("bloomberg", ("bloomberg.com",), ("Bloomberg", "Bloomberg.com", "Bloomberg News"),
              tuple(f"https://feeds.bloomberg.com/{s}/news.rss"
                    for s in ("markets", "economics", "business", "technology", "politics")), ("bwbx.io",)),
    Publisher("nytimes", ("nytimes.com",), ("The New York Times", "New York Times", "NYT"),
              tuple(_NYT.format(s) for s in ("Business", "Economy", "YourMoney", "DealBook", "Technology")), ("nyt.com",)),
    Publisher("cnbc", ("cnbc.com",), ("CNBC",),
              tuple(_CNBC.format(i) for i in (100003114, 10000664, 20910258, 15839069, 10001147, 19854910)),
              ("cnbcfm.com",)),
    Publisher("fortune", ("fortune.com",), ("Fortune",), ("https://fortune.com/feed/",)),
    Publisher("businessinsider", ("businessinsider.com", "markets.businessinsider.com"),
              ("Business Insider", "Insider", "Markets Insider"),
              ("https://feeds.businessinsider.com/custom/all",)),
    Publisher("bbc", ("bbc.com", "bbc.co.uk"), ("BBC", "BBC News"),
              ("https://feeds.bbci.co.uk/news/business/rss.xml", "https://feeds.bbci.co.uk/news/rss.xml",
               "https://feeds.bbci.co.uk/news/world/rss.xml"), ("bbci.co.uk",)),
    Publisher("ft", ("ft.com",), ("Financial Times", "FT"),
              ("https://www.ft.com/rss/home", "https://www.ft.com/markets?format=rss")),
    Publisher("globeandmail", ("theglobeandmail.com",), ("The Globe and Mail", "Globe and Mail"),
              ("https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/",
               "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/investing/")),
    Publisher("investing", ("investing.com",), ("Investing.com",), ("https://www.investing.com/rss/news.rss",)),
    Publisher("fool", ("fool.com",), ("The Motley Fool", "Motley Fool"), ("https://www.fool.com/feeds/index.aspx",),
              ("foolcdn.com",)),
    Publisher("ibd", ("investors.com",), ("Investor's Business Daily", "Investors Business Daily"),
              ("https://www.investors.com/feed/",)),
    # Known publishers without a usable public feed: domain only (logo tile).
    Publisher("reuters", ("reuters.com",), ("Reuters",), (), ("thomsonreuters.com",)),
    Publisher("yahoo", ("finance.yahoo.com", "yahoo.com"), ("Yahoo Finance", "Yahoo! Finance"), (), ("yimg.com",)),
    Publisher("yahoo_uk", ("uk.finance.yahoo.com",), ("Yahoo Finance UK",)),
    Publisher("yahoo_ca", ("ca.finance.yahoo.com",), ("Yahoo! Finance Canada", "Yahoo Finance Canada")),
    Publisher("morningstar", ("morningstar.com",), ("Morningstar",)),
    Publisher("barrons", ("barrons.com",), ("Barron's", "Barrons")),
    Publisher("foxbusiness", ("foxbusiness.com",), ("Fox Business",)),
    Publisher("ap", ("apnews.com",), ("AP News", "Associated Press", "The Associated Press")),
    Publisher("seekingalpha", ("seekingalpha.com",), ("Seeking Alpha",)),
)

_BY_DOMAIN: Dict[str, Publisher] = {d: p for p in PUBLISHERS for d in p.domains}
_BY_NAME: Dict[str, Publisher] = {n.lower(): p for p in PUBLISHERS for n in p.names}


def is_aggregator_url(url: Optional[str]) -> bool:
    return any(host_in_domain(url, h) for h in AGGREGATOR_HOSTS) if url else False


def publisher_for(domain: Optional[str] = None, name: Optional[str] = None) -> Optional[Publisher]:
    """Registry entry by site domain (subdomains fall back to the parent), then by name."""
    labels = site_domain(domain).split(".") if domain else []
    for i in range(max(0, len(labels) - 1)):
        p = _BY_DOMAIN.get(".".join(labels[i:]))
        if p is not None:
            return p
    if name:
        return _BY_NAME.get(name.strip().lower())
    return None


def publisher_home(source_url: Optional[str] = None, name: Optional[str] = None) -> Optional[str]:
    """https origin of a publisher's site: from the feed-supplied source URL
    (Google's <source url>), else the registry's home domain for the name."""
    if source_url and not is_aggregator_url(source_url):
        try:
            host = urlsplit(source_url if "://" in source_url else "https://" + source_url).hostname
        except ValueError:
            host = None
        if host and "." in host:
            return f"https://{host.lower()}"
    p = publisher_for(name=name)
    if p is None:
        return None
    home = p.domains[0]
    return f"https://{home}" if home.count(".") > 1 else f"https://www.{home}"


# ── title matching ──────────────────────────────────────────────────────

_QUOTES = re.compile(r"[‘’‚‛“”„′″'\"`]")
_KICKER = re.compile(r"^(?:exclusive|opinion|analysis|breaking|update|updated|live|watch|video|"
                     r"commentary|review|explainer|factbox|wsj opinion)\s*[|:\-–—]\s+", re.I)


def normalize_title(title: Optional[str]) -> str:
    """Case/quote/punctuation-insensitive headline key. Drops kickers such as
    'Exclusive | ' and Google's ' - Publisher' suffix is expected stripped."""
    t = unicodedata.normalize("NFKC", title or "").strip()
    t = _KICKER.sub("", t)
    t = _QUOTES.sub("", t.lower())
    t = t.replace("&", " and ")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _tokens(norm: str) -> frozenset:
    return frozenset(norm.split())


@dataclass
class FeedEntry:
    url: str
    title: str
    norm: str
    image: Optional[str]
    published: Optional[datetime]
    seen: float = field(default_factory=time.time)


@dataclass
class Match:
    publisher: str
    url: str
    image: Optional[str]
    title: str


def _ts(st) -> Optional[datetime]:
    if not st:
        return None
    try:
        return datetime.fromtimestamp(calendar.timegm(st), tz=timezone.utc)
    except Exception:
        return None


def parse_publisher_feed(content: bytes, publisher: Publisher) -> List[FeedEntry]:
    """Entries of a publisher feed whose link stays on the publisher's domains."""
    import feedparser

    parsed = feedparser.parse(content)
    out: List[FeedEntry] = []
    for e in parsed.entries[:200]:
        link = (e.get("link") or "").strip()
        title = (e.get("title") or "").strip()
        if not link.startswith("https://") or not title:
            continue
        if not any(host_in_domain(link, d) for d in publisher.domains):
            continue
        img = entry_image(e)
        out.append(FeedEntry(url=link, title=title, norm=normalize_title(title),
                             image=None if not img or is_generic_image(img) else img,
                             published=_ts(e.get("published_parsed") or e.get("updated_parsed"))))
    return out


FetchFeed = Callable[[str], Awaitable[Optional[bytes]]]


class PublisherFeedIndex:
    """Lazily-read index of publisher feed entries, keyed by normalized title."""

    def __init__(self, fetch_feed: FetchFeed, *, ttl: float = FEED_TTL, clock: Callable[[], float] = time.monotonic,
                 now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.fetch_feed = fetch_feed
        self.ttl = ttl
        self.clock = clock   # monotonic seconds, for the per-feed TTL
        self.now = now       # wall clock, for entry age
        self._fetched: Dict[str, float] = {}
        self._entries: Dict[str, Dict[str, FeedEntry]] = {}   # publisher key -> norm -> entry
        self._locks: Dict[str, asyncio.Lock] = {}
        self.stats = {"lookups": 0, "matched": 0, "matched_with_image": 0, "feeds_read": 0}

    async def _refresh(self, pub: Publisher) -> None:
        lock = self._locks.setdefault(pub.key, asyncio.Lock())
        async with lock:
            now = self.clock()
            bucket = self._entries.setdefault(pub.key, {})
            for feed in pub.feeds:
                last = self._fetched.get(feed)
                if last is not None and now - last < self.ttl:
                    continue
                self._fetched[feed] = now
                body = await self.fetch_feed(feed)
                if not body:
                    continue
                self.stats["feeds_read"] += 1
                try:
                    entries = await asyncio.to_thread(parse_publisher_feed, body, pub)
                except Exception as e:
                    logger.debug("publisher feed parse failed (%s): %s", pub.key, type(e).__name__)
                    continue
                for fe in entries:
                    prev = bucket.get(fe.norm)
                    if prev is None or (fe.image and not prev.image):
                        bucket[fe.norm] = fe
            cutoff = self.now() - ENTRY_MAX_AGE
            for k in [k for k, v in bucket.items() if v.published and v.published < cutoff]:
                del bucket[k]
            if len(bucket) > 5000:
                for k in sorted(bucket, key=lambda k: bucket[k].seen)[: len(bucket) - 5000]:
                    del bucket[k]

    @staticmethod
    def _in_window(fe: FeedEntry, published: Optional[datetime]) -> bool:
        if fe.published is None or published is None:
            return True
        return abs(fe.published - published) <= MATCH_WINDOW

    def _best(self, pub: Publisher, title: str, published: Optional[datetime]) -> Optional[FeedEntry]:
        bucket = self._entries.get(pub.key) or {}
        norm = normalize_title(title)
        if not norm:
            return None
        fe = bucket.get(norm)
        if fe and self._in_window(fe, published):
            return fe
        toks = _tokens(norm)
        if len(toks) < FUZZY_MIN_TOKENS:
            return None
        best, best_score = None, 0.0
        for cand in bucket.values():
            if not self._in_window(cand, published):
                continue
            ct = _tokens(cand.norm)
            if len(ct) < FUZZY_MIN_TOKENS:
                continue
            score = len(toks & ct) / len(toks | ct)
            if score > best_score:
                best, best_score = cand, score
        return best if best_score >= FUZZY_MIN_JACCARD else None

    async def lookup(self, *, title: str, domain: Optional[str] = None, name: Optional[str] = None,
                     published: Optional[datetime] = None) -> Optional[Match]:
        """Direct article (+ feed image) for an aggregator story. Never raises."""
        pub = publisher_for(domain, name)
        if pub is None or not pub.feeds:
            return None
        self.stats["lookups"] += 1
        try:
            await self._refresh(pub)
        except Exception as e:
            logger.debug("publisher feed refresh failed (%s): %s", pub.key, type(e).__name__)
            return None
        fe = self._best(pub, title, published)
        if fe is None:
            return None
        self.stats["matched"] += 1
        if fe.image:
            self.stats["matched_with_image"] += 1
        return Match(publisher=pub.key, url=fe.url, image=fe.image, title=fe.title)
