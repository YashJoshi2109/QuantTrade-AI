"""Data providers for the quant engine, each result carrying provenance.

Prices
  Adjusted daily bars come from ``app.services.backtesting.data.load_prices``
  (yfinance auto_adjust -> Alpaca adjustment="all" -> FMP adjClose-scaled ->
  Finnhub raw, flagged), validated and with today's unfinished bar dropped.
  Our own ``price_bars`` table is the LAST fallback, not the first: rows are
  appended as they are synced and never re-adjusted, so a split after a bar
  was stored leaves the stored history unadjusted. A DB series is accepted
  only if it shows no split-like jump and is flagged ``adjusted=False``
  (dividends are not folded in).

Risk-free rate
  FRED DTB3 (3-month Treasury bill, secondary market, percent, daily). When
  FRED is unavailable the caller is told; nothing is defaulted silently.

Earnings events
  yfinance ``get_earnings_dates`` (announcement timestamps in US/Eastern,
  reported and estimated EPS) with Finnhub ``/calendar/earnings`` as the
  fallback (date, bmo/amc hour, EPS actual/estimate).

Sectors
  Our fundamentals table (sector, industry) with yfinance ``info`` as the
  fallback.

Tests replace the active provider with ``set_provider``.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

import pandas as pd

from app.services.backtesting.data import PriceSeries, load_prices, validate_ohlcv

logger = logging.getLogger(__name__)


@dataclass
class RiskFree:
    series: pd.Series                    # annual percent, indexed by date
    source: str
    note: str = ""


@dataclass
class EarningsEvents:
    events: List[dict]
    source: Optional[str]
    notes: List[str] = field(default_factory=list)


class QuantData:
    """Interface. Implementations are synchronous (called from a worker thread)."""

    def prices(self, symbol: str, start: datetime, end: datetime) -> Optional[PriceSeries]:
        raise NotImplementedError

    def risk_free(self, start: datetime, end: datetime) -> Optional[RiskFree]:
        raise NotImplementedError

    def earnings_events(self, symbol: str, n: int) -> EarningsEvents:
        raise NotImplementedError

    def sector(self, symbol: str) -> Optional[Dict[str, Optional[str]]]:
        raise NotImplementedError


def _db_prices(symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
    try:
        from app.db.database import SessionLocal
        from app.models.price import PriceBar
        from app.models.symbol import Symbol
    except Exception:  # pragma: no cover
        return pd.DataFrame()
    db = SessionLocal()
    try:
        rows = (db.query(PriceBar.timestamp, PriceBar.open, PriceBar.high, PriceBar.low, PriceBar.close, PriceBar.volume)
                .join(Symbol, Symbol.id == PriceBar.symbol_id)
                .filter(Symbol.symbol == symbol, PriceBar.timestamp >= start, PriceBar.timestamp <= end + timedelta(days=1))
                .order_by(PriceBar.timestamp).all())
    except Exception as e:  # noqa: BLE001
        logger.info("quant DB price read failed for %s: %s", symbol, e)
        return pd.DataFrame()
    finally:
        db.close()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume"]).set_index("timestamp")
    return df


class LiveQuantData(QuantData):
    def prices(self, symbol: str, start: datetime, end: datetime) -> Optional[PriceSeries]:
        ps = load_prices(symbol, start, end, min_bars=20)
        if ps is not None:
            return ps
        raw = _db_prices(symbol, start, end)
        df, warns = validate_ohlcv(raw, symbol)
        if len(df) < 20:
            return None
        if any("unadjusted split" in w for w in warns):
            logger.info("quant: DB bars for %s look unadjusted for a split; not used", symbol)
            return None
        warns.append(f"{symbol}: price_bars (our database) is not split/dividend adjusted; "
                     "total returns exclude dividends")
        return PriceSeries(symbol, df, "price_bars (database)", False, warns)

    def risk_free(self, start: datetime, end: datetime) -> Optional[RiskFree]:
        from app.config import settings
        key = getattr(settings, "FRED_API_KEY", None)
        if not key:
            return None
        import httpx
        try:
            resp = httpx.get("https://api.stlouisfed.org/fred/series/observations", params={
                "series_id": "DTB3", "api_key": key, "file_type": "json",
                "observation_start": (start - timedelta(days=10)).date().isoformat(),
                "observation_end": end.date().isoformat()}, timeout=8.0)
            resp.raise_for_status()
            obs = resp.json().get("observations", [])
        except Exception as e:  # noqa: BLE001
            logger.info("quant FRED DTB3 fetch failed: %s", e)
            return None
        vals = {}
        for o in obs:
            try:
                vals[pd.Timestamp(o["date"])] = float(o["value"])
            except (KeyError, TypeError, ValueError):
                continue                         # "." = holiday / missing
        if not vals:
            return None
        return RiskFree(pd.Series(vals).sort_index(), "FRED DTB3 (3-month Treasury bill, secondary market, % p.a.)")

    def earnings_events(self, symbol: str, n: int) -> EarningsEvents:
        notes: List[str] = []
        ev = _yf_events(symbol, n)
        if ev:
            return EarningsEvents(ev[-n:], "yfinance get_earnings_dates (Yahoo Finance)", notes)
        notes.append("yfinance earnings dates unavailable")
        ev = _finnhub_events(symbol)
        if ev:
            return EarningsEvents(ev[-n:], "Finnhub /calendar/earnings", notes)
        notes.append("Finnhub earnings calendar unavailable (no key or no rows)")
        return EarningsEvents([], None, notes)

    def sector(self, symbol: str) -> Optional[Dict[str, Optional[str]]]:
        try:
            from app.db.database import SessionLocal
            from app.models.fundamentals import Fundamentals
            from app.models.symbol import Symbol
            db = SessionLocal()
            try:
                row = (db.query(Fundamentals.sector, Fundamentals.industry)
                       .join(Symbol, Symbol.id == Fundamentals.symbol_id)
                       .filter(Symbol.symbol == symbol).first())
            finally:
                db.close()
            if row and row[0]:
                return {"sector": row[0], "industry": row[1], "source": "fundamentals table"}
            db = SessionLocal()
            try:
                sym_row = db.query(Symbol.sector).filter(Symbol.symbol == symbol).first()
            finally:
                db.close()
            if sym_row and sym_row[0]:
                return {"sector": sym_row[0], "industry": None, "source": "symbols table"}
        except Exception as e:  # noqa: BLE001
            logger.info("quant sector DB lookup failed for %s: %s", symbol, e)
        try:
            import yfinance as yf
            info = yf.Ticker(symbol.replace(".", "-")).info or {}
            if info.get("sector"):
                return {"sector": info["sector"], "industry": info.get("industry"), "source": "yfinance info"}
        except Exception as e:  # noqa: BLE001
            logger.info("quant sector yfinance lookup failed for %s: %s", symbol, e)
        return None


def classify_time(ts) -> Optional[str]:
    """bmo (< 09:30 ET), amc (>= 16:00 ET), dmh (during market hours);
    None when the timestamp carries no time of day (midnight)."""
    try:
        h, m = ts.hour, ts.minute
    except AttributeError:
        return None
    if h == 0 and m == 0:
        return None
    if (h, m) < (9, 30):
        return "bmo"
    if h >= 16:
        return "amc"
    return "dmh"


def _yf_events(symbol: str, n: int) -> List[dict]:
    try:
        import yfinance as yf
        df = yf.Ticker(symbol.replace(".", "-")).get_earnings_dates(limit=n + 12)
    except Exception as e:  # noqa: BLE001
        logger.info("quant yfinance earnings dates %s failed: %s", symbol, e)
        return []
    if df is None or not hasattr(df, "iterrows"):
        return []
    out: Dict[str, dict] = {}
    today = date.today()
    for ts, row in df.iterrows():
        try:
            ts_et = ts.tz_convert("America/New_York") if getattr(ts, "tzinfo", None) else ts
        except Exception:  # noqa: BLE001
            ts_et = ts
        d = ts_et.date()
        actual = _f(row.get("Reported EPS"))
        if d > today or actual is None:
            continue                                     # future / not yet reported
        est = _f(row.get("EPS Estimate"))
        out[d.isoformat()] = {"date": d.isoformat(), "timing": classify_time(ts_et),
                              "eps_actual": actual, "eps_estimate": est,
                              "surprise_pct": _surprise(actual, est)}
    return [out[k] for k in sorted(out)]


def _finnhub_events(symbol: str) -> List[dict]:
    try:
        from app.services.earnings_calendar import _finnhub_symbol_sync
        end = date.today()
        rows = _finnhub_symbol_sync(symbol, (end - timedelta(days=4 * 366)).isoformat(), end.isoformat()) or []
    except Exception as e:  # noqa: BLE001
        logger.info("quant Finnhub earnings %s failed: %s", symbol, e)
        return []
    out = {}
    for r in rows:
        if r.get("eps_actual") is None:
            continue
        out[r["date"]] = {"date": r["date"], "timing": r.get("hour") if r.get("hour") in ("bmo", "amc", "dmh") else None,
                          "eps_actual": r["eps_actual"], "eps_estimate": r.get("eps_estimate"),
                          "surprise_pct": _surprise(r["eps_actual"], r.get("eps_estimate"))}
    return [out[k] for k in sorted(out)]


def _f(v) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and abs(x) != float("inf") else None


def _surprise(actual: Optional[float], est: Optional[float]) -> Optional[float]:
    if actual is None or est is None or est == 0:
        return None
    return round((actual - est) / abs(est) * 100, 2)


_PROVIDER: QuantData = LiveQuantData()


def get_provider() -> QuantData:
    return _PROVIDER


def set_provider(p: Optional[QuantData]) -> None:
    global _PROVIDER
    _PROVIDER = p if p is not None else LiveQuantData()
