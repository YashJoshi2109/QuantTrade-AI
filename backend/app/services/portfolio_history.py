"""
Portfolio value over time: daily snapshots, ledger backfill, TWR and drawdown.

Two writers fill `portfolio_snapshots`:
  * the daily job (app.main scheduler, `run_daily_snapshots_sync`) marks every
    portfolio at the latest quotes after the US close (source="job");
  * the backfill replays the transaction ledger day by day and marks open lots
    at the daily closes already stored in `price_bars` (source="backfill").
    It never calls a market-data provider.

Valuation rules match the live summary (app.services.portfolio_ledger):
tracked portfolios are worth their market value (cash is not modelled), paper
portfolios are market value plus simulated cash. A held symbol with no close on
or before a day is valued at its cost basis and listed in `missing_symbols`, so
the UI can say so instead of showing a made-up price move.

Returns are time-weighted so deposits do not count as gains. For a tracked
portfolio every buy is money in and every sell or dividend is money out
(`net_flow`). Inflows are assumed at the start of the day (they earn that day's
move from the fill price), outflows at the end:

    r_t = (V_t - V_{t-1} - F_t) / (V_{t-1} + max(F_t, 0))

A paper portfolio has no external flows (its cash is inside the account), so
r_t is the plain daily change of total value. Pure math lives in the top half
of this module so it can be unit-tested without a database.
"""
from __future__ import annotations

import bisect
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from app.services.portfolio_ledger import (
    KIND_PAPER,
    LedgerError,
    LedgerState,
    LedgerTxn,
    apply_txn,
    sorted_txns,
)

logger = logging.getLogger(__name__)

BENCHMARK = "SPY"
RANGES = ("1M", "3M", "YTD", "1Y", "ALL")
_RANGE_DAYS = {"1M": 30, "3M": 91, "1Y": 365}
MAX_HISTORY_DAYS = 365 * 10


# ── pure math ────────────────────────────────────────────────────────────────

@dataclass
class DayPoint:
    day: date
    total_value: float
    market_value: float
    cost_basis: float
    cash: float
    net_flow: float
    missing: List[str] = field(default_factory=list)


class Closes:
    """Daily closes per symbol with "last close on or before day" lookup."""

    def __init__(self, by_symbol: Dict[str, Dict[date, float]]):
        self._dates: Dict[str, List[date]] = {}
        self._vals: Dict[str, List[float]] = {}
        for sym, series in by_symbol.items():
            items = sorted((d, v) for d, v in series.items() if v is not None and v > 0)
            self._dates[sym] = [d for d, _ in items]
            self._vals[sym] = [v for _, v in items]

    def on_or_before(self, sym: str, day: date) -> Optional[float]:
        ds = self._dates.get(sym)
        if not ds:
            return None
        i = bisect.bisect_right(ds, day) - 1
        return self._vals[sym][i] if i >= 0 else None

    def dates(self, symbols: Iterable[str], start: date, end: date) -> List[date]:
        out = set()
        for sym in symbols:
            for d in self._dates.get(sym, ()):
                if start <= d <= end:
                    out.add(d)
        return sorted(out)


def trading_days(closes: Closes, symbols: Iterable[str], start: date, end: date) -> List[date]:
    """Days that have a stored close for any held symbol or the benchmark.
    Falls back to weekdays when nothing is stored for the span."""
    days = [d for d in closes.dates(list(symbols) + [BENCHMARK], start, end) if d.weekday() < 5]
    if days:
        return days
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _external_flow(t: LedgerTxn) -> float:
    """Money moving into (+) or out of (-) a tracked portfolio for one transaction."""
    if t.type == "BUY":
        return t.quantity * t.price + (t.fees or 0.0)
    if t.type == "SELL":
        return -(t.quantity * t.price - (t.fees or 0.0))
    if t.type == "DIVIDEND":
        return -t.amount
    return 0.0


