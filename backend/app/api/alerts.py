"""
Price / indicator alerts API. Auth required; users only see their own alerts
(another user's id returns 404).

  GET    /api/v1/alerts               list (+ current price per symbol)
  GET    /api/v1/alerts/conditions    supported conditions and threshold bounds
  GET    /api/v1/alerts/suggestions   ranked one-click alert ideas (auth optional: signed-out
                                      viewers get market-only ones). See app.services.alert_suggestions
  POST   /api/v1/alerts               create {symbol, condition, threshold, repeat?, notify_email?, note?}
                                      condition "earnings_within_days": threshold = whole days (1-30);
                                      fires once per earnings report
  PATCH  /api/v1/alerts/{id}          edit threshold/repeat/notify_email/note, or status active|paused
  DELETE /api/v1/alerts/{id}

Alerts are evaluated by the scheduled job in app.services.price_alert_service.
A trigger creates an in-app notification (/notifications, "Trading" tab) and,
for Pro users with notify_email=true, an email.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.api.auth import get_current_user, require_auth
from app.db.database import get_db
from app.models.price_alert import PriceAlert
from app.models.symbol import Symbol
from app.models.user import User
from app.services import alert_suggestions as sugg
from app.services.price_alert_service import CONDITIONS, quote_metrics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])

MAX_ALERTS_PER_USER = 50
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
ConditionName = Literal[
    "price_above", "price_below", "change_up_pct", "change_down_pct", "rsi_above", "rsi_below",
    "earnings_within_days",
]


def _check_threshold(condition: str, threshold: float) -> None:
    spec = CONDITIONS[condition]
    if not (spec.min_threshold <= threshold <= spec.max_threshold):
        raise ValueError(
            f"threshold for {condition} must be between {spec.min_threshold:g} and {spec.max_threshold:g}"
        )
    if spec.metric == "earnings" and threshold != int(threshold):
        raise ValueError("threshold for earnings_within_days must be a whole number of days")


class AlertCreate(BaseModel):
    symbol: str
    condition: ConditionName
    threshold: float
    repeat: bool = False
    notify_email: bool = False
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("symbol")
    @classmethod
    def _sym(cls, v: str) -> str:
        v = (v or "").strip().upper()
        if not SYMBOL_RE.match(v):
            raise ValueError("invalid symbol")
        return v

    @model_validator(mode="after")
    def _thr(self):
        _check_threshold(self.condition, self.threshold)
        return self


class AlertUpdate(BaseModel):
    threshold: Optional[float] = None
    status: Optional[Literal["active", "paused"]] = None
    repeat: Optional[bool] = None
    notify_email: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=200)


def _owned(db: Session, user: User, alert_id: int) -> PriceAlert:
    a = db.query(PriceAlert).filter(PriceAlert.id == alert_id, PriceAlert.user_id == user.id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Alert not found")
    return a


def _load_quotes(db: Session, symbols: List[str]) -> Dict[str, dict]:
    if not symbols:
        return {}

    async def _fetch():
        from app.services.quote_cache import QuoteCacheService
        return await QuoteCacheService(db).get_quotes(symbols)

    try:
        return anyio.from_thread.run(_fetch)
    except Exception:
        logger.exception("alert quote fetch failed")
        return {}


def _out(a: PriceAlert, quote: Optional[dict] = None, name: Optional[str] = None) -> dict:
    m = quote_metrics(quote) if quote is not None else {"price": None, "change": None}
    return {
        "id": a.id,
        "symbol": a.symbol,
        "name": name,
        "condition": a.condition,
        "condition_label": CONDITIONS[a.condition].label,
        "metric": CONDITIONS[a.condition].metric,
        "threshold": a.threshold,
        "status": a.status,
        "repeat": bool(a.repeat),
        "armed": bool(a.armed),
        "notify_email": bool(a.notify_email),
        "note": a.note,
        "trigger_count": a.trigger_count or 0,
        "last_triggered_at": a.last_triggered_at,
        "last_triggered_value": a.last_triggered_value,
        "last_checked_at": a.last_checked_at,
        "last_value": a.last_value,
        "last_event_key": a.last_event_key,
        "current_price": m["price"],
        "change_percent": m["change"],
        "created_at": a.created_at,
    }


@router.get("/conditions")
def list_conditions():
    return {
        "conditions": [
            {"id": k, "label": v.label, "metric": v.metric, "min": v.min_threshold, "max": v.max_threshold}
            for k, v in CONDITIONS.items()
        ],
        "limit": MAX_ALERTS_PER_USER,
    }


# ── suggestions ──────────────────────────────────────────────────────────────

SUGGEST_MARKET_KEY = "qt:alerts:suggest:market:v1"
SUGGEST_MARKET_TTL = 300   # snapshot rows, bar stats for the universe, earnings window
SUGGEST_USER_TTL = 60      # per-viewer candidates; existing alerts are filtered after the cache
SUGGEST_MAX_USER_SYMBOLS = 25
SUGGEST_USER_EARNINGS_LOOKUPS = 10
EARNINGS_TIMEOUT_S = 8.0


def _run_async(fn, *args, default=None):
    """Call an async helper from this sync route (FastAPI threadpool); never raise."""
    try:
        return anyio.from_thread.run(fn, *args)
    except Exception:
        logger.exception("alert suggestions: %s failed", getattr(fn, "__name__", fn))
        return default


def load_bar_stats(db: Session, symbols: List[str]) -> Dict[str, sugg.BarStats]:
    """52-week high/low (+ bar count), ATR(14) and 20-day high/low from price_bars. Two queries."""
    from sqlalchemy import func

    from app.models.price import PriceBar

    if not symbols:
        return {}
    ids = {sid: sym for sid, sym in db.query(Symbol.id, Symbol.symbol).filter(Symbol.symbol.in_(symbols)).all()}
    if not ids:
        return {}
    now = datetime.now(timezone.utc)
    out: Dict[str, sugg.BarStats] = {}
    agg = (
        db.query(PriceBar.symbol_id, func.max(PriceBar.high), func.min(PriceBar.low), func.count(PriceBar.id))
        .filter(PriceBar.symbol_id.in_(list(ids)), PriceBar.timestamp >= now - timedelta(days=366))
        .group_by(PriceBar.symbol_id)
        .all()
    )
    for sid, hi, lo, n in agg:
        out[ids[sid]] = sugg.BarStats(high_52w=hi, low_52w=lo, bars_52w=int(n or 0))
    recent = (
        db.query(PriceBar.symbol_id, PriceBar.high, PriceBar.low, PriceBar.close)
        .filter(PriceBar.symbol_id.in_(list(ids)), PriceBar.timestamp >= now - timedelta(days=45))
        .order_by(PriceBar.symbol_id, PriceBar.timestamp)
        .all()
    )
    by: Dict[int, List[dict]] = {}
    for sid, h, lo, c in recent:
        by.setdefault(sid, []).append({"high": h, "low": lo, "close": c})
    for sid, bars in by.items():
        st = out.setdefault(ids[sid], sugg.BarStats())
        st.atr14 = sugg.atr(bars)
        last20 = bars[-20:]
        if len(last20) >= 10:
            st.high_20d = max(b["high"] for b in last20)
            st.low_20d = min(b["low"] for b in last20)
    return out


def _holdings(db: Session, user_id: int) -> List[sugg.Holding]:
    """Open positions summed across the user's portfolios, quantity-weighted average cost."""
    from app.models.portfolio import Portfolio, Position

    rows = (
        db.query(Symbol.symbol, Position.quantity, Position.avg_cost_basis)
        .join(Position, Position.symbol_id == Symbol.id)
        .join(Portfolio, Portfolio.id == Position.portfolio_id)
        .filter(Portfolio.user_id == user_id, Position.quantity > 0)
        .all()
    )
    agg: Dict[str, List[float]] = {}
    for sym, qty, cost in rows:
        if not sym:
            continue
        a = agg.setdefault(str(sym).upper(), [0.0, 0.0, 0.0])  # qty, sum(cost*qty), qty that has a cost
        q = float(qty or 0)
        a[0] += q
        if cost and cost > 0:
            a[1] += float(cost) * q
            a[2] += q
    hs = [sugg.Holding(s, a[0], (a[1] / a[2]) if a[2] else None) for s, a in agg.items()]
    hs.sort(key=lambda h: (-(h.quantity * (h.avg_cost or 0)), h.symbol))
    return hs


