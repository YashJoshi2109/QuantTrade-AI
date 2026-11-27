"""Earnings Watch: who reports today / tomorrow, and surprises after release.

Source: our earnings calendar service (Finnhub calendar + Nasdaq public
calendar, merged; see app.services.earnings_calendar). Surprise % is
(actual - estimate) / |estimate| as computed there.

  morning slot  reports scheduled today (before open / after close) +
                results released since yesterday's close
  evening slot  results released today + reports scheduled for the next
                trading day
Rows are ranked by market cap; companies without a market cap rank last.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from app.services import market_calendar as mc
from app.services.community_bots.base import (
    BotPost, Skip, bar_chart, et_date, fmt_cap, fmt_day, fmt_money, fmt_pct,
)

TOP_UPCOMING = 10
TOP_REPORTED = 8
HOUR_LABEL = {"bmo": "Before open", "amc": "After close", "dmh": "During market"}


async def collect(hub, now: datetime, slot: str) -> Dict[str, Any]:
    today = et_date(now)
    prev = mc.previous_trading_day(today)
    nxt = today + timedelta(days=1)
    while not mc.is_trading_day(nxt):
        nxt += timedelta(days=1)
    return {"window": await hub.earnings(prev, nxt), "today": today, "prev": prev, "next": nxt}


def _n(k: int, word: str) -> str:
    return f"{k} {word}{'' if k == 1 else 's'}"


def _rank(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(rows, key=lambda r: (-(r.get("market_cap") or 0), r["symbol"]))


def compose(data: Dict[str, Any], now: datetime, slot: str) -> BotPost:
    w = data.get("window")
    if not w or not any((w.get("sources") or {}).values()):
        raise Skip("earnings calendar sources unavailable")
    rows = w.get("rows") or []
    today, prev, nxt = data["today"], data["prev"], data["next"]
    tiso, piso, niso = today.isoformat(), prev.isoformat(), nxt.isoformat()

    if slot == "morning":
        upcoming = [r for r in rows if r["date"] == tiso and r.get("status") != "reported"]
        reported = [r for r in rows if r.get("status") == "reported" and (
            (r["date"] == piso and r.get("hour") == "amc") or (r["date"] == tiso and r.get("hour") == "bmo"))]
        up_day, label = today, "today"
    else:
        upcoming = [r for r in rows if r["date"] == niso and r.get("status") != "reported"]
        reported = [r for r in rows if r.get("status") == "reported" and r["date"] == tiso]
        up_day, label = nxt, fmt_day(nxt)

    reported = [r for r in reported if r.get("eps_actual") is not None and r.get("eps_estimate") is not None]
    upcoming, reported = _rank(upcoming), _rank(reported)
    if not upcoming and not reported:
        raise Skip("no scheduled reports and no released results in the window")

    tables = []
    highlights: List[str] = []
    if reported:
        top = reported[:TOP_REPORTED]
        beats = sum(1 for r in reported if (r.get("eps_surprise_pct") or 0) > 0)
        misses = sum(1 for r in reported if (r.get("eps_surprise_pct") or 0) < 0)
        highlights.append(f"Results released: {len(reported)} with EPS vs consensus — "
                          f"{beats} above, {misses} below, {len(reported) - beats - misses} in line.")
        for r in top[:3]:
            highlights.append(
                f"${r['symbol']} EPS {fmt_money(r['eps_actual'])} vs est. {fmt_money(r['eps_estimate'])} "
                f"({fmt_pct(r.get('eps_surprise_pct'), 1)})"
                + (f", revenue {fmt_pct(r['revenue_surprise_pct'], 1)} vs est" if r.get("revenue_surprise_pct") is not None else "")
                + ".")
        tables.append({
            "title": "Reported results vs consensus",
            "columns": ["Ticker", "EPS actual", "EPS est.", "EPS surprise", "Revenue surprise", "Mkt cap"],
            "rows": [[f"${r['symbol']}", fmt_money(r["eps_actual"]), fmt_money(r["eps_estimate"]),
                      fmt_pct(r.get("eps_surprise_pct"), 1), fmt_pct(r.get("revenue_surprise_pct"), 1),
                      fmt_cap(r.get("market_cap"))] for r in top],
        })
    if upcoming:
        top = upcoming[:TOP_UPCOMING]
        bmo = sum(1 for r in upcoming if r.get("hour") == "bmo")
        amc = sum(1 for r in upcoming if r.get("hour") == "amc")
        highlights.append(f"Scheduled {label}: {_n(len(upcoming), 'report')} ({bmo} before open, {amc} after close); "
                          f"largest: " + ", ".join(f"${r['symbol']}" for r in top[:5]) + ".")
        tables.append({
            "title": f"Scheduled reports — {fmt_day(up_day)}",
            "columns": ["Ticker", "Company", "Time", "EPS est.", "Mkt cap"],
            "rows": [[f"${r['symbol']}", (r.get("name") or "")[:40] or "—",
                      HOUR_LABEL.get(r.get("hour") or "", "Not announced"),
                      fmt_money(r.get("eps_estimate")), fmt_cap(r.get("market_cap"))] for r in top],
        })

    when = "Morning" if slot == "morning" else "Evening"
    focus = (f"{_n(len(reported), 'result')} in" if reported else "") + \
        (", " if reported and upcoming else "") + (f"{_n(len(upcoming), 'report')} {label}" if upcoming else "")
    title = f"\U0001F916 Earnings Watch ({when}, {fmt_day(today)}): {focus}"
    if reported:
        lead = "Released results compared with consensus estimates, plus the schedule ahead."
    else:
        lead = f"Earnings reports scheduled {label}, ranked by market cap."
    chart = bar_chart("EPS surprise vs consensus (%)",
                      [(r["symbol"], r.get("eps_surprise_pct")) for r in reported[:TOP_REPORTED]])
    src = [s for s, ok in (w.get("sources") or {}).items() if ok]
    return BotPost(
        title=title[:300],
        lead=lead,
        as_of=now,
        sources=["QuantTrade earnings calendar (" + " + ".join(
            {"finnhub": "Finnhub calendar", "nasdaq": "Nasdaq public calendar"}.get(s, s) for s in src) + ")"],
        highlights=highlights,
        tables=tables,
        chart=chart,
        tickers=[r["symbol"] for r in (reported[:3] + upcoming[:3])][:6],
        sentiment="neutral",
        notes=["Estimates are consensus figures from the calendar providers and can be revised; "
               "dates and times can change."],
    )
