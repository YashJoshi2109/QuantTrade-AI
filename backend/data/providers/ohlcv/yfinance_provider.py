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

    Uses ``yfinance.download(symbol, auto_adjust=True)`` with up to
    3 retry attempts and a 2-second backoff.  Caches raw data to
    ``raw_dir/<SYMBOL>_yf.parquet``.
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
        """Return normalised OHLCV DataFrame for *symbol* in [start_date, end_date]."""
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

    def _download_with_retry(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> Optional[pd.DataFrame]:
        """Call yfinance.download with up to 3 attempts and 2s backoff."""
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
            time.sleep(2)
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
