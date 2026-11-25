"""Regression tests for the 2026-11 security audit fixes.

C1/H1  email-case admin takeover + unverified registration / Google linking
M4     Turnstile required when configured
H2     Stripe Connect endpoints bound to the authenticated user
M3     Redis cache never stores cookie-authenticated responses
M2     bulk/admin sync endpoints require admin; background job owns its session
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.auth as auth_mod
import app.api.connect as connect_mod
from app.api.auth import create_access_token, require_admin
from app.config import settings
from app.db.database import Base, get_db
from app.models.billing import ConnectedAccount
from app.models.user import User

ADMIN = "admin@example.com"
GOOD_OTP = "123456"


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine, tables=[User.__table__, ConnectedAccount.__table__])
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", ADMIN)
    monkeypatch.setattr(settings, "BREVO_API_KEY", None)
    monkeypatch.setattr(settings, "RESEND_API_KEY", None)
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", None)
    monkeypatch.setattr(auth_mod, "verify_otp", lambda email, otp: otp == GOOD_OTP)
    monkeypatch.setattr(auth_mod, "WELCOME_PROMO_AVAILABLE", False)
    monkeypatch.setattr(auth_mod, "LOGIN_NOTIFY_AVAILABLE", False)
    return monkeypatch


@pytest.fixture
def client(session_factory, env):
    app = FastAPI()
    app.include_router(auth_mod.router, prefix="/api/v1/auth")
    app.include_router(connect_mod.router, prefix="/api/v1/connect")

    @app.get("/admin-check")
    def admin_check(user: User = Depends(require_admin)):
        return {"ok": True}

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c


def _register(client, email, username, otp=GOOD_OTP, **extra):
    body = {"email": email, "username": username, "password": "S3cure-pass!"}
    if otp is not None:
        body["otp"] = otp
    body.update(extra)
    return client.post("/api/v1/auth/register", json=body)


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _add_user(session_factory, **kw):
    db = session_factory()
    kw.setdefault("username", kw["email"].split("@")[0])
    u = User(**kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    db.close()
    return u


# ── C1 / H1 ─────────────────────────────────────────────────────────────────

def test_register_normalizes_email_and_rejects_case_variant_duplicate(client, session_factory):
    r = _register(client, "  Admin@Example.COM ", "first")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == ADMIN

    r2 = _register(client, "ADMIN@example.com", "second")
    assert r2.status_code == 400
    assert "already registered" in r2.json()["detail"]

    db = session_factory()
    assert db.query(User).count() == 1
    db.close()


def test_mixed_case_stored_email_cannot_pass_require_admin(client, session_factory):
    # Legacy row created before normalization existed.
    u = _add_user(session_factory, email="Admin@Example.com", is_verified=True)
    r = client.get("/admin-check", headers=_bearer(create_access_token(u.id)))
    assert r.status_code == 403


def test_unverified_user_fails_require_admin(client, session_factory):
    u = _add_user(session_factory, email=ADMIN, is_verified=False)
    r = client.get("/admin-check", headers=_bearer(create_access_token(u.id)))
    assert r.status_code == 403


def test_verified_lowercase_admin_passes(client):
    r = _register(client, ADMIN, "realadmin")
    assert r.status_code == 200
    assert r.json()["user"]["is_verified"] is True
    r2 = client.get("/admin-check", headers=_bearer(r.json()["access_token"]))
    assert r2.status_code == 200


def test_register_without_otp_in_dev_is_unverified_and_not_admin(client):
    r = _register(client, ADMIN, "squatter", otp=None)
    assert r.status_code == 200
    assert r.json()["user"]["is_verified"] is False
    r2 = client.get("/admin-check", headers=_bearer(r.json()["access_token"]))
    assert r2.status_code == 403


def test_register_requires_otp_when_email_provider_configured(client, env):
    env.setattr(settings, "BREVO_API_KEY", "configured")
    r = _register(client, "user@example.com", "nootp", otp=None)
    assert r.status_code == 400
    assert "verification code is required" in r.json()["detail"]


def test_register_rejects_bad_otp(client):
    r = _register(client, "user@example.com", "badotp", otp="000000")
    assert r.status_code == 400


def test_login_is_case_insensitive(client):
    assert _register(client, "trader@example.com", "trader").status_code == 200
    r = client.post("/api/v1/auth/login", json={"email": "Trader@Example.com", "password": "S3cure-pass!"})
    assert r.status_code == 200, r.text


def _fake_google(env, idinfo):
    env.setattr(auth_mod, "GOOGLE_AUTH_AVAILABLE", True)
    env.setattr(settings, "GOOGLE_CLIENT_ID", "client-id")
    env.setattr(
        auth_mod,
        "id_token",
        SimpleNamespace(verify_oauth2_token=lambda cred, req, aud: idinfo),
        raising=False,
    )
    env.setattr(auth_mod, "requests", SimpleNamespace(Request=lambda: None), raising=False)


def test_google_does_not_link_when_email_unverified(client, session_factory, env):
    _add_user(session_factory, email="victim@example.com", is_verified=True, hashed_password="x")
    _fake_google(env, {"sub": "g-1", "email": "Victim@Example.com", "email_verified": False})
    r = client.post("/api/v1/auth/google/verify", json={"credential": "tok"})
    assert r.status_code == 409
    db = session_factory()
    assert db.query(User).filter(User.email == "victim@example.com").one().google_id is None
    db.close()


def test_google_links_verified_email_and_drops_squatter_password(client, session_factory, env):
    _add_user(session_factory, email="owner@example.com", is_verified=False, hashed_password="squatter-hash")
    _fake_google(env, {"sub": "g-2", "email": "Owner@Example.com", "email_verified": True})
    r = client.post("/api/v1/auth/google/verify", json={"credential": "tok"})
    assert r.status_code == 200, r.text
    db = session_factory()
    u = db.query(User).filter(User.email == "owner@example.com").one()
    assert u.google_id == "g-2"
    assert u.is_verified is True
    assert u.hashed_password is None
    db.close()


# ── M4 ──────────────────────────────────────────────────────────────────────

def test_turnstile_token_required_when_secret_configured(client, env):
    env.setattr(settings, "TURNSTILE_SECRET_KEY", "secret")
    r = client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "x"})
    assert r.status_code == 400
    assert "CAPTCHA" in r.json()["detail"]
    r2 = _register(client, "b@example.com", "b")
    assert r2.status_code == 400
    assert "CAPTCHA" in r2.json()["detail"]


# ── H2 ──────────────────────────────────────────────────────────────────────

class _FakeStripe:
    def __init__(self):
        self.portal_calls = []
        self.checkout_calls = []
        self.billing_portal = SimpleNamespace(sessions=SimpleNamespace(create=self._portal))
        self.checkout = SimpleNamespace(sessions=SimpleNamespace(create=self._checkout))
        self.products = SimpleNamespace(retrieve=self._retrieve)

    def _portal(self, params):
        self.portal_calls.append(params)
        return {"url": "https://portal"}

    def _checkout(self, params, options=None):
        self.checkout_calls.append((params, options))
        return {"url": "https://checkout"}

    def _retrieve(self, pid, params=None, options=None):
        return {"id": pid, "active": True, "default_price": {"id": "price_server", "unit_amount": 5000}}


@pytest.fixture
def fake_stripe(env):
    fake = _FakeStripe()
    env.setattr(connect_mod, "_stripe_client", lambda: fake)
    return fake


def _user_with_account(session_factory, email, acct):
    u = _add_user(session_factory, email=email, is_verified=True)
    db = session_factory()
    db.add(ConnectedAccount(user_id=u.id, stripe_account_id=acct))
    db.commit()
    db.close()
    return u


def test_portal_requires_auth(client, fake_stripe):
    r = client.post("/api/v1/connect/subscription/portal?connected_account_id=acct_victim")
    assert r.status_code == 401
    assert fake_stripe.portal_calls == []


def test_portal_uses_callers_own_account_and_rejects_others(client, session_factory, fake_stripe):
    _user_with_account(session_factory, "victim@example.com", "acct_victim")
    me = _user_with_account(session_factory, "me@example.com", "acct_mine")
    h = _bearer(create_access_token(me.id))

    r = client.post("/api/v1/connect/subscription/portal?connected_account_id=acct_victim", headers=h)
    assert r.status_code == 403

    r2 = client.post("/api/v1/connect/subscription/portal", headers=h)
    assert r2.status_code == 200
    assert fake_stripe.portal_calls[-1]["customer_account"] == "acct_mine"


def test_subscription_checkout_requires_auth(client, fake_stripe):
    r = client.post("/api/v1/connect/subscription/checkout", json={"connected_account_id": "acct_x"})
    assert r.status_code == 401


def test_storefront_checkout_uses_server_side_price(client, session_factory, fake_stripe):
    _user_with_account(session_factory, "seller@example.com", "acct_seller")
    buyer = _add_user(session_factory, email="buyer@example.com", is_verified=True)
    r = client.post(
        "/api/v1/connect/storefront/checkout",
        headers=_bearer(create_access_token(buyer.id)),
        json={"account_id": "acct_seller", "product_id": "prod_1", "product_name": "x", "amount_cents": 1},
    )
    assert r.status_code == 200, r.text
    params, options = fake_stripe.checkout_calls[-1]
    assert params["line_items"] == [{"price": "price_server", "quantity": 1}]
    assert options == {"stripe_account": "acct_seller"}


def test_storefront_rejects_unknown_account(client, fake_stripe):
    assert client.get("/api/v1/connect/storefront/acct_unknown/products").status_code == 404


# ── M3 ──────────────────────────────────────────────────────────────────────

class _FakeRedis:
    def __init__(self):
        self.store = {}

    async def get(self, k):
        return self.store.get(k)

    async def setex(self, k, ttl, v):
        self.store[k] = v


def _cache_app():
    from app.middleware.redis_cache import RedisCacheMiddleware

    fake = _FakeRedis()
    app = FastAPI()
    calls = {"n": 0}

    @app.get("/api/v1/quotes")
    def quotes():
        calls["n"] += 1
        return {"n": calls["n"]}

    app.add_middleware(RedisCacheMiddleware, redis_client=fake)
    return app, fake


def test_cookie_authenticated_request_is_not_cached():
    app, fake = _cache_app()
    with TestClient(app) as c:
        c.cookies.set("qt_access_token", "user-a-token")
        r = c.get("/api/v1/quotes")
        assert r.status_code == 200
        assert "X-Cache" not in r.headers
    assert fake.store == {}


def test_anonymous_request_is_cached():
    app, fake = _cache_app()
    with TestClient(app) as c:
        assert c.get("/api/v1/quotes").headers.get("X-Cache") == "MISS"
        assert c.get("/api/v1/quotes").headers.get("X-Cache") == "HIT"
    assert len(fake.store) == 1


def test_auth_required_paths_not_in_cache_paths():
    from app.middleware.redis_cache import CACHE_PATHS

    assert not any(p.startswith("/api/v1/ideas/generate") for p in CACHE_PATHS)


# ── M2 ──────────────────────────────────────────────────────────────────────

def test_bulk_sync_and_news_sync_require_admin(session_factory, env):
    from app.api import enhanced_endpoints, news

    app = FastAPI()
    app.include_router(enhanced_endpoints.router, prefix="/api/v1/enhanced")
    app.include_router(news.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: iter([session_factory()])
    with TestClient(app) as c:
        for method, path in [
            ("post", "/api/v1/enhanced/sync/sp500"),
            ("post", "/api/v1/enhanced/sync/nasdaq"),
            ("post", "/api/v1/enhanced/fundamentals/AAPL/sync"),
            ("post", "/api/v1/news/AAPL/sync"),
            ("get", "/api/v1/news/AAPL/sync"),
        ]:
            assert getattr(c, method)(path).status_code == 401, path


def test_sync_rate_limit_blocks_after_budget():
    from fastapi import HTTPException

    from app.services import sync_rate_limit as srl

    srl.reset_sync_rate_limit()
    req = SimpleNamespace(headers={}, client=SimpleNamespace(host="1.2.3.4"))
    for _ in range(srl.SYNC_REQUESTS_PER_MINUTE):
        srl.sync_rate_limit(req)
    with pytest.raises(HTTPException) as exc:
        srl.sync_rate_limit(req)
    assert exc.value.status_code == 429
    srl.reset_sync_rate_limit()


def test_research_background_sync_uses_own_session(monkeypatch):
    from app.api import research
    from app.db import database

    closed = {"v": False}

    class _S:
        def close(self):
            closed["v"] = True

        def rollback(self):
            pass

    sess = _S()
    seen = {}
    monkeypatch.setattr(database, "SessionLocal", lambda: sess)
    monkeypatch.setattr(research, "sync_edgar_data", lambda t, db, f: seen.update(t=t, db=db))
    research._sync_edgar_in_own_session("AAPL")
    assert seen["db"] is sess
    assert closed["v"] is True
