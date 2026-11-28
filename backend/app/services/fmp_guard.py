"""One guarded path for every Financial Modeling Prep (FMP) call.

FMP's free key allows 250 calls per day. Before this module, five call sites
(two quote fallbacks, the exchange-universe screener, the backtest price
fallback and the chatbot fundamentals snapshot) each called FMP directly:
no cache, no shared budget, and nothing stopped them once FMP answered
"Limit Reach". They also used the legacy ``/api/v3`` endpoints, which FMP
answers with HTTP 403 for keys created after 2025-08-31.

Every call now goes through :func:`get_json`:

* **Cache first.** Each answer is cached (Redis when available, plus this
  process) with a TTL chosen by the caller: quotes 60 s, prices 6 h,
  screener 20 h, fundamentals 24 h. Empty answers and "not on your plan"
  answers are cached too (negative cache), so an unknown symbol or a premium
  endpoint costs one call, not one call per page view.
* **Single flight.** Concurrent misses for the same key share one request.
* **Quota breaker.** HTTP 429 or FMP's "Limit Reach" body (any status) opens
  the breaker until ``Retry-After`` or the next 00:00 UTC. While it is open no
  FMP call is made in any process (the state is shared in Redis), and
  callers fall through to their other providers.
* **Daily budget.** Live calls are counted per UTC day across processes. At
  ``FMP_DAILY_BUDGET`` (default 240) the breaker opens before FMP has to say
  no.
* **Outage breaker.** Three network errors / 5xx in a row open the breaker
  for 2 minutes (doubling up to 30 minutes). A rejected key (401) opens it for
  1 hour.

The system-status probe reads :func:`breaker_state` to report "degraded,
quota exhausted" instead of "down".
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

FMP_STABLE = "https://financialmodelingprep.com/stable"

# breaker reasons
QUOTA = "quota"      # daily quota exhausted (429 / "Limit Reach" / our own budget)
OUTAGE = "outage"    # network errors / 5xx
KEY = "key"          # key rejected (401 / "Invalid API KEY")

# response verdicts
OK, EMPTY, PLAN, CLIENT = "ok", "empty", "plan", "client"

# cache TTLs (seconds) used by the call sites
TTL_QUOTE = 60
TTL_PRICES = 6 * 3600
TTL_SCREENER = 20 * 3600
TTL_FUNDAMENTALS = 24 * 3600
NEGATIVE_TTL = 6 * 3600
PLAN_TTL = 7 * 86400   # an endpoint/symbol the plan does not cover will not start working tomorrow

OUTAGE_STREAK = 3
OUTAGE_BASE_S = 120.0
OUTAGE_MAX_S = 1800.0
KEY_COOLDOWN_S = 3600.0
SHARED_REFRESH_S = 15.0

CACHE_PREFIX = "qt:fmp:c:"
BREAKER_KEY = "qt:fmp:breaker"
CALLS_PREFIX = "qt:fmp:calls:"   # + YYYY-MM-DD

_EMPTY = {"__fmp_empty__": True}

_QUOTA_MARKERS = (b"limit reach",)
_KEY_MARKERS = (b"invalid api key",)
_PLAN_MARKERS = (b"legacy endpoint", b"exclusive endpoint", b"premium", b"special endpoint",
                 b"not available under your current subscription", b"restricted endpoint",
                 b"upgrade your plan")


def daily_budget() -> int:
    try:
        return max(1, int(os.environ.get("FMP_DAILY_BUDGET", "") or 240))
    except ValueError:
        return 240


def next_utc_midnight(now: float) -> float:
    d = datetime.fromtimestamp(now, tz=timezone.utc).date() + timedelta(days=1)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


def _utc_day(now: float) -> str:
    return datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y-%m-%d")


def parse_retry_after(value: Optional[str], now: float) -> Optional[float]:
    """Absolute reset time from a Retry-After header (seconds or HTTP date)."""
    if not value:
        return None
    value = str(value).strip()
    try:
        return now + max(0.0, float(value))
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (TypeError, ValueError, IndexError):
        return None


def quota_reset_at(retry_after: Optional[str], now: float) -> float:
    """Retry-After when FMP sends one (clamped to 1 min .. 36 h), else next 00:00 UTC."""
    at = parse_retry_after(retry_after, now)
    if at is None:
        return next_utc_midnight(now)
    return min(max(at, now + 60.0), now + 36 * 3600.0)


def classify(status: Optional[int], body: Optional[bytes]) -> str:
    """Verdict for one FMP HTTP answer: QUOTA | KEY | PLAN | OUTAGE | CLIENT | OK.

    ``OK`` still has to be checked for an empty payload by the caller."""
    low = (body or b"")[:4096].lower()
    # Body markers only count on an error answer: a 200 company profile may
    # well contain the word "premium".
    err = b'"error message"' in low or (status is not None and status >= 400)
    if status == 429 or (err and any(m in low for m in _QUOTA_MARKERS)):
        return QUOTA
    if status == 401 or (err and any(m in low for m in _KEY_MARKERS)):
        return KEY
    if status in (402, 403) or (err and any(m in low for m in _PLAN_MARKERS)):
        return PLAN
    if status is None or status >= 500:
        return OUTAGE
    if err:
        return CLIENT
    return OK


# ── shared state store ───────────────────────────────────────────────────

class MemoryStore:
    """Process-local store (tests, or no Redis)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._kv: Dict[str, Tuple[Any, float]] = {}
        self._counts: Dict[str, int] = {}

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            hit = self._kv.get(key)
            if hit is None:
                return None
            if time.time() > hit[1]:
                self._kv.pop(key, None)
                return None
            return hit[0]

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            self._kv[key] = (value, time.time() + max(1.0, ttl))

    def delete(self, key: str) -> None:
        with self._lock:
            self._kv.pop(key, None)

    def incr(self, key: str, ttl: float) -> int:
        with self._lock:
            self._counts[key] = self._counts.get(key, 0) + 1
            return self._counts[key]

    def count(self, key: str) -> int:
        with self._lock:
            return self._counts.get(key, 0)


