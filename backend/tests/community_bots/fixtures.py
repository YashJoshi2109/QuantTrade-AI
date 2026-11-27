"""Deterministic fixture data + a fake DataHub for community bot tests."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services.community_bots.data import DataHub

# Tue 2026-11-24 16:25 ET (EST = UTC-5): a regular trading day, after the close.
NOW = datetime(2026, 11, 24, 21, 25, tzinfo=timezone.utc)
SESSION = date(2026, 11, 24)
PRE_OPEN_NOW = datetime(2026, 11, 24, 14, 0, tzinfo=timezone.utc)   # 09:00 ET
MIDDAY_NOW = datetime(2026, 11, 24, 17, 0, tzinfo=timezone.utc)     # 12:00 ET
MORNING_NOW = datetime(2026, 11, 24, 13, 0, tzinfo=timezone.utc)    # 08:00 ET
EVENING_NOW = datetime(2026, 11, 24, 23, 30, tzinfo=timezone.utc)   # 18:30 ET

SECTORS = ["Technology", "Healthcare", "Financials", "Energy", "Utilities", "Real Estate"]
# Distinctive text that must never be copied into a post.
ARTICLE_SUMMARY = "EXCLUSIVE-BODY-TEXT: the quick brown analyst jumped over the lazy consensus model."


def _rows(at: datetime) -> List[Dict[str, Any]]:
    rows = []
    for i in range(300):
        sector = SECTORS[i % len(SECTORS)]
        # 190 up, 100 down, 10 flat; deterministic spread of moves
        if i < 190:
            chg = 0.2 + (i % 19) * 0.12
        elif i < 290:
            chg = -0.2 - (i % 13) * 0.1
        else:
            chg = 0.0
        rows.append({"symbol": f"S{i:03d}", "name": f"Stock {i}", "sector": sector, "price": 100.0 + i,
                     "change_percent": round(chg, 2), "volume": 1_000_000, "market_cap": 1e10 + i * 1e8})
    # Big movers with technical signals
    rows += [
        {"symbol": "NVDA", "name": "NVIDIA", "sector": "Technology", "price": 210.0, "change_percent": 6.4,
         "volume": 9_000_000, "market_cap": 5e12},
        {"symbol": "AMD", "name": "AMD", "sector": "Technology", "price": 180.0, "change_percent": 4.1,
         "volume": 5_000_000, "market_cap": 3e11},
        {"symbol": "XOM", "name": "Exxon", "sector": "Energy", "price": 101.0, "change_percent": -3.2,
         "volume": 4_000_000, "market_cap": 4e11},
        {"symbol": "PFE", "name": "Pfizer", "sector": "Healthcare", "price": 24.0, "change_percent": -5.0,
         "volume": 8_000_000, "market_cap": 1.4e11},
    ]
    return rows


def breadth(at: datetime = NOW, session: date = SESSION) -> Dict[str, Any]:
    rows = _rows(at)
    up = sum(1 for r in rows if r["change_percent"] > 0.1)
    down = sum(1 for r in rows if r["change_percent"] < -0.1)
    return {
        "up": up, "down": down, "flat": len(rows) - up - down, "total": len(rows),
        "universe_size": len(rows), "newest_quote_at": at - timedelta(minutes=10),
        "oldest_quote_at": at - timedelta(minutes=40), "session_date": session,
        "sectors": [("Technology", 1.2, 50), ("Utilities", 0.6, 50), ("Healthcare", -0.3, 50),
                    ("Energy", -0.8, 50), ("Financials", 0.4, 50), ("Real Estate", 0.1, 50)],
        "rows": rows,
    }


def quote(sym: str, price: float, chg: float, at: datetime = NOW, session: date = SESSION,
          ext: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {"symbol": sym, "name": sym, "price": price, "change_percent": chg,
            "previous_close": round(price / (1 + chg / 100), 2), "as_of": at - timedelta(minutes=25),
            "session_date": session, "extended": ext, "source": "fixture"}


QUOTES = {
    "SPY": (602.5, 0.85), "QQQ": (520.1, 1.2), "IWM": (231.0, -0.3), "^VIX": (15.2, -4.0),
    "VNQ": (92.4, -0.4), "XLRE": (41.3, -0.35), "PLD": (118.0, 0.6), "AMT": (205.0, -1.1),
    "EQIX": (880.0, 1.4), "WELL": (140.0, 0.2), "O": (57.0, -0.8), "SPG": (175.0, 0.9),
    "PSA": (300.0, -0.2), "AVB": (225.0, 0.1), "ITB": (110.0, 1.6), "XHB": (105.0, 1.1),
    "^TNX": (43.1, 0.5),
}

TECHNICALS = {
    "SPY": {"price": 602.5, "sma_50": 590.0, "sma_200": 560.0, "rsi_14": 61.0},
    "NVDA": {"price": 210.0, "high_52w": 210.5, "low_52w": 120.0, "rsi_14": 74.0, "volume_ratio": 2.6,
             "sma_200": 170.0},
    "AMD": {"price": 180.0, "high_52w": 230.0, "low_52w": 110.0, "rsi_14": 58.0, "volume_ratio": 1.2,
            "sma_200": 178.5},
    "XOM": {"price": 101.0, "high_52w": 125.0, "low_52w": 100.8, "rsi_14": 33.0, "volume_ratio": 1.4,
            "sma_200": 112.0},
    "PFE": {"price": 24.0, "high_52w": 31.0, "low_52w": 22.0, "rsi_14": 27.0, "volume_ratio": 3.1,
            "sma_200": 26.0},
}


def news_rows(now: datetime = NOW) -> List[Dict[str, Any]]:
    rows = []
    spec = [("NVDA", "bullish", 6), ("NVDA", "neutral", 2), ("TSLA", "bearish", 5), ("TSLA", "neutral", 1),
            ("AAPL", "bullish", 3), ("AAPL", "bearish", 1), ("XOM", "bearish", 3), ("JPM", "neutral", 4)]
    k = 0
    for t, lab, n in spec:
        for j in range(n):
            k += 1
            rows.append({"title": f"{t} headline number {k} about the company and its quarter " * 3,
                         "summary": ARTICLE_SUMMARY, "url": f"https://news.example.com/{t.lower()}/{k}",
                         "source": "Example Wire", "tickers": [t], "sentiment_label": lab,
                         "sentiment_score": 0.7 if lab == "bullish" else -0.7 if lab == "bearish" else 0.0,
                         "impact": 50 + k, "published_at": now - timedelta(hours=1 + k * 0.3),
                         "primary_category": "earnings"})
    # Prior 24h window: NVDA was neutral-ish, TSLA was neutral
    for t, lab, n in [("NVDA", "neutral", 3), ("NVDA", "bearish", 1), ("TSLA", "neutral", 3), ("AAPL", "bullish", 3)]:
        for j in range(n):
            k += 1
            rows.append({"title": f"Older {t} story {k}", "summary": ARTICLE_SUMMARY,
                         "url": f"https://news.example.com/old/{k}", "source": "Example Wire", "tickers": [t],
                         "sentiment_label": lab, "sentiment_score": 0.0, "impact": 10,
                         "published_at": now - timedelta(hours=30 + j), "primary_category": "markets"})
    return rows


SECTOR_OF = {"NVDA": "Technology", "AAPL": "Technology", "TSLA": "Consumer Cyclical", "XOM": "Energy",
             "JPM": "Financials"}


def earnings_window() -> Dict[str, Any]:
    return {"sources": {"finnhub": True, "nasdaq": True}, "rows": [
        # yesterday after close, reported
        {"symbol": "ZM", "date": "2026-11-23", "hour": "amc", "name": "Zoom", "eps_actual": 1.52,
         "eps_estimate": 1.41, "eps_surprise_pct": 7.8, "revenue_surprise_pct": 1.2, "market_cap": 2.4e10,
         "status": "reported"},
        # today before open, reported
        {"symbol": "DE", "date": "2026-11-24", "hour": "bmo", "name": "Deere", "eps_actual": 3.9,
         "eps_estimate": 4.1, "eps_surprise_pct": -4.9, "revenue_surprise_pct": -0.8, "market_cap": 1.2e11,
         "status": "reported"},
        # today after close, reported in the evening
        {"symbol": "DELL", "date": "2026-11-24", "hour": "amc", "name": "Dell Technologies", "eps_actual": 2.3,
         "eps_estimate": 2.1, "eps_surprise_pct": 9.5, "revenue_surprise_pct": 2.0, "market_cap": 9e10,
         "status": "reported"},
        {"symbol": "HPQ", "date": "2026-11-24", "hour": "amc", "name": "HP Inc", "eps_actual": None,
         "eps_estimate": 0.93, "eps_surprise_pct": None, "market_cap": 3e10, "status": "upcoming"},
        # tomorrow
        {"symbol": "XYZ", "date": "2026-11-25", "hour": "bmo", "name": "Example Co", "eps_actual": None,
         "eps_estimate": 0.5, "market_cap": 5e9, "status": "upcoming"},
        {"symbol": "ABC", "date": "2026-11-25", "hour": "amc", "name": "Alpha Beta", "eps_actual": None,
         "eps_estimate": 1.25, "market_cap": 8e9, "status": "upcoming"},
    ]}


def closes(sym: str, last_day: date = SESSION) -> List[Tuple[date, float]]:
    # 60 business days ending on last_day; each ETF has its own drift.
    drift = {"XLK": 0.004, "XLC": 0.002, "XLY": 0.001, "XLP": -0.001, "XLE": -0.003, "XLF": 0.0015,
             "XLV": 0.0005, "XLI": 0.001, "XLB": -0.0005, "XLRE": -0.002, "XLU": 0.0025, "SPY": 0.001}[sym]
    out, d, px = [], last_day, 100.0
    days = []
    while len(days) < 60:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    for i, dd in enumerate(days):
        # recent 5-day kick for XLU to exercise rotation
        bump = 0.01 if sym == "XLE" and i >= 55 else 0.0
        px = px * (1 + drift + bump)
        out.append((dd, round(px, 4)))
    return out


FRED = {
    "DGS10": [(date(2026, 11, 23), 4.31), (date(2026, 11, 20), 4.28)],
    "MORTGAGE30US": [(date(2026, 11, 19), 6.81), (date(2026, 11, 12), 6.86)],
    "HOUST": [(date(2026, 10, 1), 1352.0), (date(2026, 9, 1), 1310.0)],
}


class FakeHub(DataHub):
    def __init__(self, now: datetime = NOW, session: date = SESSION, **over):
        self.now, self.session, self.over = now, session, over

    async def quotes(self, symbols: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        if "quotes" in self.over:
            return self.over["quotes"]
        ext = {"price": 604.0, "change_percent": 0.25, "session": "pre-market"}
        return {s: quote(s, *QUOTES[s], at=self.now, session=self.session, ext=ext if s == "SPY" else None)
                for s in symbols if s in QUOTES}

    async def breadth(self):
        return self.over["breadth"] if "breadth" in self.over else breadth(self.now, self.session)

    async def technicals(self, symbol: str):
        return TECHNICALS.get(symbol)

    async def closes(self, symbol: str, period: str = "3mo"):
        if "closes" in self.over:
            return self.over["closes"].get(symbol, [])
        return closes(symbol, self.session)

    async def news(self, since: datetime, until: datetime):
        rows = self.over.get("news", news_rows(self.now))
        return [r for r in rows if since <= r["published_at"] < until]

    async def earnings(self, start: date, end: date):
        return self.over.get("earnings", earnings_window())

    async def fred(self, series_id: str, limit: int = 30):
        return (self.over.get("fred") if "fred" in self.over else FRED).get(series_id, [])

    def sector_of(self, symbol: str):
        return SECTOR_OF.get(symbol)
