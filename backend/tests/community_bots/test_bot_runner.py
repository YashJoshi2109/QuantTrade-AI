"""Runner (caps, dedupe, kill switches, publishing), accounts, API and scheduler wiring."""
import asyncio
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).parent))

from fixtures import NOW, FakeHub  # noqa: E402
from app.services.community_bots import registry, runner  # noqa: E402


@pytest.fixture
def SL(monkeypatch):
    from app.db.database import Base
    from app.models.community import Bookmark, Comment, Community, CommunityMember, Post, UserFollow, Vote
    from app.models.community_bot import CommunityBot, CommunityBotPost, CommunityBotRun
    from app.models.user import User

    monkeypatch.delenv("COMMUNITY_BOTS_ENABLED", raising=False)
    monkeypatch.delenv("COMMUNITY_BOTS_DISABLED", raising=False)
    monkeypatch.delenv("COMMUNITY_BOTS_GLOBAL_DAILY_CAP", raising=False)
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Community.__table__, CommunityMember.__table__, Post.__table__, Comment.__table__,
        Vote.__table__, UserFollow.__table__, Bookmark.__table__,
        CommunityBot.__table__, CommunityBotPost.__table__, CommunityBotRun.__table__,
    ])
    factory = sessionmaker(bind=eng)
    s = factory()
    s.add(User(id=1, email="human@example.com", username="human", is_verified=True))
    s.add(User(id=2, email="admin@example.com", username="admin", is_verified=True))
    s.commit()
    from app.services.community_bots.accounts import ensure_bot_accounts
    ensure_bot_accounts(s)
    s.close()
    return factory


def run(SL, slug, slot, now=NOW, hub=None, **kw):
    return asyncio.run(runner.run_bot(slug, slot, hub=hub or FakeHub(now=now), now=now, session_factory=SL, **kw))


def test_seed_is_idempotent_and_accounts_not_loginable(SL):
    from app.models.community import Community
    from app.models.community_bot import CommunityBot
    from app.models.user import User
    from app.services.community_bots.accounts import ensure_bot_accounts, is_bot_email

    s = SL()
    again = ensure_bot_accounts(s)
    assert again == {"users": 0, "bots": 0, "communities": 0, "memberships": 0}
    bots = s.query(CommunityBot).all()
    assert len(bots) == len(registry.all_specs())
    for b in bots:
        u = s.query(User).get(b.user_id)
        assert u.hashed_password is None and u.google_id is None and is_bot_email(u.email)
        assert u.username.endswith("_bot")
    assert s.query(Community).filter(Community.slug == "real-estate").first() is not None
    s.close()


def test_bot_tokens_never_authenticate(SL):
    from app.api.auth import create_access_token, get_current_user, require_auth
    from app.models.community_bot import CommunityBot
    from fastapi import HTTPException

    s = SL()
    bot_uid = s.query(CommunityBot).first().user_id
    with pytest.raises(HTTPException):
        from types import SimpleNamespace
        require_auth(SimpleNamespace(state=SimpleNamespace(token_sv=0)), user_id=bot_uid, db=s)

    class Req:
        cookies = {}

    class Cred:
        credentials = create_access_token(bot_uid)

    assert get_current_user(Req(), Cred(), s) is None
    Cred.credentials = create_access_token(1)
    assert get_current_user(Req(), Cred(), s).id == 1
    s.close()


def test_publish_then_dedupe_same_slot(SL):
    from app.models.community import Post
    from app.models.community_bot import CommunityBotPost, CommunityBotRun

    r = run(SL, "market_weather", "close")
    assert r.status == "posted", r.reason
    s = SL()
    post = s.query(Post).get(r.post_id)
    assert post.post_type == "bot" and post.source_platform == "qt_bot"
    assert "Automated post by Market Weather Bot" in post.body
    assert post.community.slug == "stock-market"
    bp = s.query(CommunityBotPost).get(r.post_id)
    assert bp.dedupe_key == "market_weather:2026-11-24:close" and bp.payload["badge"]["value"] == "sunny"
    s.close()

    again = run(SL, "market_weather", "close", now=NOW + timedelta(minutes=5))
    assert again.status == "duplicate"
    s = SL()
    statuses = [x.status for x in s.query(CommunityBotRun).order_by(CommunityBotRun.id).all()]
    assert statuses == ["posted", "duplicate"]
    s.close()


