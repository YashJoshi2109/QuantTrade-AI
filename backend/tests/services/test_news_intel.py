"""
News intelligence pipeline unit tests: dedupe/clustering, category rules,
classifier interface (model mocked), impact score, AI-note daily cap, feed
endpoint filters, WebSocket publish. No network, no real models, SQLite.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base, get_db
from app.models.news_item import NewsItem
from app.services.news_intel import ai_notes, dedupe, impact, sentiment as sentiment_mod
from app.services.news_intel.categories import CATEGORY_KEYS, rule_categories
from app.services.news_intel.sources import RawItem, parse_alpaca_message, parse_finnhub, parse_sec_8k

NOW = datetime(2026, 11, 25, 15, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _no_models(monkeypatch):
    """Never load transformer models in unit tests."""
    monkeypatch.setenv("NEWS_INTEL_MODELS", "0")
    from app.services.news_intel import categorizer as cat_mod
    from app.services.news_intel import tickers as tick_mod

    sentiment_mod.set_sentiment_classifier(sentiment_mod.SentimentClassifier())
    cat_mod.set_categorizer(cat_mod.Categorizer())
    idx = tick_mod.TickerIndex()
    idx.load_rows([
        ("AAPL", "Apple Inc", 3.0e12),
        ("MSFT", "Microsoft Corp", 3.1e12),
        ("NVDA", "NVIDIA Corp", 4.0e12),
        ("GOOG", "Alphabet Inc Class C", 1.8e12),
        ("GOOGL", "Alphabet Inc Class A", 1.9e12),
        ("TGT", "Target Corp", 5.0e10),
        ("SMCO", "Small Co Holdings", 2.0e8),
    ])
    monkeypatch.setattr(tick_mod, "_index", idx)
    yield
    sentiment_mod.set_sentiment_classifier(None)
    cat_mod.set_categorizer(None)


# ── dedupe / clustering ────────────────────────────────────────────────

def test_canonical_url_strips_tracking_and_www():
    a = dedupe.canonical_url("https://www.reuters.com/markets/x/?utm_source=tw&utm_medium=s&id=7#frag")
    b = dedupe.canonical_url("http://reuters.com/markets/x?id=7")
    assert a == b == "https://reuters.com/markets/x?id=7"


def test_exact_url_duplicate_dropped():
    c = dedupe.Clusterer()
    d1 = c.assign("Apple beats estimates", "https://x.com/a?utm_source=rss", now=NOW)
    d2 = c.assign("Apple beats estimates (updated)", "https://www.x.com/a", now=NOW)
    assert d1.kind == "new" and d2.kind == "duplicate" and d2.cluster_id == d1.cluster_id


def test_same_title_other_outlet_joins_cluster():
    c = dedupe.Clusterer()
    d1 = c.assign("Fed holds rates steady, signals two cuts in 2026 - Reuters", "https://reuters.com/1", now=NOW)
    d2 = c.assign("Fed holds rates steady, signals two cuts in 2026 - CNBC", "https://cnbc.com/2", now=NOW)
    assert d2.kind == "join" and d2.cluster_id == d1.cluster_id


def test_near_duplicate_joins_but_different_story_does_not():
    c = dedupe.Clusterer()
    d1 = c.assign("Pfizer agrees to acquire Metsera for up to $10 billion", "https://a.com/1", now=NOW)
    d2 = c.assign("Pfizer agrees to acquire obesity startup Metsera for up to $10 billion", "https://b.com/2", now=NOW)
    d3 = c.assign("Pfizer cuts full-year revenue forecast", "https://c.com/3", now=NOW)
    assert d2.kind == "join" and d2.cluster_id == d1.cluster_id
    assert d3.kind == "new" and d3.cluster_id != d1.cluster_id


def test_clusters_expire_after_window():
    c = dedupe.Clusterer(window_hours=24)
    d1 = c.assign("Nvidia revenue jumps 62% to record", "https://a.com/1", now=NOW)
    assert c.prune(now=NOW + timedelta(hours=25)) == 1
    d2 = c.assign("Nvidia revenue jumps 62% to record", "https://b.com/2", now=NOW + timedelta(hours=25))
    assert d2.kind == "new" and d2.cluster_id != d1.cluster_id


def test_seed_rebuilds_state():
    c = dedupe.Clusterer()
    c.seed("abc", "Tesla recalls 13,000 vehicles", ["https://t.com/r"], NOW)
    assert c.assign("anything", "https://t.com/r", now=NOW).kind == "duplicate"
    assert c.assign("Tesla recalls 13,000 vehicles - AP", "https://o.com/z", now=NOW).cluster_id == "abc"


# ── category rules ─────────────────────────────────────────────────────

@pytest.mark.parametrize("title,expected", [
    ("Apple Q4 results beat estimates as iPhone sales rise", "earnings"),
    ("Microsoft to acquire Activision Blizzard for $69 billion", "mna"),
    ("Goldman upgrades Tesla to buy, raises price target to $500", "analyst"),
    ("FOMC holds rates steady; Powell signals patience", "macro_fed"),
    ("CPI rises 0.3% in October as shelter costs climb", "economic_data"),
    ("Figma files for IPO on the NYSE", "ipo_offering"),
    ("Coca-Cola raises quarterly dividend for 63rd year", "capital_return"),
    ("SEC charges former executives with accounting fraud", "regulatory_legal"),
    ("Trump announces new tariffs on Chinese imports", "geopolitics"),
    ("Oil jumps 3% as OPEC+ extends output cuts", "energy_commodities"),
    ("Bitcoin tops $120,000 as ETF inflows surge", "crypto"),
    ("Peloton cuts full-year outlook, shares tumble", "guidance"),
])
def test_rules_primary(title, expected):
    cats = rule_categories(title)
    assert cats and cats[0] == expected, cats


def test_rules_precision_guards():
    assert "mna" not in rule_categories("Is now a good time to buy stocks?")
    assert "regulatory_legal" not in rule_categories("Oil settles higher after volatile session")
    assert "guidance" not in rule_categories("UBS raises Nvidia price target to $250")
    # Pure price action is its own category, never an event category.
    assert rule_categories("Stocks open higher on Wall Street") == ["market_moves"]
    assert rule_categories("Morgan Stanley downgrades Tesla to Equal-Weight")[0] == "analyst"
    assert rule_categories("Fed holds rates steady; stocks rally")[0] == "macro_fed"
    assert rule_categories("NVIDIA beats third-quarter estimates as revenue jumps 94%")[0] == "earnings"


def test_market_moves_and_language_filter_on_real_headlines():
    from app.services.news_intel.language import is_english

    moves = [
        "Stocks Finish Lower After Wild Session",
        "Dow closes higher after erasing 1,100-point loss as S&P 500, Nasdaq slip",
        "Nvidia leads tech sell-off as Huang comeback rally fizzles and AI concerns mount",
        "12 Health Care Stocks Moving In Wednesday's After-Market Session",
        "Why Is Credo Stock Going Up?",
        "Stocks mixed as Wall Street erases sharp decline: Nvidia down 6%",
    ]
    for t in moves:
        assert rule_categories(t)[:1] == ["market_moves"], t
    assert "earnings" in rule_categories("Kewaunee Scientific to Report Results for Second Quarter Fiscal Year 2027")

    foreign = [
        "Resumen: BTS y Veridas se asocian para reforzar la identidad digital y prevenir el fraude",
        "BTS und Veridas stärken gemeinsam die digitale Identitätsprüfung und Betrugsprävention",
        "Hurricane Electric étend son réseau mondial avec un nouveau point de présence à iXAfrica NBOX1",
        "IQM Quantum Computers與南韓量子—人工智慧公司QAI將合作",
        "Útgerðarfélag Reykjavíkur hf.: Útgáfa á víxlum",
    ]
    english = [
        "Nestlé raises outlook as Café sales jump",
        "L'Oréal shares fall after results",
        "Société Générale to cut jobs",
        "BRK.B up 2%",
        "Anthropic’s stock slide tests Wall Street’s AI profit expectations",
    ]
    assert not any(is_english(t) for t in foreign)
    assert all(is_english(t) for t in english)


def test_categorizer_rules_only_falls_back_to_other():
    from app.services.news_intel.categorizer import get_categorizer

    res = get_categorizer().classify(["Five things to know today", "Nvidia EPS tops estimates"])
    assert res[0].primary == "other" and res[0].method == "none"
    assert res[1].primary == "earnings" and res[1].method == "rules"


# ── sentiment classifier interface (model mocked) ──────────────────────

class _FakeTensor:
    def __init__(self, rows):
        self.rows = rows


class _FakeOut:
    def __init__(self, logits):
        self.logits = logits


def test_classifier_interface_with_mocked_model():
    clf = sentiment_mod.SentimentClassifier()
    probs = {"good": [0.9, 0.05, 0.05], "bad": [0.1, 0.8, 0.1], "meh": [0.1, 0.1, 0.8]}

    class Model:  # stands in for onnx_models.FinbertOnnx
        def probs(self, texts):
            return [probs[t] for t in texts]

    clf._model = Model()
    clf._id2label = {0: "positive", 1: "negative", 2: "neutral"}
    out = clf.classify(["good", "bad", "meh"], batch_size=2)
    assert [s.label for s in out] == ["bullish", "bearish", "neutral"]
    assert out[0].score == pytest.approx(0.85, abs=1e-3)       # P(pos) - P(neg)
    assert out[1].score == pytest.approx(-0.7, abs=1e-3)
    assert out[2].confidence == pytest.approx(0.8, abs=1e-3)   # max prob
    assert out[0].as_api() == {"label": "bullish", "score": out[0].score, "confidence": out[0].confidence}
    assert out[0].legacy_label() == "Bullish" and out[0].model == "finbert-onnx-int8"


def test_api_process_never_loads_models(monkeypatch):
    """Models load only with NEWS_INTEL_MODELS=1 (set by the news-worker)."""
    monkeypatch.delenv("NEWS_INTEL_MODELS", raising=False)
    from app.services.news_intel.categorizer import Categorizer

    clf = sentiment_mod.SentimentClassifier()
    assert clf.load() is False and clf.backend == "keyword"
    assert Categorizer().load() is False
    assert clf.classify(["Stock soars on record profit"])[0].model == "keyword"


def test_onnx_models_end_to_end_if_exported(monkeypatch):
    """Real int8 ONNX models (skipped unless app/services/news_intel/export_models.py output exists)."""
    import os
    from pathlib import Path

    d = Path(os.environ.get("NEWS_MODELS_DIR", "/opt/news-models"))
    if not (d / "finbert" / "model.onnx").exists():
        pytest.skip("ONNX models not exported")
    monkeypatch.setenv("NEWS_INTEL_MODELS", "1")
    from app.services.news_intel.categorizer import Categorizer

    clf = sentiment_mod.SentimentClassifier()
    out = clf.classify(["Profit soared to a record and the company raised guidance",
                        "Shares plunged after the company slashed its forecast"])
    assert [o.label for o in out] == ["bullish", "bearish"]
    res = Categorizer().classify(["Stocks to watch this week"])
    assert res[0].method == "embedding"


def test_keyword_fallback_when_models_disabled():
    clf = sentiment_mod.SentimentClassifier()
    out = clf.classify(["Shares plunge after earnings miss and guidance cut", "Company holds annual meeting"])
    assert out[0].label == "bearish" and out[0].score < 0 and out[0].model == "keyword"
    assert out[1].label == "neutral" and out[1].score == 0.0
    assert not clf.loaded


def test_legacy_labels_use_shared_classifier():
    class Fake:
        def classify(self, texts, **kw):
            return [sentiment_mod.Sentiment("bullish", 0.9, 0.95, {}) for _ in texts]

    sentiment_mod.set_sentiment_classifier(Fake())
    assert sentiment_mod.legacy_labels(["a", "b"]) == ["Bullish", "Bullish"]
    from app.services.sentiment_service import SentimentService

    assert SentimentService().score_text("this is a long enough post").label == "bullish"


def test_sentiment_text_appends_short_summary_only():
    assert sentiment_mod.sentiment_text("T", "short") == "T. short"
    assert sentiment_mod.sentiment_text("T", "x" * 500) == "T"


# ── impact ─────────────────────────────────────────────────────────────

def _imp(**kw):
    base = dict(sentiment_score=0.8, sentiment_confidence=0.9, source="Reuters", market_caps=[3e12],
                categories=["earnings"], published_at=NOW, n_sources=1, now=NOW)
    base.update(kw)
    return impact.impact_score(**base)


def test_impact_range_and_monotonicity():
    v = _imp()
    assert 0 <= v <= 100
    assert _imp(sentiment_score=0.1) < v                      # weaker sentiment
    assert _imp(source="Some Blog") < v                       # less credible
    assert _imp(market_caps=[2e8]) < v                        # smaller company
    assert _imp(published_at=NOW - timedelta(hours=12)) < v   # older
    assert _imp(n_sources=6) > v                              # corroborated
    assert _imp(sentiment_score=0.0, sentiment_confidence=1.0) > 0  # neutral floor


def test_impact_formula_value():
    # S = 0.2 + 0.8*0.8*0.9 = 0.776; W = 0.95; K = 1.0 (cap >= ~3.16e12); R = 1; N = 0.6 + 0.4*1/log2(9)
    n = 0.6 + 0.4 * 1 / 3.169925
    assert _imp(market_caps=[4e12]) == round(100 * 0.776 * 0.95 * 1.0 * 1.0 * n)


def test_impact_market_wide_without_tickers():
    assert _imp(market_caps=[], categories=["macro_fed"]) > _imp(market_caps=[], categories=["product_business"])


# ── AI-note daily cap ──────────────────────────────────────────────────

class FakeRedis:
    def __init__(self):
        self.kv, self.hashes = {}, {}

    async def incr(self, k):
        self.kv[k] = int(self.kv.get(k, 0)) + 1
        return self.kv[k]

    async def expire(self, k, s):
        return True

    async def get(self, k):
        return self.kv.get(k)

    async def set(self, k, v, nx=False, ex=None):
        if nx and k in self.kv:
            return None
        self.kv[k] = v
        return True

    async def delete(self, k):
        self.kv.pop(k, None)

    async def hset(self, h, k, v):
        self.hashes.setdefault(h, {})[k] = v

    async def hgetall(self, h):
        return self.hashes.get(h, {})


def test_daily_cap_memory_and_redis():
    async def go():
        cap = ai_notes.DailyCap(limit=3)
        got = [await cap.try_acquire(NOW) for _ in range(5)]
        assert got == [True, True, True, False, False]
        assert await cap.try_acquire(NOW + timedelta(days=1))  # new UTC day resets
        r = FakeRedis()
        cap2 = ai_notes.DailyCap(limit=2, redis=r)
        assert [await cap2.try_acquire(NOW) for _ in range(3)] == [True, True, False]
        assert await ai_notes.DailyCap(limit=2, redis=r).used(NOW) == 3  # shared across instances
        assert not await ai_notes.DailyCap(limit=0).try_acquire(NOW)
    asyncio.run(go())


def test_parse_note_validates():
    note = ai_notes.parse_note('Sure: {"why_it_matters": "Big deal.", "direction": "UP", "horizon": "years",'
                               ' "affected_tickers": ["$aapl", "not a ticker", "MSFT"]}')
    assert note == {"why_it_matters": "Big deal.", "direction": "neutral", "horizon": "days",
                    "affected_tickers": ["AAPL", "MSFT"]}
    assert ai_notes.parse_note("no json here") is None


# ── DB-backed pipeline + API ───────────────────────────────────────────

@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[NewsItem.__table__])
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _service(session_factory, sent):
    from app.services.news_intel.pipeline import NewsIntelService

    async def publisher(channel, msg):
        sent.append((channel, msg))

    return NewsIntelService(session_factory=session_factory, publisher=publisher, pollers=[])


def _raw(title, url, source="Reuters", minutes_ago=5, **kw):
    now = datetime.now(timezone.utc)
    return RawItem(feed=kw.pop("feed", "finnhub_general"), source=source, title=title, url=url,
                   published_at=now - timedelta(minutes=minutes_ago), received_at=now, **kw)


def test_process_batch_publishes_new_and_updated_clusters(session_factory):
    sent = []
    svc = _service(session_factory, sent)
    items = [
        _raw("Apple beats Q4 estimates, raises dividend", "https://r.com/1", summary="Strong iPhone sales"),
        _raw("Apple beats Q4 estimates, raises dividend - CNBC", "https://c.com/1", source="CNBC"),
        _raw("Apple beats Q4 estimates, raises dividend", "https://r.com/1?utm_source=x"),  # exact dup
        _raw("Old story", "https://r.com/old", minutes_ago=60 * 72),  # stale
    ]
    published = asyncio.run(svc.process_batch(items))
    assert svc.stats["new"] == 1 and svc.stats["joined"] == 1
    assert svc.stats["duplicates"] == 1 and svc.stats["stale"] == 1
    assert len(sent) == 2 and all(ch == "qt:ws:news" and m["type"] == "news" for ch, m in sent)
    first, update = sent[0][1]["item"], sent[1][1]["item"]
    assert first["cluster_id"] == update["cluster_id"]
    assert first["sources_count"] == 1 and update["sources_count"] == 2
    assert {s["source"] for s in update["sources"]} == {"Reuters", "CNBC"}
    assert update["tickers"] == ["AAPL"]
    assert first["primary_category"] == "earnings" and "capital_return" in first["categories"]
    assert set(first) == {"id", "cluster_id", "title", "summary", "url", "source", "sources_count", "sources",
                          "published_at", "ingested_at", "tickers", "categories", "primary_category",
                          "sentiment", "impact", "ai", "image_url"}
    assert set(first["sentiment"]) == {"label", "score", "confidence"}
    assert published[0]["id"] == first["id"]
    with session_factory() as db:
        row = db.query(NewsItem).one()
        assert row.classified_at is not None and row.sources_count == 2


def test_sec_hint_sets_category(session_factory):
    sent = []
    svc = _service(session_factory, sent)
    it = _raw("Acme Widgets files 8-K: Results of Operations", "https://sec.gov/x", source="SEC EDGAR",
              feed="sec_8k", category_hints=["earnings"])
    asyncio.run(svc.process_batch([it]))
    assert sent[0][1]["item"]["primary_category"] == "earnings"


def test_ai_pass_respects_daily_cap(session_factory, monkeypatch):
    sent = []
    svc = _service(session_factory, sent)
    svc.ai_cap = ai_notes.DailyCap(limit=2)
    titles = ["Nvidia beats estimates on data center demand", "Microsoft cloud revenue tops forecasts",
              "Apple raises dividend and buyback", "Alphabet antitrust ruling lands"]
    asyncio.run(svc.process_batch([_raw(t, f"https://n.com/{i}") for i, t in enumerate(titles)]))
    calls = []

    def llm(prompt):
        calls.append(prompt)
        return '{"why_it_matters": "AI demand.", "direction": "bullish", "horizon": "days", "affected_tickers": ["NVDA"]}'

    n = asyncio.run(svc.run_ai_pass(min_impact=0, batch=5, llm_call=llm))
    assert n == 2 and len(calls) == 2
    assert asyncio.run(svc.run_ai_pass(min_impact=0, batch=5, llm_call=llm)) == 0  # cap exhausted
    with session_factory() as db:
        with_ai = [r for r in db.query(NewsItem).all() if r.ai]
        assert len(with_ai) == 2 and with_ai[0].ai["direction"] == "bullish"
    ai_updates = [m for _, m in sent if m["item"]["ai"]]
    assert len(ai_updates) == 2


@pytest.fixture
def client(session_factory):
    from app.api import news_intel

    with session_factory() as db:
        now = datetime.now(timezone.utc)
        rows = [
            dict(cluster_id="c1", title="Apple beats estimates", tickers=["AAPL"], categories=["earnings"],
                 primary_category="earnings", sentiment_label="bullish", sentiment_score=0.8, impact=70,
                 published_at=now - timedelta(hours=1)),
            dict(cluster_id="c2", title="Fed holds rates", tickers=[], categories=["macro_fed"],
                 primary_category="macro_fed", sentiment_label="neutral", sentiment_score=0.0, impact=40,
                 published_at=now - timedelta(minutes=10)),
            dict(cluster_id="c3", title="Apple faces EU fine", tickers=["AAPL", "MSFT"],
                 categories=["regulatory_legal", "geopolitics"], primary_category="regulatory_legal",
                 sentiment_label="bearish", sentiment_score=-0.7, impact=55, published_at=now - timedelta(hours=3)),
            dict(cluster_id="c4", title="Old news", tickers=["AAPL"], categories=["earnings"],
                 primary_category="earnings", sentiment_label="bullish", sentiment_score=0.9, impact=99,
                 published_at=now - timedelta(days=3)),
        ]
        for r in rows:
            db.add(NewsItem(source="Reuters", source_feed="finnhub_general", sources=[{"source": "Reuters"}],
                            sources_count=1, ingested_at=now, classified_at=now, sentiment_confidence=0.9, **r))
        db.commit()

    app = FastAPI()
    app.include_router(news_intel.router, prefix="/api/v1")

    def _db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _db
    return TestClient(app)


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return [i["cluster_id"] for i in resp.json()["items"]]


def test_feed_latest_and_shape(client):
    body = client.get("/api/v1/news/feed").json()
    assert [i["cluster_id"] for i in body["items"]] == ["c2", "c1", "c3", "c4"]
    assert set(body["category_counts"]) == set(CATEGORY_KEYS)
    assert body["category_counts"]["earnings"] == 1  # c4 is outside the default 24h count window
    assert body["category_counts"]["geopolitics"] == 1 and body["as_of"].endswith("Z")


def test_feed_filters(client):
    assert _ids(client.get("/api/v1/news/feed?category=earnings")) == ["c1", "c4"]
    assert _ids(client.get("/api/v1/news/feed?ticker=msft")) == ["c3"]
    assert _ids(client.get("/api/v1/news/feed?ticker=$AAPL&sentiment=bearish")) == ["c3"]
    assert _ids(client.get("/api/v1/news/feed?category=geopolitics")) == ["c3"]
    since = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    assert _ids(client.get("/api/v1/news/feed", params={"since": since})) == ["c2", "c1"]
    assert _ids(client.get("/api/v1/news/feed?limit=1")) == ["c2"]


def test_feed_sorts(client):
    # ranking sorts default to the last 24h (c4 excluded)
    assert _ids(client.get("/api/v1/news/feed?sort=impact")) == ["c1", "c3", "c2"]
    assert _ids(client.get("/api/v1/news/feed?sort=bullish")) == ["c1", "c2", "c3"]
    assert _ids(client.get("/api/v1/news/feed?sort=bearish")) == ["c3", "c2", "c1"]
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    assert _ids(client.get("/api/v1/news/feed", params={"sort": "impact", "since": since}))[0] == "c4"


def test_feed_rejects_bad_params(client):
    assert client.get("/api/v1/news/feed?category=nope").status_code == 400
    assert client.get("/api/v1/news/feed?sentiment=happy").status_code == 400
    assert client.get("/api/v1/news/feed?sort=random").status_code == 400
    assert client.get("/api/v1/news/feed?ticker=AA;PL").status_code == 400
    assert client.get("/api/v1/news/feed?limit=0").status_code == 422


def test_categories_endpoint(client):
    cats = client.get("/api/v1/news/categories").json()
    assert [c["key"] for c in cats] == CATEGORY_KEYS
    assert all(set(c) == {"key", "label", "description"} for c in cats)


# ── WebSocket publish + parsing ────────────────────────────────────────

def test_ws_news_route_and_redis_bridge(monkeypatch):
    from app.api import ws

    paths = [r.path for r in ws.router.routes]
    assert "/ws/news" in paths

    app = FastAPI()
    app.include_router(ws.router, prefix="/api/v1")
    started = []

    async def fake_listener(channel, ws_channel):
        started.append((channel, ws_channel))
        await asyncio.sleep(3600)

    monkeypatch.setattr(ws, "_redis_listener", fake_listener)
    with TestClient(app) as tc:
        with tc.websocket_connect("/api/v1/ws/news") as a, tc.websocket_connect("/api/v1/ws/news") as b:
            a.send_text("ping")
            assert a.receive_text() == "pong"
            b.send_text("ping")
            assert b.receive_text() == "pong"
            assert ws.listener_count("qt:ws:news") == 1
    assert started == [("qt:ws:news", "news")]  # one shared listener, not one per socket


@pytest.mark.parametrize("path,channel", [("/api/v1/ws/pulse", "qt:ws:pulse"),
                                          ("/api/v1/ws/scanner", "qt:ws:scanner"),
                                          ("/api/v1/ws/ideas", "qt:ws:ideas")])
def test_ws_market_channels_share_one_listener(monkeypatch, path, channel):
    """Regression: each socket used to start its own listener -> N-fold duplicate delivery."""
    from app.api import ws
    from app.services.redis_cache_service import cache_service

    app = FastAPI()
    app.include_router(ws.router, prefix="/api/v1")
    started = []

    async def fake_listener(redis_channel, ws_channel):
        started.append(redis_channel)
        await asyncio.sleep(3600)

    async def no_cache(key):
        return None

    monkeypatch.setattr(ws, "_redis_listener", fake_listener)
    monkeypatch.setattr(cache_service, "get", no_cache)
    with TestClient(app) as tc:
        with tc.websocket_connect(path) as a, tc.websocket_connect(path) as b, tc.websocket_connect(path) as c:
            for sock in (a, b, c):
                sock.send_text("ping")
                assert sock.receive_text() == "pong"
            assert ws.listener_count(channel) == 1
    assert started == [channel]
    assert ws.listener_count(channel) == 0  # released when the last socket leaves


def test_default_publisher_uses_redis_channel(monkeypatch, session_factory):
    from app.services.news_intel.pipeline import NewsIntelService
    from app.services.redis_cache_service import cache_service

    published = []

    class R:
        async def publish(self, channel, data):
            published.append((channel, data))

    monkeypatch.setattr(cache_service, "_redis", R())
    svc = NewsIntelService(session_factory=session_factory, pollers=[])
    asyncio.run(svc.publish({"cluster_id": "x"}))
    assert published and published[0][0] == "qt:ws:news"
    assert '"type": "news"' in published[0][1]


def test_source_parsers():
    fin = parse_finnhub([{"headline": "Tesla <b>jumps</b>", "datetime": 1764000000, "related": "TSLA,",
                          "source": "Reuters", "url": "https://r.com", "summary": "x", "image": "i.png"}],
                        "finnhub_merger")
    assert fin[0].title == "Tesla jumps" and fin[0].symbols == ["TSLA"] and fin[0].category_hints == ["mna"]
    alp = parse_alpaca_message({"T": "n", "headline": "Nike upgraded", "symbols": ["NKE"], "source": "benzinga",
                                "created_at": "2026-11-25T14:00:00Z", "url": "https://b.com/n"})
    assert alp.source == "Benzinga" and alp.symbols == ["NKE"] and alp.published_at.tzinfo is not None
    assert parse_alpaca_message({"T": "subscription"}) is None
    atom = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>8-K - ACME WIDGETS INC (0000123456) (Filer)</title>
      <link href="https://www.sec.gov/Archives/x.htm"/>
      <summary type="html">Item 2.02: Results of Operations Item 9.01: Exhibits</summary>
      <updated>2026-11-25T10:00:00-05:00</updated></entry></feed>"""
    sec = parse_sec_8k(atom)
    assert sec[0].title == "Acme Widgets Inc files 8-K: Results of Operations"
    assert sec[0].category_hints == ["earnings"] and sec[0].published_at.hour == 15


