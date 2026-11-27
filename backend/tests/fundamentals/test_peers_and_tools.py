"""Peer table, ranking and the copilot tool wiring (mock providers, no network)."""
import asyncio
from types import SimpleNamespace

import pytest

from app.services.copilot.models import FundamentalsFact, MacroFact, QuoteFact
from app.services.copilot.postcheck import ground_numbers
from app.services.copilot.registry import FactRegistry
from app.services.fundamentals import analysis as A
from app.services.fundamentals import wacc as W
from app.services.fundamentals.xbrl import normalize_companyfacts

from .helpers import ROWS
from .test_xbrl import annual_companyfacts


def _st(ticker="TEST", rows=ROWS):
    st = normalize_companyfacts(annual_companyfacts(rows), ticker, "0000000001")
    st.cover_shares = {"value": 10.0, "as_of": "2024-02-01", "accn": "0000000001-23-000001", "form": "10-K",
                       "filed": "2024-02-15", "tag": "dei:EntityCommonStockSharesOutstanding"}
    return st


def test_market_cap_from_price_times_sec_shares():
    m = A.MarketInputs(price=200.0, price_source="quote:TEST", price_as_of="2024-03-01")
    A.resolve_market_cap(_st(), m, 999.0, "fund:TEST", "2024-03-01")
    assert m.market_cap_usd == 2000.0 and "dei:EntityCommonStockSharesOutstanding" in m.market_cap_source


def test_peer_row_multiples():
    st = _st()
    m = A.MarketInputs(price=200.0, price_source="quote:TEST", forward_pe=11.0, forward_pe_source="fund:TEST")
    A.resolve_market_cap(st, m, None, None, None)
    row = A.peer_row(st, m)
    mt = row["metrics"]
    # EV = 2000 + 280 - 180 - 60 = 2040 ; EBITDA = 216 + 36 = 252 -> 8.095x
    assert row["enterprise_value_usd"] == 2040
    assert mt["ev_to_ebitda"] == 8.095
    assert mt["pe_ttm"] == 12.5                     # 2000 / 160 (latest FY: no quarters in fixture)
    assert mt["fcf_yield_pct"] == 5.0               # (150-50)/2000
    assert mt["fcf_yield_after_sbc_pct"] == 4.4     # (100-12)/2000
    assert mt["gross_margin_pct"] == 42.0
    assert mt["capex_intensity_pct"] == 4.17        # 50/1200
    assert mt["revenue_growth_pct"] == 20.0
    assert mt["roic_pct"] == 31.42
    assert mt["forward_pe"] == 11.0 and row["forward_pe_source"] == "fund:TEST"
    assert row["basis"]["revenue"] == "FY2023"


def test_peer_row_foreign_currency_needs_fx():
    st = _st("FX")
    st.currency = "TWD"
    m = A.MarketInputs(market_cap_usd=2000.0, market_cap_source="fund:FX")
    row = A.peer_row(st, m)
    assert "ev_to_ebitda" not in row["metrics"] and any("no TWD->USD rate" in n for n in row["notes"])
    m.fx_usd_per_unit, m.fx_source, m.fx_as_of = 0.5, "FRED DEXTAUS", "2024-03-01"
    row = A.peer_row(st, m)
    # EV = 2000 + (280-240)*0.5 = 2020 ; EBITDA = 252*0.5 = 126 -> 16.032x
    assert row["metrics"]["ev_to_ebitda"] == 16.032


