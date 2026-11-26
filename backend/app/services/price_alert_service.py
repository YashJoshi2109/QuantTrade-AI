"""
Evaluate user price / indicator alerts (scheduled job).

Every run:
  1. load active alerts, group by symbol
  2. fetch quotes once per symbol (existing QuoteCacheService, free providers)
  3. compute RSI(14) only for symbols that have an RSI alert (daily bars from
     the DB with today's live price appended)
  4. for each alert whose condition is met: write an in-app Notification
     (type="price_alert"), optionally email Pro users who opted in, then
     mark it triggered (one-shot) or disarm it until the condition clears (repeat)

No LLM is involved. Market data only; nothing here can trade.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.community import Notification
from app.models.price_alert import PriceAlert

logger = logging.getLogger("price_alerts")

QUOTE_BATCH = 50


@dataclass(frozen=True)
class ConditionSpec:
    metric: str  # price | change | rsi
    above: bool  # True: fires when value >= threshold, else value <= threshold (see metric_value)
    label: str
    min_threshold: float
    max_threshold: float


CONDITIONS: Dict[str, ConditionSpec] = {
    "price_above": ConditionSpec("price", True, "Price rises to or above", 0.0001, 10_000_000),
    "price_below": ConditionSpec("price", False, "Price falls to or below", 0.0001, 10_000_000),
    # Day change vs previous close, in percent. Thresholds are positive numbers.
    "change_up_pct": ConditionSpec("change", True, "Up on the day by at least", 0.1, 100),
    "change_down_pct": ConditionSpec("change", True, "Down on the day by at least", 0.1, 100),  # compares size of drop
    "rsi_above": ConditionSpec("rsi", True, "RSI(14) rises to or above", 1, 99),
    "rsi_below": ConditionSpec("rsi", False, "RSI(14) falls to or below", 1, 99),
}


def metric_value(condition: str, metrics: Dict[str, Optional[float]]) -> Optional[float]:
    spec = CONDITIONS[condition]
    v = metrics.get(spec.metric)
    if v is None:
        return None
    # change_down_pct compares the size of the drop, so report it as a positive number
    if condition == "change_down_pct":
        return -v
    return v


def is_met(condition: str, threshold: float, metrics: Dict[str, Optional[float]]) -> Optional[bool]:
    """True/False when the metric is known, None when it is not (never guess)."""
    spec = CONDITIONS[condition]
    v = metric_value(condition, metrics)
    if v is None:
        return None
    return v >= threshold if spec.above else v <= threshold


def describe(alert: PriceAlert, metrics: Dict[str, Optional[float]]) -> tuple[str, str]:
    sym = alert.symbol
    price = metrics.get("price")
    p = f"${price:,.2f}" if price is not None else "n/a"
    c = alert.condition
    t = alert.threshold
    if c == "price_above":
        title = f"{sym} is above ${t:,.2f}"
    elif c == "price_below":
        title = f"{sym} is below ${t:,.2f}"
    elif c == "change_up_pct":
        title = f"{sym} is up {metrics.get('change') or 0:+.2f}% today"
    elif c == "change_down_pct":
        title = f"{sym} is down {metrics.get('change') or 0:+.2f}% today"
    elif c == "rsi_above":
        title = f"{sym} RSI(14) {metrics.get('rsi') or 0:.1f} is above {t:g}"
    else:
        title = f"{sym} RSI(14) {metrics.get('rsi') or 0:.1f} is below {t:g}"
    spec = CONDITIONS[c]
    unit = "%" if spec.metric == "change" else ""
    thr = f"${t:,.2f}" if spec.metric == "price" else f"{t:g}{unit}"
    body = f"Your alert: {spec.label} {thr}. Last price {p}."
    if alert.note:
        body += f" Note: {alert.note}"
    return title[:200], body


# ── data ─────────────────────────────────────────────────────────────────────

QuoteFetch = Callable[[Session, List[str]], Awaitable[Dict[str, dict]]]
RsiFetch = Callable[[Session, str, Optional[float]], Optional[float]]


async def default_quote_fetch(db: Session, symbols: List[str]) -> Dict[str, dict]:
    from app.services.quote_cache import QuoteCacheService

    out: Dict[str, dict] = {}
    svc = QuoteCacheService(db)
    for i in range(0, len(symbols), QUOTE_BATCH):
        out.update(await svc.get_quotes(symbols[i:i + QUOTE_BATCH]))
    return out


def default_rsi(db: Session, symbol: str, live_price: Optional[float], period: int = 14) -> Optional[float]:
    """RSI on daily closes from price_bars, with today's live price appended."""
    import pandas as pd

    from app.models.symbol import Symbol
    from app.services.indicators import IndicatorService

    row = db.query(Symbol).filter(Symbol.symbol == symbol).first()
    if not row:
        return None
    df = IndicatorService.get_price_dataframe(db, row.id, limit=period * 10)
    if df.empty:
        return None
    if live_price and live_price > 0:
        last_ts = pd.Timestamp(df.index[-1])
        today = pd.Timestamp(datetime.now(timezone.utc).date())
        last_day = last_ts.tz_convert(None).normalize() if last_ts.tzinfo else last_ts.normalize()
        if last_day < today:
            df.loc[pd.Timestamp(datetime.now(timezone.utc))] = {**df.iloc[-1].to_dict(), "close": live_price}
        else:
            df.iloc[-1, df.columns.get_loc("close")] = live_price
    if len(df) < period + 1:
        return None
    v = IndicatorService.compute_rsi(df, period).iloc[-1]
    return None if pd.isna(v) else float(v)


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def quote_metrics(q: Optional[dict]) -> Dict[str, Optional[float]]:
    if not q or q.get("unavailable"):
        return {"price": None, "change": None}
    price = _num(q.get("price") or q.get("last_price") or q.get("current_price"))
    if price is not None and price <= 0:
        price = None
    change = _num(q.get("change_percent"))
    prev = _num(q.get("previous_close"))
    if change is None and price and prev and prev > 0:
        change = (price - prev) / prev * 100.0
    return {"price": price, "change": change if price is not None else None}


