"""SEC EDGAR free-data provider.

Point-in-time constraint: ``available_at`` is always set to
``acceptedDatetime`` (when EDGAR accepted the filing) or ``filingDate``
as a fallback.  It is NEVER set to ``period_of_report`` (the fiscal
period end date), which would introduce look-ahead bias.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import List, Optional

import pandas as pd
import requests

from data.providers.base import SECProvider

log = logging.getLogger(__name__)

_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"
_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"
_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession_clean}/{doc}"


class SECEdgarProvider(SECProvider):
    """Retrieve filings, company facts, and raw filing text from SEC EDGAR.

    All responses are cached to disk before parsing.  The rate limiter
    sleeps ``rate_limit_delay`` seconds between every outbound request
    (SEC allows 10 req/s; default 0.12 s ≈ 8 req/s to stay within limit).
    """

    name = "sec_edgar"

    def __init__(
        self,
        user_agent: str = "QuantTradeAI research@example.com",
        rate_limit_delay: float = 0.12,
        max_retries: int = 5,
        submissions_dir: Optional[str] = None,
        facts_dir: Optional[str] = None,
        filings_dir: Optional[str] = None,
    ) -> None:
        self.user_agent = user_agent
        self.rate_limit_delay = rate_limit_delay
        self.max_retries = max_retries
        self.submissions_dir = Path(submissions_dir) if submissions_dir else None
        self.facts_dir = Path(facts_dir) if facts_dir else None
        self.filings_dir = Path(filings_dir) if filings_dir else None
        self._ticker_map: Optional[dict] = None  # lazy-loaded

    # ------------------------------------------------------------------
    # SECProvider abstract methods
    # ------------------------------------------------------------------

    def get_cik(self, symbol: str) -> Optional[str]:
        """Return zero-padded 10-digit CIK for *symbol*, or None if not found."""
        mapping = self._load_ticker_map()
        sym_upper = symbol.upper()
        for entry in mapping.values():
            if entry.get("ticker", "").upper() == sym_upper:
                return str(entry["cik_str"]).zfill(10)
        log.warning("sec_edgar: CIK not found for symbol '%s'", symbol)
        return None

    def fetch_submissions(self, cik: str) -> dict:
        """Return raw submissions JSON for *cik* (zero-padded 10 digits)."""
        cik10 = cik.zfill(10)
        cache_path = (self.submissions_dir / f"CIK{cik10}.json") if self.submissions_dir else None
        if cache_path and cache_path.exists():
            log.debug("sec_edgar: loading submissions from cache %s", cache_path)
            with open(cache_path) as f:
                return json.load(f)
        url = _SUBMISSIONS_URL.format(cik10=cik10)
        data = self._get_json(url)
        if cache_path:
            self._save_json(data, cache_path)
        return data

    def fetch_company_facts(self, cik: str) -> dict:
        """Return raw company-facts JSON for *cik*."""
        cik10 = cik.zfill(10)
        cache_path = (self.facts_dir / f"CIK{cik10}_facts.json") if self.facts_dir else None
        if cache_path and cache_path.exists():
            log.debug("sec_edgar: loading company facts from cache %s", cache_path)
            with open(cache_path) as f:
                return json.load(f)
        url = _FACTS_URL.format(cik10=cik10)
        data = self._get_json(url)
        if cache_path:
            self._save_json(data, cache_path)
        return data

    def fetch_recent_filings(self, cik: str, forms: List[str]) -> pd.DataFrame:
        """Return DataFrame of recent filings filtered to *forms*.

        Columns: accessionNumber, form, filingDate, acceptedDatetime,
                 primaryDocument, available_at.

        CRITICAL: ``available_at`` = ``acceptedDatetime`` if non-null,
        else ``filingDate``.  Never ``period_of_report``.
        """
        submissions = self.fetch_submissions(cik)
        recent = submissions.get("filings", {}).get("recent", {})
        if not recent:
            log.warning("sec_edgar CIK %s: no recent filings found", cik)
            return pd.DataFrame()

        df = pd.DataFrame(recent)

        # Filter to requested form types
        if "form" in df.columns and forms:
            df = df[df["form"].isin(forms)].copy()

        if df.empty:
            return pd.DataFrame()

        # Rename to canonical column names
        # The SEC submissions JSON spells it ``acceptanceDateTime`` (capital T).
        # An earlier mapping only knew ``acceptanceDatetime``, so every filing
        # silently fell back to its filing date at midnight — an after-close
        # filing then looked available on the same day's row (look-ahead).
        col_map = {
            "accessionNumber": "accessionNumber",
            "form": "form",
            "filingDate": "filingDate",
            "acceptanceDateTime": "acceptedDatetime",
            "acceptanceDatetime": "acceptedDatetime",
            "primaryDocument": "primaryDocument",
        }
        df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})

        # Ensure required columns exist (with NaN if absent)
        for col in ["accessionNumber", "form", "filingDate", "acceptedDatetime", "primaryDocument"]:
            if col not in df.columns:
                df[col] = None

        # Convert dates
        df["filingDate"] = pd.to_datetime(df["filingDate"], errors="coerce")
        df["acceptedDatetime"] = _parse_acceptance(df["acceptedDatetime"])

        # PIT-safe available_at: acceptance timestamp when known. Without one,
        # assume the filing landed after the close and make it available the
        # next day (filing-date midnight would leak an after-close filing).
        df["available_at"] = df["acceptedDatetime"].combine_first(
            df["filingDate"] + pd.Timedelta(days=1)
        )

        result_cols = [
            "accessionNumber", "form", "filingDate", "acceptedDatetime",
            "primaryDocument", "available_at",
        ]
        return df[result_cols].reset_index(drop=True)

    def download_filing_text(
        self,
        cik: str,
        accession_number: str,
        primary_document: str,
    ) -> str:
        """Download and return the raw text of a filing document.

        Caches the raw HTML/text to ``filings_dir/{cik}/{accession_clean}/``.
        """
        accession_clean = accession_number.replace("-", "")
        url = _ARCHIVES_URL.format(
            cik=cik.lstrip("0"),
            accession_clean=accession_clean,
            doc=primary_document,
        )
        cache_path: Optional[Path] = None
        if self.filings_dir:
            filing_dir = self.filings_dir / cik.lstrip("0") / accession_clean
            filing_dir.mkdir(parents=True, exist_ok=True)
            cache_path = filing_dir / primary_document

        if cache_path and cache_path.exists():
            log.debug("sec_edgar: loading filing text from cache %s", cache_path)
            return cache_path.read_text(errors="replace")

        text = self._get_text(url)
        if cache_path and text:
            cache_path.write_text(text, errors="replace")
        return text or ""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_ticker_map(self) -> dict:
        """Download and cache the SEC company tickers JSON (once per session)."""
        if self._ticker_map is not None:
            return self._ticker_map

        cache_path: Optional[Path] = None
        if self.submissions_dir:
            self.submissions_dir.mkdir(parents=True, exist_ok=True)
            cache_path = self.submissions_dir / "company_tickers.json"

        if cache_path and cache_path.exists():
            with open(cache_path) as f:
                self._ticker_map = json.load(f)
                return self._ticker_map

        log.info("sec_edgar: downloading company tickers map")
        data = self._get_json(_TICKER_MAP_URL)
        if cache_path:
            self._save_json(data, cache_path)
        self._ticker_map = data
        return self._ticker_map

    def _get_json(self, url: str) -> dict:
        """GET *url* with rate limiting and exponential-backoff retry."""
        headers = {"User-Agent": self.user_agent}
        for attempt in range(self.max_retries):
            time.sleep(self.rate_limit_delay)
            try:
                resp = requests.get(url, headers=headers, timeout=30)
                if resp.status_code == 429:
                    wait = 2 ** attempt
                    log.warning("sec_edgar: 429 rate-limited, retrying in %ds (attempt %d)", wait, attempt + 1)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.exceptions.HTTPError as e:
                log.warning("sec_edgar HTTP error %s (attempt %d): %s", url, attempt + 1, e)
                time.sleep(2 ** attempt)
            except Exception as e:
                log.warning("sec_edgar request error %s (attempt %d): %s", url, attempt + 1, e)
                time.sleep(2 ** attempt)
        log.error("sec_edgar: all %d retries exhausted for %s", self.max_retries, url)
        return {}

    def _get_text(self, url: str) -> Optional[str]:
        """GET *url* and return response text with rate limiting and retry."""
        headers = {"User-Agent": self.user_agent}
        for attempt in range(self.max_retries):
            time.sleep(self.rate_limit_delay)
            try:
                resp = requests.get(url, headers=headers, timeout=60)
                if resp.status_code == 429:
                    wait = 2 ** attempt
                    log.warning("sec_edgar: 429 on text fetch, retrying in %ds", wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.text
            except Exception as e:
                log.warning("sec_edgar text fetch error %s (attempt %d): %s", url, attempt + 1, e)
                time.sleep(2 ** attempt)
        return None

    @staticmethod
    def _save_json(data: dict, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)
        log.debug("sec_edgar: saved JSON to %s", path)


def _parse_acceptance(values: pd.Series) -> pd.Series:
    """Parse SEC acceptance timestamps to naive wall-clock datetimes.

    EDGAR serves ``2024-05-02T16:31:05.000Z``; despite the ``Z`` the clock is
    US/Eastern, so the suffix is dropped rather than converted. Compact
    ``YYYYMMDDHHMMSS`` strings are accepted too.
    """
    s = values.astype("string").str.strip().str.replace(r"(\.\d+)?Z$", "", regex=True)
    compact = s.str.fullmatch(r"\d{14}").fillna(False).astype(bool)
    out = pd.to_datetime(s.where(~compact), errors="coerce", format="ISO8601")
    if compact.any():
        out = out.fillna(pd.to_datetime(s.where(compact), errors="coerce", format="%Y%m%d%H%M%S"))
    return out
