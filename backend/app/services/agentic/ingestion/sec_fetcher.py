"""
SEC EDGAR filing fetcher.
Uses EDGAR Full-Text Search + submissions API (free, no key required).
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Optional

import requests

logger = logging.getLogger(__name__)

EDGAR_BASE          = "https://data.sec.gov"       # submissions API
EDGAR_ARCHIVES      = "https://www.sec.gov"        # filing documents
EDGAR_SEARCH        = "https://efts.sec.gov/LATEST/search-index"
EDGAR_TICKERS_URL   = "https://www.sec.gov/files/company_tickers.json"
USER_AGENT          = os.getenv("EDGAR_USER_AGENT", "QuantTrade/1.0 admin@quanttrade.us")
RATE_LIMIT_SEC      = 0.12   # ~8 req/sec, under EDGAR's 10/sec limit

SUPPORTED_FILING_TYPES = {"10-K", "10-Q", "8-K", "DEF 14A"}

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
}


@dataclass
class Filing:
    ticker:          str
    cik:             str
    accession_num:   str
    filing_type:     str
    filed_date:      str
    fiscal_year:     int
    primary_doc_url: str


@lru_cache(maxsize=1)
def _get_cik_map() -> dict[str, str]:
    """Download EDGAR company_tickers.json and build ticker→CIK map. Cached in memory."""
    try:
        resp = requests.get(EDGAR_TICKERS_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # Keys are stringified ints; values have keys: cik_str, ticker, title
        return {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in data.values()}
    except Exception as e:
        logger.warning("Failed to download EDGAR company_tickers.json: %s", e)
        return {}


def get_cik_for_ticker(ticker: str) -> Optional[str]:
    """
    Look up EDGAR CIK for a stock ticker.
    Returns zero-padded 10-digit CIK string, or None if not found.
    Uses company_tickers.json (bulk download) with EDGAR search as fallback.
    """
    # Primary: bulk CIK map (single HTTP request covers all tickers)
    cik_map = _get_cik_map()
    if ticker.upper() in cik_map:
        return cik_map[ticker.upper()]

    # Fallback: EDGAR full-text search
    time.sleep(RATE_LIMIT_SEC)
    url = f"{EDGAR_SEARCH}?q=%22{ticker}%22&dateRange=custom&startdt=2000-01-01&forms=10-K"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        hits = resp.json().get("hits", {}).get("hits", [])
        if not hits:
            return None
        raw_cik = str(hits[0]["_source"].get("entity_id", ""))
        return raw_cik.zfill(10) if raw_cik else None
    except Exception as e:
        logger.warning("CIK lookup failed for %s: %s", ticker, e)
        return None


def fetch_filings_for_ticker(
    ticker: str,
    years_back: int = 5,
    filing_types: set[str] | None = None,
) -> list[Filing]:
    """Fetch all recent filings for a ticker from EDGAR submissions API."""
    if filing_types is None:
        filing_types = SUPPORTED_FILING_TYPES

    cik = get_cik_for_ticker(ticker)
    if not cik:
        logger.warning("No CIK for %s — skipping", ticker)
        return []

    time.sleep(RATE_LIMIT_SEC)
    url = f"{EDGAR_BASE}/submissions/CIK{cik}.json"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error("Failed to fetch submissions for %s: %s", ticker, e)
        return []

    recent       = data.get("filings", {}).get("recent", {})
    accessions   = recent.get("accessionNumber", [])
    forms        = recent.get("form", [])
    dates        = recent.get("filingDate", [])
    primary_docs = recent.get("primaryDocument", [])

    cutoff = datetime.now() - timedelta(days=years_back * 365)
    filings: list[Filing] = []

    for acc, form, date_str, doc in zip(accessions, forms, dates, primary_docs):
        if form not in filing_types:
            continue
        try:
            filed_dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue
        if years_back > 0 and filed_dt < cutoff:
            continue

        acc_clean = acc.replace("-", "")
        # EDGAR archive base is www.sec.gov, not data.sec.gov
        cik_numeric = cik.lstrip("0") or "0"
        doc_url = f"{EDGAR_ARCHIVES}/Archives/edgar/data/{cik_numeric}/{acc_clean}/{doc}"

        filings.append(Filing(
            ticker=ticker,
            cik=cik,
            accession_num=acc,
            filing_type=form,
            filed_date=date_str,
            fiscal_year=filed_dt.year,
            primary_doc_url=doc_url,
        ))

    return filings


MAX_FILING_BYTES = 5 * 1024 * 1024  # 5 MB cap — prevents OOM on giant iXBRL filings


def download_filing_text(filing: Filing) -> Optional[str]:
    """
    Download and extract plain text from a filing's primary document.
    Handles HTML and plain-text filings. Returns None on failure.
    """
    time.sleep(RATE_LIMIT_SEC)
    try:
        resp = requests.get(filing.primary_doc_url, headers=HEADERS, timeout=30, stream=True)
        resp.raise_for_status()
        # Cap download size to avoid OOM on giant iXBRL filings
        content = b""
        for chunk in resp.iter_content(chunk_size=65536):
            content += chunk
            if len(content) >= MAX_FILING_BYTES:
                logger.debug("Filing %s truncated at %dMB", filing.accession_num, MAX_FILING_BYTES // (1024*1024))
                break
        content_type = resp.headers.get("Content-Type", "")

        if "html" in content_type or filing.primary_doc_url.endswith((".htm", ".html")):
            from bs4 import BeautifulSoup
            # Use html.parser (pure Python) — lxml can segfault on large iXBRL documents
            soup = BeautifulSoup(content, "html.parser")
            for tag in soup(["script", "style", "ix:nonnumeric", "ix:nonfraction", "xbrli:xbrl", "xbrl"]):
                tag.decompose()
            return soup.get_text(separator="\n", strip=True)
        else:
            return content.decode("utf-8", errors="replace")

    except Exception as e:
        logger.error("Failed to download filing %s: %s", filing.accession_num, e)
        return None


def _quarter(dt: datetime) -> str:
    return f"QTR{(dt.month - 1) // 3 + 1}"
