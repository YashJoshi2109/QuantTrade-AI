"""
Named-strategy backtests (the original ``/api/v1/backtest`` contract).

The eight named strategies below produce BUY/SELL/HOLD signals from data up to
each bar's close. Execution, costs, metrics and Monte Carlo now run on the
audited engine in ``app.services.backtesting`` (next-bar-open fills, gap-aware
stops, one commission per side, calendar-time CAGR, date-aligned benchmark,
non-degenerate Monte Carlo). See docs/BACKTESTING.md for the audit of the
engine this file used to contain.

The response keeps the field names the existing UI reads (``total_return``,
``sharpe_ratio``, ``equity_curve`` ...); ``metrics_v2`` carries the full,
precisely named metric set.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from app.services.backtesting.engine import EngineConfig, run_engine
from app.services.backtesting.metrics import (
    calendar_returns,
    compute_metrics,
    downsample_index,
    drawdown_stats,
    infer_periods_per_year,
)
from app.services.backtesting.montecarlo import block_bootstrap, trade_bootstrap


STRATEGY_REGISTRY: Dict[str, dict] = {}


def register_strategy(name: str, description: str, category: str, params: dict):
    """Decorator to register a strategy function."""
    def decorator(func):
        STRATEGY_REGISTRY[name] = {
            "func": func,
            "description": description,
            "category": category,
            "default_params": params,
        }
        return func
    return decorator


# ── Strategies ──────────────────────────────────────────────────────────

@register_strategy(
    "rsi_ma_crossover",
    "Buy when RSI recovers from oversold or dips near oversold in uptrend; sell when overbought.",
    "Momentum",
    {"rsi_period": 14, "rsi_oversold": 40, "rsi_overbought": 70, "fast_ma": 20, "slow_ma": 50},
)
def strategy_rsi_ma_crossover(df: pd.DataFrame, params: dict) -> pd.Series:
    rsi_period = params.get("rsi_period", 14)
    rsi_oversold = params.get("rsi_oversold", 40)
    rsi_overbought = params.get("rsi_overbought", 70)
    fast_ma = params.get("fast_ma", 20)
    slow_ma = params.get("slow_ma", 50)

    rsi = _compute_rsi(df, rsi_period)
    sma_fast = df["close"].rolling(fast_ma).mean()
    sma_slow = df["close"].rolling(slow_ma).mean()

    # Entry 1: RSI crosses back up through oversold threshold (recovery signal)
    rsi_recovering = (rsi > rsi_oversold) & (rsi.shift(1) <= rsi_oversold)
    # Entry 2: RSI dips into oversold zone while price still above fast MA
    rsi_dip_buy = (rsi < rsi_oversold) & (df["close"] > sma_fast)
    # Entry 3: RSI near oversold (within 5 pts) while in long-term uptrend (above slow MA)
    rsi_near_buy = (rsi < rsi_oversold + 5) & (df["close"] > sma_slow)

    signals = pd.Series("HOLD", index=df.index)
    signals[rsi_recovering | rsi_dip_buy | rsi_near_buy] = "BUY"
    signals[(rsi > rsi_overbought)] = "SELL"
    return signals


@register_strategy(
    "ma_crossover",
    "Buy when fast MA crosses above slow MA; sell on crossover down.",
    "Trend",
    {"fast_ma": 20, "slow_ma": 50},
)
def strategy_ma_crossover(df: pd.DataFrame, params: dict) -> pd.Series:
    fast = df["close"].rolling(params.get("fast_ma", 20)).mean()
    slow = df["close"].rolling(params.get("slow_ma", 50)).mean()

    signals = pd.Series("HOLD", index=df.index)
    # Cross above
    signals[(fast > slow) & (fast.shift(1) <= slow.shift(1))] = "BUY"
    # Cross below
    signals[(fast < slow) & (fast.shift(1) >= slow.shift(1))] = "SELL"
    return signals


@register_strategy(
    "bollinger_breakout",
    "Buy on lower-band touch with RSI confirmation; sell on upper-band touch.",
    "Mean Reversion",
    {"bb_period": 20, "bb_std": 2.0, "rsi_period": 14},
)
def strategy_bollinger_breakout(df: pd.DataFrame, params: dict) -> pd.Series:
    period = params.get("bb_period", 20)
    std_mult = params.get("bb_std", 2.0)
    rsi_period = params.get("rsi_period", 14)

    mid = df["close"].rolling(period).mean()
    std = df["close"].rolling(period).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    rsi = _compute_rsi(df, rsi_period)

    signals = pd.Series("HOLD", index=df.index)
    signals[(df["close"] <= lower) & (rsi < 40)] = "BUY"
    signals[(df["close"] >= upper) | (rsi > 75)] = "SELL"
    return signals


@register_strategy(
    "macd_cross",
    "Buy on MACD line crossing above signal; sell on cross below.",
    "Momentum",
    {"fast_period": 12, "slow_period": 26, "signal_period": 9},
)
def strategy_macd_cross(df: pd.DataFrame, params: dict) -> pd.Series:
    fast_p = params.get("fast_period", 12)
    slow_p = params.get("slow_period", 26)
    signal_p = params.get("signal_period", 9)

    ema_fast = df["close"].ewm(span=fast_p, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow_p, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_p, adjust=False).mean()

    signals = pd.Series("HOLD", index=df.index)
    signals[(macd_line > signal_line) & (macd_line.shift(1) <= signal_line.shift(1))] = "BUY"
    signals[(macd_line < signal_line) & (macd_line.shift(1) >= signal_line.shift(1))] = "SELL"
    return signals


@register_strategy(
    "mean_reversion",
    "Buy when z-score of price drops below threshold; sell when it reverts above.",
    "Mean Reversion",
    {"lookback": 20, "entry_z": -2.0, "exit_z": 0.0},
)
def strategy_mean_reversion(df: pd.DataFrame, params: dict) -> pd.Series:
    lookback = params.get("lookback", 20)
    entry_z = params.get("entry_z", -2.0)
    exit_z = params.get("exit_z", 0.0)

    rolling_mean = df["close"].rolling(lookback).mean()
    rolling_std = df["close"].rolling(lookback).std()
    z_score = (df["close"] - rolling_mean) / rolling_std.replace(0, np.nan)

    signals = pd.Series("HOLD", index=df.index)
    signals[z_score < entry_z] = "BUY"
    signals[z_score > exit_z] = "SELL"
    return signals


@register_strategy(
    "momentum_roc",
    "Buy when rate of change exceeds threshold; sell when it drops below.",
    "Momentum",
    {"roc_period": 12, "entry_threshold": 5.0, "exit_threshold": -2.0},
)
def strategy_momentum_roc(df: pd.DataFrame, params: dict) -> pd.Series:
    period = params.get("roc_period", 12)
    entry_t = params.get("entry_threshold", 5.0)
    exit_t = params.get("exit_threshold", -2.0)

    roc = ((df["close"] - df["close"].shift(period)) / df["close"].shift(period)) * 100

    signals = pd.Series("HOLD", index=df.index)
    signals[roc > entry_t] = "BUY"
    signals[roc < exit_t] = "SELL"
    return signals


@register_strategy(
    "volume_weighted_trend",
    "Buy when VWAP trend is bullish with volume confirmation; sell on reversal.",
    "Volume",
    {"vwap_period": 20, "vol_mult": 1.5, "ma_period": 10},
)
def strategy_volume_weighted_trend(df: pd.DataFrame, params: dict) -> pd.Series:
    vwap_period = params.get("vwap_period", 20)
    vol_mult = params.get("vol_mult", 1.5)
    ma_period = params.get("ma_period", 10)

    typical_price = (df["high"] + df["low"] + df["close"]) / 3
    vol = df.get("volume", pd.Series(1, index=df.index))
    vwap = (typical_price * vol).rolling(vwap_period).sum() / vol.rolling(vwap_period).sum().replace(0, 1)
    avg_vol = vol.rolling(vwap_period).mean()
    price_ma = df["close"].rolling(ma_period).mean()

    signals = pd.Series("HOLD", index=df.index)
    signals[(df["close"] > vwap) & (vol > avg_vol * vol_mult) & (df["close"] > price_ma)] = "BUY"
    signals[(df["close"] < vwap) & (df["close"] < price_ma)] = "SELL"
    return signals


@register_strategy(
    "multi_indicator",
    "Composite score from RSI, MACD, Bollinger, and MA. Buy when 3+ indicators agree.",
    "Multi-Factor",
    {"rsi_period": 14, "fast_ma": 20, "slow_ma": 50, "bb_period": 20, "bb_std": 2.0,
     "macd_fast": 12, "macd_slow": 26, "macd_signal": 9, "min_score": 3},
)
def strategy_multi_indicator(df: pd.DataFrame, params: dict) -> pd.Series:
    min_score = params.get("min_score", 3)

    # RSI
    rsi = _compute_rsi(df, params.get("rsi_period", 14))
    # MA
    fast_ma = df["close"].rolling(params.get("fast_ma", 20)).mean()
    slow_ma = df["close"].rolling(params.get("slow_ma", 50)).mean()
    # Bollinger
    bb_mid = df["close"].rolling(params.get("bb_period", 20)).mean()
    bb_std = df["close"].rolling(params.get("bb_period", 20)).std()
    bb_lower = bb_mid - params.get("bb_std", 2.0) * bb_std
    bb_upper = bb_mid + params.get("bb_std", 2.0) * bb_std
    # MACD
    ema_f = df["close"].ewm(span=params.get("macd_fast", 12), adjust=False).mean()
    ema_s = df["close"].ewm(span=params.get("macd_slow", 26), adjust=False).mean()
    macd = ema_f - ema_s
    macd_sig = macd.ewm(span=params.get("macd_signal", 9), adjust=False).mean()

    buy_score = pd.Series(0, index=df.index, dtype=int)
    sell_score = pd.Series(0, index=df.index, dtype=int)

    # RSI signals
    buy_score += (rsi < 35).astype(int)
    sell_score += (rsi > 65).astype(int)
    # MA crossover
    buy_score += (fast_ma > slow_ma).astype(int)
    sell_score += (fast_ma < slow_ma).astype(int)
    # Bollinger
    buy_score += (df["close"] < bb_lower).astype(int)
    sell_score += (df["close"] > bb_upper).astype(int)
    # MACD
    buy_score += (macd > macd_sig).astype(int)
    sell_score += (macd < macd_sig).astype(int)

    signals = pd.Series("HOLD", index=df.index)
    signals[buy_score >= min_score] = "BUY"
    signals[sell_score >= min_score] = "SELL"
    return signals


# ── Helper: RSI computation (standalone, no IndicatorService dependency) ─

def _compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


# ── Execution on the audited engine ─────────────────────────────────────

SIZING_MAP = {
    # legacy name -> (engine sizing, value)
    "fixed": ("pct_equity", 1.0),
    "kelly": ("pct_equity", 0.25),  # Kelly from in-sample trade stats is not offered; 25% of equity
    "volatility": ("vol_target", 0.15),
}


def max_lookback(params: dict) -> int:
    """Longest integer window in a strategy's params (for warm-up)."""
    best = 1
    for v in (params or {}).values():
        if isinstance(v, (int, np.integer)) and not isinstance(v, bool):
            best = max(best, int(v))
    return best