class RedisStore:
    """Redis-backed store (sync client: FMP callers run in threads). On any
    Redis error it backs off for 30 s and the guard keeps working in memory."""

    def __init__(self, url: Optional[str] = None) -> None:
        self.url = url or os.getenv("REDIS_URL") or "redis://localhost:6379/0"
        self._client: Any = None
        self._down_until = 0.0
        self._lock = threading.Lock()

    def _r(self):
        if time.time() < self._down_until:
            return None
        if self._client is None:
            with self._lock:
                if self._client is None:
                    try:
                        import redis

                        c = redis.Redis.from_url(self.url, socket_timeout=1.0, socket_connect_timeout=0.5,
                                                 decode_responses=True)
                        c.ping()
                        self._client = c
                    except Exception as e:  # noqa: BLE001
                        self._down(e)
                        return None
        return self._client

    def _down(self, e: Exception) -> None:
        logger.debug("fmp guard: Redis unavailable (%s); memory only for 30 s", type(e).__name__)
        self._client = None
        self._down_until = time.time() + 30

    def get(self, key: str) -> Optional[Any]:
        r = self._r()
        if r is None:
            return None
        try:
            raw = r.get(key)
            return json.loads(raw) if raw else None
        except Exception as e:  # noqa: BLE001
            self._down(e)
            return None

    def set(self, key: str, value: Any, ttl: float) -> None:
        r = self._r()
        if r is None:
            return
        try:
            r.set(key, json.dumps(value, default=str), ex=max(1, int(ttl)))
        except Exception as e:  # noqa: BLE001
            self._down(e)

    def delete(self, key: str) -> None:
        r = self._r()
        if r is None:
            return
        try:
            r.delete(key)
        except Exception as e:  # noqa: BLE001
            self._down(e)

    def incr(self, key: str, ttl: float) -> Optional[int]:
        r = self._r()
        if r is None:
            return None
        try:
            p = r.pipeline()
            p.incr(key)
            p.expire(key, max(1, int(ttl)))
            return int(p.execute()[0])
        except Exception as e:  # noqa: BLE001
            self._down(e)
            return None

    def count(self, key: str) -> Optional[int]:
        r = self._r()
        if r is None:
            return None
        try:
            return int(r.get(key) or 0)
        except Exception as e:  # noqa: BLE001
            self._down(e)
            return None


# ── breaker ──────────────────────────────────────────────────────────────