def test_ticker_extraction():
    from app.services.news_intel.tickers import get_ticker_index

    idx = get_ticker_index()
    assert idx.extract("Apple and Microsoft rally; $NVDA slips") == ["NVDA", "AAPL", "MSFT"]
    assert idx.extract("Alphabet's cloud unit grows") == ["GOOGL"]           # biggest share class
    assert idx.extract("Analysts raise price target on retailer") == []      # 'target' is ambiguous
    assert idx.extract("Acme Corp (NASDAQ: ACME) prices offering") == ["ACME"]
    assert idx.extract("x", provider_symbols=["tsla", "BAD$$"]) == ["TSLA"]


def test_source_errors_redact_credentials(session_factory):
    svc = _service(session_factory, [])
    asyncio.run(svc._record_source(
        "finnhub_general", ok=False,
        error="HTTPStatusError for url 'https://finnhub.io/api/v1/news?category=general&token=SECRET123'"))
    err = svc.source_state["finnhub_general"]["last_error"]
    assert "SECRET123" not in err and "token=***" in err


def test_google_title_publisher_suffix_stripped():
    from app.services.news_intel.sources import parse_feed

    rss = b"""<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>Stocks slide as AI trade wobbles - ABC News - Breaking News, Latest News</title>
      <link>https://news.google.com/x</link>
      <source url="https://abcnews.go.com">ABC News - Breaking News, Latest News</source>
      <pubDate>Tue, 25 Nov 2026 15:00:00 GMT</pubDate></item></channel></rss>"""
    item = parse_feed(rss, "google_business", "Google News", use_entry_source=True, keep_summary=False)[0]
    assert item.title == "Stocks slide as AI trade wobbles"
    assert item.source == "ABC News - Breaking News, Latest News"


