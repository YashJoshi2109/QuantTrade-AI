import pytest

from app.services.copilot.resolver import TickerResolver, normalize_symbol


@pytest.mark.parametrize("raw,want", [("BRK.B", "BRK.B"), ("brk-b", "BRK.B"), ("$BRK/B", "BRK.B"),
                                      (" aapl ", "AAPL"), ("GOOGL", "GOOGL")])
def test_normalize_symbol(raw, want):
    assert normalize_symbol(raw) == want


@pytest.mark.parametrize("msg", ["What's BRK.B book value?", "what about BRK-B", "Is $BRK.B cheap?",
                                 "berkshire hathaway book value"])
def test_share_class_not_split(fixture_db, msg):
    res = TickerResolver(fixture_db).resolve(msg)
    assert res.symbols == ["BRK.B"], (msg, res.symbols)


def test_cashtag_and_names(fixture_db):
    r = TickerResolver(fixture_db)
    assert r.resolve("$TSLA vs Nvidia").symbols == ["TSLA", "NVDA"]
    assert sorted(r.resolve("Meta's AI spending vs Alphabet?").symbols) == ["GOOGL", "META"]


def test_acronyms_are_not_tickers(fixture_db):
    # "AI" is a real ticker (C3.ai) in the fixture universe but an acronym in questions
    res = TickerResolver(fixture_db).resolve("How will AI capex and the CPI print affect EPS?")
    assert res.symbols == [] and res.unknown == []


def test_explicit_symbol_wins(fixture_db):
    res = TickerResolver(fixture_db).resolve("compare it with MSFT", explicit_symbol="nvda")
    assert res.symbols[0] == "NVDA" and res.tickers[0].source == "explicit"
    assert "MSFT" in res.symbols


def test_unknown_ticker_reported(fixture_db):
    res = TickerResolver(fixture_db).resolve("Analyze ZZZQ for me.")
    assert res.symbols == [] and res.unknown == ["ZZZQ"]


def test_memory_followup(fixture_db):
    r = TickerResolver(fixture_db)
    res = r.resolve("What about its biggest customer concentration risk?", memory_symbols=["NVDA"])
    assert res.symbols == ["NVDA"] and res.tickers[0].source == "memory"
    assert r.resolve("Write me a poem about my cat.", memory_symbols=["NVDA"]).symbols == []


def test_off_topic_detected(fixture_db):
    res = TickerResolver(fixture_db).resolve("Write me a poem about my cat.")
    assert not res.finance_related


def test_reassigned_ticker_identity(fixture_db):
    res = TickerResolver(fixture_db).resolve("How is PARA stock doing?")
    t = res.tickers[0]
    assert t.symbol == "PARA" and t.identity.status == "changed" and t.identity.successor_symbol == "SKYD"


def test_etf_asset_type(fixture_db):
    assert TickerResolver(fixture_db).resolve("SPY expense ratio").tickers[0].asset_type == "etf"
