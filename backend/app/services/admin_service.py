"""
Read-side analytics for the admin console. Every number comes from the
database, Redis (ai_guard counters), the in-process collectors or Stripe;
nothing is synthesised. A metric whose source is missing returns
``{"value": None, "reason": "..."}`` and the UI shows "—" with the reason.

Every block is computed by ``_safe`` so one missing table (fresh deploy,
SQLite tests) degrades that block only.
"""
from __future__ import annotations

import logging
import os
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.user import User

logger = logging.getLogger(__name__)

RANGES = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30), "90d": timedelta(days=90)}
PLAN_LABELS = {"free": "Free", "pro": "Pro", "admin": "Admin (top tier)"}


# ── Range / bucketing ────────────────────────────────────────────────────────

@dataclass
class Window:
    key: str
    start: datetime
    end: datetime
    prior_start: datetime
    hourly: bool

    @property
    def span(self) -> timedelta:
        return self.end - self.start

    def buckets(self) -> List[str]:
        out = []
        if self.hourly:
            t = self.start.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            while t <= self.end + timedelta(seconds=1):
                out.append(t.strftime("%Y-%m-%dT%H"))
                t += timedelta(hours=1)
            return out[-24:]
        d = self.start.date() + timedelta(days=1)
        while d <= self.end.date():
            out.append(d.isoformat())
            d += timedelta(days=1)
        return out

    def meta(self) -> Dict[str, Any]:
        return {"range": self.key, "start": self.start.isoformat(), "end": self.end.isoformat(),
                "prior_start": self.prior_start.isoformat(), "bucket": "hour" if self.hourly else "day"}


def window(range_key: str, now: Optional[datetime] = None) -> Window:
    key = range_key if range_key in RANGES else "7d"
    end = now or datetime.now(timezone.utc)
    span = RANGES[key]
    start = end - span
    return Window(key=key, start=start, end=end, prior_start=start - span, hourly=key == "24h")


