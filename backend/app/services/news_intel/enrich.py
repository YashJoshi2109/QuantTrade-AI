"""
Image fallback enrichment: for stories whose feed carried no image, read the
article page's og:image / twitter:image.

Runs beside ingestion (never in the ingest path), only for the newest stories
the feed will show, plus a one-time capped backfill. Politeness and safety:

  * SSRF-safe fetches (app.services.net_safety): every hop validated and
    pinned to a public IP; https-only for the image itself.
  * robots.txt honoured per origin (cached 6h; unreachable = disallowed).
  * Per-host minimum interval, global concurrency cap, short timeouts,
    512 KB read cap that stops at </head>.
  * Results cached in Redis (or memory without Redis), negatives included,
    so each article page is fetched at most once.
  * Site-wide placeholders (the same image on 3+ articles of one host, or a
    known placeholder pattern) are rejected and remembered.

The same fetch discipline serves two helpers for aggregator (Google News)
stories, whose wrapper links are never fetched:
  * fetch_feed(url): a publisher's own public RSS feed (robots-aware,
    throttled, 2 MB cap); see publishers.py for matching.
  * find_logo(origin): the publisher's apple-touch-icon / large icon from its
    home page <head>, else /apple-touch-icon.png; cached per origin.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from collections import OrderedDict
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from app.services.net_safety import Resolver, UnsafeURLError, safe_request
from app.services.news_intel.images import (
    is_generic_image, normalize_image_url, normalize_logo_url, page_image, page_logo,
)

logger = logging.getLogger(__name__)

USER_AGENT = "QuantTradeNewsBot/1.0 (+https://quanttrade.us; news thumbnails)"
ROBOTS_TOKEN = "QuantTradeNewsBot"
CACHE_PREFIX = "qt:news:img:"
LOGO_PREFIX = "qt:news:logo:"
GENERIC_KEY = "qt:news:img:generic"
NEGATIVE = "-"
POSITIVE_TTL = 14 * 86400
NEGATIVE_TTL = 3 * 86400
ERROR_TTL = 6 * 3600
ROBOTS_TTL = 6 * 3600
PAGE_MAX_BYTES = 512 * 1024
FEED_MAX_BYTES = 2 * 1024 * 1024
GENERIC_REPEAT = 3

# Hosts whose article pages never have a story image worth fetching:
# Google News links are JS redirect wrappers (og:image is Google's logo and
# robots.txt disallows them); SEC filings have no images and sec.gov has a
# strict fair-access policy for automated clients.
SKIP_HOSTS = ("news.google.com", "sec.gov", "www.sec.gov")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


def cache_key(article_url: str) -> str:
    return CACHE_PREFIX + hashlib.sha1(article_url.encode("utf-8", "replace")).hexdigest()


def should_enrich(article_url: Optional[str]) -> bool:
    if not article_url:
        return False
    try:
        parts = urlsplit(article_url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host:
        return False
    return not any(host == h or host.endswith("." + h) for h in SKIP_HOSTS)


def _head_done(body: bytes) -> bool:
    tail = body[-70000:].lower()
    return b"</head" in tail or b"<body" in tail


class ImageEnricher:
    def __init__(self, redis=None, *, client: Optional[httpx.AsyncClient] = None,
                 resolver: Optional[Resolver] = None, per_host_interval: Optional[float] = None,
                 concurrency: int = 4, timeout: float = 5.0):
        self.redis = redis
        self._client = client
        self._own_client = client is None
        self.resolver = resolver
        self.per_host_interval = (per_host_interval if per_host_interval is not None
                                  else _env_float("NEWS_IMAGE_HOST_INTERVAL", 2.0))
        self.timeout = timeout
        self._sem = asyncio.Semaphore(concurrency)
        self._host_locks: Dict[str, asyncio.Lock] = {}
        self._host_last: Dict[str, float] = {}
        self._robots: Dict[str, Tuple[float, Optional[RobotFileParser], bool]] = {}
        self._robots_locks: Dict[str, asyncio.Lock] = {}
        self._logo_locks: Dict[str, asyncio.Lock] = {}
        self._mem: "OrderedDict[str, str]" = OrderedDict()
        self._seen: Dict[Tuple[str, str], Set[str]] = {}
        self.generic: Set[str] = set()
        self.new_generic: List[str] = []   # drained by the service to clear DB rows
        self._generic_loaded = False
        self.stats = {"lookups": 0, "found": 0, "none": 0, "errors": 0, "robots_blocked": 0,
                      "cache_hits": 0, "generic": 0, "feeds": 0, "feed_errors": 0,
                      "logos_found": 0, "logos_none": 0}

    # ── plumbing ──────────────────────────────────────────────────────
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(trust_env=False, limits=httpx.Limits(max_connections=8),
                                             headers={"User-Agent": USER_AGENT})
        return self._client

    async def aclose(self) -> None:
        if self._own_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _cache_get(self, key: str) -> Optional[str]:
        if self.redis is not None:
            try:
                v = await self.redis.get(key)
                if isinstance(v, bytes):
                    v = v.decode()
                return v
            except Exception:
                pass
        return self._mem.get(key)

    async def _cache_set(self, key: str, value: str, ttl: int) -> None:
        self._mem[key] = value
        self._mem.move_to_end(key)
        while len(self._mem) > 5000:
            self._mem.popitem(last=False)
        if self.redis is not None:
            try:
                await self.redis.set(key, value, ex=ttl)
            except Exception:
                pass

    async def _load_generic(self) -> None:
        if self._generic_loaded:
            return
        self._generic_loaded = True
        if self.redis is not None:
            try:
                self.generic |= set(await self.redis.smembers(GENERIC_KEY) or [])
            except Exception:
                pass

    async def _mark_generic(self, img: str) -> None:
        self.generic.add(img)
        self.new_generic.append(img)
        self.stats["generic"] += 1
        if self.redis is not None:
            try:
                await self.redis.sadd(GENERIC_KEY, img)
                await self.redis.expire(GENERIC_KEY, 30 * 86400)
            except Exception:
                pass

    async def _throttle(self, host: str) -> None:
        lock = self._host_locks.setdefault(host, asyncio.Lock())
        async with lock:
            wait = self._host_last.get(host, 0.0) + self.per_host_interval - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._host_last[host] = time.monotonic()

    async def _fetch(self, url: str, **kw):
        """One SSRF-safe request with a hard deadline (slow-drip servers),
        under the global concurrency cap."""
        async with self._sem:
            return await asyncio.wait_for(
                safe_request(self.client, url, timeout=self.timeout, resolver=self.resolver, **kw),
                timeout=self.timeout * 2,
            )

    # ── robots.txt ────────────────────────────────────────────────────
    async def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}".lower()
        lock = self._robots_locks.setdefault(origin, asyncio.Lock())
        async with lock:  # one robots.txt fetch per origin, however many stories wait on it
            cached = self._robots.get(origin)
            if cached is None or cached[0] < time.monotonic():
                parser: Optional[RobotFileParser] = None
                allow_all = False
                try:
                    await self._throttle(parts.hostname or "")
                    r = await self._fetch(origin + "/robots.txt", headers={"User-Agent": USER_AGENT},
                                          max_bytes=256 * 1024)
                    if r.status == 200:
                        parser = RobotFileParser()
                        parser.parse(r.body.decode("utf-8", "replace").splitlines())
                    elif 400 <= r.status < 500:
                        allow_all = True   # RFC 9309: unavailable robots.txt = no restrictions
                except (UnsafeURLError, httpx.HTTPError, asyncio.TimeoutError, OSError):
                    pass                   # unreachable = disallow (RFC 9309 2.3.1.4)
                cached = (time.monotonic() + ROBOTS_TTL, parser, allow_all)
                self._robots[origin] = cached
        _, parser, allow_all = cached
        if allow_all:
            return True
        if parser is None:
            return False
        return parser.can_fetch(ROBOTS_TOKEN, url)

    # ── image validation ──────────────────────────────────────────────
    async def valid_image(self, img: str, *, allow_svg: bool = False) -> bool:
        """https URL that answers with a raster image/* content type (SVG only
        when allow_svg, for logos)."""
        if not img.startswith("https://"):
            return False
        headers = {"User-Agent": USER_AGENT, "Accept": "image/avif,image/webp,image/*;q=0.9"}
        try:
            r = await self._fetch(img, method="HEAD", headers=headers, schemes=("https",))
            if r.status in (403, 405, 501) or (r.status == 200 and not r.content_type):
                r = await self._fetch(img, headers={**headers, "Range": "bytes=0-2047"}, max_bytes=4096,
                                      schemes=("https",))
        except (UnsafeURLError, httpx.HTTPError, asyncio.TimeoutError, OSError):
            return False
        ctype = r.content_type
        return (r.status in (200, 206) and ctype.startswith("image/")
                and (allow_svg or ctype != "image/svg+xml"))

    # ── lookup ────────────────────────────────────────────────────────
    async def _lookup(self, url: str) -> Tuple[Optional[str], int]:
        """(image or None, cache ttl)."""
        if not await self.allowed(url):
            self.stats["robots_blocked"] += 1
            return None, NEGATIVE_TTL
        host = (urlsplit(url).hostname or "").lower()
        await self._throttle(host)
        try:
            r = await self._fetch(url, max_bytes=PAGE_MAX_BYTES, stop=_head_done,
                                  headers={"User-Agent": USER_AGENT,
                                           "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"})
        except (UnsafeURLError, httpx.HTTPError, asyncio.TimeoutError, OSError) as e:
            self.stats["errors"] += 1
            logger.debug("image page fetch failed for %s: %s", host, type(e).__name__)
            return None, NEGATIVE_TTL if isinstance(e, UnsafeURLError) else ERROR_TTL
        if r.status != 200 or "html" not in r.content_type:
            return None, ERROR_TTL if r.status >= 500 or r.status == 429 else NEGATIVE_TTL
        # Redirected to a home page (paywall / bot wall): its og:image is the site logo.
        if urlsplit(r.url).path in ("", "/") and urlsplit(url).path not in ("", "/"):
            return None, NEGATIVE_TTL
        img = normalize_image_url(page_image(r.body.decode("utf-8", "replace"), r.url))
        if not img or is_generic_image(img) or img in self.generic:
            return None, NEGATIVE_TTL
        seen = self._seen.setdefault((host, img), set())
        seen.add(url)
        if len(self._seen) > 20000:
            self._seen.clear()
        if len(seen) >= GENERIC_REPEAT:
            await self._mark_generic(img)
            return None, NEGATIVE_TTL
        if not await self.valid_image(img):
            return None, NEGATIVE_TTL
        return img, POSITIVE_TTL

    async def find(self, article_url: Optional[str]) -> Optional[str]:
        """Cached og:image lookup. Never raises."""
        if not should_enrich(article_url):
            return None
        await self._load_generic()
        key = cache_key(article_url)
        cached = await self._cache_get(key)
        if cached is not None:
            self.stats["cache_hits"] += 1
            return None if cached == NEGATIVE or cached in self.generic else cached
        self.stats["lookups"] += 1
        try:
            img, ttl = await self._lookup(article_url)
        except Exception as e:
            self.stats["errors"] += 1
            logger.debug("image lookup failed: %s", type(e).__name__)
            img, ttl = None, ERROR_TTL
        self.stats["found" if img else "none"] += 1
        await self._cache_set(key, img or NEGATIVE, ttl)
        return img

    async def is_cached(self, article_url: Optional[str]) -> bool:
        if not should_enrich(article_url):
            return True
        return (await self._cache_get(cache_key(article_url))) is not None

    # ── publisher feeds (aggregator stories) ─────────────────────────────
    async def fetch_feed(self, feed_url: str) -> Optional[bytes]:
        """A publisher's public RSS/Atom feed body, or None when robots.txt
        disallows it, it is not https, or the fetch fails. Never raises."""
        if not feed_url.startswith("https://"):
            return None
        try:
            if not await self.allowed(feed_url):
                self.stats["robots_blocked"] += 1
                return None
            await self._throttle((urlsplit(feed_url).hostname or "").lower())
            r = await self._fetch(feed_url, max_bytes=FEED_MAX_BYTES, schemes=("https",),
                                  headers={"User-Agent": USER_AGENT,
                                           "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5"})
        except (UnsafeURLError, httpx.HTTPError, asyncio.TimeoutError, OSError):
            self.stats["feed_errors"] += 1
            return None
        except Exception as e:
            self.stats["feed_errors"] += 1
            logger.debug("publisher feed fetch failed: %s", type(e).__name__)
            return None
        if r.status != 200 or r.truncated:
            self.stats["feed_errors"] += 1
            return None
        self.stats["feeds"] += 1
        return r.body

    # ── publisher logos ──────────────────────────────────────────────────
    async def _logo_lookup(self, origin: str) -> Optional[str]:
        home = origin + "/"
        cands = []
        if await self.allowed(home):
            await self._throttle((urlsplit(home).hostname or "").lower())
            try:
                r = await self._fetch(home, max_bytes=PAGE_MAX_BYTES, stop=_head_done,
                                      headers={"User-Agent": USER_AGENT,
                                               "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"})
                if r.status == 200 and "html" in r.content_type:
                    u = page_logo(r.body.decode("utf-8", "replace"), r.url)
                    if u:
                        cands.append(u)
            except (UnsafeURLError, httpx.HTTPError, asyncio.TimeoutError, OSError):
                pass
        touch = origin + "/apple-touch-icon.png"
        if touch not in cands and await self.allowed(touch):
            cands.append(touch)
        for u in cands:
            if await self.valid_image(u, allow_svg=True):
                return u
        return None

    @staticmethod
    def _logo_origin(site_url: Optional[str]) -> Optional[str]:
        u = normalize_logo_url(site_url)
        if not u:
            return None
        origin = f"https://{(urlsplit(u).hostname or '').lower()}"
        return origin if should_enrich(origin + "/") else None

    async def is_logo_cached(self, site_url: Optional[str]) -> bool:
        origin = self._logo_origin(site_url)
        return origin is None or (await self._cache_get(LOGO_PREFIX + origin)) is not None

    async def find_logo(self, site_url: Optional[str]) -> Optional[str]:
        """Publisher brand mark for a site (any URL on it; only the https
        origin is used). Cached per origin, negatives included. Never raises."""
        origin = self._logo_origin(site_url)
        if origin is None:
            return None
        key = LOGO_PREFIX + origin
        async with self._logo_locks.setdefault(origin, asyncio.Lock()):  # one lookup per origin
            cached = await self._cache_get(key)
            if cached is not None:
                self.stats["cache_hits"] += 1
                return None if cached == NEGATIVE else cached
            try:
                logo = await self._logo_lookup(origin)
            except Exception as e:
                logger.debug("logo lookup failed: %s", type(e).__name__)
                await self._cache_set(key, NEGATIVE, ERROR_TTL)
                return None
            self.stats["logos_found" if logo else "logos_none"] += 1
            await self._cache_set(key, logo or NEGATIVE, POSITIVE_TTL if logo else NEGATIVE_TTL)
            return logo
