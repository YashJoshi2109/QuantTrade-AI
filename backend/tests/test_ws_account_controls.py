"""WebSockets honour the admin console's account controls: suspended / revoked
tokens are rejected at connect, closed mid-stream by the periodic re-check,
and closed immediately by the admin suspend / revoke-sessions actions.
Anonymous visitors keep the public channels."""
from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

import app.api.auth as auth_mod
from app.api import admin as admin_api
from app.api import ws as ws_api
from app.api.auth import create_access_token
from app.auth.jwt import COOKIE_NAME
from app.config import settings
from app.db import database
from app.db.database import Base, get_db
from app.models.admin import UserAccountControl
from app.models.user import User
from app.services import account_controls, ws_sessions
from app.services.redis_cache_service import cache_service

ADMIN_EMAIL = "ws-admin@example.test"
REASON = {"reason": "abuse report #7"}


@pytest.fixture
def SL(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    import app.main  # noqa: F401  register every model on Base.metadata
    Base.metadata.create_all(bind=eng)
    factory = sessionmaker(bind=eng, autocommit=False, autoflush=False)
    monkeypatch.setattr(database, "SessionLocal", factory)
    account_controls.invalidate_fast_cache()
    s = factory()
    s.add_all([User(id=1, email=ADMIN_EMAIL, username="boss", is_verified=True),
               User(id=2, email="trader@example.test", username="trader", is_verified=True)])
    s.commit()
    s.close()
    yield factory
    account_controls.invalidate_fast_cache()


@pytest.fixture
def tc(SL, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", ADMIN_EMAIL)
    monkeypatch.setattr(auth_mod, "LOGIN_NOTIFY_AVAILABLE", False, raising=False)

    async def no_cache(key):
        return None

    async def idle_listener(channel, ws_channel):
        return None

    monkeypatch.setattr(cache_service, "get", no_cache)
    monkeypatch.setattr(ws_api, "_redis_listener", idle_listener)
    app = FastAPI()
    app.include_router(ws_api.router, prefix="/api/v1")
    app.include_router(admin_api.router, prefix="/api/v1/admin")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        c.admin = {"Authorization": f"Bearer {create_access_token(1)}"}
        yield c


def _set_controls(SL, user_id, *, suspended=False, sv=0):
    s = SL()
    c = s.get(UserAccountControl, user_id) or UserAccountControl(user_id=user_id, session_version=0)
    c.session_version = sv
    c.suspended_at = datetime.now(timezone.utc) if suspended else None
    s.add(c)
    s.commit()
    s.close()
    account_controls.invalidate_fast_cache(user_id)


def _alive(ws, pong="pong"):
    ws.send_text("ping")
    msg = ws.receive_text()
    assert pong in msg


def _closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as e:
        for _ in range(5):
            ws.receive_text()
    return e.value.code


def _wait_until(pred, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False


# ── connect ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/api/v1/ws/pulse", "/api/v1/ws/ideas", "/api/v1/ws/scanner",
                                  "/api/v1/ws/news"])
def test_anonymous_public_streams_stay_open(tc, path):
    with tc.websocket_connect(path) as ws:
        _alive(ws)


def test_invalid_token_is_treated_as_anonymous(tc):
    with tc.websocket_connect("/api/v1/ws/pulse?token=not-a-jwt") as ws:
        _alive(ws)
    assert ws_sessions.registry.count(2) == 0


def test_active_user_connects_and_is_registered(tc):
    with tc.websocket_connect(f"/api/v1/ws/pulse?token={create_access_token(2)}") as ws:
        _alive(ws)
        assert ws_sessions.registry.count(2) == 1
    assert _wait_until(lambda: ws_sessions.registry.count(2) == 0)


@pytest.mark.parametrize("path", ["/api/v1/ws/pulse", "/api/v1/ws/news", "/api/v1/ws/community/trending",
                                  "/api/v1/ws/community/user:2"])
def test_suspended_token_rejected_with_4403(tc, SL, path):
    _set_controls(SL, 2, suspended=True, sv=1)
    with tc.websocket_connect(f"{path}?token={create_access_token(2, 1)}") as ws:
        assert _closed_with(ws) == ws_sessions.CLOSE_SUSPENDED


def test_revoked_token_rejected_with_4401(tc, SL):
    _set_controls(SL, 2, sv=1)
    with tc.websocket_connect(f"/api/v1/ws/news?token={create_access_token(2, 0)}") as ws:
        assert _closed_with(ws) == ws_sessions.CLOSE_REVOKED
    # a token issued after the revocation works
    with tc.websocket_connect(f"/api/v1/ws/news?token={create_access_token(2, 1)}") as ws:
        _alive(ws)


def test_suspended_session_cookie_rejected(tc, SL):
    _set_controls(SL, 2, suspended=True, sv=1)
    tc.cookies.set(COOKIE_NAME, create_access_token(2, 1))
    try:
        with tc.websocket_connect("/api/v1/ws/pulse") as ws:
            assert _closed_with(ws) == ws_sessions.CLOSE_SUSPENDED
    finally:
        tc.cookies.clear()


def test_private_channel_still_needs_the_owner(tc):
    with tc.websocket_connect(f"/api/v1/ws/community/user:2?token={create_access_token(2)}") as ws:
        _alive(ws, pong="pong")
    with pytest.raises(WebSocketDisconnect) as e:
        with tc.websocket_connect(f"/api/v1/ws/community/user:2?token={create_access_token(1)}") as ws:
            ws.receive_text()
    assert e.value.code == 1008
    with pytest.raises(WebSocketDisconnect) as e:
        with tc.websocket_connect("/api/v1/ws/community/user:2") as ws:
            ws.receive_text()
    assert e.value.code == 1008


# ── while connected ──────────────────────────────────────────────────────

def test_periodic_recheck_closes_suspended_stream(tc, SL, monkeypatch):
    monkeypatch.setenv("WS_ACCOUNT_RECHECK_S", "0.05")
    with tc.websocket_connect(f"/api/v1/ws/pulse?token={create_access_token(2)}") as ws:
        _alive(ws)
        _set_controls(SL, 2, suspended=True, sv=1)   # changed behind the socket's back, no admin hook
        assert _closed_with(ws) == ws_sessions.CLOSE_SUSPENDED
    assert _wait_until(lambda: ws_sessions.registry.count(2) == 0)


def test_periodic_recheck_closes_revoked_stream(tc, SL, monkeypatch):
    monkeypatch.setenv("WS_ACCOUNT_RECHECK_S", "0.05")
    with tc.websocket_connect(f"/api/v1/ws/community/user:2?token={create_access_token(2)}") as ws:
        _alive(ws)
        _set_controls(SL, 2, sv=1)
        assert _closed_with(ws) == ws_sessions.CLOSE_REVOKED


def test_periodic_recheck_keeps_good_streams(tc, monkeypatch):
    monkeypatch.setenv("WS_ACCOUNT_RECHECK_S", "0.05")
    with tc.websocket_connect(f"/api/v1/ws/pulse?token={create_access_token(2)}") as ws:
        time.sleep(0.3)
        _alive(ws)


# ── admin actions close sockets at once ──────────────────────────────────

def test_admin_suspend_closes_open_sockets_immediately(tc):
    tok = create_access_token(2)
    with tc.websocket_connect(f"/api/v1/ws/pulse?token={tok}") as a, \
            tc.websocket_connect(f"/api/v1/ws/community/user:2?token={tok}") as b, \
            tc.websocket_connect("/api/v1/ws/pulse") as anon, \
            tc.websocket_connect(f"/api/v1/ws/pulse?token={create_access_token(1)}") as admin_sock:
        _alive(a)
        _alive(b)
        assert ws_sessions.registry.count(2) == 2
        assert tc.post("/api/v1/admin/users/2/suspend", json=REASON, headers=tc.admin).status_code == 200
        assert _closed_with(a) == ws_sessions.CLOSE_SUSPENDED   # default 30 s re-check: closed by the hook
        assert _closed_with(b) == ws_sessions.CLOSE_SUSPENDED
        _alive(anon)        # anonymous and other users are untouched
        _alive(admin_sock)
    assert ws_sessions.registry.count(2) == 0


def test_admin_revoke_sessions_closes_open_sockets_immediately(tc):
    with tc.websocket_connect(f"/api/v1/ws/news?token={create_access_token(2)}") as ws:
        _alive(ws)
        assert tc.post("/api/v1/admin/users/2/revoke-sessions", json=REASON, headers=tc.admin).status_code == 200
        assert _closed_with(ws) == ws_sessions.CLOSE_REVOKED


def test_admin_action_publishes_to_other_workers(monkeypatch):
    published = []

    async def fake_publish(channel, data):
        published.append((channel, data))

    monkeypatch.setattr(cache_service, "_redis", object())
    monkeypatch.setattr(cache_service, "publish", fake_publish)
    import asyncio

    async def go():
        ws_sessions.notify_account_change(42)
        await asyncio.sleep(0.05)

    asyncio.run(go())
    assert published == [(ws_sessions.CONTROL_CHANNEL, {"user_id": 42})]


def test_control_message_from_another_worker_closes_local_sockets(monkeypatch, SL):
    import asyncio
    import json

    closed = []

    class FakeWS:
        async def close(self, code=1000, reason=""):
            closed.append(code)

    class FakePubSub:
        def __init__(self):
            self.sent = False

        async def get_message(self, ignore_subscribe_messages=True, timeout=1.0):
            if not self.sent:
                self.sent = True
                return {"type": "message", "data": json.dumps({"user_id": 2})}
            await asyncio.sleep(0.01)
            return None

    async def fake_subscribe(channel):
        assert channel == ws_sessions.CONTROL_CHANNEL
        return FakePubSub()

    monkeypatch.setattr(cache_service, "subscribe", fake_subscribe)

    async def go():
        reg = ws_sessions.Registry()
        ident = ws_sessions.WSIdentity(2, 0)
        reg._by_user[2] = {FakeWS(): (ident, asyncio.get_running_loop())}
        _set_controls(SL, 2, suspended=True, sv=1)
        task = asyncio.create_task(ws_sessions._control_listener(reg))
        for _ in range(50):
            if closed:
                break
            await asyncio.sleep(0.02)
        task.cancel()
        return reg

    reg = asyncio.run(go())
    assert closed == [ws_sessions.CLOSE_SUSPENDED] and reg.count(2) == 0