async def _snapshot_rows() -> List[dict]:
    """Shared S&P 500 market snapshot (cached quote_snapshots; never fans out to providers)."""
    from app.api.market import _snapshot

    snap = await _snapshot()
    return [r.as_dict() for r in snap.rows]


async def _earnings_map(today_iso: str) -> Dict[str, dict]:
    """Next report per symbol from the cached market-wide earnings window."""
    from app.services import earnings_calendar as cal

    today = date.fromisoformat(today_iso)
    window = await asyncio.wait_for(
        cal.fetch_window(today, today + timedelta(days=sugg.EARNINGS_MAX_DAYS), today=today),
        timeout=EARNINGS_TIMEOUT_S,
    )
    events = cal.next_event_map(window["rows"], today)
    return {s: {"date": e["date"], "hour": e.get("hour")} for s, e in events.items()}


async def _next_earnings(sym: str, today_iso: str) -> Optional[dict]:
    from app.services import earnings_calendar as cal

    return await asyncio.wait_for(
        cal.next_earnings(sym, today=date.fromisoformat(today_iso), horizon_days=sugg.EARNINGS_MAX_DAYS),
        timeout=EARNINGS_TIMEOUT_S,
    )


async def _cache_get(key: str):
    from app.services.redis_cache_service import cache_service

    return await cache_service.get(key)


