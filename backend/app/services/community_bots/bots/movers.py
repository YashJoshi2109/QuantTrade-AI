"""Movers & Breakout signals: rule-based labels on the day's biggest movers.

Candidates: the CANDIDATES largest gainers and losers of our US heatmap universe, ~700 stocks
snapshot. For each, the technical-analysis service (daily OHLCV) gives
52-week high/low, RSI(14), volume ratio vs average and SMA 50/200. Signals:

  52w-high breakout   up on the day and price >= 99.5% of the 52-week high
  52w-low breakdown   down on the day and price <= 100.5% of the 52-week low
  RSI overbought      RSI(14) >= 70        RSI oversold   RSI(14) <= 30
  Unusual volume      volume >= 2x the average daily volume
  200-day cross zone  price within 1% of the 200-day SMA, moving through it

These are labelled *signals* (descriptions of what the data shows), not
recommendations.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from app.services import market_calendar as mc
from app.services.community_bots.base import (
    BotPost, Skip, bar_chart, et_date, fmt_num, fmt_pct, require_fresh, session_as_of,
)

CANDIDATES = 6
MIN_MOVE_PCT = 2.0


async def collect(hub, now: datetime, slot: str) -> Dict[str, Any]:
    b = await hub.breadth()
    ta: Dict[str, Any] = {}
    if b and b.get("rows"):
        rows = b["rows"]
        gainers = sorted((r for r in rows if (r.get("change_percent") or 0) > 0),
                         key=lambda r: -r["change_percent"])[:CANDIDATES]
        losers = sorted((r for r in rows if (r.get("change_percent") or 0) < 0),
                        key=lambda r: r["change_percent"])[:CANDIDATES]
        for r in gainers + losers:
            ta[r["symbol"]] = await hub.technicals(r["symbol"])
    return {"breadth": b, "technicals": ta}


def signals_for(row: Dict[str, Any], t: Optional[Dict[str, Any]]) -> List[str]:
    if not t:
        return []
    out: List[str] = []
    price = row.get("price") or t.get("price")
    chg = row.get("change_percent") or 0
    hi, lo = t.get("high_52w"), t.get("low_52w")
    rsi, vr, sma200 = t.get("rsi_14"), t.get("volume_ratio"), t.get("sma_200")
    if price and hi and chg > 0 and price >= 0.995 * hi:
        out.append("52w-high breakout")
    if price and lo and chg < 0 and price <= 1.005 * lo:
        out.append("52w-low breakdown")
    if rsi is not None and rsi >= 70:
        out.append(f"RSI overbought ({rsi:.0f})")
    if rsi is not None and rsi <= 30:
        out.append(f"RSI oversold ({rsi:.0f})")
    if vr is not None and vr >= 2:
        out.append(f"Unusual volume ({vr:.1f}× avg)")
    if price and sma200 and abs(price / sma200 - 1) <= 0.01 and abs(chg) >= 1:
        out.append("200-day SMA cross " + ("up" if chg > 0 else "down"))
    return out


def compose(data: Dict[str, Any], now: datetime, slot: str) -> BotPost:
    b = data.get("breadth")
    ta = data.get("technicals") or {}
    if not b or not b.get("rows"):
        raise Skip("market snapshot unavailable")
    expected = et_date(now) if mc.is_trading_day(et_date(now)) else mc.last_completed_session(now)
    if b.get("session_date") and b["session_date"] != expected:
        raise Skip(f"snapshot is from {b['session_date']}, expected {expected}")
    require_fresh(b.get("newest_quote_at"), now, 1.5 if slot == "midday" else 3, "market snapshot")

    rows = b["rows"]
    gainers = sorted((r for r in rows if (r.get("change_percent") or 0) >= MIN_MOVE_PCT),
                     key=lambda r: -r["change_percent"])[:CANDIDATES]
    losers = sorted((r for r in rows if (r.get("change_percent") or 0) <= -MIN_MOVE_PCT),
                    key=lambda r: r["change_percent"])[:CANDIDATES]
    movers = gainers + losers
    if len(movers) < 3:
        raise Skip(f"fewer than 3 stocks moved {MIN_MOVE_PCT:g}% or more")
    with_ta = [r for r in movers if ta.get(r["symbol"])]
    if len(with_ta) < 3:
        raise Skip("technicals unavailable for the movers")

    table_rows, flagged = [], []
    for r in movers:
        t = ta.get(r["symbol"]) or {}
        sig = signals_for(r, t)
        if sig:
            flagged.append((r, sig))
        table_rows.append([
            f"${r['symbol']}", fmt_pct(r["change_percent"]), fmt_num(r.get("price")),
            ", ".join(sig) if sig else "—",
            fmt_num(t.get("rsi_14"), 0) if t.get("rsi_14") is not None else "n/a",
            f"{t['volume_ratio']:.1f}×" if t.get("volume_ratio") is not None else "n/a",
        ])

    when = "Midday" if slot == "midday" else "Close"
    lead_rows = flagged[:2] if flagged else [(movers[0], [])]
    lead_txt = "; ".join(f"${r['symbol']} {fmt_pct(r['change_percent'], 1)}" + (f" ({s[0]})" if s else "")
                         for r, s in lead_rows)
    title = (f"\U0001F916 Movers & Breakout Signals ({when}): {len(flagged)} rule signal"
             f"{'' if len(flagged) == 1 else 's'} — {lead_txt}")
    lead = (f"{len(gainers)} US stocks up {MIN_MOVE_PCT:g}%+ and {len(losers)} down {MIN_MOVE_PCT:g}%+ "
            f"among the largest movers; {len(flagged)} trip a technical rule.")
    highlights = [f"Signal — ${r['symbol']} ({r.get('sector') or 'n/a'}) {fmt_pct(r['change_percent'])}: "
                  + ", ".join(s) + "." for r, s in flagged[:6]]
    if not flagged:
        highlights.append("Observation: no mover tripped a breakout, breakdown, RSI or volume rule.")

    chart = bar_chart("Largest moves today (%)", [(r["symbol"], r["change_percent"]) for r in movers])
    return BotPost(
        title=title[:300],
        lead=lead,
        as_of=session_as_of(b.get("newest_quote_at"), expected, now),
        sources=["QuantTrade quote cache (US heatmap universe, ~700 stocks)",
                 "QuantTrade technical analysis (daily OHLCV: 52w range, RSI 14, volume, SMA 200)"],
        highlights=highlights,
        tables=[{"title": "Largest movers and rule signals",
                 "columns": ["Ticker", "Change", "Price", "Signals", "RSI", "Vol × avg"],
                 "rows": table_rows}],
        chart=chart,
        tickers=[r["symbol"] for r, _ in flagged[:5]] or [r["symbol"] for r in movers[:3]],
        sentiment="neutral",
        notes=["Signals are mechanical rule matches on public price/volume data, shown for research; "
               "they are not trade recommendations."],
    )
