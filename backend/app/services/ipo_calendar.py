"""
IPO calendar sources.

Finnhub's free-tier ``/calendar/ipo`` frequently returns ``{"ipoCalendar": []}``
for the forward window, which left the IPO Radar widget empty. The Nasdaq
public IPO calendar JSON (``api.nasdaq.com/api/ipo/calendar?date=YYYY-MM``) is
free, keyless and needs only a browser-like User-Agent, so it is used as a
fallback. Results are cached in-process to keep upstream traffic low.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

NASDAQ_IPO_URL = "https://api.nasdaq.com/api/ipo/calendar"
NASDAQ_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}

_CACHE_TTL_SECONDS = 1800
_cache: Dict[str, Any] = {"at": 0.0, "rows": []}


def _iso_date(raw: Any) -> str:
    """Nasdaq dates are MM/DD/YYYY; return YYYY-MM-DD (or '' when unparseable)."""
    s = str(raw or "").strip()
    if not s:
        return ""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def _to_int(raw: Any) -> Optional[int]:
    s = str(raw or "").replace(",", "").replace("$", "").strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _rows(section: Any) -> List[dict]:
    """Nasdaq nests rows at section.rows or section.upcomingTable.rows; rows may be null."""
    if not isinstance(section, dict):
        return []
    rows = section.get("rows")
    if rows is None and isinstance(section.get("upcomingTable"), dict):
        rows = section["upcomingTable"].get("rows")
    return [r for r in (rows or []) if isinstance(r, dict)]


def _row(r: dict, dt: str, status: str) -> Optional[dict]:
    name = str(r.get("companyName") or "").strip()
    sym = str(r.get("proposedTickerSymbol") or "").strip() or None
    if not name and not sym:
        return None
    price = str(r.get("proposedSharePrice") or "").strip() or None
    return {
        "date": dt,
        "symbol": sym,
        "name": name or sym,
        "exchange": str(r.get("proposedExchange") or "").strip() or None,
        "status": status,
        "price": price,
        "shares": _to_int(r.get("sharesOffered")),
    }


def parse_nasdaq_ipo_calendar(payload: Any) -> Dict[str, List[dict]]:
    """
    Parse one Nasdaq monthly IPO calendar payload into normalized rows grouped by
    status: ``expected`` (upcoming), ``priced`` and ``filed``. Row shape matches
    ``/api/v1/market/ipo-calendar``: date, symbol, name, exchange, status, price, shares.
    """
    out: Dict[str, List[dict]] = {"expected": [], "priced": [], "filed": []}
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return out

    for r in _rows(data.get("upcoming")):
        row = _row(r, _iso_date(r.get("expectedPriceDate")), "expected")
        if row:
            out["expected"].append(row)
    for r in _rows(data.get("priced")):
        row = _row(r, _iso_date(r.get("pricedDate")), "priced")
        if row:
            out["priced"].append(row)
    for r in _rows(data.get("filed")):
        row = _row(r, _iso_date(r.get("filedDate")), "filed")
        if row:
            out["filed"].append(row)
    return out


def _month_keys(today: date, back: int = 1, forward: int = 1) -> List[str]:
    keys = []
    for offset in range(-back, forward + 1):
        m = today.month - 1 + offset
        y = today.year + m // 12
        keys.append(f"{y:04d}-{m % 12 + 1:02d}")
    return keys


def merge_ipo_rows(groups: List[Dict[str, List[dict]]], today: date, limit: int = 40) -> List[dict]:
    """
    Merge monthly groups into one pipeline list: upcoming (soonest first), then
    recently priced (newest first), then fresh filings (newest first). De-duplicated
    by (symbol or name, status).
    """
    today_iso = today.isoformat()
    expected: List[dict] = []
    priced: List[dict] = []
    filed: List[dict] = []
    seen = set()
    for g in groups:
        for bucket, target in (("expected", expected), ("priced", priced), ("filed", filed)):
            for row in g.get(bucket, []):
                key = ((row.get("symbol") or row.get("name") or "").upper(), row["status"])
                if key in seen:
                    continue
                seen.add(key)
                target.append(row)

    expected = [r for r in expected if not r["date"] or r["date"] >= today_iso]
    expected.sort(key=lambda r: r["date"] or "9999")
    priced.sort(key=lambda r: r["date"], reverse=True)
    filed.sort(key=lambda r: r["date"], reverse=True)
    return (expected + priced + filed)[:limit]


async def fetch_nasdaq_ipo_calendar(today: Optional[date] = None, limit: int = 40) -> List[dict]:
    """Fetch previous, current and next month from Nasdaq (cached 30 min). Never raises."""
    now = time.time()
    if _cache["rows"] and now - _cache["at"] < _CACHE_TTL_SECONDS:
        return list(_cache["rows"])[:limit]

    today = today or datetime.utcnow().date()
    groups: List[Dict[str, List[dict]]] = []
    try:
        async with httpx.AsyncClient(timeout=12.0, headers=NASDAQ_HEADERS) as client:
            for key in _month_keys(today):
                try:
                    r = await client.get(NASDAQ_IPO_URL, params={"date": key})
                    if r.status_code != 200:
                        logger.info("Nasdaq IPO calendar %s HTTP %s", key, r.status_code)
                        continue
                    groups.append(parse_nasdaq_ipo_calendar(r.json()))
                except Exception as exc:  # noqa: BLE001 — one bad month must not drop the rest
                    logger.info("Nasdaq IPO calendar %s failed: %s", key, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Nasdaq IPO calendar fetch failed: %s", exc)

    rows = merge_ipo_rows(groups, today, limit=max(limit, 40))
    if rows:
        _cache["rows"] = rows
        _cache["at"] = now
    return rows[:limit]