def test_peer_ranking_ties_and_sensitivity():
    rows = [
        {"ticker": "AAA", "metrics": {"ev_to_ebitda": 10, "fcf_yield_pct": 5, "roic_pct": 30, "forward_pe": None}},
        {"ticker": "BBB", "metrics": {"ev_to_ebitda": 20, "fcf_yield_pct": 5, "roic_pct": 40, "forward_pe": 20}},
        {"ticker": "CCC", "metrics": {"ev_to_ebitda": 30, "fcf_yield_pct": 2, "roic_pct": 10, "forward_pe": 15}},
    ]
    r = A.peer_ranking(rows)
    assert r["per_metric_ranks"]["ev_to_ebitda"] == {"AAA": 1, "BBB": 2, "CCC": 3}
    assert r["per_metric_ranks"]["fcf_yield_pct"] == {"AAA": 1.5, "BBB": 1.5, "CCC": 3}
    # AAA (1+1.5+2)/3 = 1.5 ; BBB (2+1.5+1)/3 = 1.5 ; CCC 3 -> tie broken alphabetically
    assert r["composite_mean_rank"] == {"AAA": 1.5, "BBB": 1.5, "CCC": 3.0}
    assert r["ranking"] == ["AAA", "BBB", "CCC"]
    assert any(d.startswith("forward_pe (missing for AAA)") for d in r["dropped_metrics"])
    assert r["sensitivity"]["without_roic_pct"]["order"][0] == "AAA"
    assert r["sensitivity"]["without_ev_to_ebitda"]["order"][0] == "BBB"
    assert r["sensitivity"]["without_ev_to_ebitda"]["top_changes"] is True
    w = A.peer_ranking(rows, {"roic_pct": 3})
    assert w["ranking"][0] == "BBB"


# ── tool wiring ──────────────────────────────────────────────────────────────
class FakeData:
    def __init__(self, sts):
        self.sts = sts

    async def statements(self, t):
        return self.sts.get(t)

    async def submissions(self, t):
        return {"sic": "3674", "sicDescription": "Semiconductors & Related Devices"}

    async def fx_usd_per_unit(self, ccy):
        return None


class FakeSources:
    def __init__(self, sts):
        self.fundamentals_data = FakeData(sts)

    async def macro(self, indicators):
        return [MacroFact(id="macro:10Y_YIELD", source="FRED DGS10", as_of="2024-03-01", series="DGS10",
                          name="10-year Treasury yield", value=4.0, unit="%", observation_date="2024-03-01")]


def _pack(t, price=200.0):
    q = QuoteFact(id=f"quote:{t}", source="quote cache (test)", as_of="2024-03-01", ticker=t, price=price)
    f = FundamentalsFact(id=f"fund:{t}", source="fundamentals table (test)", as_of="2024-03-01", ticker=t,
                         beta=1.2, forward_pe=11.0, market_cap=1.0)
    return SimpleNamespace(ticker=t, asset_type="equity", quote=q, fundamentals=f, errors={})


def _executor(sts, packs):
    from app.services.copilot.tools import ToolExecutor
    resolver = SimpleNamespace(lookup=lambda t: None)
    return ToolExecutor(FakeSources(sts), FactRegistry(), resolver, packs, build_pack=None)


def test_tools_registered_with_schemas():
    from app.services.copilot.tools import TOOL_NAMES, TOOL_SPECS, TOOL_TIMEOUTS
    names = {"get_financial_history", "analyze_earnings_quality", "analyze_capital_efficiency",
             "dupont_analysis", "assess_financial_distress", "compare_peer_fundamentals"}
    assert names <= TOOL_NAMES
    for spec in TOOL_SPECS:
        if spec["name"] in names:
            assert spec["input_schema"]["type"] == "object" and spec["description"]
            assert TOOL_TIMEOUTS[spec["name"]] > 8


def test_capital_efficiency_tool_end_to_end():
    st = _st()
    ex = _executor({"TEST": st}, {"TEST": _pack("TEST")})
    text, facts, err = asyncio.run(ex.run("analyze_capital_efficiency", {"ticker": "TEST", "years": 2}))
    assert not err, text
    assert facts[0].id == "fa:capital:TEST" and "macro:10Y_YIELD" in ex.registry
    d = facts[0].data
    # market cap 200 x 10 = 2000 ; Kd = 12 / ((280+230)/2) = 4.706 % ; t = 20 %
    # Ke = 4 + 1.2 x 5 = 10 ; WACC = 2000/2280 x 10 + 280/2280 x 4.706 x 0.8 = 8.772 + 0.4624 = 9.23
    assert d["wacc"]["wacc_pct"] == 9.23
    assert d["wacc"]["inputs"]["equity_risk_premium_pct"]["source"].startswith("ASSUMPTION")
    assert d["roic"]["FY2023"]["roic_pct"] == 31.42
    assert d["roic"]["FY2023"]["roic_minus_wacc_pp"] == 22.19
    # numbers quoted from the tool result pass the numeric-grounding check
    _, checked, bad = ground_numbers("ROIC was 31.42% vs a WACC of 9.23% [fa:capital:TEST].", ex.registry)
    assert checked == 2 and bad == []


