"""HTTP access for public datasets: fair-access rules, disk cache, test isolation.

Fair access, per publisher:

* SEC (www.sec.gov, data.sec.gov) -- https://www.sec.gov/os/accessing-edgar-data
  declared User-Agent (the ``EDGAR_USER_AGENT`` setting, ``sec_fetcher.USER_AGENT``)
  and <= 10 requests/second.  Every SEC request goes through the same
  process-wide throttle as the filings RAG client (``filings_rag.edgar.THROTTLE``,
  ~8 req/s), with back-off on 403/429/503.
* FINRA, Treasury, FRED, BLS, Ken French: a polite per-host minimum interval
  (``HOST_INTERVAL_S``) and the same declared User-Agent.

Caching: responses are written to ``CACHE_DIR`` (gzip) with a per-call TTL;
immutable documents (an EDGAR accession, a closed quarter's data set) use
``ttl_h=None`` (forever).  Large ZIPs are streamed to disk, never held in
memory, and deleted once loaded (``release``); the ``public_data_loads`` log
is what prevents a second download.

Tests: ``set_fetcher(FixtureFetcher(...))`` replaces the network with recorded
files; with APP_ENV=test the live fetcher refuses to run, so no test can touch
the network by accident.
"""
from __future__ import annotations

import gzip
import hashlib
import logging
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Dict, Optional, Protocol, Union
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

CACHE_DIR = Path(os.getenv("PUBLIC_DATA_CACHE_DIR", os.path.join(tempfile.gettempdir(), "quanttrade-public-data")))
MAX_BYTES = int(os.getenv("PUBLIC_DATA_MAX_BYTES", str(400 * 1024 * 1024)))
HOST_INTERVAL_S = {"api.finra.org": 0.5, "cdn.finra.org": 0.5, "home.treasury.gov": 1.0,
                   "fred.stlouisfed.org": 0.5, "api.stlouisfed.org": 0.5, "api.bls.gov": 1.0,
                   "mba.tuck.dartmouth.edu": 1.0}
SEC_HOSTS = {"www.sec.gov", "data.sec.gov", "sec.gov"}


class FetchError(LookupError):
    """The publisher could not be reached or returned nothing usable."""


def user_agent() -> str:
    from app.services.copilot.sec_fetcher import USER_AGENT
    return USER_AGENT


class Fetcher(Protocol):
    def get(self, url: str, *, ttl_h: Optional[float] = 24, method: str = "GET",
            json_body: Optional[dict] = None, accept: str = "*/*",
            secrets: Optional[dict] = None) -> bytes: ...

    def download(self, url: str, *, ttl_h: Optional[float] = None) -> Path: ...


class _HostThrottle:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next: Dict[str, float] = {}

    def wait(self, host: str) -> None:
        if host in SEC_HOSTS:
            from app.services.copilot.filings_rag.edgar import THROTTLE
            THROTTLE.wait()
            return
        interval = HOST_INTERVAL_S.get(host, 0.5)
        with self._lock:
            now = time.monotonic()
            nxt = self._next.get(host, 0.0)
            delay = nxt - now
            self._next[host] = max(now, nxt) + interval
        if delay > 0:
            time.sleep(delay)


_THROTTLE = _HostThrottle()


def _cache_name(url: str, body: Optional[dict]) -> str:
    # url/body never carry credentials (those go in ``secrets``).
    key = url + (repr(sorted(body.items())) if body else "")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", urlsplit(url).netloc + urlsplit(url).path)[-80:]
    return f"{safe}_{hashlib.sha256(key.encode()).hexdigest()[:16]}"


