"""Stooq free OHLCV provider."""
from __future__ import annotations

import logging
import time
from io import StringIO
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from data.providers.base import OHLCVProvider

log = logging.getLogger(__name__)

_REQUIRED_COLUMNS = {"symbol", "date", "open", "high", "low", "close", "volume", "source"}


class StooqProvider(OHLCVProvider):
    """Download daily bars from Stooq free CSV endpoint.

    Falls back to pandas_datareader if available; otherwise uses direct
    Stooq CSV download with up to 3 retry attempts and exponential backoff.
    """

    name = "stooq"

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
        df = self._fetch_with_retry(symbol)
        if df is None or df.empty:
            log.warning("stooq %s: no data returned", symbol)
            return pd.DataFrame()

        df = self._normalise(df, symbol)
        df = self._filter_dates(df, start_date, end_date)

        if self.raw_dir is not None:
            self._cache(df, symbol)

        return df.reset_index(drop=True)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fetch_with_retry(self, symbol: str) -> Optional[pd.DataFrame]:
        """Try pandas_datareader first, then raw CSV.  3 attempts, exponential backoff."""
        # Attempt 1: pandas_datareader (optional dependency)
        try:
            import pandas_datareader.data as web  # type: ignore
            df = web.DataReader(symbol.lower(), "stooq")
            if df is not None and not df.empty:
                log.debug("stooq %s: loaded via pandas_datareader", symbol)
                return df
        except Exception as e:
            log.debug("stooq %s: pandas_datareader failed (%s), falling back to CSV", symbol, e)

        # Attempt 2-4: direct CSV download with retries
        url = f"https://stooq.com/q/d/l/?s={symbol.lower()}.us&i=d"
        for attempt in range(3):
            try:
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                df = pd.read_csv(StringIO(resp.text))
                if df.empty or "No data" in resp.text:
                    log.warning("stooq %s: empty response on attempt %d", symbol, attempt + 1)
                    return pd.DataFrame()
                log.debug("stooq %s: loaded via CSV on attempt %d", symbol, attempt + 1)
                return df
            except Exception as e:
                log.warning("stooq %s attempt %d: %s", symbol, attempt + 1, e)
                time.sleep(2 ** attempt)
        return None

    @staticmethod
    def _normalise(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
        """Rename columns to canonical schema and add symbol/source fields."""
        df = df.copy()
        df.columns = [c.lower().strip() for c in df.columns]

        # Handle multi-level index from pandas_datareader
        if hasattr(df.index, "name") and df.index.name in ("Date", "date"):
            df = df.reset_index()

        col_map = {
            "date": "date",
            "open": "open",
            "high": "high",
            "low": "low",
            "close": "close",
            "volume": "volume",
            "vol": "volume",
        }
        df = df.rename(columns={c: col_map[c] for c in df.columns if c in col_map})

        if "date" not in df.columns:
            log.warning("stooq: 'date' column missing after normalisation; columns=%s", list(df.columns))
            return pd.DataFrame()

        df["date"] = pd.to_datetime(df["date"])
        df["symbol"] = symbol.upper()
        df["source"] = "stooq"

        keep = ["symbol", "date", "open", "high", "low", "close", "volume", "source"]
        available = [c for c in keep if c in df.columns]
        df = df[available]

        # Fill any missing required columns with NaN
        for col in keep:
            if col not in df.columns:
                df[col] = float("nan")

        return df[keep]

    @staticmethod
    def _filter_dates(df: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
        if df.empty:
            return df
        start = pd.Timestamp(start_date)
        end = pd.Timestamp(end_date)
        return df[(df["date"] >= start) & (df["date"] <= end)]

    def _cache(self, df: pd.DataFrame, symbol: str) -> None:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        cache_path = self.raw_dir / f"{symbol.upper()}_raw.csv"
        df.to_csv(cache_path, index=False)
        log.debug("stooq %s: cached to %s", symbol, cache_path)