async def _cache_set(key: str, value, ttl: int) -> None:
    from app.services.redis_cache_service import cache_service

    await cache_service.set(key, value, ttl)


def _market_inputs(db: Session, today_iso: str) -> dict:
    """Market-wide inputs shared by every viewer (Redis, SUGGEST_MARKET_TTL)."""
    cached = _run_async(_cache_get, SUGGEST_MARKET_KEY)
    if isinstance(cached, dict) and cached.get("today") == today_iso:
        return cached
    rows = _run_async(_snapshot_rows, default=[]) or []
    stats = load_bar_stats(db, [r["symbol"] for r in rows])
    earnings = _run_async(_earnings_map, today_iso, default={}) or {}
    data = {
        "today": today_iso,
        "rows": rows,
        "stats": {k: vars(v) for k, v in stats.items()},
        "earnings": earnings,
    }
    if rows:
        _run_async(_cache_set, SUGGEST_MARKET_KEY, data, SUGGEST_MARKET_TTL)
    return data


def _user_earnings(symbols: List[str], today_iso: str, known: Dict[str, dict]) -> Dict[str, dict]:
    """Next report for the user's symbols the market window missed (earnings_calendar caches each)."""
    out: Dict[str, dict] = {}
    for s in [s for s in dict.fromkeys(symbols) if s not in known][:SUGGEST_USER_EARNINGS_LOOKUPS]:
        ev = _run_async(_next_earnings, s, today_iso)
        if ev and ev.get("date"):
            out[s] = {"date": ev["date"], "hour": ev.get("hour")}
    return out


def compute_candidates(db: Session, user: Optional[User], today_iso: str) -> List[sugg.Suggestion]:
    from app.services.user_symbols import watchlist_symbols

    market = _market_inputs(db, today_iso)
    rows = market.get("rows") or []
    stats = {k: sugg.BarStats(**v) for k, v in (market.get("stats") or {}).items()}
    quotes = {r["symbol"]: {"price": r.get("price"), "change": r.get("change_percent")} for r in rows}
    earnings = dict(market.get("earnings") or {})
    holdings: List[sugg.Holding] = []
    watch: List[str] = []
    names: Dict[str, str] = {}
    if user is not None:
        holdings = _holdings(db, user.id)[:SUGGEST_MAX_USER_SYMBOLS]
        watch = sorted(watchlist_symbols(db, user.id))[:SUGGEST_MAX_USER_SYMBOLS]
        syms = sorted({h.symbol for h in holdings} | set(watch))
        if syms:
            for s, q in _load_quotes(db, syms).items():
                m = quote_metrics(q)
                if m["price"] is not None:
                    quotes[s.upper()] = m
            stats.update(load_bar_stats(db, syms))
            names = {r.symbol: r.name for r in db.query(Symbol).filter(Symbol.symbol.in_(syms)).all()}
            earnings.update(_user_earnings(syms, today_iso, earnings))
    return sugg.build_candidates(
        holdings=holdings, watchlist=watch, quotes=quotes, stats=stats, market_rows=rows,
        earnings=earnings, today=date.fromisoformat(today_iso), names=names,
    )