def test_identical_data_is_not_reposted_in_another_slot(SL):
    first = run(SL, "sector_rotation", "close")
    assert first.status == "posted"
    from app.models.community_bot import CommunityBotPost
    s = SL()
    s.query(CommunityBotPost).filter(CommunityBotPost.post_id == first.post_id).update(
        {"dedupe_key": "sector_rotation:2026-11-23:close", "created_at": NOW - timedelta(days=1)})
    s.commit()
    s.close()
    again = run(SL, "sector_rotation", "close")
    assert again.status == "duplicate" and "same data" in again.reason


def test_daily_cap_enforced(SL, monkeypatch):
    spec = registry.get("earnings_watch")
    monkeypatch.setitem(registry.BOTS, "earnings_watch", __import__("dataclasses").replace(
        spec, daily_cap=1, min_interval_minutes=0))
    from fixtures import EVENING_NOW, MORNING_NOW
    a = run(SL, "earnings_watch", "morning", now=MORNING_NOW)
    assert a.status == "posted", a.reason
    b = run(SL, "earnings_watch", "evening", now=EVENING_NOW)
    assert b.status == "capped" and "daily cap" in b.reason


def test_global_cap_enforced(SL, monkeypatch):
    monkeypatch.setenv("COMMUNITY_BOTS_GLOBAL_DAILY_CAP", "1")
    assert run(SL, "market_weather", "close").status == "posted"
    r = run(SL, "sector_rotation", "close")
    assert r.status == "capped" and "global" in r.reason


def test_min_interval_enforced(SL):
    from fixtures import MIDDAY_NOW
    a = run(SL, "sentiment_pulse", "midday", now=MIDDAY_NOW)
    assert a.status == "posted", a.reason
    b = run(SL, "sentiment_pulse", "evening", now=MIDDAY_NOW + timedelta(minutes=20))
    assert b.status == "capped" and "interval" in b.reason


@pytest.mark.parametrize("env,val", [("COMMUNITY_BOTS_ENABLED", "0"), ("COMMUNITY_BOTS_DISABLED", "market_weather"),
                                     ("COMMUNITY_BOTS_DISABLED", "all")])
def test_env_kill_switches(SL, monkeypatch, env, val):
    monkeypatch.setenv(env, val)
    r = run(SL, "market_weather", "close")
    assert r.status == "disabled"


def test_admin_flag_disables(SL):
    from app.models.community_bot import CommunityBot
    s = SL()
    s.query(CommunityBot).filter(CommunityBot.slug == "market_weather").update({"enabled": False})
    s.commit()
    s.close()
    assert run(SL, "market_weather", "close").status == "disabled"


def test_skips_non_trading_day(SL):
    from datetime import datetime, timezone
    thanksgiving = datetime(2026, 11, 26, 21, 25, tzinfo=timezone.utc)
    r = run(SL, "market_weather", "close", now=thanksgiving)
    assert r.status == "skipped" and "trading day" in r.reason


def test_stale_data_is_skipped_and_logged(SL):
    from app.models.community_bot import CommunityBotRun
    from fixtures import breadth
    b = breadth(NOW)
    b["newest_quote_at"] = NOW - timedelta(hours=9)
    r = run(SL, "market_weather", "close", hub=FakeHub(now=NOW, breadth=b))
    assert r.status == "skipped" and "stale" in r.reason
    s = SL()
    assert s.query(CommunityBotRun).filter(CommunityBotRun.status == "skipped").count() == 1
    s.close()


def test_compliance_violation_blocks_publish(SL, monkeypatch):
    spec = registry.get("market_weather")
    orig = spec.compose

    def bad_compose(data, now, slot):
        p = orig(data, now, slot)
        p.highlights.append("You should buy SPY now.")
        return p

    monkeypatch.setitem(registry.BOTS, "market_weather", __import__("dataclasses").replace(spec, compose=bad_compose))
    r = run(SL, "market_weather", "close")
    assert r.status == "rejected" and r.violations


