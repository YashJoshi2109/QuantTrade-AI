"""US equity market calendar (NYSE / Nasdaq): full-day holidays, 1 pm early
closes and the session a given instant falls in.

Rule-based (no data files, no network) so it works for any year:

  New Year's Day (Sat -> no weekday holiday, Sun -> Mon), MLK Day (3rd Mon
  Jan), Washington's Birthday (3rd Mon Feb), Good Friday, Memorial Day (last
  Mon May), Juneteenth (from 2022), Independence Day, Labor Day (1st Mon
  Sep), Thanksgiving (4th Thu Nov), Christmas.  Fixed-date holidays on a
  Saturday are observed on Friday, on a Sunday on Monday.

  Early close (13:00 ET): the day after Thanksgiving, Christmas Eve and
  July 3rd when they are regular weekdays.

Sessions (America/New_York): pre-market 04:00-09:30, regular 09:30-16:00
(13:00 on early-close days), after-hours until 20:00, otherwise closed.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from typing import Dict, Optional

from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
PRE_OPEN = time(4, 0)
OPEN = time(9, 30)
CLOSE = time(16, 0)
EARLY_CLOSE = time(13, 0)
POST_CLOSE = time(20, 0)

PRE_MARKET, REGULAR, AFTER_HOURS, CLOSED = "pre-market", "regular", "after-hours", "closed"


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _easter(year: int) -> date:
    """Anonymous Gregorian algorithm."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def _observed(d: date) -> date:
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=64)
def holidays(year: int) -> Dict[date, str]:
    out: Dict[date, str] = {}
    ny = date(year, 1, 1)
    if ny.weekday() != 5:                       # NYSE does not close Fri Dec 31 for a Saturday New Year
        out[_observed(ny)] = "New Year's Day"
    out[_nth_weekday(year, 1, 0, 3)] = "Martin Luther King Jr. Day"
    out[_nth_weekday(year, 2, 0, 3)] = "Washington's Birthday"
    out[_easter(year) - timedelta(days=2)] = "Good Friday"
    out[_last_weekday(year, 5, 0)] = "Memorial Day"
    if year >= 2022:
        out[_observed(date(year, 6, 19))] = "Juneteenth"
    out[_observed(date(year, 7, 4))] = "Independence Day"
    out[_nth_weekday(year, 9, 0, 1)] = "Labor Day"
    out[_nth_weekday(year, 11, 3, 4)] = "Thanksgiving Day"
    out[_observed(date(year, 12, 25))] = "Christmas Day"
    return out


def holiday_name(d: date) -> Optional[str]:
    return holidays(d.year).get(d)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and holiday_name(d) is None


@lru_cache(maxsize=64)
def early_closes(year: int) -> frozenset:
    days = {_nth_weekday(year, 11, 3, 4) + timedelta(days=1), date(year, 12, 24), date(year, 7, 3)}
    return frozenset(d for d in days if is_trading_day(d))


def close_time(d: date) -> time:
    return EARLY_CLOSE if d in early_closes(d.year) else CLOSE


def _to_et(at: Optional[datetime]) -> datetime:
    at = at or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return at.astimezone(ET)


def session_at(at: Optional[datetime] = None) -> str:
    """pre-market | regular | after-hours | closed for an instant."""
    et = _to_et(at)
    d, t = et.date(), et.time()
    if not is_trading_day(d):
        return CLOSED
    close = close_time(d)
    if PRE_OPEN <= t < OPEN:
        return PRE_MARKET
    if OPEN <= t < close:
        return REGULAR
    if close <= t < POST_CLOSE:
        return AFTER_HOURS
    return CLOSED


def previous_trading_day(d: date) -> date:
    d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def next_open(at: Optional[datetime] = None) -> datetime:
    et = _to_et(at)
    d = et.date()
    if not (is_trading_day(d) and et.time() < OPEN):
        d += timedelta(days=1)
        while not is_trading_day(d):
            d += timedelta(days=1)
    return datetime.combine(d, OPEN, tzinfo=ET)


def session_open_at(at: Optional[datetime] = None) -> Optional[datetime]:
    """Start of the current regular session (None when not in one)."""
    et = _to_et(at)
    if session_at(et) != REGULAR:
        return None
    return datetime.combine(et.date(), OPEN, tzinfo=ET)


@dataclass(frozen=True)
class MarketState:
    session: str
    is_open: bool
    holiday: Optional[str]
    early_close: bool
    now_et: datetime
    next_open: datetime
    close_today: Optional[time]


def market_state(at: Optional[datetime] = None) -> MarketState:
    et = _to_et(at)
    d = et.date()
    s = session_at(et)
    return MarketState(session=s, is_open=s == REGULAR, holiday=holiday_name(d),
                       early_close=d in early_closes(d.year), now_et=et, next_open=next_open(et),
                       close_today=close_time(d) if is_trading_day(d) else None)


def label(session: str, holiday: Optional[str] = None) -> str:
    if session == CLOSED and holiday:
        return f"closed ({holiday})"
    return session