def test_capital_efficiency_uses_registered_wacc_provider():
    async def prov(t):
        return {"wacc_pct": 7.5, "source": "valuation engine (test)"}
    W.register_wacc_provider(prov)
    try:
        ex = _executor({"TEST": _st()}, {"TEST": _pack("TEST")})
        _, facts, err = asyncio.run(ex.run("analyze_capital_efficiency", {"ticker": "TEST"}))
        assert not err and facts[0].data["wacc"] == {"wacc_pct": 7.5, "source": "valuation engine (test)"}
    finally:
        W.register_wacc_provider(None)


def test_distress_tool_and_explicit_unavailability():
    ex = _executor({"TEST": _st()}, {"TEST": _pack("TEST")})
    _, facts, err = asyncio.run(ex.run("assess_financial_distress", {"ticker": "TEST", "years": 2}))
    assert not err
    d = facts[0].data
    assert d["altman"]["z"]["score"] == pytest.approx(4.296, abs=1e-3)       # MVE = 200 x 10
    assert d["piotroski_f"]["score"] == 6
    assert d["debt_maturities"]["total_scheduled"] == 280
    assert "model_applicability_and_limitations" in d
    assert any("finance_lease" in u for u in d["unavailable"])


def test_dupont_and_peer_tools_one_fact_per_ticker():
    rows_b = {fy: {**r, "net_income": r["net_income"] * 2} for fy, r in ROWS.items()}
    sts = {"AAA": _st("AAA"), "BBB": _st("BBB", rows_b)}
    ex = _executor(sts, {"AAA": _pack("AAA"), "BBB": _pack("BBB")})
    _, facts, err = asyncio.run(ex.run("dupont_analysis", {"tickers": ["AAA", "BBB"], "years": 2}))
    assert not err and [f.id for f in facts] == ["fa:dupont:AAA", "fa:dupont:BBB"]
    _, facts, err = asyncio.run(ex.run("compare_peer_fundamentals", {"tickers": ["AAA", "BBB"]}))
    assert not err
    assert [f.id for f in facts] == ["fa:peer:AAA", "fa:peer:BBB", "fa:peer_rank:AAA-BBB"]
    assert facts[-1].ticker is None and facts[-1].data["normalisation_notes"]


def test_unknown_ticker_and_missing_xbrl_are_errors_not_guesses():
    ex = _executor({}, {"TEST": _pack("TEST")})
    text, _, err = asyncio.run(ex.run("analyze_earnings_quality", {"ticker": "TEST"}))
    assert err and "no SEC XBRL companyfacts" in text
    text, _, err = asyncio.run(ex.run("analyze_earnings_quality", {"ticker": "ZZZZ"}))
    assert err and "not found" in text


def test_history_tool_payload():
    ex = _executor({"TEST": _st()}, {"TEST": _pack("TEST")})
    _, facts, err = asyncio.run(ex.run("get_financial_history", {"ticker": "TEST", "years": 3, "statement": "income"}))
    assert not err
    d = facts[0].data
    assert d["statements"]["income"]["revenue"] == {"FY2021": 800, "FY2022": 1000, "FY2023": 1200}
    assert [p["period"] for p in d["periods"]] == ["FY2021", "FY2022", "FY2023"]
    assert d["xbrl_tags"]["revenue"] == ["us-gaap:RevenuesNetOfInterestExpense"]
