"""
Per-client HTTP rate limiting.

Why this exists in this shape (the /research 429 storm):

* The old limiter keyed on ``request.client.host``. In production the backend
  sits behind Cloudflare -> nginx, so ``client.host`` is the nginx container's
  IP and every visitor on the internet shared ONE 300/min bucket. A handful of
  open Research tabs was enough to 429 everyone.
* The real client IP is recovered from ``X-Forwarded-For`` only when the TCP
  peer is a trusted proxy (private/loopback by default, plus
  ``RATE_LIMIT_TRUSTED_PROXIES``). The chain is walked right-to-left, skipping
  trusted hops; when the first untrusted hop is a Cloudflare edge,
  ``CF-Connecting-IP`` names the client. A client that reaches the origin
  directly cannot spoof its key: its own IP is the right-most untrusted hop.
* Signed-in users are keyed by user id (verified JWT), so a shared office/NAT
  IP does not throttle everyone behind it.
* Public, read-only, server-cached market GETs (quotes, indices, movers,
  sectors, status...) get a generous bucket separate from the default one; a
  page polling them cannot starve auth, writes or AI calls, and vice versa.
* Internal callers (trusted peer, no forwarding headers: Next.js SSR, health
  probes, sidecars) get their own large bucket instead of the public one.
"""
from __future__ import annotations

import ipaddress
import math
import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Iterable, List, Optional, Tuple, Union

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

IPNetwork = Union[ipaddress.IPv4Network, ipaddress.IPv6Network]
IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]

# https://www.cloudflare.com/ips/ (stable for years; refresh if Cloudflare adds ranges)
CLOUDFLARE_CIDRS: Tuple[str, ...] = (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
)

# Docker bridge, VPC and loopback ranges: where nginx / the Next.js server live.
DEFAULT_TRUSTED_PROXY_CIDRS: Tuple[str, ...] = (
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10",
)

DEFAULT_RPM = 300
PUBLIC_MARKET_RPM = 1200
INTERNAL_RPM = 3000
WINDOW_SECONDS = 60.0

# Read-only, unauthenticated endpoints that the API serves from Redis/nginx
# caches (see CacheControlMiddleware / RedisCacheMiddleware). GET/HEAD only.
PUBLIC_MARKET_PREFIXES: Tuple[str, ...] = (
    "/api/v1/market/",
    "/api/v1/enhanced/quote/",
    "/api/v1/enhanced/market-indices",
    "/api/v1/enhanced/api-stats",
    "/api/v1/enhanced/prediction-alerts",
    "/api/v1/enhanced/alerts/predictions",
    "/api/v1/enhanced/news/",
    "/api/v1/enhanced/fundamentals/",
    "/api/v1/quotes",
    "/api/v1/symbols",
    "/api/v1/monitor/",
    "/api/v1/model-index/",
    "/api/v1/ideas/trending",
    "/api/v1/news/feed",
)

# /api/v1/system/status is polled every second by every open tab; it is served
# from an in-memory snapshot and micro-cached by nginx, so it is exempt.
EXEMPT_PATHS = frozenset({"/health", "/health/ready", "/", "/docs", "/openapi.json", "/api/v1/system/status"})


def _parse_networks(cidrs: Iterable[str]) -> List[IPNetwork]:
    nets: List[IPNetwork] = []
    for c in cidrs:
        c = c.strip()
        if not c:
            continue
        try:
            nets.append(ipaddress.ip_network(c, strict=False))
        except ValueError:
            continue
    return nets


_CLOUDFLARE_NETS = _parse_networks(CLOUDFLARE_CIDRS)


def _trusted_proxy_nets() -> List[IPNetwork]:
    extra = os.getenv("RATE_LIMIT_TRUSTED_PROXIES", "")
    return _parse_networks(DEFAULT_TRUSTED_PROXY_CIDRS) + _parse_networks(extra.split(","))


_TRUSTED_NETS = _trusted_proxy_nets()


def _ip(value: Optional[str]) -> Optional[IPAddress]:
    if not value:
        return None
    v = value.strip()
    # "[2001:db8::1]:443" / "1.2.3.4:5678" forms some proxies emit
    if v.startswith("[") and "]" in v:
        v = v[1:v.index("]")]
    elif v.count(":") == 1 and "." in v:
        v = v.split(":", 1)[0]
    try:
        return ipaddress.ip_address(v)
    except ValueError:
        return None