# ── notify ───────────────────────────────────────────────────────────────────

def _user_can_email(db: Session, user_id: int) -> Optional[str]:
    """Email alerts are a Pro feature (same policy as watchlist alerts)."""
    from app.models.billing import Subscription
    from app.models.user import User
    from app.services.billing_service import subscription_entitled

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.email:
        return None
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    return user.email if subscription_entitled(sub) else None


def default_send_email(to: str, title: str, body: str, symbol: str) -> None:
    from html import escape

    from app.services.email_service import send_email_sync

    html = (
        "<div style=\"font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;\">"
        "<p style=\"color:#6366f1;font-size:12px;text-transform:uppercase;letter-spacing:.12em;margin:0 0 8px;\">Price alert</p>"
        f"<p style=\"font-size:20px;font-weight:800;margin:0 0 8px;\">{escape(title)}</p>"
        f"<p style=\"color:#475569;font-size:15px;margin:0 0 16px;\">{escape(body)}</p>"
        f"<p style=\"font-size:12px;color:#64748b;margin:0;\">Manage alerts at https://www.quanttrade.us/alerts</p></div>"
    )
    ok, err = send_email_sync(to, f"QuantTrade AI - {title}", html, text_plain=f"{title}\n{body}")
    if not ok:
        logger.warning("price alert email failed symbol=%s: %s", symbol, err)


# ── run ──────────────────────────────────────────────────────────────────────

async def run_price_alerts(
    db: Session,
    *,
    quote_fetch: Optional[QuoteFetch] = None,
    rsi_fetch: Optional[RsiFetch] = None,
    send_email: Optional[Callable[[str, str, str, str], None]] = None,
    now: Optional[datetime] = None,
) -> Dict[str, int]:
    quote_fetch = quote_fetch or default_quote_fetch
    rsi_fetch = rsi_fetch or default_rsi
    send_email = send_email or default_send_email
    now = now or datetime.now(timezone.utc)

    alerts: List[PriceAlert] = db.query(PriceAlert).filter(PriceAlert.status == "active").all()
    stats = {"checked": 0, "triggered": 0, "rearmed": 0, "no_data": 0}
    if not alerts:
        return stats

    symbols = sorted({a.symbol for a in alerts})
    try:
        quotes = await quote_fetch(db, symbols)
    except Exception:
        logger.exception("price alert quote fetch failed")
        return stats

    metrics: Dict[str, Dict[str, Optional[float]]] = {s: quote_metrics(quotes.get(s)) for s in symbols}
    rsi_syms = {a.symbol for a in alerts if CONDITIONS.get(a.condition, CONDITIONS["price_above"]).metric == "rsi"}
    for s in rsi_syms:
        try:
            metrics[s]["rsi"] = rsi_fetch(db, s, metrics[s].get("price"))
        except Exception:
            logger.exception("RSI compute failed for %s", s)
            metrics[s]["rsi"] = None

    email_cache: Dict[int, Optional[str]] = {}
    for a in alerts:
        if a.condition not in CONDITIONS:
            continue
        m = metrics.get(a.symbol, {})
        met = is_met(a.condition, a.threshold, m)
        stats["checked"] += 1
        a.last_checked_at = now
        if met is None:
            stats["no_data"] += 1
            continue
        a.last_value = metric_value(a.condition, m)
        if not met:
            if a.repeat and not a.armed:
                a.armed = True
                stats["rearmed"] += 1
            continue
        if not a.armed:
            continue  # repeat alert still past its level; wait for it to clear

        title, body = describe(a, m)
        db.add(Notification(
            user_id=a.user_id,
            type="price_alert",
            title=title,
            body=body,
            action_url=f"/research?symbol={a.symbol}",
            is_read=False,
        ))
        a.trigger_count = (a.trigger_count or 0) + 1
        a.last_triggered_at = now
        a.last_triggered_value = a.last_value
        if a.repeat:
            a.armed = False
        else:
            a.status = "triggered"
        stats["triggered"] += 1

        if a.notify_email:
            if a.user_id not in email_cache:
                email_cache[a.user_id] = _user_can_email(db, a.user_id)
            to = email_cache[a.user_id]
            if to:
                try:
                    send_email(to, title, body, a.symbol)
                except Exception:
                    logger.exception("price alert email error alert=%s", a.id)

    db.commit()
    if stats["triggered"]:
        logger.info("price alerts run: %s", stats)
    return stats


def run_price_alerts_sync(db: Session) -> Dict[str, int]:
    return asyncio.run(run_price_alerts(db))

