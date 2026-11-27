"""
One-click suggested alerts for the Price Alerts page (GET /api/v1/alerts/suggestions).

Pure ranking / threshold logic lives here; app.api.alerts gathers the inputs from
data the app already has (positions, watchlist, price_bars, the shared market
snapshot of cached quotes, the cached earnings calendar). No new external calls.

Sources, in priority order (each suggestion carries one ``source`` tag):
  portfolio          protective stop below the price (ATR-sized), back-to-cost-basis,
                     and a near-term resistance level (20-day high or +2 ATR)
  watchlist          breakout above the 20-day high, or an unusual-down-day % alert
  near_52w_high/low  price within 3% of its 52-week high / low (needs ~a year of bars)
  top_mover          today's biggest S&P 500 movers: alert if half the move reverses
  upcoming_earnings  a report 2-14 days out: heads-up N days before

Rules every suggestion obeys:
  * levels are rounded to tick-sensible values, rounded *away* from the price
  * never a level the evaluator would fire on right now (checked with the same
    ``is_met`` the scheduled job uses), and at least MIN_GAP_PCT from the price
  * one per (symbol, condition); at most two per symbol; per-source caps
  * nothing the user already has (same symbol + condition, not yet triggered)
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Dict, Iterable, List, Optional, Sequence

from app.services.price_alert_service import CONDITIONS, EARNINGS_CONDITION, is_met
from app.services.ticker_lifecycle import is_retired

MIN_GAP_PCT = 0.5          # a price level is at least this far from the last price
NEAR_52W_PCT = 3.0         # "near" the 52-week high / low
MIN_52W_BARS = 150         # fewer daily bars than this and "52-week" would be a lie
MOVER_MIN_PCT = 2.0        # smaller moves are not "big movers"
EARNINGS_MIN_DAYS = 2      # a report tomorrow leaves no room for a pre-alert
EARNINGS_MAX_DAYS = 14
EARNINGS_LEAD_DAYS = 3
DEFAULT_LIMIT = 12
PER_SYMBOL = 2

SOURCES = ("portfolio", "watchlist", "near_52w_high", "near_52w_low", "top_mover", "upcoming_earnings")
SOURCE_BASE = {
    "portfolio": 100.0,
    "watchlist": 80.0,
    "near_52w_high": 60.0,
    "near_52w_low": 60.0,
    "top_mover": 40.0,
    "upcoming_earnings": 30.0,
}
SOURCE_CAP = {
    "portfolio": 6,
    "watchlist": 4,
    "near_52w_high": 3,
    "near_52w_low": 3,
    "top_mover": 3,
    "upcoming_earnings": 3,
}


@dataclass
class BarStats:
    """Derived from daily price_bars (see app.api.alerts.load_bar_stats)."""
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    bars_52w: int = 0
    atr14: Optional[float] = None
    high_20d: Optional[float] = None
    low_20d: Optional[float] = None


@dataclass
class Holding:
    symbol: str
    quantity: float
    avg_cost: Optional[float]


@dataclass
class Suggestion:
    symbol: str
    condition: str
    threshold: float
    reason: str
    source: str
    label: str
    current_price: Optional[float]
    change_percent: Optional[float] = None
    name: Optional[str] = None
    repeat: bool = False
    note: Optional[str] = None
    score: float = 0.0
    meta: Dict[str, float] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.symbol}:{self.condition}:{self.threshold:g}"

    def as_dict(self) -> dict:
        d = asdict(self)
        d.pop("meta", None)
        d["id"] = self.id
        d["condition_label"] = CONDITIONS[self.condition].label
        d["score"] = round(self.score, 2)
        return d


# ── numbers ──────────────────────────────────────────────────────────────────

def tick_for(price: float) -> float:
    """Round-number step for an alert level at this price."""
    if price < 1:
        return 0.01
    if price < 10:
        return 0.05
    if price < 50:
        return 0.25
    if price < 100:
        return 0.5
    if price < 1000:
        return 1.0
    return 5.0


def _snap(v: float) -> float:
    return round(v, 4)


def level_above(price: float, raw: float) -> float:
    """``raw`` rounded up to the tick, and at least MIN_GAP_PCT above ``price``."""
    t = tick_for(price)
    floor_ = price * (1 + MIN_GAP_PCT / 100)
    lvl = math.ceil(_snap(max(raw, floor_) / t)) * t
    if lvl <= floor_ - 1e-9:
        lvl += t
    return _snap(lvl)


def level_below(price: float, raw: float) -> float:
    """``raw`` rounded down to the tick, and at least MIN_GAP_PCT below ``price``."""
    t = tick_for(price)
    ceil_ = price * (1 - MIN_GAP_PCT / 100)
    lvl = math.floor(_snap(min(raw, ceil_) / t)) * t
    if lvl >= ceil_ + 1e-9:
        lvl -= t
    return _snap(lvl)


def atr(bars: Sequence[dict], period: int = 14) -> Optional[float]:
    """Average true range over the last ``period`` bars (oldest first, keys high/low/close)."""
    if len(bars) < period + 1:
        return None
    trs: List[float] = []
    for prev, cur in zip(bars[:-1], bars[1:]):
        h, lo, pc = cur["high"], cur["low"], prev["close"]
        trs.append(max(h - lo, abs(h - pc), abs(lo - pc)))
    v = sum(trs[-period:]) / period
    return v if v > 0 else None


def stop_distance(price: float, atr14: Optional[float]) -> float:
    """2 x ATR, clamped to 3%-10% of the price; 5% when ATR is unknown."""
    if not atr14:
        return price * 0.05
    return min(max(2 * atr14, price * 0.03), price * 0.10)


def _money(v: float) -> str:
    return f"${v:,.2f}"


def _pct(a: float, b: float) -> float:
    return abs(a - b) / b * 100 if b else 0.0


# ── per-source builders ──────────────────────────────────────────────────────

def _price_alert(sym, cond, lvl, price, chg, source, label, reason, score, note) -> Suggestion:
    return Suggestion(symbol=sym, condition=cond, threshold=lvl, reason=reason, source=source,
                      label=label, current_price=price, change_percent=chg, score=score, note=note)


def portfolio_suggestions(h: Holding, price: float, chg: Optional[float], st: Optional[BarStats]) -> List[Suggestion]:
    out: List[Suggestion] = []
    st = st or BarStats()
    base = SOURCE_BASE["portfolio"]
    sym = h.symbol

    stop = level_below(price, price - stop_distance(price, st.atr14))
    how = "about 2x its daily range (ATR)" if st.atr14 else "5%"
    out.append(_price_alert(
        sym, "price_below", stop, price, chg, "portfolio", "Stop-loss",
        f"You hold {sym}. Alert if it falls {_pct(stop, price):.1f}% to {_money(stop)}, {how} below {_money(price)}.",
        base + 5, "Suggested stop-loss",
    ))

    # Back to cost basis: only when the position is in profit and cost is close enough to matter.
    if h.avg_cost and h.avg_cost > 0 and 1.0 <= (price - h.avg_cost) / price * 100 <= 15:
        lvl = level_below(price, h.avg_cost)
        if abs(lvl - stop) / price * 100 >= 1.0:
            out.append(_price_alert(
                sym, "price_below", lvl, price, chg, "portfolio", "Protect gains",
                f"{sym} is {_pct(price, h.avg_cost):.1f}% above your average cost of {_money(h.avg_cost)}. "
                f"Alert if it falls back to {_money(lvl)}.",
                base + 3, "Back to cost basis",
            ))

    if st.high_20d and st.high_20d > price * (1 + MIN_GAP_PCT / 100) and _pct(st.high_20d, price) <= 10:
        lvl = level_above(price, st.high_20d)
        why = f"its 20-day high of {_money(st.high_20d)}"
    else:
        lvl = level_above(price, price + stop_distance(price, st.atr14))
        why = f"a {_pct(lvl, price):.1f}% rise (about 2x its daily range)" if st.atr14 else "a 5% rise"
    out.append(_price_alert(
        sym, "price_above", lvl, price, chg, "portfolio", "Resistance",
        f"You hold {sym} at {_money(price)}. Alert at {_money(lvl)}, {why}, to review taking profit.",
        base, "Near-term resistance",
    ))
    return out


def watchlist_suggestions(sym: str, price: float, chg: Optional[float], st: Optional[BarStats]) -> List[Suggestion]:
    out: List[Suggestion] = []
    st = st or BarStats()
    base = SOURCE_BASE["watchlist"]
    if st.high_20d and st.high_20d > price * (1 + MIN_GAP_PCT / 100) and _pct(st.high_20d, price) <= 12:
        lvl = level_above(price, st.high_20d)
        out.append(_price_alert(
            sym, "price_above", lvl, price, chg, "watchlist", "Breakout",
            f"On your watchlist. {sym} is {_pct(st.high_20d, price):.1f}% below its 20-day high; "
            f"alert on a breakout above {_money(lvl)}.",
            base + 2, "Breakout above 20-day high",
        ))
    if st.low_20d and st.low_20d < price * (1 - MIN_GAP_PCT / 100) and _pct(price, st.low_20d) <= 12:
        lvl = level_below(price, st.low_20d)
        out.append(_price_alert(
            sym, "price_below", lvl, price, chg, "watchlist", "Support",
            f"On your watchlist. Alert if {sym} breaks below its 20-day low near {_money(lvl)}.",
            base + 1, "Break of 20-day low",
        ))
    # Unusual down day: about 2x the typical daily range, in 0.5% steps.
    typical = (st.atr14 / price * 100) if st.atr14 else 2.0
    thr = min(max(math.ceil(2 * typical * 2) / 2, 2.0), 15.0)
    out.append(Suggestion(
        symbol=sym, condition="change_down_pct", threshold=thr, source="watchlist", label="Big down day",
        reason=f"On your watchlist. Alert on a day {sym} drops {thr:g}% or more, about twice its typical daily move.",
        current_price=price, change_percent=chg, score=base, note="Unusual daily drop",
    ))
    return out


def near_52w_suggestions(sym: str, price: float, chg: Optional[float], st: Optional[BarStats],
                         *, bonus: float = 0.0) -> List[Suggestion]:
    if not st or st.bars_52w < MIN_52W_BARS:
        return []
    out: List[Suggestion] = []
    hi, lo = st.high_52w, st.low_52w
    if hi and hi > price:
        d = _pct(hi, price)
        if d <= NEAR_52W_PCT:
            lvl = level_above(price, hi)
            out.append(_price_alert(
                sym, "price_above", lvl, price, chg, "near_52w_high", "52-week high",
                f"{sym} is {d:.1f}% below its 52-week high of {_money(hi)}. Alert on a new high above {_money(lvl)}.",
                SOURCE_BASE["near_52w_high"] + (NEAR_52W_PCT - d) * 3 + bonus, "52-week high breakout",
            ))
    if lo and lo < price:
        d = _pct(price, lo)
        if d <= NEAR_52W_PCT:
            lvl = level_below(price, lo)
            out.append(_price_alert(
                sym, "price_below", lvl, price, chg, "near_52w_low", "52-week low",
                f"{sym} is {d:.1f}% above its 52-week low of {_money(lo)}. Alert if it breaks below {_money(lvl)}.",
                SOURCE_BASE["near_52w_low"] + (NEAR_52W_PCT - d) * 3 + bonus, "52-week low break",
            ))
    return out


def mover_suggestion(sym: str, price: float, chg: float) -> Optional[Suggestion]:
    """Big move today: alert if half of it reverses."""
    if chg is None or abs(chg) < MOVER_MIN_PCT or chg <= -100:
        return None
    prev = price / (1 + chg / 100)
    mid = (prev + price) / 2
    base = SOURCE_BASE["top_mover"] + min(abs(chg), 15)
    if chg > 0:
        lvl = level_below(price, mid)
        if lvl <= prev:
            return None
        return _price_alert(
            sym, "price_below", lvl, price, chg, "top_mover", "Pullback",
            f"{sym} is up {chg:.1f}% today at {_money(price)}. Alert if it gives back half the move, at {_money(lvl)}.",
            base, "Half of today's gain reversed",
        )
    lvl = level_above(price, mid)
    if lvl >= prev:
        return None
    return _price_alert(
        sym, "price_above", lvl, price, chg, "top_mover", "Rebound",
        f"{sym} is down {abs(chg):.1f}% today at {_money(price)}. Alert if it wins back half the drop, at {_money(lvl)}.",
        base, "Half of today's drop recovered",
    )


HOUR_TEXT = {"bmo": "before the open", "amc": "after the close", "dmh": "during market hours"}


def earnings_suggestion(sym: str, event: dict, today: date, price: Optional[float], chg: Optional[float],
                        *, held: Optional[str] = None) -> Optional[Suggestion]:
    """``held``: optional prefix such as "In your portfolio:" for the user's own symbols."""
    try:
        d = date.fromisoformat(str(event.get("date")))
    except (TypeError, ValueError):
        return None
    days = (d - today).days
    if days < EARNINGS_MIN_DAYS or days > EARNINGS_MAX_DAYS:
        return None
    lead = min(EARNINGS_LEAD_DAYS, days - 1)
    when = d.strftime("%a %b ") + str(d.day)
    hour = HOUR_TEXT.get(event.get("hour") or "")
    whose = f"{held} " if held else ""
    reason = (f"{whose}{sym} reports earnings in {days} days ({when}{', ' + hour if hour else ''}). "
              f"Get a heads-up {lead} day{'s' if lead != 1 else ''} before.")
    score = SOURCE_BASE["upcoming_earnings"] + (25 if held else 0) + (EARNINGS_MAX_DAYS - days) * 0.5
    return Suggestion(
        symbol=sym, condition=EARNINGS_CONDITION, threshold=float(lead), source="upcoming_earnings",
        label="Earnings", reason=reason, current_price=price, change_percent=chg,
        repeat=True, score=score, note="Earnings heads-up", meta={"days_until": float(days)},
    )


