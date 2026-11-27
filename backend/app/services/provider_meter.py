"""Passive usage meter for outbound calls to third-party providers.

Every outbound HTTP request made through httpx, requests or curl_cffi (yfinance)
is attributed to a provider by host and recorded here: success/failure, latency,
HTTP status, calls in the last 60 s and calls per UTC day.  The system-status
collector reads these counters instead of spending quota on health checks, so
"Finnhub 23/60 this minute" or "FMP 41/250 today" are real usage, not guesses.

Design rules:
  * Recording is O(1), in-process, never raises and never blocks on I/O.
  * Nothing about the request (URL query, headers, body) is stored except the
    provider id, the HTTP status and a short error class/message.  API keys in
    query strings are never kept.
  * ``install()`` patches the client ``send`` methods once (idempotent);
    ``uninstall()`` restores them (tests).
  * Other processes (the news worker) publish their counters to Redis with
    ``publish()``; ``merge()`` combines snapshots so the status page shows the
    real per-key usage across processes.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

# host suffix -> provider id.  Longest suffix wins (checked in order).
HOST_PROVIDERS: Tuple[Tuple[str, str], ...] = (
    ("finnhub.io", "finnhub"),
    ("financialmodelingprep.com", "fmp"),
    ("api.twelvedata.com", "twelve_data"),
    ("alphavantage.co", "alpha_vantage"),
    ("query1.finance.yahoo.com", "yahoo"),
    ("query2.finance.yahoo.com", "yahoo"),
    ("fc.yahoo.com", "yahoo"),
    ("guce.yahoo.com", "yahoo"),
    ("finance.yahoo.com", "yahoo"),
    ("data.alpaca.markets", "alpaca"),
    ("paper-api.alpaca.markets", "alpaca"),
    ("api.alpaca.markets", "alpaca"),
    ("api.public.com", "public"),
    ("sec.gov", "sec_edgar"),
    ("api.brevo.com", "brevo"),
    ("api.resend.com", "resend"),
    ("anthropic.com", "anthropic"),
    ("openrouter.ai", "openrouter"),
    ("openai.com", "openai"),
    ("groq.com", "groq"),
    ("scanner.tradingview.com", "tradingview"),
)

RECENT_N = 50          # ring buffer of the last N calls per provider
WINDOW_S = 60.0        # rolling per-minute window

REDIS_PREFIX = "qt:system:meter:"   # + "<role>:<pid>"  (per-process snapshot)
REDIS_DAILY = "qt:system:meter_daily:"  # + "YYYY-MM-DD" hash provider -> count
PUBLISH_TTL_S = 30


def provider_for_host(host: Optional[str]) -> Optional[str]:
    if not host:
        return None
    h = host.lower().rstrip(".")
    if ":" in h:
        h = h.split(":", 1)[0]
    for suffix, pid in HOST_PROVIDERS:
        if h == suffix or h.endswith("." + suffix):
            return pid
    return None


def _utc_day(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


@dataclass
class _Stats:
    recent: Deque[Tuple[float, bool, int, Optional[int]]] = field(default_factory=lambda: deque(maxlen=RECENT_N))
    window: Deque[float] = field(default_factory=deque)
    day: str = ""
    day_count: int = 0
    unpublished: int = 0          # calls not yet added to the Redis daily counter
    total: int = 0
    errors: int = 0
    last_call_at: Optional[float] = None
    last_ok_at: Optional[float] = None
    last_error_at: Optional[float] = None
    last_error: Optional[str] = None
    last_status: Optional[int] = None
    rate_limited_at: Optional[float] = None


class ProviderMeter:
    def __init__(self, clock=time.time) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._stats: Dict[str, _Stats] = {}
        self.started_at = clock()

    # ── recording ────────────────────────────────────────────────────────
    def record(self, provider: str, ok: bool, latency_ms: float, status: Optional[int] = None,
               error: Optional[str] = None, rate_limited: bool = False) -> None:
        try:
            now = self._clock()
            with self._lock:
                st = self._stats.setdefault(provider, _Stats())
                st.recent.append((now, bool(ok), int(latency_ms), status))
                st.window.append(now)
                self._trim(st, now)
                day = _utc_day(now)
                if st.day != day:
                    st.day, st.day_count = day, 0
                st.day_count += 1
                st.unpublished += 1
                st.total += 1
                st.last_call_at = now
                st.last_status = status
                if ok:
                    st.last_ok_at = now
                else:
                    st.errors += 1
                    st.last_error_at = now
                    st.last_error = (error or (f"HTTP {status}" if status else "error"))[:160]
                if rate_limited:
                    st.rate_limited_at = now
        except Exception:  # pragma: no cover - a meter must never break a request
            pass

    def _trim(self, st: _Stats, now: float) -> None:
        cutoff = now - WINDOW_S
        while st.window and st.window[0] < cutoff:
            st.window.popleft()

    def reset(self) -> None:
        with self._lock:
            self._stats.clear()

    # ── reading ──────────────────────────────────────────────────────────
    def snapshot(self) -> Dict[str, Dict[str, Any]]:
        """Plain-JSON view of every provider seen by this process."""
        now = self._clock()
        out: Dict[str, Dict[str, Any]] = {}
        with self._lock:
            for pid, st in self._stats.items():
                self._trim(st, now)
                recent = list(st.recent)
                lat = sorted(r[2] for r in recent)
                out[pid] = {
                    "total": st.total,
                    "errors": st.errors,
                    "minute_calls": [round(t, 3) for t in st.window],
                    "day": st.day,
                    "day_count": st.day_count if st.day == _utc_day(now) else 0,
                    "recent_ok": sum(1 for r in recent if r[1]),
                    "recent_n": len(recent),
                    "recent_latency_ms": lat,
                    "last_latency_ms": recent[-1][2] if recent else None,
                    "last_call_at": st.last_call_at,
                    "last_ok_at": st.last_ok_at,
                    "last_error_at": st.last_error_at,
                    "last_error": st.last_error,
                    "last_status": st.last_status,
                    "rate_limited_at": st.rate_limited_at,
                }
        return out

    def take_unpublished(self) -> Dict[str, int]:
        """Calls recorded since the last call (for the shared daily counter)."""
        with self._lock:
            out = {pid: st.unpublished for pid, st in self._stats.items() if st.unpublished}
            for pid in out:
                self._stats[pid].unpublished = 0
        return out

    def restore_unpublished(self, deltas: Dict[str, int]) -> None:
        with self._lock:
            for pid, n in deltas.items():
                if pid in self._stats:
                    self._stats[pid].unpublished += n


meter = ProviderMeter()


# ── merging snapshots from several processes ─────────────────────────────

def _max_opt(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b)


def merge(snapshots: Iterable[Dict[str, Dict[str, Any]]], now: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
    """Combine per-process snapshots: counts add up, timestamps take the latest."""
    now = now if now is not None else time.time()
    out: Dict[str, Dict[str, Any]] = {}
    for snap in snapshots:
        for pid, s in (snap or {}).items():
            cur = out.get(pid)
            minute = [t for t in s.get("minute_calls") or [] if t >= now - WINDOW_S]
            if cur is None:
                cur = out[pid] = {**s, "minute_calls": minute,
                                  "recent_latency_ms": list(s.get("recent_latency_ms") or [])}
                if s.get("day") != _utc_day(now):
                    cur["day_count"] = 0
                continue
            for k in ("total", "errors", "recent_ok", "recent_n"):
                cur[k] = (cur.get(k) or 0) + (s.get(k) or 0)
            if s.get("day") == _utc_day(now):
                cur["day_count"] = (cur.get("day_count") or 0) + (s.get("day_count") or 0)
            cur["minute_calls"] = sorted(cur["minute_calls"] + minute)
            cur["recent_latency_ms"] = sorted(cur["recent_latency_ms"] + list(s.get("recent_latency_ms") or []))
            for k in ("last_call_at", "last_ok_at", "rate_limited_at"):
                cur[k] = _max_opt(cur.get(k), s.get(k))
            if (s.get("last_error_at") or 0) > (cur.get("last_error_at") or 0):
                cur["last_error_at"], cur["last_error"] = s.get("last_error_at"), s.get("last_error")
            if (s.get("last_call_at") or 0) >= (cur.get("last_call_at") or 0):
                cur["last_latency_ms"], cur["last_status"] = s.get("last_latency_ms"), s.get("last_status")
    return out


def percentile(sorted_vals: List[float], q: float) -> Optional[float]:
    if not sorted_vals:
        return None
    k = max(0, min(len(sorted_vals) - 1, int(round(q * (len(sorted_vals) - 1)))))
    return float(sorted_vals[k])


async def publish(redis, role: str, pid: int) -> None:
    """Write this process's snapshot (TTL 30 s) and add new calls to the shared
    daily counter, so counts survive restarts and add up across processes."""
    if redis is None:
        return
    snap = meter.snapshot()
    deltas = meter.take_unpublished()
    try:
        await redis.set(f"{REDIS_PREFIX}{role}:{pid}", json.dumps(snap), ex=PUBLISH_TTL_S)
        if deltas:
            key = REDIS_DAILY + _utc_day(time.time())
            pipe = redis.pipeline()
            for p, n in deltas.items():
                pipe.hincrby(key, p, n)
            pipe.expire(key, 3 * 86400)
            await pipe.execute()
    except Exception as e:
        meter.restore_unpublished(deltas)
        logger.debug("provider meter publish failed: %s", e)


async def read_shared(redis, exclude_key: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Other processes' snapshots + today's shared daily counts."""
    if redis is None:
        return [], {}
    snaps: List[Dict[str, Any]] = []
    daily: Dict[str, int] = {}
    try:
        keys = [k async for k in redis.scan_iter(match=REDIS_PREFIX + "*", count=50)]
        keys = [k for k in keys if k != exclude_key]
        if keys:
            for raw in await redis.mget(keys):
                if raw:
                    try:
                        snaps.append(json.loads(raw))
                    except ValueError:
                        pass
        raw_daily = await redis.hgetall(REDIS_DAILY + _utc_day(time.time()))
        daily = {k: int(v) for k, v in (raw_daily or {}).items()}
    except Exception as e:
        logger.debug("provider meter read failed: %s", e)
    return snaps, daily


