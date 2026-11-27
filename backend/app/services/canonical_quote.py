"""One canonical quote contract for every surface.

Incident (prod, 2026-11-26 21:45 ET, Thanksgiving): the AI Copilot said AMD
423.01 (+2.36% vs 413.27) while the research header / ticker tape said
406.03 (-1.75%). Public.com's ``last`` was an overnight-venue print; the
copilot showed it as the headline price against the close two sessions back,
the other tabs showed the Nov 25 regular close from Yahoo/FMP. Two provider
chains, two meanings of "price".

Contract (``QUOTE_VERSION``), produced by :func:`canonicalize` and stored in
quote_snapshots (one row per symbol, shared by every reader):

    price / change / change_percent / previous_close
        ALWAYS the regular session: last regular price (live during the
        session, else that session's close) and the change vs the close of
        the trading day before it (market_calendar, NYSE holidays).
    regular   {price, previous_close, change, change_percent, session_date,
               previous_session_date, close_time, live}
    extended  {price, change, change_percent (vs regular.price), time,
               session: pre-market | after-hours | overnight} or None
    source / data_source
    as_of     trade time of the regular price (the closing time of
              session_date when the session is over). Never the fetch time.
    market_time = as_of, session = "regular" (back-compat fields)
    timestamp / fetched_at  when we fetched it
    stale     the regular price is older than the latest completed session
    needs_regular  True when this payload could not determine the regular
              price (caller should ask a regular-session provider)

Headline numbers never include extended-hours trading; a UI shows
``extended`` separately and labelled ("After hours 423.01 +4.18%").
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

from app.services import market_calendar as mc

QUOTE_VERSION = 3

# Providers whose quote price is the regular-session price by construction.
REGULAR_ONLY_SOURCES = ("yahoo_direct", "yfinance", "fmp", "twelve_data", "finnhub", "database")

# Two baselines that should be the same close may differ by rounding.
_SAME_CLOSE_TOL = 0.02


def _now() -> datetime:  # patched in tests
    return datetime.now(timezone.utc)


def _f(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        return x if x == x else None  # NaN
    except (TypeError, ValueError):
        return None


def _pos(v: Any) -> Optional[float]:
    x = _f(v)
    return x if x is not None and x > 0 else None


def parse_ts(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def print_session_of(q: Dict[str, Any]) -> Optional[str]:
    """Session the payload's ``price`` printed in (regular | pre-market |
    after-hours | overnight), or None when the provider gave no trade time."""
    if q.get("quote_version") == QUOTE_VERSION:
        return mc.REGULAR
    if q.get("session"):
        return q["session"]
    if q.get("data_source") in REGULAR_ONLY_SOURCES:
        return mc.REGULAR
    raw = q.get("market_time")
    ts = parse_ts(raw)
    if ts is None:
        return None
    # A daily-bar provider stamps a date (midnight ET): a session close.
    if len(str(raw)) <= 10 or ts.astimezone(mc.ET).time() == datetime.min.time():
        return mc.REGULAR
    return mc.print_session(ts)


def _close_dt(d: date) -> datetime:
    return datetime.combine(d, mc.close_time(d), tzinfo=mc.ET)


def expected_session(now: Optional[datetime] = None) -> tuple:
    """(date of the regular session a quote should be from right now, live?)."""
    et = mc._to_et(now)
    if mc.session_at(et) == mc.REGULAR:
        return et.date(), True
    return mc.last_completed_session(et), False


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat() if dt else None


def _regular_from_extended(q: Dict[str, Any], ref: date) -> tuple:
    """(regular close, its previous close) for a payload whose price is an
    extended-hours print. Bars-verified figures (public_client
    reference_close / reference_prior_close) win; Public's own
    previous_close + one_day_change (a regular-session change) is the
    fallback and is also used to cross-check."""
    close = _pos(q.get("reference_close"))
    prior = _pos(q.get("reference_prior_close"))
    raw_prev = _pos(q.get("public_previous_close"))
    odc = _f(q.get("public_one_day_change"))
    pub_close = round(raw_prev + odc, 4) if raw_prev and odc is not None and raw_prev + odc > 0 else None
    price = _pos(q.get("price"))
    # An odc of exactly 0 with prev+odc == the extended print means Public
    # already rolled its baseline onto the print: it is not a regular close.
    if pub_close is not None and price is not None and abs(pub_close - price) < 0.005 and not odc:
        pub_close = None
    if close is None and pub_close is not None:
        close = pub_close
    if prior is None and raw_prev and close is not None and pub_close is not None \
            and abs(pub_close - close) <= _SAME_CLOSE_TOL:
        prior = raw_prev
    return close, prior


def canonicalize(q: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Provider payload -> canonical quote (idempotent). None/unavailable in,
    same out."""
    if not q or q.get("unavailable"):
        return q
    if q.get("quote_version") == QUOTE_VERSION:
        return q
    now = now or _now()
    price = _pos(q.get("price") if q.get("price") is not None else q.get("last_price"))
    if price is None:
        return {**q, "unavailable": True, "message": "Quote temporarily unavailable"}

    session = print_session_of(q)
    printed = parse_ts(q.get("market_time"))
    if printed is not None and printed > now:
        printed = now
    exp_date, live_now = expected_session(now)

    extended = None
    reg_time: Optional[datetime] = None
    if session in (mc.PRE_MARKET, mc.AFTER_HOURS, mc.OVERNIGHT):
        at = printed or now
        session_date = mc.last_completed_session(at)
        if q.get("reference_close_date"):
            try:
                session_date = date.fromisoformat(str(q["reference_close_date"]))
            except ValueError:
                pass
        reg_price, reg_prev = _regular_from_extended(q, session_date)
        extended = {"price": round(price, 4), "time": _iso(printed), "session": session}
        if _pos(q.get("volume")) is not None:
            extended["volume"] = int(q["volume"])
        reg_time = _close_dt(session_date)
        # The payload's volume / open / high / low belong to the extended
        # print's venue (overnight volume is ~0.5% of a regular day). The
        # regular session's own bar replaces them; without it they are unknown.
        bar = q.get("reference_bar") if isinstance(q.get("reference_bar"), dict) else {}
        reg_bar = {k: (_pos(bar.get(k)) if bar else None) for k in ("volume", "open", "high", "low")}
    else:
        # Regular-session print (or a provider with no trade time, whose quote
        # is taken as the regular price).
        reg_price = price
        reg_prev = _pos(q.get("previous_close") or q.get("prev_close"))
        reported = _f(q.get("change"))
        if reg_prev is None and reported:
            # No explicit baseline: back it out of the provider's own change,
            # which is relative to this same (regular) price.
            reg_prev = _pos(price - reported)
        if printed is not None and session == mc.REGULAR:
            session_date = printed.astimezone(mc.ET).date()
            if not mc.is_trading_day(session_date):  # stamp on a closed day
                session_date = mc.last_completed_session(printed)
            reg_time = printed
        else:
            session_date = exp_date
            reg_time = None if live_now else _close_dt(session_date)
        if reg_time is not None and reg_time > _close_dt(session_date):
            reg_time = _close_dt(session_date)  # closing print stamped a few s late

    prev_date = mc.previous_trading_day(session_date)
    session_over = now >= _close_dt(session_date)
    needs_regular = reg_price is None or reg_prev is None

    out = {k: v for k, v in q.items() if k not in ("cached", "cache_age_seconds", "reference_bar")}
    if extended is not None:
        out.update({
            "volume": int(reg_bar["volume"]) if reg_bar["volume"] else None,
            "open": reg_bar["open"], "high": reg_bar["high"], "low": reg_bar["low"],
        })
    if reg_price is not None:
        change = (reg_price - reg_prev) if reg_prev else None
        pct = (change / reg_prev * 100) if change is not None else None
        regular = {
            "price": round(reg_price, 4),
            "previous_close": round(reg_prev, 4) if reg_prev else None,
            "change": round(change, 4) if change is not None else None,
            "change_percent": round(pct, 4) if pct is not None else None,
            "session_date": session_date.isoformat(),
            "previous_session_date": prev_date.isoformat(),
            "close_time": _iso(_close_dt(session_date)) if session_over else None,
            "live": not session_over and session_date == mc._to_et(now).date(),
        }
        if extended is not None:
            ech = extended["price"] - reg_price
            extended["change"] = round(ech, 4)
            extended["change_percent"] = round(ech / reg_price * 100, 4)
        out.update({
            "price": round(reg_price, 2),
            "change": round(change, 2) if change is not None else 0,
            "change_percent": round(pct, 4) if pct is not None else 0,
            "previous_close": round(reg_prev, 2) if reg_prev else 0,
        })
    else:
        regular = None
        out.update({"price": None, "change": None, "change_percent": None, "previous_close": None})

    fetched = q.get("fetched_at") or q.get("timestamp")
    out.update({
        "regular": regular,
        "extended": extended,
        "source": q.get("data_source"),
        "as_of": _iso(reg_time),
        "market_time": _iso(reg_time),
        "print_time": _iso(printed),
        "session": mc.REGULAR,
        "fetched_at": fetched if isinstance(fetched, str) else _iso(parse_ts(fetched)) or _iso(now),
        "stale": session_date < exp_date,
        "needs_regular": needs_regular,
        "quote_version": QUOTE_VERSION,
    })
    out.setdefault("timestamp", out["fetched_at"])
    return out


