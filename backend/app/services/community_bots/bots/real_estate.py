"""Real Estate & Rates: REIT performance next to Treasury and mortgage rates.

REITs: broad REIT ETFs (VNQ, XLRE) + large REITs by property type, and
homebuilder ETFs (ITB, XHB), from our quote cache. Relative performance is
VNQ's day change minus SPY's, in percentage points.

Rates (FRED API, when FRED_API_KEY is set):
  DGS10         10-year Treasury constant-maturity yield (daily)
  MORTGAGE30US  30-year fixed mortgage average, Freddie Mac PMMS (weekly)
  HOUST         housing starts, thousands of units SAAR (monthly)
Without FRED, the 10-year yield falls back to the CBOE ^TNX quote.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.services import market_calendar as mc
from app.services.community_bots.base import (
    BotPost, Skip, age_hours, bar_chart, fmt_day, fmt_num, fmt_pct, fmt_pp,
)

REITS: Tuple[Tuple[str, str], ...] = (
    ("VNQ", "US REIT ETF"), ("XLRE", "Real Estate Select Sector"), ("PLD", "Industrial"),
    ("AMT", "Towers"), ("EQIX", "Data centers"), ("WELL", "Healthcare"), ("O", "Net lease"),
    ("SPG", "Malls"), ("PSA", "Self storage"), ("AVB", "Apartments"),
)
BUILDERS: Tuple[Tuple[str, str], ...] = (("ITB", "Home construction ETF"), ("XHB", "Homebuilders ETF"))
FRED_NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."


async def collect(hub, now: datetime, slot: str) -> Dict[str, Any]:
    syms = [s for s, _ in REITS + BUILDERS] + ["SPY", "^TNX"]
    return {
        "quotes": await hub.quotes(syms),
        "dgs10": await hub.fred("DGS10", 10),
        "mortgage": await hub.fred("MORTGAGE30US", 6),
        "houst": await hub.fred("HOUST", 3),
    }


def _bp(a: float, b: float) -> str:
    return f"{(a - b) * 100:+.0f} bp".replace("-", "−")


def compose(data: Dict[str, Any], now: datetime, slot: str) -> BotPost:
    q = data.get("quotes") or {}
    reits = [(s, label, q[s]) for s, label in REITS if q.get(s) and q[s].get("change_percent") is not None]
    if len(reits) < 5 or not (q.get("VNQ") or q.get("XLRE")):
        raise Skip("fewer than 5 REIT quotes (or no VNQ/XLRE)")
    stamps = [r[2].get("as_of") for r in reits if r[2].get("as_of")]
    newest = max(stamps) if stamps else None
    if newest is None or (age_hours(newest, now) or 0) > 96:
        raise Skip("REIT quotes are stale")
    expected = mc.last_completed_session(now)
    lead_q = q.get("VNQ") or q.get("XLRE")
    if lead_q.get("session_date") and lead_q["session_date"] != expected:
        raise Skip(f"REIT quotes are from {lead_q['session_date']}, expected the {expected} close")

    dgs10: List = data.get("dgs10") or []
    mort: List = data.get("mortgage") or []
    houst: List = data.get("houst") or []
    tnx = q.get("^TNX")
    ten_y: Optional[Tuple[str, float, Optional[str]]] = None
    rate_rows = []
    sources = ["QuantTrade quote cache (REITs, homebuilder ETFs, SPY)"]
    if dgs10:
        d0, v0 = dgs10[0]
        chg = _bp(v0, dgs10[1][1]) if len(dgs10) > 1 else "n/a"
        ten_y = (f"{v0:.2f}%", v0, chg)
        rate_rows.append(["10-year Treasury yield", f"{v0:.2f}%", fmt_day(d0), chg + " d/d"])
    elif tnx and tnx.get("price"):
        v0 = tnx["price"] / (10 if tnx["price"] > 20 else 1)  # ^TNX is quoted as yield x10 by some feeds
        ten_y = (f"{v0:.2f}%", v0, None)
        rate_rows.append(["10-year Treasury yield (^TNX)", f"{v0:.2f}%", "latest quote",
                          fmt_pct(tnx.get("change_percent"), 1)])
        sources.append("CBOE 10-year yield index (^TNX) quote")
    if ten_y is None:
        raise Skip("no 10-year Treasury yield (FRED DGS10 or ^TNX)")
    if mort:
        d0, v0 = mort[0]
        chg = fmt_pp(v0 - mort[1][1], 2) + " w/w" if len(mort) > 1 else "n/a"
        rate_rows.append(["30-year fixed mortgage (PMMS)", f"{v0:.2f}%", f"week of {fmt_day(d0)}", chg])
        if ten_y:
            rate_rows.append(["Mortgage − 10Y spread", f"{v0 - ten_y[1]:.2f} pp", "", ""])
    if houst:
        d0, v0 = houst[0]
        chg = fmt_pct((v0 / houst[1][1] - 1) * 100, 1) + " m/m" if len(houst) > 1 and houst[1][1] else "n/a"
        rate_rows.append(["Housing starts (SAAR)", f"{v0:,.0f}k", d0.strftime("%b %Y"), chg])
    if dgs10 or mort or houst:
        sources.append("FRED: DGS10 (U.S. Treasury), MORTGAGE30US (Freddie Mac PMMS), HOUST (U.S. Census Bureau)")

    spy = q.get("SPY") or {}
    vnq = q.get("VNQ") or q.get("XLRE")
    vnq_sym = "VNQ" if q.get("VNQ") else "XLRE"
    rel = (vnq["change_percent"] - spy["change_percent"]) if spy.get("change_percent") is not None else None
    up = sum(1 for _, _, r in reits if r["change_percent"] > 0)
    best = max(reits, key=lambda x: x[2]["change_percent"])
    worst = min(reits, key=lambda x: x[2]["change_percent"])

    title = (f"\U0001F916 Real Estate & Rates: {vnq_sym} {fmt_pct(vnq['change_percent'])}"
             + (f" ({fmt_pp(rel)} vs SPY)" if rel is not None else "")
             + f", 10Y {ten_y[0]}" + (f", 30Y mortgage {mort[0][1]:.2f}%" if mort else ""))
    lead = (f"{up} of {len(reits)} tracked REITs/ETFs rose on the session; "
            f"{vnq_sym} {fmt_pct(vnq['change_percent'])} vs SPY {fmt_pct(spy.get('change_percent'))}.")
    highlights = [
        f"Best: ${best[0]} ({best[1]}) {fmt_pct(best[2]['change_percent'])}; "
        f"weakest: ${worst[0]} ({worst[1]}) {fmt_pct(worst[2]['change_percent'])}.",
        f"10-year Treasury yield {ten_y[0]}" + (f" ({ten_y[2]} d/d)." if ten_y[2] and ten_y[2] != "n/a" else "."),
    ]
    if mort:
        highlights.append(f"30-year fixed mortgage rate {mort[0][1]:.2f}% (Freddie Mac PMMS, week of {fmt_day(mort[0][0])}).")
    builders = [(s, label, q[s]) for s, label in BUILDERS if q.get(s) and q[s].get("change_percent") is not None]
    for s, label, r in builders:
        highlights.append(f"${s} ({label}) {fmt_pct(r['change_percent'])}.")

    tables = [
        {"title": "REITs by property type", "columns": ["Ticker", "Segment", "Price", "Day"],
         "rows": [[f"${s}", label, fmt_num(r["price"]), fmt_pct(r["change_percent"])] for s, label, r in reits]},
        {"title": "Rates & housing", "columns": ["Series", "Latest", "Period", "Change"], "rows": rate_rows},
    ]
    chart = bar_chart("REIT day change (%)", [(s, r["change_percent"]) for s, _, r in
                                             sorted(reits, key=lambda x: -x[2]["change_percent"])])
    notes = ["Rates are the latest published observations; weekly and monthly series lag the market."]
    if dgs10 or mort or houst:
        notes.append(FRED_NOTICE)
    return BotPost(
        title=title[:300],
        lead=lead,
        as_of=newest,
        sources=sources,
        highlights=highlights,
        tables=tables,
        chart=chart,
        tickers=[vnq_sym, best[0], worst[0]] if best[0] != worst[0] else [vnq_sym],
        sentiment="neutral",
        notes=notes,
    )
