"""Strategy backtest vs buy-and-hold, through the Strategy Lab engine.

The copilot never simulates trades itself: it builds a ``StrategySpec`` (a
Strategy Lab preset or explicit entry/exit rules), runs it with
``app.services.backtesting.runner.run_strategy`` and runs a buy-and-hold
baseline on the same symbol, dates, costs and data. The engine guarantees:

* decisions at the close of bar t, fills at the OPEN of bar t+1 (no
  look-ahead; indicators are causal and need warm-up bars before the start);
* slippage_bps moves every fill against the trade, commission_bps is charged
  per side on filled notional;
* adjusted (split/dividend) bars, today's unfinished bar dropped;
* an in-sample / out-of-sample split at ``oos_split`` of the bars with the
  SAME parameters in both halves, and a deflated Sharpe probability.
"""
from __future__ import annotations

import copy
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.services.backtesting import limits as L
from app.services.backtesting.rules import PRESETS, StrategySpec
from app.services.backtesting.runner import Robustness, RunRequest, run_strategy
from app.services.quant.data import QuantData, get_provider
from app.services.quant.stats import r

SINGLE_ASSET_PRESETS = [p["id"] for p in PRESETS if p["id"] not in ("momentum_rotation", "buy_and_hold")]
_METRIC_KEYS = ("total_return_pct", "cagr_pct", "volatility_pct", "sharpe", "sortino", "max_drawdown_pct",
                "max_drawdown_date", "calmar", "var_95_daily_pct", "cvar_95_daily_pct", "exposure_pct",
                "exposure_adjusted_cagr_pct", "total_trades", "win_rate_pct", "profit_factor", "avg_bars_held",
                "total_commission", "turnover_annual", "alpha_pct", "beta", "final_equity")


def _now() -> datetime:          # patched in tests
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _pick(m: Dict[str, Any]) -> Dict[str, Any]:
    return {k: m.get(k) for k in _METRIC_KEYS if k in m}