def _in(ip: IPAddress, nets: List[IPNetwork]) -> bool:
    return any(ip.version == n.version and ip in n for n in nets)


def is_trusted_proxy(ip: IPAddress, trusted: Optional[List[IPNetwork]] = None) -> bool:
    return _in(ip, _TRUSTED_NETS if trusted is None else trusted)


def is_cloudflare(ip: IPAddress) -> bool:
    return _in(ip, _CLOUDFLARE_NETS)


def client_ip(request: Request, trusted: Optional[List[IPNetwork]] = None) -> Tuple[str, bool]:
    """
    Best-effort real client IP and whether the request is internal.

    Returns ``(ip, internal)``; ``internal`` is True when the peer is a trusted
    proxy and no forwarding header names anyone else (SSR / probes).
    """
    peer = request.client.host if request.client else None
    peer_ip = _ip(peer)
    if peer_ip is None or not is_trusted_proxy(peer_ip, trusted):
        return (str(peer_ip) if peer_ip else (peer or "unknown")), False

    xff = request.headers.get("x-forwarded-for", "")
    hops = [h.strip() for h in xff.split(",") if h.strip()]
    if not hops:
        real = _ip(request.headers.get("x-real-ip"))
        if real is not None and not is_trusted_proxy(real, trusted):
            return str(real), False
        return str(peer_ip), True

    for hop in reversed(hops):
        ip = _ip(hop)
        if ip is None:
            break  # garbage in the chain: stop at the last proxy we trust
        if is_trusted_proxy(ip, trusted):
            continue
        if is_cloudflare(ip):
            cf = _ip(request.headers.get("cf-connecting-ip"))
            if cf is not None:
                return str(cf), False
            continue  # Cloudflare already appended the client to XFF on its left
        return str(ip), False
    return str(peer_ip), True


def _bearer_or_cookie(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get("qt_access_token") or None


def user_id_from_request(request: Request) -> Optional[str]:
    token = _bearer_or_cookie(request)
    if not token:
        return None
    try:
        from app.auth.jwt import decode_access_token
    except Exception:  # pragma: no cover - auth module import failure
        return None
    payload = decode_access_token(token)
    sub = payload.get("sub") if isinstance(payload, dict) else None
    return str(sub) if sub else None


def is_public_market_request(method: str, path: str) -> bool:
    return method in ("GET", "HEAD") and path.startswith(PUBLIC_MARKET_PREFIXES)


def rate_limit_key(request: Request) -> Tuple[str, str]:
    """
    ``(bucket_key, tier)`` for a request. tier is one of
    ``public_market`` | ``default`` | ``internal``.
    """
    ip, internal = client_ip(request)
    uid = user_id_from_request(request)
    who = f"user:{uid}" if uid else f"ip:{ip}"
    if internal and not uid:
        return f"internal:{ip}", "internal"
    tier = "public_market" if is_public_market_request(request.method, request.url.path) else "default"
    return f"{tier}:{who}", tier


class SlidingWindowLimiter:
    """In-memory sliding-window counter (per process)."""

    def __init__(self, window: float = WINDOW_SECONDS, max_keys: int = 50_000):
        self.window = window
        self.max_keys = max_keys
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, now: Optional[float] = None) -> Tuple[bool, int, int]:
        """Record a hit. Returns ``(allowed, remaining, retry_after_seconds)``."""
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._hits[key]
            cutoff = now - self.window
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, math.ceil(q[0] + self.window - now))
                return False, 0, retry
            q.append(now)
            if len(self._hits) > self.max_keys:
                for k in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
                    self._hits.pop(k, None)
            return True, limit - len(q), 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-client (user or real IP) rate limiter with a generous public-market tier."""

    def __init__(
        self,
        app,
        requests_per_minute: int = DEFAULT_RPM,
        public_market_rpm: int = PUBLIC_MARKET_RPM,
        internal_rpm: int = INTERNAL_RPM,
    ):
        super().__init__(app)
        self.limits = {
            "default": requests_per_minute,
            "public_market": public_market_rpm,
            "internal": internal_rpm,
        }
        self.limiter = SlidingWindowLimiter()

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in EXEMPT_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        key, tier = rate_limit_key(request)
        limit = self.limits[tier]
        allowed, remaining, retry_after = self.limiter.hit(key, limit)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Try again shortly."},
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