def mark(state: LedgerState, price_of, *, paper: bool) -> Tuple[float, float, float, List[str]]:
    """(total_value, market_value, cost_basis, missing) for the open lots.
    `price_of(sym)` returns a price or None; unpriced lots count at cost."""
    mv = cost = 0.0
    missing: List[str] = []
    for lot in state.open_lots():
        cost += lot.cost
        px = price_of(lot.symbol)
        if px is None or px <= 0:
            missing.append(lot.symbol)
            mv += lot.cost
        else:
            mv += lot.quantity * px
    cash = state.cash if paper else 0.0
    return mv + cash, mv, cost, sorted(missing)


def build_series(
    txns: Sequence[LedgerTxn],
    closes: Closes,
    days: Sequence[date],
    *,
    kind: str,
    starting_cash: float = 0.0,
) -> List[DayPoint]:
    """Replay the ledger through `days` (ascending) and mark each close."""
    paper = kind == KIND_PAPER
    ordered = sorted_txns(txns)
    state = LedgerState(cash=starting_cash if paper else 0.0)
    i = 0
    out: List[DayPoint] = []
    for d in days:
        flow = 0.0
        while i < len(ordered) and ordered[i].date.astimezone(timezone.utc).date() <= d:
            t = ordered[i]
            i += 1
            try:
                apply_txn(state, t, enforce_cash=False)
            except LedgerError as e:  # legacy inconsistent rows: skip, never crash the chart
                logger.warning("history replay skipped txn %s: %s", t.id, e)
                continue
            if not paper:
                flow += _external_flow(t)
        total, mv, cost, missing = mark(state, lambda s: closes.on_or_before(s, d), paper=paper)
        out.append(DayPoint(d, total, mv, cost, state.cash if paper else 0.0, 0.0 if paper else flow, missing))
    return out


def daily_returns(values: Sequence[float], flows: Sequence[float], initial: float = 0.0) -> List[Optional[float]]:
    """Time-weighted daily returns. r[0] is measured against `initial` (0 for a
    tracked portfolio's first deposit day, the starting cash for a paper one).
    None when the day has no capital at risk (denominator <= 0)."""
    out: List[Optional[float]] = []
    prev = initial
    for v, f in zip(values, flows):
        denom = prev + max(f, 0.0)
        out.append((v - prev - f) / denom if denom > 1e-9 else None)
        prev = v
    return out


def performance(values: Sequence[float], flows: Sequence[float], start: int = 0, initial: float = 0.0) -> dict:
    """Cumulative TWR curve and max drawdown from index `start` (the range base).

    The base day is 0% and only returns after it are chained, except for the
    very first day of the history (start == 0), whose fill-to-close move is
    included so "All" matches the account's full time-weighted return.
    """
    rets = daily_returns(values, flows, initial)
    n = len(values)
    if n == 0 or start >= n:
        return {"curve": [], "twr": None, "max_drawdown": None}
    growth = 1.0
    if start == 0 and rets[0] is not None:
        growth *= 1.0 + rets[0]
    curve = [growth - 1.0]
    peak = growth
    mdd = 0.0
    for k in range(start + 1, n):
        r = rets[k]
        if r is not None:
            growth *= 1.0 + r
        curve.append(growth - 1.0)
        peak = max(peak, growth)
        if peak > 0:
            mdd = min(mdd, growth / peak - 1.0)
    has_capital = any(r is not None for r in rets[start:])
    return {
        "curve": curve,
        "twr": (growth - 1.0) if has_capital else None,
        "max_drawdown": mdd if has_capital else None,
    }


def range_start(rng: str, first: date, last: date) -> date:
    rng = (rng or "ALL").upper()
    if rng == "YTD":
        return max(first, date(last.year, 1, 1))
    if rng in _RANGE_DAYS:
        return max(first, last - timedelta(days=_RANGE_DAYS[rng]))
    return first


def benchmark_curve(closes: Closes, days: Sequence[date]) -> List[Optional[float]]:
    """SPY return from the first day with a close, forward-filled; None before it."""
    base = None
    out: List[Optional[float]] = []
    for d in days:
        px = closes.on_or_before(BENCHMARK, d)
        if base is None and px:
            base = px
        out.append((px / base - 1.0) if (base and px) else None)
    return out


# ── database layer ───────────────────────────────────────────────────────────

