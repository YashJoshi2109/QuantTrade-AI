"""One cached snapshot of the US heatmap universe for movers / sectors / heatmap / breadth.

Before this, each endpoint read quotes its own way:

* /market/movers   -> quote_snapshots rows of ANY age (DB, on the event loop)
* /market/sectors  -> quote_snapshots rows younger than 12h (DB, on the event loop)
* /market/heatmap  -> live provider fetch per sector, 21 sequential bulk passes

so the home cards (sectors + movers) said 470 up / 223 down from day-old rows
while the heatmap said 261 / 419 from live rows, and the heatmap's live pass
held a pooled DB connection for the whole provider fan-out.

Now every endpoint reads ``MarketSnapshotService.get()``:

* the snapshot is built from quote_snapshots in ONE query, in a worker thread,
  with a short-lived session (never the request's session);
* it is memoised for ``rebuild_every`` seconds, so all endpoints answer from
  the same rows and breadth is computed once (market_breadth.breadth_counts);
* quotes older than their TTL are refreshed by ONE background task (single
  flight, bounded concurrency, hard deadline, written back in batches) - no
  request ever waits on a quote provider unless the cache is completely cold.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from app.services.market_breadth import (
    breadth_counts,
    classify_change,
    is_implausible_move,
    is_usable_quote,
    robust_sector_change,
)

logger = logging.getLogger(__name__)
_logged_implausible: set = set()

UniverseRow = Tuple[str, str, str]  # (symbol, name, sector)


@dataclass(frozen=True)
class SnapshotRow:
    symbol: str
    name: str
    sector: str
    price: float
    change: float
    change_percent: float
    volume: int
    market_cap: Optional[float]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "sector": self.sector,
            "price": self.price,
            "change": self.change,
            "change_percent": self.change_percent,
            "volume": self.volume,
            "market_cap": self.market_cap,
        }


@dataclass(frozen=True)
class MarketSnapshot:
    rows: Tuple[SnapshotRow, ...]
    built_at: datetime
    breadth: Dict[str, int]
    universe_size: int
    oldest_quote_at: Optional[datetime] = None
    newest_quote_at: Optional[datetime] = None
    refreshing: bool = False
    sectors: Dict[str, Tuple[SnapshotRow, ...]] = field(default_factory=dict)

    def sector_changes(self) -> List[Tuple[str, float, Tuple[SnapshotRow, ...]]]:
        """(sector, median change %, rows) in universe order; empty sectors skipped."""
        return [
            (name, round(robust_sector_change(r.change_percent for r in rows), 2), rows)
            for name, rows in self.sectors.items()
            if rows
        ]

    def gainers(self, limit: int) -> List[SnapshotRow]:
        """Rows breadth counts as "up" (> +FLAT_THRESHOLD_PCT), biggest first."""
        up = sorted((r for r in self.rows if classify_change(r.change_percent) == "up"),
                    key=lambda r: r.change_percent, reverse=True)
        return up[:limit]

    def losers(self, limit: int) -> List[SnapshotRow]:
        """Rows breadth counts as "down" (< -FLAT_THRESHOLD_PCT), biggest drop first."""
        down = sorted((r for r in self.rows if classify_change(r.change_percent) == "down"),
                      key=lambda r: r.change_percent)
        return down[:limit]

    def meta(self) -> Dict[str, Any]:
        return {
            "as_of": self.built_at.isoformat(),
            "oldest_quote_at": self.oldest_quote_at.isoformat() if self.oldest_quote_at else None,
            "newest_quote_at": self.newest_quote_at.isoformat() if self.newest_quote_at else None,
            "universe_size": self.universe_size,
            "refreshing": self.refreshing,
        }


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def build_snapshot(
    universe: Sequence[UniverseRow],
    quotes: Mapping[str, Mapping[str, Any]],
    fetched_at: Optional[Mapping[str, datetime]] = None,
    now: Optional[datetime] = None,
    refreshing: bool = False,
) -> MarketSnapshot:
    """Pure: turn cached quote payloads into one consistent snapshot."""
    now = now or datetime.now(timezone.utc)
    fetched_at = fetched_at or {}
    rows: List[SnapshotRow] = []
    sectors: Dict[str, List[SnapshotRow]] = {}
    seen = set()
    stamps: List[datetime] = []
    for symbol, name, sector in universe:
        if symbol in seen:
            continue
        seen.add(symbol)
        q = quotes.get(symbol)
        if not is_usable_quote(q, now=now):
            if q and is_implausible_move(q.get("change_percent")) and symbol not in _logged_implausible:
                _logged_implausible.add(symbol)  # bad previous_close (delisted/renamed ticker)
                logger.warning("Dropping implausible quote %s: change_percent=%s price=%s",
                               symbol, q.get("change_percent"), q.get("price"))
            continue
        try:
            row = SnapshotRow(
                symbol=symbol,
                name=name,
                sector=sector,
                price=round(float(q.get("price") or 0), 2),
                change=round(float(q.get("change") or 0), 2),
                change_percent=round(float(q.get("change_percent") or 0), 2),
                volume=int(float(q.get("volume") or 0)),
                market_cap=q.get("market_cap"),
            )
        except (TypeError, ValueError):
            continue
        rows.append(row)
        sectors.setdefault(sector, []).append(row)
        ts = _aware(fetched_at.get(symbol))
        if ts:
            stamps.append(ts)
    return MarketSnapshot(
        rows=tuple(rows),
        built_at=now,
        breadth=breadth_counts(r.change_percent for r in rows),
        universe_size=len(seen),
        oldest_quote_at=min(stamps) if stamps else None,
        newest_quote_at=max(stamps) if stamps else None,
        refreshing=refreshing,
        sectors={k: tuple(v) for k, v in sectors.items()},
    )


def _default_session_factory():
    from app.db import database

    if database.SessionLocal is None:
        return None
    return database.SessionLocal()


def _load_cached_quotes(session_factory, symbols: Sequence[str]):
    """Sync (worker thread): one query for every universe row in quote_snapshots."""
    from app.models.quote_snapshot import QuoteSnapshot

    db = session_factory()
    if db is None:
        return {}, {}, set()
    try:
        rows = (
            db.query(
                QuoteSnapshot.symbol,
                QuoteSnapshot.payload,
                QuoteSnapshot.fetched_at,
                QuoteSnapshot.ttl_seconds,
            )
            .filter(QuoteSnapshot.symbol.in_(list(symbols)))
            .all()
        )
    finally:
        db.close()
    now = datetime.now(timezone.utc)
    payloads: Dict[str, Dict[str, Any]] = {}
    stamps: Dict[str, datetime] = {}
    expired = set()
    for symbol, payload, fetched, ttl in rows:
        if payload:
            payloads[symbol] = payload
        fetched = _aware(fetched)
        if fetched:
            stamps[symbol] = fetched
        if not fetched or (now - fetched).total_seconds() >= (ttl or 60):
            expired.add(symbol)
    expired.update(s for s in symbols if s not in payloads)
    return payloads, stamps, expired


def _persist_quotes(session_factory, quotes: Mapping[str, Dict[str, Any]], ttl: int) -> int:
    """Sync (worker thread): upsert fresh quotes into quote_snapshots, one commit."""
    from app.models.quote_snapshot import QuoteSnapshot

    good = {s.upper(): q for s, q in quotes.items() if q and not q.get("unavailable") and float(q.get("price") or 0) > 0}
    if not good:
        return 0
    db = session_factory()
    if db is None:
        return 0
    try:
        existing = {
            s.symbol: s
            for s in db.query(QuoteSnapshot).filter(QuoteSnapshot.symbol.in_(list(good))).all()
        }
        now = datetime.now(timezone.utc)
        for symbol, q in good.items():
            payload = {k: v for k, v in q.items() if k not in ("cached", "cache_age_seconds")}
            snap = existing.get(symbol)
            if snap is None:
                db.add(QuoteSnapshot(symbol=symbol, payload=payload, fetched_at=now,
                                     ttl_seconds=ttl, data_source=q.get("data_source")))
            else:
                snap.payload = payload
                snap.fetched_at = now
                snap.ttl_seconds = ttl
                snap.data_source = q.get("data_source")
        db.commit()
        return len(good)
    except Exception as e:
        db.rollback()
        logger.warning("market_snapshot: persisting %d quotes failed: %s", len(good), e)
        return 0
    finally:
        db.close()


def _has_baseline(q: Optional[Mapping[str, Any]]) -> bool:
    try:
        return bool(q) and float(q.get("price") or 0) > 0 and float(q.get("previous_close") or 0) > 0
    except (TypeError, ValueError):
        return False


async def _default_fetch(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Quotes for one chunk: ONE Public.com batch call, per-symbol chain only for the gaps.

    The per-symbol chain (QuoteCacheService._fetch_quote) costs up to 9 provider
    calls per ticker; calling it for all ~700 symbols blew Public's 10 req/s
    limit and fanned out thousands of requests. No DB access here.
    """
    from app.services.quote_cache import QuoteCacheService

    out: Dict[str, Dict[str, Any]] = {}
    try:
        from app.services.public_client import public_client

        from app.services.canonical_quote import canonicalize

        # Rows written here are read by every quote surface: store them in the
        # canonical contract (regular-session headline, extended separate).
        bulk = await public_client.get_quotes(symbols) or {}
        canon = {s: canonicalize(q) for s, q in bulk.items()}
        out.update({s: q for s, q in canon.items()
                    if q and not q.get("needs_regular") and _has_baseline(q)})
    except Exception as e:
        logger.debug("market_snapshot: Public.com batch failed: %s", e)

    missing = [s for s in symbols if s.upper() not in out]
    if missing:
        svc = QuoteCacheService(None)
        svc.MAX_CONCURRENT_FETCHES = 8  # background job: leave sockets/threads for requests
        out.update(await svc._fetch_quotes_parallel(missing))
    return out