def strategy_backtest(ticker: str, preset: Optional[str] = None, entry: Optional[dict] = None,
                      exit: Optional[dict] = None, parameters: Optional[Dict[str, float]] = None,
                      start_date: Optional[str] = None, end_date: Optional[str] = None, years: float = 10.0,
                      commission_bps: float = 1.0, slippage_bps: float = 5.0, oos_split: float = 0.7,
                      stop_loss_pct: Optional[float] = None, max_hold_bars: Optional[int] = None,
                      risk_free_rate_pct: Optional[float] = None, benchmark: str = "SPY",
                      provider: Optional[QuantData] = None) -> Dict[str, Any]:
    p = provider or get_provider()
    sym = ticker.strip().upper()
    end = datetime.fromisoformat(end_date[:10]) if end_date else _now()
    start = datetime.fromisoformat(start_date[:10]) if start_date else end - timedelta(days=int(years * 365.25))
    assumptions = []
    if entry is None:
        pid = preset or "rsi_reversion"
        if preset is None:
            assumptions.append("no rules given: used the Strategy Lab 'rsi_reversion' preset")
        pre = next((x for x in PRESETS if x["id"] == pid), None)
        if pre is None or pid not in SINGLE_ASSET_PRESETS:
            raise ValueError(f"unknown preset {pid!r}; choose one of {', '.join(SINGLE_ASSET_PRESETS)}")
        base = copy.deepcopy(pre["spec"])
        rules_from = f"Strategy Lab preset '{pid}' ({pre['name']}): {pre['description']}"
    else:
        base = {"entry": entry, "exit": exit, "parameters": {}}
        rules_from = "rules supplied in the request"
    base.pop("param_grid", None)
    params = dict(base.get("parameters") or {})
    params.update(parameters or {})

    rf_note = None
    if risk_free_rate_pct is None:
        rf = p.risk_free(start, end)
        if rf is not None and not rf.series.empty:
            s = rf.series[(rf.series.index >= start) & (rf.series.index <= end)]
            risk_free_rate_pct = round(float((s if len(s) else rf.series).mean()), 3)
            rf_note = f"risk-free = mean {rf.source} over the backtest window = {risk_free_rate_pct}% p.a."
        else:
            risk_free_rate_pct = 0.0
            rf_note = "risk-free series unavailable: Sharpe/Sortino/alpha use rf = 0"
    else:
        rf_note = f"risk-free = {risk_free_rate_pct}% p.a. (supplied)"

    common = dict(symbols=[sym], start_date=start.date().isoformat(), end_date=end.date().isoformat(),
                  benchmark=benchmark, commission_bps=commission_bps, slippage_bps=slippage_bps,
                  risk_free_rate_pct=risk_free_rate_pct, sizing="pct_equity", sizing_value=1.0)
    spec_d = {**{k: v for k, v in base.items() if k not in ("symbols", "parameters")}, **common, "parameters": params}
    if stop_loss_pct is not None:
        spec_d["stop_loss_pct"] = stop_loss_pct
    if max_hold_bars is not None:
        spec_d["max_hold_bars"] = max_hold_bars
    spec = StrategySpec(**spec_d)
    bh = StrategySpec(**common, entry={"logic": "all", "rules": [
        {"left": {"indicator": "close"}, "op": ">", "right": {"value": 0}}]}, exit=None)

    def loader(s, a, b):
        return p.prices(s, a, b)

    deadline = time.monotonic() + L.RUN_TIME_BUDGET_S
    rob = Robustness(oos_split=oos_split, sweep=False, monte_carlo_sims=0)
    res = run_strategy(RunRequest(spec=spec, robustness=rob), deadline=deadline, loader=loader)
    base_res = run_strategy(RunRequest(spec=bh, robustness=rob), deadline=deadline, loader=loader)

    def split(x):
        sp = (x.get("robustness") or {}).get("split") or {}
        return {"split_date": sp.get("split_date"), "in_sample": sp.get("in_sample"),
                "out_of_sample": sp.get("out_of_sample")}

    sm, bm = res["metrics"], base_res["metrics"]
    cmp = {}
    for k in ("total_return_pct", "cagr_pct", "volatility_pct", "sharpe", "sortino", "max_drawdown_pct", "calmar"):
        if sm.get(k) is not None and bm.get(k) is not None:
            cmp[f"{k}_strategy_minus_buy_and_hold"] = r(sm[k] - bm[k], 3)
    so, bo = split(res)["out_of_sample"] or {}, split(base_res)["out_of_sample"] or {}
    for k in ("sharpe", "cagr_pct", "max_drawdown_pct"):
        if so.get(k) is not None and bo.get(k) is not None:
            cmp[f"oos_{k}_strategy_minus_buy_and_hold"] = r(so[k] - bo[k], 3)
    ds = (res.get("robustness") or {}).get("deflated_sharpe")
    trades = res.get("trades") or []
    return {
        "analysis": "strategy_backtest", "ticker": sym, "as_of": res["execution"]["last_bar"],
        "data": res.get("data"),
        "strategy": {"rules_from": rules_from, "entry": res["rules_text"]["entry"], "exit": res["rules_text"]["exit"],
                     "parameters": res["parameters_used"], "stop_loss_pct": spec.stop_loss_pct,
                     "max_hold_bars": spec.max_hold_bars},
        "execution": res["execution"],
        "results": {
            "strategy": _pick(sm), "buy_and_hold": _pick(bm),
            "benchmark": sm.get("benchmark"),
            "out_of_sample_split": {"strategy": split(res), "buy_and_hold": split(base_res)},
            "comparison": cmp,
            "deflated_sharpe": ds,
            "recent_trades": [{k: t.get(k) for k in ("entry_date", "exit_date", "entry_price", "exit_price",
                                                       "return_pct", "bars_held", "exit_reason")} for t in trades[-8:]],
        },
        "method": {
            "engine": "QuantTrade Strategy Lab event-driven daily engine (app.services.backtesting)",
            "no_look_ahead": "signals use data through the close of bar t and fill at the open of bar t+1; "
                             "indicators are causal and warmed up on bars before the start date",
            "costs": f"slippage {slippage_bps} bps per fill against the trade + commission {commission_bps} bps per side",
            "out_of_sample": f"first {int(oos_split * 100)}% of bars in-sample, remainder out-of-sample, same parameters",
            "buy_and_hold": "buy at the first open, hold to the end, same costs and data",
            "deflated_sharpe": "Bailey & Lopez de Prado probability that the Sharpe is above zero after "
                               "non-normality (one trial: no parameter search was run)",
        },
        "assumptions": assumptions + [rules_from, f"window {common['start_date']} to {common['end_date']}",
                                      f"position size 100% of equity when in the market, long only",
                                      rf_note],
        "caveats": [
            "Parameters (thresholds, exit rule, stop) were not optimised here; if they were chosen after seeing "
            "this stock's history, the in-sample figures are optimistic.",
            "A strategy that is out of the market most of the time can show a better drawdown simply from lower "
            "exposure; compare exposure-adjusted CAGR.",
            "Few trades make Sharpe and win-rate estimates unreliable; check total_trades.",
            "Survivorship: the stock is chosen today, knowing it still exists and grew.",
            res.get("disclaimer"),
        ],
        "warnings": list(dict.fromkeys((res.get("warnings") or []) + (base_res.get("warnings") or []))),
    }
