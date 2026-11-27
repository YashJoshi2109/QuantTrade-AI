"""API keys travel only in ``secrets``: never in the URL, cache name or recorded call."""
from app.services.public_data import http as ph
from app.services.public_data.http import FixtureFetcher, _cache_name


def test_cache_name_has_no_credentials():
    assert _cache_name("https://x.gov/d?id=1", None) != _cache_name("https://x.gov/d?id=2", None)


def test_fred_key_not_in_url(monkeypatch):
    from app.config import settings
    from app.services.public_data import macro

    monkeypatch.setattr(settings, "FRED_API_KEY", "SECRET123", raising=False)
    fx = FixtureFetcher({"stlouisfed.org": b'{"observations": []}'})
    seen = []
    orig = fx.get

    def spy(url, **kw):
        seen.append((url, kw.get("secrets")))
        return orig(url, **kw)

    fx.get = spy
    monkeypatch.setattr(macro, "get_fetcher", lambda: fx)

    class DB:
        def __getattr__(self, n):
            raise AssertionError("no rows expected")

    monkeypatch.setattr(macro, "_save", lambda db, rows, *a: len(rows))
    macro.refresh_fred(DB(), series=["DGS10"])
    assert seen and all("SECRET123" not in u for u, _ in seen)
    assert seen[0][1] == {"api_key": "SECRET123"}


def test_live_request_attaches_secrets_at_send(monkeypatch):
    sent = {}

    class R:
        status_code = 200
        content = b"ok"

    def fake_request(method, url, **kw):
        sent.update(url=url, **kw)
        return R()

    import requests
    monkeypatch.setattr(requests, "request", fake_request)
    monkeypatch.setattr(ph._THROTTLE, "wait", lambda host: None)
    lf = ph.LiveFetcher()
    lf._request("https://api.stlouisfed.org/x?a=1", "GET", None, "*/*", False, secrets={"api_key": "K"})
    assert "K" not in sent["url"] and sent["params"] == {"api_key": "K"}
    lf._request("https://api.bls.gov/x", "POST", {"s": 1}, "*/*", False, secrets={"registrationkey": "K"})
    assert sent["json"] == {"s": 1, "registrationkey": "K"} and sent["params"] is None
