"""Sector Rotation: relative strength of the 11 SPDR sector ETFs vs SPY.

From daily closes (market data service, yfinance/Alpaca):
  return_k   close[t] / close[t-k] - 1   for k = 1, 5, 20 trading days
  RS (20D)   sector 20-day return minus SPY 20-day return, in pp
  rotation   rank by 5-day RS vs rank by 20-day RS (positive = moving up)
"""
from __future__ import annotations

from datetime import datetime, time
from typing import Any, Dict, List, Optional, Tuple

from app.services import market_calendar as mc
from app.services.community_bots.base import (
    ET, BotPost, Skip, bar_chart, fmt_day, fmt_pct, fmt_pp,
)

SECTOR_ETFS: Tuple[Tuple[str, str], ...] = (
    ("XLK", "Technology"), ("XLC", "Communication Services"), ("XLY", "Consumer Discretionary"),
    ("XLP", "Consumer Staples"), ("XLE", "Energy"), ("XLF", "Financials"), ("XLV", "Health Care"),
    ("XLI", "Industrials"), ("XLB", "Materials"), ("XLRE", "Real Estate"), ("XLU", "Utilities"),
)


async def collect(hub, now: datetime, slot: str) -> Dict[str, Any]:
    out = {}
    for sym in [s for s, _ in SECTOR_ETFS] + ["SPY"]:
        out[sym] = await hub.closes(sym, "3mo")
    return {"closes": out}


def _ret(c: List[Tuple[Any, float]], k: int) -> Optional[float]:
    if len(c) <= k or not c[-1 - k][1]:
        return None
    return (c[-1][1] / c[-1 - k][1] - 1) * 100


def compose(data: Dict[str, Any], now: datetime, slot: str) -> BotPost:
    closes: Dict[str, List] = data.get("closes") or {}
    spy = closes.get("SPY") or []
    if len(spy) < 21:
        raise Skip("SPY history shorter than 21 sessions")
    last_day = spy[-1][0]
    expected = mc.last_completed_session(now)
    if last_day != expected:
        raise Skip(f"latest SPY close is {last_day}, expected {expected}")
    spy5, spy20 = _ret(spy, 5), _ret(spy, 20)

    rows = []
    for sym, name in SECTOR_ETFS:
        c = closes.get(sym) or []
        if len(c) < 21 or c[-1][0] != last_day:
            continue
        r1, r5, r20 = _ret(c, 1), _ret(c, 5), _ret(c, 20)
        rows.append({"sym": sym, "name": name, "r1": r1, "r5": r5, "r20": r20,
                     "rs5": (r5 - spy5) if r5 is not None and spy5 is not None else None,
                     "rs20": (r20 - spy20) if r20 is not None and spy20 is not None else None})
    if len(rows) < 9:
        raise Skip(f"only {len(rows)} of 11 sector ETFs have current history")

    by20 = sorted(rows, key=lambda r: -(r["rs20"] or 0))
    by5 = sorted(rows, key=lambda r: -(r["rs5"] or 0))
    rank20 = {r["sym"]: i for i, r in enumerate(by20)}
    rank5 = {r["sym"]: i for i, r in enumerate(by5)}
    for r in rows:
        r["shift"] = rank20[r["sym"]] - rank5[r["sym"]]
    leader, laggard = by20[0], by20[-1]
    risers = sorted((r for r in rows if r["shift"] >= 3), key=lambda r: (-r["shift"], r["sym"]))
    fallers = sorted((r for r in rows if r["shift"] <= -3), key=lambda r: (r["shift"], r["sym"]))

    defensive = {"XLP", "XLU", "XLV", "XLRE"}
    top3 = {r["sym"] for r in by20[:3]}
    tilt = ("defensive sectors lead" if len(top3 & defensive) >= 2 else
            "cyclical/growth sectors lead" if not (top3 & defensive) else "leadership is mixed")

    title = (f"\U0001F916 Sector Rotation ({fmt_day(last_day)}): {leader['name']} leads "
             f"({fmt_pp(leader['rs20'])} vs SPY, 20D), {laggard['name']} lags ({fmt_pp(laggard['rs20'])})")
    lead = (f"20-day relative strength of the 11 sector ETFs vs SPY (SPY {fmt_pct(spy20, 1)} over 20 sessions, "
            f"{fmt_pct(spy5, 1)} over 5): {tilt}.")
    highlights = [
        f"Leaders (20D RS): " + ", ".join(f"{r['name']} {fmt_pp(r['rs20'])}" for r in by20[:3]) + ".",
        f"Laggards (20D RS): " + ", ".join(f"{r['name']} {fmt_pp(r['rs20'])}" for r in by20[-3:][::-1]) + ".",
    ]
    if risers:
        highlights.append("Rising in the ranks over 5 days: " + ", ".join(
            f"{r['name']} (+{r['shift']} places)" for r in risers[:3]) + ".")
    if fallers:
        highlights.append("Slipping over 5 days: " + ", ".join(
            f"{r['name']} ({r['shift']} places)".replace("-", "−") for r in fallers[:3]) + ".")

    table = {"title": "Sector ETFs ranked by 20-day relative strength",
             "columns": ["Sector", "ETF", "1D", "5D", "20D", "RS vs SPY (20D)"],
             "rows": [[r["name"], f"${r['sym']}", fmt_pct(r["r1"]), fmt_pct(r["r5"]), fmt_pct(r["r20"]),
                       fmt_pp(r["rs20"])] for r in by20]}
    chart = bar_chart("Relative strength vs SPY, 20 sessions (pp)",
                      [(r["sym"], r["rs20"]) for r in by20], unit="pp")
    as_of = datetime.combine(last_day, time(16, 0), tzinfo=ET)
    return BotPost(
        title=title[:300],
        lead=lead,
        as_of=as_of,
        sources=["QuantTrade market data service (daily closes, SPDR sector ETFs and SPY)"],
        highlights=highlights,
        tables=[table],
        chart=chart,
        tickers=[leader["sym"], laggard["sym"]],
        sentiment="neutral",
        notes=["Relative strength describes past performance; it does not predict future returns."],
    )
