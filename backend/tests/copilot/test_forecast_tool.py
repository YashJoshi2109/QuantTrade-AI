"""Copilot forecast answers use the same numbers and honesty labels as the UI.

The UI badges (watchlist, portfolio, screener, research) and the copilot both
go through app.services.forecasting.summary.summarize_forecast, so:
- ranges, hit rates and "no edge vs ARIMA(0,1,0)" labels are identical;
- a horizon without a tested edge never carries a midpoint / P(up);
- nothing is a signal or advice.
"""
import asyncio
import json

from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
from app.services.copilot.evalkit import FixtureSources, ScriptedLLM
from app.services.copilot.memory import InMemoryStore
from app.services.copilot.sources import forecast_fact
from app.services.forecasting.summary import pick_horizon, summarize_forecast


def raw_forecast(edge_20: bool = False) -> dict:
    """A /api/v1/forecast payload in the current (v3) shape."""
    def row(h, lo80, hi80, lo95, hi95, point, er, pu, edge, cov80, cov95, tests):
        return {
            "h": h, "date": f"2026-12-{h:02d}" if h < 30 else "2027-02-20", "point": point,
            "exp_return_pct": er, "prob_up": pu, "sigma_log": 0.01 * h ** 0.5,
            "bands": {"50": [lo80 + 1, hi80 - 1], "80": [lo80, hi80], "95": [lo95, hi95]},
            "reliability": "edge_in_backtest" if edge else "no_edge",
            "calibration": {"status": "calibrated", "origins": tests},
            "eval": {"edge": edge, "holdout_origins": tests, "effective_tests": tests,
                     "coverage": {"50": 0.5, "80": cov80, "95": cov95}},
        }
    return {
        "ticker": "AAPL", "as_of": "2026-11-25", "generated_at": "2026-11-26T06:00:00+00:00",
        "last_close": 236.48, "vol_annualized_pct": 24.1,
        "benchmark": {"key": "rw", "name": "ARIMA(0,1,0)"},
        "horizons": [
            row(1, 232.9, 240.3, 230.1, 243.0, 236.6, 0.05, 0.51, False, 0.9, 0.96, 50),
            row(20, 219.5, 257.3, 209.0, 268.4, 238.1, 0.69, 0.56, edge_20, 0.78, 0.93, 40),
        ],
        "backtest": {"origins": 100, "mase_vs_naive": {"1": 1.0, "20": 0.97},
                     "directional_accuracy": {"1": 0.5, "20": 0.55}},
        "beats_naive": {"1": False, "20": edge_20},
        "status": "experimental", "label": "Experimental · Not investment advice",
        "ml_model": {"used_in_forecast": False, "promoted": False, "gates_passed": 6, "gates_total": 10,
                     "gates_required": 8, "note": "Our ML price model is experimental: it passed 6 of 10 validation gates."},
    }


# ── shared summary ───────────────────────────────────────────────────────────

def test_summary_hides_direction_without_edge_and_keeps_ranges():
    sm = summarize_forecast(raw_forecast(edge_20=False))
    assert sm["label"] == "Experimental · Not investment advice"
    assert sm["investment_advice"] is False and sm["signal"] is False and sm["any_edge"] is False
    h20 = pick_horizon(sm, 20)
    assert h20["range_80"] == [219.5, 257.3] and h20["range_95"] == [209.0, 268.4]
    assert h20["midpoint"] is None and h20["prob_up_pct"] is None and h20["exp_return_pct"] is None
    assert h20["edge_text"] == "No edge vs ARIMA(0,1,0)"
    assert h20["hit_rate_80"] == 0.78 and h20["hit_rate_95"] == 0.93 and h20["hit_rate_tests"] == 40
    # range as % of last close: (219.5/236.48-1)*100
    assert h20["range_80_pct"] == [round((219.5 / 236.48 - 1) * 100, 2), round((257.3 / 236.48 - 1) * 100, 2)]
    assert sm["ml_gate"] == {"promoted": False, "gates_passed": 6, "gates_total": 10, "gates_required": 8,
                             "note": "Our ML price model is experimental: it passed 6 of 10 validation gates."}


def test_summary_shows_midpoint_only_with_tested_edge():
    sm = summarize_forecast(raw_forecast(edge_20=True))
    h1, h20 = pick_horizon(sm, 1), pick_horizon(sm, 20)
    assert h20["edge"] and h20["midpoint"] == 238.1 and h20["prob_up_pct"] == 56.0
    assert h20["edge_text"] == "Beat ARIMA(0,1,0) in tests"
    assert h1["midpoint"] is None  # 1-day still has no edge
    assert sm["signal"] is False   # a tested edge is still not a trade signal


def test_summary_handles_legacy_and_empty_payloads():
    assert summarize_forecast(None) is None and summarize_forecast({"horizons": []}) is None
    legacy = {"as_of": "2026-11-24", "last_close": 100.0,
              "horizons": [{"h": 5, "point": 101, "prob_up": 0.6, "bands": {"80": [95, 105]}}],
              "backtest": {"origins": 40, "band_coverage": {"5": {"80": 0.8, "95": 0.95}}}}
    h = summarize_forecast(legacy, "xyz")["horizons"][0]
    assert h["reliability"] == "no_edge" and h["midpoint"] is None and h["range_95"] is None
    assert h["hit_rate_80"] == 0.8 and h["hit_rate_tests"] == 40 and h["calibration"] == "calibrated"