class LiveFetcher:
    def __init__(self, cache_dir: Path = CACHE_DIR, timeout: float = 60.0):
        self.cache_dir = cache_dir
        self.timeout = timeout

    def _guard(self) -> None:
        if os.getenv("APP_ENV", "").lower() == "test":
            raise FetchError("network access is disabled in tests (use a FixtureFetcher)")

    def _fresh(self, p: Path, ttl_h: Optional[float]) -> bool:
        try:
            return ttl_h is None or (time.time() - p.stat().st_mtime) <= ttl_h * 3600
        except OSError:
            return False

    def _request(self, url: str, method: str, json_body: Optional[dict], accept: str, stream: bool,
                 secrets: Optional[dict] = None):
        import requests
        host = urlsplit(url).hostname or ""
        headers = {"User-Agent": user_agent(), "Accept": accept, "Accept-Encoding": "gzip, deflate"}
        last = None
        for attempt in range(3):
            _THROTTLE.wait(host)
            try:
                r = requests.request(method, url, headers=headers,
                                     params=(secrets if secrets and method == "GET" else None),
                                     json=({**(json_body or {}), **secrets} if secrets and method != "GET" else json_body),
                                     timeout=self.timeout, stream=stream)
            except Exception as e:                       # network error
                last = type(e).__name__
                time.sleep(0.5 * (attempt + 1))
                continue
            if r.status_code in (403, 429, 503):
                last = f"HTTP {r.status_code}"
                time.sleep(1.5 * (attempt + 1))
                continue
            if r.status_code >= 400:
                raise FetchError(f"HTTP {r.status_code} for {url}")
            return r
        raise FetchError(f"{url} unavailable ({last})")

    def get(self, url: str, *, ttl_h: Optional[float] = 24, method: str = "GET",
            json_body: Optional[dict] = None, accept: str = "*/*",
            secrets: Optional[dict] = None) -> bytes:
        """``secrets`` (API keys) are attached only when the request is sent: they never
        appear in ``url``, cache names, errors or logs."""
        p = self.cache_dir / (_cache_name(url, json_body) + ".gz")
        if self._fresh(p, ttl_h):
            try:
                return gzip.decompress(p.read_bytes())
            except (OSError, EOFError, gzip.BadGzipFile):
                pass
        self._guard()
        r = self._request(url, method, json_body, accept, stream=False, secrets=secrets)
        data = r.content
        if len(data) > MAX_BYTES:
            raise FetchError(f"response larger than {MAX_BYTES} bytes: {url}")
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(f".tmp{os.getpid()}{threading.get_ident()}")
            tmp.write_bytes(gzip.compress(data, compresslevel=5))
            os.replace(tmp, p)
        except OSError as e:
            logger.warning("public-data cache write failed for %s: %s", url, e)
        return data

    def download(self, url: str, *, ttl_h: Optional[float] = None) -> Path:
        p = self.cache_dir / "files" / (_cache_name(url, None) + Path(urlsplit(url).path).suffix)
        if p.exists() and self._fresh(p, ttl_h):
            return p
        self._guard()
        r = self._request(url, "GET", None, "*/*", stream=True)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(f".part{os.getpid()}{threading.get_ident()}")
        n = 0
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                n += len(chunk)
                if n > MAX_BYTES:
                    fh.close()
                    tmp.unlink(missing_ok=True)
                    raise FetchError(f"download larger than {MAX_BYTES} bytes: {url}")
                fh.write(chunk)
        os.replace(tmp, p)
        return p

    def release(self, path: Path) -> None:
        """Delete a downloaded bulk file once it is loaded (the load log, not the
        file, prevents re-downloads; keeps /tmp small in the API container)."""
        try:
            if self.cache_dir in Path(path).parents:
                Path(path).unlink(missing_ok=True)
        except OSError:
            pass


class FixtureFetcher:
    """Recorded responses for tests: ``{url_substring: path_or_bytes_or_callable}``.
    The longest matching substring wins; an unmatched URL raises FetchError."""

    def __init__(self, routes: Dict[str, Union[str, Path, bytes, Callable[[str], bytes]]]):
        self.routes = routes
        self.calls: list = []

    def _match(self, url: str):
        hits = [k for k in self.routes if k in url]
        if not hits:
            raise FetchError(f"no fixture for {url}")
        return self.routes[max(hits, key=len)]

    def get(self, url: str, *, ttl_h: Optional[float] = 24, method: str = "GET",
            json_body: Optional[dict] = None, accept: str = "*/*",
            secrets: Optional[dict] = None) -> bytes:
        self.calls.append((method, url, json_body))
        v = self._match(url)
        if callable(v):
            return v(url) if json_body is None else v(url + "|" + repr(json_body))
        if isinstance(v, bytes):
            return v
        return Path(v).read_bytes()

    def download(self, url: str, *, ttl_h: Optional[float] = None) -> Path:
        self.calls.append(("DOWNLOAD", url, None))
        v = self._match(url)
        if isinstance(v, (str, Path)):
            return Path(v)
        raise FetchError("download fixtures must be file paths")

    def release(self, path: Path) -> None:      # recorded fixtures are never deleted
        self.calls.append(("RELEASE", str(path), None))


_FETCHER: Optional[Fetcher] = None
_LOCK = threading.Lock()


def get_fetcher() -> Fetcher:
    global _FETCHER
    with _LOCK:
        if _FETCHER is None:
            _FETCHER = LiveFetcher()
        return _FETCHER


def set_fetcher(f: Optional[Fetcher]) -> None:
    global _FETCHER
    with _LOCK:
        _FETCHER = f
