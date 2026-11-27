"""End-to-end analyses and copilot tool wiring on a synthetic market (no network)."""
import asyncio
import json
from datetime import datetime

import pytest

from app.services.quant import analyses as qa
from app.services.quant import backtest as qb
from app.services.quant import data as qd
from quant_fixtures import EVENT_AR, TRUTH, FakeQuantData

NOW = datetime(2026, 11, 21)


@pytest.fixture(autouse=True)
def _fixed_clock(monkeypatch):
    monkeypatch.setattr(qa, "_now", lambda: NOW)
    monkeypatch.setattr(qb, "_now", lambda: NOW)
    qd.set_provider(FakeQuantData())
    yield
    qd.set_provider(None)


# ── analyses ─────────────────────────────────────────────────────────────────

def test_price_behavior_provenance_and_verdict():
    out = qa.price_behavior("TSM")
    assert out["data"]["TSM"]["source"] == "fixture" and out["data"]["TSM"]["split_dividend_adjusted"] is True
    assert out["as_of"] == "2026-11-20"
    res = out["results"]
    for w in ("30d", "90d", "252d"):
        assert res["realised_volatility"][w]["current_pct"] > 0
    # returns are iid in the fixture: no test should claim momentum or mean reversion
    assert res["verdict"]["reading"] == "random_walk_consistent"
    lo, hi = res["hurst"]["rs"]["null_95pct_interval"]
    assert lo < 0.5 < hi
    assert res["regimes"]["model_selection"]["k1"]["bic"] is not None
    assert res["regimes"]["regimes_supported"] is False      # homoskedastic window
    assert out["caveats"] and out["method"]["variance_ratio"]
    json.dumps(out)


def test_price_behavior_finds_crash_regime_when_window_includes_it():
    out = qa.price_behavior("TSM", years=9)
    reg = out["results"]["regimes"]
    assert reg["regimes_supported"] is True
    vols = [s["vol_annual_pct"] for s in reg["states"]]
    assert vols[1] > 1.8 * vols[0]
    assert "2020-0" in " ".join(s["start"] for s in reg["recent_segments"])


def test_risk_metrics_recovers_generating_beta_and_reports_rf():
    out = qa.risk_metrics("NVDA", "SPY", years=5)
    res = out["results"]
    assert res["beta"] == pytest.approx(TRUTH["NVDA"][1], abs=3 * res["beta_se"])
    assert out["risk_free"]["source"] == "fixture DTB3"
    dd = res["max_drawdown"]
    assert dd["max_drawdown_pct"] < 0 and dd["peak_date"] < dd["trough_date"]
    v = res["var_95_1day"]
    assert v["historical_cvar_pct"] > v["historical_var_pct"] > 0
    assert res["rolling_beta_252"]["latest"] is not None
    assert out["analysis_window"][0] >= "2021-11-01"


def test_risk_metrics_without_rf_says_so():
    qd.set_provider(FakeQuantData(rf=False))
    out = qa.risk_metrics("NVDA")
    assert out["risk_free"]["source"] is None
    assert any("rf = 0" in a for a in out["assumptions"])


def test_missing_prices_raise_explicitly():
    qd.set_provider(FakeQuantData(missing={"NVDA"}))
    with pytest.raises(qa.DataUnavailable, match="no daily price data for NVDA"):
        qa.risk_metrics("NVDA")


def test_event_study_detects_injected_reaction():
    out = qa.earnings_event_study("AAPL", n_events=12)
    res = out["results"]
    assert res["all_events"]["n"] == 12
    assert res["positive_surprise"]["n"] == 9 and res["negative_or_zero_surprise"]["n"] == 3
    assert res["positive_surprise"]["mean_car_pct"] == pytest.approx(EVENT_AR * 100, abs=2.0)
    assert res["positive_surprise"]["p_greater"] < 0.05
    first = res["events"][0]
    assert first["timing"] == "amc" and first["day0"] > first["announcement_date"]
    assert first["ar_by_day_pct"]["0"] == pytest.approx(EVENT_AR * 100, abs=1.5)
    assert out["data"]["earnings_events"]["source"] == "fixture earnings"
    assert "statistically significant" in res["positive_surprise_answer"]