# ── assembly ─────────────────────────────────────────────────────────────────

def would_trigger_now(s: Suggestion) -> bool:
    """True if the scheduled evaluator would fire this alert on the current data."""
    spec = CONDITIONS[s.condition]
    if spec.metric == "price":
        if s.current_price is None:
            return True  # unknown price: cannot prove it is safe
        if _pct(s.threshold, s.current_price) < MIN_GAP_PCT - 1e-6:
            return True
    if spec.metric == "earnings":
        days = s.meta.get("days_until")
        if days is None:
            return True
        metrics = {"earnings": days}
    else:
        metrics = {"price": s.current_price, "change": s.change_percent}
    met = is_met(s.condition, s.threshold, metrics)
    if met is None:
        # change alerts with an unknown day change are safe; price alerts were handled above
        return spec.metric == "price"
    return bool(met)


def build_candidates(
    *,
    holdings: Iterable[Holding],
    watchlist: Iterable[str],
    quotes: Dict[str, dict],
    stats: Dict[str, BarStats],
    market_rows: Sequence[dict],
    earnings: Dict[str, dict],
    today: date,
    names: Optional[Dict[str, str]] = None,
) -> List[Suggestion]:
    """All candidate suggestions before dedupe / ranking.

    ``quotes``: symbol -> {"price", "change"} (portfolio + watchlist + market rows).
    ``market_rows``: snapshot rows {symbol, name, price, change_percent, market_cap}.
    """
    names = dict(names or {})
    for r in market_rows:
        names.setdefault(r["symbol"], r.get("name"))
    out: List[Suggestion] = []

    def px(sym):
        q = quotes.get(sym) or {}
        p = q.get("price")
        return (p if p and p > 0 else None), q.get("change")

    holdings = list(holdings)
    held = {h.symbol for h in holdings}
    watch = [s for s in dict.fromkeys(watchlist) if s not in held]
    for h in holdings:
        p, c = px(h.symbol)
        if p:
            out += portfolio_suggestions(h, p, c, stats.get(h.symbol))
            out += near_52w_suggestions(h.symbol, p, c, stats.get(h.symbol), bonus=10)
    for s in watch:
        p, c = px(s)
        if p:
            out += watchlist_suggestions(s, p, c, stats.get(s))
            out += near_52w_suggestions(s, p, c, stats.get(s), bonus=5)

    mine = held | set(watch)
    for r in market_rows:
        s = r["symbol"]
        if s in mine:
            continue
        p, c = px(s)
        if p:
            out += near_52w_suggestions(s, p, c, stats.get(s))

    movers = [r for r in market_rows if r["symbol"] not in mine and r.get("change_percent") is not None]
    movers.sort(key=lambda r: abs(r["change_percent"]), reverse=True)
    for r in movers[:8]:
        p, c = px(r["symbol"])
        if p and c is not None:
            m = mover_suggestion(r["symbol"], p, c)
            if m:
                out.append(m)

    caps = {r["symbol"]: r.get("market_cap") or 0 for r in market_rows}
    ranked_earn = sorted(earnings.items(), key=lambda kv: (kv[0] not in mine, -(caps.get(kv[0]) or 0)))
    for s, ev in ranked_earn:
        if s not in mine and s not in caps:
            continue  # market-wide: keep to the large-cap universe
        p, c = px(s)
        tag = "In your portfolio:" if s in held else "On your watchlist:" if s in watch else None
        e = earnings_suggestion(s, ev, today, p, c, held=tag)
        if e:
            out.append(e)

    for sug in out:
        sug.name = sug.name or names.get(sug.symbol)
    return out


