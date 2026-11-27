"""Post generation from fixtures (deterministic) + quality gates + compliance."""
import asyncio
import json
import sys
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from fixtures import (  # noqa: E402
    ARTICLE_SUMMARY, EVENING_NOW, MIDDAY_NOW, MORNING_NOW, NOW, PRE_OPEN_NOW, FakeHub, breadth,
)
from app.services.community_bots import compliance, registry  # noqa: E402
from app.services.community_bots.base import (  # noqa: E402
    DISCLAIMER, MAX_HEADLINE_CHARS, BotPost, Skip, payload_of, render_body,
)

CASES = [
    ("market_weather", "close", NOW, {}),
    ("market_weather", "pre_open", PRE_OPEN_NOW, {"session": date(2026, 11, 23)}),
    ("sentiment_pulse", "evening", NOW, {}),
    ("sentiment_pulse", "midday", MIDDAY_NOW, {}),
    ("movers_breakouts", "close", NOW, {}),
    ("earnings_watch", "morning", MORNING_NOW, {}),
    ("earnings_watch", "evening", EVENING_NOW, {}),
    ("real_estate_rates", "close", NOW, {}),
    ("sector_rotation", "close", NOW, {}),
]


def build(slug, slot, now, session=None, **over):
    spec = registry.get(slug)
    hub = FakeHub(now=now, **({"session": session} if session else {}), **over)
    data = asyncio.run(spec.collect(hub, now, slot))
    return spec, spec.compose(data, now, slot)


@pytest.mark.parametrize("slug,slot,now,kw", CASES)
def test_post_is_deterministic_and_compliant(slug, slot, now, kw):
    spec, a = build(slug, slot, now, **kw)
    _, b = build(slug, slot, now, **kw)
    assert render_body(spec, a) == render_body(spec, b)
    assert a.content_fingerprint() == b.content_fingerprint()
    assert compliance.check(spec, a) == []
    body = render_body(spec, a)
    # labelled as automated, sources, as-of, disclaimer
    assert a.title.startswith("\U0001F916")
    assert f"Automated post by {spec.display_name}" in body
    assert "Sources: " in body and "As of: " in body and DISCLAIMER in body
    payload = payload_of(spec, a, slot)
    assert payload["automated_label"] == f"Automated post by {spec.display_name}"
    assert payload["sources"] and payload["as_of"] and payload["disclaimer"] == DISCLAIMER
    json.dumps(payload)  # serialisable for the JSON column / API


def test_market_weather_scoring():
    _, p = build("market_weather", "close", NOW)
    assert p.badge["value"] == "sunny" and p.badge["score"] == 5
    assert "192 up / 102 down" in p.title and "VIX 15.2" in p.title
    rows = {r[0]: r[2] for r in p.tables[0]["rows"]}
    assert rows["Breadth (share of advancers)"] == "+2"
    assert rows["VIX level / day change"] == "+1"
    assert rows["SPY trend vs 50/200-day SMA"] == "+2"


def test_market_weather_stormy_when_vix_spikes():
    hub_quotes = {"SPY": dict(_q("SPY", 590.0, -2.1)), "^VIX": dict(_q("^VIX", 31.0, 25.0))}
    spec, p = build("market_weather", "close", NOW, quotes=hub_quotes)
    assert p.badge["value"] == "stormy"
    assert p.sentiment == "bearish" or p.badge["score"] <= 1


def _q(sym, px, chg):
    from fixtures import quote
    return quote(sym, px, chg)


def test_market_weather_pre_open_uses_last_session_and_premarket():
    _, p = build("market_weather", "pre_open", PRE_OPEN_NOW, session=date(2026, 11, 23))
    assert "Pre-open, Mon Nov 23" in p.title
    assert any("pre-market" in h for h in p.highlights)