def _default_ttl() -> int:
    from app.services.quote_cache import QuoteCacheService

    return QuoteCacheService(None)._get_current_ttl()


class MarketSnapshotService:
    def __init__(
        self,
        universe: Sequence[UniverseRow],
        *,
        session_factory: Callable[[], Any] = _default_session_factory,
        fetch_quotes: Callable[[List[str]], Any] = _default_fetch,
        ttl_fn: Callable[[], int] = _default_ttl,
        rebuild_every: float = 15.0,
        refresh_chunk: int = 50,
        chunk_timeout: float = 20.0,
        refresh_deadline: float = 90.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.universe = list(universe)
        self.symbols = list(dict.fromkeys(r[0] for r in self.universe))
        self._session_factory = session_factory
        self._fetch_quotes = fetch_quotes
        self._ttl_fn = ttl_fn
        self.rebuild_every = rebuild_every
        self.refresh_chunk = refresh_chunk
        self.chunk_timeout = chunk_timeout
        self.refresh_deadline = refresh_deadline
        self._clock = clock
        self._snapshot: Optional[MarketSnapshot] = None
        self._built_mono = 0.0
        self._expired: set = set()
        self._rebuild_task: Optional[asyncio.Task] = None
        self._refresh_task: Optional[asyncio.Task] = None
        self._last_refresh_mono: float = -1e9

    # ── internals ──────────────────────────────────────────────────────────
    def _alive(self, task: Optional[asyncio.Task]) -> bool:
        return task is not None and not task.done() and task.get_loop() is asyncio.get_running_loop()

    async def _rebuild(self) -> MarketSnapshot:
        payloads, stamps, expired = await asyncio.to_thread(
            _load_cached_quotes, self._session_factory, self.symbols
        )
        snap = build_snapshot(
            self.universe, payloads, stamps, refreshing=self._alive(self._refresh_task)
        )
        self._snapshot = snap
        self._expired = expired
        self._built_mono = self._clock()
        return snap

    def _schedule_rebuild(self) -> asyncio.Task:
        if not self._alive(self._rebuild_task):
            self._rebuild_task = asyncio.get_running_loop().create_task(self._rebuild())
            self._rebuild_task.add_done_callback(lambda t: t.cancelled() or t.exception())
        return self._rebuild_task

    def _maybe_schedule_refresh(self, force: bool = False) -> Optional[asyncio.Task]:
        if self._alive(self._refresh_task):
            return self._refresh_task
        if not self._expired and not force:
            return None
        # Do not hammer providers: at most one live pass per quote TTL.
        # ?force_refresh=true is public, so even forced passes are spaced 15s apart.
        min_gap = 15 if force else max(15, int(self._ttl_fn() or 60))
        if self._clock() - self._last_refresh_mono < min_gap:
            return None
        symbols = self.symbols if force else [s for s in self.symbols if s in self._expired]
        self._last_refresh_mono = self._clock()
        self._refresh_task = asyncio.get_running_loop().create_task(self._refresh(symbols))
        self._refresh_task.add_done_callback(lambda t: t.cancelled() or t.exception())
        return self._refresh_task

    async def _refresh(self, symbols: List[str]) -> int:
        """Background: fetch stale quotes chunk by chunk, persisting each chunk."""
        started = self._clock()
        written = 0
        ttl = int(self._ttl_fn() or 60)
        try:
            for i in range(0, len(symbols), self.refresh_chunk):
                if self._clock() - started > self.refresh_deadline:
                    logger.warning("market_snapshot: refresh deadline hit after %d/%d symbols", i, len(symbols))
                    break
                chunk = symbols[i:i + self.refresh_chunk]
                try:
                    quotes = await asyncio.wait_for(self._fetch_quotes(chunk), timeout=self.chunk_timeout)
                except asyncio.TimeoutError:
                    logger.warning("market_snapshot: quote chunk %d timed out", i // self.refresh_chunk)
                    continue
                except Exception as e:
                    logger.warning("market_snapshot: quote chunk failed: %s", e)
                    continue
                written += await asyncio.to_thread(_persist_quotes, self._session_factory, quotes or {}, ttl)
        finally:
            self._refresh_task = None if self._refresh_task is asyncio.current_task() else self._refresh_task
            try:
                await self._rebuild()
            except Exception as e:
                logger.warning("market_snapshot: rebuild after refresh failed: %s", e)
        logger.info("market_snapshot: refreshed %d/%d quotes in %.1fs", written, len(symbols), self._clock() - started)
        return written

    # ── public ─────────────────────────────────────────────────────────────
    async def get(self, *, force_refresh: bool = False, wait_cold: float = 15.0) -> MarketSnapshot:
        """Current snapshot. Never waits on providers unless the cache is cold or forced."""
        snap = self._snapshot
        if snap is None or self._clock() - self._built_mono >= self.rebuild_every:
            task = self._schedule_rebuild()
            if snap is None:
                snap = await asyncio.wait_for(asyncio.shield(task), timeout=wait_cold)
        refresh = self._maybe_schedule_refresh(force=force_refresh)

        cold = len(snap.rows) < 12
        if refresh is not None and (cold or force_refresh):
            try:
                await asyncio.wait_for(asyncio.shield(refresh), timeout=wait_cold)
            except asyncio.TimeoutError:
                logger.warning("market_snapshot: cold/forced refresh still running after %.0fs", wait_cold)
            snap = self._snapshot or snap
        return snap

    def reset(self) -> None:
        self._snapshot = None
        self._expired = set()
        self._rebuild_task = None
        self._refresh_task = None
        self._last_refresh_mono = -1e9
