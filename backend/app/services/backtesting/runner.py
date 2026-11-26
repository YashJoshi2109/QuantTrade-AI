"""Run a rule-based strategy spec end to end: data, signals, engine, metrics,
sweep and robustness, Monte Carlo."""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Literal, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from app.services.backtesting import limits as L
from app.services.backtesting.data import PriceSeries, load_prices
from app.services.backtesting.engine import BacktestTimeout, EngineConfig, align_frames, run_engine
from app.services.backtesting.indicators import IndicatorCache
from app.services.backtesting.metrics import (
    calendar_returns, compute_metrics, infer_periods_per_year, series_payload,
)
from app.services.backtesting.montecarlo import block_bootstrap, trade_bootstrap
from app.services.backtesting.robustness import analyse_sweep, deflated_sharpe, split_index
from app.services.backtesting.rules import StrategySpec, build_signals, describe_group, grid_combos, warmup_bars

DISCLAIMER = "Hypothetical results; past performance does not guarantee future results."
MAX_TRADES_RETURNED = 2000


class Cancelled(Exception):
    pass


class Robustness(BaseModel):
    oos_split: Optional[float] = Field(0.7, ge=0.5, le=0.9)
    sweep: bool = True
    walk_forward_folds: Optional[int] = Field(None, ge=2, le=L.MAX_WF_FOLDS)
    walk_forward_mode: Literal["anchored", "rolling"] = "anchored"
    objective: Literal["sharpe", "cagr"] = "sharpe"
    monte_carlo_sims: int = Field(500, ge=0, le=L.MAX_MC_SIMS)
    seed: int = Field(7, ge=0, le=2**31 - 1)


class RunRequest(BaseModel):
    spec: StrategySpec
    robustness: Robustness = Field(default_factory=Robustness)


Progress = Callable[[str, float], None]
Loader = Callable[[str, datetime, datetime], Optional[PriceSeries]]


def _cfg(spec: StrategySpec, ppy: int) -> EngineConfig:
    return EngineConfig(
        initial_capital=spec.initial_capital, commission_bps=spec.commission_bps, slippage_bps=spec.slippage_bps,
        sizing=spec.sizing, sizing_value=spec.sizing_value, vol_lookback=spec.vol_lookback,
        max_position_weight=spec.max_position_weight, max_gross_exposure=spec.max_gross_exposure, side=spec.side,
        stop_loss_pct=spec.stop_loss_pct, take_profit_pct=spec.take_profit_pct,
        trailing_stop_pct=spec.trailing_stop_pct, max_hold_bars=spec.max_hold_bars,
        signal_frequency=spec.signal_frequency, rebalance=spec.rebalance,
        fractional_shares=spec.fractional_shares, borrow_bps_annual=spec.borrow_bps_annual,
        periods_per_year=ppy,
    )


def _slice_metrics(eq: pd.Series, trades, ppy: int, bench: Optional[pd.Series]) -> dict:
    keys = ("total_return_pct", "cagr_pct", "volatility_pct", "sharpe", "sortino", "max_drawdown_pct", "calmar")
    if len(eq) < 3:
        return {}
    m = compute_metrics(eq, float(eq.iloc[0]), trades, benchmark=bench, ppy=ppy)
    out = {k: m.get(k) for k in keys}
    out["total_trades"] = len(trades)
    out["start"] = eq.index[0].date().isoformat()
    out["end"] = eq.index[-1].date().isoformat()
    if m.get("benchmark"):
        out["benchmark_total_return_pct"] = m["benchmark"]["total_return_pct"]
    return out


