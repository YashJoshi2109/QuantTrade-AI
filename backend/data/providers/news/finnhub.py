"""Finnhub free-tier news provider (optional).

Only active when ``FreeDataConfig.use_finnhub = True``.
Requires a free Finnhub API key (https://finnhub.io/).

Rate limit: Finnhub free tier allows ~60 req/min; we default to 1 req/s.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from data.providers.base import NewsProvider

log = logging.getLogger(__name__)

_FINNHUB_NEWS_URL = (
    "https://finnhub.io/api/v1/company-news"
    "?symbol={symbol}&from={from_date}&to={to_date}&token={token}"
)

_ARTICLE_COLUMNS = ["date", "url", "source", "headline", "tone", "themes"]


class FinnhubFreeProvider(NewsProvider):
    """Retrieve company news from Finnhub (free tier).

    The ``tone`` and ``themes`` fields are not provided by Finnhub and
    will be ``None``.  Downstream feature engineering can compute
    sentiment from headline text using the LM word lists.
    """

    name = "finnhub"

    def __init__(
        self,
        api_key: str,
        raw_dir: Optional[str] = None,
        rate_limit_delay: float = 1.0,
    ) -> None:
        self.api_key = api_key
        self.raw_dir = Path(raw_dir) if raw_dir else None
        self.rate_limit_delay = rate_limit_delay

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def fetch_articles(
        self,
        symbol: str,
        company_name: str,  # noqa: ARG002 — not used by Finnhub endpoint
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Return news articles for *symbol* between *start_date* and *end_date*."""
        df = self._download_with_retry(symbol, start_date, end_date)
        if df is None or df.empty:
            log.warning("finnhub %s: no articles returned", symbol)
            return pd.DataFrame(columns=_ARTICLE_COLUMNS)

        df = self._normalise(df)
        df = self._drop_future(df)

        if self.raw_dir:
            self._cache(df, symbol, start_date, end_date)

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
        """Fetch from Finnhub API with up to 3 retries."""
        url = _FINNHUB_NEWS_URL.format(
            symbol=symbol.upper(),
            from_date=start_date,
            to_date=end_date,
            token=self.api_key,
        )
        for attempt in range(3):
            time.sleep(self.rate_limit_delay)
            try:
                resp = requests.get(url, timeout=30)
                if resp.status_code == 429:
                    wait = 2 ** attempt
                    log.warning("finnhub %s: 429 rate-limited, retrying in %ds", symbol, wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                articles = resp.json()
                if isinstance(articles, list) and articles:
                    log.debug("finnhub %s: %d articles on attempt %d", symbol, len(articles), attempt + 1)
                    return pd.DataFrame(articles)
                log.warning("finnhub %s: empty response on attempt %d", symbol, attempt + 1)
                return pd.DataFrame()
            except Exception as e:
                log.warning("finnhub %s attempt %d: %s", symbol, attempt + 1, e)
                time.sleep(2 ** attempt)
        return None

    @staticmethod
    def _normalise(df: pd.DataFrame) -> pd.DataFrame:
        """Map Finnhub column names to canonical schema."""
        df = df.copy()
        col_map = {
            "datetime": "date",
            "url": "url",
            "source": "source",
            "headline": "headline",
            "summary": "summary",
            "category": "themes",
        }
        df.columns = [c.lower().strip() for c in df.columns]
        df = df.rename(columns={c: col_map[c] for c in df.columns if c in col_map})

        # Finnhub returns UNIX timestamps
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], unit="s", errors="coerce")

        # tone not provided by Finnhub free API
        df["tone"] = None

        for col in _ARTICLE_COLUMNS:
            if col not in df.columns:
                df[col] = None

        return df[_ARTICLE_COLUMNS]

    @staticmethod
    def _drop_future(df: pd.DataFrame) -> pd.DataFrame:
        now = pd.Timestamp.now()
        return df[df["date"] <= now]

    def _cache(
        self,
        df: pd.DataFrame,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> None:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        fname = f"{symbol.upper()}_{start_date}_{end_date}_finnhub.json"
        cache_path = self.raw_dir / fname
        df.to_json(cache_path, orient="records", date_format="iso")
        log.debug("finnhub %s: cached %d articles to %s", symbol, len(df), cache_path)
