"""Sentiment Pulse: aggregate news tone from our news-intel classifier.

Input: news_items classified in the last 24h and the 24h before (headline
metadata only). Per ticker and per sector we count bullish / bearish /
neutral headlines; net tone = (bullish - bearish) / headlines, in -1..+1.
"Movers in sentiment" = change in net tone vs the prior 24h for tickers with
at least MIN_MENTIONS headlines in both windows.

Only aggregates (counts / scores) are published; up to three headlines are
shown as a short title + link to the publisher.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.services.community_bots.base import (
    BotPost, Skip, bar_chart, clip_title, fmt_et, require_fresh,
)

MIN_ITEMS = 20
MIN_MENTIONS = 3
TOP_N = 8


async def collect(hub, now: datetime, slot: str) -> Dict[str, Any]:
    rows = await hub.news(now - timedelta(hours=48), now)
    sectors = {}
    for r in rows:
        for t in r.get("tickers") or []:
            if t not in sectors:
                sectors[t] = hub.sector_of(t)
    return {"news": rows, "sectors": sectors}


def _tone(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    agg: Dict[str, Dict[str, float]] = defaultdict(lambda: {"n": 0, "bull": 0, "bear": 0, "neu": 0})
    for r in rows:
        lab = (r.get("sentiment_label") or "").lower()
        for t in dict.fromkeys(r.get("tickers") or []):
            a = agg[t]
            a["n"] += 1
            a["bull" if lab == "bullish" else "bear" if lab == "bearish" else "neu"] += 1
    for a in agg.values():
        a["net"] = round((a["bull"] - a["bear"]) / a["n"], 2) if a["n"] else 0.0
    return agg


def _fmt_net(v: Optional[float]) -> str:
    return "n/a" if v is None else f"{v:+.2f}".replace("-", "−")


def compose(data: Dict[str, Any], now: datetime, slot: str) -> BotPost:
    rows = [r for r in data.get("news") or [] if r.get("published_at") and r.get("sentiment_label")]
    cur = [r for r in rows if r["published_at"] > now - timedelta(hours=24)]
    prev = [r for r in rows if r["published_at"] <= now - timedelta(hours=24)]
    if len(cur) < MIN_ITEMS:
        raise Skip(f"only {len(cur)} classified headlines in the last 24h (need {MIN_ITEMS})")
    newest = max(r["published_at"] for r in cur)
    require_fresh(newest, now, 6, "newest classified headline")

    labels = [(r["sentiment_label"] or "").lower() for r in cur]
    n_bull, n_bear = labels.count("bullish"), labels.count("bearish")
    n_neu = len(labels) - n_bull - n_bear
    market_net = round((n_bull - n_bear) / len(cur), 2)

    tone, tone_prev = _tone(cur), _tone(prev)
    ranked = [(t, a) for t, a in tone.items() if a["n"] >= MIN_MENTIONS]
    if len(ranked) < 3:
        raise Skip("fewer than 3 tickers with enough headlines to aggregate")
    ranked.sort(key=lambda x: (-x[1]["n"], x[0]))
    top = ranked[:TOP_N]

    def delta(t: str) -> Optional[float]:
        p = tone_prev.get(t)
        if not p or p["n"] < MIN_MENTIONS:
            return None
        return round(tone[t]["net"] - p["net"], 2)

    movers = [(t, delta(t)) for t, _ in ranked if delta(t) is not None]
    movers.sort(key=lambda x: (-abs(x[1]), x[0]))
    most_pos = max(ranked, key=lambda x: (x[1]["net"], x[1]["n"]))
    most_neg = min(ranked, key=lambda x: (x[1]["net"], -x[1]["n"]))

    sec_map: Dict[str, Optional[str]] = data.get("sectors") or {}
    sec_agg: Dict[str, Dict[str, float]] = defaultdict(lambda: {"n": 0, "bull": 0, "bear": 0})
    for r in cur:
        lab = (r["sentiment_label"] or "").lower()
        for s in {sec_map.get(t) for t in r.get("tickers") or [] if sec_map.get(t)}:
            sec_agg[s]["n"] += 1
            sec_agg[s]["bull"] += lab == "bullish"
            sec_agg[s]["bear"] += lab == "bearish"
    sectors: List[Tuple[str, float, int]] = sorted(
        ((s, round((a["bull"] - a["bear"]) / a["n"], 2), int(a["n"])) for s, a in sec_agg.items() if a["n"] >= MIN_MENTIONS),
        key=lambda x: (-x[1], x[0]))

    title = (f"\U0001F916 Sentiment Pulse: news tone {_fmt_net(market_net)} across {len(cur)} headlines; "
             f"most positive ${most_pos[0]}, most negative ${most_neg[0]}")
    lead = (f"Aggregate tone of {len(cur)} classified market headlines from the last 24 hours: "
            f"{n_bull} bullish, {n_bear} bearish, {n_neu} neutral (net {_fmt_net(market_net)} on a −1..+1 scale).")
    highlights = [
        f"Most positive coverage: ${most_pos[0]} (net {_fmt_net(most_pos[1]['net'])}, {int(most_pos[1]['n'])} headlines).",
        f"Most negative coverage: ${most_neg[0]} (net {_fmt_net(most_neg[1]['net'])}, {int(most_neg[1]['n'])} headlines).",
    ]
    if sectors:
        highlights.append(f"Sector tone leader: {sectors[0][0]} ({_fmt_net(sectors[0][1])}); "
                          f"laggard: {sectors[-1][0]} ({_fmt_net(sectors[-1][1])}).")
    for t, d in movers[:3]:
        highlights.append(f"Tone shift ${t}: {_fmt_net(d)} vs the prior 24h "
                          f"({_fmt_net(tone_prev[t]['net'])} → {_fmt_net(tone[t]['net'])}).")

    table = {
        "title": "Most-covered tickers, last 24h",
        "columns": ["Ticker", "Headlines", "Bullish", "Bearish", "Net tone", "Δ vs prior 24h"],
        "rows": [[f"${t}", int(a["n"]), int(a["bull"]), int(a["bear"]), _fmt_net(a["net"]), _fmt_net(delta(t))]
                 for t, a in top],
    }
    chart = bar_chart("Net news tone by sector (−1..+1)", [(s, v) for s, v, _ in sectors[:12]], unit="")

    # Up to 3 headlines: highest impact among the top tickers; title + link only.
    top_set = {t for t, _ in top}
    picks = sorted((r for r in cur if r.get("url") and set(r.get("tickers") or []) & top_set),
                   key=lambda r: (-(r.get("impact") or 0), -r["published_at"].timestamp()))
    links, seen = [], set()
    for r in picks:
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        links.append({"title": clip_title(r["title"]), "url": r["url"], "source": r.get("source") or "publisher"})
        if len(links) == 3:
            break

    return BotPost(
        title=title[:300],
        lead=lead,
        as_of=newest,
        sources=["QuantTrade news intelligence (headline sentiment classifier)",
                 "headline metadata from licensed/public news feeds"],
        highlights=highlights,
        tables=[table],
        chart=chart,
        links=links,
        tickers=[t for t, _ in top[:5]],
        sentiment="bullish" if market_net >= 0.15 else "bearish" if market_net <= -0.15 else "neutral",
        notes=[f"Tone is a count of model-classified headlines, not a price signal. Window ends {fmt_et(now)}."],
    )
