"""Admin console: authz on every route, redaction, read-only explorer, audit log,
suspension / session revocation, admin entitlements, GA4 / GSC (mocked)."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.auth as auth_mod
from app.api import admin as admin_api
from app.api import ai_quota
from app.api.auth import create_access_token, hash_password
from app.config import settings
from app.db import database
from app.db.database import Base, get_db
from app.models.admin import (
    AdminAuditLog,
    AppendOnlyError,
    UserAccountControl,
    UserLoginEvent,
)
from app.models.ai_usage import AIUsageEvent
from app.models.billing import Subscription
from app.models.chat_history import ChatHistory, Conversation
from app.models.passkey_credential import PasskeyCredential
from app.models.user import User
from app.services import account_controls, admin_traffic, ai_guard

ADMIN_EMAIL = "owner-admin@example.test"
PASSWORD = "S3cure-pass!"


@pytest.fixture
def SL(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    import app.main  # noqa: F401  register every model on Base.metadata
    Base.metadata.create_all(bind=eng)
    factory = sessionmaker(bind=eng, autocommit=False, autoflush=False)
    monkeypatch.setattr(database, "SessionLocal", factory)
    account_controls.invalidate_fast_cache()
    s = factory()
    s.add_all([
        User(id=1, email=ADMIN_EMAIL, username="boss", is_verified=True, hashed_password=hash_password(PASSWORD)),
        User(id=2, email="user@example.test", username="alice", is_verified=True, hashed_password=hash_password(PASSWORD),
             phone_number="5551234"),
        User(id=3, email="unverified-admin@example.test", username="mallory", is_verified=False),
    ])
    s.add(PasskeyCredential(user_id=2, credential_id="cred-abc", public_key=b"\x01\x02", sign_count=7, device_name="Mac"))
    s.add(Conversation(id="c1", user_id=2, title="NVDA thesis"))
    s.add(ChatHistory(user_id=2, conversation_id="c1", role="user", content="SECRET PROMPT TEXT"))
    s.add(AIUsageEvent(user_id=2, feature="copilot", provider="bedrock", model="claude-sonnet-5", input_tokens=1000,
                       output_tokens=200, cost_usd=0.004, status="ok", ts=datetime.now(timezone.utc)))
    s.add(Subscription(user_id=2, stripe_subscription_id="sub_123", status="active", price_id="price_m",
                       current_period_end=datetime.utcnow() + timedelta(days=20)))
    s.commit()
    s.close()
    return factory


@pytest.fixture
def client(SL, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", f"{ADMIN_EMAIL},unverified-admin@example.test")
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", None)
    monkeypatch.setattr(auth_mod, "LOGIN_NOTIFY_AVAILABLE", False)
    monkeypatch.setattr(auth_mod, "WELCOME_PROMO_AVAILABLE", False)
    ai_guard.set_store(ai_guard.MemoryStore())
    admin_traffic.set_transport(None)
    app = FastAPI()
    app.include_router(auth_mod.router, prefix="/api/v1/auth")
    app.include_router(admin_api.router, prefix="/api/v1/admin")
    app.include_router(ai_quota.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    c.admin = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.user = {"Authorization": f"Bearer {create_access_token(2)}"}
    c.unverified = {"Authorization": f"Bearer {create_access_token(3)}"}
    yield c
    ai_guard.set_store(None)


REASON = {"reason": "support ticket #42"}

# Every admin route with a request that should succeed for an admin.
ROUTE_CASES = [
    ("GET", "/me", None), ("GET", "/search?q=al", None), ("GET", "/notifications", None),
    ("GET", "/overview?range=7d", None), ("GET", "/users", None), ("GET", "/users/kpis", None),
    ("GET", "/users/2", None), ("POST", "/users/reveal-emails", {"user_ids": [2]}),
    ("POST", "/users/2/revoke-sessions", REASON), ("POST", "/users/2/suspend", REASON),
    ("POST", "/users/2/unsuspend", REASON), ("POST", "/users/2/ai-quota", {**REASON, "reset_today": True}),
    ("POST", "/users/2/plan", {**REASON, "plan": "pro"}),
    ("POST", "/users/2/conversations/c1/view", REASON),
    ("GET", "/ai", None), ("GET", "/revenue", None), ("GET", "/product", None), ("GET", "/health", None),
    ("GET", "/activity", None), ("GET", "/data/tables", None), ("GET", "/data/tables/users", None),
    ("GET", "/data/freshness", None), ("GET", "/audit", None), ("GET", "/security", None),
    ("POST", "/export-log", {"page": "overview", "format": "csv"}),
    ("GET", "/traffic/status", None), ("GET", "/traffic/ga4", None), ("GET", "/traffic/realtime", None),
    ("GET", "/traffic/gsc", None),
]


def _call(c, method, path, body, headers=None):
    return c.request(method, "/api/v1/admin" + path, json=body, headers=headers or {})


def test_route_cases_cover_every_admin_route():
    declared = {(m, r.path) for r in admin_api.router.routes for m in r.methods}
    covered = set()
    for m, p, _ in ROUTE_CASES:
        p = p.split("?")[0]
        for dm, dp in declared:
            parts, cparts = dp.split("/"), p.split("/")
            if dm == m and len(parts) == len(cparts) and all(a == b or a.startswith("{") for a, b in zip(parts, cparts)):
                covered.add((dm, dp))
    assert declared - covered == set()


@pytest.mark.parametrize("method,path,body", ROUTE_CASES)
def test_anonymous_gets_401(client, method, path, body):
    assert _call(client, method, path, body).status_code == 401


@pytest.mark.parametrize("method,path,body", ROUTE_CASES)
def test_non_admin_gets_404(client, method, path, body):
    assert _call(client, method, path, body, client.user).status_code == 404
    # In ADMIN_EMAILS but never verified: still not an admin.
    assert _call(client, method, path, body, client.unverified).status_code == 404


@pytest.mark.parametrize("method,path,body", ROUTE_CASES)
def test_admin_gets_200(client, method, path, body):
    if path == "/users/2/unsuspend":
        _call(client, "POST", "/users/2/suspend", REASON, client.admin)
    r = _call(client, method, path, body, client.admin)
    if path.startswith("/traffic/") and path != "/traffic/status":
        assert r.status_code == 409  # not configured: explicit, no fake data
        return
    assert r.status_code == 200, (path, r.text)
    assert r.headers.get("cache-control") == "no-store"


def test_session_reports_is_admin(client):
    assert client.get("/api/v1/auth/session", headers=client.admin).json()["is_admin"] is True
    assert client.get("/api/v1/auth/session", headers=client.user).json()["is_admin"] is False
    assert client.get("/api/v1/auth/session").json()["is_admin"] is False


# ── Explorer: redaction + read-only ──────────────────────────────────────────

def test_explorer_redacts_sensitive_columns(client):
    r = _call(client, "GET", "/data/tables/users?page_size=10", None, client.admin).json()
    cols = {c["name"]: c for c in r["columns"]}
    for name in ("hashed_password", "google_id", "phone_number", "date_of_birth", "preferences_json"):
        assert cols[name]["redacted"], name
    assert not cols["username"]["redacted"]
    alice = next(row for row in r["rows"] if row["username"] == "alice")
    assert alice["email"] == "u•••@e•••.test" and cols["email"]["masked"]  # masked like the directory
    assert _call(client, "GET", "/data/tables/users?filter_col=email&filter_val=user", None, client.admin).status_code == 400
    assert alice["hashed_password"] == "•••redacted•••" and alice["phone_number"] == "•••redacted•••"

    pk = _call(client, "GET", "/data/tables/passkey_credentials", None, client.admin).json()["rows"][0]
    assert pk["public_key"] == pk["sign_count"] == pk["credential_id"] == "•••redacted•••"
    assert pk["device_name"] == "Mac"

    chat = _call(client, "GET", "/data/tables/chat_history", None, client.admin).text
    assert "SECRET PROMPT TEXT" not in chat
    usage = _call(client, "GET", "/data/tables/ai_usage_events", None, client.admin).json()["rows"][0]
    assert usage["input_tokens"] == 1000  # token *counts* are not secrets

    subs = _call(client, "GET", "/data/tables/subscriptions", None, client.admin).json()["rows"][0]
    assert subs["stripe_subscription_id"] == "•••redacted•••"


def test_explorer_rejects_unknown_names_and_redacted_filters(client):
    a = client.admin
    assert _call(client, "GET", "/data/tables/users;DROP TABLE users", None, a).status_code == 404
    assert _call(client, "GET", "/data/tables/nope", None, a).status_code == 404
    assert _call(client, "GET", "/data/tables/users?sort=1;delete", None, a).status_code == 400
    assert _call(client, "GET", "/data/tables/users?filter_col=hashed_password&filter_val=$2b", None, a).status_code == 400
    r = _call(client, "GET", "/data/tables/users?filter_col=username&filter_val=ali&sort=id&order=desc", None, a).json()
    assert [row["username"] for row in r["rows"]] == ["alice"]
    # no write verbs exist on the explorer
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        assert _call(client, m, "/data/tables/users", {}, a).status_code == 405


def test_read_only_transaction_rejects_writes(SL):
    from app.services.admin_db_explorer import read_only
    eng = SL.kw["bind"]
    with pytest.raises(Exception):
        with read_only(eng) as conn:
            conn.execute(text("INSERT INTO ops_events (kind, severity, title) VALUES ('x','info','x')"))
    with pytest.raises(Exception):
        with read_only(eng) as conn:
            conn.execute(text("DELETE FROM users"))
    s = SL()
    assert s.query(User).count() == 3  # nothing changed
    s.close()


def test_postgres_read_only_statements(monkeypatch):
    """On PostgreSQL the explorer issues SET TRANSACTION READ ONLY + statement_timeout first."""
    from app.services import admin_db_explorer as ex
    seen = []

    class Conn:
        def begin(self):
            class T:
                def rollback(self_inner):
                    seen.append("ROLLBACK")
            return T()

        def execute(self, stmt, params=None):
            seen.append(str(stmt))

        def close(self):
            seen.append("CLOSE")

    class Eng:
        class dialect:
            name = "postgresql"

        def connect(self):
            return Conn()

    with ex.read_only(Eng()):
        pass
    assert seen[0] == "SET TRANSACTION READ ONLY"
    assert "set_config('statement_timeout'" in seen[1]
    assert seen[-2:] == ["ROLLBACK", "CLOSE"]


# ── Audit log ────────────────────────────────────────────────────────────────

def test_actions_and_views_are_audited(client, SL):
    a = client.admin
    _call(client, "POST", "/users/2/plan", {**REASON, "plan": "free"}, a)
    _call(client, "GET", "/data/tables/users", None, a)
    _call(client, "POST", "/users/2/conversations/c1/view", REASON, a)
    rows = _call(client, "GET", "/audit", None, a).json()["rows"]
    actions = [r["action"] for r in rows]
    assert {"user.plan", "db.view_table", "conversation.view"} <= set(actions)
    plan = next(r for r in rows if r["action"] == "user.plan")
    assert plan["actor_user_id"] == 1 and plan["target_id"] == "2" and plan["reason"] == REASON["reason"]
    assert plan["ip"] and plan["ts"]


def test_actions_require_reason(client):
    assert _call(client, "POST", "/users/2/suspend", {"reason": ""}, client.admin).status_code == 422
    assert _call(client, "POST", "/users/2/suspend", {}, client.admin).status_code == 422


def test_audit_log_is_append_only(client, SL):
    _call(client, "POST", "/users/2/plan", {**REASON, "plan": "pro"}, client.admin)
    s = SL()
    row = s.query(AdminAuditLog).first()
    row.reason = "tampered"
    with pytest.raises(AppendOnlyError):
        s.commit()
    s.rollback()
    with pytest.raises(AppendOnlyError):
        s.delete(s.query(AdminAuditLog).first())
        s.commit()
    s.close()


def test_conversation_contents_hidden_unless_explicitly_viewed(client):
    detail = _call(client, "GET", "/users/2", None, client.admin).json()
    assert detail["conversations"]["count"] == 1
    assert "SECRET PROMPT TEXT" not in json.dumps(detail)
    viewed = _call(client, "POST", "/users/2/conversations/c1/view", REASON, client.admin).json()
    assert viewed["messages"][0]["content"] == "SECRET PROMPT TEXT"


def test_emails_masked_until_revealed(client):
    rows = _call(client, "GET", "/users", None, client.admin).json()["rows"]
    alice = next(r for r in rows if r["id"] == 2)
    assert "user@example.test" not in json.dumps(rows) and alice["email_masked"].startswith("u•••@")
    r = _call(client, "POST", "/users/reveal-emails", {"user_ids": [2]}, client.admin).json()
    assert r["emails"]["2"] == "user@example.test"
    assert _call(client, "GET", "/audit?action=users.reveal_email", None, client.admin).json()["total"] == 1


# ── Suspension / revocation ──────────────────────────────────────────────────

def _login(client, email="user@example.test"):
    return client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})


def test_suspend_blocks_login_and_api(client, SL):
    old = _login(client).json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code == 200
    assert _call(client, "POST", "/users/2/suspend", REASON, client.admin).status_code == 200
    # existing token: rejected
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code in (401, 403)
    assert client.get("/api/v1/me/ai-usage", headers=client.user).status_code == 403
    # new sign-in: refused, and recorded as a blocked attempt
    r = _login(client)
    assert r.status_code == 403 and "suspended" in r.json()["detail"]
    s = SL()
    assert s.query(UserLoginEvent).filter_by(user_id=2, success=False, note="suspended").count() == 1
    s.close()
    # optional-auth session reports signed out
    assert client.get("/api/v1/auth/session", headers=client.user).json()["authenticated"] is False
    # unsuspend restores login
    _call(client, "POST", "/users/2/unsuspend", REASON, client.admin)
    assert _login(client).status_code == 200


def test_admin_cannot_be_suspended(client):
    assert _call(client, "POST", "/users/1/suspend", REASON, client.admin).status_code == 400


def test_revoke_sessions_kills_existing_tokens(client):
    old = _login(client).json()["access_token"]
    hdr = {"Authorization": f"Bearer {old}"}
    assert client.get("/api/v1/auth/me", headers=hdr).status_code == 200
    assert _call(client, "POST", "/users/2/revoke-sessions", REASON, client.admin).json()["session_version"] == 1
    assert client.get("/api/v1/auth/me", headers=hdr).status_code == 401
    assert client.get("/api/v1/auth/session", headers=hdr).json()["authenticated"] is False
    new = _login(client).json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new}"}).status_code == 200


def test_fast_check_used_by_db_less_routes(client):
    from app.api.auth import _guard_token
    _call(client, "POST", "/users/2/revoke-sessions", REASON, client.admin)
    assert account_controls.fast_token_check(2, 0) is False
    assert account_controls.fast_token_check(2, 1) is True
    assert account_controls.fast_token_check(1, 0) is True
    assert _guard_token is not None


def test_login_history_and_sessions_in_detail(client):
    _login(client)
    d = _call(client, "GET", "/users/2", None, client.admin).json()
    assert d["logins"][0]["method"] == "password" and d["logins"][0]["success"] is True
    assert len(d["sessions"]["active_estimate"]) == 1
    _call(client, "POST", "/users/2/revoke-sessions", REASON, client.admin)
    d = _call(client, "GET", "/users/2", None, client.admin).json()
    assert d["sessions"]["active_estimate"] == []


# ── Entitlements / quota ─────────────────────────────────────────────────────

def test_admin_tier_has_no_per_user_quota_but_global_budget_applies(client, monkeypatch):
    lim = ai_guard.tier_limits("admin")
    assert all(v == -1 for v in lim.values())
    u = client.get("/api/v1/me/ai-usage", headers=client.admin).json()
    assert u["tier"] == "admin" and u["unlimited"] is True and u["requests_remaining"] == -1
    ctx = ai_guard.GuardContext(feature="copilot", user_id=1, tier="admin", ip="1.2.3.4")
    for _ in range(50):
        ai_guard.admit_request(ctx)
    monkeypatch.setenv("LLM_DAILY_BUDGET_USD", "0")
    with pytest.raises(ai_guard.AIQuotaError) as e:
        ai_guard.admit_request(ctx)
    assert e.value.status_code == 503


def test_quota_override_and_reset(client):
    r = _call(client, "POST", "/users/2/ai-quota", {**REASON, "req_per_day": 2}, client.admin)
    assert r.json()["ai_quota_override"] == {"req_per_day": 2}
    _call(client, "POST", "/users/2/plan", {**REASON, "plan": "free"}, client.admin)
    u = client.get("/api/v1/me/ai-usage", headers=client.user).json()
    assert u["requests_limit"] == 2 and u["tier"] == "free"
    ctx = ai_guard.GuardContext(feature="copilot", user_id=2, tier="free", ip="9.9.9.9", limits_override={"req_per_day": 2})
    ai_guard.admit_request(ctx)
    ai_guard.admit_request(ctx)
    with pytest.raises(ai_guard.AIQuotaError):
        ai_guard.admit_request(ctx)
    r = _call(client, "POST", "/users/2/ai-quota", {**REASON, "reset_today": True}, client.admin).json()
    assert r["cleared"]["req"] == 2
    assert client.get("/api/v1/me/ai-usage", headers=client.user).json()["requests_used"] == 0


def test_plan_override_changes_tier(client):
    assert client.get("/api/v1/me/ai-usage", headers=client.user).json()["tier"] == "pro"  # Stripe active
    _call(client, "POST", "/users/2/plan", {**REASON, "plan": "free"}, client.admin)
    assert client.get("/api/v1/me/ai-usage", headers=client.user).json()["tier"] == "free"
    _call(client, "POST", "/users/2/plan", {**REASON, "plan": "default"}, client.admin)
    assert client.get("/api/v1/me/ai-usage", headers=client.user).json()["tier"] == "pro"


# ── Analytics shape ──────────────────────────────────────────────────────────

def test_overview_uses_real_data(client):
    o = _call(client, "GET", "/overview?range=30d", None, client.admin).json()
    assert o["kpis"]["total_users"]["value"] == 3
    assert o["kpis"]["ai_requests"]["value"] == 1
    assert o["ai"]["by_model"][0]["model"] == "claude-sonnet-5"
    assert o["subscriptions"]["paid_subscribers"] == 1
    assert o["subscriptions"]["mrr_usd"] is None and o["subscriptions"]["mrr_reason"]  # no Stripe: "—" + reason


def test_revenue_mrr_from_price_lookup(SL):
    from app.services import admin_service as svc
    s = SL()
    out = svc.revenue_block(s, svc.window("30d"),
                            price_lookup=lambda pid: {"amount": 120.0, "interval": "year", "interval_count": 1})
    assert out["mrr_usd"] == 10.0 and out["arppu_usd"] == 10.0
    s.close()


def test_status_transitions_and_copilot_row():
    from app.services.admin_metrics import copilot_row, transitions
    prev = {}
    assert transitions(prev, [{"id": "db", "name": "AWS RDS PostgreSQL", "status": "ok"}]) == []
    ev = transitions(prev, [{"id": "db", "name": "AWS RDS PostgreSQL", "status": "down"}])
    assert ev[0]["severity"] == "critical" and "is down" in ev[0]["title"]
    row = copilot_row({"user_id": 2, "provider": "bedrock", "model": "claude-sonnet-5", "chain_index": 1,
                       "stages_ms": {"total": 900, "first_token": 300},
                       "tools": [{"name": "search_filings", "ms": 120, "facts": 0}, {"name": "quote", "ms": 5, "facts": 2}],
                       "cited": ["f1", "f2"], "policy_flags": ["x"]})
    assert row["retrieval_calls"] == 1 and row["retrieval_empty"] == 1 and row["retrieval_ms"] == 120
    assert row["citations"] == 2 and row["chain_index"] == 1 and row["ok"] is True and row["policy_flags"] == 1


# ── Traffic (GA4 / GSC) ──────────────────────────────────────────────────────

def test_traffic_not_configured_shows_setup(client, monkeypatch):
    for k in ("GA4_PROPERTY_ID", "GSC_SITE_URL", "GOOGLE_ANALYTICS_SA_JSON"):
        monkeypatch.delenv(k, raising=False)
    st = _call(client, "GET", "/traffic/status", None, client.admin).json()
    assert st["ga4_configured"] is False and st["gsc_configured"] is False
    assert set(st["env"]) == {"GA4_PROPERTY_ID", "GSC_SITE_URL", "GOOGLE_ANALYTICS_SA_JSON"}
    assert st["setup_steps"]


def test_traffic_with_mocked_google(client, monkeypatch):
    monkeypatch.setenv("GA4_PROPERTY_ID", "123456")
    monkeypatch.setenv("GSC_SITE_URL", "sc-domain:quanttrade.us")
    monkeypatch.setenv("GOOGLE_ANALYTICS_SA_JSON", json.dumps({"client_email": "sa@x.iam", "private_key": "-----KEY-----"}))
    calls = []

    def transport(method, url, body):
        calls.append(url)
        if ":runRealtimeReport" in url:
            return {"metricHeaders": [{"name": "activeUsers"}], "rows": [{"metricValues": [{"value": "4"}]}]}
        if ":runReport" in url:
            dims = [d["name"] for d in body.get("dimensions", [])]
            mets = [m["name"] for m in body["metrics"]]
            dv = {"date": "20261126", "pagePath": "/", "country": "India"}
            return {"dimensionHeaders": [{"name": d} for d in dims], "metricHeaders": [{"name": m} for m in mets],
                    "rows": [{"dimensionValues": [{"value": dv.get(d, "x")} for d in dims],
                              "metricValues": [{"value": "10"} for _ in mets]}]}
        return {"rows": [{"keys": ["2026-11-26"], "clicks": 5, "impressions": 100, "ctr": 0.05, "position": 8.2}]}

    admin_traffic.set_transport(transport)
    st = _call(client, "GET", "/traffic/status", None, client.admin).json()
    assert st["ga4_configured"] and st["gsc_configured"] and "private_key" not in json.dumps(st)
    ga = _call(client, "GET", "/traffic/ga4?range=7d", None, client.admin).json()
    assert ga["kpis"]["active_users"] == 10 and ga["daily"][0]["date"] == "2026-11-26"
    assert _call(client, "GET", "/traffic/realtime", None, client.admin).json()["active_users_30m"] == 4
    gsc = _call(client, "GET", "/traffic/gsc?range=7d", None, client.admin).json()
    assert gsc["totals"]["clicks"] == 5 and gsc["totals"]["ctr"] == 0.05
    n = len(calls)
    _call(client, "GET", "/traffic/ga4?range=7d", None, client.admin)
    assert len(calls) == n  # cached
    admin_traffic.set_transport(None)
