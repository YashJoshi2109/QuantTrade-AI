"""Single source of truth for market breadth (up / down / flat) and quote staleness.

FLAT_THRESHOLD_PCT must match `FLAT_THRESHOLD_PCT` in
frontend/src/lib/marketBreadth.ts — both the summary cards and the heatmap
count with it, so their numbers always agree.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Mapping, Optional

# A move within ±0.1% is "flat" (same band the heatmap colors neutral grey).
FLAT_THRESHOLD_PCT = 0.1

# A quote whose last trade is older than this is a dead/halted/delisted ticker,
# not a real 0% day (longest US market closure is a 4-day weekend).
STALE_QUOTE_MAX_AGE = timedelta(days=5)

Direction = Literal["up", "down", "flat"]


def classify_change(change_percent: Optional[float]) -> Direction:
    pct = float(change_percent or 0)
    if pct > FLAT_THRESHOLD_PCT:
        return "up"
    if pct < -FLAT_THRESHOLD_PCT:
        return "down"
    return "flat"


def _parse_time(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
        elif isinstance(value, datetime):
            dt = value
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_stale_quote(quote: Optional[Mapping[str, Any]], now: Optional[datetime] = None) -> bool:
    """True when the quote's last *trade* (``market_time``) is older than STALE_QUOTE_MAX_AGE.

    Quotes without ``market_time`` (older cache rows, sources that don't report it)
    are treated as fresh so nothing disappears until a real trade time is known.
    """
    if not quote:
        return False
    traded_at = _parse_time(quote.get("market_time"))
    if traded_at is None:
        return False
    now = now or datetime.now(timezone.utc)
    return now - traded_at > STALE_QUOTE_MAX_AGE
