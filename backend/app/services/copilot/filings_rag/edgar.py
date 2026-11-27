"""EDGAR access for filings RAG: submissions, filing indexes, documents, XBRL.

SEC fair access (https://www.sec.gov/os/accessing-edgar-data):
  * declared User-Agent: the same EDGAR_USER_AGENT setting the SEC refresh
    job uses (``sec_fetcher.USER_AGENT``)
  * <= 10 requests/second: one process-wide throttle (``MIN_INTERVAL_S``),
    plus a back-off retry on 429/403/503
  * caching: filing documents and filing indexes are immutable (an accession
    never changes) and are cached on disk forever; submissions and
    companyfacts JSON are cached on disk for ``JSON_TTL_H`` and in the same
    S3 keys ``sec_edgar_service`` already uses (``edgar/submissions/{cik}.json``,
    ``edgar/company_facts/{cik}.json``), so the two never fetch the same JSON twice.

``EdgarClient`` is the live provider; tests pass a fake with the same five
methods (cik, submissions, company_facts, filing_index, document).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

logger = logging.getLogger(__name__)

DATA_BASE = "https://data.sec.gov"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
MIN_INTERVAL_S = float(os.getenv("COPILOT_EDGAR_MIN_INTERVAL_S", "0.12"))   # ~8 req/s
JSON_TTL_H = float(os.getenv("COPILOT_EDGAR_JSON_TTL_H", "12"))
MAX_DOC_BYTES = int(os.getenv("COPILOT_EDGAR_MAX_DOC_BYTES", str(40 * 1024 * 1024)))
CACHE_DIR = Path(os.getenv("COPILOT_EDGAR_CACHE_DIR", os.path.join(tempfile.gettempdir(), "quanttrade-edgar")))


class EdgarUnavailable(LookupError):
    """EDGAR could not be reached / returned nothing usable (explicit, never defaulted)."""


class EdgarProvider(Protocol):
    def cik(self, ticker: str) -> Optional[str]: ...
    def submissions(self, cik: str) -> Dict[str, Any]: ...
    def company_facts(self, cik: str) -> Optional[Dict[str, Any]]: ...
    def filing_index(self, cik: str, accession: str) -> List[Dict[str, str]]: ...
    def document(self, cik: str, accession: str, name: str) -> bytes: ...


@dataclass(frozen=True)
class FilingRef:
    """One filing from the EDGAR submissions API."""
    ticker: str
    cik: str
    company: str
    form: str
    filing_date: str
    report_date: str
    accession: str
    primary_doc: str
    items: str = ""                       # 8-K item codes, e.g. "2.02,9.01"

    @property
    def base_url(self) -> str:
        return f"{ARCHIVES}/{int(self.cik)}/{self.accession.replace('-', '')}"

    def doc_url(self, name: Optional[str] = None) -> str:
        return f"{self.base_url}/{name or self.primary_doc}"

    @property
    def index_url(self) -> str:
        return f"{self.base_url}/{self.accession}-index.htm"

    def short(self) -> Dict[str, Any]:
        return {"form": self.form, "filing_date": self.filing_date, "report_date": self.report_date or None,
                "accession": self.accession, "primary_document": self.primary_doc,
                "items": self.items or None, "url": self.doc_url(), "index_url": self.index_url}


# ── submissions -> FilingRef ────────────────────────────────────────────────

def _rows(block: Dict[str, Any]) -> List[Dict[str, str]]:
    keys = ("accessionNumber", "form", "filingDate", "reportDate", "primaryDocument", "items")
    cols = {k: block.get(k) or [] for k in keys}
    n = len(cols["accessionNumber"])
    return [{k: (cols[k][i] if i < len(cols[k]) else "") or "" for k in keys} for i in range(n)]


def filing_refs(ticker: str, cik: str, sub: Dict[str, Any], forms: List[str],
                include_amendments: bool = False) -> List[FilingRef]:
    """FilingRefs of the given forms, newest first (``sub`` = merged submissions)."""
    want = set(forms)
    if include_amendments:
        want |= {f + "/A" for f in forms}
    company = sub.get("name") or ""
    out = []
    seen = set()
    for r in _rows(sub.get("filings", {}).get("recent", {})) + [
            x for page in sub.get("_older", []) for x in _rows(page)]:
        if r["form"] not in want or r["accessionNumber"] in seen:
            continue
        seen.add(r["accessionNumber"])
        out.append(FilingRef(ticker=ticker.upper(), cik=str(cik).zfill(10), company=company, form=r["form"],
                             filing_date=r["filingDate"], report_date=r["reportDate"],
                             accession=r["accessionNumber"], primary_doc=r["primaryDocument"],
                             items=r["items"]))
    out.sort(key=lambda f: (f.filing_date, f.accession), reverse=True)
    return out


_INDEX_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.I | re.S)
_CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.I | re.S)
_HREF = re.compile(r'href="([^"]+)"', re.I)
_TAGS = re.compile(r"<[^>]+>")


def parse_filing_index(html: str) -> List[Dict[str, str]]:
    """Rows of an EDGAR ``{accession}-index.htm`` document table
    (Seq | Description | Document | Type | Size)."""
    out = []
    for row in _INDEX_ROW.findall(html or ""):
        cells = _CELL.findall(row)
        if len(cells) < 4:
            continue
        href = _HREF.search(cells[2])
        name = (href.group(1).rsplit("/", 1)[-1] if href else _TAGS.sub("", cells[2])).strip()
        name = name.split("?", 1)[0]
        if name.startswith("ix?doc="):
            name = name.rsplit("/", 1)[-1]
        typ = _TAGS.sub("", cells[3]).strip()
        if not name or not typ or typ.lower() == "type":
            continue
        out.append({"seq": _TAGS.sub("", cells[0]).strip(), "description": _TAGS.sub("", cells[1]).strip(),
                    "document": name, "type": typ})
    return out


# ── live client ─────────────────────────────────────────────────────────────

class _Throttle:
    def __init__(self, interval: float):
        self.interval = interval
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self.interval
        if delay > 0:
            time.sleep(delay)


THROTTLE = _Throttle(MIN_INTERVAL_S)


def _s3_enabled() -> bool:
    return os.getenv("COPILOT_EDGAR_S3", "1") == "1" and os.getenv("APP_ENV", "").lower() != "test"


@dataclass
class EdgarClient:
    cache_dir: Path = field(default_factory=lambda: CACHE_DIR)
    timeout: float = 30.0

    def __post_init__(self):
        from app.services.copilot.sec_fetcher import USER_AGENT
        self.user_agent = USER_AGENT

    # disk cache ------------------------------------------------------------
    def _path(self, key: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", key)
        if len(safe) > 150:
            safe = safe[:100] + hashlib.sha1(key.encode()).hexdigest()
        return self.cache_dir / (safe + ".gz")

    def _read(self, key: str, ttl_h: Optional[float]) -> Optional[bytes]:
        p = self._path(key)
        try:
            if ttl_h is not None and (time.time() - p.stat().st_mtime) > ttl_h * 3600:
                return None
            return gzip.decompress(p.read_bytes())
        except (OSError, EOFError, gzip.BadGzipFile):
            return None

    def _write(self, key: str, data: bytes) -> None:
        try:
            p = self._path(key)
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(f".tmp{os.getpid()}{threading.get_ident()}")
            tmp.write_bytes(gzip.compress(data, compresslevel=5))
            os.replace(tmp, p)
        except OSError as e:
            logger.warning("edgar cache write failed for %s: %s", key, e)

    # http ------------------------------------------------------------------
    def _get(self, url: str, accept: str = "*/*") -> bytes:
        import requests
        headers = {"User-Agent": self.user_agent, "Accept": accept, "Accept-Encoding": "gzip, deflate"}
        last = None
        for attempt in range(3):
            THROTTLE.wait()
            try:
                r = requests.get(url, headers=headers, timeout=self.timeout, stream=True)
            except Exception as e:                      # network error
                last = f"{type(e).__name__}"
                time.sleep(0.5 * (attempt + 1))
                continue
            if r.status_code in (403, 429, 503):
                last = f"HTTP {r.status_code}"
                time.sleep(1.0 * (attempt + 1))         # back off: SEC throttles bursts
                continue
            if r.status_code == 404:
                raise EdgarUnavailable(f"EDGAR 404 for {url}")
            if r.status_code >= 400:
                raise EdgarUnavailable(f"EDGAR HTTP {r.status_code} for {url}")
            buf = bytearray()
            for chunk in r.iter_content(65536):
                buf += chunk
                if len(buf) > MAX_DOC_BYTES:
                    raise EdgarUnavailable(f"document larger than {MAX_DOC_BYTES} bytes: {url}")
            return bytes(buf)
        raise EdgarUnavailable(f"EDGAR unavailable for {url} ({last})")

    def _json(self, key: str, url: str, s3_key: Optional[str] = None) -> Dict[str, Any]:
        raw = self._read(key, JSON_TTL_H)
        if raw is not None:
            return json.loads(raw)
        if s3_key and _s3_enabled():
            try:
                from app.services.sec_edgar_service import _is_stale, _s3_get
                cached = _s3_get(s3_key)
                if cached and not _is_stale(cached, max_age_hours=JSON_TTL_H):
                    self._write(key, json.dumps(cached).encode())
                    return cached
            except Exception as e:
                logger.debug("edgar s3 read skipped: %s", e)
        data = json.loads(self._get(url, "application/json"))
        data["_cached_at"] = datetime.now(timezone.utc).isoformat()
        self._write(key, json.dumps(data).encode())
        if s3_key and _s3_enabled():
            try:
                from app.services.sec_edgar_service import _s3_put
                _s3_put(s3_key, data)
            except Exception as e:
                logger.debug("edgar s3 write skipped: %s", e)
        return data

    # provider API ----------------------------------------------------------
    def cik(self, ticker: str) -> Optional[str]:
        from app.services.copilot.sec_fetcher import get_cik_for_ticker
        t = ticker.upper()
        return get_cik_for_ticker(t) or (get_cik_for_ticker(t.replace(".", "-")) if "." in t else None)

    def submissions(self, cik: str) -> Dict[str, Any]:
        cik = str(cik).zfill(10)
        return self._json(f"submissions_{cik}.json", f"{DATA_BASE}/submissions/CIK{cik}.json",
                          s3_key=f"edgar/submissions/{cik}.json")

    def older_submissions(self, name: str) -> Dict[str, Any]:
        # older pages only grow at the far end; a long TTL is safe
        raw = self._read(name, 24 * 30)
        if raw is not None:
            return json.loads(raw)
        data = json.loads(self._get(f"{DATA_BASE}/submissions/{name}", "application/json"))
        self._write(name, json.dumps(data).encode())
        return data

    def company_facts(self, cik: str) -> Optional[Dict[str, Any]]:
        cik = str(cik).zfill(10)
        try:
            return self._json(f"companyfacts_{cik}.json", f"{DATA_BASE}/api/xbrl/companyfacts/CIK{cik}.json",
                              s3_key=f"edgar/company_facts/{cik}.json")
        except EdgarUnavailable as e:
            logger.warning("companyfacts unavailable for %s: %s", cik, e)
            return None

    def filing_index(self, cik: str, accession: str) -> List[Dict[str, str]]:
        key = f"index_{accession}.htm"
        raw = self._read(key, None)
        if raw is None:
            url = f"{ARCHIVES}/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"
            raw = self._get(url, "text/html")
            self._write(key, raw)
        return parse_filing_index(raw.decode("utf-8", errors="replace"))

    def document(self, cik: str, accession: str, name: str) -> bytes:
        key = f"doc_{accession}_{name}"
        raw = self._read(key, None)
        if raw is None:
            raw = self._get(f"{ARCHIVES}/{int(cik)}/{accession.replace('-', '')}/{name}", "text/html")
            self._write(key, raw)
        return raw


def merged_submissions(provider: EdgarProvider, cik: str, forms: List[str], need: int) -> Dict[str, Any]:
    """Submissions JSON, with older pages appended (``_older``) only when the
    ``recent`` block has fewer than ``need`` filings of a requested form
    (Form-4-heavy filers can push 10-Ks out of ``recent``)."""
    sub = provider.submissions(cik)
    if not sub:
        raise EdgarUnavailable(f"no EDGAR submissions for CIK {cik}")
    recent = _rows(sub.get("filings", {}).get("recent", {}))
    counts = {f: sum(1 for r in recent if r["form"] == f) for f in forms}
    older = getattr(provider, "older_submissions", None)
    if older is None or all(c >= need for c in counts.values()):
        return sub
    pages = []
    for f in sub.get("filings", {}).get("files", []) or []:
        try:
            page = older(f["name"])
        except Exception as e:
            logger.warning("older submissions page %s unavailable: %s", f.get("name"), e)
            break
        pages.append(page)
        rows = _rows(page)
        for form in forms:
            counts[form] += sum(1 for r in rows if r["form"] == form)
        if all(c >= need for c in counts.values()):
            break
    return {**sub, "_older": pages}


_DEFAULT: Optional[EdgarProvider] = None
_DEFAULT_LOCK = threading.Lock()


def get_provider() -> EdgarProvider:
    global _DEFAULT
    with _DEFAULT_LOCK:
        if _DEFAULT is None:
            _DEFAULT = EdgarClient()
        return _DEFAULT


def set_provider(p: Optional[EdgarProvider]) -> None:
    """Tests / eval harness: swap the EDGAR provider (None = live client)."""
    global _DEFAULT
    with _DEFAULT_LOCK:
        _DEFAULT = p
