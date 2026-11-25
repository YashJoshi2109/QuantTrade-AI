"""SEC EDGAR ingestion orchestrator.

For each symbol: resolves CIK → fetches submissions → fetches filing
metadata → downloads filing texts.  Writes a summary JSON and returns
a consolidated filings DataFrame.

Point-in-time safety: ``available_at`` is always ``acceptedDatetime``
or ``filingDate`` — never ``period_of_report``.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from data.config import FreeDataConfig

log = logging.getLogger(__name__)

_FILINGS_COLS = [
    "symbol",
    "cik",
    "accessionNumber",
    "form",
    "filingDate",
    "acceptedDatetime",
    "primaryDocument",
    "available_at",
]


class SECIngestion:
    """Orchestrate SEC EDGAR data collection for a list of symbols."""

    def __init__(self, config: FreeDataConfig) -> None:
        self.config = config
        from data.providers.sec.edgar import SECEdgarProvider

        self.provider = SECEdgarProvider(
            user_agent=config.sec_user_agent,
            rate_limit_delay=config.sec_rate_limit_delay,
            max_retries=config.sec_max_retries,
            submissions_dir=config.raw_sec_submissions,
            facts_dir=config.raw_sec_companyfacts,
            filings_dir=config.raw_sec_filings,
        )

    # ------------------------------------------------------------------
    # Ingest
    # ------------------------------------------------------------------

    def ingest_symbols(
        self,
        symbols: List[str],
        forms: Optional[List[str]] = None,
    ) -> dict:
        """For each symbol: get CIK → fetch submissions → fetch filings → download texts.

        Returns summary dict with counts per symbol.
        Writes ``sec_ingestion_summary.json`` to ``raw_sec_filings``.
        """
        if forms is None:
            forms = list(self.config.sec_forms)

        summary: dict = {"symbols": {}, "total_filings": 0, "total_texts_downloaded": 0}

        for sym in symbols:
            sym_result: dict = {
                "cik": None,
                "filings_count": 0,
                "texts_downloaded": 0,
                "errors": [],
            }
            try:
                cik = self.provider.get_cik(sym)
                if cik is None:
                    sym_result["errors"].append("CIK not found")
                    summary["symbols"][sym] = sym_result
                    continue

                sym_result["cik"] = cik

                # Fetch filings metadata
                filings_df = self.provider.fetch_recent_filings(cik, forms)
                sym_result["filings_count"] = len(filings_df)
                summary["total_filings"] += len(filings_df)

                # Download filing texts
                if not filings_df.empty:
                    for _, row in filings_df.iterrows():
                        acc = row.get("accessionNumber", "")
                        doc = row.get("primaryDocument", "")
                        if acc and doc:
                            try:
                                text = self.provider.download_filing_text(cik, acc, doc)
                                if text:
                                    sym_result["texts_downloaded"] += 1
                                    summary["total_texts_downloaded"] += 1
                            except Exception as e:
                                log.warning("sec ingest %s: text download failed %s — %s", sym, acc, e)
                                sym_result["errors"].append(f"text_download_failed:{acc}:{e}")

            except Exception as e:
                log.error("sec ingest %s: unexpected error — %s", sym, e)
                sym_result["errors"].append(str(e))

            summary["symbols"][sym] = sym_result
            log.info(
                "sec ingest %s: cik=%s filings=%d texts=%d",
                sym,
                sym_result["cik"],
                sym_result["filings_count"],
                sym_result["texts_downloaded"],
            )

        # Write summary JSON
        summary_dir = Path(self.config.raw_sec_filings)
        summary_dir.mkdir(parents=True, exist_ok=True)
        summary_path = summary_dir / "sec_ingestion_summary.json"
        with open(summary_path, "w") as f:
            json.dump(summary, f, indent=2, default=str)
        log.info("sec ingest: summary written to %s", summary_path)

        return summary

    # ------------------------------------------------------------------
    # Consolidated DataFrame
    # ------------------------------------------------------------------

    def get_filings_dataframe(self, symbols: List[str]) -> pd.DataFrame:
        """Return consolidated filings DataFrame for all symbols.

        Columns: symbol, cik, accessionNumber, form, filingDate,
                 acceptedDatetime, primaryDocument, available_at.

        CRITICAL: ``available_at`` is ``acceptedDatetime`` if non-null,
        else ``filingDate``.  Never ``period_of_report``.
        """
        forms = list(self.config.sec_forms)
        frames: list[pd.DataFrame] = []

        for sym in symbols:
            cik = self.provider.get_cik(sym)
            if cik is None:
                log.warning("sec_df %s: CIK not found, skipping", sym)
                continue
            try:
                df = self.provider.fetch_recent_filings(cik, forms)
                if df.empty:
                    continue
                df["symbol"] = sym.upper()
                df["cik"] = cik
                frames.append(df)
            except Exception as e:
                log.error("sec_df %s: error fetching filings — %s", sym, e)

        if not frames:
            return pd.DataFrame(columns=_FILINGS_COLS)

        combined = pd.concat(frames, ignore_index=True)

        # Ensure all required columns present
        for col in _FILINGS_COLS:
            if col not in combined.columns:
                combined[col] = None

        # Re-assert PIT constraint: available_at must not be period_of_report
        combined["available_at"] = combined["acceptedDatetime"].combine_first(
            combined["filingDate"]
        )

        return combined[_FILINGS_COLS].reset_index(drop=True)
