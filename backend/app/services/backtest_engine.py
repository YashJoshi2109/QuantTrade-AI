"""
Pro-level Backtesting Engine for QuantTrade-AI
Supports 8 strategies, walk-forward optimization, position sizing,
stop-loss/take-profit, commission modeling, Monte Carlo validation,
and comprehensive performance metrics.
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from enum import Enum
from app.models.price import PriceBar
from app.models.symbol import Symbol
from sqlalchemy.orm import Session
from app.services.indicators import IndicatorService
import random
import math


# ── Enums & Config ──────────────────────────────────────────────────────

class PositionSizing(str, Enum):
    FIXED = "fixed"
    KELLY = "kelly"
    VOLATILITY = "volatility"


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


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


# ── Trade Dataclass ─────────────────────────────────────────────────────

@dataclass
class Trade:
    entry_date: datetime
    entry_price: float
    quantity: float
    direction: str = "LONG"
    exit_date: Optional[datetime] = None
    exit_price: Optional[float] = None
    pnl: Optional[float] = None
    return_pct: Optional[float] = None
    commission_paid: float = 0.0
    slippage_cost: float = 0.0
    exit_reason: str = ""
    bars_held: int = 0
    mae: float = 0.0  # Maximum Adverse Excursion (worst unrealized loss %)
    mfe: float = 0.0  # Maximum Favorable Excursion (best unrealized gain %)

    def close(self, exit_date: datetime, exit_price: float, commission: float = 0.0,
              slippage: float = 0.0, reason: str = "signal"):
        self.exit_date = exit_date
        self.exit_price = exit_price
        self.commission_paid += commission
        self.slippage_cost += slippage
        gross_pnl = (exit_price - self.entry_price) * self.quantity
        self.pnl = gross_pnl - self.commission_paid - self.slippage_cost
        self.return_pct = ((exit_price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        self.exit_reason = reason

    def to_dict(self) -> dict:
        def _safe_date(d):
            if d is None:
                return None
            if hasattr(d, 'isoformat'):
                return d.isoformat()
            return str(d)

        def _safe_round(v, n=2):
            if v is None:
                return None
            try:
                return round(float(v), n)
            except (TypeError, ValueError):
                return None

        return {
            "entry_date": _safe_date(self.entry_date),
            "exit_date": _safe_date(self.exit_date),
            "entry_price": _safe_round(self.entry_price),
            "exit_price": _safe_round(self.exit_price),
            "quantity": _safe_round(self.quantity, 4),
            "pnl": _safe_round(self.pnl),
            "return_pct": _safe_round(self.return_pct),
            "commission": _safe_round(self.commission_paid),
            "exit_reason": self.exit_reason,
            "bars_held": self.bars_held,
            "mae": _safe_round(self.mae),
            "mfe": _safe_round(self.mfe),
        }


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


# ── Position Sizing ─────────────────────────────────────────────────────

def calculate_position_size(
    method: PositionSizing,
    capital: float,
    price: float,
    win_rate: float = 0.5,
    avg_win: float = 1.0,
    avg_loss: float = 1.0,
    volatility: float = 0.02,
    risk_per_trade: float = 0.02,
) -> float:
    """Return number of shares to buy."""
    if method == PositionSizing.FIXED:
        return int(capital * 0.95 / price) if price > 0 else 0

    elif method == PositionSizing.KELLY:
        if avg_loss == 0:
            return int(capital * 0.25 / price) if price > 0 else 0
        b = avg_win / avg_loss
        kelly_pct = (win_rate * b - (1 - win_rate)) / b if b > 0 else 0
        kelly_pct = max(0, min(kelly_pct * 0.5, 0.25))  # Half-Kelly, capped at 25%
        return int(capital * kelly_pct / price) if price > 0 else 0

    elif method == PositionSizing.VOLATILITY:
        if volatility <= 0 or price <= 0:
            return int(capital * 0.1 / price) if price > 0 else 0
        dollar_risk = capital * risk_per_trade
        shares = int(dollar_risk / (price * volatility))
        max_shares = int(capital * 0.25 / price)
        return min(shares, max_shares)

    return int(capital * 0.95 / price) if price > 0 else 0


# ── Metrics Calculator ──────────────────────────────────────────────────

class MetricsCalculator:
    """Compute comprehensive backtest metrics."""

    @staticmethod
    def compute(
        equity_curve: List[float],
        trades: List[Trade],
        initial_capital: float,
        risk_free_rate: float = 0.04,
    ) -> dict:
        if not equity_curve or len(equity_curve) < 2:
            return MetricsCalculator._empty_metrics(initial_capital)

        eq = np.array(equity_curve, dtype=float)
        daily_returns = np.diff(eq) / eq[:-1]
        daily_returns = daily_returns[np.isfinite(daily_returns)]

        final_equity = eq[-1]
        total_return = (final_equity - initial_capital) / initial_capital * 100
        trading_days = len(eq) - 1

        # Annualized return
        years = trading_days / 252 if trading_days > 0 else 1
        ann_return = ((final_equity / initial_capital) ** (1 / years) - 1) * 100 if years > 0 else 0

        # Volatility
        ann_vol = float(np.std(daily_returns) * np.sqrt(252) * 100) if len(daily_returns) > 1 else 0

        # Sharpe
        excess = daily_returns - risk_free_rate / 252
        std_excess = float(np.std(excess))
        sharpe = float(np.mean(excess) / std_excess * np.sqrt(252)) if std_excess > 1e-10 else 0

        # Sortino
        downside = daily_returns[daily_returns < 0]
        downside_std = float(np.std(downside)) if len(downside) > 1 else 0
        sortino = float(np.mean(excess) / downside_std * np.sqrt(252)) if downside_std > 0 else 0

        # Max Drawdown
        peak = np.maximum.accumulate(eq)
        dd = (eq - peak) / peak
        max_dd = float(abs(np.min(dd)) * 100)

        # Drawdown duration
        dd_duration = 0
        current_dd_len = 0
        for i in range(len(dd)):
            if dd[i] < 0:
                current_dd_len += 1
                dd_duration = max(dd_duration, current_dd_len)
            else:
                current_dd_len = 0

        # Calmar
        calmar = ann_return / max_dd if max_dd > 0 else 0

        # Trade stats
        closed_trades = [t for t in trades if t.pnl is not None]
        n_trades = len(closed_trades)
        winners = [t for t in closed_trades if t.pnl > 0]
        losers = [t for t in closed_trades if t.pnl <= 0]
        win_rate = len(winners) / n_trades * 100 if n_trades > 0 else 0

        gross_profit = sum(t.pnl for t in winners) if winners else 0
        gross_loss = abs(sum(t.pnl for t in losers)) if losers else 0
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf") if gross_profit > 0 else 0

        avg_win = np.mean([t.pnl for t in winners]) if winners else 0
        avg_loss = np.mean([abs(t.pnl) for t in losers]) if losers else 0
        expectancy = (win_rate / 100 * avg_win - (1 - win_rate / 100) * avg_loss) if n_trades > 0 else 0

        avg_bars = np.mean([t.bars_held for t in closed_trades]) if closed_trades else 0
        total_commission = sum(t.commission_paid for t in closed_trades)

        # Monthly returns
        monthly_returns = MetricsCalculator._monthly_returns(eq, trading_days)

        # Rolling Sharpe (63-day ~ 3 months)
        rolling_sharpe = []
        window = min(63, len(daily_returns))
        if window > 5:
            for i in range(window, len(daily_returns) + 1):
                chunk = daily_returns[i - window:i]
                rs = float(np.mean(chunk) / np.std(chunk) * np.sqrt(252)) if np.std(chunk) > 0 else 0
                rolling_sharpe.append(round(rs, 2))

        # Drawdown series (sampled for chart)
        dd_series = (dd * 100).tolist()
        sample_step = max(1, len(dd_series) // 200)
        dd_sampled = [round(dd_series[i], 2) for i in range(0, len(dd_series), sample_step)]

        # Sample equity curve for transfer
        eq_step = max(1, len(equity_curve) // 300)
        eq_sampled = [round(equity_curve[i], 2) for i in range(0, len(equity_curve), eq_step)]
        if eq_sampled[-1] != round(equity_curve[-1], 2):
            eq_sampled.append(round(equity_curve[-1], 2))

        def _safe(v, decimals=2):
            """Sanitize NaN/Inf for JSON."""
            if v is None:
                return 0
            f = float(v)
            if math.isnan(f) or math.isinf(f):
                return 0
            return round(f, decimals)

        # VaR (Value at Risk)
        var_95 = float(np.percentile(daily_returns, 5) * 100) if len(daily_returns) > 10 else 0
        var_99 = float(np.percentile(daily_returns, 1) * 100) if len(daily_returns) > 10 else 0

        # Ulcer Index (root mean square of drawdowns)
        dd_squared = dd ** 2
        ulcer_index = float(np.sqrt(np.mean(dd_squared)) * 100) if len(dd) > 0 else 0

        # CAGR
        cagr = ann_return  # Already calculated as annualized return

        # Trade distribution histogram (20 buckets of return_pct)
        trade_returns = [t.return_pct for t in closed_trades if t.return_pct is not None]
        trade_distribution = []
        if trade_returns:
            t_min, t_max = min(trade_returns), max(trade_returns)
            n_bins = 20
            bin_size = (t_max - t_min) / n_bins if t_max != t_min else 1
            for b in range(n_bins):
                lo = t_min + b * bin_size
                hi = lo + bin_size
                count = len([r for r in trade_returns if lo <= r < hi])
                trade_distribution.append({
                    "range_start": round(lo, 1),
                    "range_end": round(hi, 1),
                    "count": count,
                })

        # MAE/MFE scatter data
        mae_mfe_data = []
        for t in closed_trades:
            mae_mfe_data.append({
                "return_pct": round(t.return_pct, 2) if t.return_pct else 0,
                "mae": round(t.mae, 2),
                "mfe": round(t.mfe, 2),
            })

        # Longest win/loss streak
        win_streak = loss_streak = max_win_streak = max_loss_streak = 0
        for t in closed_trades:
            if t.pnl and t.pnl > 0:
                win_streak += 1
                loss_streak = 0
                max_win_streak = max(max_win_streak, win_streak)
            else:
                loss_streak += 1
                win_streak = 0
                max_loss_streak = max(max_loss_streak, loss_streak)

        return {
            "initial_capital": initial_capital,
            "final_equity": _safe(final_equity),
            "total_return": _safe(total_return),
            "cagr": _safe(cagr),
            "annualized_return": _safe(ann_return),
            "annualized_volatility": _safe(ann_vol),
            "sharpe_ratio": _safe(sharpe),
            "sortino_ratio": _safe(sortino),
            "calmar_ratio": _safe(calmar),
            "max_drawdown": _safe(max_dd),
            "max_drawdown_duration": dd_duration,
            "var_95": _safe(var_95),
            "var_99": _safe(var_99),
            "ulcer_index": _safe(ulcer_index),
            "total_trades": n_trades,
            "win_rate": _safe(win_rate),
            "profit_factor": _safe(profit_factor) if profit_factor != float("inf") else 999.99,
            "avg_win": _safe(avg_win),
            "avg_loss": _safe(avg_loss),
            "expectancy": _safe(expectancy),
            "avg_trade_duration": _safe(avg_bars, 1),
            "total_commission": _safe(total_commission),
            "max_win_streak": max_win_streak,
            "max_loss_streak": max_loss_streak,
            "equity_curve": [_safe(v) for v in eq_sampled],
            "equity_curve_raw": [_safe(v) for v in equity_curve],
            "drawdown_curve": [_safe(v) for v in dd_sampled],
            "monthly_returns": monthly_returns,
            "rolling_sharpe": [_safe(v) for v in rolling_sharpe],
            "trade_distribution": trade_distribution,
            "mae_mfe": mae_mfe_data,
        }

    @staticmethod
    def _monthly_returns(eq: np.ndarray, trading_days: int) -> List[dict]:
        """Approximate monthly returns from equity curve."""
        if trading_days < 22:
            return []
        results = []
        step = 21  # ~1 month of trading
        for i in range(step, len(eq), step):
            start_val = eq[i - step]
            end_val = eq[i]
            ret = ((end_val - start_val) / start_val) * 100 if start_val > 0 else 0
            month_idx = (i // step)
            results.append({"month": month_idx, "return_pct": round(ret, 2)})
        return results

    @staticmethod
    def _empty_metrics(initial_capital: float) -> dict:
        return {
            "initial_capital": initial_capital,
            "final_equity": initial_capital,
            "total_return": 0, "cagr": 0, "annualized_return": 0, "annualized_volatility": 0,
            "sharpe_ratio": 0, "sortino_ratio": 0, "calmar_ratio": 0,
            "max_drawdown": 0, "max_drawdown_duration": 0,
            "var_95": 0, "var_99": 0, "ulcer_index": 0,
            "total_trades": 0, "win_rate": 0, "profit_factor": 0,
            "avg_win": 0, "avg_loss": 0, "expectancy": 0,
            "avg_trade_duration": 0, "total_commission": 0,
            "max_win_streak": 0, "max_loss_streak": 0,
            "equity_curve": [initial_capital], "equity_curve_raw": [initial_capital],
            "drawdown_curve": [0],
            "monthly_returns": [], "rolling_sharpe": [],
            "trade_distribution": [], "mae_mfe": [],
        }


# ── Monte Carlo Simulator ──────────────────────────────────────────────

class MonteCarloSimulator:
    """Randomize trade order to estimate distribution of outcomes."""

    @staticmethod
    def run(trades: List[Trade], initial_capital: float, n_simulations: int = 1000) -> dict:
        if not trades or len(trades) < 3:
            return {
                "median_return": 0, "p5_return": 0, "p95_return": 0,
                "probability_of_profit": 0, "probability_of_ruin": 0,
                "max_seen_drawdown": 0, "distribution": [],
            }

        pnl_list = [t.pnl for t in trades if t.pnl is not None]
        if not pnl_list:
            return {
                "median_return": 0, "p5_return": 0, "p95_return": 0,
                "probability_of_profit": 0, "probability_of_ruin": 0,
                "max_seen_drawdown": 0, "distribution": [],
            }

        final_returns = []
        max_dds = []
        ruin_count = 0
        ruin_threshold = initial_capital * 0.5  # 50% loss = ruin

        for _ in range(n_simulations):
            shuffled = pnl_list.copy()
            random.shuffle(shuffled)
            equity = initial_capital
            peak = equity
            max_dd = 0
            ruined = False
            for pnl in shuffled:
                equity += pnl
                if equity > peak:
                    peak = equity
                dd = (peak - equity) / peak if peak > 0 else 0
                max_dd = max(max_dd, dd)
                if equity < ruin_threshold:
                    ruined = True
            final_returns.append(((equity - initial_capital) / initial_capital) * 100)
            max_dds.append(max_dd * 100)
            if ruined:
                ruin_count += 1

        final_returns.sort()
        prob_profit = len([r for r in final_returns if r > 0]) / n_simulations * 100

        # Build distribution histogram (20 buckets)
        hist_min = min(final_returns)
        hist_max = max(final_returns)
        n_buckets = 20
        bucket_size = (hist_max - hist_min) / n_buckets if hist_max != hist_min else 1
        distribution = []
        for b in range(n_buckets):
            lo = hist_min + b * bucket_size
            hi = lo + bucket_size
            count = len([r for r in final_returns if lo <= r < hi])
            distribution.append({
                "range_start": round(lo, 1),
                "range_end": round(hi, 1),
                "count": count,
                "frequency": round(count / n_simulations * 100, 1),
            })

        return {
            "median_return": round(float(np.median(final_returns)), 2),
            "mean_return": round(float(np.mean(final_returns)), 2),
            "p5_return": round(float(np.percentile(final_returns, 5)), 2),
            "p25_return": round(float(np.percentile(final_returns, 25)), 2),
            "p75_return": round(float(np.percentile(final_returns, 75)), 2),
            "p95_return": round(float(np.percentile(final_returns, 95)), 2),
            "probability_of_profit": round(prob_profit, 1),
            "probability_of_ruin": round(ruin_count / n_simulations * 100, 1),
            "max_seen_drawdown": round(float(np.max(max_dds)), 2),
            "avg_max_drawdown": round(float(np.mean(max_dds)), 2),
            "distribution": distribution,
            "n_simulations": n_simulations,
        }


# ── Main Backtest Engine ────────────────────────────────────────────────

class BacktestEngine:
    """Pro-level backtesting engine with advanced features."""

    def __init__(self):
        self.trades: List[Trade] = []

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
    ) -> Dict:
        """Run a full backtest from a pre-loaded DataFrame (no DB needed)."""
        if strategy_name not in STRATEGY_REGISTRY:
            return {"error": f"Unknown strategy: {strategy_name}. Available: {list(STRATEGY_REGISTRY.keys())}"}

        strat_info = STRATEGY_REGISTRY[strategy_name]
        strat_func = strat_info["func"]
        params = {**strat_info["default_params"], **(strategy_params or {})}

        if df.empty or len(df) < 20:
            return {"error": "Insufficient data (need at least 20 bars)"}

        for col in ["open", "high", "low", "close"]:
            if col not in df.columns:
                return {"error": f"Missing required column: {col}"}
        if "volume" not in df.columns:
            df["volume"] = 1

        # Capital adequacy check: warn if initial capital is too small to buy even 1 share
        median_price = float(df["close"].median())
        min_required = median_price * 1.01  # price + ~1% for commission/slippage
        if initial_capital < min_required:
            return {
                "error": (
                    f"Initial capital ${initial_capital:,.2f} is too low to purchase shares "
                    f"(median price ~${median_price:,.2f}). "
                    f"Increase initial capital to at least ${min_required:,.0f}."
                )
            }

        sizing_method = PositionSizing(position_sizing) if position_sizing in [e.value for e in PositionSizing] else PositionSizing.FIXED

        if walk_forward and len(df) > 60:
            split_idx = int(len(df) * walk_forward_train_pct)
            train_df = df.iloc[:split_idx].copy()
            test_df = df.iloc[split_idx:].copy()
            train_signals = strat_func(train_df, params)
            test_signals = strat_func(test_df, params)
            result = self._execute_trades(
                test_df, test_signals, initial_capital, sizing_method, params,
                commission_rate, slippage_rate, stop_loss_pct, take_profit_pct,
                trailing_stop_pct, max_pyramiding,
            )
            result["walk_forward"] = {
                "enabled": True, "train_bars": len(train_df),
                "test_bars": len(test_df), "train_pct": walk_forward_train_pct,
            }
        else:
            signals = strat_func(df, params)
            result = self._execute_trades(
                df, signals, initial_capital, sizing_method, params,
                commission_rate, slippage_rate, stop_loss_pct, take_profit_pct,
                trailing_stop_pct, max_pyramiding,
            )
            result["walk_forward"] = {"enabled": False}

        if monte_carlo and len(self.trades) >= 3:
            result["monte_carlo"] = MonteCarloSimulator.run(self.trades, initial_capital, monte_carlo_sims)
        else:
            result["monte_carlo"] = None

        result["strategy"] = strategy_name
        result["strategy_params"] = params
        result["commission_rate"] = commission_rate
        result["slippage_rate"] = slippage_rate

        return result

    def run_backtest(
        self,
        db: Session,
        symbol_id: int,
        start_date: datetime,
        end_date: datetime,
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
    ) -> Dict:
        """Run a full backtest."""

        # Validate strategy
        if strategy_name not in STRATEGY_REGISTRY:
            return {"error": f"Unknown strategy: {strategy_name}. Available: {list(STRATEGY_REGISTRY.keys())}"}

        strat_info = STRATEGY_REGISTRY[strategy_name]
        strat_func = strat_info["func"]
        params = {**strat_info["default_params"], **(strategy_params or {})}

        # Get price data
        df = IndicatorService.get_price_dataframe(db, symbol_id, limit=5000)
        if df.empty:
            return {"error": "No price data available"}

        # Filter by date range — strip timezone for safe comparison
        try:
            if hasattr(df.index, 'tz') and df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            naive_start = start_date.replace(tzinfo=None) if start_date.tzinfo else start_date
            naive_end = end_date.replace(tzinfo=None) if end_date.tzinfo else end_date
            df = df[(df.index >= naive_start) & (df.index <= naive_end)].copy()
        except Exception:
            # If comparison fails, just use the full DataFrame
            pass
        if len(df) < 20:
            return {"error": "Insufficient data in date range (need at least 20 bars)"}

        # Ensure required columns
        for col in ["open", "high", "low", "close"]:
            if col not in df.columns:
                return {"error": f"Missing required column: {col}"}
        if "volume" not in df.columns:
            df["volume"] = 1

        sizing_method = PositionSizing(position_sizing) if position_sizing in [e.value for e in PositionSizing] else PositionSizing.FIXED

        # Walk-forward: split data
        if walk_forward and len(df) > 60:
            split_idx = int(len(df) * walk_forward_train_pct)
            train_df = df.iloc[:split_idx].copy()
            test_df = df.iloc[split_idx:].copy()

            # Generate signals on train set (for calibration info) then run on test set
            train_signals = strat_func(train_df, params)
            test_signals = strat_func(test_df, params)

            result = self._execute_trades(
                test_df, test_signals, initial_capital, sizing_method, params,
                commission_rate, slippage_rate, stop_loss_pct, take_profit_pct,
                trailing_stop_pct, max_pyramiding,
            )
            result["walk_forward"] = {
                "enabled": True,
                "train_bars": len(train_df),
                "test_bars": len(test_df),
                "train_pct": walk_forward_train_pct,
            }
        else:
            signals = strat_func(df, params)
            result = self._execute_trades(
                df, signals, initial_capital, sizing_method, params,
                commission_rate, slippage_rate, stop_loss_pct, take_profit_pct,
                trailing_stop_pct, max_pyramiding,
            )
            result["walk_forward"] = {"enabled": False}

        # Monte Carlo
        if monte_carlo and len(self.trades) >= 3:
            result["monte_carlo"] = MonteCarloSimulator.run(
                self.trades, initial_capital, monte_carlo_sims
            )
        else:
            result["monte_carlo"] = None

        result["strategy"] = strategy_name
        result["strategy_params"] = params
        result["commission_rate"] = commission_rate
        result["slippage_rate"] = slippage_rate

        return result

    def _execute_trades(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        initial_capital: float,
        sizing_method: PositionSizing,
        params: dict,
        commission_rate: float,
        slippage_rate: float,
        stop_loss_pct: Optional[float],
        take_profit_pct: Optional[float],
        trailing_stop_pct: Optional[float],
        max_pyramiding: int,
    ) -> dict:
        """Execute trades based on signals with risk management."""
        self.trades = []
        positions: List[Trade] = []  # Open positions (for pyramiding)
        cash = initial_capital
        equity_curve = [initial_capital]

        # Track stats for Kelly sizing
        wins = 0
        losses = 0
        total_win_amt = 0.0
        total_loss_amt = 0.0

        # Trailing stop tracker: maps position index to highest price seen
        trailing_highs: Dict[int, float] = {}

        for i in range(1, len(df)):
            bar = df.iloc[i]
            price = bar["close"]
            high = bar["high"]
            low = bar["low"]
            sig = signals.iloc[i] if i < len(signals) else "HOLD"

            # Increment bars held + track MAE/MFE
            for p in positions:
                p.bars_held += 1
                if p.entry_price > 0:
                    low_pct = ((low - p.entry_price) / p.entry_price) * 100
                    high_pct = ((high - p.entry_price) / p.entry_price) * 100
                    p.mae = min(p.mae, low_pct)   # Most negative excursion
                    p.mfe = max(p.mfe, high_pct)   # Most positive excursion

            # ── Check stop-loss / take-profit / trailing stop on open positions ──
            closed_indices = []
            for pidx, pos in enumerate(positions):
                # Update trailing high
                if pidx not in trailing_highs:
                    trailing_highs[pidx] = pos.entry_price
                trailing_highs[pidx] = max(trailing_highs[pidx], high)

                should_close = False
                reason = ""

                # Stop loss
                if stop_loss_pct and stop_loss_pct > 0:
                    stop_price = pos.entry_price * (1 - stop_loss_pct / 100)
                    if low <= stop_price:
                        should_close = True
                        reason = "stop_loss"
                        price_used = stop_price

                # Take profit
                if not should_close and take_profit_pct and take_profit_pct > 0:
                    tp_price = pos.entry_price * (1 + take_profit_pct / 100)
                    if high >= tp_price:
                        should_close = True
                        reason = "take_profit"
                        price_used = tp_price

                # Trailing stop
                if not should_close and trailing_stop_pct and trailing_stop_pct > 0:
                    trail_price = trailing_highs[pidx] * (1 - trailing_stop_pct / 100)
                    if low <= trail_price:
                        should_close = True
                        reason = "trailing_stop"
                        price_used = trail_price

                if should_close:
                    comm = price_used * pos.quantity * commission_rate
                    slip = price_used * pos.quantity * slippage_rate
                    pos.close(bar.name, price_used, comm, slip, reason)
                    cash += pos.quantity * price_used - comm - slip
                    self.trades.append(pos)
                    closed_indices.append(pidx)
                    if pos.pnl and pos.pnl > 0:
                        wins += 1
                        total_win_amt += pos.pnl
                    else:
                        losses += 1
                        total_loss_amt += abs(pos.pnl) if pos.pnl else 0

            # Remove closed positions (reverse order to preserve indices)
            for idx in sorted(closed_indices, reverse=True):
                positions.pop(idx)
                # Clean up trailing highs
                new_highs = {}
                for k, v in trailing_highs.items():
                    if k < idx:
                        new_highs[k] = v
                    elif k > idx:
                        new_highs[k - 1] = v
                trailing_highs = new_highs

            # ── Process signals ──
            if sig == "BUY" and len(positions) < max_pyramiding:
                win_rate = wins / (wins + losses) if (wins + losses) > 0 else 0.5
                avg_w = total_win_amt / wins if wins > 0 else 1.0
                avg_l = total_loss_amt / losses if losses > 0 else 1.0
                vol = df["close"].iloc[max(0, i - 20):i].pct_change().std() if i > 20 else 0.02

                shares = calculate_position_size(
                    sizing_method, cash, price,
                    win_rate=win_rate, avg_win=avg_w, avg_loss=avg_l,
                    volatility=vol if vol and not np.isnan(vol) else 0.02,
                )
                if shares > 0 and cash >= shares * price:
                    comm = shares * price * commission_rate
                    slip = shares * price * slippage_rate
                    cost = shares * price + comm + slip
                    if cost <= cash:
                        pos = Trade(
                            entry_date=bar.name,
                            entry_price=price,
                            quantity=shares,
                            commission_paid=comm + slip,
                        )
                        positions.append(pos)
                        trailing_highs[len(positions) - 1] = price
                        cash -= cost

            elif sig == "SELL" and positions:
                # Close all open positions
                for pos in positions:
                    comm = price * pos.quantity * commission_rate
                    slip = price * pos.quantity * slippage_rate
                    pos.close(bar.name, price, pos.commission_paid + comm, slip, "signal")
                    cash += pos.quantity * price - comm - slip
                    self.trades.append(pos)
                    if pos.pnl and pos.pnl > 0:
                        wins += 1
                        total_win_amt += pos.pnl
                    else:
                        losses += 1
                        total_loss_amt += abs(pos.pnl) if pos.pnl else 0
                positions = []
                trailing_highs = {}

            # Calculate equity
            pos_value = sum(p.quantity * price for p in positions)
            equity_curve.append(cash + pos_value)

        # Close remaining positions at last price
        if positions:
            final_price = df.iloc[-1]["close"]
            for pos in positions:
                comm = final_price * pos.quantity * commission_rate
                pos.close(df.index[-1], final_price, pos.commission_paid + comm, 0, "end_of_period")
                cash += pos.quantity * final_price - comm
                self.trades.append(pos)

        # Compute metrics
        metrics = MetricsCalculator.compute(equity_curve, self.trades, initial_capital)
        metrics["trades"] = [t.to_dict() for t in self.trades]

        return metrics


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