def _day_dt(d: date) -> datetime:
    return datetime.combine(d, time(0, 0), tzinfo=timezone.utc)


def _as_date(dt) -> date:
    if isinstance(dt, datetime):
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).date()
    return dt


def load_closes(db, symbols: Iterable[str], start: date, end: Optional[date] = None) -> Dict[str, Dict[date, float]]:
    """Daily closes from price_bars (UTC calendar date of the bar), with a
    lookback before `start` so the first day can forward-fill."""
    from app.models.price import PriceBar
    from app.models.symbol import Symbol

    syms = sorted({s for s in symbols if s})
    if not syms:
        return {}
    q = (
        db.query(Symbol.symbol, PriceBar.timestamp, PriceBar.close)
        .join(PriceBar, PriceBar.symbol_id == Symbol.id)
        .filter(Symbol.symbol.in_(syms), PriceBar.timestamp >= _day_dt(start - timedelta(days=10)))
    )
    if end is not None:
        q = q.filter(PriceBar.timestamp < _day_dt(end + timedelta(days=1)))
    out: Dict[str, Dict[date, float]] = {}
    for sym, ts, close in q.order_by(PriceBar.timestamp.asc()).all():
        if close is None:
            continue
        out.setdefault(sym, {})[_as_date(ts)] = float(close)
    return out


def _portfolio_txns(db, portfolio_id: int) -> List[LedgerTxn]:
    from app.api.portfolios import _ledger_rows, _to_ledger

    return [_to_ledger(t, s) for t, s in _ledger_rows(db, portfolio_id)]


def _kind(p) -> str:
    from app.api.portfolios import _kind as k

    return k(p)


def _history_start(p, txns: Sequence[LedgerTxn]) -> Optional[date]:
    firsts = [t.date.astimezone(timezone.utc).date() for t in txns]
    if _kind(p) == KIND_PAPER and p.created_at is not None:
        firsts.append(_as_date(p.created_at))
    return min(firsts) if firsts else None


def _first_close_dates(db, symbols: Iterable[str]) -> Dict[str, date]:
    from sqlalchemy import func as sa_func

    from app.models.price import PriceBar
    from app.models.symbol import Symbol

    syms = sorted({s for s in symbols if s})
    if not syms:
        return {}
    rows = (
        db.query(Symbol.symbol, sa_func.min(PriceBar.timestamp))
        .join(PriceBar, PriceBar.symbol_id == Symbol.id)
        .filter(Symbol.symbol.in_(syms))
        .group_by(Symbol.symbol)
        .all()
    )
    return {s: _as_date(ts) for s, ts in rows if ts is not None}


def coverage_start(db, symbols: Iterable[str], start: date, today: date) -> date:
    """First day the stored closes can value every traded symbol that has any
    closes at all. Trades before it are rolled into that day's starting value
    (a carry-in deposit) instead of showing months of gains as a one-day jump.
    Symbols with no stored closes never move the start (they stay at cost)."""
    firsts = [d for d in _first_close_dates(db, symbols).values() if d <= today]
    return max([start] + firsts)


def _expected_end(db, symbols: Iterable[str], today: date) -> date:
    """Last day a fresh backfill would produce: the newest stored close for a
    traded symbol or the benchmark, else the last weekday up to today."""
    from sqlalchemy import func as sa_func

    from app.models.price import PriceBar
    from app.models.symbol import Symbol

    syms = sorted(set(symbols) | {BENCHMARK})
    ts = (
        db.query(sa_func.max(PriceBar.timestamp))
        .join(Symbol, Symbol.id == PriceBar.symbol_id)
        .filter(Symbol.symbol.in_(syms), PriceBar.timestamp < _day_dt(today + timedelta(days=1)))
        .scalar()
    )
    if ts is not None:
        return _as_date(ts)
    d = today
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _snapshot_row(p, pt: DayPoint, prev_value: Optional[float], source: str, starting_cash: float):
    from app.models.portfolio import PortfolioSnapshot

    paper = _kind(p) == KIND_PAPER
    base = starting_cash if paper else pt.cost_basis
    pnl = pt.total_value - base
    r = None
    if prev_value is not None:
        denom = prev_value + max(pt.net_flow, 0.0)
        if denom > 1e-9:
            r = (pt.total_value - prev_value - pt.net_flow) / denom
    return PortfolioSnapshot(
        portfolio_id=p.id,
        snapshot_date=_day_dt(pt.day),
        total_value=round(pt.total_value, 4),
        cash_balance=round(pt.cash, 4),
        invested_value=round(pt.market_value, 4),
        cost_basis=round(pt.cost_basis, 4),
        net_flow=round(pt.net_flow, 4),
        total_pnl=round(pnl, 4),
        total_pnl_percent=round(pnl / base * 100.0, 4) if base > 0 else None,
        daily_return=None if prev_value is None else round(pt.total_value - prev_value - pt.net_flow, 4),
        daily_return_percent=None if r is None else round(r * 100.0, 6),
        source=source,
        missing_symbols=",".join(pt.missing)[:500] or None,
    )


