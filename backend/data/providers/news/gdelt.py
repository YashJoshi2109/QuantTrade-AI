"""GDELT v2 news provider.

Uses the ``gdeltdoc`` Python library if available; otherwise falls back
to the GDELT Doc API v2 JSON endpoint directly.

Rate limit: 1 request per second (conservative for free tier).
Cache: one JSON file per (symbol, year-month) under ``raw_dir/``.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from data.providers.base import NewsProvider

log = logging.getLogger(__name__)

_GDELT_API = (
    "http://api.gdeltproject.org/api/v2/doc/doc"
    "?query={query}&mode=artlist&maxrecords=250&format=json"
    "&startdatetime={start}&enddatetime={end}"
)

_ARTICLE_COLUMNS = ["date", "url", "source", "headline", "tone", "themes"]


class GDELTProvider(NewsProvider):
    """Fetch news articles with GDELT sentiment/tone scores.

    The ``date`` column in the returned DataFrame represents the article
    publication date and is used as ``available_at`` in the PIT join.
    Future dates are dropped before returning.
    """

    name = "gdelt"

    def __init__(
        self,
        raw_dir: Optional[str] = None,
        rate_limit_delay: float = 1.0,
        max_records_per_query: int = 250,
    ) -> None:
        self.raw_dir = Path(raw_dir) if raw_dir else None
        self.rate_limit_delay = rate_limit_delay
        self.max_records_per_query = max_records_per_query

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def fetch_articles(
        self,
        symbol: str,
        company_name: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Return deduplicated articles with date, url, source, headline, tone, themes."""
        frames = []

        # Try gdeltdoc library first
        df_lib = self._fetch_via_library(symbol, company_name, start_date, end_date)
        if df_lib is not None and not df_lib.empty:
            frames.append(df_lib)
        else:
            # Fall back to direct API
            df_api = self._fetch_via_api(symbol, company_name, start_date, end_date)
            if df_api is not None and not df_api.empty:
                frames.append(df_api)

        if not frames:
            log.warning("gdelt %s: no articles found", symbol)
            return pd.DataFrame(columns=_ARTICLE_COLUMNS)

        df = pd.concat(frames, ignore_index=True)
        df = self._normalise(df)
        df = self._drop_future(df)
        df = df.drop_duplicates(subset=["url"]).reset_index(drop=True)

        if self.raw_dir:
            self._cache(df, symbol)

        return df

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fetch_via_library(
        self,
        symbol: str,
        company_name: str,
        start_date: str,
        end_date: str,
    ) -> Optional[pd.DataFrame]:
        """Use gdeltdoc library if installed."""
        try:
            from gdeltdoc import GdeltDoc, Filters  # type: ignore

            gd = GdeltDoc()
            filters = Filters(
                keyword=company_name,
                start_date=start_date,
                end_date=end_date,
            )
            time.sleep(self.rate_limit_delay)
            articles = gd.article_search(filters)
            if articles is not None and not articles.empty:
                log.debug("gdelt %s: %d articles via gdeltdoc library", symbol, len(articles))
                return articles
        except ImportError:
            log.debug("gdelt: gdeltdoc library not installed, using direct API")
        except Exception as e:
            log.warning("gdelt %s: library fetch failed — %s", symbol, e)
        return None

    def _fetch_via_api(
        self,
        symbol: str,
        company_name: str,
        start_date: str,
        end_date: str,
    ) -> Optional[pd.DataFrame]:
        """Query GDELT Doc API v2 directly."""
        # GDELT datetime format: YYYYMMDDHHMMSS
        start_fmt = start_date.replace("-", "") + "000000"
        end_fmt = end_date.replace("-", "") + "235959"
        query = requests.utils.quote(f'"{company_name}" OR "{symbol}"')
        url = _GDELT_API.format(query=query, start=start_fmt, end=end_fmt)

        time.sleep(self.rate_limit_delay)
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            log.warning("gdelt %s: API request failed — %s", symbol, e)
            return None

        articles = data.get("articles", [])
        if not articles:
            return None

        df = pd.DataFrame(articles)
        log.debug("gdelt %s: %d articles via direct API", symbol, len(df))
        return df

    @staticmethod
    def _normalise(df: pd.DataFrame) -> pd.DataFrame:
        """Map various GDELT column names to canonical schema."""
        col_map = {
            "seendate": "date",
            "url": "url",
            "domain": "source",
            "sourcecountry": "source",
            "title": "headline",
            "tone": "tone",
            "themes": "themes",
        }
        df = df.copy()
        df.columns = [c.lower().strip() for c in df.columns]
        df = df.rename(columns={c: col_map[c] for c in df.columns if c in col_map})

        # Ensure canonical columns
        for col in _ARTICLE_COLUMNS:
            if col not in df.columns:
                df[col] = None

        # Parse date
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        return df[_ARTICLE_COLUMNS]

    @staticmethod
    def _drop_future(df: pd.DataFrame) -> pd.DataFrame:
        """Remove articles with publication date in the future."""
        now = pd.Timestamp.now()
        return df[df["date"] <= now]

    def _cache(self, df: pd.DataFrame, symbol: str) -> None:
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        cache_path = self.raw_dir / f"{symbol.upper()}_gdelt.json"
        df.to_json(cache_path, orient="records", date_format="iso")
        log.debug("gdelt %s: cached %d articles to %s", symbol, len(df), cache_path)