def test_sentiment_pulse_aggregates_without_copying_articles():
    spec, p = build("sentiment_pulse", "evening", NOW)
    body = render_body(spec, p)
    blob = body + json.dumps(payload_of(spec, p, "evening"))
    assert ARTICLE_SUMMARY not in blob and "EXCLUSIVE-BODY-TEXT" not in blob
    assert "$NVDA" in p.title and "$XOM" in p.title
    top = {r[0]: r for r in p.tables[0]["rows"]}
    assert top["$NVDA"][1:5] == [8, 6, 0, "+0.75"]
    assert top["$NVDA"][5] == "+1.00"  # prior window net -0.25 -> +0.75
    assert 1 <= len(p.links) <= 3
    for link in p.links:
        assert len(link["title"]) <= MAX_HEADLINE_CHARS
        assert link["url"].startswith("https://")


def test_movers_labels_rule_signals_not_advice():
    _, p = build("movers_breakouts", "close", NOW)
    sigs = {r[0]: r[3] for r in p.tables[0]["rows"]}
    assert "52w-high breakout" in sigs["$NVDA"] and "RSI overbought (74)" in sigs["$NVDA"]
    assert "52w-low breakdown" in sigs["$XOM"]
    assert "RSI oversold (27)" in sigs["$PFE"] and "Unusual volume (3.1× avg)" in sigs["$PFE"]
    assert all(h.startswith("Signal — ") for h in p.highlights)
    assert "4 rule signals" in p.title


def test_earnings_morning_and_evening_windows():
    _, m = build("earnings_watch", "morning", MORNING_NOW)
    reported = [r[0] for r in m.tables[0]["rows"]]
    assert reported == ["$DE", "$ZM"]               # yesterday AMC + today BMO, by market cap
    assert [r[0] for r in m.tables[1]["rows"]] == ["$HPQ"]
    _, e = build("earnings_watch", "evening", EVENING_NOW)
    assert [r[0] for r in e.tables[0]["rows"]] == ["$DE", "$DELL"]
    assert [r[0] for r in e.tables[1]["rows"]] == ["$ABC", "$XYZ"]  # next trading day
    assert "+9.5%" in json.dumps(e.tables)


def test_real_estate_rates_with_fred_and_fallback():
    spec, p = build("real_estate_rates", "close", NOW)
    assert "10Y 4.31%" in p.title and "30Y mortgage 6.81%" in p.title
    assert any("FRED" in s for s in p.sources)
    assert any("not endorsed or certified" in n for n in p.notes)
    _, p2 = build("real_estate_rates", "close", NOW, fred={})
    assert "10Y 4.31%" in p2.title                      # ^TNX 43.1 -> 4.31%
    assert not any("FRED" in s for s in p2.sources)


def test_sector_rotation_ranks_by_relative_strength():
    _, p = build("sector_rotation", "close", NOW)
    assert p.tables[0]["rows"][0][1] == "$XLK"
    assert p.tables[0]["rows"][-1][1] == "$XLRE"
    assert any("Energy" in h and "places" in h for h in p.highlights)


# ── quality gates: stale / missing / thin data -> Skip ──────────────────────

def test_weather_skips_stale_breadth():
    b = breadth(NOW)
    b["newest_quote_at"] = NOW - timedelta(hours=7)
    with pytest.raises(Skip, match="stale"):
        build("market_weather", "close", NOW, breadth=b)


def test_weather_skips_wrong_session():
    with pytest.raises(Skip, match="expected"):
        build("market_weather", "close", NOW, session=date(2026, 11, 23))


def test_weather_skips_without_vix():
    with pytest.raises(Skip, match="VIX"):
        build("market_weather", "close", NOW, quotes={"SPY": _q("SPY", 600, 0.1)})


def test_sentiment_skips_thin_news():
    from fixtures import news_rows
    with pytest.raises(Skip, match="classified headlines"):
        build("sentiment_pulse", "evening", NOW, news=news_rows(NOW)[:5])


def test_sentiment_skips_stale_news():
    from fixtures import news_rows
    old = [{**r, "published_at": r["published_at"] - timedelta(hours=10)} for r in news_rows(NOW)[:30]]
    with pytest.raises(Skip):
        build("sentiment_pulse", "evening", NOW, news=old)


