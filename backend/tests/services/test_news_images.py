"""
News images: feed extraction (recorded fixtures), og:image fallback
enrichment, SSRF guard, pipeline pass + backfill. No network: HTTP goes
through httpx.MockTransport and DNS through a fake resolver.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.models.news_item import NewsItem
from app.services import net_safety
from app.services.net_safety import UnsafeURLError, is_public_ip, resolve_public, safe_request, validate_url
from app.services.news_intel import enrich, images
from app.services.news_intel.sources import parse_alpaca_message, parse_feed, parse_finnhub

FEEDS = Path(__file__).resolve().parents[1] / "fixtures" / "news_feeds"
PAGES = Path(__file__).resolve().parents[1] / "fixtures" / "news_pages"


def _feed(name, key="test", source="Test", **kw):
    return parse_feed((FEEDS / name).read_bytes(), key, source, **kw)


# ── feed extraction: recorded real feeds ────────────────────────────────

def test_prnewswire_media_content_and_bogus_video_skipped():
    items = _feed("prnewswire.xml", "prnewswire", "PR Newswire")
    assert len(items) == 4
    imgs = [i.image_url for i in items]
    assert all(u and u.startswith("https://mmx.prnewswire.com/media/") for u in imgs[:3])
    # PR Newswire labels an .mp4 as type="image/jpeg": it must not become an <img>.
    assert imgs[3] is None


def test_businesswire_enclosure():
    items = _feed("businesswire.xml", "businesswire", "Business Wire")
    assert [i.image_url for i in items] == [
        "https://mms.businesswire.com/media/20261126675338/en/2982708/21/damco.jpg",
        "https://mms.businesswire.com/media/20261125984530/zh-HK/2982575/21/KIOXIA_GP2_SSD_261126.jpg",
    ]


def test_yahoo_google_sec_feeds_carry_no_images():
    """Root cause for Yahoo / Google News: the feeds have no image fields at
    all (only the channel logo), so only the og:image fallback can help."""
    assert all(i.image_url is None for i in _feed("yahoo_finance.xml", "yahoo_finance", "Yahoo Finance"))
    g = _feed("google_news.xml", "google_business", "Google News", use_entry_source=True, keep_summary=False)
    assert g and all(i.image_url is None for i in g)
    from app.services.news_intel.sources import parse_sec_8k

    assert all(i.image_url is None for i in parse_sec_8k((FEEDS / "sec_8k.atom").read_bytes()))


def test_globenewswire_media_content_without_width():
    items = _feed("globenewswire.xml", "globenewswire", "GlobeNewswire")
    assert items[0].image_url.startswith("https://ml.globenewswire.com/Resource/Download/")
    assert items[1].image_url is None


# ── feed extraction: every location ─────────────────────────────────────

def test_every_standard_image_location():
    by_title = {i.title: i.image_url for i in _feed("media_variants.xml")}
    assert by_title["media group picks the largest width"] == "https://cdn.example.com/g-large.jpg"
    assert by_title["media content skips icon sized and video entries"] == "https://cdn.example.com/photo.jpg"
    assert by_title["media thumbnail only"] == "https://cdn.example.com/thumb.jpg"
    # http upgraded to https; the audio enclosure ignored
    assert by_title["enclosure image, audio enclosure ignored"] == "https://cdn.example.com/enclosed.png"
    assert by_title["itunes image"] == "https://cdn.example.com/itunes.jpg"
    assert by_title["content encoded img after a tracking pixel"] == "https://cdn.example.com/encoded.jpg"
    assert by_title["description img, relative src resolved against the link"] == \
        "https://news.example.com/images/desc.webp"
    assert by_title["description with only a 1x1 pixel has no image"] is None
    assert by_title["site placeholder image is not a story image"] is None


def test_alpaca_images_and_content():
    msg = {"T": "n", "headline": "Nike upgraded", "url": "https://www.benzinga.com/n/1", "source": "benzinga",
           "images": [{"size": "thumb", "url": "https://cdn.benzinga.com/t.jpg"},
                      {"size": "large", "url": "https://cdn.benzinga.com/l.jpg"},
                      {"size": "small", "url": "https://cdn.benzinga.com/s.jpg"}]}
    assert parse_alpaca_message(msg).image_url == "https://cdn.benzinga.com/l.jpg"
    msg2 = {"T": "n", "headline": "Fiscal story", "url": "https://x.com/a",
            "content": '<p><img src="https://x.com/pixel.gif" width="1" height="1"><img src="https://img.x.com/p.jpg"></p>'}
    assert parse_alpaca_message(msg2).image_url == "https://img.x.com/p.jpg"
    assert parse_alpaca_message({"T": "n", "headline": "No image", "images": []}).image_url is None


def test_finnhub_image_normalized():
    rows = parse_finnhub([{"headline": "a", "image": "http://img.f.com/a.jpg", "datetime": 1764000000},
                          {"headline": "b", "image": "", "datetime": 1764000000},
                          {"headline": "c", "image": "https://static2.finnhub.io/file/publicdatany/finnhubimage/default.png",
                           "datetime": 1764000000}], "finnhub_general")
    assert [r.image_url for r in rows] == ["https://img.f.com/a.jpg", None, None]


@pytest.mark.parametrize("url,expected", [
    ("https://cdn.x.com/story.jpg", "https://cdn.x.com/story.jpg"),
    ("//cdn.x.com/a.png", "https://cdn.x.com/a.png"),
    ("data:image/gif;base64,R0lGOD", None),
    ("javascript:alert(1)", None),
    ("https://user:pw@cdn.x.com/a.jpg", None),
    ("https://cdn.x.com/clip.mp4", None),
    ("https://t.x.com/pixel.gif?u=1", None),
    ("https://www.google.com/s2/favicons?domain=x.com", None),
])
def test_normalize_image_url(url, expected):
    assert images.normalize_image_url(url) == expected


@pytest.mark.parametrize("url", [
    "https://s.yimg.com/cv/apiv2/social/images/yahoo_default_logo-1200x1200.png",
    "https://www.finanznachrichten.de/content/g/fb.png",
    "https://newsfilter.io/opengraph-image?9bdea4a43f9d8a5d",
    "https://stocktwits.com/images/stocktwits-meta-image.png",
])
def test_generic_placeholders(url):
    assert images.is_generic_image(url)


def test_real_story_photo_not_generic():
    assert not images.is_generic_image("https://news.stocktwits-cdn.com/large_Getty_Images_2252194207_jpg.webp")
    assert not images.is_generic_image("https://cdn.x.com/google-pixel-10-review.jpg")


# ── og:image page parsing (recorded heads) ──────────────────────────────

def test_page_image_recorded_heads():
    fool = images.page_image((PAGES / "fool_article.html").read_text(), "https://www.fool.com/x/")
    assert fool.startswith("https://g.foolcdn.com/image/?url=") and "&w=1200" in fool
    yahoo = images.page_image((PAGES / "yahoo_article.html").read_text(), "https://finance.yahoo.com/x")
    assert yahoo.startswith("https://s.yimg.com/") and "yahoo_default_logo" not in yahoo
    # Yahoo serves its logo as og:image on wire stories: treated as no image.
    assert images.page_image((PAGES / "yahoo_default_logo.html").read_text()) is None
    assert images.page_image((PAGES / "newsfilter_generic.html").read_text()) is None


def test_page_image_fallback_order_and_relative():
    html = """<html><head><meta name="twitter:image" content="/img/tw.jpg">
      <meta property="og:image" content="https://cdn.x.com/story-123.jpg">
      <meta property="og:image:width" content="1200"></head><body>
      <meta property="og:image" content="https://evil.example/late.jpg"></body></html>"""
    assert images.page_image(html, "https://x.com/a") == "https://cdn.x.com/story-123.jpg"
    only_tw = '<head><meta name="twitter:image:src" content="/img/tw.jpg"></head>'
    assert images.page_image(only_tw, "https://x.com/a/b") == "https://x.com/img/tw.jpg"
    tiny = '<head><meta property="og:image" content="https://x.com/i.png"><meta property="og:image:width" content="64"></head>'
    assert images.page_image(tiny) is None
    assert images.page_image('<head><link rel="image_src" href="https://x.com/s.jpg"></head>') == "https://x.com/s.jpg"


# ── SSRF guard ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("ip,ok", [
    ("93.184.216.34", True), ("2606:4700::6810:84e5", True),
    ("127.0.0.1", False), ("10.0.0.5", False), ("172.16.3.4", False), ("192.168.1.1", False),
    ("169.254.169.254", False), ("100.64.0.1", False), ("0.0.0.0", False), ("224.0.0.1", False),
    ("::1", False), ("fe80::1", False), ("fc00::1", False), ("::ffff:127.0.0.1", False),
    ("::ffff:10.0.0.1", False), ("2002:7f00:1::", False), ("not-an-ip", False),
])
def test_is_public_ip(ip, ok):
    assert is_public_ip(ip) is ok


@pytest.mark.parametrize("url", [
    "ftp://x.com/a", "file:///etc/passwd", "gopher://x.com", "https://localhost/a", "http://intranet/a",
    "https://metadata.google.internal/computeMetadata", "https://printer.local/", "https://u:p@x.com/",
    "https://x.com:8080/", "http://x.com:22/", "https:///nohost",
])
def test_validate_url_rejects(url):
    with pytest.raises(UnsafeURLError):
        validate_url(url)


def test_validate_url_https_only_for_images():
    with pytest.raises(UnsafeURLError):
        validate_url("http://cdn.x.com/a.jpg", ("https",))
    assert validate_url("https://cdn.x.com/a.jpg", ("https",)).hostname == "cdn.x.com"


def _resolver(table):
    async def resolve(host, port):
        if host not in table:
            raise OSError("NXDOMAIN")
        return table[host]
    return resolve


def test_resolve_public_rejects_any_private_record():
    r = _resolver({"ok.com": ["93.184.216.34"], "mixed.com": ["93.184.216.34", "10.0.0.1"],
                   "rebind.com": ["127.0.0.1"]})
    assert asyncio.run(resolve_public("ok.com", 443, r)) == "93.184.216.34"
    for host in ("mixed.com", "rebind.com", "missing.com"):
        with pytest.raises(UnsafeURLError):
            asyncio.run(resolve_public(host, 443, r))
    with pytest.raises(UnsafeURLError):
        asyncio.run(resolve_public("169.254.169.254", 80, r))


def _run_safe(handler, url, table, **kw):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await safe_request(c, url, resolver=_resolver(table), **kw)
    return asyncio.run(go())


def test_safe_request_pins_ip_and_keeps_host():
    seen = []

    def handler(req):
        seen.append((str(req.url), req.headers["host"], req.extensions.get("sni_hostname")))
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<head></head>")

    r = _run_safe(handler, "https://news.x.com/a?b=1", {"news.x.com": ["93.184.216.34"]})
    assert r.status == 200 and r.url == "https://news.x.com/a?b=1"
    assert seen == [("https://93.184.216.34/a?b=1", "news.x.com", "news.x.com")]


@pytest.mark.parametrize("location", [
    "http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "https://internal.x.com/",
    "file:///etc/passwd", "http://[::1]/",
])
def test_safe_request_revalidates_redirects(location):
    def handler(req):
        if req.headers["host"] == "news.x.com":
            return httpx.Response(302, headers={"location": location})
        raise AssertionError(f"must not connect to {req.url}")

    table = {"news.x.com": ["93.184.216.34"], "internal.x.com": ["10.1.2.3"]}
    with pytest.raises(UnsafeURLError):
        _run_safe(handler, "https://news.x.com/a", table)


def test_safe_request_follows_public_redirect_and_caps_size():
    def handler(req):
        if req.url.path == "/a":
            return httpx.Response(301, headers={"location": "https://cdn.x.com/b"})
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"x" * 5000)

    table = {"news.x.com": ["93.184.216.34"], "cdn.x.com": ["93.184.216.35"]}
    r = _run_safe(handler, "https://news.x.com/a", table, max_bytes=1000)
    assert r.url == "https://cdn.x.com/b" and len(r.body) == 1000 and r.truncated


def test_safe_request_redirect_limit():
    def handler(req):
        return httpx.Response(302, headers={"location": "/again"})

    with pytest.raises(UnsafeURLError):
        _run_safe(handler, "https://news.x.com/a", {"news.x.com": ["93.184.216.34"]}, max_redirects=2)


# ── enricher ────────────────────────────────────────────────────────────

FOOL_HEAD = (PAGES / "fool_article.html").read_text()


class FakeRedis:
    def __init__(self):
        self.kv, self.sets = {}, {}

    async def get(self, k):
        return self.kv.get(k)

    async def set(self, k, v, ex=None, nx=False):
        self.kv[k] = v
        return True

    async def smembers(self, k):
        return set(self.sets.get(k, set()))

    async def sadd(self, k, v):
        self.sets.setdefault(k, set()).add(v)

    async def expire(self, k, ttl):
        return True


def _site(routes, calls=None):
    """routes: {(host, path): response or callable}. Unknown -> 404."""
    def handler(req):
        key = (req.headers["host"], req.url.path)
        if calls is not None:
            calls.append((req.method, req.headers["host"], req.url.path, req.headers.get("user-agent")))
        r = routes.get(key)
        if callable(r):
            r = r(req)
        return r or httpx.Response(404)
    return handler


HTML = {"content-type": "text/html; charset=utf-8"}
JPEG = {"content-type": "image/jpeg"}
TABLE = {"news.x.com": ["93.184.216.34"], "cdn.x.com": ["93.184.216.35"], "g.foolcdn.com": ["93.184.216.36"],
         "evil.x.com": ["10.0.0.9"]}


def _enricher(routes, calls=None, redis=None):
    client = httpx.AsyncClient(transport=httpx.MockTransport(_site(routes, calls)))
    return enrich.ImageEnricher(redis=redis, client=client, resolver=_resolver(TABLE), per_host_interval=0)


def test_enricher_finds_og_image_and_caches_result():
    calls = []
    routes = {
        ("news.x.com", "/robots.txt"): httpx.Response(200, text="User-agent: *\nDisallow: /private/\n"),
        ("news.x.com", "/story"): httpx.Response(200, headers=HTML, text=FOOL_HEAD),
        ("g.foolcdn.com", "/image/"): httpx.Response(200, headers=JPEG),
    }
    redis = FakeRedis()
    e = _enricher(routes, calls, redis)

    async def go():
        first = await e.find("https://news.x.com/story")
        n = len(calls)
        second = await e.find("https://news.x.com/story")
        return first, second, n

    first, second, n = asyncio.run(go())
    assert first.startswith("https://g.foolcdn.com/image/") and second == first
    assert len(calls) == n == 3  # robots, page, HEAD image; second call served from cache
    assert [c[0] for c in calls] == ["GET", "GET", "HEAD"]
    assert all(c[3] == enrich.USER_AGENT for c in calls)
    assert redis.kv[enrich.cache_key("https://news.x.com/story")] == first


def test_enricher_respects_robots_and_caches_negative():
    calls = []
    routes = {
        ("news.x.com", "/robots.txt"): httpx.Response(200, text="User-agent: *\nDisallow: /private/\n"),
        ("news.x.com", "/private/story"): httpx.Response(200, headers=HTML, text=FOOL_HEAD),
    }
    e = _enricher(routes, calls)

    async def go():
        return await e.find("https://news.x.com/private/story"), await e.find("https://news.x.com/private/story")

    assert asyncio.run(go()) == (None, None)
    assert [c[2] for c in calls] == ["/robots.txt"]  # page never fetched, negative cached
    assert e.stats["robots_blocked"] == 1


def test_enricher_robots_unreachable_means_disallow_404_means_allow():
    calls = []
    routes = {("news.x.com", "/robots.txt"): httpx.Response(503)}
    e = _enricher(routes, calls)
    assert asyncio.run(e.find("https://news.x.com/a")) is None
    assert [c[2] for c in calls] == ["/robots.txt"]

    routes = {("news.x.com", "/story"): httpx.Response(200, headers=HTML, text=FOOL_HEAD),
              ("g.foolcdn.com", "/image/"): httpx.Response(200, headers=JPEG)}
    assert asyncio.run(_enricher(routes).find("https://news.x.com/story")).startswith("https://g.foolcdn.com/")


def test_enricher_rejects_non_image_content_type_and_private_image_host():
    page_evil = '<head><meta property="og:image" content="https://evil.x.com/a.jpg"></head>'
    routes = {
        ("news.x.com", "/a"): httpx.Response(200, headers=HTML, text=FOOL_HEAD),
        ("g.foolcdn.com", "/image/"): httpx.Response(200, headers=HTML),
        ("news.x.com", "/b"): httpx.Response(200, headers=HTML, text=page_evil),
    }

    async def go():
        e = _enricher(routes)
        return await e.find("https://news.x.com/a"), await e.find("https://news.x.com/b")

    assert asyncio.run(go()) == (None, None)


def test_enricher_rejects_redirect_to_home_and_skips_wrappers():
    calls = []
    routes = {("news.x.com", "/story"): httpx.Response(302, headers={"location": "https://news.x.com/"}),
              ("news.x.com", "/"): httpx.Response(200, headers=HTML, text=FOOL_HEAD)}
    e = _enricher(routes, calls)
    assert asyncio.run(e.find("https://news.x.com/story")) is None
    calls.clear()
    assert asyncio.run(e.find("https://news.google.com/rss/articles/CBMi123")) is None
    assert asyncio.run(e.find("https://www.sec.gov/Archives/edgar/data/1/x.htm")) is None
    assert asyncio.run(e.find("")) is None
    assert calls == []


def test_enricher_marks_repeated_image_generic():
    page = '<head><meta property="og:image" content="https://cdn.x.com/site-card.jpg"></head>'
    routes = {("cdn.x.com", "/site-card.jpg"): httpx.Response(200, headers=JPEG)}
    for i in range(4):
        routes[("news.x.com", f"/s{i}")] = httpx.Response(200, headers=HTML, text=page)
    redis = FakeRedis()
    e = _enricher(routes, redis=redis)

    async def go():
        return [await e.find(f"https://news.x.com/s{i}") for i in range(4)]

    got = asyncio.run(go())
    assert got[:2] == ["https://cdn.x.com/site-card.jpg"] * 2 and got[2:] == [None, None]
    assert e.new_generic == ["https://cdn.x.com/site-card.jpg"]
    assert redis.sets[enrich.GENERIC_KEY] == {"https://cdn.x.com/site-card.jpg"}
    # a cached positive that later proved generic is not served
    assert asyncio.run(e.find("https://news.x.com/s0")) is None


def test_enricher_network_error_is_swallowed():
    def boom(req):
        raise httpx.ConnectError("down")
    routes = {("news.x.com", "/robots.txt"): httpx.Response(404), ("news.x.com", "/a"): boom}
    e = _enricher(routes)
    assert asyncio.run(e.find("https://news.x.com/a")) is None
    assert e.stats["errors"] == 1


# ── pipeline pass + backfill ────────────────────────────────────────────

@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[NewsItem.__table__])
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _add(sf, i, url, *, image=None, hours_ago=1, sources=None):
    now = datetime.now(timezone.utc)
    with sf() as db:
        db.add(NewsItem(cluster_id=f"c{i}", title=f"Story {i}", url=url, source="Yahoo Finance",
                        source_feed="yahoo_finance", sources=sources or [{"url": url}], sources_count=1,
                        published_at=now - timedelta(hours=hours_ago), ingested_at=now, image_url=image,
                        tickers=[], categories=["other"], primary_category="other"))
        db.commit()


class FakeEnricher:
    def __init__(self, answers):
        self.answers, self.asked, self.new_generic = answers, [], []
        self.stats = {}

    async def find(self, url):
        self.asked.append(url)
        return self.answers.get(url)

    async def is_cached(self, url):
        return False

    async def aclose(self):
        pass


def _svc(sf, sent, redis=None):
    from app.services.news_intel.pipeline import NewsIntelService

    async def publisher(channel, msg):
        sent.append(msg)

    return NewsIntelService(session_factory=sf, publisher=publisher, pollers=[], redis=redis)


def test_image_pass_fills_missing_and_publishes(session_factory):
    _add(session_factory, 1, "https://news.google.com/rss/articles/X",
         sources=[{"url": "https://news.google.com/rss/articles/X"}, {"url": "https://www.cnbc.com/s"}])
    _add(session_factory, 2, "https://news.x.com/b", image="https://feed.cdn/keep.jpg")
    _add(session_factory, 3, "https://news.x.com/c")
    _add(session_factory, 4, "https://news.x.com/old", hours_ago=24 * 5)
    sent = []
    svc = _svc(session_factory, sent)
    svc.images = FakeEnricher({"https://www.cnbc.com/s": "https://image.cnbcfm.com/a.jpg"})
    found = asyncio.run(svc.run_image_pass(window=10, max_lookups=10))
    assert found == 1
    # feed image never overwritten; 5-day-old story is the backfill's job
    assert "https://news.x.com/b" not in svc.images.asked and "https://news.x.com/old" not in svc.images.asked
    assert [m["item"]["image_url"] for m in sent] == ["https://image.cnbcfm.com/a.jpg"]
    with session_factory() as db:
        assert db.query(NewsItem).filter_by(cluster_id="c1").one().image_url == "https://image.cnbcfm.com/a.jpg"
        assert db.query(NewsItem).filter_by(cluster_id="c2").one().image_url == "https://feed.cdn/keep.jpg"


def test_image_pass_caps_uncached_lookups(session_factory):
    for i in range(6):
        _add(session_factory, i, f"https://news.x.com/{i}")
    svc = _svc(session_factory, [])
    svc.images = FakeEnricher({})
    asyncio.run(svc.run_image_pass(window=10, max_lookups=2))
    assert len(svc.images.asked) == 2


def test_backfill_once_idempotent_and_capped(session_factory):
    for i in range(5):
        _add(session_factory, i, f"https://news.x.com/{i}", hours_ago=24 * (i + 1))
    _add(session_factory, 99, "https://news.x.com/ancient", hours_ago=24 * 20)
    redis = FakeRedis()
    sent = []
    svc = _svc(session_factory, sent, redis=redis)
    svc.images = FakeEnricher({f"https://news.x.com/{i}": f"https://cdn.x.com/{i}.jpg" for i in range(5)})
    n = asyncio.run(svc.run_image_backfill(days=14, cap=4, batch=2))
    assert n == 4 and sent == []  # backfill does not spam the live socket
    assert "https://news.x.com/ancient" not in svc.images.asked
    from app.services.news_intel.pipeline import IMAGE_BACKFILL_VERSION

    assert redis.kv["qt:news:image_backfill"] == IMAGE_BACKFILL_VERSION
    assert asyncio.run(svc.run_image_backfill(days=14, cap=4)) == 0  # already done


def test_generic_image_cleared_from_rows(session_factory):
    _add(session_factory, 1, "https://news.x.com/1", image="https://cdn.x.com/card.jpg")
    _add(session_factory, 2, "https://news.x.com/2")
    svc = _svc(session_factory, [])
    fake = FakeEnricher({})
    fake.new_generic = ["https://cdn.x.com/card.jpg"]
    svc.images = fake
    asyncio.run(svc.run_image_pass())
    with session_factory() as db:
        assert db.query(NewsItem).filter_by(cluster_id="c1").one().image_url is None
