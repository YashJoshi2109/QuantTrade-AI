"""
Pro-only watchlist price + news email alerts (scheduled job).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session, joinedload

from app.models.billing import Subscription
from app.models.community import Notification
from app.models.news import NewsArticle
from app.models.user import User
from app.models.watchlist import Watchlist
from app.services.billing_emails import (
    send_watchlist_news_alert_email,
    send_watchlist_price_alert_email,
)
from app.services.billing_service import subscription_entitled
from app.services.quote_cache import QuoteCacheService
from app.services.user_preferences_service import load_preferences, set_internal_key

logger = logging.getLogger("watchlist_alerts")

PRICE_MOVE_THRESHOLD_PCT = 2.0
NEWS_LOOKBACK_HOURS = 4
MAX_NEWS_IDS = 80


def _quote_price(q: Dict[str, Any]) -> float | None:
    if q.get("unavailable"):
        return None
    p = q.get("price") or q.get("last_price") or q.get("current_price")
    if p is None:
        return None
    try:
        v = float(p)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


async def _process_user_price_alerts(db: Session, user: User) -> None:
    prefs = load_preferences(user)
    pro_alerts = prefs.get("pro_alerts") or {}
    if not pro_alerts.get("watchlist_price"):
        return

    items = (
        db.query(Watchlist)
        .options(joinedload(Watchlist.symbol))
        .filter(Watchlist.user_id == user.id)
        .all()
    )
    if not items:
        return

    symbols: List[str] = []
    for w in items:
        if w.symbol and w.symbol.symbol:
            symbols.append(w.symbol.symbol.upper())

    if not symbols:
        return

    snapshot: Dict[str, Any] = dict(prefs.get("_price_alert_snapshot") or {})
    svc = QuoteCacheService(db)
    quotes = await svc.get_quotes(symbols)

    changed = False
    for sym in symbols:
        q = quotes.get(sym) or {}
        price = _quote_price(q)
        if price is None:
            continue

        prev = snapshot.get(sym)
        if isinstance(prev, dict):
            old_p = prev.get("p")
        else:
            old_p = prev

        if old_p is None:
            snapshot[sym] = {"p": price}
            changed = True
            continue

        try:
            old_f = float(old_p)
        except (TypeError, ValueError):
            snapshot[sym] = {"p": price}
            changed = True
            continue

        if old_f <= 0:
            snapshot[sym] = {"p": price}
            changed = True
            continue

        pct = abs(price - old_f) / old_f * 100.0
        if pct >= PRICE_MOVE_THRESHOLD_PCT:
            change_pct = (price - old_f) / old_f * 100.0
            direction = "▲" if change_pct > 0 else "▼"
            ok, err = send_watchlist_price_alert_email(
                user.email,
                symbol=sym,
                old_price=old_f,
                new_price=price,
                change_pct=change_pct,
            )
            if not ok:
                logger.warning("Price alert email failed user=%s sym=%s: %s", user.id, sym, err)
            # Also create an in-app notification so Trading tab shows alerts
            try:
                notif = Notification(
                    user_id=user.id,
                    type="price_alert",
                    title=f"{sym} moved {direction}{abs(change_pct):.1f}%",
                    body=f"{sym} price moved from ${old_f:.2f} to ${price:.2f} ({direction}{abs(change_pct):.1f}%)",
                    action_url=f"/research?symbol={sym}",
                    is_read=False,
                )
                db.add(notif)
                db.commit()
            except Exception as ne:
                logger.warning("In-app notification create failed user=%s sym=%s: %s", user.id, sym, ne)
                db.rollback()
            snapshot[sym] = {"p": price}
            changed = True

    if changed:
        set_internal_key(db, user, "_price_alert_snapshot", snapshot)


def _process_user_news_alerts(db: Session, user: User) -> None:
    db.refresh(user)
    prefs = load_preferences(user)
    pro_alerts = prefs.get("pro_alerts") or {}
    if not pro_alerts.get("watchlist_news"):
        return

    items = (
        db.query(Watchlist)
        .options(joinedload(Watchlist.symbol))
        .filter(Watchlist.user_id == user.id)
        .all()
    )
    symbol_ids: List[int] = []
    id_to_ticker: Dict[int, str] = {}
    for w in items:
        if w.symbol_id and w.symbol:
            symbol_ids.append(w.symbol_id)
            id_to_ticker[w.symbol_id] = w.symbol.symbol.upper()

    if not symbol_ids:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(hours=NEWS_LOOKBACK_HOURS)
    articles = (
        db.query(NewsArticle)
        .filter(
            NewsArticle.symbol_id.in_(symbol_ids),
            NewsArticle.published_at >= cutoff,
        )
        .order_by(NewsArticle.published_at.desc())
        .limit(40)
        .all()
    )

    stored = prefs.get("_news_alert_sent_ids") or []
    sent_list: List[int] = [int(x) for x in stored if str(x).isdigit()]
    sent_set = set(sent_list)

    for art in articles:
        if art.id in sent_set:
            continue
        sym = id_to_ticker.get(art.symbol_id, "?")
        ok, err = send_watchlist_news_alert_email(
            user.email,
            symbol=sym,
            title=art.title,
            url=art.url,
        )
        if ok:
            sent_list.append(art.id)
            sent_set.add(art.id)
        else:
            logger.warning("News alert email failed user=%s: %s", user.id, err)

    trimmed = sent_list[-MAX_NEWS_IDS:]
    if trimmed != stored:
        set_internal_key(db, user, "_news_alert_sent_ids", trimmed)


async def run_watchlist_alerts(db: Session) -> None:
    subs = db.query(Subscription).all()
    for sub in subs:
        if not subscription_entitled(sub):
            continue
        user = db.query(User).filter(User.id == sub.user_id).first()
        if not user or not user.email:
            continue
        try:
            await _process_user_price_alerts(db, user)
            _process_user_news_alerts(db, user)
        except Exception as exc:
            logger.exception("Watchlist alerts error user_id=%s: %s", sub.user_id, exc)


def run_watchlist_alerts_sync(db: Session) -> None:
    asyncio.run(run_watchlist_alerts(db))