# ── copilot fact == summary ──────────────────────────────────────────────────

def test_copilot_fact_matches_ui_summary():
    raw = raw_forecast(edge_20=False)
    sm = summarize_forecast(raw, "AAPL")
    fc = forecast_fact("AAPL", raw)
    for fh, sh in zip(fc.horizons, sm["horizons"]):
        assert [fh.p10, fh.p90] == sh["range_80"] and [fh.p025, fh.p975] == sh["range_95"]
        assert fh.p50 == sh["midpoint"] is None and fh.prob_up_pct is None
        assert fh.reliability == sh["reliability"] and fh.edge_vs_benchmark == sh["edge_text"]
        assert fh.hit_rate_80 == sh["hit_rate_80"] and fh.hit_rate_tests == sh["hit_rate_tests"]
    assert fc.signal is False and "6 of 10" in fc.ml_gate
    assert "not a prediction" in fc.note and "no_edge" in fc.note
    snip = fc.ui()["snippet"]
    assert "$219.5–$257.3" in snip and "78% hit rate in 40 tests" in snip and "no edge vs arima(0,1,0)" in snip
    assert "midpoint" not in snip


# ── end to end: "what's the forecast for AAPL" ───────────────────────────────

class _Sources(FixtureSources):
    def __init__(self, raw, cold_first=False):
        super().__init__()
        self._raw, self._cold = raw, cold_first

    async def forecast(self, ticker):
        self.calls.append(("forecast", ticker))
        if self._cold:  # first read (context pack) misses: fit still running
            self._cold = False
            return None
        return forecast_fact(ticker, self._raw) if ticker == "AAPL" else None


def _run(db, msg, steps, sources):
    llm = ScriptedLLM(steps)
    eng = CopilotEngine(db, sources=sources, llm_chain=[LLMHandle("scripted", "m", lambda: llm)],
                        memory_store=InMemoryStore(), use_pack_cache=False)

    async def go():
        return [ev async for ev in eng.run(CopilotRequest(message=msg, user_id=7))]

    return asyncio.run(go()), llm


def _tool_payload(llm, round_i=1):
    msg = next(m for m in llm.seen[round_i] if m.type == "tool")
    body = msg.content.split("\n", 1)[1].rsplit("\n</context>", 1)[0]
    return json.loads(body.replace("\\u003c", "<").replace("\\u003e", ">"))


def test_copilot_forecast_question_uses_same_numbers_and_labels(fixture_db):
    raw = raw_forecast(edge_20=False)
    answer = ("**AAPL forecast (experimental):** over about a month the 80% range is $219.50 – $257.30 "
              "[fc:AAPL]. In 40 past tests 78% of outcomes landed inside it. The model shows no edge over "
              "ARIMA(0,1,0) at this horizon, so it gives no direction. Informational, not financial advice.")
    steps = [{"tool_calls": [{"name": "get_forecast", "args": {"ticker": "AAPL"}}]}, {"text": answer}]
    evs, llm = _run(fixture_db, "What's the forecast for AAPL?", steps, _Sources(raw))

    ctx = dict(evs)["context"]["forecast"]
    assert ctx["p10"] == 219.5 and ctx["p90"] == 257.3 and ctx["p50"] is None and ctx["prob_up_pct"] is None
    assert ctx["reliability"] == "no_edge" and ctx["edge_vs_benchmark"] == "No edge vs ARIMA(0,1,0)"
    assert ctx["hit_rate_80"] == 0.78 and ctx["label"] == "Experimental · Not investment advice"

    payload = _tool_payload(llm)
    h20 = next(h for h in payload["horizons"] if h["h"] == 20)
    assert h20["p10"] == 219.5 and "p50" not in h20 and "prob_up_pct" not in h20
    assert h20["reliability"] == "no_edge" and payload["signal"] is False

    done = dict(evs)["done"]
    assert done["postcheck"]["unverified_numbers"] == []
    assert any(c["id"] == "fc:AAPL" for c in done["citations"])


def test_get_forecast_rereads_cache_when_pack_was_cold(fixture_db):
    steps = [{"tool_calls": [{"name": "get_forecast", "args": {"ticker": "AAPL"}}]},
             {"text": "80% range $219.50 – $257.30 [fc:AAPL]."}]
    evs, llm = _run(fixture_db, "What's the forecast for AAPL?", steps, _Sources(raw_forecast(), cold_first=True))
    assert dict(evs)["context"]["forecast"] is None
    tools = [d for n, d in evs if n == "tool" and d["status"] != "running"]
    assert [t["status"] for t in tools] == ["done"]
    assert _tool_payload(llm)["horizons"][0]["p10"] == 232.9


def test_tool_spec_states_honesty_rules():
    from app.services.copilot.prompt import system_prompt
    from app.services.copilot.tools import TOOL_SPECS

    spec = next(t for t in TOOL_SPECS if t["name"] == "get_forecast")
    assert "ARIMA(0,1,0)" in spec["description"] and "never a signal" in spec["description"]
    sp = system_prompt()
    assert "no_edge" in sp and "do not state a direction" in sp
