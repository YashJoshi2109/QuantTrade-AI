"""Market Weather: a daily condition report from breadth, VIX and trend.

Score (integer, -7..+7), each component from data:
  breadth  share of advancers among advancers+decliners in our US heatmap universe, ~700 stocks
           >=65% +2, >=55% +1, <=35% -2, <=45% -1, else 0
  VIX      <14 +2, <18 +1, <22 0, <28 -1, >=28 -2; a VIX jump of >=10% on the day -1
  trend    SPY vs its 50- and 200-day SMAs: above both with 50>200 +2, above 200 +1,
           below both with 50<200 -2, below 200 -1, else 0
  SPY day  >= +1% +1, <= -1% -1
Condition: >=4 Sunny, 2..3 Mostly sunny, 0..1 Partly cloudy, -2..-1 Rainy, <=-3 Stormy;
VIX >= 30 is always Stormy.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.services import market_calendar as mc
from app.services.community_bots.base import (
    BotPost, Skip, bar_chart, et_date, fmt_day, fmt_num, fmt_pct, fmt_points, require_fresh, session_as_of,
)

CONDITIONS = [
    (4, "sunny", "Sunny", "☀️"),
    (2, "mostly_sunny", "Mostly sunny", "\U0001F324️"),
    (0, "partly_cloudy", "Partly cloudy", "⛅"),
    (-2, "rainy", "Rainy", "\U0001F327️"),
    (-99, "stormy", "Stormy", "⛈️"),
]
INDEX_SYMBOLS = ("SPY", "QQQ", "IWM", "^VIX")


async def collect(hub, now: datetime, slot: str) -> Dict[str, Any]:
    return {
        "breadth": await hub.breadth(),
        "quotes": await hub.quotes(list(INDEX_SYMBOLS)),
        "spy_ta": await hub.technicals("SPY"),
    }


def condition_for(score: int, vix: Optional[float]) -> Tuple[str, str, str]:
    if vix is not None and vix >= 30:
        return "stormy", "Stormy", "⛈️"
    for floor, key, label, icon in CONDITIONS:
        if score >= floor:
            return key, label, icon
    return "stormy", "Stormy", "⛈️"


def _breadth_points(pct_up: float) -> int:
    if pct_up >= 65:
        return 2
    if pct_up >= 55:
        return 1
    if pct_up <= 35:
        return -2
    if pct_up <= 45:
        return -1
    return 0


def _vix_points(vix: float, vix_chg: Optional[float]) -> int:
    pts = 2 if vix < 14 else 1 if vix < 18 else 0 if vix < 22 else -1 if vix < 28 else -2
    if vix_chg is not None and vix_chg >= 10:
        pts -= 1
    return pts


def _trend(price: Optional[float], sma50: Optional[float], sma200: Optional[float]) -> Tuple[int, str]:
    if price is None or sma50 is None or sma200 is None:
        return 0, "trend unavailable"
    if price > sma50 and price > sma200:
        return (2, "above its 50- and 200-day averages, 50-day above 200-day") if sma50 > sma200 else \
            (1, "above its 50- and 200-day averages")
    if price < sma50 and price < sma200:
        return (-2, "below its 50- and 200-day averages, 50-day below 200-day") if sma50 < sma200 else \
            (-1, "below its 50- and 200-day averages")
    if price > sma200:
        return 1, "above its 200-day average, below its 50-day"
    return -1, "below its 200-day average, above its 50-day"


def compose(data: Dict[str, Any], now: datetime, slot: str) -> BotPost:
    b = data.get("breadth")
    q = data.get("quotes") or {}
    ta = data.get("spy_ta") or {}
    if not b or (b.get("up", 0) + b.get("down", 0)) < 100:
        raise Skip("breadth unavailable or fewer than 100 advancing/declining stocks")
    spy, vixq = q.get("SPY"), q.get("^VIX")
    if not spy or not vixq or vixq.get("price") is None:
        raise Skip("SPY or VIX quote missing")

    expected = mc.last_completed_session(now) if slot == "pre_open" else \
        (et_date(now) if mc.is_trading_day(et_date(now)) else mc.last_completed_session(now))
    if b.get("session_date") and b["session_date"] != expected:
        raise Skip(f"breadth is from {b['session_date']}, expected the {expected} session")
    require_fresh(b.get("newest_quote_at"), now, 18 if slot == "pre_open" else 3, "breadth snapshot")
    if spy.get("session_date") and spy["session_date"] != expected:
        raise Skip(f"SPY quote is from {spy['session_date']}, expected {expected}")

    up, down, flat = int(b["up"]), int(b["down"]), int(b.get("flat", 0))
    pct_up = 100.0 * up / max(up + down, 1)
    vix, vix_chg = float(vixq["price"]), vixq.get("change_percent")
    spy_chg = spy.get("change_percent")

    bp = _breadth_points(pct_up)
    vp = _vix_points(vix, vix_chg)
    tp, trend_text = _trend(ta.get("price") or spy.get("price"), ta.get("sma_50"), ta.get("sma_200"))
    dp = 1 if (spy_chg or 0) >= 1 else -1 if (spy_chg or 0) <= -1 else 0
    score = bp + vp + tp + dp
    key, label, icon = condition_for(score, vix)

    session_day = fmt_day(expected)
    when = "Pre-open" if slot == "pre_open" else "Close"
    title = (f"\U0001F916 Market Weather ({when}, {session_day}): {icon} {label} — "
             f"{up} up / {down} down, VIX {vix:.1f}")

    lead_scope = "the last session" if slot == "pre_open" else "today's session"
    lead = (f"{icon} {label} (score {fmt_points(score)} on a −7..+7 scale) for {lead_scope} "
            f"({session_day}), from breadth, volatility and trend.")

    highlights: List[str] = [
        f"Breadth: {pct_up:.0f}% of advancing/declining stocks in our US heatmap universe rose "
        f"({up} up, {down} down, {flat} flat).",
        f"VIX {vix:.2f} ({fmt_pct(vix_chg)} on the day).",
        f"SPY {fmt_num(spy.get('price'))} ({fmt_pct(spy_chg)}), {trend_text}.",
    ]
    for sym, name in (("QQQ", "Nasdaq-100 (QQQ)"), ("IWM", "Russell 2000 (IWM)")):
        r = q.get(sym)
        if r and r.get("change_percent") is not None:
            highlights.append(f"{name} {fmt_pct(r['change_percent'])}.")
    ext = (spy.get("extended") or {}) if slot == "pre_open" else {}
    if ext.get("price") and ext.get("change_percent") is not None and ext.get("session") == "pre-market":
        highlights.append(f"SPY pre-market {fmt_num(ext['price'])} ({fmt_pct(ext['change_percent'])} vs the close).")

    table = {
        "title": "How the weather is scored",
        "columns": ["Input", "Reading", "Points"],
        "rows": [
            ["Breadth (share of advancers)", f"{pct_up:.0f}%", fmt_points(bp)],
            ["VIX level / day change", f"{vix:.1f} / {fmt_pct(vix_chg, 1)}", fmt_points(vp)],
            ["SPY trend vs 50/200-day SMA", trend_text.split(",")[0], fmt_points(tp)],
            ["SPY day change", fmt_pct(spy_chg), fmt_points(dp)],
            ["Total", label, fmt_points(score)],
        ],
    }
    sectors = sorted(b.get("sectors") or [], key=lambda s: s[1], reverse=True)
    chart = bar_chart("Sector median change, US heatmap universe, ~700 stocks (%)", [(n, c) for n, c, _ in sectors[:12]])

    as_of = session_as_of(b.get("newest_quote_at"), expected, now)
    return BotPost(
        title=title,
        lead=lead,
        as_of=as_of,
        sources=["QuantTrade quote cache (US heatmap universe, ~700 stocks breadth)", "SPY/QQQ/IWM and CBOE VIX quotes",
                 "QuantTrade technical analysis (SMA 50/200)"],
        highlights=highlights,
        tables=[table],
        chart=chart,
        badge={"kind": "weather", "value": key, "label": label, "icon": icon, "score": score},
        tickers=["SPY"],
        sentiment="bullish" if score >= 2 else "bearish" if score <= -2 else "neutral",
        notes=["Weather describes current conditions from the rules above; it is not a forecast of prices."],
    )
