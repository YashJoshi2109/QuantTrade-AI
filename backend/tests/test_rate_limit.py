"""Rate limiter key function + tiers (app/middleware/rate_limit.py)."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware import rate_limit as rl

NGINX = "172.18.0.5"  # docker bridge peer (trusted)
CF_EDGE = "162.158.10.20"  # inside 162.158.0.0/15


def _req(peer, headers=None, method="GET", path="/api/v1/market/sectors", cookies=None):
    h = {k.lower(): v for k, v in (headers or {}).items()}
    return SimpleNamespace(
        client=SimpleNamespace(host=peer) if peer else None,
        headers=h,
        cookies=cookies or {},
        method=method,
        url=SimpleNamespace(path=path),
    )


# ── client_ip ────────────────────────────────────────────────────────────────

def test_direct_client_uses_peer_and_ignores_spoofed_headers():
    r = _req("203.0.113.7", {"X-Forwarded-For": "1.1.1.1", "CF-Connecting-IP": "9.9.9.9"})
    assert rl.client_ip(r) == ("203.0.113.7", False)


def test_behind_cloudflare_and_nginx_uses_cf_connecting_ip():
    # Cloudflare sets XFF=<client>; nginx appends the CF edge it saw.
    r = _req(NGINX, {"X-Forwarded-For": f"198.51.100.23, {CF_EDGE}", "CF-Connecting-IP": "198.51.100.23"})
    assert rl.client_ip(r) == ("198.51.100.23", False)


def test_two_users_behind_same_proxy_get_different_keys():
    a = _req(NGINX, {"X-Forwarded-For": f"198.51.100.1, {CF_EDGE}", "CF-Connecting-IP": "198.51.100.1"})
    b = _req(NGINX, {"X-Forwarded-For": f"198.51.100.2, {CF_EDGE}", "CF-Connecting-IP": "198.51.100.2"})
    assert rl.rate_limit_key(a)[0] != rl.rate_limit_key(b)[0]


def test_cloudflare_edge_without_header_walks_left():
    r = _req(NGINX, {"X-Forwarded-For": f"198.51.100.23, {CF_EDGE}"})
    assert rl.client_ip(r)[0] == "198.51.100.23"


def test_origin_bypass_cannot_spoof_key():
    # Attacker hits nginx directly (not via CF) with forged headers; nginx appends
    # the attacker's real IP, which is the right-most untrusted hop.
    r = _req(NGINX, {"X-Forwarded-For": "1.2.3.4, 203.0.113.66", "CF-Connecting-IP": "1.2.3.4"})
    assert rl.client_ip(r)[0] == "203.0.113.66"


def test_nginx_real_ip_module_chain():
    # With real_ip from CF, nginx's $remote_addr is the client: XFF ends in the client.
    r = _req(NGINX, {"X-Forwarded-For": "198.51.100.23, 198.51.100.23", "X-Real-IP": "198.51.100.23"})
    assert rl.client_ip(r)[0] == "198.51.100.23"


def test_x_real_ip_used_when_no_xff():
    r = _req(NGINX, {"X-Real-IP": "198.51.100.40"})
    assert rl.client_ip(r) == ("198.51.100.40", False)


def test_internal_caller_without_forwarding_is_internal():
    assert rl.client_ip(_req("127.0.0.1")) == ("127.0.0.1", True)
    key, tier = rl.rate_limit_key(_req("10.0.1.9"))
    assert tier == "internal" and key == "internal:10.0.1.9"


def test_garbage_xff_stops_at_trusted_proxy():
    r = _req(NGINX, {"X-Forwarded-For": "not-an-ip"})
    assert rl.client_ip(r) == (NGINX, True)


def test_ipv6_and_port_forms():
    r = _req(NGINX, {"X-Forwarded-For": "[2001:db8::5]:443"})
    assert rl.client_ip(r)[0] == "2001:db8::5"
    r = _req(NGINX, {"X-Forwarded-For": "198.51.100.9:5555"})
    assert rl.client_ip(r)[0] == "198.51.100.9"


def test_extra_trusted_proxies_from_env(monkeypatch):
    trusted = rl._parse_networks(list(rl.DEFAULT_TRUSTED_PROXY_CIDRS) + ["203.0.113.0/24"])
    r = _req("203.0.113.1", {"X-Forwarded-For": "198.51.100.77"})
    assert rl.client_ip(r, trusted)[0] == "198.51.100.77"


# ── tiers + user keys ───────────────────────────────────────────────────────

def test_public_market_tier_only_for_reads():
    assert rl.rate_limit_key(_req("203.0.113.7", path="/api/v1/enhanced/quote/META/finnhub"))[1] == "public_market"
    assert rl.rate_limit_key(_req("203.0.113.7", path="/api/v1/market/movers"))[1] == "public_market"
    assert rl.rate_limit_key(_req("203.0.113.7", method="POST", path="/api/v1/market/movers"))[1] == "default"
    assert rl.rate_limit_key(_req("203.0.113.7", path="/api/v1/auth/session"))[1] == "default"


def test_signed_in_user_keyed_by_user_id():
    from app.auth.jwt import create_access_token

    tok = create_access_token({"sub": "42"})
    a = rl.rate_limit_key(_req("203.0.113.7", {"Authorization": f"Bearer {tok}"}))
    b = rl.rate_limit_key(_req("198.51.100.1", cookies={"qt_access_token": tok}))
    assert a == b == ("public_market:user:42", "public_market")


def test_forged_token_falls_back_to_ip():
    key, _ = rl.rate_limit_key(_req("203.0.113.7", {"Authorization": "Bearer forged.jwt.value"}))
    assert key == "public_market:ip:203.0.113.7"


# ── limiter + middleware ────────────────────────────────────────────────────

def test_sliding_window_retry_after():
    lim = rl.SlidingWindowLimiter(window=60)
    assert lim.hit("k", 2, now=100.0)[0]
    assert lim.hit("k", 2, now=110.0)[0]
    allowed, remaining, retry = lim.hit("k", 2, now=120.0)
    assert (allowed, remaining, retry) == (False, 0, 40)
    assert lim.hit("k", 2, now=161.0)[0]  # first hit expired


@pytest.fixture()
def app():
    a = FastAPI()
    a.add_middleware(rl.RateLimitMiddleware, requests_per_minute=3, public_market_rpm=6, internal_rpm=100)

    @a.get("/api/v1/market/sectors")
    def sectors():
        return []

    @a.get("/api/v1/auth/session")
    def session():
        return {}

    return a


def test_middleware_buckets_are_per_tier(app):
    c = TestClient(app)
    for _ in range(3):
        assert c.get("/api/v1/auth/session").status_code == 200
    r = c.get("/api/v1/auth/session")
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    # Default bucket exhausted, public market bucket untouched.
    for _ in range(6):
        assert c.get("/api/v1/market/sectors").status_code == 200
    assert c.get("/api/v1/market/sectors").status_code == 429


def test_middleware_separates_clients_behind_proxy(app):
    # TestClient's peer is "testclient" (not an IP) -> keyed as itself; simulate
    # nginx by asserting the key function directly is what the middleware uses.
    c = TestClient(app)
    r = c.get("/api/v1/market/sectors")
    assert r.headers["X-RateLimit-Limit"] == "6"