def test_dry_run_does_not_write(SL):
    from app.models.community import Post
    from app.models.community_bot import CommunityBotRun
    r = run(SL, "market_weather", "close", dry_run=True)
    assert r.status == "preview" and "Automated post by" in r.preview["body"]
    s = SL()
    assert s.query(Post).count() == 0 and s.query(CommunityBotRun).count() == 0
    s.close()


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(SL, monkeypatch):
    from app.api import community_bots as bots_api
    from app.api import posts as posts_api
    from app.api import users as users_api
    from app.api.auth import create_access_token
    from app.config import settings
    from app.db.database import get_db
    from app.models.community import Community, Post

    monkeypatch.setattr(settings, "ADMIN_EMAILS", "admin@example.com", raising=False)

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(posts_api.cache_service, "get_or_fetch", lambda key, ttl, fn: fn())
    app = FastAPI()
    app.include_router(bots_api.router, prefix="/api/v1")
    app.include_router(posts_api.router, prefix="/api/v1")
    app.include_router(users_api.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    assert run(SL, "market_weather", "close").status == "posted"
    s = SL()
    c = s.query(Community).filter(Community.slug == "stock-market").first()
    s.add(Post(author_id=1, community_id=c.id, title="Human post", body="hi", post_type="text", tickers=[],
               media_urls=[], hot_score=0.0))
    s.commit()
    s.close()
    tc = TestClient(app)
    tc.admin = {"Authorization": f"Bearer {create_access_token(2)}"}
    tc.human = {"Authorization": f"Bearer {create_access_token(1)}"}
    return tc


def test_api_lists_bots_with_methodology(client):
    r = client.get("/api/v1/community-bots")
    assert r.status_code == 200
    bots = {b["slug"]: b for b in r.json()["bots"]}
    assert set(bots) >= {"market_weather", "real_estate_rates"}
    mw = bots["market_weather"]
    assert mw["enabled"] and mw["methodology"] and mw["schedule"][0]["label"].startswith("9:00 AM ET")
    assert mw["posts_today"] >= 0


def test_api_bot_detail_has_recent_posts(client):
    r = client.get("/api/v1/community-bots/market_weather")
    assert r.status_code == 200
    posts = r.json()["recent_posts"]
    assert posts and posts[0]["is_bot"] and posts[0]["author"]["is_bot"]
    assert posts[0]["bot"]["automated_label"] == "Automated post by Market Weather Bot"


def test_feed_bot_filter(client):
    items = client.get("/api/v1/communities/stock-market/posts?sort=new").json()["items"]
    assert {i["is_bot"] for i in items} == {True, False}
    bot_item = next(i for i in items if i["is_bot"])
    assert bot_item["bot"]["tables"] and bot_item["bot"]["sources"]
    no_bots = client.get("/api/v1/communities/stock-market/posts?sort=new&include_bots=false").json()["items"]
    assert [i["title"] for i in no_bots] == ["Human post"]
    pop = client.get("/api/v1/feed/popular?sort=new&include_bots=false").json()["items"]
    assert all(not i["is_bot"] for i in pop) and pop


def test_profile_marks_bot(client):
    r = client.get("/api/v1/users/by-username/market_weather_bot")
    assert r.status_code == 200
    j = r.json()
    assert j["is_bot"] and j["bot_slug"] == "market_weather" and "bot" in j["badges"]
    assert client.get("/api/v1/users/by-username/human").json()["is_bot"] is False


def test_admin_toggle_requires_admin(client):
    assert client.patch("/api/v1/community-bots/market_weather", json={"enabled": False}).status_code == 401
    assert client.patch("/api/v1/community-bots/market_weather", json={"enabled": False},
                        headers=client.human).status_code == 403
    r = client.patch("/api/v1/community-bots/market_weather", json={"enabled": False, "reason": "test"},
                     headers=client.admin)
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert "admin" in r.json()["disabled_reason"]
    runs = client.get("/api/v1/community-bots/market_weather/runs", headers=client.admin).json()["runs"]
    assert runs[0]["status"] == "disabled"


# ── scheduler wiring ─────────────────────────────────────────────────────────

def test_register_bot_jobs_one_cron_per_slot_in_eastern_time():
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.services.community_bots.scheduler import job_id, register_bot_jobs

    sched = BackgroundScheduler(timezone="UTC")
    ids = register_bot_jobs(sched)
    expected = [job_id(s.slug, sl.name) for s in registry.all_specs() for sl in s.slots]
    assert ids == expected
    for spec in registry.all_specs():
        for sl in spec.slots:
            job = sched.get_job(job_id(spec.slug, sl.name))
            trig = job.trigger
            assert str(trig.timezone) == "America/New_York"
            fields = {f.name: str(f) for f in trig.fields}
            assert fields["hour"] == str(sl.hour) and fields["minute"] == str(sl.minute)
            assert fields["day_of_week"] == sl.day_of_week
            assert list(job.args) == [spec.slug, sl.name] and job.max_instances == 1


def test_main_scheduler_registers_bot_jobs():
    src = (Path(__file__).resolve().parents[2] / "app" / "main.py").read_text()
    start = src.index("def _start_scheduler")
    end = src.index("sched.start()", start)
    assert "register_bot_jobs(sched)" in src[start:end]


def test_run_scheduled_never_raises(monkeypatch):
    from app.services.community_bots import scheduler

    async def boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(runner, "run_bot", boom)
    assert scheduler.run_scheduled("market_weather", "close") is None
