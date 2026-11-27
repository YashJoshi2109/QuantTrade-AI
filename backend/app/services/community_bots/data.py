"""Data access for bots.

``DataHub`` is the only way a bot reads data. ``LiveDataHub`` wraps our own
services (quote_snapshots + canonical quotes, the S&P 500 market snapshot,
the technical-analysis service, news_items, the earnings calendar, FRED);
tests pass a fake hub with fixture data, so compose() output is deterministic.

What is deliberately NOT here: any reader of other people's posts or comments
(Reddit, StockTwits, X, forums). News rows are reduced to headline metadata
(title, url, publisher, tickers, sentiment label/score, impact, time); the
article summary / body never reaches a bot.
"""
from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services.community_bots.base import finite

logger = logging.getLogger(__name__)

# Headline fields a bot may see. Summary / body / AI notes are excluded on purpose.
NEWS_FIELDS = ("title", "url", "source", "tickers", "sentiment_label", "sentiment_score",
               "impact", "published_at", "primary_category")


class DataHub:
    """Interface. Every method returns None / empty on missing data; bots skip."""

    async def quotes(self, symbols: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        """symbol -> {price, change_percent, previous_close, as_of (datetime), session_date (date),
        extended: {price, change_percent, session} | None, name}"""
        raise NotImplementedError

    async def breadth(self) -> Optional[Dict[str, Any]]:
        """S&P 500 universe snapshot: {up, down, flat, total, universe_size, newest_quote_at,
        oldest_quote_at, session_date, sectors: [(name, median %, n)], rows: [{symbol, name,
        sector, price, change_percent, volume, market_cap}]}"""
        raise NotImplementedError

    async def technicals(self, symbol: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    async def closes(self, symbol: str, period: str = "3mo") -> List[Tuple[date, float]]:
        """Daily closes, oldest first."""
        raise NotImplementedError

    async def news(self, since: datetime, until: datetime) -> List[Dict[str, Any]]:
        raise NotImplementedError

    async def earnings(self, start: date, end: date) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    async def fred(self, series_id: str, limit: int = 30) -> List[Tuple[date, float]]:
        """Observations newest first."""
        raise NotImplementedError

    def sector_of(self, symbol: str) -> Optional[str]:
        raise NotImplementedError


def _aware(dt: Any) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(dt, datetime):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _session_date(q: Dict[str, Any]) -> Optional[date]:
    reg = q.get("regular") if isinstance(q.get("regular"), dict) else {}
    raw = reg.get("session_date") or q.get("session_date")
    try:
        return date.fromisoformat(str(raw)[:10]) if raw else None
    except ValueError:
        return None


def normalize_quote(sym: str, q: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Canonical quote payload -> the small dict bots use. None if unusable."""
    if not q or q.get("unavailable"):
        return None
    price = finite(q.get("price"))
    if price is None or price <= 0:
        return None
    ext = q.get("extended") if isinstance(q.get("extended"), dict) else None
    return {
        "symbol": sym,
        "name": q.get("name") or q.get("company_name"),
        "price": price,
        "change_percent": finite(q.get("change_percent")),
        "previous_close": finite(q.get("previous_close")),
        "as_of": _aware(q.get("as_of") or q.get("market_time") or q.get("timestamp")),
        "session_date": _session_date(q),
        "extended": ({"price": finite(ext.get("price")), "change_percent": finite(ext.get("change_percent")),
                      "session": ext.get("session")} if ext else None),
        "source": q.get("data_source") or q.get("source"),
    }


class LiveDataHub(DataHub):
    def __init__(self) -> None:
        self._snapshot_svc = None
        self._sector_map: Optional[Dict[str, str]] = None

    async def quotes(self, symbols: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        from app.db.database import SessionLocal
        from app.services.quote_cache import QuoteCacheService

        if SessionLocal is None:
            return {}
        db = SessionLocal()
        try:
            raw = await QuoteCacheService(db).get_quotes(list(symbols))
        finally:
            db.close()
        out = {}
        for s in symbols:
            n = normalize_quote(s, raw.get(s) or raw.get(s.upper()))
            if n:
                out[s] = n
        return out

    def _universe(self) -> List[tuple]:
        from app.api.market import _flatten_sp500_symbol_rows
        return _flatten_sp500_symbol_rows()

    async def breadth(self) -> Optional[Dict[str, Any]]:
        from app.services.market_snapshot import MarketSnapshotService

        if self._snapshot_svc is None:
            # Own instance: the API's instance is bound to the request event loop.
            self._snapshot_svc = MarketSnapshotService(self._universe(), rebuild_every=60.0)
        svc = self._snapshot_svc
        snap = await svc.get(wait_cold=45.0)
        refresh = svc._maybe_schedule_refresh()
        if refresh is not None:
            # Expired rows: wait (bounded) for the background refresh so the
            # post reflects current prices instead of the last page view.
            try:
                await asyncio.wait_for(asyncio.shield(refresh), timeout=120.0)
            except asyncio.TimeoutError:
                logger.warning("bots: breadth refresh still running after 120s")
            snap = svc._snapshot or snap
        if snap is None or not snap.rows:
            return None
        payload_dates = await asyncio.to_thread(self._session_dates, [r.symbol for r in snap.rows])
        return {
            **snap.breadth,
            "universe_size": snap.universe_size,
            "newest_quote_at": snap.newest_quote_at,
            "oldest_quote_at": snap.oldest_quote_at,
            "session_date": payload_dates,
            "sectors": [(n, c, len(rows)) for n, c, rows in snap.sector_changes()],
            "rows": [r.as_dict() for r in snap.rows],
        }

    @staticmethod
    def _session_dates(symbols: List[str]) -> Optional[date]:
        """Most common regular-session date among the snapshot rows."""
        from app.db.database import SessionLocal
        from app.models.quote_snapshot import QuoteSnapshot

        if SessionLocal is None:
            return None
        db = SessionLocal()
        try:
            rows = db.query(QuoteSnapshot.payload).filter(QuoteSnapshot.symbol.in_(symbols)).all()
        finally:
            db.close()
        c = Counter(d for (p,) in rows if isinstance(p, dict) for d in [_session_date(p)] if d)
        return c.most_common(1)[0][0] if c else None

    async def technicals(self, symbol: str) -> Optional[Dict[str, Any]]:
        from app.services.technical_analysis_service import ta_service
        try:
            sig = await asyncio.wait_for(ta_service.compute_signals(symbol), timeout=30)
        except Exception as e:  # noqa: BLE001
            logger.debug("bots: technicals %s failed: %s", symbol, e)
            return None
        return sig.to_dict() if sig is not None else None

    async def closes(self, symbol: str, period: str = "3mo") -> List[Tuple[date, float]]:
        from app.services.market_data_service import market_data
        try:
            df = await asyncio.wait_for(market_data.get_historical(symbol, period), timeout=45)
        except Exception as e:  # noqa: BLE001
            logger.debug("bots: history %s failed: %s", symbol, e)
            return []
        if df is None or getattr(df, "empty", True):
            return []
        col = "Close" if "Close" in df.columns else ("close" if "close" in df.columns else None)
        if col is None:
            return []
        out = []
        for idx, val in df[col].items():
            v = finite(val)
            if v is None:
                continue
            d = idx.date() if hasattr(idx, "date") else date.fromisoformat(str(idx)[:10])
            out.append((d, v))
        return out

    async def news(self, since: datetime, until: datetime) -> List[Dict[str, Any]]:
        def load():
            from app.db.database import SessionLocal
            from app.models.news_item import NewsItem

            if SessionLocal is None:
                return []
            db = SessionLocal()
            try:
                rows = (db.query(NewsItem)
                        .filter(NewsItem.published_at >= since, NewsItem.published_at < until,
                                NewsItem.sentiment_label.isnot(None))
                        .order_by(NewsItem.published_at.desc()).limit(5000).all())
                return [{k: getattr(r, k) for k in NEWS_FIELDS} for r in rows]
            finally:
                db.close()
        rows = await asyncio.to_thread(load)
        for r in rows:
            r["published_at"] = _aware(r["published_at"])
            r["tickers"] = list(r.get("tickers") or [])
        return rows

    async def earnings(self, start: date, end: date) -> Optional[Dict[str, Any]]:
        from app.services.earnings_calendar import fetch_window
        try:
            return await asyncio.wait_for(fetch_window(start, end), timeout=60)
        except Exception as e:  # noqa: BLE001
            logger.warning("bots: earnings window failed: %s", e)
            return None

    async def fred(self, series_id: str, limit: int = 30) -> List[Tuple[date, float]]:
        import httpx
        from app.config import settings

        key = getattr(settings, "FRED_API_KEY", None)
        if not key:
            return []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get("https://api.stlouisfed.org/fred/series/observations", params={
                    "series_id": series_id, "api_key": key, "file_type": "json",
                    "sort_order": "desc", "limit": limit})
                r.raise_for_status()
                obs = r.json().get("observations", [])
        except Exception as e:  # noqa: BLE001
            logger.warning("bots: FRED %s failed: %s", series_id, e)
            return []
        out = []
        for o in obs:
            v = finite(o.get("value")) if o.get("value") not in (".", None) else None
            if v is None:
                continue
            try:
                out.append((date.fromisoformat(o["date"]), v))
            except (KeyError, ValueError):
                continue
        return out

    def sector_of(self, symbol: str) -> Optional[str]:
        if self._sector_map is None:
            self._sector_map = {s: sec for s, _n, sec in self._universe()}
        return self._sector_map.get(symbol)


def default_window(now: datetime, hours: int) -> Tuple[datetime, datetime]:
    return now - timedelta(hours=hours), now