# ── body sniffing for providers that report rate limits with HTTP 200 ────

_SOFT_LIMIT_MARKERS = {
    "alpha_vantage": (b'"Note"', b'"Information"', b"API call frequency", b"rate limit"),
    "twelve_data": (b'"code":429', b'"code": 429', b"API credits"),
    "fmp": (b"Limit Reach", b'"Error Message"'),
}


def _soft_error(provider: str, body: Optional[bytes]) -> Optional[str]:
    markers = _SOFT_LIMIT_MARKERS.get(provider)
    if not markers or not body or len(body) > 4096:
        return None
    for m in markers:
        if m in body:
            return "rate limit / quota message in response body"
    return None


def classify(provider: str, status: Optional[int], body: Optional[bytes] = None) -> Tuple[bool, Optional[str], bool]:
    """(ok, error, rate_limited) for a completed HTTP response.

    404/400-class answers mean the provider is reachable (an unknown symbol is
    not an outage); 401/403 are key problems; 429 is a rate limit."""
    if status is None:
        return False, "no response", False
    if status == 429:
        return False, "rate limited (HTTP 429)", True
    if status in (401, 403):
        return False, f"key rejected (HTTP {status})", False
    if status >= 500:
        return False, f"server error (HTTP {status})", False
    soft = _soft_error(provider, body)
    if soft:
        return False, soft, True
    return True, None, False


