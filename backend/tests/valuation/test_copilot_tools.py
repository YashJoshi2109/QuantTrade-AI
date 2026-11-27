"""Valuation tools through the real copilot ToolExecutor (no network: the
valuation data provider is a fake built on the fixtures)."""
import asyncio
import json

import numpy as np
import pandas as pd

from app.services.copilot.models import QuoteFact, TickerContextPack
from app.services.copilot.postcheck import run_postcheck
from app.services.copilot.registry import FactRegistry
from app.services.copilot.tools import TOOL_NAMES, TOOL_SPECS, ToolExecutor, lc_tools
from app.services.copilot.valuation_tools import VALUATION_TOOL_NAMES
from app.services.valuation.financials import parse_companyfacts
from app.services.valuation.provenance import DataUnavailable, Datum

from .fixtures import make_testco_facts


class FakeValuationData:
    def __init__(self, geo_share=0.55, prices=True):
        self.geo_share = geo_share
        self.has_prices = prices
        self.calls = []
        rng = np.random.default_rng(11)
        idx = pd.bdate_range(end="2026-11-25", periods=6 * 252)
        m = rng.normal(0.0004, 0.011, len(idx))
        s = 0.0002 + 1.25 * m + rng.normal(0, 0.008, len(idx))
        self._px = {"SPY": pd.Series(400 * np.cumprod(1 + m), index=idx),
                    "TEST": pd.Series(80 * np.cumprod(1 + s), index=idx)}

    async def financials(self, ticker):
        self.calls.append(("financials", ticker))
        if ticker != "TEST":
            raise DataUnavailable(f"{ticker}: no SEC CIK")
        return parse_companyfacts(make_testco_facts(), "TEST", "0000000001")

    async def prices(self, ticker, years=5):
        self.calls.append(("prices", ticker))
        if not self.has_prices:
            raise DataUnavailable(f"{ticker}: no daily price history")
        return self._px[ticker]

    async def risk_free(self):
        return Datum(0.0412, "FRED DGS10", "2026-11-24", tag="DGS10 (macro:10Y_YIELD)", unit="fraction")

    async def fx(self, currency):
        return None

    async def geo_mix(self, ticker, fin):
        self.calls.append(("geo", ticker))
        return {"foreign_share": self.geo_share, "formula": "1 - country:US revenue / total revenue",
                "source": "SEC XBRL instance test_htm.xml", "accession": "0000000000-25-000001",
                "period_end": "2025-06-30", "members": []}

    async def filings(self, ticker, query, filing_types=None, limit=6):
        return []


class Sources:
    def __init__(self, vd):
        self.valuation_data = vd


def _executor(vd=None, asset_type="equity"):
    q = QuoteFact(id="quote:TEST", source="quote cache (fixture)", as_of="2026-11-25T21:00:00+00:00", ticker="TEST",
                  price=100.0, market_session="closed", session_date="2026-11-25", quote_time="2026-11-25T21:00:00Z")
    pack = TickerContextPack(ticker="TEST", name="TestCo", asset_type=asset_type, quote=q)
    reg = FactRegistry()
    return ToolExecutor(Sources(vd or FakeValuationData()), reg, None, {"TEST": pack}, None), reg


def _run(ex, name, args):
    content, facts, err = asyncio.run(ex.run(name, args))
    payload = json.loads(content.split("\n", 1)[1].rsplit("\n", 1)[0]) if not err else None
    return content, facts, err, payload


def test_tools_are_registered_with_schemas():
    names = [t["name"] for t in TOOL_SPECS]
    assert len(names) == len(set(names))
    assert VALUATION_TOOL_NAMES <= TOOL_NAMES
    for t in lc_tools():
        if t["name"] in VALUATION_TOOL_NAMES:
            assert t["description"] and t["input_schema"]["required"] == ["ticker"]
            json.dumps(t)


