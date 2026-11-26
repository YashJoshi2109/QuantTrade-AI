"""Google News polls slower than the wires to avoid 429s."""
from app.services.news_intel.sources import default_pollers


def _intervals():
    return {p.key: p.interval for p in default_pollers()}


def test_google_feeds_poll_slower_than_wires(monkeypatch):
    monkeypatch.delenv("NEWS_INTEL_POLL_SECONDS", raising=False)
    monkeypatch.delenv("NEWS_GOOGLE_POLL_SECONDS", raising=False)
    iv = _intervals()
    assert iv["google_business"] == iv["google_markets"] == 180.0
    assert iv["prnewswire"] == iv["sec_8k"] == 60.0


def test_google_interval_never_faster_than_base(monkeypatch):
    monkeypatch.setenv("NEWS_INTEL_POLL_SECONDS", "300")
    monkeypatch.setenv("NEWS_GOOGLE_POLL_SECONDS", "120")
    assert _intervals()["google_business"] == 300.0