# ── client patches ───────────────────────────────────────────────────────

_installed: Dict[str, Any] = {}
_install_lock = threading.Lock()


def _body_if_small(resp) -> Optional[bytes]:
    try:
        content = getattr(resp, "_content", None)
        if isinstance(content, (bytes, bytearray)) and len(content) <= 4096:
            return bytes(content)
    except Exception:
        pass
    return None


def _record_response(provider: str, t0: float, resp) -> None:
    status = getattr(resp, "status_code", None)
    ok, err, rl = classify(provider, status, _body_if_small(resp))
    meter.record(provider, ok, (time.perf_counter() - t0) * 1000, status=status, error=err, rate_limited=rl)


def _record_exception(provider: str, t0: float, exc: BaseException) -> None:
    meter.record(provider, False, (time.perf_counter() - t0) * 1000,
                 error=f"{type(exc).__name__}: {str(exc)[:100]}")


def install() -> bool:
    """Patch httpx / requests / curl_cffi so outbound calls are metered. Idempotent."""
    with _install_lock:
        if _installed:
            return True
        try:
            import httpx

            orig_sync, orig_async = httpx.Client.send, httpx.AsyncClient.send

            def send(self, request, *args, **kwargs):
                provider = provider_for_host(request.url.host)
                if provider is None:
                    return orig_sync(self, request, *args, **kwargs)
                t0 = time.perf_counter()
                try:
                    resp = orig_sync(self, request, *args, **kwargs)
                except BaseException as e:
                    _record_exception(provider, t0, e)
                    raise
                _record_response(provider, t0, resp)
                return resp

            async def asend(self, request, *args, **kwargs):
                provider = provider_for_host(request.url.host)
                if provider is None:
                    return await orig_async(self, request, *args, **kwargs)
                t0 = time.perf_counter()
                try:
                    resp = await orig_async(self, request, *args, **kwargs)
                except BaseException as e:
                    if not isinstance(e, (KeyboardInterrupt, SystemExit)):
                        import asyncio
                        if not isinstance(e, asyncio.CancelledError):
                            _record_exception(provider, t0, e)
                    raise
                _record_response(provider, t0, resp)
                return resp

            httpx.Client.send, httpx.AsyncClient.send = send, asend
            _installed["httpx"] = (orig_sync, orig_async)
        except Exception as e:  # pragma: no cover
            logger.debug("httpx meter not installed: %s", e)

        try:
            import requests
            from urllib.parse import urlsplit

            orig_req = requests.Session.send

            def rsend(self, request, **kwargs):
                provider = provider_for_host(urlsplit(request.url).hostname)
                if provider is None:
                    return orig_req(self, request, **kwargs)
                t0 = time.perf_counter()
                try:
                    resp = orig_req(self, request, **kwargs)
                except BaseException as e:
                    _record_exception(provider, t0, e)
                    raise
                _record_response(provider, t0, resp)
                return resp

            requests.Session.send = rsend
            _installed["requests"] = orig_req
        except Exception as e:  # pragma: no cover
            logger.debug("requests meter not installed: %s", e)

        try:  # yfinance >= 0.2.5x talks to Yahoo through curl_cffi
            from curl_cffi import requests as cffi_requests
            from urllib.parse import urlsplit as _split

            orig_cffi = cffi_requests.Session.request

            def crequest(self, method, url, *args, **kwargs):
                provider = provider_for_host(_split(str(url)).hostname)
                if provider is None:
                    return orig_cffi(self, method, url, *args, **kwargs)
                t0 = time.perf_counter()
                try:
                    resp = orig_cffi(self, method, url, *args, **kwargs)
                except BaseException as e:
                    _record_exception(provider, t0, e)
                    raise
                status = getattr(resp, "status_code", None)
                ok, err, rl = classify(provider, status)
                meter.record(provider, ok, (time.perf_counter() - t0) * 1000, status=status, error=err,
                             rate_limited=rl)
                return resp

            cffi_requests.Session.request = crequest
            _installed["curl_cffi"] = orig_cffi
        except Exception:
            pass
        return bool(_installed)


def uninstall() -> None:
    with _install_lock:
        if "httpx" in _installed:
            import httpx
            httpx.Client.send, httpx.AsyncClient.send = _installed.pop("httpx")
        if "requests" in _installed:
            import requests
            requests.Session.send = _installed.pop("requests")
        if "curl_cffi" in _installed:
            from curl_cffi import requests as cffi_requests
            cffi_requests.Session.request = _installed.pop("curl_cffi")


def installed() -> bool:
    return bool(_installed)
