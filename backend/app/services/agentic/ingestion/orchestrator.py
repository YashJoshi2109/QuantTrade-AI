"""
Full ingestion pipeline orchestrator.
Wires: SEC fetcher → chunker → embedder → indexer
Supports full corpus load and nightly delta updates.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from app.services.agentic.ingestion.sec_fetcher import (
    fetch_filings_for_ticker,
    download_filing_text,
)
from app.services.agentic.ingestion.chunker import chunk_filing
from app.services.agentic.ingestion.embedder import embed_chunks_async
from app.services.agentic.ingestion.indexer import (
    ensure_collections_exist,
    upsert_chunks,
)

logger = logging.getLogger(__name__)

# Representative S&P 500 + Russell 1000 tickers
# Full list can be loaded from CSV in production
UNIVERSE_TICKERS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
    "JPM", "JNJ", "UNH", "XOM", "V", "LLY", "AVGO", "PG", "HD", "MA",
    "CVX", "ABBV", "MRK", "COST", "PEP", "KO", "ADBE", "CRM", "TMO",
    "ACN", "MCD", "CSCO", "BAC", "WMT", "NKE", "ABT", "LIN", "DHR",
]


@dataclass
class IngestionStatus:
    started_at:    str = field(default_factory=lambda: datetime.utcnow().isoformat())
    finished_at:   Optional[str] = None
    total_tickers: int = 0
    processed:     int = 0
    failed:        int = 0
    total_chunks:  int = 0
    is_running:    bool = False
    last_error:    Optional[str] = None


_status = IngestionStatus()


def get_ingestion_status() -> IngestionStatus:
    return _status


async def ingest_ticker(ticker: str, years_back: int = 5) -> int:
    """Run full ingestion pipeline for one ticker. Returns new chunks indexed."""
    filings = fetch_filings_for_ticker(ticker, years_back=years_back)
    if not filings:
        return 0

    total_new = 0
    for filing in filings:
        text = download_filing_text(filing)
        if not text or len(text) < 200:
            continue

        filing_meta = {
            "ticker":       filing.ticker,
            "company_name": ticker,
            "filing_type":  filing.filing_type,
            "filed_date":   filing.filed_date,
            "fiscal_year":  filing.fiscal_year,
            "cik":          filing.cik,
        }

        children, parents = chunk_filing(text, filing_meta)
        if not children:
            continue

        vectors = await embed_chunks_async(children)
        if not vectors:
            continue

        upsert_chunks(children, parents, vectors)
        total_new += len(vectors)
        logger.info("%s %s: indexed %d new chunks", ticker, filing.filing_type, len(vectors))

    return total_new


async def run_full_ingestion(
    tickers: list[str] | None = None,
    years_back: int = 5,
) -> IngestionStatus:
    """Full corpus ingestion. Sequential (EDGAR rate limits)."""
    global _status
    tickers = tickers or UNIVERSE_TICKERS
    _status = IngestionStatus(total_tickers=len(tickers), is_running=True)

    ensure_collections_exist()

    for ticker in tickers:
        try:
            new_chunks = await ingest_ticker(ticker, years_back=years_back)
            _status.total_chunks += new_chunks
            _status.processed += 1
        except Exception as e:
            logger.error("Failed to ingest %s: %s", ticker, e)
            _status.failed += 1
            _status.last_error = str(e)

    _status.finished_at = datetime.utcnow().isoformat()
    _status.is_running = False
    return _status


async def run_delta_ingestion() -> IngestionStatus:
    """Nightly delta — only recent filings. Called by APScheduler at 2AM EST."""
    return await run_full_ingestion(years_back=0)


def register_ingestion_jobs(scheduler) -> None:
    """Register APScheduler jobs. Call from app startup."""
    scheduler.add_job(
        lambda: asyncio.run(run_delta_ingestion()),
        trigger="cron",
        hour=2,
        minute=0,
        timezone="US/Eastern",
        id="nightly_delta_ingestion",
        replace_existing=True,
    )
    logger.info("Registered nightly delta ingestion job (2AM EST)")
