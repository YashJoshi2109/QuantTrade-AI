"""
Images for Google News (aggregator) stories, compliant paths only. No network:
recorded feeds/pages, httpx.MockTransport and a fake DNS resolver.

  (a) cluster siblings: a sibling's image is reused with that source's attribution
  (b) publisher's own public feed: headline match -> feed image / direct og:image
  (c) image embedded in the Google entry: publisher-hosted or lh*.googleusercontent only
  (d) publisher logo for the designed tile (robots-aware, SSRF-safe, cached)

news.google.com wrapper URLs are never requested on any path.
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
from app.services.news_intel import enrich, images, publishers, store
from app.services.news_intel.publishers import (
    PublisherFeedIndex, normalize_title, parse_publisher_feed, publisher_for, publisher_home,
)
from app.services.news_intel.sources import parse_feed

FIX = Path(__file__).resolve().parents[1] / "fixtures"
FEEDS, PAGES = FIX / "news_feeds", FIX / "news_pages"
NOW = datetime(2026, 11, 28, 11, 0, tzinfo=timezone.utc)
WSJ_FEED = publishers._DJ + "RSSMarketsMain"
BBG_FEED = "https://feeds.bloomberg.com/markets/news.rss"


def _google(name="google_news_publishers.xml"):
    return parse_feed((FEEDS / name).read_bytes(), "google_markets", "Google News",
                      use_entry_source=True, keep_summary=False)


# ── (c) images inside the Google entry ──────────────────────────────────

def test_google_entries_keep_publisher_site_and_carry_no_images():
    items = _google()
    assert [(i.source, i.source_url) for i in items] == [
        ("WSJ", "https://www.wsj.com"), ("Yahoo Finance", "https://finance.yahoo.com"),
        ("WSJ", "https://www.wsj.com"), ("Bloomberg.com", "https://www.bloomberg.com")]
    assert all(i.image_url is None for i in items)          # channel logo is never used
    assert all(i.url.startswith("https://news.google.com/rss/articles/") for i in items)


def test_google_description_image_only_when_publisher_hosted_or_google_thumb():
    by_source = {i.source: i.image_url for i in _google("google_news_desc_images.xml")}
    assert by_source["CNBC"] == "https://image.cnbcfm.com/api/v1/image/108555275-story.jpg?w=1200"
    assert by_source["WSJ"] == "https://lh3.googleusercontent.com/proxy/AbC123-story=s0-w300-rw"
    assert by_source["Reuters"] is None                      # third-party host
    assert by_source["Fortune"] is None                      # Google's own branding
    assert by_source["The Wall Street Journal"] is None


def test_non_aggregator_feeds_unchanged_by_aggregator_rule():
    # The publisher-host restriction applies to aggregator entries only.
    items = parse_feed((FEEDS / "businesswire.xml").read_bytes(), "businesswire", "Business Wire")
    assert items[0].image_url.startswith("https://mms.businesswire.com/")


def test_site_domain_helpers():
    assert images.site_domain("https://www.WSJ.com/x") == "wsj.com"
    assert images.host_in_domain("images.wsj.net", "wsj.com") is False
    assert images.host_in_domain("markets.businessinsider.com", "businessinsider.com") is True
    assert images.host_in_domain("evilwsj.com", "wsj.com") is False


# ── publisher registry + title matching ─────────────────────────────────

def test_registry_lookup_by_domain_and_name():
    assert publisher_for("https://www.wsj.com").key == "wsj"
    assert publisher_for(name="Bloomberg.com").key == "bloomberg"
    assert publisher_for("uk.finance.yahoo.com").key == "yahoo_uk"
    assert publisher_for("https://markets.businessinsider.com/x").key == "businessinsider"
    assert publisher_for("https://unknown.example") is None
    assert publisher_for(name="Reuters").feeds == ()       # no public feed: logo tile only
    assert publisher_home("https://www.wsj.com") == "https://www.wsj.com"
    assert publisher_home(None, "WSJ") == "https://www.wsj.com"
    assert publisher_home("https://news.google.com/rss/articles/X", "Yahoo Finance") == "https://finance.yahoo.com"
    assert publisher_home(None, "Some Blog") is None


def test_every_registered_feed_is_https():
    for p in publishers.PUBLISHERS:
        assert all(f.startswith("https://") for f in p.feeds), p.key
        assert "news.google.com" not in " ".join(p.feeds)


@pytest.mark.parametrize("a,b", [
    ("Exclusive | Aschenbrenner’s Situational Awareness Lost 65%",
     "Aschenbrenner's Situational Awareness Lost 65%"),
    ("S&amp;P 500 “Safe” Stocks".replace("&amp;", "&"), "S and P 500 \"Safe\" stocks"),
    ("Opinion: Trump Can’t Rescue the Stock Market. Here’s What Can.",
     "Trump Cant Rescue the Stock Market Heres What Can"),
])
def test_normalize_title_equivalences(a, b):
    assert normalize_title(a) == normalize_title(b)


def test_parse_publisher_feed_keeps_on_domain_entries_with_images():
    wsj = publisher_for("wsj.com")
    entries = parse_publisher_feed((FEEDS / "publisher_wsj.xml").read_bytes(), wsj)
    assert entries and all(e.url.startswith("https://www.wsj.com/") for e in entries)
    by = {e.norm: e for e in entries}
    am = by[normalize_title("Americans Are More Exposed to the Stock Market Than Ever Before")]
    assert am.image == "https://images.wsj.net/im-11530422"
    assert am.published == datetime(2026, 11, 28, 2, 0, tzinfo=timezone.utc)
    # a feed entry linking off-domain is ignored
    assert parse_publisher_feed((FEEDS / "publisher_wsj.xml").read_bytes(), publisher_for("fortune.com")) == []


def _index(feeds, calls=None):
    async def fetch_feed(url):
        if calls is not None:
            calls.append(url)
        f = feeds.get(url)
        return (FEEDS / f).read_bytes() if f else None
    clock = {"t": 1000.0}
    idx = PublisherFeedIndex(fetch_feed, clock=lambda: clock["t"], now=lambda: NOW)
    return idx, clock


def test_index_matches_google_items_to_publisher_feed():
    calls = []
    idx, clock = _index({WSJ_FEED: "publisher_wsj.xml", BBG_FEED: "publisher_bloomberg.xml"}, calls)
    g = _google()

    async def go():
        out = [await idx.lookup(title=i.title, domain=i.source_url, name=i.source, published=i.published_at)
               for i in g]
        return out

    wsj1, yahoo, wsj2, bbg = asyncio.run(go())
    assert wsj1.url.startswith("https://www.wsj.com/") and wsj1.image == "https://images.wsj.net/im-11530422"
    assert wsj2 is not None and wsj2.image.startswith("https://images.wsj.net/")  # 39h later on Google: in window
    assert yahoo is None                                   # no public Yahoo Finance feed: nothing fetched
    assert bbg.url.startswith("https://www.bloomberg.com/news/articles/") and bbg.image is None
    assert not any("yahoo" in c for c in calls) and not any("news.google.com" in c for c in calls)
    # each registered feed read once per TTL, however many stories ask
    n = len(calls)
    asyncio.run(idx.lookup(title=g[0].title, domain="https://www.wsj.com"))
    assert len(calls) == n
    clock["t"] += publishers.FEED_TTL + 1
    asyncio.run(idx.lookup(title=g[0].title, domain="https://www.wsj.com"))
    assert len(calls) == n + len(publisher_for("wsj.com").feeds)


def test_index_time_window_and_fuzzy_rules():
    idx, _ = _index({WSJ_FEED: "publisher_wsj.xml"})
    title = "Americans Are More Exposed to the Stock Market Than Ever Before"

    async def look(t, published=None):
        return await idx.lookup(title=t, domain="wsj.com", published=published)

    assert asyncio.run(look(title, NOW)) is not None
    assert asyncio.run(look(title, NOW + timedelta(days=4))) is None              # outside the window
    assert asyncio.run(look("Americans Are More Exposed to the Stock Market Than Ever")) is not None  # near-identical
    assert asyncio.run(look("Americans Are Exposed to Stocks")) is None            # too different / short
    assert asyncio.run(look("")) is None


def test_index_unknown_publisher_and_fetch_failure_never_raise():
    async def boom(url):
        raise RuntimeError("down")

    idx = PublisherFeedIndex(boom, now=lambda: NOW)
    assert asyncio.run(idx.lookup(title="x y z a b c", domain="wsj.com")) is None
    assert asyncio.run(idx.lookup(title="x y z a b c", domain="unknown.example")) is None


# ── enricher: publisher feed + logo fetches (robots, SSRF) ──────────────

def _resolver(table):
    async def resolve(host, port):
        if host not in table:
            raise OSError("NXDOMAIN")
        return table[host]
    return resolve


TABLE = {"feeds.content.dowjones.io": ["93.184.216.10"], "www.theglobeandmail.com": ["93.184.216.11"],
         "finance.yahoo.com": ["93.184.216.12"], "s.yimg.com": ["93.184.216.13"],
         "www.reuters.com": ["93.184.216.14"], "internal.example.com": ["10.0.0.7"],
         "www.private-logo.com": ["93.184.216.15"]}
HTML = {"content-type": "text/html; charset=utf-8"}
PNG = {"content-type": "image/png"}
XML = {"content-type": "application/rss+xml"}


def _enricher(routes, calls=None):
    def handler(req):
        key = (req.headers["host"], req.url.path)
        if calls is not None:
            calls.append((req.method, req.headers["host"], req.url.path))
        r = routes.get(key)
        return r(req) if callable(r) else (r or httpx.Response(404))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return enrich.ImageEnricher(client=client, resolver=_resolver(TABLE), per_host_interval=0)


def test_fetch_feed_respects_robots_and_https():
    calls = []
    body = (FEEDS / "publisher_wsj.xml").read_bytes()
    routes = {("feeds.content.dowjones.io", "/robots.txt"): httpx.Response(200, text="User-agent: *\nDisallow: /private/\n"),
              ("feeds.content.dowjones.io", "/public/rss/RSSMarketsMain"): httpx.Response(200, headers=XML, content=body)}
    e = _enricher(routes, calls)
    assert asyncio.run(e.fetch_feed(WSJ_FEED)) == body
    assert asyncio.run(e.fetch_feed("https://feeds.content.dowjones.io/private/x")) is None
    assert asyncio.run(e.fetch_feed("http://feeds.content.dowjones.io/public/rss/RSSMarketsMain")) is None
    assert [c[2] for c in calls] == ["/robots.txt", "/public/rss/RSSMarketsMain"]
    assert asyncio.run(e.fetch_feed("https://internal.example.com/feed.xml")) is None  # private IP: SSRF guard


def test_page_logo_recorded_heads():
    gm = images.page_logo((PAGES / "globeandmail_home.html").read_text(), "https://www.theglobeandmail.com/")
    assert gm == "https://www.theglobeandmail.com/pf/resources/assets/meta/apple-touch-icon.png?d=1002"
    yf = images.page_logo((PAGES / "yahoo_finance_home.html").read_text(), "https://finance.yahoo.com/")
    assert yf == "https://s.yimg.com/cv/apiv2/default/finance/favicon-180x180.png"
    svg_only = '<head><link rel="icon" href="/brand.svg" type="image/svg+xml"><link rel="icon" href="/f.ico"></head>'
    assert images.page_logo(svg_only, "https://x.com/") == "https://x.com/brand.svg"
    assert images.page_logo('<head><link rel="icon" sizes="32x32" href="/f32.png"></head>', "https://x.com/") is None
    assert images.page_logo('<head><link rel="mask-icon" href="/pin.svg"></head>', "https://x.com/") is None


def test_find_logo_from_home_head_validated_and_cached():
    calls = []
    routes = {("www.theglobeandmail.com", "/robots.txt"): httpx.Response(200, text="User-agent: *\nAllow: /\n"),
              ("www.theglobeandmail.com", "/"): httpx.Response(200, headers=HTML,
                                                               text=(PAGES / "globeandmail_home.html").read_text()),
              ("www.theglobeandmail.com", "/pf/resources/assets/meta/apple-touch-icon.png"): httpx.Response(200, headers=PNG)}
    e = _enricher(routes, calls)

    async def go():
        a = await asyncio.gather(*(e.find_logo("https://www.theglobeandmail.com") for _ in range(5)))
        n = len(calls)
        b = await e.find_logo("https://www.theglobeandmail.com/business/article-x/")
        return a, b, n

    a, b, n = asyncio.run(go())
    assert set(a) == {b} and b.endswith("/apple-touch-icon.png?d=1002")
    assert n == 3 and len(calls) == 3        # robots, home, HEAD logo: once for 6 concurrent/later asks
    assert asyncio.run(e.is_logo_cached("https://www.theglobeandmail.com"))


def test_find_logo_robots_disallow_home_falls_back_to_touch_icon_only_if_allowed():
    calls = []
    routes = {("www.reuters.com", "/robots.txt"): httpx.Response(200, text="User-agent: *\nDisallow: /\n"),
              ("www.reuters.com", "/"): httpx.Response(200, headers=HTML, text="<head></head>")}
    e = _enricher(routes, calls)
    assert asyncio.run(e.find_logo("https://www.reuters.com")) is None
    assert [c[2] for c in calls] == ["/robots.txt"]          # nothing else requested

    calls2 = []
    routes = {("finance.yahoo.com", "/robots.txt"): httpx.Response(200, text="User-agent: *\nAllow: /apple-touch-icon.png\nDisallow: /\n"),
              ("finance.yahoo.com", "/apple-touch-icon.png"): httpx.Response(200, headers=PNG)}
    e2 = _enricher(routes, calls2)
    assert asyncio.run(e2.find_logo("https://finance.yahoo.com")) == "https://finance.yahoo.com/apple-touch-icon.png"
    assert "/" not in [c[2] for c in calls2]


def test_find_logo_rejects_private_logo_host_and_skips_wrappers():
    calls = []
    head = '<head><link rel="apple-touch-icon" href="https://internal.example.com/logo.png"></head>'
    routes = {("www.private-logo.com", "/"): httpx.Response(200, headers=HTML, text=head),
              ("www.private-logo.com", "/apple-touch-icon.png"): httpx.Response(404)}
    e = _enricher(routes, calls)
    assert asyncio.run(e.find_logo("https://www.private-logo.com")) is None
    assert not any(c[1] == "internal.example.com" for c in calls)
    calls.clear()
    assert asyncio.run(e.find_logo("https://news.google.com/rss/articles/X")) is None
    assert asyncio.run(e.find_logo("https://www.sec.gov")) is None
    assert calls == []


# ── pipeline: all four paths end to end (fake enricher + recorded feeds) ─

@pytest.fixture
def sf():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[NewsItem.__table__])
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _row(sf, cid, title, source, sources, *, url=None, image=None, hours_ago=1):
    now = datetime.now(timezone.utc)
    with sf() as db:
        db.add(NewsItem(cluster_id=cid, title=title, url=url or sources[0]["url"], source=source,
                        source_feed=sources[0].get("feed"), sources=sources, sources_count=len(sources),
                        published_at=now - timedelta(hours=hours_ago), ingested_at=now, image_url=image,
                        tickers=[], categories=["market_moves"], primary_category="market_moves"))
        db.commit()


def _g(url_id, source, title, site=None, published="2026-11-28T08:00:00Z"):
    e = {"source": source, "feed": "google_markets", "url": f"https://news.google.com/rss/articles/{url_id}",
         "title": title, "published_at": published}
    if site:
        e["site"] = site
    return e


class FakeEnricher:
    def __init__(self, answers=None, logos=None, cached=()):
        self.answers, self.logos, self.cached = answers or {}, logos or {}, set(cached)
        self.asked, self.logo_asked, self.new_generic, self.stats = [], [], [], {}

    async def find(self, url):
        self.asked.append(url)
        return self.answers.get(url) if enrich.should_enrich(url) else None

    async def is_cached(self, url):
        return (not enrich.should_enrich(url)) or url in self.cached

    async def find_logo(self, site):
        self.logo_asked.append(site)
        return self.logos.get(site)

    async def is_logo_cached(self, site):
        return site in self.cached

    async def aclose(self):
        pass


def _svc(sf, sent, enricher, feeds=None, fetched=None):
    from app.services.news_intel.pipeline import NewsIntelService

    async def publisher(channel, msg):
        sent.append(msg["item"])

    svc = NewsIntelService(session_factory=sf, publisher=publisher, pollers=[])
    svc.images = enricher
    if feeds is not None:
        svc.publisher_index, _ = _index(feeds, fetched)
    return svc


def _payload(sf, cid):
    with sf() as db:
        return store.serialize(db.query(NewsItem).filter_by(cluster_id=cid).one())


def test_path_a_sibling_feed_image_keeps_its_attribution(sf):
    _row(sf, "a1", "Fed holds rates", "WSJ", [_g("A1", "WSJ", "Fed holds rates", "https://www.wsj.com")])
    with sf() as db:
        store.add_source(db, "a1", {"source": "CNBC", "feed": "finnhub_general", "url": "https://www.cnbc.com/fed",
                                    "title": "Fed holds rates", "image_url": "https://image.cnbcfm.com/fed.jpg"},
                         image_url="https://image.cnbcfm.com/fed.jpg")
    p = _payload(sf, "a1")
    assert p["image_url"] == "https://image.cnbcfm.com/fed.jpg"
    assert p["image_source"] == "CNBC" and p["source"] == "WSJ"


def test_path_a_sibling_og_image_attributed_to_sibling(sf):
    _row(sf, "a2", "Oil jumps", "Reuters",
         [_g("A2", "Reuters", "Oil jumps"), {"source": "CNBC", "url": "https://www.cnbc.com/oil", "title": "Oil jumps"}])
    sent = []
    fake = FakeEnricher({"https://www.cnbc.com/oil": "https://image.cnbcfm.com/oil.jpg"})
    svc = _svc(sf, sent, fake, feeds={})
    assert asyncio.run(svc.run_image_pass()) == 1
    assert sent[-1]["image_url"] == "https://image.cnbcfm.com/oil.jpg" and sent[-1]["image_source"] == "CNBC"
    assert not any("news.google.com" in u for u in fake.asked if enrich.should_enrich(u))


def test_path_b_publisher_feed_image_for_legacy_and_new_rows(sf):
    t1 = "Americans Are More Exposed to the Stock Market Than Ever Before"
    t2 = "Nvidia Tells Partners to Pause Shipments to Southeast Asia"
    _row(sf, "b1", t1, "WSJ", [_g("B1", "WSJ", t1, "https://www.wsj.com", "2026-11-28T02:00:00Z")])
    _row(sf, "b2", t2, "WSJ", [_g("B2", "WSJ", t2, None, "2026-11-28T08:34:54Z")])   # legacy row: no site
    sent, fetched = [], []
    svc = _svc(sf, sent, FakeEnricher(), feeds={WSJ_FEED: "publisher_wsj.xml"}, fetched=fetched)
    assert asyncio.run(svc.run_image_pass()) == 2
    p1, p2 = _payload(sf, "b1"), _payload(sf, "b2")
    assert p1["image_url"] == "https://images.wsj.net/im-11530422" and p1["image_source"] == "WSJ"
    assert p2["image_url"].startswith("https://images.wsj.net/")
    assert p1["sources"][0]["direct_url"].startswith("https://www.wsj.com/")
    assert p1["url"].startswith("https://news.google.com/")      # card link unchanged
    assert not any("news.google.com" in u for u in fetched)


def test_path_b_direct_url_og_image_within_budget(sf):
    t = "Trump’s AI Gambit Fuels Wild Thanksgiving Week on Wall Street"
    _row(sf, "b3", t, "Bloomberg.com", [_g("B3", "Bloomberg.com", t, "https://www.bloomberg.com",
                                         "2026-11-27T18:43:36Z")])
    direct = ("https://www.bloomberg.com/news/articles/2026-11-27/"
              "trump-s-ai-gambit-fuels-wild-thanksgiving-week-on-wall-street")
    feeds = {BBG_FEED: "publisher_bloomberg.xml"}
    # budget exhausted: the direct article page is not fetched this pass
    fake = FakeEnricher()
    svc = _svc(sf, [], fake, feeds=feeds)
    asyncio.run(svc.run_image_pass(max_lookups=0))
    assert not any(u.startswith("https://www.bloomberg.com/news/") for u in fake.asked)
    # budget available: og:image of the direct URL via the robots-aware enricher
    fake = FakeEnricher({direct: "https://assets.bwbx.io/images/story.jpg"})
    svc = _svc(sf, [], fake, feeds=feeds)
    asyncio.run(svc.run_image_pass(max_lookups=5))
    assert [u for u in fake.asked if u.startswith("https://www.bloomberg.com/news/")] == [direct]
    p = _payload(sf, "b3")
    assert p["image_url"] == "https://assets.bwbx.io/images/story.jpg" and p["image_source"] == "Bloomberg.com"
    assert p["sources"][0]["direct_url"] == direct


def test_path_d_logo_tile_when_nothing_else(sf):
    _row(sf, "d1", "3 Biotech Stocks Trading Below Fair Value", "Yahoo Finance",
         [_g("D1", "Yahoo Finance", "3 Biotech Stocks Trading Below Fair Value", "https://finance.yahoo.com")])
    _row(sf, "d2", "Explosion reported at school", "Reuters", [_g("D2", "Reuters", "Explosion reported at school")])
    sent = []
    fake = FakeEnricher(logos={"https://finance.yahoo.com": "https://s.yimg.com/cv/apiv2/default/finance/favicon-180x180.png"})
    svc = _svc(sf, sent, fake, feeds={})
    assert asyncio.run(svc.run_image_pass()) == 0
    p1, p2 = _payload(sf, "d1"), _payload(sf, "d2")
    assert p1["image_url"] is None and p1["source_logo"].startswith("https://s.yimg.com/")
    assert p2["source_logo"] is None
    assert set(fake.logo_asked) == {"https://finance.yahoo.com", "https://www.reuters.com"}  # legacy row: by name
    assert [m["cluster_id"] for m in sent] == ["d1"]
    # logo stored once; a later pass does not ask again for that row
    fake.logo_asked.clear()
    asyncio.run(svc.run_image_pass())
    assert fake.logo_asked == ["https://www.reuters.com"]


def test_path_d_logo_lookups_capped_per_pass(sf):
    for i in range(6):
        _row(sf, f"c{i}", f"Story {i}", f"Pub {i}", [{"source": f"Pub {i}", "url": f"https://pub{i}.example/s"}])
    fake = FakeEnricher()
    svc = _svc(sf, [], fake, feeds={})
    asyncio.run(svc.run_image_pass(max_logo_lookups=2))
    assert len(fake.logo_asked) == 2


def test_backfill_clears_stored_placeholder_logos(sf):
    _row(sf, "r1", "Iran story", "Reuters", [_g("R1", "Reuters", "Iran story")],
         image="https://static2.finnhub.io/file/finnhub/logo/reuters_logo.jpeg")
    _row(sf, "r2", "Real photo", "CNBC", [{"source": "CNBC", "url": "https://www.cnbc.com/x"}],
         image="https://image.cnbcfm.com/real.jpg")
    svc = _svc(sf, [], FakeEnricher(), feeds={})
    asyncio.run(svc.run_image_backfill())
    assert _payload(sf, "r1")["image_url"] is None
    assert _payload(sf, "r2")["image_url"] == "https://image.cnbcfm.com/real.jpg"


def test_new_rows_record_site_and_per_source_image():
    from app.services.news_intel.pipeline import _source_entry

    g = _google()[0]
    e = _source_entry(g)
    assert e["site"] == "https://www.wsj.com" and "image_url" not in e
    c = _google("google_news_desc_images.xml")[0]
    assert _source_entry(c)["image_url"].startswith("https://image.cnbcfm.com/")
