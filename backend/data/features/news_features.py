"""News feature generator.

Computes rolling sentiment aggregates for each (symbol, date) pair
using only articles with ``date <= prediction_date`` (PIT-safe).
"""
from __future__ import annotations

import logging
from typing import Dict, List

import pandas as pd

log = logging.getLogger(__name__)

_DEFAULT_WINDOWS = [1, 7, 30]


class NewsFeatureGenerator:
    """Generate point-in-time news sentiment features.

    Parameters
    ----------
    articles_df:
        DataFrame with columns: symbol, date, tone (float or None).
        ``date`` is the publication date (= available_at).
    lookback_days:
        List of rolling window sizes in calendar days.
    """

    def __init__(
        self,
        articles_df: pd.DataFrame,
        lookback_days: List[int] = None,
    ) -> None:
        self.articles = articles_df.copy()
        self.lookback_days = lookback_days or _DEFAULT_WINDOWS

        # Ensure date column is datetime
        if "date" in self.articles.columns:
            self.articles["date"] = pd.to_datetime(self.articles["date"], errors="coerce")

    def build_daily_features(
        self,
        symbols: List[str],
        dates: pd.DatetimeIndex,
    ) -> pd.DataFrame:
        """Return features for every (symbol, date) pair.

        For date ``d``, only articles with publication_date <= d are used.
        """
        records = []
        for sym in symbols:
            sym_articles = self.articles[
                self.articles["symbol"].str.upper() == sym.upper()
            ].copy()

            for d in dates:
                row = self._compute_features(sym, sym_articles, d)
                row["symbol"] = sym.upper()
                row["date"] = d
                records.append(row)

        if not records:
            return pd.DataFrame()

        return pd.DataFrame(records).set_index(["symbol", "date"])

    def _compute_features(
        self,
        symbol: str,
        sym_articles: pd.DataFrame,
        d: pd.Timestamp,
    ) -> dict:
        feat: dict = {}
        nan = float("nan")

        # PIT filter
        available = sym_articles[sym_articles["date"] <= d]

        for window in self.lookback_days:
            win_start = d - pd.Timedelta(days=window)
            window_articles = available[available["date"] > win_start]

            count = len(window_articles)
            feat[f"news_count_{window}d"] = float(count)

            if count > 0 and "tone" in window_articles.columns:
                tones = window_articles["tone"].dropna()
                feat[f"news_avg_tone_{window}d"] = float(tones.mean()) if len(tones) > 0 else nan
                feat[f"news_neg_ratio_{window}d"] = float((tones < 0).mean()) if len(tones) > 0 else nan
            else:
                feat[f"news_avg_tone_{window}d"] = nan
                feat[f"news_neg_ratio_{window}d"] = nan

        return feat