def attach_extended(regular_q: Dict[str, Any], extended_src: Dict[str, Any],
                    now: Optional[datetime] = None) -> Dict[str, Any]:
    """Canonical quote from a regular-session provider + the extended-hours
    print of another (Public.com) when the latter could not give the regular
    price itself."""
    base = canonicalize(regular_q, now)
    if not base or base.get("unavailable") or not base.get("regular"):
        return base
    ext = canonicalize(extended_src, now) or {}
    e = ext.get("extended")
    if e and e.get("time"):
        reg_close = parse_ts(base["regular"].get("close_time"))
        printed = parse_ts(e["time"])
        if reg_close is not None and printed is not None and printed > reg_close:
            rp = base["regular"]["price"]
            ech = e["price"] - rp
            base = {**base, "extended": {**e, "change": round(ech, 4),
                                          "change_percent": round(ech / rp * 100, 4)},
                    "source": f"{base.get('data_source')} (+{extended_src.get('data_source')} extended)"}
    return base


def extended_label(ext: Optional[Dict[str, Any]]) -> Optional[str]:
    """"After hours 423.01 +4.18%" / "Overnight ..." / "Pre-market ..."."""
    if not ext or _pos(ext.get("price")) is None:
        return None
    name = {mc.AFTER_HOURS: "After hours", mc.OVERNIGHT: "Overnight",
            mc.PRE_MARKET: "Pre-market"}.get(ext.get("session"), "Extended hours")
    pct = _f(ext.get("change_percent"))
    return f"{name} {float(ext['price']):.2f}" + (f" {pct:+.2f}%" if pct is not None else "")
