"""
SSRF-safe outbound HTTP for URLs that come from third parties (feed items,
article pages, redirects).

Three layers, applied on every hop (redirects are followed manually):
  1. URL shape: allowed scheme, no userinfo, default ports only, no
     localhost / *.local / *.internal style hostnames.
  2. DNS: every address the host resolves to must be globally routable
     (blocks private, loopback, link-local incl. 169.254.169.254 metadata,
     CGNAT, multicast, reserved, IPv4-mapped/6to4 forms of those).
  3. Pinning: the request connects to the validated IP (Host header and TLS
     SNI/cert check keep the real hostname), so a DNS rebind between the
     check and the connect cannot redirect the request.

Responses are streamed and capped at `max_bytes`.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional, Sequence
from urllib.parse import SplitResult, urljoin, urlsplit, urlunsplit

import httpx

REDIRECT_CODES = {301, 302, 303, 307, 308}
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa", ".corp", ".intranet")
_BLOCKED_NAMES = {"localhost", "metadata", "metadata.google.internal"}


class UnsafeURLError(ValueError):
    """The URL (or a redirect hop) points somewhere we must not fetch."""


def is_public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return is_public_ip(str(addr.ipv4_mapped))
        if addr.sixtofour is not None:
            return is_public_ip(str(addr.sixtofour))
        if addr.teredo is not None:
            return False
    return bool(
        addr.is_global
        and not addr.is_private
        and not addr.is_loopback
        and not addr.is_link_local
        and not addr.is_multicast
        and not addr.is_reserved
        and not addr.is_unspecified
    )


def validate_url(url: str, schemes: Sequence[str] = ("https", "http")) -> SplitResult:
    try:
        parts = urlsplit((url or "").strip())
        port = parts.port
    except ValueError as e:
        raise UnsafeURLError(f"malformed url: {e}") from None
    if parts.scheme.lower() not in schemes:
        raise UnsafeURLError(f"scheme not allowed: {parts.scheme!r}")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeURLError("missing host")
    if parts.username is not None or parts.password is not None:
        raise UnsafeURLError("userinfo not allowed")
    if port not in (None, 80, 443):
        raise UnsafeURLError(f"port not allowed: {port}")
    if host in _BLOCKED_NAMES or host.endswith(_BLOCKED_SUFFIXES) or "." not in host and ":" not in host:
        raise UnsafeURLError(f"host not allowed: {host}")
    return parts


Resolver = Callable[[str, int], Awaitable[List[str]]]


async def system_resolver(host: str, port: int) -> List[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(i[4][0] for i in infos))


async def resolve_public(host: str, port: int, resolver: Optional[Resolver] = None) -> str:
    """Validated IP to connect to. Every resolved address must be public:
    a host with one private A record is rejected outright."""
    try:
        ipaddress.ip_address(host)
        ips = [host]
    except ValueError:
        try:
            ips = await (resolver or system_resolver)(host, port)
        except (OSError, socket.gaierror) as e:
            raise UnsafeURLError(f"dns failure for {host}: {e}") from None
    if not ips:
        raise UnsafeURLError(f"no addresses for {host}")
    bad = [ip for ip in ips if not is_public_ip(ip)]
    if bad:
        raise UnsafeURLError(f"{host} resolves to non-public address")
    v4 = [ip for ip in ips if ":" not in ip]
    return (v4 or ips)[0]


@dataclass
class FetchResult:
    url: str                      # final URL after redirects
    status: int
    headers: Dict[str, str] = field(default_factory=dict)
    body: bytes = b""
    truncated: bool = False

    @property
    def content_type(self) -> str:
        return (self.headers.get("content-type") or "").split(";", 1)[0].strip().lower()


async def safe_request(
    client: httpx.AsyncClient,
    url: str,
    *,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    max_bytes: int = 512 * 1024,
    timeout: float = 5.0,
    max_redirects: int = 3,
    schemes: Sequence[str] = ("https", "http"),
    stop: Optional[Callable[[bytes], bool]] = None,
    resolver: Optional[Resolver] = None,
) -> FetchResult:
    """Fetch `url` with every hop validated and pinned. `stop(body_so_far)`
    may end the read early (e.g. once </head> arrived)."""
    current = url
    for _ in range(max_redirects + 1):
        parts = validate_url(current, schemes)
        host = parts.hostname.rstrip(".").lower()
        scheme = parts.scheme.lower()
        port = parts.port or (443 if scheme == "https" else 80)
        ip = await resolve_public(host, port, resolver)
        netloc_ip = f"[{ip}]" if ":" in ip else ip
        if parts.port:
            netloc_ip += f":{parts.port}"
        target = urlunsplit((scheme, netloc_ip, parts.path or "/", parts.query, ""))
        host_header = host if not parts.port else f"{host}:{parts.port}"
        h = dict(headers or {})
        h["Host"] = host_header
        ext = {"sni_hostname": host} if scheme == "https" else {}
        req = client.build_request(method, target, headers=h, timeout=timeout, extensions=ext)
        resp = await client.send(req, stream=True, follow_redirects=False)
        try:
            if resp.status_code in REDIRECT_CODES and resp.headers.get("location"):
                current = urljoin(current, resp.headers["location"])
                if resp.status_code == 303:
                    method = "GET"
                continue
            body = bytearray()
            truncated = False
            if method != "HEAD":
                async for chunk in resp.aiter_bytes():
                    body.extend(chunk)
                    if len(body) >= max_bytes:
                        del body[max_bytes:]
                        truncated = True
                        break
                    if stop is not None and stop(bytes(body)):
                        break
            return FetchResult(
                url=current,
                status=resp.status_code,
                headers={k.lower(): v for k, v in resp.headers.items()},
                body=bytes(body),
                truncated=truncated,
            )
        finally:
            await resp.aclose()
    raise UnsafeURLError("too many redirects")