def test_movers_skips_without_movers():
    b = breadth(NOW)
    b["rows"] = [r for r in b["rows"] if abs(r["change_percent"]) < 2]
    with pytest.raises(Skip, match="moved"):
        build("movers_breakouts", "close", NOW, breadth=b)


def test_earnings_skips_when_sources_down():
    with pytest.raises(Skip, match="unavailable"):
        build("earnings_watch", "morning", MORNING_NOW, earnings={"sources": {"finnhub": False, "nasdaq": False},
                                                                    "rows": []})


def test_real_estate_skips_without_ten_year():
    from fixtures import QUOTES, quote
    q = {s: quote(s, *QUOTES[s]) for s in QUOTES if s != "^TNX"}
    with pytest.raises(Skip, match="10-year"):
        build("real_estate_rates", "close", NOW, fred={}, quotes=q)


def test_sector_rotation_skips_stale_closes():
    with pytest.raises(Skip, match="expected"):
        build("sector_rotation", "close", NOW, session=date(2026, 11, 20))


# ── compliance gate rejects bad posts ───────────────────────────────────────

def _good():
    spec, p = build("movers_breakouts", "close", NOW)
    return spec, p


@pytest.mark.parametrize("phrase", [
    "You should buy NVDA here.", "Strong buy on breakout", "Buy now before it runs",
    "This is guaranteed to rise", "Price target 300", "Load up on calls",
])
def test_compliance_rejects_advice_language(phrase):
    spec, p = _good()
    bad = replace(p, highlights=p.highlights + [phrase])
    assert any("advice" in v for v in compliance.check(spec, bad))


@pytest.mark.parametrize("url", [
    "https://www.reddit.com/r/stocks/comments/abc", "https://stocktwits.com/someone/message/1",
    "https://x.com/user/status/1", "https://twitter.com/user/status/1",
])
def test_compliance_rejects_social_links(url):
    spec, p = _good()
    bad = replace(p, links=[{"title": "A post", "url": url, "source": "social"}])
    assert any("social" in v for v in compliance.check(spec, bad))


def test_compliance_rejects_long_headlines_and_handles():
    spec, p = _good()
    long = replace(p, links=[{"title": "x" * (MAX_HEADLINE_CHARS + 1), "url": "https://a.example/1", "source": "s"}])
    assert compliance.check(spec, long)
    handle = replace(p, highlights=["Observation: @someuser said it will run"])
    assert any("handle" in v for v in compliance.check(spec, handle))
    reddit_user = replace(p, highlights=["Observation: u/trader123 is bullish"])
    assert any("handle" in v for v in compliance.check(spec, reddit_user))


def test_compliance_requires_labels():
    spec, p = _good()
    body = render_body(spec, p)
    for label in (f"Automated post by {spec.display_name}", "Sources:", "As of:", DISCLAIMER):
        assert compliance.validate(spec, p, body.replace(label, "")), label
    no_marker = replace(p, title=p.title.lstrip("\U0001F916 "))
    assert any("robot marker" in v for v in compliance.check(spec, no_marker))


def test_titles_clipped_to_limit():
    from app.services.community_bots.base import clip_title
    t = clip_title("word " * 100)
    assert len(t) <= MAX_HEADLINE_CHARS and t.endswith("…")
    assert clip_title("short\nline") == "short line"


def test_registry_has_six_bots_with_caps_and_methodology():
    specs = registry.all_specs()
    assert {s.slug for s in specs} >= {"market_weather", "sentiment_pulse", "movers_breakouts",
                                       "earnings_watch", "real_estate_rates", "sector_rotation"}
    for s in specs:
        assert s.username.endswith("_bot") and s.daily_cap >= 1 and s.slots and s.methodology
        assert len(s.slots) <= s.daily_cap
        assert all(not compliance.BOT_ADVICE_RE.search(m) for m in s.methodology + [s.description, s.tagline])


def test_bot_post_dataclass_has_no_free_text_inputs():
    """Compose functions only receive data dicts; BotPost has no field for raw
    third-party text except link titles (clipped)."""
    fields = set(BotPost.__dataclass_fields__)
    assert "summary" not in fields and "body" not in fields