def _f(v, n=2, default=0.0):
    if v is None:
        return default
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if math.isnan(x) or math.isinf(x):
        return default
    return round(x, n)


def _legacy_mc(daily_returns: pd.Series, trades, initial: float, sims: int, ppy: int) -> Optional[dict]:
    bb = block_bootstrap(daily_returns, initial, sims=sims, ppy=ppy)
    if bb is None:
        return None
    fr = bb["final_return_pct"]
    n = bb["simulations"]
    total = sum(b["count"] for b in bb["distribution"]) or 1
    return {
        "method": bb["method"],
        "median_return": fr["p50"], "mean_return": fr["p50"],
        "p5_return": fr["p5"], "p25_return": fr["p25"], "p75_return": fr["p75"], "p95_return": fr["p95"],
        "probability_of_profit": round(100 - bb["probability_of_loss_pct"], 1),
        "probability_of_ruin": bb["probability_drawdown_over_50_pct"],
        "max_seen_drawdown": abs(bb["max_drawdown_pct"]["p5"]),
        "avg_max_drawdown": abs(bb["max_drawdown_pct"]["p50"]),
        "distribution": [{**b, "frequency": round(b["count"] / total * 100, 1)} for b in bb["distribution"]],
        "n_simulations": n,
        "bands": bb["bands"],
        "trade_bootstrap": trade_bootstrap(trades, initial, sims=min(sims, 1000)),
    }


