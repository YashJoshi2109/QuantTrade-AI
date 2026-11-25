"""Single source of truth for market breadth (up / down / flat) and quote staleness.

FLAT_THRESHOLD_PCT must match `FLAT_THRESHOLD_PCT` in
frontend/src/lib/marketBreadth.ts — both the summary cards and the heatmap
count with it, so their numbers always agree.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal, Mapping, Optional

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


# ── Quote sanity ─────────────────────────────────────────────────────────────
# A one-day move beyond ±50% in a large/mid-cap universe is almost always a bad
# previous_close (delisted / renamed / reverse-split ticker), e.g. PARA +8116%.
# Such rows are dropped rather than shown as movers or averaged into sectors.
MAX_PLAUSIBLE_MOVE_PCT = 50.0


def is_implausible_move(change_percent: Any) -> bool:
    try:
        pct = float(change_percent or 0)
    except (TypeError, ValueError):
        return True
    if pct != pct:  # NaN
        return True
    return abs(pct) > MAX_PLAUSIBLE_MOVE_PCT


def is_usable_quote(quote: Optional[Mapping[str, Any]], now: Optional[datetime] = None) -> bool:
    """True when a quote may be shown in movers / sectors / breadth.

    Rejects missing/unavailable quotes, non-positive prices, stale last trades
    (``is_stale_quote``) and implausible one-day moves (``is_implausible_move``).
    """
    if not quote or quote.get("unavailable"):
        return False
    try:
        price = float(quote.get("price") or 0)
    except (TypeError, ValueError):
        return False
    if price <= 0:
        return False
    if is_stale_quote(quote, now=now):
        return False
    return not is_implausible_move(quote.get("change_percent"))


def robust_sector_change(changes: Iterable[Optional[float]]) -> float:
    """Sector change % as the median of member moves.

    A raw mean lets one bad row (PARA +8116%) drag a whole sector to +204%;
    the median is unaffected by a single outlier.
    """
    vals = sorted(float(c) for c in changes if c is not None and float(c) == float(c))
    if not vals:
        return 0.0
    mid = len(vals) // 2
    if len(vals) % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0
