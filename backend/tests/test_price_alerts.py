"""Price / indicator alerts: CRUD API, condition evaluation, scheduled trigger semantics."""
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services.price_alert_service import is_met, quote_metrics, run_price_alerts


@pytest.fixture
def env(monkeypatch):
    from app.api import alerts as api
    from app.api.auth import create_access_token
    from app.db.database import Base, get_db
    from app.models.billing import Subscription
    from app.models.community import Notification
    from app.models.price_alert import PriceAlert
    from app.models.symbol import Symbol
    from app.models.user import User

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng, tables=[
        User.__table__, Symbol.__table__, PriceAlert.__table__, Notification.__table__, Subscription.__table__,
    ])
    SL = sessionmaker(bind=eng)
    s = SL()
    s.add_all([
        User(id=1, email="a@example.com", username="a", is_verified=True),
        User(id=2, email="b@example.com", username="b", is_verified=True),
        Symbol(id=1, symbol="AAPL", name="Apple Inc."),
        Symbol(id=2, symbol="MSFT", name="Microsoft"),
    ])
    s.commit()
    s.close()

    monkeypatch.setattr(api, "_load_quotes", lambda db, syms: {
        "AAPL": {"price": 200.0, "change_percent": 1.5}, "MSFT": {"price": 400.0, "change_percent": -3.0},
    })
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")

    def _db():
        d = SL()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = _db
    c = TestClient(app)
    c.a = {"Authorization": f"Bearer {create_access_token(1)}"}
    c.b = {"Authorization": f"Bearer {create_access_token(2)}"}
    c.SL = SL
    return c


def _create(c, **body):
    body = {"symbol": "AAPL", "condition": "price_above", "threshold": 210, **body}
    return c.post("/api/v1/alerts", json=body, headers=c.a)


def _run(SL, quotes, rsi=None, emails=None):
    async def qf(db, syms):
        return {s: quotes[s] for s in syms if s in quotes}

    sent = emails if emails is not None else []
    db = SL()
    try:
        return asyncio.run(run_price_alerts(
            db,
            quote_fetch=qf,
            rsi_fetch=lambda db, s, p: (rsi or {}).get(s),
            send_email=lambda to, t, b, s: sent.append((to, t)),
        ))
    finally:
        db.close()


# ── pure evaluation ──────────────────────────────────────────────────────────

def test_condition_semantics():
    m = {"price": 100.0, "change": -4.0, "rsi": 25.0}
    assert is_met("price_above", 100, m) is True
    assert is_met("price_above", 100.01, m) is False
    assert is_met("price_below", 100, m) is True
    assert is_met("change_down_pct", 3, m) is True       # down 4% >= 3%
    assert is_met("change_down_pct", 5, m) is False
    assert is_met("change_up_pct", 1, m) is False
    assert is_met("rsi_below", 30, m) is True
    assert is_met("rsi_above", 70, {"price": 1.0}) is None  # unknown metric never fires


def test_quote_metrics_handles_unavailable_and_derives_change():
    assert quote_metrics({"unavailable": True}) == {"price": None, "change": None}
    assert quote_metrics({"price": 110, "previous_close": 100})["change"] == pytest.approx(10.0)
    assert quote_metrics({"price": 0})["price"] is None


# ── API ──────────────────────────────────────────────────────────────────────

def test_requires_auth(env):
    assert env.get("/api/v1/alerts").status_code == 401
    assert env.post("/api/v1/alerts", json={}).status_code == 401


def test_create_list_update_delete(env):
    r = _create(env, symbol="aapl", note="breakout")
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["symbol"] == "AAPL" and a["status"] == "active" and a["name"] == "Apple Inc."
    listing = env.get("/api/v1/alerts", headers=env.a).json()
    assert listing["alerts"][0]["current_price"] == 200.0 and listing["limit"] == 50

    r = env.patch(f"/api/v1/alerts/{a['id']}", json={"status": "paused"}, headers=env.a)
    assert r.json()["status"] == "paused"
    r = env.patch(f"/api/v1/alerts/{a['id']}", json={"threshold": 0}, headers=env.a)
    assert r.status_code == 422
    assert env.delete(f"/api/v1/alerts/{a['id']}", headers=env.a).status_code == 204
    assert env.get("/api/v1/alerts", headers=env.a).json()["alerts"] == []


def test_validation(env):
    assert _create(env, symbol="ZZZZ").status_code == 404
    assert _create(env, symbol="bad sym").status_code == 422
    assert _create(env, condition="rsi_above", threshold=150).status_code == 422
    assert _create(env, condition="change_up_pct", threshold=0).status_code == 422
    assert _create(env, condition="moon").status_code == 422
    assert _create(env).status_code == 201
    assert _create(env).status_code == 409  # exact duplicate


def test_alert_limit(env, monkeypatch):
    from app.api import alerts as api
    monkeypatch.setattr(api, "MAX_ALERTS_PER_USER", 2)
    assert _create(env, threshold=1).status_code == 201
    assert _create(env, threshold=2).status_code == 201
    assert _create(env, threshold=3).status_code == 409