def _legacy_payload(res, initial: float, benchmark: Optional[pd.Series], ppy: int) -> dict:
    eq = res.equity
    m = compute_metrics(eq, initial, res.trades, res.gross_exposure, res.traded_notional,
                        res.total_commission, benchmark, ppy=ppy)
    rets = eq.pct_change().dropna()
    dd = drawdown_stats(eq)["drawdown"]
    keep = downsample_index(len(eq), 300)
    monthly, yearly = calendar_returns(eq, initial)
    trades = res.trades
    pnls = [t.pnl for t in trades]
    win_streak = loss_streak = mw = ml = 0
    for p in pnls:
        if p > 0:
            win_streak, loss_streak = win_streak + 1, 0
        else:
            win_streak, loss_streak = 0, loss_streak + 1
        mw, ml = max(mw, win_streak), max(ml, loss_streak)
    r = rets.to_numpy()
    rolling = []
    if len(r) > 63:
        s = pd.Series(r)
        rs = s.rolling(63).mean() / s.rolling(63).std() * math.sqrt(ppy)
        rolling = [_f(v) for v in rs.dropna().to_numpy()[:: max(1, len(rs) // 300)]]
    trade_rets = [t.return_pct for t in trades]
    dist = []
    if trade_rets:
        counts, edges = np.histogram(trade_rets, bins=20)
        dist = [{"range_start": round(float(edges[i]), 1), "range_end": round(float(edges[i + 1]), 1),
                 "count": int(counts[i])} for i in range(20)]
    bench_sampled: List[float] = []
    if benchmark is not None and len(benchmark):
        b = benchmark.reindex(eq.index).ffill()
        fv = b.first_valid_index()
        if fv is not None:
            b = b / b.loc[fv] * initial
            bench_sampled = [_f(b.iloc[k]) if pd.notna(b.iloc[k]) else None for k in keep]
    pf = m.get("profit_factor")
    if pf is None:
        pf = 999.99 if any(p > 0 for p in pnls) else 0.0
    return {
        "initial_capital": initial,
        "final_equity": _f(m["final_equity"]),
        "total_return": _f(m["total_return_pct"]),
        "cagr": _f(m["cagr_pct"]),
        "annualized_return": _f(m["cagr_pct"]),
        "annualized_volatility": _f(m["volatility_pct"]),
        "sharpe_ratio": _f(m["sharpe"]),
        "sortino_ratio": _f(m["sortino"]),
        "calmar_ratio": _f(m["calmar"]),
        "max_drawdown": _f(abs(m["max_drawdown_pct"] or 0)),
        "max_drawdown_duration": m["max_drawdown_duration_bars"],
        "var_95": _f(np.percentile(r, 5) * 100 if len(r) > 10 else 0),
        "var_99": _f(np.percentile(r, 1) * 100 if len(r) > 10 else 0),
        "ulcer_index": _f(math.sqrt(float(np.mean(dd.to_numpy() ** 2))) * 100 if len(dd) else 0),
        "total_trades": m["total_trades"],
        "win_rate": _f(m["win_rate_pct"]),
        "profit_factor": _f(pf),
        "avg_win": _f(m["avg_win"]),
        "avg_loss": _f(abs(m["avg_loss"] or 0)),
        "expectancy": _f(m["expectancy"]),
        "avg_trade_duration": _f(m["avg_bars_held"], 1),
        "total_commission": _f(res.total_commission),
        "max_win_streak": mw,
        "max_loss_streak": ml,
        "equity_curve": [_f(eq.iloc[k]) for k in keep],
        "equity_curve_raw": [_f(v) for v in eq.to_numpy()],
        "equity_dates": [eq.index[k].date().isoformat() for k in keep],
        "drawdown_curve": [_f(dd.iloc[k] * 100) for k in keep],
        "benchmark_equity": bench_sampled,
        "monthly_returns": [{"month": x["year"] * 100 + x["month"], "return_pct": _f(x["return_pct"])} for x in monthly],
        "yearly_returns": yearly,
        "rolling_sharpe": rolling,
        "trade_distribution": dist,
        "mae_mfe": [{"return_pct": _f(t.return_pct), "mae": _f(t.mae), "mfe": _f(t.mfe)} for t in trades],
        "trades": [t.to_dict() for t in trades],
        "beta": _f(m.get("beta"), 3),
        "alpha": _f(m.get("alpha_pct")),
        "metrics_v2": m,
    }


class BacktestEngine:
    """Runs a named strategy on one symbol."""

    def __init__(self):
        self.trades = []
        self.last_result = None

    def run_backtest_from_df(
        self,
        df: pd.DataFrame,
        strategy_name: str = "rsi_ma_crossover",
        strategy_params: Optional[dict] = None,
        initial_capital: float = 10000.0,
        position_sizing: str = "fixed",
        commission_rate: float = 0.001,
        slippage_rate: float = 0.0005,
        stop_loss_pct: Optional[float] = None,
        take_profit_pct: Optional[float] = None,
        trailing_stop_pct: Optional[float] = None,
        max_pyramiding: int = 1,
        walk_forward: bool = False,
        walk_forward_train_pct: float = 0.7,
        monte_carlo: bool = True,
        monte_carlo_sims: int = 1000,
        trade_start: Optional[pd.Timestamp] = None,
        benchmark: Optional[pd.Series] = None,
        deadline: Optional[float] = None,
        symbol: str = "ASSET",
    ) -> Dict:
        """Backtest ``strategy_name`` on ``df`` (OHLCV, adjusted).

        Bars before ``trade_start`` only warm up indicators. Signals are taken
        at each close and filled at the next bar's open.
        """
        if strategy_name not in STRATEGY_REGISTRY:
            return {"error": f"Unknown strategy: {strategy_name}. Available: {list(STRATEGY_REGISTRY.keys())}"}
        info = STRATEGY_REGISTRY[strategy_name]
        params = {**info["default_params"], **(strategy_params or {})}
        for col in ("open", "high", "low", "close"):
            if col not in df.columns:
                return {"error": f"Missing required column: {col}"}
        df = df.copy()
        if "volume" not in df.columns:
            df["volume"] = 0.0
        ts = pd.Timestamp(trade_start) if trade_start is not None else df.index[0]
        window = df[df.index >= ts]
        if len(window) < 20:
            return {"error": "Insufficient data (need at least 20 bars)"}

        signals = info["func"](df, params).reindex(df.index).fillna("HOLD")
        S = symbol.upper()
        entries = {S: (signals == "BUY").to_numpy()}
        exits = {S: (signals == "SELL").to_numpy()}
        sizing, value = SIZING_MAP.get(position_sizing, SIZING_MAP["fixed"])
        ppy = infer_periods_per_year(df.index)
        cfg = EngineConfig(
            initial_capital=float(initial_capital), commission_bps=commission_rate * 1e4,
            slippage_bps=slippage_rate * 1e4, sizing=sizing, sizing_value=value,
            stop_loss_pct=stop_loss_pct or None, take_profit_pct=take_profit_pct or None,
            trailing_stop_pct=trailing_stop_pct or None, periods_per_year=ppy,
        )
        frames = {S: df}

        wf_info: dict = {"enabled": False}
        if walk_forward and len(window) > 60:
            split_ts = window.index[int(len(window) * walk_forward_train_pct)]
            is_df = df[df.index < split_ts]
            is_res = run_engine({S: is_df}, {S: entries[S][: len(is_df)]}, {S: exits[S][: len(is_df)]},
                                cfg, trade_start=ts, deadline=deadline)
            res = run_engine(frames, entries, exits, cfg, trade_start=split_ts, deadline=deadline)
            is_m = compute_metrics(is_res.equity, cfg.initial_capital, is_res.trades, is_res.gross_exposure,
                                   is_res.traded_notional, is_res.total_commission, benchmark, ppy=ppy)
            oos_m = compute_metrics(res.equity, cfg.initial_capital, res.trades, res.gross_exposure,
                                    res.traded_notional, res.total_commission, benchmark, ppy=ppy)
            keys = ("total_return_pct", "cagr_pct", "sharpe", "sortino", "max_drawdown_pct", "total_trades", "win_rate_pct")
            wf_info = {
                "enabled": True, "train_bars": int(len(is_res.equity)), "test_bars": int(len(res.equity)),
                "train_pct": walk_forward_train_pct, "split_date": split_ts.date().isoformat(),
                "in_sample": {k: is_m.get(k) for k in keys}, "out_of_sample": {k: oos_m.get(k) for k in keys},
                "note": "Same parameters in both windows; the out-of-sample window keeps the indicator warm-up "
                        "from earlier bars but starts flat with fresh capital.",
            }
        else:
            res = run_engine(frames, entries, exits, cfg, trade_start=ts, deadline=deadline)

        self.trades = res.trades
        self.last_result = res
        out = _legacy_payload(res, cfg.initial_capital, benchmark, ppy)
        out["walk_forward"] = wf_info
        out["monte_carlo"] = (
            _legacy_mc(res.equity.pct_change().dropna(), res.trades, cfg.initial_capital,
                       int(monte_carlo_sims), ppy)
            if monte_carlo and len(res.trades) >= 3 else None
        )
        out["strategy"] = strategy_name
        out["strategy_params"] = params
        out["commission_rate"] = commission_rate
        out["slippage_rate"] = slippage_rate
        out["execution"] = {
            "fills": "next_bar_open", "commission_bps_per_side": cfg.commission_bps,
            "slippage_bps_per_side": cfg.slippage_bps, "sizing": sizing, "sizing_value": value,
            "first_bar": res.equity.index[0].date().isoformat(), "last_bar": res.equity.index[-1].date().isoformat(),
        }
        if max_pyramiding and max_pyramiding > 1:
            out.setdefault("warnings", []).append("Pyramiding is not supported; one position at a time.")
        if position_sizing == "kelly":
            out.setdefault("warnings", []).append("Kelly sizing is replaced by a fixed 25% of equity.")
        return out


# ── Legacy compatibility aliases ────────────────────────────────────────

def rsi_ma_crossover_strategy(current_bar, prev_bar, position):
    """Legacy wrapper kept for backward compatibility."""
    if current_bar["rsi"] < 30 and current_bar["close"] > current_bar["sma_20"]:
        return "BUY"
    elif position and (current_bar["rsi"] > 70 or current_bar["close"] < current_bar["sma_20"]):
        return "SELL"
    return "HOLD"


def ma_crossover_strategy(current_bar, prev_bar, position):
    """Legacy wrapper kept for backward compatibility."""
    if prev_bar["sma_20"] <= prev_bar["sma_50"] and current_bar["sma_20"] > current_bar["sma_50"]:
        return "BUY"
    elif position and prev_bar["sma_20"] >= prev_bar["sma_50"] and current_bar["sma_20"] < current_bar["sma_50"]:
        return "SELL"
    return "HOLD"
