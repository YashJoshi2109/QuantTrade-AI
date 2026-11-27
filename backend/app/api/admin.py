"""
Admin console API: /api/v1/admin/*

Security model
  * Every route depends on ``require_admin_console``: anonymous -> 401,
    signed in but not an admin -> 404 (the console does not advertise itself).
    Admin = verified account whose stored email is in ADMIN_EMAILS
    (app.api.auth.is_admin_user). The UI check is cosmetic only.
  * Responses are ``Cache-Control: no-store``.
  * The only writes are the account actions below (revoke sessions,
    suspend / unsuspend, AI quota, plan). Each needs a reason and appends one
    row to admin_audit_log (actor, action, target, reason, time, IP).
    Sensitive reads (table views, conversation views, email reveals, exports)
    are audited the same way. User content is never edited.
  * The database explorer is read-only (see app.services.admin_db_explorer).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.auth import is_admin_user, require_auth
from app.db.database import get_db
from app.models.admin import AdminAuditLog, UserAccountControl, UserLoginEvent
from app.models.user import User
from app.services import admin_service as svc

logger = logging.getLogger(__name__)

RangeKey = Literal["24h", "7d", "30d", "90d"]


def require_admin_console(response: Response, user: User = Depends(require_auth)) -> User:
    response.headers["Cache-Control"] = "no-store"
    if not is_admin_user(user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return user


router = APIRouter(dependencies=[Depends(require_admin_console)])


def _ip(request: Request) -> Optional[str]:
    from app.api.auth import _request_ip
    ip = _request_ip(request)
    return ip[:64] if ip else None


def audit(db: Session, actor: User, request: Request, action: str, target_type: Optional[str] = None,
          target_id: Any = None, reason: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> AdminAuditLog:
    row = AdminAuditLog(actor_user_id=actor.id, action=action[:64], target_type=target_type,
                        target_id=None if target_id is None else str(target_id)[:128],
                        reason=(reason or None) and reason[:2000], ip=_ip(request), details=details,
                        ts=datetime.now(timezone.utc))
    db.add(row)
    db.commit()
    return row


def _user_or_404(db: Session, user_id: int) -> User:
    u = db.query(User).filter(User.id == user_id).first()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    return u


class ReasonBody(BaseModel):
    reason: str = Field(..., min_length=5, max_length=2000)


# ── Shell ────────────────────────────────────────────────────────────────────

@router.get("/me")
def admin_me(user: User = Depends(require_admin_console)):
    return {"is_admin": True, "user_id": user.id, "username": user.username, "full_name": user.full_name,
            "avatar_url": user.avatar_url, "email_masked": svc.mask_email(user.email), "env": svc.env_label()}


@router.get("/search")
def admin_search(q: str = Query("", max_length=100), db: Session = Depends(get_db)):
    q = q.strip()
    users: List[Dict[str, Any]] = []
    if q:
        like = f"%{q.lower()}%"
        conds = [func.lower(User.username).like(like), func.lower(User.email).like(like)]
        if q.isdigit():
            conds.append(User.id == int(q))
        from sqlalchemy import or_
        users = [{"id": u.id, "username": u.username, "email_masked": svc.mask_email(u.email)}
                 for u in db.query(User).filter(or_(*conds)).limit(8).all()]
    from sqlalchemy import inspect as sa_inspect
    tables = [t for t in sa_inspect(db.get_bind()).get_table_names() if q.lower() in t.lower()][:8] if q else []
    return {"users": users, "tables": tables}


@router.get("/notifications")
def admin_notifications(db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=2)
    items = [i for i in svc.ops_feed(db, since, 20) if i["kind"] != "admin_action"]
    return {"items": items, "unread": sum(1 for i in items if i["severity"] in ("warning", "critical"))}


# ── Command center ───────────────────────────────────────────────────────────

@router.get("/overview")
def overview(range: RangeKey = "7d", db: Session = Depends(get_db)):
    w = svc.window(range)
    total = svc._safe(db, lambda: db.query(func.count(User.id)).scalar(), None)
    total_prior = svc._safe(db, lambda: db.query(func.count(User.id))
                            .filter(User.created_at < svc._naive(w.start)).scalar(), None)
    signups = svc.signup_series(db, w)
    cumulative, run = [], (total_prior or 0)
    for n in signups:
        run += n
        cumulative.append(run)
    uk = svc.user_kpis(db, w)
    ai = svc.ai_usage_block(db, w)
    rev = svc.revenue_block(db, w)
    copilot = svc.copilot_block(db, w)
    health = svc.health_block(db, w)
    ai_tot, ai_prior = ai.get("totals") or {}, ai.get("prior") or {}
    return {
        "window": w.meta(),
        "kpis": {
            "total_users": svc.kpi(total, total_prior, cumulative),
            "dau": uk["dau"],
            "new_registrations": uk["new_registrations"],
            "ai_requests": svc.kpi(ai_tot.get("calls"), ai_prior.get("calls"), [b["calls"] for b in ai["series"]],
                                   reason=None if ai.get("totals") else "ai_usage_events unavailable",
                                   note="paid AI provider calls"),
            "mrr": svc.kpi(rev.get("mrr_usd"), None, reason=rev.get("mrr_reason") or rev.get("reason"),
                           unit="usd", note="from Stripe price amounts; no history stored for a delta"),
        },
        "engagement": svc.engagement(db, w),
        "ai": {"totals": ai_tot, "by_model": ai["by_model"], "by_provider": ai["by_provider"],
               "p95_ms": copilot.get("p95_ms"), "success_rate": copilot.get("success_rate"),
               "error_rate": (ai_tot.get("errors", 0) / ai_tot["calls"]) if ai_tot.get("calls") else None,
               "budgets": ai.get("budgets"), "copilot_requests": copilot.get("requests")},
        "health": {k: health[k] for k in ("overall", "services", "incidents", "availability", "generated_at")},
        "subscriptions": rev,
        "activity": health["activity"],
        "recent_users": svc._safe(db, lambda: svc.recent_users(db, w), []),
        "counts": _counts(db),
    }


def _counts(db: Session) -> Dict[str, Optional[int]]:
    out: Dict[str, Optional[int]] = {}
    for key, mod, attr in (("watchlist_items", "app.models.watchlist", "Watchlist"),
                           ("marketwatch_lists", "app.models.marketwatch", "MarketwatchList"),
                           ("portfolios", "app.models.portfolio", "Portfolio"),
                           ("positions", "app.models.portfolio", "Position"),
                           ("price_alerts", "app.models.price_alert", "PriceAlert"),
                           ("conversations", "app.models.chat_history", "Conversation")):
        out[key] = svc._count(db, mod, attr, "id", None)
    return out


# ── Users ────────────────────────────────────────────────────────────────────

@router.get("/users")
def users_list(range: RangeKey = "7d", q: Optional[str] = Query(None, max_length=100),
               plan: Optional[Literal["free", "pro", "admin"]] = None,
               status_: Optional[Literal["active", "suspended", "unverified"]] = Query(None, alias="status"),
               sort: str = "created_at", order: Literal["asc", "desc"] = "desc",
               page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), db: Session = Depends(get_db)):
    w = svc.window(range)
    return {"window": w.meta(), **svc.list_users(db, w, q, plan, status_, sort, order, page, page_size)}


@router.get("/users/kpis")
def users_kpis(range: RangeKey = "7d", db: Session = Depends(get_db)):
    w = svc.window(range)
    return {"window": w.meta(), "kpis": svc.user_kpis(db, w), "engagement": svc.engagement(db, w)}


@router.get("/users/{user_id}")
def user_detail(user_id: int, range: RangeKey = "30d", db: Session = Depends(get_db)):
    return svc.user_detail(db, _user_or_404(db, user_id), svc.window(range))


class RevealBody(BaseModel):
    user_ids: List[int] = Field(..., min_length=1, max_length=100)
    reason: Optional[str] = Field(None, max_length=500)


@router.post("/users/reveal-emails")
def reveal_emails(body: RevealBody, request: Request, admin: User = Depends(require_admin_console),
                  db: Session = Depends(get_db)):
    rows = db.query(User.id, User.email).filter(User.id.in_(body.user_ids)).all()
    audit(db, admin, request, "users.reveal_email", "user", ",".join(str(r[0]) for r in rows)[:128],
          body.reason or "Revealed in admin console", {"count": len(rows)})
    return {"emails": {str(i): e for i, e in rows}}


@router.post("/users/{user_id}/revoke-sessions")
def revoke_sessions(user_id: int, body: ReasonBody, request: Request, admin: User = Depends(require_admin_console),
                    db: Session = Depends(get_db)):
    from app.services.account_controls import get_or_create_controls, invalidate_fast_cache
    _user_or_404(db, user_id)
    c = get_or_create_controls(db, user_id)
    c.session_version = int(c.session_version or 0) + 1
    c.sessions_revoked_at = datetime.now(timezone.utc)
    db.commit()
    invalidate_fast_cache(user_id)
    audit(db, admin, request, "user.revoke_sessions", "user", user_id, body.reason,
          {"session_version": c.session_version})
    return {"ok": True, "session_version": c.session_version}


@router.post("/users/{user_id}/suspend")
def suspend(user_id: int, body: ReasonBody, request: Request, admin: User = Depends(require_admin_console),
            db: Session = Depends(get_db)):
    from app.services.account_controls import get_or_create_controls, invalidate_fast_cache
    target = _user_or_404(db, user_id)
    if target.id == admin.id or is_admin_user(target):
        raise HTTPException(status_code=400, detail="Admin accounts cannot be suspended from the console")
    c = get_or_create_controls(db, user_id)
    if c.suspended_at is not None:
        raise HTTPException(status_code=409, detail="Account is already suspended")
    c.suspended_at = datetime.now(timezone.utc)
    c.suspended_reason = body.reason
    c.suspended_by = admin.id
    c.session_version = int(c.session_version or 0) + 1  # kill live sessions too
    c.sessions_revoked_at = c.suspended_at
    db.commit()
    invalidate_fast_cache(user_id)
    audit(db, admin, request, "user.suspend", "user", user_id, body.reason)
    return {"ok": True, "suspended_at": c.suspended_at.isoformat()}


@router.post("/users/{user_id}/unsuspend")
def unsuspend(user_id: int, body: ReasonBody, request: Request, admin: User = Depends(require_admin_console),
              db: Session = Depends(get_db)):
    from app.services.account_controls import get_or_create_controls, invalidate_fast_cache
    _user_or_404(db, user_id)
    c = get_or_create_controls(db, user_id)
    if c.suspended_at is None:
        raise HTTPException(status_code=409, detail="Account is not suspended")
    c.suspended_at, c.suspended_reason, c.suspended_by = None, None, None
    db.commit()
    invalidate_fast_cache(user_id)
    audit(db, admin, request, "user.unsuspend", "user", user_id, body.reason)
    return {"ok": True}


class QuotaBody(ReasonBody):
    reset_today: bool = False
    clear_override: bool = False
    req_per_day: Optional[int] = Field(None, ge=-1, le=1_000_000)
    tokens_per_day: Optional[int] = Field(None, ge=-1, le=1_000_000_000)
    images_per_day: Optional[int] = Field(None, ge=-1, le=100_000)
    tts_chars_per_day: Optional[int] = Field(None, ge=-1, le=10_000_000)


@router.post("/users/{user_id}/ai-quota")
def adjust_quota(user_id: int, body: QuotaBody, request: Request, admin: User = Depends(require_admin_console),
                 db: Session = Depends(get_db)):
    from app.services import ai_guard
    from app.services.account_controls import get_or_create_controls
    _user_or_404(db, user_id)
    fields = {k: getattr(body, k) for k in ("req_per_day", "tokens_per_day", "images_per_day", "tts_chars_per_day")
              if getattr(body, k) is not None}
    if not (body.reset_today or body.clear_override or fields):
        raise HTTPException(status_code=400, detail="Nothing to change")
    c = get_or_create_controls(db, user_id)
    before = dict(c.ai_quota_override or {})
    if body.clear_override:
        c.ai_quota_override = None
    elif fields:
        c.ai_quota_override = {**before, **fields}
    db.commit()
    cleared = None
    if body.reset_today:
        try:
            cleared = ai_guard.reset_user_counters(user_id)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"Usage counters unavailable ({type(exc).__name__})")
    audit(db, admin, request, "user.ai_quota", "user", user_id, body.reason,
          {"before": before, "after": c.ai_quota_override, "reset_today": body.reset_today, "cleared": cleared})
    return {"ok": True, "ai_quota_override": c.ai_quota_override, "cleared": cleared}


class PlanBody(ReasonBody):
    plan: Literal["free", "pro", "default"]


@router.post("/users/{user_id}/plan")
def change_plan(user_id: int, body: PlanBody, request: Request, admin: User = Depends(require_admin_console),
                db: Session = Depends(get_db)):
    from app.services.account_controls import get_or_create_controls
    target = _user_or_404(db, user_id)
    if is_admin_user(target):
        raise HTTPException(status_code=400, detail="Admin accounts are always on the top tier")
    c = get_or_create_controls(db, user_id)
    before = c.plan_override
    c.plan_override = None if body.plan == "default" else body.plan
    db.commit()
    audit(db, admin, request, "user.plan", "user", user_id, body.reason, {"before": before, "after": c.plan_override})
    return {"ok": True, "plan_override": c.plan_override}


@router.post("/users/{user_id}/conversations/{conversation_id}/view")
def view_conversation(user_id: int, conversation_id: str, body: ReasonBody, request: Request,
                      admin: User = Depends(require_admin_console), db: Session = Depends(get_db)):
    """Explicit, audited access to one transcript (never shown by default)."""
    from app.models.chat_history import ChatHistory, Conversation
    conv = db.query(Conversation).filter(Conversation.id == conversation_id, Conversation.user_id == user_id).first()
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = (db.query(ChatHistory).filter(ChatHistory.conversation_id == conversation_id)
            .order_by(ChatHistory.created_at.asc()).limit(500).all())
    audit(db, admin, request, "conversation.view", "conversation", conversation_id, body.reason,
          {"user_id": user_id, "messages": len(msgs)})
    return {"id": conv.id, "title": conv.title,
            "messages": [{"role": m.role, "content": m.content, "symbol": m.symbol,
                          "created_at": m.created_at.isoformat() if m.created_at else None} for m in msgs]}


# ── Analytics pages ──────────────────────────────────────────────────────────

@router.get("/ai")
def ai_observability(range: RangeKey = "7d", db: Session = Depends(get_db)):
    w = svc.window(range)
    return {"window": w.meta(), "usage": svc.ai_usage_block(db, w), "copilot": svc.copilot_block(db, w)}


@router.get("/revenue")
def revenue(range: RangeKey = "30d", db: Session = Depends(get_db)):
    w = svc.window(range)
    from app.models.billing import Subscription
    from app.services.billing_service import plan_label_for_price_id, subscription_entitled

    def subs():
        rows = db.query(Subscription, User.username).join(User, User.id == Subscription.user_id) \
            .order_by(Subscription.updated_at.desc()).limit(200).all()
        return [{"user_id": s.user_id, "username": n, "status": s.status, "plan": plan_label_for_price_id(s.price_id),
                 "entitled": subscription_entitled(s), "cancel_at_period_end": s.cancel_at_period_end,
                 "current_period_end": s.current_period_end.isoformat() if s.current_period_end else None,
                 "updated_at": s.updated_at.isoformat() if s.updated_at else None} for s, n in rows]

    return {"window": w.meta(), "summary": svc.revenue_block(db, w), "subscriptions": svc._safe(db, subs, []),
            "signups": svc.signup_series(db, w)}


@router.get("/product")
def product(range: RangeKey = "7d", db: Session = Depends(get_db)):
    w = svc.window(range)
    return {"window": w.meta(), **svc.product_block(db, w)}


@router.get("/health")
def health(range: RangeKey = "24h", db: Session = Depends(get_db)):
    w = svc.window(range)
    return {"window": w.meta(), **svc.health_block(db, w)}


@router.get("/activity")
def activity(range: RangeKey = "7d", db: Session = Depends(get_db)):
    w = svc.window(range)
    return {"window": w.meta(), "items": svc.ops_feed(db, w.start, 100)}


# ── Data intelligence (read-only) ────────────────────────────────────────────

@router.get("/data/tables")
def data_tables(request: Request, admin: User = Depends(require_admin_console), db: Session = Depends(get_db)):
    from app.services.admin_db_explorer import explorer_engine, list_tables
    tables = list_tables(explorer_engine(db.get_bind()))
    audit(db, admin, request, "db.list_tables", "db", None, None, {"tables": len(tables)})
    return {"tables": tables}


@router.get("/data/tables/{table}")
def data_table(table: str, request: Request, page: int = Query(1, ge=1, le=100_000),
               page_size: int = Query(25, ge=1, le=100), sort: Optional[str] = Query(None, max_length=128),
               order: Literal["asc", "desc"] = "asc", filter_col: Optional[str] = Query(None, max_length=128),
               filter_val: Optional[str] = Query(None, max_length=200),
               admin: User = Depends(require_admin_console), db: Session = Depends(get_db)):
    from app.services.admin_db_explorer import ExplorerError, browse, explorer_engine
    try:
        out = browse(explorer_engine(db.get_bind()), table, page=page, page_size=page_size, sort=sort, order=order,
                     filter_col=filter_col, filter_val=filter_val)
    except ExplorerError as e:
        raise HTTPException(status_code=400 if str(e) != "Unknown table" else 404, detail=str(e))
    audit(db, admin, request, "db.view_table", "table", table, None,
          {"page": page, "page_size": page_size, "sort": sort, "order": order, "filter_col": filter_col,
           "filtered": bool(filter_val)})
    return out


@router.get("/data/freshness")
def data_freshness(db: Session = Depends(get_db)):
    from app.services.admin_db_explorer import explorer_engine
    return {"datasets": svc.freshness(explorer_engine(db.get_bind()))}


# ── Security & audit ─────────────────────────────────────────────────────────

@router.get("/audit")
def audit_log(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
              action: Optional[str] = Query(None, max_length=64), target_id: Optional[str] = Query(None, max_length=128),
              db: Session = Depends(get_db)):
    q = db.query(AdminAuditLog)
    if action:
        q = q.filter(AdminAuditLog.action == action)
    if target_id:
        q = q.filter(AdminAuditLog.target_id == target_id)
    total = q.count()
    rows = q.order_by(AdminAuditLog.ts.desc(), AdminAuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    actors = dict(db.query(User.id, User.username).filter(User.id.in_({r.actor_user_id for r in rows} or {-1})).all())
    actions = [a for (a,) in db.query(AdminAuditLog.action).distinct().all()]
    return {"total": total, "page": page, "page_size": page_size, "actions": sorted(actions), "rows": [
        {"id": r.id, "ts": r.ts.isoformat() if r.ts else None, "actor_user_id": r.actor_user_id,
         "actor": actors.get(r.actor_user_id), "action": r.action, "target_type": r.target_type,
         "target_id": r.target_id, "reason": r.reason, "ip": r.ip, "details": r.details} for r in rows]}


@router.get("/security")
def security(range: RangeKey = "7d", db: Session = Depends(get_db)):
    w = svc.window(range)

    def logins():
        rows = db.query(UserLoginEvent, User.username).join(User, User.id == UserLoginEvent.user_id) \
            .filter(UserLoginEvent.ts >= w.start).order_by(UserLoginEvent.ts.desc()).limit(100).all()
        return [{"ts": e.ts.isoformat() if e.ts else None, "user_id": e.user_id, "username": n, "method": e.method,
                 "success": e.success, "note": e.note, "ip": e.ip, "user_agent": e.user_agent} for e, n in rows]

    def suspended():
        rows = db.query(UserAccountControl, User.username).join(User, User.id == UserAccountControl.user_id) \
            .filter(UserAccountControl.suspended_at.isnot(None)).all()
        return [{"user_id": c.user_id, "username": n, "suspended_at": c.suspended_at.isoformat(),
                 "reason": c.suspended_reason} for c, n in rows]

    def by_method():
        return {m: int(n) for m, n in db.query(UserLoginEvent.method, func.count(UserLoginEvent.id))
                .filter(UserLoginEvent.ts >= w.start, UserLoginEvent.success.is_(True))
                .group_by(UserLoginEvent.method).all()}

    blocked = svc._safe(db, lambda: db.query(func.count(UserLoginEvent.id)).filter(
        UserLoginEvent.ts >= w.start, UserLoginEvent.success.is_(False)).scalar(), None)
    actions = svc._safe(db, lambda: db.query(func.count(AdminAuditLog.id)).filter(AdminAuditLog.ts >= w.start).scalar(), None)
    revoked = svc._safe(db, lambda: db.query(func.count(UserAccountControl.user_id)).filter(
        UserAccountControl.sessions_revoked_at >= w.start).scalar(), None)
    return {"window": w.meta(), "logins": svc._safe(db, logins, []), "suspended": svc._safe(db, suspended, []),
            "sign_ins_by_method": svc._safe(db, by_method, {}), "blocked_sign_ins": blocked,
            "admin_actions": actions, "sessions_revoked": revoked}


class ExportBody(BaseModel):
    page: str = Field(..., max_length=64)
    format: Literal["csv", "json"]
    range: Optional[str] = Field(None, max_length=8)


@router.post("/export-log")
def export_log(body: ExportBody, request: Request, admin: User = Depends(require_admin_console),
               db: Session = Depends(get_db)):
    """The page builds the export from data it already loaded; this records it."""
    audit(db, admin, request, "export", "page", body.page, None, {"format": body.format, "range": body.range})
    return {"ok": True}


# ── Traffic (GA4 + Search Console) ───────────────────────────────────────────

@router.get("/traffic/status")
def traffic_status():
    from app.services.admin_traffic import config_status
    return config_status()


def _traffic(fn, *args):
    from app.services.admin_traffic import TrafficError
    try:
        return fn(*args)
    except TrafficError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:  # noqa: BLE001  never echo credentials / tracebacks
        logger.warning("traffic API failed: %s", type(e).__name__)
        raise HTTPException(status_code=502, detail=f"Google API request failed ({type(e).__name__})")


@router.get("/traffic/ga4")
def traffic_ga4(range: RangeKey = "30d"):
    from app.services import admin_traffic as t
    if not t.config_status()["ga4_configured"]:
        raise HTTPException(status_code=409, detail="GA4 is not configured")
    return _traffic(t.ga4_overview, range)


@router.get("/traffic/realtime")
def traffic_realtime():
    from app.services import admin_traffic as t
    if not t.config_status()["ga4_configured"]:
        raise HTTPException(status_code=409, detail="GA4 is not configured")
    return _traffic(t.ga4_realtime)


@router.get("/traffic/gsc")
def traffic_gsc(range: RangeKey = "30d"):
    from app.services import admin_traffic as t
    if not t.config_status()["gsc_configured"]:
        raise HTTPException(status_code=409, detail="Search Console is not configured")
    return _traffic(t.gsc_overview, range)