def test_event_study_no_events_is_explicit():
    with pytest.raises(qa.DataUnavailable, match="no past earnings announcement dates"):
        qa.earnings_event_study("MSFT")


def test_portfolio_risk_contributions_sum_and_stress():
    syms = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "TSLA"]
    out = qa.portfolio_risk(syms)
    res = out["results"]
    pcr = [res["risk_contributions"][s]["percent_of_risk"] for s in syms]
    assert sum(pcr) == pytest.approx(100.0, abs=0.05)
    assert res["risk_contributions"]["TSLA"]["percent_of_risk"] > res["risk_contributions"]["MSFT"]["percent_of_risk"]
    assert sum(res["sector_weights_pct"].values()) == pytest.approx(100.0, abs=0.01)
    assert res["diversification_ratio"] > 1
    ids = [s["id"] for s in res["historical_stress"]]
    assert ids == ["q4_2018_selloff", "covid_crash_2020", "tech_bear_2022", "tariff_shock_2025"]
    covid = res["historical_stress"][1]
    assert covid["portfolio_return_pct"] < 0 and covid["benchmarks_return_pct"]["SPY"] < 0
    hyp = res["hypothetical_tech_correction"]
    assert hyp["shock_pct"] == -20.0 and hyp["portfolio_implied_move_pct"] < 0
    assert "equal weights (none supplied)" in out["assumptions"]
    assert res["factor_regressions"]["TSLA"]["market_plus_sector"]["sector_etf"] == "XLY"


def test_portfolio_stress_unavailable_when_asset_not_listed():
    qd.set_provider(FakeQuantData(late_start={"TSLA": "2021-01-04"}))
    out = qa.portfolio_risk(["AAPL", "TSLA"])
    covid = out["results"]["historical_stress"][1]
    assert covid["portfolio_return_pct"] is None and covid["missing_data"] == ["TSLA"]


def test_backtest_vs_buy_and_hold_uses_strategy_lab():
    out = qb.strategy_backtest("MSFT", preset="rsi_reversion", parameters={"buy_below": 35})
    assert out["strategy"]["entry"] == "RSI(14) < 35 AND CLOSE > SMA(200)"
    assert out["execution"]["fills"] == "next_bar_open"
    assert out["execution"]["slippage_bps"] == 5.0 and out["execution"]["commission_bps"] == 1.0
    res = out["results"]
    assert res["buy_and_hold"]["total_trades"] == 1
    assert res["out_of_sample_split"]["strategy"]["split_date"] == res["out_of_sample_split"]["buy_and_hold"]["split_date"]
    assert res["comparison"]["sharpe_strategy_minus_buy_and_hold"] == pytest.approx(
        res["strategy"]["sharpe"] - res["buy_and_hold"]["sharpe"], abs=1e-3)
    assert any("risk-free" in a for a in out["assumptions"])


# ── copilot tool wiring ──────────────────────────────────────────────────────

def _executor(fixture_db):
    from app.services.copilot.evalkit import FixtureSources
    from app.services.copilot.registry import FactRegistry
    from app.services.copilot.resolver import TickerResolver
    from app.services.copilot.tools import ToolExecutor
    reg = FactRegistry()
    return ToolExecutor(FixtureSources(), reg, TickerResolver(fixture_db), {}, None), reg


@pytest.fixture
def fixture_db():
    from app.services.copilot.evalkit import fixture_db as make
    db = make()
    yield db
    db.close()


def test_tools_registered_with_schemas():
    from app.services.copilot.tools import TOOL_NAMES, TOOL_TIMEOUTS, lc_tools
    names = {t["name"] for t in lc_tools()}
    for n in ("analyze_price_behavior", "get_risk_metrics", "earnings_event_study",
              "analyze_portfolio_risk", "backtest_strategy"):
        assert n in names and n in TOOL_NAMES and TOOL_TIMEOUTS[n] >= 30
    spec = next(t for t in lc_tools() if t["name"] == "backtest_strategy")
    from app.services.quant.backtest import SINGLE_ASSET_PRESETS
    assert set(spec["input_schema"]["properties"]["preset"]["enum"]) == set(SINGLE_ASSET_PRESETS)