def backfill_portfolio(db, p, *, today: Optional[date] = None, commit: bool = True) -> dict:
    """Recompute daily snapshots from the ledger and stored closes.

    Rewrites every snapshot up to the last computed day; job snapshots after it
    (e.g. today's live mark before today's bar is stored) are kept.
    """
    from app.models.portfolio import PortfolioSnapshot

    today = today or datetime.now(timezone.utc).date()
    txns = _portfolio_txns(db, p.id)
    start = _history_start(p, txns)
    if start is None:
        db.query(PortfolioSnapshot).filter(PortfolioSnapshot.portfolio_id == p.id).delete(synchronize_session=False)
        if commit:
            db.commit()
        return {"days": 0, "start": None, "end": None, "missing_symbols": []}
    start = max(start, today - timedelta(days=MAX_HISTORY_DAYS))
    symbols = sorted({t.symbol for t in txns})
    cov = coverage_start(db, symbols, start, today)
    closes = Closes(load_closes(db, symbols + [BENCHMARK], cov, today))
    days = trading_days(closes, symbols, cov, today)
    if not days or cov < days[0]:
        days = [cov] + days  # the first day always gets a point
    paper = _kind(p) == KIND_PAPER
    starting_cash = float(p.initial_cash or 0)
    series = build_series(txns, closes, days, kind=_kind(p), starting_cash=starting_cash)
    if series:
        # The first point is funded by a deposit: everything held at the
        # coverage start (carry-in), or a paper account's starting cash.
        if cov > start:
            series[0].net_flow = series[0].total_value
        elif paper:
            series[0].net_flow = starting_cash

    last = series[-1].day if series else start
    (db.query(PortfolioSnapshot)
       .filter(PortfolioSnapshot.portfolio_id == p.id, PortfolioSnapshot.snapshot_date <= _day_dt(last))
       .delete(synchronize_session=False))
    prev = None
    missing = set()
    for pt in series:
        db.add(_snapshot_row(p, pt, prev, "backfill", starting_cash))
        prev = pt.total_value
        missing.update(pt.missing)
    if commit:
        db.commit()
    return {"days": len(series), "start": series[0].day.isoformat(), "end": last.isoformat(),
            "history_start": start.isoformat(), "missing_symbols": sorted(missing)}


def invalidate_from(db, portfolio_id: int, when) -> None:
    """Drop snapshots on or after `when`: a ledger write changed them. The next
    history read rebuilds the gap from the ledger."""
    from app.models.portfolio import PortfolioSnapshot

    q = db.query(PortfolioSnapshot).filter(PortfolioSnapshot.portfolio_id == portfolio_id)
    if when is not None:
        q = q.filter(PortfolioSnapshot.snapshot_date >= _day_dt(_as_date(when)))
    q.delete(synchronize_session=False)