class FMPGuard:
    def __init__(self, store=None, clock=time.time) -> None:
        self.clock = clock
        self._store = store
        self._mem = MemoryStore()           # this process's cache + fallback when Redis is down
        self._lock = threading.Lock()
        self._open_until = 0.0
        self._reason: Optional[str] = None
        self._opened_at: Optional[float] = None
        self._detail: Optional[str] = None
        self._streak = 0
        self._outage_s = OUTAGE_BASE_S
        self._shared_checked = 0.0
        self._flights: Dict[str, threading.Event] = {}
        self._local_calls: Dict[str, int] = {}
        self.stats = {"live": 0, "cache_hits": 0, "skipped": 0}

    # store
    @property
    def store(self):
        if self._store is None:
            self._store = MemoryStore() if os.getenv("APP_ENV", "").lower() == "test" else RedisStore()
        return self._store

    def set_store(self, store) -> None:
        self._store = store

    # breaker state
    def _open(self, reason: str, until: float, detail: str, share: bool = True) -> None:
        now = self.clock()
        with self._lock:
            if self._open_until > now and self._open_until >= until and self._reason == reason:
                return
            self._open_until, self._reason, self._opened_at, self._detail = until, reason, now, detail
        logger.warning("FMP breaker open (%s) until %s: %s", reason,
                       datetime.fromtimestamp(until, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), detail)
        if share:
            state = {"until": until, "reason": reason, "opened_at": now, "detail": detail}
            try:
                self.store.set(BREAKER_KEY, state, until - now)
            except Exception:  # noqa: BLE001
                pass

    def trip_quota(self, retry_after: Optional[str] = None, detail: str = "FMP daily quota exhausted") -> None:
        self._open(QUOTA, quota_reset_at(retry_after, self.clock()), detail)

    def _refresh_shared(self, now: float, force: bool = False) -> None:
        if not force and now - self._shared_checked < SHARED_REFRESH_S:
            return
        self._shared_checked = now
        try:
            st = self.store.get(BREAKER_KEY)
        except Exception:  # noqa: BLE001
            st = None
        if isinstance(st, dict) and float(st.get("until") or 0) > now:
            with self._lock:
                if float(st["until"]) > self._open_until:
                    self._open_until = float(st["until"])
                    self._reason = st.get("reason")
                    self._opened_at = st.get("opened_at")
                    self._detail = st.get("detail")

    def is_open(self, force_shared: bool = False) -> bool:
        now = self.clock()
        self._refresh_shared(now, force=force_shared)
        return self._open_until > now

    def state(self, force_shared: bool = True) -> Dict[str, Any]:
        now = self.clock()
        self._refresh_shared(now, force=force_shared)
        with self._lock:
            is_open = self._open_until > now
            return {
                "open": is_open,
                "reason": self._reason if is_open else None,
                "until": self._open_until if is_open else None,
                "opened_at": self._opened_at if is_open else None,
                "detail": self._detail if is_open else None,
                "calls_today": self.calls_today(),
                "budget": daily_budget(),
                **self.stats,
            }

    def reset(self) -> None:
        with self._lock:
            self._open_until, self._reason, self._opened_at, self._detail = 0.0, None, None, None
            self._streak, self._outage_s, self._shared_checked = 0, OUTAGE_BASE_S, 0.0
            self._flights.clear()
            self._local_calls.clear()
            self.stats = {"live": 0, "cache_hits": 0, "skipped": 0}
        self._mem = MemoryStore()
        try:
            self.store.delete(BREAKER_KEY)
        except Exception:  # noqa: BLE001
            pass

    # daily budget
    def calls_today(self) -> int:
        day = _utc_day(self.clock())
        shared = None
        try:
            shared = self.store.count(CALLS_PREFIX + day)
        except Exception:  # noqa: BLE001
            pass
        return max(int(shared or 0), self._local_calls.get(day, 0))

    def _count_call(self) -> int:
        now = self.clock()
        day = _utc_day(now)
        with self._lock:
            self._local_calls = {day: self._local_calls.get(day, 0) + 1}
            local = self._local_calls[day]
        shared = None
        try:
            shared = self.store.incr(CALLS_PREFIX + day, 2 * 86400)
        except Exception:  # noqa: BLE001
            pass
        return max(int(shared or 0), local)

    # cache
    def _cache_get(self, key: str) -> Optional[Any]:
        hit = self._mem.get(key)
        if hit is None:
            try:
                hit = self.store.get(key)
            except Exception:  # noqa: BLE001
                hit = None
        return hit

    def _cache_set(self, key: str, value: Any, ttl: float) -> None:
        self._mem.set(key, value, ttl)
        try:
            self.store.set(key, value, ttl)
        except Exception:  # noqa: BLE001
            pass

    # outcome bookkeeping
    def _success(self) -> None:
        with self._lock:
            self._streak, self._outage_s = 0, OUTAGE_BASE_S

    def _failure(self, detail: str) -> None:
        with self._lock:
            self._streak += 1
            trip = self._streak >= OUTAGE_STREAK
            seconds = self._outage_s
            if trip:
                self._streak = 0
                self._outage_s = min(OUTAGE_MAX_S, self._outage_s * 2)
        if trip:
            self._open(OUTAGE, self.clock() + seconds, detail)

    # the call
    def get_json(self, path: str, params: Optional[Dict[str, Any]] = None, *, ttl: float,
                 negative_ttl: float = NEGATIVE_TTL, timeout: float = 10.0) -> Optional[Any]:
        """Cached, budgeted, breaker-guarded GET of ``FMP_STABLE + path``.

        Returns the parsed JSON (non-empty list / dict) or None. Never raises."""
        from app.config import settings

        api_key = getattr(settings, "FMP_API_KEY", None)
        if not api_key:
            return None
        params = {k: v for k, v in (params or {}).items() if v is not None}
        key = CACHE_PREFIX + path.strip("/") + "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))

        hit = self._cache_get(key)
        if hit is not None:
            self.stats["cache_hits"] += 1
            return None if hit == _EMPTY else hit
        if self.is_open():
            self.stats["skipped"] += 1
            return None

        with self._lock:
            ev = self._flights.get(key)
            leader = ev is None
            if leader:
                ev = self._flights[key] = threading.Event()
        if not leader:
            ev.wait(timeout + 2.0)
            hit = self._cache_get(key)
            return None if hit is None or hit == _EMPTY else hit
        try:
            return self._fetch(path, params, api_key, key, ttl, negative_ttl, timeout)
        finally:
            with self._lock:
                self._flights.pop(key, None)
            ev.set()

    def _fetch(self, path, params, api_key, key, ttl, negative_ttl, timeout) -> Optional[Any]:
        if self.calls_today() >= daily_budget():
            self.trip_quota(detail=f"QuantTrade daily FMP budget reached ({daily_budget()} calls)")
            self.stats["skipped"] += 1
            return None
        self._count_call()
        self.stats["live"] += 1
        import requests

        try:
            resp = requests.get(FMP_STABLE + "/" + path.strip("/"), params={**params, "apikey": api_key},
                                timeout=timeout)
        except Exception as e:  # noqa: BLE001
            self._failure(f"{type(e).__name__}")
            return None
        status = getattr(resp, "status_code", 200)
        body = getattr(resp, "content", None)
        if not isinstance(body, (bytes, bytearray)):
            body = b""
        verdict = classify(status, bytes(body[:4096]))
        headers = getattr(resp, "headers", None) or {}
        if verdict == QUOTA:
            self.trip_quota(headers.get("Retry-After"), detail=f"FMP quota message (HTTP {status})")
            return None
        if verdict == KEY:
            self._open(KEY, self.clock() + KEY_COOLDOWN_S, f"FMP rejected the API key (HTTP {status})")
            return None
        if verdict == OUTAGE:
            self._failure(f"HTTP {status}")
            return None
        self._success()
        if verdict == PLAN:
            logger.info("FMP %s not available on this plan (HTTP %s); cached for 7 days", path, status)
            self._cache_set(key, _EMPTY, PLAN_TTL)
            return None
        if verdict == CLIENT:
            self._cache_set(key, _EMPTY, negative_ttl)
            return None
        try:
            data = resp.json()
        except Exception:  # noqa: BLE001
            self._cache_set(key, _EMPTY, negative_ttl)
            return None
        if not data or (isinstance(data, dict) and "Error Message" in data):
            self._cache_set(key, _EMPTY, negative_ttl)
            return None
        self._cache_set(key, data, ttl)
        return data


guard = FMPGuard()


def get_json(path: str, params: Optional[Dict[str, Any]] = None, *, ttl: float,
             negative_ttl: float = NEGATIVE_TTL, timeout: float = 10.0) -> Optional[Any]:
    return guard.get_json(path, params, ttl=ttl, negative_ttl=negative_ttl, timeout=timeout)


async def get_json_async(path: str, params: Optional[Dict[str, Any]] = None, *, ttl: float,
                         negative_ttl: float = NEGATIVE_TTL, timeout: float = 10.0) -> Optional[Any]:
    """Same as :func:`get_json` without blocking the event loop."""
    if not _configured():
        return None
    return await asyncio.to_thread(guard.get_json, path, params, ttl=ttl, negative_ttl=negative_ttl,
                                   timeout=timeout)


def _configured() -> bool:
    from app.config import settings
    return bool(getattr(settings, "FMP_API_KEY", None))


def breaker_state() -> Dict[str, Any]:
    return guard.state(force_shared=True)


def fmt_utc_hm(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%H:%M")
