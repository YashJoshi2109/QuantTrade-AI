"""Keyless fallbacks used by the Global Monitor and option chain."""
import math

from app.services.google_news_rss import parse_google_news_rss, time_ago

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
<item>
  <title>US raises tariffs on steel imports - Reuters</title>
  <link>https://news.google.com/articles/abc</link>
  <pubDate>Tue, 24 Nov 2026 18:00:00 GMT</pubDate>
  <source url="https://www.reuters.com">Reuters</source>
</item>
<item>
  <title>EU weighs export ban</title>
  <link>https://news.google.com/articles/def</link>
</item>
</channel></rss>"""


def test_parse_google_news_rss_splits_publisher():
    items = parse_google_news_rss(RSS)
    assert len(items) == 2
    assert items[0]["title"] == "US raises tariffs on steel imports"
    assert items[0]["source"] == "Reuters"
    assert items[0]["date"] == "2026-11-24"
    assert items[1]["source"] == "Google News"
    assert items[1]["published_ts"] is None


def test_parse_google_news_rss_handles_garbage():
    assert parse_google_news_rss("") == []
    assert parse_google_news_rss("not xml") == []


def test_time_ago():
    assert time_ago(None) == "recently"
    assert time_ago(1000.0, now_ts=1000.0 + 120) == "2m ago"
    assert time_ago(1000.0, now_ts=1000.0 + 7200) == "2h ago"
    assert time_ago(1000.0, now_ts=1000.0 + 3 * 86400) == "3d ago"


def test_yf_rows_to_contracts_maps_and_cleans():
    from app.api.options import yf_rows_to_contracts

    rows = [
        {"contractSymbol": "NVDA261127C00190000", "strike": 190.0, "bid": 2.0, "ask": 2.2,
         "lastPrice": 2.1, "volume": float("nan"), "openInterest": 120.0, "impliedVolatility": 0.45},
        {"contractSymbol": "NVDA261127C00100000", "strike": 100.0, "bid": 0.0, "ask": 0.0,
         "lastPrice": 53.2, "volume": 158, "openInterest": 0, "impliedVolatility": 1e-05},
    ]
    out = yf_rows_to_contracts(rows)
    assert [c["strike"] for c in out] == [100.0, 190.0]  # sorted by strike
    deep, near = out
    assert deep["implied_volatility"] is None  # yfinance 1e-5 placeholder
    assert deep["mid"] is None
    assert near["mid"] == 2.1
    assert near["volume"] is None  # NaN -> None, not a crash
    assert near["open_interest"] == 120
    assert near["implied_volatility"] == 0.45
    assert near["delta"] is None and not any(
        isinstance(v, float) and math.isnan(v) for v in near.values()
    )


def test_public_option_chain_response_is_flattened_for_the_api():
    from types import SimpleNamespace as NS

    from app.services.public_client import occ_strike, option_chain_response_to_dict

    assert occ_strike("NVDA261127C00190000") == 190.0
    assert occ_strike("SPY261127P00650500") == 650.5
    assert occ_strike("bad") is None

    resp = NS(
        calls=[NS(instrument=NS(symbol="NVDA261127C00190000"), bid=2, ask=2.2, last=2.1, volume=10, open_interest=5)],
        puts=[NS(instrument=NS(symbol="NVDA261127P00180000"), bid=1, ask=1.1, last=1.05, volume=3, open_interest=7)],
    )
    out = option_chain_response_to_dict(resp)["options"]
    assert [o["type"] for o in out] == ["CALL", "PUT"]
    assert out[0]["strike"] == 190.0 and out[1]["openInterest"] == 7