@router.get("/suggestions")
def alert_suggestions(
    limit: int = Query(sugg.DEFAULT_LIMIT, ge=1, le=20),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    """Ranked one-click alert ideas. Signed-out viewers get market-only suggestions."""
    from app.services.earnings_calendar import today_et

    today_iso = today_et().isoformat()
    key = f"qt:alerts:suggest:user:{user.id if user else 'anon'}:{today_iso}:v1"
    cached = _run_async(_cache_get, key)
    if isinstance(cached, list):
        cands = sugg.from_cache(cached)
    else:
        cands = compute_candidates(db, user, today_iso)
        _run_async(_cache_set, key, sugg.to_cache(cands), SUGGEST_USER_TTL)
    existing: List[dict] = []
    if user is not None:
        existing = [
            {"symbol": s, "condition": c, "status": st}
            for s, c, st in db.query(PriceAlert.symbol, PriceAlert.condition, PriceAlert.status)
            .filter(PriceAlert.user_id == user.id)
            .all()
        ]
    picked = sugg.finalize(cands, existing, limit)
    return {
        "suggestions": [s.as_dict() for s in picked],
        "signed_in": user is not None,
        "personalized": any(s.source in ("portfolio", "watchlist") for s in picked),
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


@router.get("")
def list_alerts(db: Session = Depends(get_db), user: User = Depends(require_auth)):
    alerts = (
        db.query(PriceAlert)
        .filter(PriceAlert.user_id == user.id)
        .order_by(PriceAlert.created_at.desc(), PriceAlert.id.desc())
        .all()
    )
    syms = sorted({a.symbol for a in alerts})
    quotes = _load_quotes(db, syms)
    names = {s.symbol: s.name for s in db.query(Symbol).filter(Symbol.symbol.in_(syms)).all()} if syms else {}
    return {
        "alerts": [_out(a, quotes.get(a.symbol), names.get(a.symbol)) for a in alerts],
        "limit": MAX_ALERTS_PER_USER,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_alert(body: AlertCreate, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    if db.query(PriceAlert).filter(PriceAlert.user_id == user.id).count() >= MAX_ALERTS_PER_USER:
        raise HTTPException(status_code=409, detail=f"You can have at most {MAX_ALERTS_PER_USER} alerts")
    sym = db.query(Symbol).filter(Symbol.symbol == body.symbol).first()
    if not sym:
        raise HTTPException(status_code=404, detail=f"Symbol '{body.symbol}' not found. Try syncing it first.")
    dup = (
        db.query(PriceAlert)
        .filter(
            PriceAlert.user_id == user.id,
            PriceAlert.symbol == body.symbol,
            PriceAlert.condition == body.condition,
            PriceAlert.threshold == body.threshold,
            PriceAlert.status != "triggered",
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail="You already have this alert")
    a = PriceAlert(
        user_id=user.id,
        symbol=body.symbol,
        condition=body.condition,
        threshold=float(body.threshold),
        status="active",
        repeat=body.repeat,
        armed=True,
        notify_email=body.notify_email,
        note=(body.note or "").strip() or None,
        trigger_count=0,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _out(a, None, sym.name)


@router.patch("/{alert_id}")
def update_alert(alert_id: int, body: AlertUpdate, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    a = _owned(db, user, alert_id)
    if body.threshold is not None:
        try:
            _check_threshold(a.condition, body.threshold)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        a.threshold = float(body.threshold)
    if body.repeat is not None:
        a.repeat = body.repeat
    if body.notify_email is not None:
        a.notify_email = body.notify_email
    if body.note is not None:
        a.note = body.note.strip() or None
    if body.status is not None:
        a.status = body.status
    # Reactivating, or moving the level of a triggered alert, re-arms it so it can fire again.
    if body.status == "active" or (body.threshold is not None and a.status == "triggered"):
        a.status = "active"
        a.armed = True
    elif body.threshold is not None:
        a.armed = True
    db.commit()
    db.refresh(a)
    return _out(a)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(alert_id: int, db: Session = Depends(get_db), user: User = Depends(require_auth)):
    a = _owned(db, user, alert_id)
    db.delete(a)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
