"""News ingestion orchestrator.

Fetches articles from GDELT (and optionally Finnhub) for a list of
symbols and saves to the raw cache directories.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from data.config import FreeDataConfig

log = logging.getLogger(__name__)

_ARTICLE_COLS = ["symbol", "date", "url", "source", "headline", "tone", "themes"]


class NewsIngestion:
    """Orchestrate news article collection for a list of symbols."""

    def __init__(self, config: FreeDataConfig) -> None:
        self.config = config
        self.providers = self._build_providers()

    # ------------------------------------------------------------------
    # Provider construction
    # ------------------------------------------------------------------

    def _build_providers(self) -> list:
        providers: list = []
        if self.config.use_gdelt:
            from data.providers.news.gdelt import GDELTProvider

            providers.append(GDELTProvider(raw_dir=self.config.raw_news_gdelt))
        if self.config.use_finnhub:
            from data.providers.news.finnhub import FinnhubFreeProvider
            import os

            api_key = os.environ.get("FINNHUB_API_KEY", "")
            if api_key:
                providers.append(
                    FinnhubFreeProvider(api_key=api_key, raw_dir=self.config.raw_news_gdelt)
                )
            else:
                log.warning("news: use_finnhub=True but FINNHUB_API_KEY not set")
        return providers

    # ------------------------------------------------------------------
    # Fetch
    # ------------------------------------------------------------------

    def fetch_symbol(
        self,
        symbol: str,
        company_name: str,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        """Fetch articles from all providers; combine and deduplicate by URL."""
        frames: list[pd.DataFrame] = []
        for provider in self.providers:
            try:
                df = provider.fetch_articles(symbol, company_name, start_date, end_date)
                if df is not None and not df.empty:
                    df["symbol"] = symbol.upper()
                    frames.append(df)
            except Exception as e:
                log.warning("news %s: provider %s failed — %s", symbol, provider.name, e)

        if not frames:
            return pd.DataFrame(columns=_ARTICLE_COLS)

        combined = pd.concat(frames, ignore_index=True)
        if "url" in combined.columns:
            combined = combined.drop_duplicates(subset=["url"])
        return combined.reset_index(drop=True)

    def fetch_batch(
        self,
        symbols: List[str],
        company_names: Optional[Dict[str, str]] = None,
        start_date: str = "",
        end_date: str = "",
    ) -> pd.DataFrame:
        """Fetch all symbols; log failures; return combined DataFrame."""
        if company_names is None:
            company_names = {}

        frames: list[pd.DataFrame] = []
        for sym in symbols:
            name = company_names.get(sym, sym)
            df = self.fetch_symbol(sym, name, start_date, end_date)
            if df.empty:
                log.warning("news batch: no articles for %s", sym)
            else:
                frames.append(df)

        if not frames:
            return pd.DataFrame(columns=_ARTICLE_COLS)
        return pd.concat(frames, ignore_index=True)

    # ------------------------------------------------------------------
    # Full pipeline
    # ------------------------------------------------------------------

    def run(
        self,
        symbols: List[str],
        company_names: Optional[Dict[str, str]] = None,
        start_date: str = "",
        end_date: str = "",
    ) -> dict:
        """Fetch all symbols → save raw cache → return summary."""
        log.info("news run: fetching articles for %d symbols", len(symbols))
        df = self.fetch_batch(symbols, company_names, start_date, end_date)

        summary = {
            "total_articles": len(df),
            "symbols_fetched": int(df["symbol"].nunique()) if not df.empty else 0,
        }

        raw_dir = Path(self.config.raw_news_gdelt)
        raw_dir.mkdir(parents=True, exist_ok=True)

        # Write general summary
        summary_path = raw_dir / "news_ingestion_summary.json"
        with open(summary_path, "w") as f:
            json.dump(summary, f, indent=2, default=str)

        # Write GDELT-specific coverage report (M6)
        self._save_gdelt_coverage(df, symbols, raw_dir)

        log.info("news run: summary written to %s", summary_path)
        return summary

    def _save_gdelt_coverage(
        self,
        df: pd.DataFrame,
        symbols: List[str],
        raw_dir: Path,
    ) -> None:
        """Save gdelt_news_coverage.json with per-symbol article stats."""
        per_symbol: list = []
        for sym in symbols:
            if df.empty or "symbol" not in df.columns:
                sym_df = pd.DataFrame()
            else:
                sym_df = df[df["symbol"].str.upper() == sym.upper()]

            n = len(sym_df)
            if n == 0:
                per_symbol.append({
                    "symbol": sym,
                    "article_count": 0,
                    "date_min": None,
                    "date_max": None,
                    "avg_tone": None,
                    "neg_tone_ratio": None,
                })
                continue

            dates = pd.to_datetime(sym_df["date"], errors="coerce").dropna()
            tones = sym_df["tone"].dropna() if "tone" in sym_df.columns else pd.Series([], dtype=float)

            per_symbol.append({
                "symbol": sym,
                "article_count": n,
                "date_min": str(dates.min().date()) if len(dates) else None,
                "date_max": str(dates.max().date()) if len(dates) else None,
                "avg_tone": float(tones.mean()) if len(tones) else None,
                "neg_tone_ratio": float((tones < 0).mean()) if len(tones) else None,
            })

        coverage = {
            "total_articles": len(df),
            "symbols_with_coverage": sum(1 for s in per_symbol if s["article_count"] > 0),
            "symbols_no_coverage": sum(1 for s in per_symbol if s["article_count"] == 0),
            "per_symbol": per_symbol,
        }

        raw_dir.mkdir(parents=True, exist_ok=True)
        coverage_path = raw_dir / "gdelt_news_coverage.json"
        with open(coverage_path, "w") as f:
            json.dump(coverage, f, indent=2, default=str)
        log.info("news run: GDELT coverage report written to %s", coverage_path)
