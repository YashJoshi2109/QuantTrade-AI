"""Polymarket Gamma price parsing and Nasdaq IPO calendar fallback parsing."""
import json
from datetime import date

from app.api.monitor_extended import (
    _event_outcomes,
    _matches_keywords,
    _parse_polymarket_event,
    _yes_price_from_gamma_event,
    _STOCK_KEYWORDS,
)
from app.services.ipo_calendar import merge_ipo_rows, parse_nasdaq_ipo_calendar


def _mkt(prices, closed=False, title=None, outcomes=("Yes", "No")):
    # Gamma encodes outcomes/outcomePrices as JSON *strings*
    return {
        "outcomes": json.dumps(list(outcomes)),
        "outcomePrices": json.dumps([str(p) for p in prices]),
        "closed": closed,
        "active": True,
        "groupItemTitle": title,
    }


def test_binary_event_parses_json_string_prices():
    ev = {"title": "New CEO by Dec 31?", "slug": "ceo", "markets": [_mkt([0.56, 0.44])], "volume24hr": 1200}
    item = _parse_polymarket_event(ev, "stocks")
    assert item is not None
    assert item.yes_price == 0.56
    assert item.no_price == 0.44
    assert item.volume == "$1.2K"


def test_multi_market_event_skips_resolved_first_market():
    # markets[0] is an expired, resolved date bucket priced 0 -> previously yes_price=0.0
    ev = {
        "title": "Iran agrees to surrender stockpile by...?",
        "markets": [
            _mkt([0, 1], closed=True, title="Nov 1"),
            _mkt([0.12, 0.88], title="Dec 31"),
            _mkt([0.31, 0.69], title="Mar 31"),
        ],
    }
    outcomes, yes, no = _event_outcomes(ev)
    assert [o.name for o in outcomes] == ["Mar 31", "Dec 31"]
    assert outcomes[0].price == 0.31
    assert yes is None and no is None  # multi-outcome card, not binary
    assert _yes_price_from_gamma_event(ev) == 0.31


def test_malformed_prices_do_not_crash():
    ev = {"title": "Broken", "markets": [{"outcomes": "not json", "outcomePrices": None}]}
    assert _yes_price_from_gamma_event(ev) == 0.0
    assert _parse_polymarket_event(ev, "") is None


def test_keyword_match_is_whole_word():
    assert not _matches_keywords("iran surrenders uranium stockpile", _STOCK_KEYWORDS)
    assert _matches_keywords("will nvidia stock close above $200", _STOCK_KEYWORDS)
    assert _matches_keywords("s&p 500 up or down", _STOCK_KEYWORDS)


NASDAQ_PAYLOAD = {
    "data": {
        "priced": {
            "rows": [
                {
                    "proposedTickerSymbol": "ANT",
                    "companyName": "Anthropic, PBC",
                    "proposedExchange": "NASDAQ Global Select",
                    "proposedSharePrice": "83.00",
                    "sharesOffered": "980,000,000",
                    "pricedDate": "11/19/2026",
                },
                {
                    "proposedTickerSymbol": "WWB",
                    "companyName": "Windward Bio",
                    "proposedExchange": "NASDAQ Global",
                    "proposedSharePrice": "17.00",
                    "sharesOffered": "10,294,117",
                    "pricedDate": "11/13/2026",
                },
            ]
        },
        "upcoming": {
            "upcomingTable": {
                "rows": [
                    {
                        "proposedTickerSymbol": "NEWC",
                        "companyName": "NewCo Inc",
                        "proposedExchange": "NYSE",
                        "proposedSharePrice": "10.00-12.00",
                        "sharesOffered": "5,000,000",
                        "expectedPriceDate": "12/03/2026",
                    }
                ]
            }
        },
        "filed": {
            "rows": [
                {
                    "proposedTickerSymbol": "EARS",
                    "companyName": "EarLens Corp",
                    "filedDate": "11/24/2026",
                    "dollarValueOfSharesOffered": "$30,000,000",
                }
            ]
        },
        "withdrawn": {"rows": None},
    }
}


def test_parse_nasdaq_ipo_calendar_shapes_rows():
    g = parse_nasdaq_ipo_calendar(NASDAQ_PAYLOAD)
    assert g["priced"][0] == {
        "date": "2026-11-19",
        "symbol": "ANT",
        "name": "Anthropic, PBC",
        "exchange": "NASDAQ Global Select",
        "status": "priced",
        "price": "83.00",
        "shares": 980000000,
    }
    assert g["expected"][0]["date"] == "2026-12-03"
    assert g["filed"][0]["symbol"] == "EARS" and g["filed"][0]["exchange"] is None


def test_parse_nasdaq_handles_null_and_garbage():
    empty = {"data": {"priced": {"rows": None}, "upcoming": {"upcomingTable": {"rows": None}}, "filed": None}}
    assert parse_nasdaq_ipo_calendar(empty) == {"expected": [], "priced": [], "filed": []}
    assert parse_nasdaq_ipo_calendar(None) == {"expected": [], "priced": [], "filed": []}


def test_merge_orders_upcoming_then_priced_then_filed_and_dedupes():
    g = parse_nasdaq_ipo_calendar(NASDAQ_PAYLOAD)
    rows = merge_ipo_rows([g, g], date(2026, 11, 25))
    assert [r["symbol"] for r in rows] == ["NEWC", "ANT", "WWB", "EARS"]
    # an "expected" row whose date already passed is dropped
    rows_late = merge_ipo_rows([g], date(2026, 12, 10))
    assert "NEWC" not in [r["symbol"] for r in rows_late]