def test_risk_tool_returns_grounded_fact(fixture_db):
    from app.services.copilot.postcheck import ground_numbers
    ex, reg = _executor(fixture_db)
    text, facts, err = asyncio.run(ex.run("get_risk_metrics", {"ticker": "NVDA"}))
    assert not err, text
    assert facts[0].id == "quant:risk:NVDA:SPY" and "quant:risk:NVDA:SPY" in reg
    assert text.startswith('<context source="tool:get_risk_metrics" as_of="2026-11-20">')
    res = facts[0].result["results"]
    good = f"Beta is {res['beta']} [quant:risk:NVDA:SPY] and Sharpe {res['sharpe']} [quant:risk:NVDA:SPY]."
    _, checked, bad = ground_numbers(good, reg)
    assert checked == 2 and bad == []
    _, _, bad = ground_numbers("Sortino is 9.8765 [quant:risk:NVDA:SPY].", reg)
    assert bad == ["9.8765"]
    assert facts[0].ui()["snippet"].startswith("beta ")


def test_tool_errors_are_explicit(fixture_db):
    ex, _ = _executor(fixture_db)
    text, facts, err = asyncio.run(ex.run("get_risk_metrics", {"ticker": "ZZZZ"}))
    assert err and "not found" in text and facts == []
    qd.set_provider(FakeQuantData(missing={"NVDA"}))
    text, _, err = asyncio.run(ex.run("get_risk_metrics", {"ticker": "NVDA"}))
    assert err and "data unavailable" in text and "NVDA" in text
    text, _, err = asyncio.run(ex.run("analyze_portfolio_risk", {"tickers": ["AAPL", "AAPL"]}))
    assert err and "duplicate" in text


def test_portfolio_and_backtest_tools(fixture_db):
    ex, reg = _executor(fixture_db)
    text, facts, err = asyncio.run(ex.run("analyze_portfolio_risk", {
        "tickers": ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "TSLA"], "tech_shock_pct": -25}))
    assert not err, text
    assert facts[0].id == "quant:portfolio:NVDA-AAPL-MSFT-AMZN-GOOGL-TSLA" and facts[0].ticker is None
    assert facts[0].result["results"]["hypothetical_tech_correction"]["shock_pct"] == -25
    text, facts, err = asyncio.run(ex.run("backtest_strategy", {"ticker": "MSFT", "preset": "rsi_reversion"}))
    assert not err, text
    assert facts[0].id == "quant:backtest:MSFT:rsi_reversion"
    text, facts, err = asyncio.run(ex.run("earnings_event_study", {"ticker": "AAPL", "window_pre": -1, "window_post": 1}))
    assert not err, text
    assert facts[0].result["results"]["events"][0]["event_window"][0] < facts[0].result["results"]["events"][0]["day0"]


def test_portfolio_risk_fetches_histories_concurrently():
    """Live eval: the 6-name portfolio question timed out fetching ~11 price
    histories one after another. They are now fetched in parallel threads."""
    import threading
    import time

    class Slow(FakeQuantData):
        def __init__(self):
            super().__init__()
            self.active = 0
            self.peak = 0
            self.lock = threading.Lock()

        def prices(self, symbol, start, end):
            with self.lock:
                self.active += 1
                self.peak = max(self.peak, self.active)
            time.sleep(0.05)
            try:
                return super().prices(symbol, start, end)
            finally:
                with self.lock:
                    self.active -= 1

    slow = Slow()
    qd.set_provider(slow)
    syms = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "TSLA"]
    out = qa.portfolio_risk(syms)
    assert slow.peak >= 4
    assert set(syms) | {"SPY"} <= set(slow.calls)
    rc = out["results"]["risk_contributions"]
    assert sum(rc[s]["percent_of_risk"] for s in syms) == pytest.approx(100.0, abs=0.05)
