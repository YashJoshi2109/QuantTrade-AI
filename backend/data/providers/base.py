"""Abstract base classes for all data providers."""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import List, Optional

import pandas as pd


class OHLCVProvider(ABC):
    """Fetch daily OHLCV bars for a list of symbols."""

    name: str = "base_ohlcv"

    @abstractmethod
    def fetch_daily_bars(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Return df with columns: symbol, date, open, high, low, close, volume, source.

        date must be a pandas Timestamp.  No lookahead.
        """

    def fetch_batch(
        self,
        symbols: List[str],
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Default: loop over symbols.  Override for bulk APIs."""
        log = logging.getLogger(self.name)
        frames: list[pd.DataFrame] = []
        for sym in symbols:
            try:
                df = self.fetch_daily_bars(sym, start_date, end_date)
                if df is not None and not df.empty:
                    frames.append(df)
            except Exception as e:
                log.warning("%s: fetch failed — %s", sym, e)
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


class SECProvider(ABC):
    """Fetch SEC EDGAR data."""

    name: str = "base_sec"

    @abstractmethod
    def get_cik(self, symbol: str) -> Optional[str]:
        """Return zero-padded 10-digit CIK or None."""

    @abstractmethod
    def fetch_submissions(self, cik: str) -> dict:
        """Return raw SEC submissions JSON."""

    @abstractmethod
    def fetch_company_facts(self, cik: str) -> dict:
        """Return raw SEC company-facts JSON."""

    @abstractmethod
    def fetch_recent_filings(self, cik: str, forms: List[str]) -> pd.DataFrame:
        """Return df: accessionNumber, form, filingDate, acceptedDatetime, primaryDocument."""

    @abstractmethod
    def download_filing_text(
        self,
        cik: str,
        accession_number: str,
        primary_document: str,
    ) -> str:
        """Return full text of filing document."""


class NewsProvider(ABC):
    """Fetch news articles with sentiment/tone for a symbol."""

    name: str = "base_news"

    @abstractmethod
    def fetch_articles(
        self,
        symbol: str,
        company_name: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Return df: date, url, source, headline, tone, themes.

        date = article_date (publication date), used as available_at.
        No future dates allowed.
        """