def snapshot_today(db, p, quotes: Dict[str, dict], *, today: Optional[date] = None) -> Optional[object]:
    """Write (or replace) today's snapshot at the given live quotes. Falls back
    to the latest stored close, then cost basis, per symbol."""
    from app.models.portfolio import PortfolioSnapshot
    from app.services.portfolio_ledger import replay

    today = today or datetime.now(timezone.utc).date()
    txns = _portfolio_txns(db, p.id)
    paper = _kind(p) == KIND_PAPER
    if not txns and not paper:
        return None
    starting_cash = float(p.initial_cash or 0)
    try:
        state = replay(txns, starting_cash=starting_cash if paper else 0.0)
    except LedgerError as e:
        logger.warning("snapshot skipped for portfolio %s: %s", p.id, e)
        return None
    syms = [lot.symbol for lot in state.open_lots()]
    closes = Closes(load_closes(db, syms, today - timedelta(days=10), today))

    def price_of(sym):
        q = quotes.get(sym) or {}
        try:
            px = float(q.get("price"))
        except (TypeError, ValueError):
            px = None
        return px if px and px > 0 else closes.on_or_before(sym, today)

    total, mv, cost, missing = mark(state, price_of, paper=paper)
    flow = 0.0 if paper else sum(_external_flow(t) for t in txns if t.date.astimezone(timezone.utc).date() == today)
    prev_row = (
        db.query(PortfolioSnapshot)
        .filter(PortfolioSnapshot.portfolio_id == p.id, PortfolioSnapshot.snapshot_date < _day_dt(today))
        .order_by(PortfolioSnapshot.snapshot_date.desc())
        .first()
    )
    prev = prev_row.total_value if prev_row else None
    if prev_row is None and paper:
        flow = starting_cash  # first row of a paper account: funded with its virtual cash
    pt = DayPoint(today, total, mv, cost, state.cash if paper else 0.0, flow, missing)
    (db.query(PortfolioSnapshot)
       .filter(PortfolioSnapshot.portfolio_id == p.id, PortfolioSnapshot.snapshot_date == _day_dt(today))
       .delete(synchronize_session=False))
    row = _snapshot_row(p, pt, prev, "job", starting_cash)
    db.add(row)
    return row


def run_daily_snapshots(db, quote_loader, *, today: Optional[date] = None) -> Dict[str, int]:
    """Snapshot every portfolio. `quote_loader(symbols) -> {sym: quote}`."""
    from app.models.portfolio import Portfolio, Transaction
    from app.models.symbol import Symbol

    today = today or datetime.now(timezone.utc).date()
    ports = db.query(Portfolio).all()
    rows = (
        db.query(Symbol.symbol).join(Transaction, Transaction.symbol_id == Symbol.id).distinct().all()
    )
    quotes = quote_loader(sorted({r[0] for r in rows})) if rows else {}
    written = failed = 0
    for p in ports:
        try:
            # Build the past first so today's daily return has a prior day.
            if not _has_snapshot_before(db, p.id, today):
                backfill_portfolio(db, p, today=today - timedelta(days=1), commit=False)
            if snapshot_today(db, p, quotes, today=today) is not None:
                written += 1
            db.commit()
        except Exception:
            db.rollback()
            failed += 1
            logger.exception("daily snapshot failed for portfolio %s", p.id)
    return {"portfolios": len(ports), "written": written, "failed": failed}


def _has_snapshot_before(db, portfolio_id: int, today: date) -> bool:
    from app.models.portfolio import PortfolioSnapshot

    return db.query(PortfolioSnapshot.id).filter(
        PortfolioSnapshot.portfolio_id == portfolio_id,
        PortfolioSnapshot.snapshot_date < _day_dt(today),
    ).first() is not None


def run_daily_snapshots_sync(db) -> Dict[str, int]:
    """Scheduler entry point (runs in the APScheduler thread, not the event loop)."""
    import asyncio

    from app.services.portfolio_pricing import fetch_quotes

    def loader(symbols):
        try:
            return asyncio.run(fetch_quotes(db, symbols))
        except Exception:
            logger.exception("daily snapshot quote fetch failed")
            return {}

    return run_daily_snapshots(db, loader)


def _needs_rebuild(rows, start: date, expected_end: date) -> bool:
    if not rows:
        return True
    first = _as_date(rows[0].snapshot_date)
    last = _as_date(rows[-1].snapshot_date)
    if first > start + timedelta(days=4):  # allow a weekend/holiday before the first close
        return True
    return last < expected_end