def finalize(candidates: Iterable[Suggestion], existing: Iterable[dict], limit: int = DEFAULT_LIMIT) -> List[Suggestion]:
    """Drop immediate triggers and alerts the user has, dedupe, rank, cap."""
    have = {
        (str(a["symbol"]).upper(), a["condition"])
        for a in existing
        if a.get("status") != "triggered"
    }
    best: Dict[tuple, Suggestion] = {}
    for s in candidates:
        if s.condition not in CONDITIONS or s.source not in SOURCE_BASE or is_retired(s.symbol):
            continue
        spec = CONDITIONS[s.condition]
        if not (spec.min_threshold <= s.threshold <= spec.max_threshold):
            continue
        if (s.symbol, s.condition) in have or would_trigger_now(s):
            continue
        k = (s.symbol, s.condition)
        if k not in best or s.score > best[k].score:
            best[k] = s
    ranked = sorted(best.values(), key=lambda s: (-s.score, s.symbol, s.condition))
    per_symbol: Dict[str, int] = {}
    per_source: Dict[str, int] = {}
    out: List[Suggestion] = []
    for s in ranked:
        if per_symbol.get(s.symbol, 0) >= PER_SYMBOL or per_source.get(s.source, 0) >= SOURCE_CAP[s.source]:
            continue
        per_symbol[s.symbol] = per_symbol.get(s.symbol, 0) + 1
        per_source[s.source] = per_source.get(s.source, 0) + 1
        out.append(s)
        if len(out) >= limit:
            break
    return out


def to_cache(cands: Iterable[Suggestion]) -> List[dict]:
    return [asdict(s) for s in cands]


def from_cache(rows: Iterable[dict]) -> List[Suggestion]:
    out = []
    for r in rows or []:
        try:
            out.append(Suggestion(**r))
        except TypeError:
            continue
    return out