def test_other_users_alert_is_404(env):
    a = _create(env).json()
    assert env.patch(f"/api/v1/alerts/{a['id']}", json={"status": "paused"}, headers=env.b).status_code == 404
    assert env.delete(f"/api/v1/alerts/{a['id']}", headers=env.b).status_code == 404
    assert env.get("/api/v1/alerts", headers=env.b).json()["alerts"] == []


# ── scheduled evaluation ─────────────────────────────────────────────────────

def _notifs(SL):
    from app.models.community import Notification
    db = SL()
    try:
        return [(n.user_id, n.type, n.title) for n in db.query(Notification).order_by(Notification.id).all()]
    finally:
        db.close()


def test_one_shot_alert_triggers_once_and_notifies(env):
    a = _create(env, threshold=210).json()
    assert _run(env.SL, {"AAPL": {"price": 205.0}})["triggered"] == 0
    assert _run(env.SL, {"AAPL": {"price": 211.0}})["triggered"] == 1
    assert _notifs(env.SL) == [(1, "price_alert", "AAPL is above $210.00")]
    assert _run(env.SL, {"AAPL": {"price": 215.0}})["checked"] == 0  # no longer active
    got = env.get("/api/v1/alerts", headers=env.a).json()["alerts"][0]
    assert got["status"] == "triggered" and got["trigger_count"] == 1 and got["last_triggered_value"] == 211.0

    # moving the level re-activates it
    r = env.patch(f"/api/v1/alerts/{a['id']}", json={"threshold": 220}, headers=env.a)
    assert r.json()["status"] == "active" and r.json()["armed"] is True


def test_repeat_alert_rearms_only_after_condition_clears(env):
    _create(env, symbol="MSFT", condition="change_down_pct", threshold=2, repeat=True)
    assert _run(env.SL, {"MSFT": {"price": 390.0, "change_percent": -3.0}})["triggered"] == 1
    assert _run(env.SL, {"MSFT": {"price": 389.0, "change_percent": -3.2}})["triggered"] == 0  # still down: no spam
    assert _run(env.SL, {"MSFT": {"price": 399.0, "change_percent": -0.5}})["rearmed"] == 1
    assert _run(env.SL, {"MSFT": {"price": 388.0, "change_percent": -2.5}})["triggered"] == 1
    assert len(_notifs(env.SL)) == 2


def test_missing_quote_or_rsi_never_triggers_and_paused_is_skipped(env):
    _create(env, condition="price_below", threshold=500)
    _create(env, symbol="MSFT", condition="rsi_below", threshold=30)
    stats = _run(env.SL, {"AAPL": {"unavailable": True}}, rsi={"MSFT": None})
    assert stats == {"checked": 2, "triggered": 0, "rearmed": 0, "no_data": 2}
    assert _run(env.SL, {"MSFT": {"price": 300.0}}, rsi={"MSFT": 22.0})["triggered"] == 1

    p = _create(env, threshold=1).json()
    env.patch(f"/api/v1/alerts/{p['id']}", json={"status": "paused"}, headers=env.a)
    # paused alert is skipped; the price_below 500 alert is not met at 999
    stats = _run(env.SL, {"AAPL": {"price": 999.0}})
    assert stats["triggered"] == 0 and stats["checked"] == 1


def test_email_only_for_pro_users_who_opted_in(env):
    from app.models.billing import Subscription
    _create(env, threshold=100, notify_email=True)
    emails = []
    _run(env.SL, {"AAPL": {"price": 150.0}}, emails=emails)
    assert emails == []  # free user: in-app only

    db = env.SL()
    db.add(Subscription(user_id=1, status="active", stripe_subscription_id="sub_x", price_id="price_x",
                        current_period_end=datetime.utcnow() + timedelta(days=10)))
    db.commit()
    db.close()
    _create(env, threshold=120, notify_email=True)
    _run(env.SL, {"AAPL": {"price": 150.0}}, emails=emails)
    assert emails == [("a@example.com", "AAPL is above $120.00")]


def test_default_rsi_uses_db_bars_plus_live_price(env):
    from app.db.database import Base
    from app.models.price import PriceBar
    from app.services.price_alert_service import default_rsi

    db = env.SL()
    Base.metadata.create_all(bind=db.get_bind(), tables=[PriceBar.__table__])
    start = datetime.utcnow() - timedelta(days=40)
    for i in range(30):
        c = 100.0 + i  # steady uptrend
        db.add(PriceBar(symbol_id=1, timestamp=start + timedelta(days=i), open=c, high=c, low=c, close=c, volume=1))
    db.commit()
    assert default_rsi(db, "AAPL", None) == pytest.approx(100.0)
    # a sharp drop in today's live price pulls RSI well below 100
    assert default_rsi(db, "AAPL", 90.0) < 60
    assert default_rsi(db, "NOPE", 1.0) is None
    assert default_rsi(db, "MSFT", 1.0) is None  # no bars
    db.close()