def history(db, p, rng: str = "1Y", *, today: Optional[date] = None) -> dict:
    """Equity curve + stats for one range, from stored snapshots (rebuilt from
    the ledger first when they are missing or stale)."""
    from app.models.portfolio import PortfolioSnapshot

    rng = (rng or "1Y").upper()
    if rng not in RANGES:
        rng = "1Y"
    today = today or datetime.now(timezone.utc).date()
    paper = _kind(p) == KIND_PAPER
    txns = _portfolio_txns(db, p.id)
    start = _history_start(p, txns)
    base = {
        "portfolio_id": p.id,
        "kind": _kind(p),
        "simulated": paper,
        "range": rng,
        "ranges": list(RANGES),
        "benchmark": BENCHMARK,
        "points": [],
        "stats": {"twr_percent": None, "max_drawdown_percent": None, "benchmark_return_percent": None,
                  "start_value": None, "end_value": None, "start": None, "end": None, "days": 0},
        "missing_symbols": [],
        "benchmark_available": False,
        "rebuilt": False,
        "history_start": None,
        "coverage_start": None,
    }
    if start is None:
        return base

    def _rows():
        return (
            db.query(PortfolioSnapshot)
            .filter(PortfolioSnapshot.portfolio_id == p.id)
            .order_by(PortfolioSnapshot.snapshot_date.asc())
            .all()
        )

    symbols = sorted({t.symbol for t in txns})
    cov = coverage_start(db, symbols, max(start, today - timedelta(days=MAX_HISTORY_DAYS)), today)
    base["history_start"] = start.isoformat()
    base["coverage_start"] = cov.isoformat()
    rows = _rows()
    if _needs_rebuild(rows, cov, _expected_end(db, symbols, today)):
        backfill_portfolio(db, p, today=today)
        rows = _rows()
        base["rebuilt"] = True
    if not rows:
        return base

    days = [_as_date(r.snapshot_date) for r in rows]
    values = [float(r.total_value or 0) for r in rows]
    # The first row carries the funding deposit (carry-in or paper starting
    # cash); paper rows have no other external flows.
    flows = [float(r.net_flow or 0) for r in rows]
    rs = range_start(rng, days[0], days[-1])
    k = next((i for i, d in enumerate(days) if d >= rs), len(days) - 1)
    # Base the range on the last close at or before its start when one exists.
    if k > 0 and days[k] > rs:
        k -= 1
    perf = performance(values, flows, start=k)
    curve = perf["curve"]

    window = rows[k:]
    wdays = days[k:]
    spy = Closes(load_closes(db, [BENCHMARK], wdays[0], wdays[-1]))
    bench = benchmark_curve(spy, wdays)
    missing = set()
    points = []
    for i, r in enumerate(window):
        if r.missing_symbols:
            missing.update(s for s in r.missing_symbols.split(",") if s)
        points.append({
            "date": wdays[i].isoformat(),
            "value": round(float(r.total_value or 0), 2),
            "cost_basis": None if r.cost_basis is None else round(float(r.cost_basis), 2),
            "cash": round(float(r.cash_balance or 0), 2) if paper else None,
            "net_flow": round(float(r.net_flow or 0), 2) if not paper else 0.0,
            "return_percent": None if i >= len(curve) else round(curve[i] * 100.0, 4),
            "benchmark_percent": None if bench[i] is None else round(bench[i] * 100.0, 4),
            "source": r.source,
        })
    bench_vals = [b for b in bench if b is not None]
    base.update({
        "points": points,
        "missing_symbols": sorted(missing),
        "benchmark_available": bool(bench_vals),
        "stats": {
            "twr_percent": None if perf["twr"] is None else round(perf["twr"] * 100.0, 4),
            "max_drawdown_percent": None if perf["max_drawdown"] is None else round(perf["max_drawdown"] * 100.0, 4),
            "benchmark_return_percent": round(bench_vals[-1] * 100.0, 4) if bench_vals else None,
            "start_value": points[0]["value"],
            "end_value": points[-1]["value"],
            "start": points[0]["date"],
            "end": points[-1]["date"],
            "days": len(points),
        },
    })
    return base

