"""Quant / risk copilot tools (app.services.quant behind them).

Registered into the copilot tool registry by app.services.copilot.tools
(TOOL_SPECS += QUANT_TOOL_SPECS; dispatch by name). Every result is ONE
``QuantFact`` whose fields are the deterministic output of the quant engine,
with provenance (data sources and windows, risk-free source, formulas,
assumptions, caveats). The model cites the fact id; postcheck grounds every
number in the answer against these values.

Fact ids
  quant:behavior:TSM             price behaviour (vol, Hurst, ACF, VR, regimes)
  quant:risk:NVDA:SPY            risk metrics vs a benchmark
  quant:event:AAPL               earnings event study
  quant:portfolio:AAPL-MSFT-...  portfolio risk / concentration / stress
  quant:backtest:MSFT:<rules>    strategy vs buy-and-hold
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from typing import Any, Dict, List, Literal, Optional

from app.services.copilot.models import Fact

QUANT_TOOL_TIMEOUT_S = 45.0

_T = {"type": "string"}
_BENCH = {"type": "string", "description": "ETF, default SPY"}
_YEARS = {"type": "number", "minimum": 1, "maximum": 20}
_INT = lambda lo, hi: {"type": "integer", "minimum": lo, "maximum": hi}  # noqa: E731


QUANT_TOOL_SPECS: List[Dict[str, Any]] = [
    {"name": "analyze_price_behavior",
     "description": ("Daily-bar statistics: rolling 30/90/252d realised vol, Hurst (R/S corrected, DFA) vs a "
                     "permutation null, ACF + Ljung-Box, variance ratios, HMM vol regimes, and a mean-reversion vs "
                     "momentum reading with caveats."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "years": _YEARS, "n_states": {"type": "integer", "enum": [2, 3]}, "acf_lags": _INT(5, 40)},
         "required": ["ticker"], "additionalProperties": False}},
    {"name": "get_risk_metrics",
     "description": ("Daily total returns vs a benchmark (default 5y): beta, rolling/downside beta, Jensen's alpha "
                     "(FRED T-bill rf), Sharpe, Sortino, max drawdown with dates, historical/parametric/Cornish-Fisher "
                     "VaR and CVaR, divergence notes."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "benchmark": _BENCH, "years": _YEARS,
         "var_level": {"type": "number", "minimum": 0.9, "maximum": 0.995},
         "risk_free_rate_pct": {"type": "number", "minimum": 0, "maximum": 20}},
         "required": ["ticker"], "additionalProperties": False}},
    {"name": "earnings_event_study",
     "description": ("Market-model event study of the last N earnings releases (default 12, window [-2,+2]): AR, "
                     "CAR, t, J1/J2 and sign tests, split by EPS-surprise sign."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "n_events": _INT(4, 20), "window_pre": _INT(-10, 0), "window_post": _INT(0, 10),
         "estimation_days": _INT(60, 250), "market": _BENCH},
         "required": ["ticker"], "additionalProperties": False}},
    {"name": "analyze_portfolio_risk",
     "description": ("1-10 tickers (default equal weight, 3y): correlations, covariance, marginal/percent risk "
                     "contributions, PCA, sectors, factor betas (SPY, QQQ-SPY, sector ETF), historical stress "
                     "(2018, 2020, 2022, 2025) and a hypothetical QQQ shock (default -20%)."),
     "input_schema": {"type": "object", "properties": {
         "tickers": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 10},
         "weights": {"type": "array", "items": {"type": "number", "minimum": 0}},
         "years": {"type": "number", "minimum": 1, "maximum": 10},
         "tech_shock_pct": {"type": "number", "minimum": -60, "maximum": 0}},
         "required": ["tickers"], "additionalProperties": False}},
    {"name": "backtest_strategy",
     "description": ("Strategy Lab backtest vs buy-and-hold (next-open fills, costs, in/out-of-sample split, "
                     "deflated Sharpe). Preset rsi_reversion = RSI(14) < buy_below and close > SMA200, exit RSI > "
                     "sell_above, 8% stop; or entry/exit {logic: all|any, rules: [{left: {indicator, params}, op, right: "
                     "{value} | {indicator, params}}]}."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T,
         "preset": {"type": "string", "enum": ["golden_cross", "rsi_reversion", "macd_trend", "rsi_macd_trend",
                                               "bollinger_reversion", "donchian_breakout"]},
         "parameters": {"type": "object"}, "entry": {"type": "object"}, "exit": {"type": "object"},
         "start_date": {"type": "string"}, "end_date": {"type": "string"}, "years": _YEARS,
         "commission_bps": {"type": "number", "minimum": 0, "maximum": 100},
         "slippage_bps": {"type": "number", "minimum": 0, "maximum": 100},
         "oos_split": {"type": "number", "minimum": 0.5, "maximum": 0.9},
         "stop_loss_pct": {"type": "number", "minimum": 0.5, "maximum": 50},
         "max_hold_bars": _INT(1, 1000)},
         "required": ["ticker"], "additionalProperties": False}},
]
QUANT_TOOL_NAMES = {t["name"] for t in QUANT_TOOL_SPECS}

_ANALYSIS_ID = {"analyze_price_behavior": "behavior", "get_risk_metrics": "risk",
                "earnings_event_study": "event", "analyze_portfolio_risk": "portfolio",
                "backtest_strategy": "backtest"}
_LABEL = {"price_behavior": "price behaviour statistics", "risk_metrics": "risk metrics",
          "earnings_event_study": "earnings event study", "portfolio_risk": "portfolio risk",
          "strategy_backtest": "strategy backtest vs buy-and-hold"}
_BENCH_RE = re.compile(r"^[A-Z0-9.\-^=]{1,15}$")


class QuantFact(Fact):
    kind: Literal["quant"] = "quant"
    analysis: str
    result: Dict[str, Any]

    def label(self) -> str:
        who = self.ticker or ", ".join(self.result.get("tickers") or [])
        return f"{who} {_LABEL.get(self.analysis, self.analysis)}"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d["snippet"] = _snippet(self.analysis, self.result.get("results") or {})
        return d


def _snippet(analysis: str, res: Dict[str, Any]) -> str:
    try:
        if analysis == "price_behavior":
            v = res["realised_volatility"]
            return (f"30d vol {v['30d']['current_pct']}%, 252d vol {v['252d']['current_pct']}%; "
                    f"{res['verdict']['summary']}")
        if analysis == "risk_metrics":
            return (f"beta {res['beta']}, downside beta {res['downside_beta']}, Sharpe {res['sharpe']}, "
                    f"max drawdown {res['max_drawdown']['max_drawdown_pct']}%")
        if analysis == "earnings_event_study":
            a = res["all_events"]
            return f"{a.get('n')} events, mean CAR {a.get('mean_car_pct')}%, t-test p {a.get('p_two_sided')}"
        if analysis == "portfolio_risk":
            return (f"portfolio vol {res['portfolio_vol_annual_pct']}%, avg correlation "
                    f"{res['average_pairwise_correlation']}, diversification ratio {res['diversification_ratio']}")
        if analysis == "strategy_backtest":
            s, b = res["strategy"], res["buy_and_hold"]
            return f"strategy Sharpe {s.get('sharpe')} vs buy-and-hold {b.get('sharpe')}"
    except (KeyError, TypeError):
        pass
    return ""


def _sources(result: Dict[str, Any]) -> str:
    data = result.get("data") or {}
    srcs = sorted({v.get("source") for v in data.values() if isinstance(v, dict) and v.get("source")})
    rf = (result.get("risk_free") or {}).get("source")
    if rf:
        srcs.append(rf)
    return "QuantTrade quant engine over " + (", ".join(srcs) if srcs else "daily price data")


async def _validate(executor, ticker: str) -> str:
    from app.services.copilot.resolver import normalize_symbol
    t = normalize_symbol(ticker)
    if not t:
        raise LookupError("ticker is required")
    async with executor._db_lock:
        row = await asyncio.to_thread(executor.resolver.lookup, t)
    if row is None:
        raise LookupError(f"ticker {ticker!r} not found in our symbol universe")
    return row.symbol.upper()


def _bench(v: Optional[str]) -> str:
    b = (v or "SPY").strip().upper()
    if not _BENCH_RE.match(b):
        raise LookupError(f"invalid benchmark symbol {v!r}")
    return b


def _opt(a: Dict[str, Any], keys) -> Dict[str, Any]:
    return {k: a[k] for k in keys if a.get(k) is not None}


async def dispatch(executor, name: str, a: Dict[str, Any]):
    """Run one quant tool. Returns (facts, payload) like ToolExecutor._dispatch."""
    from app.services.quant import analyses as qa
    from app.services.quant import backtest as qb

    try:
        if name == "analyze_portfolio_risk":
            raw = list(a.get("tickers") or [])[:10]
            if not raw:
                raise LookupError("tickers is required")
            syms = [await _validate(executor, t) for t in raw]
            kw = _opt(a, ("weights", "years", "tech_shock_pct"))
            res = await asyncio.to_thread(qa.portfolio_risk, syms, **kw)
            ticker, fid = None, "quant:portfolio:" + "-".join(syms)
        else:
            sym = await _validate(executor, a.get("ticker") or "")
            ticker = sym
            if name == "analyze_price_behavior":
                res = await asyncio.to_thread(qa.price_behavior, sym, **_opt(a, ("years", "n_states", "acf_lags")))
                fid = f"quant:behavior:{sym}"
            elif name == "get_risk_metrics":
                b = _bench(a.get("benchmark"))
                res = await asyncio.to_thread(qa.risk_metrics, sym, b,
                                              **_opt(a, ("years", "var_level", "risk_free_rate_pct")))
                fid = f"quant:risk:{sym}:{b}"
            elif name == "earnings_event_study":
                kw = _opt(a, ("n_events", "window_pre", "window_post", "estimation_days"))
                res = await asyncio.to_thread(qa.earnings_event_study, sym, market=_bench(a.get("market")), **kw)
                fid = f"quant:event:{sym}"
            elif name == "backtest_strategy":
                kw = _opt(a, ("preset", "entry", "exit", "parameters", "start_date", "end_date", "years",
                              "commission_bps", "slippage_bps", "oos_split", "stop_loss_pct", "max_hold_bars"))
                res = qa._clean(await asyncio.to_thread(qb.strategy_backtest, sym, **kw))
                tag = a.get("preset") or ("custom-" + hashlib.sha1(json.dumps(
                    [a.get("entry"), a.get("exit")], sort_keys=True, default=str).encode()).hexdigest()[:8]
                    if a.get("entry") else "rsi_reversion")
                fid = f"quant:backtest:{sym}:{tag}"
            else:
                raise LookupError(f"unhandled tool {name}")
    except qa.DataUnavailable as e:
        raise LookupError(f"{name}: data unavailable: {e}") from e
    except ValueError as e:
        raise LookupError(f"{name}: invalid request: {e}") from e

    fact = QuantFact(id=fid, source=_sources(res), as_of=res.get("as_of"), ticker=ticker,
                     analysis=res["analysis"], result=res)
    payload = {"id": fid, **res}
    return [fact], payload