def run_strategy(
    req: RunRequest,
    progress: Optional[Progress] = None,
    deadline: Optional[float] = None,
    loader: Loader = load_prices,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> dict:
    t0 = time.monotonic()
    spec, rob = req.spec, req.robustness

    def step(stage: str, frac: float):
        if should_cancel and should_cancel():
            raise Cancelled()
        if deadline is not None and time.monotonic() > deadline:
            raise BacktestTimeout("backtest exceeded its time budget")
        if progress:
            progress(stage, frac)

    start = datetime.fromisoformat(spec.start_date[:10])
    end = datetime.fromisoformat(spec.end_date[:10])
    warm = warmup_bars(spec)
    fetch_start = start - timedelta(days=int(warm * L.WARMUP_CALENDAR_FACTOR) + 10)

    warnings: List[str] = []
    frames: Dict[str, pd.DataFrame] = {}
    data_info: Dict[str, dict] = {}
    missing = []
    for k, sym in enumerate(spec.symbols):
        step(f"Loading {sym}", 0.02 + 0.2 * k / len(spec.symbols))
        ps = loader(sym, fetch_start, end)
        if ps is None or ps.df[ps.df.index >= pd.Timestamp(start)].shape[0] < 2:
            missing.append(sym)
            continue
        frames[sym] = ps.df
        warnings.extend(ps.warnings)
        first_trade = ps.df.index[ps.df.index >= pd.Timestamp(start)][0]
        data_info[sym] = {"source": ps.source, "adjusted": ps.adjusted, "first_bar": first_trade.date().isoformat(),
                          "last_bar": ps.df.index[-1].date().isoformat(),
                          "warmup_bars": int((ps.df.index < pd.Timestamp(start)).sum())}
        if (ps.df.index < pd.Timestamp(start)).sum() < warm:
            warnings.append(f"{sym}: only {(ps.df.index < pd.Timestamp(start)).sum()} warm-up bars before the start "
                            f"(rules need {warm}); early signals may be missing")
        if first_trade > pd.Timestamp(start) + pd.Timedelta(days=10):
            warnings.append(f"{sym}: data starts {first_trade.date()} (after the requested start); it cannot trade earlier")
    if missing:
        raise ValueError(f"No price data for: {', '.join(missing)}")

    step(f"Loading benchmark {spec.benchmark}", 0.24)
    bench = None
    bps = loader(spec.benchmark, start, end)
    if bps is not None:
        bench = bps.df["close"]
        bench = bench[bench.index >= pd.Timestamp(start)]
    else:
        warnings.append(f"Benchmark {spec.benchmark} has no data; alpha/beta are unavailable")

    index, arrays = align_frames(frames)
    trade_start = index[index.searchsorted(pd.Timestamp(start))]
    if index.searchsorted(pd.Timestamp(start)) >= len(index) - 20:
        raise ValueError("Fewer than 20 bars in the date range")
    ppy = infer_periods_per_year(index[index >= trade_start])
    cfg = _cfg(spec, ppy)
    cache = IndicatorCache(frames, index)

    combos = grid_combos(spec)
    base = dict(spec.parameters)
    for k, vals in spec.param_grid.items():
        base.setdefault(k, vals[0])

    def one(combo):
        ent, ext = build_signals(spec, combo, cache)
        return run_engine(frames, ent, ext, cfg, trade_start=trade_start, deadline=deadline, index=index, arrays=arrays)

    step("Running strategy", 0.3)
    res = one(base)
    eq = res.equity
    m = compute_metrics(eq, spec.initial_capital, res.trades, res.gross_exposure, res.traded_notional,
                        res.total_commission, bench, ppy=ppy)
    monthly, yearly = calendar_returns(eq, spec.initial_capital)
    rets = eq.pct_change().dropna()

    robustness: dict = {}
    if rob.oos_split:
        cut = split_index(eq.index, rob.oos_split)
        cut_ts = eq.index[cut]
        is_tr = [t for t in res.trades if pd.Timestamp(t.entry_date) < cut_ts]
        oos_tr = [t for t in res.trades if pd.Timestamp(t.entry_date) >= cut_ts]
        robustness["split"] = {
            "split_date": cut_ts.date().isoformat(), "in_sample_fraction": rob.oos_split,
            "in_sample": _slice_metrics(eq.iloc[:cut + 1], is_tr, ppy, bench),
            "out_of_sample": _slice_metrics(eq.iloc[cut:], oos_tr, ppy, bench),
            "note": "Same parameters in both windows. A large drop out of sample suggests the rules fit noise.",
        }

    if rob.sweep and spec.param_grid and len(combos) > 1:
        cols = {}
        summary = []
        for j, combo in enumerate(combos):
            step(f"Parameter sweep {j + 1}/{len(combos)}", 0.35 + 0.45 * j / len(combos))
            r = res if combo == base else one(combo)
            cols[j] = r.equity.pct_change().fillna(0.0)
            mm = compute_metrics(r.equity, spec.initial_capital, r.trades, ppy=ppy)
            summary.append({k: mm.get(k) for k in ("total_return_pct", "cagr_pct", "sharpe", "max_drawdown_pct", "total_trades")})
        step("Overfitting diagnostics", 0.82)
        R = pd.DataFrame(cols)  # same dates as the base equity, so splits line up
        sweep = analyse_sweep(combos, R, ppy, oos_frac=rob.oos_split, wf_folds=rob.walk_forward_folds,
                              wf_mode=rob.walk_forward_mode, objective=rob.objective, initial=spec.initial_capital)
        for row, s in zip(sweep["grid"], summary):
            row.update(s)
        robustness["sweep"] = sweep
    else:
        robustness["sweep"] = None
        robustness["deflated_sharpe"] = deflated_sharpe(rets.to_numpy(), [m.get("sharpe") or 0.0], ppy)
        if rob.walk_forward_folds:
            warnings.append("Walk-forward optimisation needs a parameter grid; only the in/out-of-sample split was run.")

    mc = None
    if rob.monte_carlo_sims:
        step("Monte Carlo", 0.9)
        mc = {"block_bootstrap": block_bootstrap(rets, spec.initial_capital, sims=rob.monte_carlo_sims, seed=rob.seed, ppy=ppy),
              "trade_bootstrap": trade_bootstrap(res.trades, spec.initial_capital, sims=min(rob.monte_carlo_sims, 1000), seed=rob.seed)}

    if len(spec.symbols) > 1:
        warnings.append("Survivorship bias: the universe is chosen today, so delisted or acquired companies are missing.")
    if spec.param_grid and rob.sweep:
        warnings.append(f"The sweep tried {len(combos)} parameter sets. The best one's backtest overstates its likely future "
                        "performance; judge it by the out-of-sample and overfitting figures.")
    if res.ruined:
        warnings.append("Equity reached zero; the run stopped trading.")

    step("Done", 1.0)
    trades = [t.to_dict() for t in res.trades]
    return {
        "disclaimer": DISCLAIMER,
        "spec": spec.model_dump(),
        "parameters_used": base,
        "rules_text": {"entry": describe_group(spec.entry, base), "exit": describe_group(spec.exit, base)},
        "execution": {
            "fills": "next_bar_open", "decisions": "bar_close", "signal_frequency": spec.signal_frequency,
            "rebalance": spec.rebalance, "commission_bps": spec.commission_bps, "slippage_bps": spec.slippage_bps,
            "first_bar": eq.index[0].date().isoformat(), "last_bar": eq.index[-1].date().isoformat(),
            "warmup_bars_required": warm, "periods_per_year": ppy,
        },
        "data": data_info,
        "metrics": m,
        "series": series_payload(eq, spec.initial_capital, bench),
        "monthly_returns": monthly,
        "yearly_returns": yearly,
        "trades": trades[:MAX_TRADES_RETURNED],
        "trades_truncated": len(trades) > MAX_TRADES_RETURNED,
        "open_positions": res.open_positions,
        "robustness": robustness,
        "monte_carlo": mc,
        "warnings": warnings,
        "elapsed_s": round(time.monotonic() - t0, 3),
    }
