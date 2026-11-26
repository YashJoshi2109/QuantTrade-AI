"""Yahoo Finance OHLCV provider (fallback when Stooq is unavailable)."""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import pandas as pd

from data.providers.base import OHLCVProvider

log = logging.getLogger(__name__)

_KEEP_COLS = ["symbol", "date", "open", "high", "low", "close", "volume", "source"]


class YFinanceProvider(OHLCVProvider):
    """Download adjusted daily bars via yfinance.

    Checks raw_dir cache before hitting the network.  If a cached parquet
    for the symbol already covers the requested date range, returns it
    immediately (no network call).  Otherwise downloads with up to 3
    attempts and exponential backoff (2s, 4s, 8s + jitter).

    Caches normalised data to ``raw_dir/<SYMBOL>_yf.parquet``.
    """

    name = "yfinance"

    def __init__(self, raw_dir: Optional[str] = None) -> None:
        self.raw_dir = Path(raw_dir) if raw_dir else None

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def fetch_daily_bars(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Return normalised OHLCV DataFrame; serves from cache when available."""
        # Cache-read: skip network if cached parquet covers the requested range
        if self.raw_dir is not None:
            cached = self._load_cache(symbol, start_date, end_date)
            if cached is not None:
                log.debug("yfinance %s: served from cache (%d rows)", symbol, len(cached))
                return cached

        df = self._download_with_retry(symbol, start_date, end_date)
        if df is None or df.empty:
            log.warning("yfinance %s: no data returned", symbol)
            return pd.DataFrame()

        df = self._normalise(df, symbol)

        if self.raw_dir is not None:
            self._cache(df, symbol)

        return df.reset_index(drop=True)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_cache(self, symbol: str, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """Return cached DataFrame if it covers [start_date, end_date], else None."""
        cache_path = self.raw_dir / f"{symbol.upper()}_yf.parquet"
        if not cache_path.exists():
            return None
        try:
            df = pd.read_parquet(cache_path)
            if df.empty:
                return None
            df["date"] = pd.to_datetime(df["date"])
            start = pd.Timestamp(start_date)
            end   = pd.Timestamp(end_date) if end_date else pd.Timestamp.now()
            filtered = df[(df["date"] >= start) & (df["date"] <= end)].reset_index(drop=True)
            # Accept cache if it has data and covers ≥90% of expected trading days
            if len(filtered) == 0:
                return None
            expected_days = len(pd.bdate_range(start_date, end_date)) * 0.9
            if len(filtered) >= expected_days:
                return filtered
        except Exception as e:
            log.warning("yfinance %s: cache read failed (%s), re-fetching", symbol, e)
        return None

    def _download_with_retry(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> Optional[pd.DataFrame]:
        """Call yfinance.download with up to 3 attempts and exponential backoff."""
        try:
            import yfinance as yf  # type: ignore
        except ImportError:
            log.error("yfinance not installed; pip install yfinance")
            return None

        for attempt in range(3):
            try:
                df = yf.download(
                    symbol,
                    start=start_date,
                    end=end_date,
                    auto_adjust=True,
                    progress=False,
                )
                if df is not None and not df.empty:
                    log.debug("yfinance %s: downloaded on attempt %d", symbol, attempt + 1)
                    return df
                log.warning("yfinance %s: empty response on attempt %d", symbol, attempt + 1)
            except Exception as e:
                log.warning("yfinance %s attempt %d: %s", symbol, attempt + 1, e)
            # Exponential backoff: 2s, 4s, 8s — avoids hammering API on rate-limit
            time.sleep(2 ** (attempt + 1))
        return None

    @staticmethod
    def _normalise(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
        """Flatten multi-level columns from yfinance and rename to canonical schema."""
        df = df.copy()

        # yfinance ≥ 0.2 returns MultiIndex columns: (Price, Ticker)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[0].lower().strip() for col in df.columns]
        else:
            df.columns = [c.lower().strip() for c in df.columns]

        # Reset DatetimeIndex → date column
        if df.index.name in ("Date", "Datetime", "date"):
            df = df.reset_index()
            df = df.rename(columns={df.columns[0]: "date"})

        col_map = {
            "open": "open",
            "high": "high",
            "low": "low",
            "close": "close",
            "adj close": "close",
            "volume": "volume",
        }
        df = df.rename(columns={c: col_map[c] for c in list(df.columns) if c in col_map})

        if "date" not in df.columns:
            log.warning("yfinance %s: 'date' column missing; columns=%s", symbol, list(df.columns))
            return pd.DataFrame()

        df["date"] = pd.to_datetime(df["date"])
        df["symbol"] = symbol.upper()
        df["source"] = "yfinance"

        # Fill missing required columns
        for col in _KEEP_COLS:
            if col not in df.columns:
                df[col] = float("nan")

        return df[_KEEP_COLS]

    def _cache(self, df: pd.DataFrame, symbol: str) -> None:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        cache_path = self.raw_dir / f"{symbol.upper()}_yf.parquet"
        df.to_parquet(cache_path, index=False)
        log.debug("yfinance %s: cached to %s", symbol, cache_path)
