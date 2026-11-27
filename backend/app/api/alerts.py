"""
Price / indicator alerts API. Auth required; users only see their own alerts
(another user's id returns 404).

  GET    /api/v1/alerts               list (+ current price per symbol)
  GET    /api/v1/alerts/conditions    supported conditions and threshold bounds
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

import logging
import re
from typing import Dict, List, Literal, Optional

import anyio
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.api.auth import require_auth
from app.db.database import get_db
from app.models.price_alert import PriceAlert
from app.models.symbol import Symbol
from app.models.user import User
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