def _naive(dt: datetime) -> datetime:
    """users.created_at / last_login are naive UTC columns."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _bucket_expr(db: Session, col, hourly: bool):
    if db.get_bind().dialect.name == "postgresql":
        return func.to_char(col, 'YYYY-MM-DD"T"HH24' if hourly else "YYYY-MM-DD")
    return func.strftime("%Y-%m-%dT%H" if hourly else "%Y-%m-%d", col)


def _safe(db: Session, fn: Callable[[], Any], default: Any = None) -> Any:
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.info("admin metric unavailable: %s", type(exc).__name__)
        if isinstance(default, dict):
            return {**default, "reason": default.get("reason") or f"unavailable ({type(exc).__name__})"}
        return default


def _delta(cur: Optional[float], prior: Optional[float]) -> Optional[float]:
    if cur is None or prior is None:
        return None
    if prior == 0:
        return None if cur == 0 else 100.0
    return round((cur - prior) / prior * 100, 1)


def kpi(value: Any, prior: Any = None, series: Optional[List[Any]] = None, reason: Optional[str] = None,
        unit: Optional[str] = None, note: Optional[str] = None) -> Dict[str, Any]:
    return {"value": value, "prior": prior, "delta_pct": _delta(value, prior) if isinstance(value, (int, float))
            and isinstance(prior, (int, float)) else None, "series": series or [], "reason": reason,
            "unit": unit, "note": note}


def pct(vals: Sequence[float], q: float) -> Optional[int]:
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, int(round(q * (len(vals) - 1)))))
    return int(vals[k])


def mask_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    head = local[:1]
    dparts = domain.split(".")
    dmask = (dparts[0][:1] + "•••") + ("." + ".".join(dparts[1:]) if len(dparts) > 1 else "")
    return f"{head}•••@{dmask}"


# ── Entitlements ─────────────────────────────────────────────────────────────

def controls_map(db: Session, user_ids: Iterable[int]) -> Dict[int, Any]:
    from app.models.admin import UserAccountControl
    ids = list({int(i) for i in user_ids})
    if not ids:
        return {}
    return _safe(db, lambda: {c.user_id: c for c in db.query(UserAccountControl)
                              .filter(UserAccountControl.user_id.in_(ids)).all()}, {}) or {}


def subscriptions_map(db: Session, user_ids: Iterable[int]) -> Dict[int, Any]:
    from app.models.billing import Subscription
    ids = list({int(i) for i in user_ids})
    if not ids:
        return {}
    return _safe(db, lambda: {s.user_id: s for s in db.query(Subscription)
                              .filter(Subscription.user_id.in_(ids)).all()}, {}) or {}


def tier_for(user: User, sub: Any, controls: Any) -> str:
    from app.api.auth import is_admin_user
    from app.services.billing_service import subscription_entitled
    if is_admin_user(user):
        return "admin"
    override = getattr(controls, "plan_override", None)
    if override in ("free", "pro"):
        return override
    return "pro" if subscription_entitled(sub) else "free"


def account_status(user: User, controls: Any) -> str:
    if controls is not None and controls.suspended_at is not None:
        return "suspended"
    if not user.is_verified:
        return "unverified"
    return "active"


# ── Activity ─────────────────────────────────────────────────────────────────

def activity_pairs(db: Session, since: datetime) -> List[Tuple[int, str]]:
    """(user_id, YYYY-MM-DD) for every day a user was seen since ``since``:
    authenticated API calls (user_activity_days), AI usage, sign-ins."""
    from app.models.admin import UserActivityDay, UserLoginEvent
    from app.models.ai_usage import AIUsageEvent as E
    pairs: set = set()
    day0 = since.date().isoformat()
    rows = _safe(db, lambda: db.query(UserActivityDay.user_id, UserActivityDay.day)
                 .filter(UserActivityDay.day >= day0).all(), []) or []
    pairs.update((int(u), str(d)) for u, d in rows)
    d_e = _bucket_expr(db, E.ts, False)
    rows = _safe(db, lambda: db.query(E.user_id, d_e).filter(E.ts >= since, E.user_id.isnot(None))
                 .group_by(E.user_id, d_e).all(), []) or []
    pairs.update((int(u), str(d)) for u, d in rows if d)
    d_l = _bucket_expr(db, UserLoginEvent.ts, False)
    rows = _safe(db, lambda: db.query(UserLoginEvent.user_id, d_l).filter(UserLoginEvent.ts >= since,
                 UserLoginEvent.success.is_(True)).group_by(UserLoginEvent.user_id, d_l).all(), []) or []
    pairs.update((int(u), str(d)) for u, d in rows if d)
    rows = _safe(db, lambda: db.query(User.id, User.last_login).filter(User.last_login >= _naive(since)).all(), []) or []
    pairs.update((int(u), ll.date().isoformat()) for u, ll in rows if ll)
    return sorted(pairs)


def engagement(db: Session, w: Window) -> Dict[str, Any]:
    """DAU / WAU / MAU and returning users per day of the range."""
    first_day = (w.start - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
    pairs = activity_pairs(db, first_day)
    by_day: Dict[str, set] = defaultdict(set)
    for u, d in pairs:
        by_day[d].add(u)
    created = dict(_safe(db, lambda: db.query(User.id, User.created_at).all(), []) or [])
    days: List[date] = []
    d = (w.start.date() if w.key != "24h" else w.end.date() - timedelta(days=6))
    while d <= w.end.date():
        days.append(d)
        d += timedelta(days=1)
    series = []
    for day in days:
        ds = day.isoformat()
        dau = by_day.get(ds, set())

        def window_users(n: int) -> set:
            out: set = set()
            for i in range(n):
                out |= by_day.get((day - timedelta(days=i)).isoformat(), set())
            return out

        returning = {u for u in dau if created.get(u) and created[u].date() < day}
        series.append({"day": ds, "dau": len(dau), "wau": len(window_users(7)), "mau": len(window_users(30)),
                       "returning": len(returning)})
    return {"series": series, "sources": ["user_activity_days", "ai_usage_events", "user_login_events",
                                          "users.last_login"]}


def _active_between(pairs: List[Tuple[int, str]], start: date, end: date) -> set:
    s, e = start.isoformat(), end.isoformat()
    return {u for u, d in pairs if s <= d <= e}


def user_kpis(db: Session, w: Window) -> Dict[str, Any]:
    pairs = activity_pairs(db, w.prior_start - timedelta(days=30))
    today = w.end.date()
    by_day: Dict[str, set] = defaultdict(set)
    for u, d in pairs:
        by_day[d].add(u)

    def avg_dau(start: datetime, end: datetime) -> Optional[float]:
        days, d = [], start.date() + timedelta(days=1) if w.key != "24h" else end.date()
        while d <= end.date():
            days.append(len(by_day.get(d.isoformat(), set())))
            d += timedelta(days=1)
        return round(sum(days) / len(days), 1) if days else None

    dau_series = [len(by_day.get((today - timedelta(days=i)).isoformat(), set())) for i in range(13, -1, -1)]
    dau_now = avg_dau(w.start, w.end)
    dau_prior = avg_dau(w.prior_start, w.start)
    a7 = len(_active_between(pairs, today - timedelta(days=6), today))
    a7p = len(_active_between(pairs, today - timedelta(days=13), today - timedelta(days=7)))
    a30 = len(_active_between(pairs, today - timedelta(days=29), today))
    a30p = len(_active_between(pairs, today - timedelta(days=59), today - timedelta(days=30)))
    new_now = _safe(db, lambda: db.query(func.count(User.id)).filter(User.created_at >= _naive(w.start)).scalar(), None)
    new_prior = _safe(db, lambda: db.query(func.count(User.id)).filter(User.created_at >= _naive(w.prior_start),
                                                                       User.created_at < _naive(w.start)).scalar(), None)
    # Day-7 retention: users who signed up 7-37 days ago and were active 7+ days after signup.
    retention = _safe(db, lambda: _day7_retention(db, pairs, today), {"value": None})
    dau_today = len(by_day.get(today.isoformat(), set()))
    return {
        "dau": kpi(dau_now, dau_prior, dau_series, note="average daily active users in the range"),
        "active_7d": kpi(a7, a7p),
        "active_30d": kpi(a30, a30p),
        "new_registrations": kpi(new_now, new_prior, signup_series(db, w)),
        "day7_retention": retention,
        "dau_mau": kpi(round(dau_today / a30, 3) if a30 else None, None,
                       reason=None if a30 else "no active users in the last 30 days", unit="ratio"),
    }


def _day7_retention(db: Session, pairs: List[Tuple[int, str]], today: date) -> Dict[str, Any]:
    lo, hi = today - timedelta(days=37), today - timedelta(days=7)
    cohort = db.query(User.id, User.created_at).filter(User.created_at >= datetime.combine(lo, datetime.min.time()),
                                                        User.created_at < datetime.combine(hi, datetime.min.time())).all()
    if not cohort:
        return kpi(None, reason="no signups 7-37 days ago", unit="ratio")
    days_by_user: Dict[int, List[str]] = defaultdict(list)
    for u, d in pairs:
        days_by_user[u].append(d)
    kept = sum(1 for u, c in cohort if any(d >= (c.date() + timedelta(days=7)).isoformat() for d in days_by_user.get(u, [])))
    return kpi(round(kept / len(cohort), 3), unit="ratio", note=f"cohort of {len(cohort)} signups (7-37 days ago)")


def signup_series(db: Session, w: Window) -> List[int]:
    b = _bucket_expr(db, User.created_at, w.hourly)
    rows = dict(_safe(db, lambda: db.query(b, func.count(User.id)).filter(User.created_at >= _naive(w.start))
                      .group_by(b).all(), []) or [])
    return [int(rows.get(k, 0)) for k in w.buckets()]


# ── AI usage ─────────────────────────────────────────────────────────────────

def ai_usage_block(db: Session, w: Window) -> Dict[str, Any]:
    from app.models.ai_usage import AIUsageEvent as E
    from app.services import ai_guard

    def totals(start, end):
        r = db.query(func.count(E.id), func.sum(E.input_tokens), func.sum(E.output_tokens), func.sum(E.cost_usd)) \
            .filter(E.ts >= start, E.ts < end).one()
        errs = db.query(func.count(E.id)).filter(E.ts >= start, E.ts < end, E.status != "ok").scalar()
        return {"calls": int(r[0] or 0), "input_tokens": int(r[1] or 0), "output_tokens": int(r[2] or 0),
                "cost_usd": round(float(r[3] or 0), 4), "errors": int(errs or 0)}

    cur = _safe(db, lambda: totals(w.start, w.end), None)
    prior = _safe(db, lambda: totals(w.prior_start, w.start), None)
    b = _bucket_expr(db, E.ts, w.hourly)
    series_rows = _safe(db, lambda: db.query(b, func.count(E.id), func.sum(E.cost_usd),
                                             func.sum(E.input_tokens + E.output_tokens))
                        .filter(E.ts >= w.start).group_by(b).all(), []) or []
    by_b = {k: (int(n or 0), float(c or 0), int(t or 0)) for k, n, c, t in series_rows}
    buckets = w.buckets()
    by_model = _safe(db, lambda: [
        {"provider": p, "model": m, "calls": int(n or 0), "tokens": int(t or 0), "cost_usd": round(float(c or 0), 4)}
        for p, m, n, t, c in db.query(E.provider, E.model, func.count(E.id), func.sum(E.input_tokens + E.output_tokens),
                                       func.sum(E.cost_usd)).filter(E.ts >= w.start, E.ts < w.end)
        .group_by(E.provider, E.model).order_by(func.count(E.id).desc()).all()], []) or []
    by_feature = _safe(db, lambda: [
        {"feature": f, "calls": int(n or 0), "cost_usd": round(float(c or 0), 4)}
        for f, n, c in db.query(E.feature, func.count(E.id), func.sum(E.cost_usd))
        .filter(E.ts >= w.start, E.ts < w.end).group_by(E.feature).order_by(func.count(E.id).desc()).all()], []) or []
    by_provider: Dict[str, Dict[str, float]] = {}
    for r in by_model:
        p = by_provider.setdefault(r["provider"], {"calls": 0, "cost_usd": 0.0, "tokens": 0})
        p["calls"] += r["calls"]
        p["cost_usd"] = round(p["cost_usd"] + r["cost_usd"], 4)
        p["tokens"] += r["tokens"]
    top_users = _safe(db, lambda: _top_ai_users(db, w), []) or []
    live = _safe(db, ai_guard.global_summary, {"reason": "ai_guard store unavailable"})
    return {
        "totals": cur, "prior": prior,
        "series": [{"bucket": k, "calls": by_b.get(k, (0, 0, 0))[0], "cost_usd": round(by_b.get(k, (0, 0, 0))[1], 4),
                    "tokens": by_b.get(k, (0, 0, 0))[2]} for k in buckets],
        "by_model": by_model, "by_provider": by_provider, "by_feature": by_feature,
        "top_users": top_users, "budgets": live,
    }


def _top_ai_users(db: Session, w: Window, limit: int = 10) -> List[Dict[str, Any]]:
    from app.models.ai_usage import AIUsageEvent as E
    rows = (db.query(E.user_id, func.count(E.id), func.sum(E.input_tokens + E.output_tokens), func.sum(E.cost_usd))
            .filter(E.ts >= w.start, E.user_id.isnot(None)).group_by(E.user_id)
            .order_by(func.sum(E.cost_usd).desc()).limit(limit).all())
    names = dict(db.query(User.id, User.username).filter(User.id.in_([r[0] for r in rows] or [-1])).all())
    return [{"user_id": u, "username": names.get(u), "calls": int(n or 0), "tokens": int(t or 0),
             "cost_usd": round(float(c or 0), 4)} for u, n, t, c in rows]


def per_user_ai(db: Session, user_ids: List[int], since: datetime) -> Dict[int, Dict[str, Any]]:
    from app.models.ai_usage import AIUsageEvent as E
    if not user_ids:
        return {}
    rows = _safe(db, lambda: db.query(E.user_id, func.count(E.id), func.sum(E.input_tokens + E.output_tokens),
                                      func.sum(E.cost_usd), func.max(E.ts))
                 .filter(E.ts >= since, E.user_id.in_(user_ids)).group_by(E.user_id).all(), []) or []
    return {int(u): {"requests": int(n or 0), "tokens": int(t or 0), "cost_usd": round(float(c or 0), 4), "last_ai": m}
            for u, n, t, c, m in rows}


def copilot_block(db: Session, w: Window) -> Dict[str, Any]:
    """Copilot quality / runtime metrics from copilot_request_metrics."""
    from app.models.admin import CopilotRequestMetric as M
    from app.services.copilot.llm_stats import stats

    def compute():
        rows = (db.query(M.ok, M.refusal, M.error, M.total_ms, M.first_token_ms, M.chain_index, M.retrieval_calls,
                         M.retrieval_empty, M.retrieval_ms, M.citations, M.policy_flags, M.model, M.provider)
                .filter(M.ts >= w.start, M.ts < w.end).order_by(M.ts.desc()).limit(50_000).all())
        first = db.query(func.min(M.ts)).scalar()
        n = len(rows)
        if not n:
            return {"instrumented": first is not None, "collecting_since": first.isoformat() if first else None,
                    "requests": 0}
        answered = [r for r in rows if r.ok and not r.refusal]
        retrieval_calls = sum(r.retrieval_calls or 0 for r in rows)
        return {
            "instrumented": True, "collecting_since": first.isoformat() if first else None,
            "requests": n, "failures": sum(1 for r in rows if not r.ok),
            "success_rate": round(sum(1 for r in rows if r.ok) / n, 4),
            "p50_ms": pct([r.total_ms for r in answered], 0.5), "p95_ms": pct([r.total_ms for r in answered], 0.95),
            "first_token_p50_ms": pct([r.first_token_ms for r in answered], 0.5),
            "retrieval_p95_ms": pct([r.retrieval_ms for r in rows if r.retrieval_ms is not None], 0.95),
            "citation_coverage": round(sum(1 for r in answered if (r.citations or 0) > 0) / len(answered), 4)
            if answered else None,
            "retrieval_empty_rate": round(sum(r.retrieval_empty or 0 for r in rows) / retrieval_calls, 4)
            if retrieval_calls else None,
            "fallback_rate": round(sum(1 for r in rows if (r.chain_index or 0) > 0) / n, 4),
            "rate_limit_errors": sum(1 for r in rows if (r.error or "") == "quota"),
            "safety_events": sum(1 for r in rows if r.refusal or (r.policy_flags or 0) > 0),
            "by_model": [{"model": k[1] or "—", "provider": k[0] or "—", "requests": v}
                         for k, v in Counter((r.provider, r.model) for r in rows if r.model).most_common()],
        }

    out = _safe(db, compute, {"instrumented": False, "requests": 0})
    out["live_ring"] = stats.summary()  # last 100 requests in this process
    return out


# ── Revenue ──────────────────────────────────────────────────────────────────

_price_cache: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}


def _price(price_id: str) -> Optional[Dict[str, Any]]:
    """Stripe price (read-only, cached 1 h): {"amount": USD, "interval": "month"|"year"}."""
    hit = _price_cache.get(price_id)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    val = None
    try:
        import stripe  # type: ignore
        if getattr(stripe, "api_key", None):
            p = stripe.Price.retrieve(price_id)
            rec = p.get("recurring") or {}
            if p.get("unit_amount") is not None:
                val = {"amount": p["unit_amount"] / 100.0, "currency": p.get("currency"),
                       "interval": rec.get("interval"), "interval_count": rec.get("interval_count") or 1}
    except Exception as exc:  # noqa: BLE001
        logger.info("stripe price lookup failed: %s", type(exc).__name__)
    _price_cache[price_id] = (time.time(), val)
    return val


def monthly_amount(price: Optional[Dict[str, Any]]) -> Optional[float]:
    if not price:
        return None
    n = price.get("interval_count") or 1
    if price.get("interval") == "year":
        return price["amount"] / (12 * n)
    if price.get("interval") == "month":
        return price["amount"] / n
    if price.get("interval") == "week":
        return price["amount"] * 52 / 12 / n
    return None


def revenue_block(db: Session, w: Window, price_lookup: Callable[[str], Optional[Dict[str, Any]]] = None) -> Dict[str, Any]:
    from app.models.billing import BillingEvent, Subscription
    from app.services.billing_service import plan_label_for_price_id, subscription_entitled
    lookup = price_lookup or _price
    subs = _safe(db, lambda: db.query(Subscription).all(), None)
    total_users = _safe(db, lambda: db.query(func.count(User.id)).scalar(), None)
    if subs is None:
        return {"available": False, "reason": "subscriptions table unavailable"}
    entitled = [s for s in subs if subscription_entitled(s)]
    by_status = Counter(s.status for s in subs)
    by_plan = Counter(plan_label_for_price_id(s.price_id) for s in entitled)
    mrr, mrr_reason, unknown = 0.0, None, 0
    for s in entitled:
        if s.status == "trialing":
            continue
        m = monthly_amount(lookup(s.price_id)) if s.price_id else None
        if m is None:
            unknown += 1
        else:
            mrr += m
    if unknown and unknown == len([s for s in entitled if s.status != "trialing"]):
        mrr, mrr_reason = None, "Stripe price amounts unavailable (Stripe not configured or unreachable)"
    elif unknown:
        mrr_reason = f"{unknown} subscription(s) with unknown price excluded"
    start_n = _naive(w.start)
    churned = [s for s in subs if s.status in ("canceled", "unpaid", "incomplete_expired")
               and s.updated_at is not None and s.updated_at >= start_n]
    paid = len(entitled)
    events = _safe(db, lambda: db.query(func.count(BillingEvent.id)).filter(BillingEvent.created_at >= start_n).scalar(), None)
    return {
        "available": True,
        "mrr_usd": round(mrr, 2) if mrr is not None else None, "mrr_reason": mrr_reason,
        "paid_subscribers": paid,
        "trialing": by_status.get("trialing", 0),
        "free_users": (total_users - paid) if total_users is not None else None,
        "total_users": total_users,
        "paid_share": round(paid / total_users, 4) if total_users else None,
        "churned_in_range": len(churned),
        "churn_rate": round(len(churned) / (paid + len(churned)), 4) if (paid + len(churned)) else None,
        "arpu_usd": round(mrr / total_users, 4) if (mrr is not None and total_users) else None,
        "arppu_usd": round(mrr / paid, 2) if (mrr is not None and paid) else None,
        "by_status": dict(by_status), "by_plan": dict(by_plan),
        "billing_events_in_range": events,
        "cancel_at_period_end": sum(1 for s in entitled if s.cancel_at_period_end),
    }


# ── System health ────────────────────────────────────────────────────────────

def status_snapshot() -> Dict[str, Any]:
    from app.services import system_status as ss
    c = ss.get_collector()
    if c is not None:
        return c.snapshot()
    from app.services.system_probes import default_probes
    services = [{"id": p.id, "name": p.name, "group": p.group, "critical": p.critical, "status": ss.PENDING,
                 "latency_ms": None, "detail": "Status collector is not running in this API process"}
                for p in default_probes()]
    return {"generated_at": ss.iso(time.time()), **ss.aggregate(services), "services": services,
            "collector": {"running": False}}


def availability(db: Session, days: int = 30) -> Dict[str, Any]:
    from app.models.admin import SystemStatusSnapshot as S
    since = datetime.now(timezone.utc) - timedelta(days=days)

    def compute():
        rows = db.query(S.ts, S.overall, S.services).filter(S.ts >= since).order_by(S.ts.asc()).all()
        first = db.query(func.min(S.ts)).scalar()
        per_day: Dict[str, List[str]] = defaultdict(list)
        per_service: Dict[str, List[str]] = defaultdict(list)
        names: Dict[str, str] = {}
        for ts, overall, services in rows:
            per_day[ts.date().isoformat()].append(overall)
            for s in services or []:
                if s.get("status") in ("pending", "not_configured"):
                    continue
                per_service[s.get("id")].append(s.get("status"))
                names[s.get("id")] = s.get("name")
        today = datetime.now(timezone.utc).date()
        bars = []
        for i in range(days - 1, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            vals = per_day.get(d, [])
            bars.append({"day": d, "samples": len(vals),
                         "availability": round(sum(1 for v in vals if v != "down") / len(vals), 4) if vals else None,
                         "worst": ("down" if "down" in vals else "degraded" if "degraded" in vals else "ok") if vals else None})
        all_vals = [v for vs in per_day.values() for v in vs]
        return {
            "collecting_since": first.isoformat() if first else None,
            "samples": len(all_vals),
            # Available = not down (a degraded dependency still serves requests).
            "overall": round(sum(1 for v in all_vals if v != "down") / len(all_vals), 4) if all_vals else None,
            "fully_ok": round(sum(1 for v in all_vals if v == "ok") / len(all_vals), 4) if all_vals else None,
            "days": bars,
            "services": {sid: round(sum(1 for v in vs if v != "down") / len(vs), 4) for sid, vs in per_service.items() if vs},
        }

    return _safe(db, compute, {"collecting_since": None, "samples": 0, "overall": None, "days": [], "services": {}})


def ops_feed(db: Session, since: datetime, limit: int = 30) -> List[Dict[str, Any]]:
    from app.models.admin import AdminAuditLog, OpsEvent
    items: List[Dict[str, Any]] = []
    for e in _safe(db, lambda: db.query(OpsEvent).filter(OpsEvent.ts >= since).order_by(OpsEvent.ts.desc())
                   .limit(limit).all(), []) or []:
        items.append({"ts": e.ts.isoformat() if e.ts else None, "kind": e.kind, "severity": e.severity,
                      "title": e.title})
    for a in _safe(db, lambda: db.query(AdminAuditLog).filter(AdminAuditLog.ts >= since,
                   ~AdminAuditLog.action.in_(["db.view_table", "db.list_tables", "users.reveal_email", "export"]))
                   .order_by(AdminAuditLog.ts.desc()).limit(limit).all(), []) or []:
        items.append({"ts": a.ts.isoformat() if a.ts else None, "kind": "admin_action", "severity": "info",
                      "title": f"Admin action: {a.action} ({a.target_type or ''} {a.target_id or ''})".strip()})
    try:
        from app.models.ml_training import TrainingRun as R
        for r in db.query(R).filter(R.created_at >= since).order_by(R.created_at.desc()).limit(limit).all():
            sev = "critical" if r.status == "failed" else "warning" if r.status == "partial" else "ok" \
                if r.status == "completed" else "info"
            items.append({"ts": (r.ended_at or r.started_at or r.created_at).isoformat(), "kind": "ml_run",
                          "severity": sev, "title": f"ML {r.run_type} run {r.status} "
                          f"({r.success_shards or 0}/{r.total_shards or 0} shards)"})
    except Exception:  # noqa: BLE001
        db.rollback()
    items.sort(key=lambda x: x.get("ts") or "", reverse=True)
    return items[:limit]


def health_block(db: Session, w: Window) -> Dict[str, Any]:
    from app.services.admin_metrics import host_metrics, request_summary
    snap = status_snapshot()
    services = snap.get("services") or []
    avail = availability(db, 30)
    counted = [s for s in services if s.get("status") not in ("pending", "not_configured")]
    incidents = [s for s in counted if s.get("status") in ("degraded", "down")]
    return {
        "overall": snap.get("overall"), "generated_at": snap.get("generated_at"),
        "collector": snap.get("collector"),
        "services": [{"id": s.get("id"), "name": s.get("name"), "group": s.get("group"), "status": s.get("status"),
                      "latency_ms": s.get("latency_ms"), "detail": s.get("detail"), "critical": s.get("critical"),
                      "availability_30d": avail["services"].get(s.get("id"))} for s in services],
        "incidents": len(incidents),
        "availability": avail,
        "api": request_summary(w.span.total_seconds()),
        "host": host_metrics(),
        "activity": ops_feed(db, w.start),
    }


# ── Product analytics ────────────────────────────────────────────────────────

def _count(db: Session, model_path: str, attr: str, col: str, since: Optional[datetime], naive: bool = False,
           where: Optional[Callable[[Any], Any]] = None) -> Optional[int]:
    import importlib
    mod = importlib.import_module(model_path)
    M = getattr(mod, attr)
    c = getattr(M, col)

    def run():
        q = db.query(func.count()).select_from(M)
        if since is not None:
            q = q.filter(c >= (_naive(since) if naive else since))
        if where is not None:
            q = q.filter(where(M))
        return int(q.scalar() or 0)

    return _safe(db, run, None)


PRODUCT_FEATURES = [
    # key, label, module, model, timestamp column, naive datetime column
    ("watchlist_adds", "Watchlist adds", "app.models.watchlist", "Watchlist", "created_at", False),
    ("marketwatch_lists", "Marketwatch lists created", "app.models.marketwatch", "MarketwatchList", "created_at", False),
    ("portfolios", "Portfolios created", "app.models.portfolio", "Portfolio", "created_at", False),
    ("transactions", "Portfolio transactions", "app.models.portfolio", "Transaction", "created_at", False),
    ("price_alerts", "Price alerts created", "app.models.price_alert", "PriceAlert", "created_at", False),
    ("alerts_triggered", "Alerts triggered", "app.models.price_alert", "PriceAlert", "last_triggered_at", False),
    ("conversations", "Copilot conversations", "app.models.chat_history", "Conversation", "created_at", False),
    ("chat_messages", "Copilot messages", "app.models.chat_history", "ChatHistory", "created_at", False),
    ("reports", "Report jobs", "app.models.report_job", "ReportResult", "created_at", False),
    ("posts", "Community posts", "app.models.community", "Post", "created_at", False),
    ("passkeys", "Passkeys registered", "app.models.passkey_credential", "PasskeyCredential", "created_at", True),
]


def product_block(db: Session, w: Window) -> Dict[str, Any]:
    features = []
    for key, label, mod, attr, col, naive in PRODUCT_FEATURES:
        cur = _count(db, mod, attr, col, w.start, naive)
        prior = None
        if cur is not None:
            total_since_prior = _count(db, mod, attr, col, w.prior_start, naive)
            prior = (total_since_prior - cur) if total_since_prior is not None else None
        features.append({"key": key, "label": label, "in_range": cur, "prior": prior,
                         "delta_pct": _delta(cur, prior), "total": _count(db, mod, attr, col, None, naive),
                         "reason": None if cur is not None else "table unavailable"})
    try:
        from app.services.backtesting.jobs import manager
        backtests = manager.stats()
    except Exception as exc:  # noqa: BLE001
        backtests = {"reason": type(exc).__name__}
    ai = ai_usage_block(db, w)
    return {"features": features, "ai_features": ai["by_feature"], "backtests": backtests,
            "active_alerts": _count(db, "app.models.price_alert", "PriceAlert", "created_at", None,
                                    where=lambda M: M.status == "active")}


# ── Users ────────────────────────────────────────────────────────────────────

SORTABLE_USER_COLUMNS = {"id": User.id, "created_at": User.created_at, "last_login": User.last_login,
                         "username": User.username, "email": User.email}


def user_rows(db: Session, users: List[User], since: datetime) -> List[Dict[str, Any]]:
    ids = [u.id for u in users]
    ctrl = controls_map(db, ids)
    subs = subscriptions_map(db, ids)
    ai = per_user_ai(db, ids, since)
    from app.models.admin import UserActivityDay
    last_seen = dict(_safe(db, lambda: db.query(UserActivityDay.user_id, func.max(UserActivityDay.day))
                           .filter(UserActivityDay.user_id.in_(ids or [-1])).group_by(UserActivityDay.user_id).all(), [])
                     or [])
    out = []
    for u in users:
        c, s, a = ctrl.get(u.id), subs.get(u.id), ai.get(u.id, {})
        cands = [x for x in (u.last_login.replace(tzinfo=timezone.utc) if u.last_login else None,
                             a.get("last_ai").replace(tzinfo=timezone.utc) if a.get("last_ai") and a["last_ai"].tzinfo is None
                             else a.get("last_ai"),
                             datetime.fromisoformat(last_seen[u.id]).replace(tzinfo=timezone.utc) if last_seen.get(u.id) else None)
                 if x is not None]
        tier = tier_for(u, s, c)
        out.append({
            "id": u.id, "username": u.username, "email_masked": mask_email(u.email), "full_name": u.full_name,
            "avatar_url": u.avatar_url,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "last_activity": max(cands).isoformat() if cands else None,
            "verified": bool(u.is_verified), "tier": tier, "plan": PLAN_LABELS[tier],
            "subscription_status": s.status if s is not None else None,
            "status": account_status(u, c),
            "ai_requests": a.get("requests", 0), "ai_tokens": a.get("tokens", 0), "ai_cost_usd": a.get("cost_usd", 0.0),
        })
    return out


def list_users(db: Session, w: Window, q: Optional[str], plan: Optional[str], status: Optional[str],
               sort: str, order: str, page: int, page_size: int) -> Dict[str, Any]:
    query = db.query(User)
    if q:
        like = f"%{q.strip().lower()[:100]}%"
        conds = [func.lower(User.username).like(like), func.lower(User.email).like(like),
                 func.lower(func.coalesce(User.full_name, "")).like(like)]
        if q.strip().isdigit():
            conds.append(User.id == int(q.strip()))
        query = query.filter(or_(*conds))
    col = SORTABLE_USER_COLUMNS.get(sort, User.created_at)
    query = query.order_by(col.desc() if order == "desc" else col.asc(), User.id.desc())
    if plan or status:
        # Plan / status depend on Stripe + controls + ADMIN_EMAILS: filter in Python (bounded).
        candidates = query.limit(5000).all()
        rows = user_rows(db, candidates, w.start)
        if plan:
            rows = [r for r in rows if r["tier"] == plan]
        if status:
            rows = [r for r in rows if r["status"] == status]
        total = len(rows)
        rows = rows[(page - 1) * page_size: page * page_size]
    else:
        total = query.count()
        rows = user_rows(db, query.offset((page - 1) * page_size).limit(page_size).all(), w.start)
    return {"total": total, "page": page, "page_size": page_size, "rows": rows}


def recent_users(db: Session, w: Window, limit: int = 10) -> List[Dict[str, Any]]:
    pairs = activity_pairs(db, w.start)
    last: Dict[int, str] = {}
    for u, d in pairs:
        if d > last.get(u, ""):
            last[u] = d
    ids = [u for u, _ in sorted(last.items(), key=lambda kv: kv[1], reverse=True)[:limit * 3]]
    users = db.query(User).filter(User.id.in_(ids or [-1])).all()
    rows = user_rows(db, users, w.start)
    rows.sort(key=lambda r: r["last_activity"] or "", reverse=True)
    return rows[:limit]


def user_detail(db: Session, user: User, w: Window) -> Dict[str, Any]:
    from app.models.admin import UserAccountControl, UserLoginEvent
    from app.services import ai_guard
    row = user_rows(db, [user], w.start)[0]
    c = controls_map(db, [user.id]).get(user.id)
    sub = subscriptions_map(db, [user.id]).get(user.id)
    tier = row["tier"]
    usage_today = _safe(db, lambda: ai_guard.usage_summary(user.id, tier, getattr(c, "ai_quota_override", None)),
                        {"reason": "ai_guard store unavailable"})

    from app.models.ai_usage import AIUsageEvent as E
    d = _bucket_expr(db, E.ts, False)
    history = _safe(db, lambda: [{"day": k, "requests": int(n or 0), "tokens": int(t or 0), "cost_usd": round(float(x or 0), 4)}
                                 for k, n, t, x in db.query(d, func.count(E.id), func.sum(E.input_tokens + E.output_tokens),
                                                            func.sum(E.cost_usd)).filter(E.user_id == user.id,
                                                            E.ts >= datetime.now(timezone.utc) - timedelta(days=30))
                                 .group_by(d).order_by(d).all()], []) or []

    def watchlists():
        from app.models.symbol import Symbol
        from app.models.watchlist import Watchlist
        return [{"symbol": s, "added_at": a.isoformat() if a else None}
                for s, a in db.query(Symbol.symbol, Watchlist.created_at).join(Symbol, Symbol.id == Watchlist.symbol_id)
                .filter(Watchlist.user_id == user.id).order_by(Watchlist.created_at.desc()).limit(200).all()]

    def marketwatch():
        from app.models.marketwatch import MarketwatchItem, MarketwatchList
        lists = db.query(MarketwatchList).filter(MarketwatchList.user_id == user.id).order_by(MarketwatchList.position).all()
        items = defaultdict(list)
        for it in db.query(MarketwatchItem).filter(MarketwatchItem.list_id.in_([l.id for l in lists] or [-1])) \
                .order_by(MarketwatchItem.position).all():
            items[it.list_id].append(it.symbol)
        return [{"id": l.id, "name": l.name, "is_default": l.is_default, "symbols": items.get(l.id, [])} for l in lists]

    def portfolios():
        from app.models.portfolio import Portfolio, Position
        from app.models.symbol import Symbol
        out = []
        for p in db.query(Portfolio).filter(Portfolio.user_id == user.id).all():
            pos = db.query(Symbol.symbol, Position.quantity, Position.avg_cost_basis, Position.market_value) \
                .join(Symbol, Symbol.id == Position.symbol_id).filter(Position.portfolio_id == p.id).all()
            out.append({"id": p.id, "name": p.name, "paper": bool(p.is_paper_trading), "cash": p.cash_balance,
                        "holdings": [{"symbol": s, "quantity": q, "avg_cost": a, "market_value": m} for s, q, a, m in pos]})
        return out

    def alerts():
        from app.models.price_alert import PriceAlert
        return [{"id": a.id, "symbol": a.symbol, "condition": a.condition, "threshold": a.threshold, "status": a.status,
                 "trigger_count": a.trigger_count,
                 "last_triggered_at": a.last_triggered_at.isoformat() if a.last_triggered_at else None}
                for a in db.query(PriceAlert).filter(PriceAlert.user_id == user.id).order_by(PriceAlert.created_at.desc())
                .limit(200).all()]

    def conversations():
        from app.models.chat_history import ChatHistory, Conversation
        counts = dict(db.query(ChatHistory.conversation_id, func.count(ChatHistory.id))
                      .filter(ChatHistory.user_id == user.id).group_by(ChatHistory.conversation_id).all())
        convs = db.query(Conversation).filter(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).all()
        return {"count": len(convs), "items": [
            {"id": c.id, "title": c.title, "messages": int(counts.get(c.id, 0)),
             "created_at": c.created_at.isoformat() if c.created_at else None,
             "updated_at": c.updated_at.isoformat() if c.updated_at else None} for c in convs[:100]]}

    def logins():
        return [{"ts": e.ts.isoformat() if e.ts else None, "method": e.method, "success": e.success, "note": e.note,
                 "ip": e.ip, "user_agent": e.user_agent}
                for e in db.query(UserLoginEvent).filter(UserLoginEvent.user_id == user.id)
                .order_by(UserLoginEvent.ts.desc()).limit(50).all()]

    def passkeys():
        from app.models.passkey_credential import PasskeyCredential
        return [{"device_name": p.device_name, "created_at": p.created_at.isoformat() if p.created_at else None}
                for p in db.query(PasskeyCredential).filter(PasskeyCredential.user_id == user.id).all()]

    def backtests():
        from app.services.backtesting.jobs import manager
        return manager.jobs_for_owner(str(user.id)) if hasattr(manager, "jobs_for_owner") else []

    login_rows = _safe(db, logins, []) or []
    revoked_at = getattr(c, "sessions_revoked_at", None)
    token_days = 7
    cutoff = datetime.now(timezone.utc) - timedelta(days=token_days)
    sessions = []
    for e in login_rows:
        if not e["success"] or not e["ts"]:
            continue
        ts = datetime.fromisoformat(e["ts"])
        ts = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        rv = revoked_at if (revoked_at is None or revoked_at.tzinfo) else revoked_at.replace(tzinfo=timezone.utc)
        if ts >= cutoff and (rv is None or ts > rv):
            sessions.append({**e, "expires_at": (ts + timedelta(days=token_days)).isoformat()})

    return {
        "user": {**row, "is_verified": bool(user.is_verified),
                 "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
                 "auth_methods": [m for m, ok in (("password", bool(user.hashed_password)), ("google", bool(user.google_id))) if ok]},
        "subscription": {"status": sub.status, "plan_label": _plan_label(sub),
                         "current_period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
                         "cancel_at_period_end": bool(sub.cancel_at_period_end)} if sub is not None else None,
        "controls": {
            "suspended_at": c.suspended_at.isoformat() if c and c.suspended_at else None,
            "suspended_reason": c.suspended_reason if c else None,
            "session_version": int(c.session_version or 0) if c else 0,
            "sessions_revoked_at": revoked_at.isoformat() if revoked_at else None,
            "plan_override": c.plan_override if c else None,
            "ai_quota_override": c.ai_quota_override if c else None,
        },
        "access_scope": _access_scope(tier),
        "ai": {"today": usage_today, "history_30d": history, "range": per_user_ai(db, [user.id], w.start).get(user.id,
               {"requests": 0, "tokens": 0, "cost_usd": 0.0})},
        "watchlist": _safe(db, watchlists, []),
        "marketwatch": _safe(db, marketwatch, []),
        "portfolios": _safe(db, portfolios, []),
        "alerts": _safe(db, alerts, []),
        "backtests": _safe(db, backtests, []),
        "conversations": _safe(db, conversations, {"count": None, "items": []}),
        "logins": login_rows,
        "sessions": {"active_estimate": sessions, "token_lifetime_days": token_days,
                     "note": "Sessions are stateless 7-day JWTs; this lists sign-ins within the token lifetime "
                             "that were not revoked."},
        "passkeys": _safe(db, passkeys, []),
    }


def _plan_label(sub: Any) -> Optional[str]:
    if sub is None:
        return None
    from app.services.billing_service import plan_label_for_price_id
    return plan_label_for_price_id(sub.price_id)


def _access_scope(tier: str) -> Dict[str, Any]:
    from app.services import ai_guard
    lim = ai_guard.tier_limits(tier)
    return {"tier": tier, "label": PLAN_LABELS.get(tier, tier),
            "ai_limits": lim, "unlimited_ai": all(v < 0 for v in lim.values()),
            "beta_features": tier == "admin", "premium_features": tier in ("pro", "admin")}


# ── Data freshness ───────────────────────────────────────────────────────────

FRESHNESS_TABLES = ["price_bars", "realtime_quotes", "quote_snapshots", "news_items", "news_articles", "filings",
                    "fundamentals", "financial_statements", "screener_snapshots", "symbols", "symbols_master",
                    "model_index_snapshots", "training_runs", "global_events", "ai_usage_events",
                    "system_status_snapshots", "user_activity_days"]
FRESHNESS_COLUMNS = ["updated_at", "timestamp", "ts", "fetched_at", "published_at", "as_of", "snapshot_date",
                     "created_at", "first_seen", "day"]


def freshness(engine) -> List[Dict[str, Any]]:
    from sqlalchemy import MetaData, Table, inspect as sa_inspect, select
    from app.services.admin_db_explorer import read_only
    out = []
    with read_only(engine) as conn:
        names = set(sa_inspect(conn).get_table_names())
        for t in FRESHNESS_TABLES:
            if t not in names:
                continue
            cols = {c["name"] for c in sa_inspect(conn).get_columns(t)}
            col = next((c for c in FRESHNESS_COLUMNS if c in cols), None)
            if not col:
                continue
            try:
                tbl = Table(t, MetaData(), autoload_with=conn)
                v = conn.execute(select(func.max(tbl.c[col]))).scalar()
            except Exception as exc:  # noqa: BLE001
                out.append({"table": t, "column": col, "latest": None, "reason": type(exc).__name__})
                continue
            out.append({"table": t, "column": col, "latest": v.isoformat() if hasattr(v, "isoformat") else v})
    return out


def env_label() -> Dict[str, str]:
    env = (os.getenv("APP_ENV") or "").lower()
    label = {"production": "Production", "prod": "Production", "staging": "Staging", "development": "Development",
             "dev": "Development", "local": "Development", "test": "Test"}.get(env, env.title() or "Production")
    return {"app_env": env or "production", "label": label, "version": os.getenv("GIT_SHA", "unknown")}