def test_dcf_tool_returns_cited_fact_with_provenance():
    ex, reg = _executor()
    content, facts, err, p = _run(ex, "valuation_dcf", {"ticker": "TEST"})
    assert not err, content
    f = facts[0]
    assert f.id == "val:dcf:TEST" and f.id in reg and "quote:TEST" in reg
    r = p["result"]
    assert len(r["projection"]) == 10 and r["projection"][0]["fiscal_year"] == 2026
    assert len(r["sensitivity"]["wacc_x_terminal_growth"]["value_per_share"]) == 5
    assert len(r["sensitivity"]["wacc_x_revenue_growth"]["value_per_share"][0]) == 5
    assert r["wacc"]["beta_regression"]["n_observations"] > 200
    assert 1.0 < r["wacc"]["beta_regression"]["beta"] < 1.5
    assert r["wacc"]["risk_free"]["as_of"] == "2026-11-24"
    assert r["vs_market"]["price"] == 100.0
    assert p["inputs"]["revenue_base_year"]["accession"] == "0000000000-25-000001"
    assert {"erp", "terminal_growth", "terminal_roic"} <= {a["name"] for a in p["assumptions"] if a["kind"] == "assumption"}
    # numeric grounding: the value per share and WACC are citable numbers
    vps, wacc = r["value_per_share"], r["wacc"]["wacc_pct"]
    res = run_postcheck(f"Intrinsic value is ${vps:.2f} per share at a WACC of {wacc}% [val:dcf:TEST].", reg)
    assert not res.unverified_numbers and res.cited_ids == ["val:dcf:TEST"]


def test_fact_id_changes_with_arguments():
    ex, _ = _executor()
    _, facts, err, _ = _run(ex, "valuation_dcf", {"ticker": "TEST", "assumptions": {"erp": 0.055}})
    assert not err and facts[0].id.startswith("val:dcf:TEST:")
    _, _, err, p = _run(ex, "valuation_wacc", {"ticker": "TEST", "assumptions": {"erp": 0.055}})
    assert p["result"]["wacc"]["erp_pct"] == 5.5


def test_monte_carlo_tool_runs_10000():
    ex, _ = _executor()
    _, facts, err, p = _run(ex, "valuation_monte_carlo", {"ticker": "TEST", "seed": 123})
    assert not err
    sim = p["result"]["simulation"]
    assert sim["executed"] is True and sim["n_valid"] == 10000 and sim["seed"] == 123
    assert "prob_value_below_price_pct" in sim
    assert "10000 simulations (seed 123)" in facts[0].headline


def test_reverse_dcf_tool_with_failing_peer():
    ex, _ = _executor()
    _, _, err, p = _run(ex, "valuation_reverse_dcf", {"ticker": "TEST", "peers": ["NOPE"]})
    assert not err
    r = p["result"]
    assert r["solve_for"] == "stage1_growth" and len(r["implied_path"]["projection"]) == 10
    assert r["peer_bounds"][0]["error"]


def test_scenarios_tool_uses_disclosed_geo_mix_and_requires_tariff_exposure():
    vd = FakeValuationData()
    ex, _ = _executor(vd)
    _, _, err, p = _run(ex, "valuation_scenarios", {"ticker": "TEST", "shocks": {
        "reporting_currency_appreciation": 0.10, "demand_decline": 0.05, "cogs_inflation": 0.02}})
    assert not err
    r = p["result"]
    assert ("geo", "TEST") in vd.calls and r["geographic_revenue_mix"]["foreign_share"] == 0.55
    assert len(r["individual"]) == 3 and r["combined"]["eps_change"] < 0
    content, _, err, _ = _run(ex, "valuation_scenarios", {"ticker": "TEST", "shocks": {"tariff_rate": 0.25}})
    assert err and "tariff_exposed_cogs_share" in content
    _, _, err, p = _run(ex, "valuation_scenarios", {"ticker": "TEST", "shocks": {"tariff_rate": 0.25},
                                                   "structure": {"tariff_exposed_cogs_share": 0.4}})
    assert not err


def test_bull_bear_tool():
    ex, _ = _executor()
    _, _, err, p = _run(ex, "valuation_bull_bear", {"ticker": "TEST"})
    assert not err
    r = p["result"]
    assert [c["case"] for c in r["cases"]] == ["bull", "base", "bear"]
    assert r["historical_stress"]["max_drawdown_pct"] < 0
    assert r["multiple_compression"]["pe_history"]


def test_errors_are_explicit():
    ex, _ = _executor()
    content, _, err, _ = _run(ex, "valuation_rate_sensitivity", {"ticker": "TEST"})
    assert err and "covers banks" in content
    content, _, err, _ = _run(ex, "valuation_dcf", {"ticker": "TEST", "assumptions": {"growth": 0.1}})
    assert err and "unknown assumption" in content
    content, _, err, _ = _run(ex, "valuation_dcf", {"ticker": "TEST", "assumptions": {"terminal_growth": 0.2}})
    assert err and "below WACC" in content
    ex2, _ = _executor(FakeValuationData(prices=False))
    content, _, err, _ = _run(ex2, "valuation_wacc", {"ticker": "TEST"})
    assert err and "beta" in content and "unavailable" in content
    ex3, _ = _executor(asset_type="etf")
    content, _, err, _ = _run(ex3, "valuation_dcf", {"ticker": "TEST"})
    assert err and "etf" in content
