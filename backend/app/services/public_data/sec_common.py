"""Shared SEC helpers: ticker <-> CIK map, ET -> UTC timestamps, universe."""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from app.services.public_data.http import get_fetcher

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
ET = ZoneInfo("America/New_York")

_MAP: Optional[Tuple[float, Dict[str, Tuple[str, str]]]] = None
_LOCK = threading.Lock()


def ticker_map() -> Dict[str, Tuple[str, str]]:
    """TICKER -> (10-digit CIK, company title) from SEC company_tickers.json (cached 24h)."""
    global _MAP
    with _LOCK:
        if _MAP and time.time() - _MAP[0] < 6 * 3600:
            return _MAP[1]
    raw = json.loads(get_fetcher().get(TICKERS_URL, ttl_h=24, accept="application/json"))
    m = {str(v["ticker"]).upper(): (str(v["cik_str"]).zfill(10), str(v.get("title") or "")) for v in raw.values()}
    with _LOCK:
        _MAP = (time.time(), m)
    return m


def reset_ticker_map() -> None:
    global _MAP
    with _LOCK:
        _MAP = None


def norm_ticker(t: str) -> str:
    return (t or "").strip().upper().replace(".", "-")


def cik_for(ticker: str) -> Optional[str]:
    hit = ticker_map().get(norm_ticker(ticker))
    return hit[0] if hit else None


def tickers_by_cik() -> Dict[str, str]:
    """CIK -> first-listed ticker (SEC lists the primary class first)."""
    out: Dict[str, str] = {}
    for t, (cik, _) in ticker_map().items():
        out.setdefault(cik, t)
    return out


def et_to_utc(s: str) -> Optional[datetime]:
    """'2026-08-04 17:40:00.0' (EDGAR acceptance, US Eastern) -> aware UTC datetime."""
    if not s:
        return None
    s = s.strip().replace("T", " ").rstrip("Z")
    if "." in s:
        s = s.split(".", 1)[0]
    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            dt = datetime.strptime(s[:10], "%Y-%m-%d")
        except ValueError:
            return None
    return dt.replace(tzinfo=ET).astimezone(timezone.utc)


def iso_utc(s: str) -> Optional[datetime]:
    """'2026-11-23T21:54:28.000Z' (submissions acceptanceDateTime, UTC) -> aware datetime."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def date_end_of_day_et(d: str) -> datetime:
    """A publication *date* with no time: treat as available at 18:00 US Eastern that day
    (after the close), so a same-day backtest bar never sees it."""
    y, m, dd = (int(x) for x in d[:10].split("-"))
    return datetime(y, m, dd, 18, 0, tzinfo=ET).astimezone(timezone.utc)


def add_business_days(d: date, n: int) -> date:
    out = d
    while n > 0:
        out += timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


DEFAULT_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "JNJ", "UNH", "XOM", "V", "LLY",
    "AVGO", "PG", "HD", "MA", "CVX", "ABBV", "MRK", "COST", "PEP", "KO", "ADBE", "CRM", "TMO", "ACN",
    "MCD", "CSCO", "BAC", "WMT", "NKE", "ABT", "LIN", "DHR", "AMD", "INTC", "NFLX", "ORCL", "QCOM",
]


def universe(extra: Iterable[str] = ()) -> List[str]:
    """Tickers the refresh jobs cover: the copilot SEC universe + PUBLIC_DATA_UNIVERSE (comma list)
    + tickers users looked at (passed in by the caller)."""
    env = [t for t in os.getenv("PUBLIC_DATA_UNIVERSE", "").replace(" ", "").split(",") if t]
    seen, out = set(), []
    for t in [*DEFAULT_UNIVERSE, *env, *extra]:
        t = norm_ticker(t)
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out[: int(os.getenv("PUBLIC_DATA_MAX_UNIVERSE", "500"))]
