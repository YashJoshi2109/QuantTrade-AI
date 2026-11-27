"""
Regression: ticker feeds (/news/feed?ticker=AMD, the Research page News card)
were empty because headline tagging only matched cashtags, "(NASDAQ: X)" tags
and full legal names. Real headlines say "AMD", "Palantir", "Exxon", "Micron";
none of those matched "Advanced Micro Devices", "Palantir Technologies",
"Exxon Mobil Corp" or "Micron Technology", and none of our RSS/wire feeds carry
symbol metadata (the Alpaca stream that does is disabled in prod).

Headlines below are copied from prod news_items rows that were stored with
tickers=[] on 2026-11-26.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.models.news_item import NewsItem
from app.services.news_intel.tickers import TickerIndex

# Same names as the prod symbols table.
ROWS = [
    ("AMD", "Advanced Micro Devices", 2.5e11),
    ("NVDA", "NVIDIA Corp", 2.2e12),
    ("PLTR", "Palantir Technologies", 5.5e10),
    ("XOM", "Exxon Mobil Corp", 4.5e11),
    ("MU", "Micron Technology", 1.2e11),
    ("DELL", "Dell Technologies", 9.0e10),
    ("META", "Meta Platforms Inc", 1.5e12),
    ("RIVN", "Rivian Automotive", 1.5e10),
    ("JPM", "JPMorgan Chase & Co", 6.0e11),
    ("LLY", "Eli Lilly and Co", 7.0e11),
    ("MRK", "Merck & Co Inc", 3.0e11),
    ("GOOG", "Alphabet Inc Class C", 1.8e12),
    ("GOOGL", "Alphabet Inc", 1.8e12),
    ("BILL", "BILL Holdings", 5.0e9),
    ("NOW", "ServiceNow Inc", 1.8e11),
    ("ON", "ON Semiconductor", 3.0e10),
    ("MET", "MetLife Inc", 5.0e10),
    ("SPOT", "Spotify Technology", 9.0e10),
    ("AMAT", "Applied Materials", 1.5e11),
    ("ADI", "Analog Devices", 1.1e11),
    ("CAT", "Caterpillar Inc", 1.8e11),
    ("TGT", "Target Corp", 5.0e10),
]


@pytest.fixture
def idx():
    i = TickerIndex()
    i.load_rows(ROWS)
    return i


@pytest.mark.parametrize("title,expected", [
    ("AMD Stocks Slip 1.75% After Filing Registers 337 Million Shares for Resale", ["AMD"]),
    ("2 Billionaire Funds Dumped AMD Last Quarter. Is It a Sell?", ["AMD"]),
    ("Cathie Wood and Philippe Laffont Are on Opposite Sides of AMD Stock. Here's Who I Think Is Right.", ["AMD"]),
    ("Nvidia, AMD and Micron Stocks Plunge as AI Selloff Deepens", ["AMD", "NVDA", "MU"]),
    ("Are You Overpaying For Palantir Stock Versus Its Rivals?", ["PLTR"]),
    ("Apple, Exxon and Lowe's Are Rewarding Shareholders Beyond Their Regular Dividends", ["XOM"]),
    ("Dell lifts annual forecasts after record quarter on surging AI server demand", ["DELL"]),
    ("How Meta is using Instagram to get an ad boost", ["META"]),
    ("Rivian Is Down 41% This Year. Can RIVN Stock Get Back to $20 in 2027?", ["RIVN"]),
    ("JPMorgan Says the Biggest Risk to Stocks in 2027 Is the Fed", ["JPM"]),
    ("Eli Lilly Is Now Worth 7 Novo Nordisks", ["LLY"]),
    ("Merck & Co. wins approval", ["MRK"]),
    ("AMD's new chip ships early", ["AMD"]),
])
def test_headlines_name_companies_the_way_people_write_them(idx, title, expected):
    assert idx.extract(title) == expected


@pytest.mark.parametrize("title", [
    "Bill Gurley says few IPO buyers planned to hold",           # BILL: a first name
    "Stocks rally NOW that the Fed has paused",                  # NOW: a word
    "Shares rise ON strong demand",                              # ON: a word
    "NDA accepted for drug targeting MET amplification",         # MET: a gene
    "Gene Solutions' SPOT-MAS 10 receives IVD registration",     # hyphenated product code
    "Applied Digital and Analog Devices ideas for 2027",        # 'Applied' alone is not AMAT
    "CAT scan maker raises guidance",                            # CAT: stop-listed
    "Analysts raise price target on retailer",                   # 'target' ambiguous
    "AMD BEATS AND RAISES: EVERY CHIP STOCK IS UP TODAY",        # all-caps: bare tokens off
])
def test_no_false_positives(idx, title):
    got = idx.extract(title)
    assert "BILL" not in got and "NOW" not in got and "ON" not in got and "MET" not in got
    assert "SPOT" not in got and "AMAT" not in got and "CAT" not in got and "TGT" not in got
    if title.isupper() or title.startswith("AMD BEATS"):
        assert got == []


def test_share_class_tie_prefers_plain_listing(idx):
    assert idx.extract("Tepper Trims Alphabet by ~46%") == ["GOOGL"]


def test_cashtag_and_exchange_tags_still_win(idx):
    assert idx.extract("$PLTR and (NASDAQ: AMD) lead") == ["PLTR", "AMD"]


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[NewsItem.__table__])
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _add(db, cid, title, tickers, published):
    db.add(NewsItem(cluster_id=cid, title=title, url=f"https://x.com/{cid}", published_at=published,
                    ingested_at=published, sentiment_label="neutral", sentiment_score=0.0,
                    sentiment_confidence=0.5, primary_category="other", categories=["other"],
                    tickers=tickers, source="Yahoo Finance", sources=[{"source": "Yahoo Finance"}],
                    sources_count=1, impact=10))


def test_retag_recent_fills_ticker_feed(session_factory, idx):
    """Items stored by the old tagger become reachable via ?ticker=AMD."""
    from app.services.news_intel import store

    now = datetime.now(timezone.utc)
    with session_factory() as db:
        _add(db, "a1", "2 Billionaire Funds Dumped AMD Last Quarter. Is It a Sell?", [], now - timedelta(hours=5))
        _add(db, "a2", "Nvidia, AMD and Micron Stocks Plunge", ["NVDA"], now - timedelta(hours=2))
        _add(db, "a3", "Fed holds rates", [], now - timedelta(hours=1))
        _add(db, "old", "AMD news from last month", [], now - timedelta(days=30))
        db.commit()
        assert store.query_feed(db, ticker="AMD") == []           # the bug

        n = store.retag_recent(db, idx.extract, hours=14 * 24, batch=2)
        assert n == 2
        got = {r.cluster_id: list(r.tickers) for r in db.query(NewsItem).all()}
        assert got["a1"] == ["AMD"]
        assert got["a2"] == ["NVDA", "AMD", "MU"]                 # existing tags kept first
        assert got["a3"] == [] and got["old"] == []
        assert [r.cluster_id for r in store.query_feed(db, ticker="AMD")] == ["a2", "a1"]
        assert store.retag_recent(db, idx.extract) == 0           # idempotent


def test_feed_reports_coverage_since(session_factory):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api import news_intel
    from app.db.database import get_db

    now = datetime.now(timezone.utc)
    with session_factory() as db:
        _add(db, "c1", "Fed holds rates", [], now - timedelta(days=3))
        _add(db, "c2", "Oil rises", [], now - timedelta(hours=1))
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
    body = TestClient(app).get("/api/v1/news/feed?ticker=AMD").json()
    assert set(body) >= {"items", "category_counts", "as_of", "coverage_since"}
    assert body["items"] == []
    since = datetime.fromisoformat(body["coverage_since"].replace("Z", "+00:00"))
    assert abs((now - since) - timedelta(days=3)) < timedelta(minutes=1)


def test_worker_warm_retags_once_per_version(session_factory, idx, monkeypatch):
    """The news-worker applies a tagger fix to already-stored rows on startup."""
    import asyncio

    from app.services.news_intel import tickers
    from app.services.news_intel.pipeline import NewsIntelService

    monkeypatch.setattr(tickers, "_index", idx)
    now = datetime.now(timezone.utc)
    with session_factory() as db:
        _add(db, "a1", "AMD Stocks Slip 1.75% After Filing", [], now - timedelta(hours=3))
        db.commit()

    class FakeRedis:
        def __init__(self):
            self.kv = {}

        async def get(self, k):
            return self.kv.get(k)

        async def set(self, k, v, **_):
            self.kv[k] = v

    async def publisher(channel, msg):
        pass

    svc = NewsIntelService(session_factory=session_factory, publisher=publisher, pollers=[])
    svc.redis = FakeRedis()
    assert asyncio.run(svc._retag_if_tagger_changed()) == 1
    assert svc.redis.kv["qt:news:tagger_version"] == tickers.TAGGER_VERSION
    assert asyncio.run(svc._retag_if_tagger_changed()) == 0      # version already applied
    with session_factory() as db:
        assert db.query(NewsItem).one().tickers == ["AMD"]
