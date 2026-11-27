from app.services.public_data.http import _cache_name, redact_url


def test_redact_masks_credentials_only():
    u = "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=SECRET123&file_type=json"
    r = redact_url(u)
    assert "SECRET123" not in r
    assert "series_id=DGS10" in r and "file_type=json" in r and "api_key=***" in r


def test_cache_name_independent_of_credentials():
    a = _cache_name("https://x.gov/d?id=1&api_key=AAA", {"seriesid": ["CPI"], "registrationkey": "K1"})
    b = _cache_name("https://x.gov/d?id=1&api_key=BBB", {"seriesid": ["CPI"], "registrationkey": "K2"})
    assert a == b
    assert _cache_name("https://x.gov/d?id=2&api_key=AAA", None) != a