def test_legacy_sentiment_uses_news_items_then_keywords(session_factory):
    from app.services.news_intel.dedupe import title_hash, url_hash
    from app.services.news_intel.legacy import apply_legacy_sentiment

    now = datetime.now(timezone.utc)
    with session_factory() as db:
        db.add(NewsItem(cluster_id="L1", title="Acme soars", url="https://a.com/x",
                        url_hash=url_hash("https://a.com/x"), title_hash=title_hash("Acme soars"),
                        published_at=now, ingested_at=now, sentiment_label="bearish", sentiment_score=-0.6,
                        sentiment_confidence=0.9))
        db.add(NewsItem(cluster_id="L2", title="Globex quietly files paperwork", url="https://g.com/1",
                        url_hash=url_hash("https://g.com/1"), title_hash=title_hash("Globex quietly files paperwork"),
                        published_at=now, ingested_at=now, sentiment_label="bullish", sentiment_score=0.7,
                        sentiment_confidence=0.9))
        db.commit()
    arts = [
        {"title": "different title", "url": "https://www.a.com/x?utm_source=rss"},     # URL hit
        {"title": "Globex quietly files paperwork - Reuters", "url": "https://other.com/9"},  # title hit
        {"title": "Shares plunge after recall", "url": "https://n.com/new"},           # keyword fallback
    ]
    apply_legacy_sentiment(arts, session_factory=session_factory)
    assert [a["sentiment"] for a in arts] == ["Bearish", "Bullish", "Bearish"]
    assert arts[0]["sentiment_score"] == -0.6 and arts[2]["sentiment_score"] < 0


def test_worker_healthcheck(tmp_path, monkeypatch):
    import os
    import time as _time

    from app.services.news_intel import worker

    hb = tmp_path / "hb"
    monkeypatch.setattr(worker, "HEARTBEAT_FILE", str(hb))
    assert worker.healthcheck() == 1          # no heartbeat yet
    hb.touch()
    assert worker.healthcheck() == 0
    old = _time.time() - 600
    os.utime(hb, (old, old))
    assert worker.healthcheck() == 1          # stale


def test_status_loop_writes_heartbeat_and_redis(tmp_path, monkeypatch, session_factory):
    from app.services.news_intel import pipeline

    hb = tmp_path / "hb"
    monkeypatch.setattr(pipeline, "HEARTBEAT_FILE", str(hb))
    r = FakeRedis()
    svc = pipeline.NewsIntelService(session_factory=session_factory, redis=r, pollers=[])

    async def go():
        t = asyncio.create_task(svc.status_loop(interval=0.01))
        await asyncio.sleep(0.05)
        t.cancel()
    asyncio.run(go())
    assert hb.exists()
    import json as _json
    st = _json.loads(r.kv[pipeline.STATUS_KEY])
    assert st["models"]["sentiment"] == "keyword" and "stats" in st
