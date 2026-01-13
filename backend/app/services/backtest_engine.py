"""
Backtesting engine for Phase 4
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Callable
from datetime import datetime, timedelta
from app.models.price import PriceBar
from app.models.symbol import Symbol
from sqlalchemy.orm import Session
from app.services.indicators import IndicatorService


class Trade:
    """Represents a single trade"""
    def __init__(self, entry_date: datetime, entry_price: float, quantity: int = 1):
        self.entry_date = entry_date
        self.entry_price = entry_price
        self.quantity = quantity
        self.exit_date: Optional[datetime] = None
        self.exit_price: Optional[float] = None
        self.pnl: Optional[float] = None
        self.return_pct: Optional[float] = None
    
    def close(self, exit_date: datetime, exit_price: float):
        """Close the trade"""
        self.exit_date = exit_date
        self.exit_price = exit_price
        self.pnl = (exit_price - self.entry_price) * self.quantity
        self.return_pct = ((exit_price - self.entry_price) / self.entry_price) * 100


class BacktestEngine:
    """Simple backtesting engine"""
    
    def __init__(self):
        self.trades: List[Trade] = []
    
    def run_backtest(
        self,
        db: Session,
        symbol_id: int,
        start_date: datetime,
        end_date: datetime,
        strategy_func: Callable,
        initial_capital: float = 10000.0
    ) -> Dict:
        """Run a backtest"""
        # Get price data
        df = IndicatorService.get_price_dataframe(db, symbol_id, limit=1000)
        
        if df.empty:
            return {"error": "No price data available"}
        
        # Filter by date range
        df = df[(df.index >= start_date) & (df.index <= end_date)]
        
        if df.empty:
            return {"error": "No data in date range"}
        
        # Calculate indicators
        df["sma_20"] = IndicatorService.compute_sma(df, 20)
        df["sma_50"] = IndicatorService.compute_sma(df, 50)
        df["rsi"] = IndicatorService.compute_rsi(df, 14)
        
        # Run strategy
        self.trades = []
        position = None
        cash = initial_capital
        equity_curve = [initial_capital]
        
        for i in range(1, len(df)):
            current_bar = df.iloc[i]
            prev_bar = df.iloc[i-1]
            
            # Get strategy signal
            signal = strategy_func(current_bar, prev_bar, position)
            
            if signal == "BUY" and position is None:
                # Enter long position
                shares = int(cash / current_bar["close"])
                if shares > 0:
                    cost = shares * current_bar["close"]
                    position = Trade(
                        entry_date=current_bar.name,
                        entry_price=current_bar["close"],
                        quantity=shares
                    )
                    cash -= cost
            
            elif signal == "SELL" and position is not None:
                # Exit position
                proceeds = position.quantity * current_bar["close"]
                position.close(current_bar.name, current_bar["close"])
                cash += proceeds
                self.trades.append(position)
                position = None
            
            # Calculate current equity
            if position:
                current_equity = cash + (position.quantity * current_bar["close"])
            else:
                current_equity = cash
            
            equity_curve.append(current_equity)
        
        # Close any open position
        if position:
            final_price = df.iloc[-1]["close"]
            proceeds = position.quantity * final_price
            position.close(df.index[-1], final_price)
            cash += proceeds
            self.trades.append(position)
        
        # Calculate metrics
        total_return = (cash - initial_capital) / initial_capital * 100
        final_equity = cash
        
        # Calculate returns
        returns = []
        for trade in self.trades:
            if trade.return_pct:
                returns.append(trade.return_pct)
        
        win_rate = len([r for r in returns if r > 0]) / len(returns) * 100 if returns else 0
        
        # Max drawdown
        equity_series = pd.Series(equity_curve)
        cumulative = equity_series / equity_series.iloc[0]
        running_max = cumulative.expanding().max()
        drawdown = (cumulative - running_max) / running_max
        max_drawdown = abs(drawdown.min()) * 100
        
        # Sharpe ratio (simplified)
        if len(returns) > 1:
            sharpe = np.mean(returns) / np.std(returns) * np.sqrt(252) if np.std(returns) > 0 else 0
        else:
            sharpe = 0
        
        return {
            "initial_capital": initial_capital,
            "final_equity": round(final_equity, 2),
            "total_return": round(total_return, 2),
            "total_trades": len(self.trades),
            "win_rate": round(win_rate, 2),
            "max_drawdown": round(max_drawdown, 2),
            "sharpe_ratio": round(sharpe, 2),
            "equity_curve": [round(x, 2) for x in equity_curve],
            "trades": [
                {
                    "entry_date": trade.entry_date.isoformat(),
                    "exit_date": trade.exit_date.isoformat() if trade.exit_date else None,
                    "entry_price": round(trade.entry_price, 2),
                    "exit_price": round(trade.exit_price, 2) if trade.exit_price else None,
                    "pnl": round(trade.pnl, 2) if trade.pnl else None,
                    "return_pct": round(trade.return_pct, 2) if trade.return_pct else None
                }
                for trade in self.trades
            ]
        }


# Strategy templates
def rsi_ma_crossover_strategy(current_bar, prev_bar, position):
    """RSI < 30 and price above SMA 20"""
    if current_bar["rsi"] < 30 and current_bar["close"] > current_bar["sma_20"]:
        return "BUY"
    elif position and (current_bar["rsi"] > 70 or current_bar["close"] < current_bar["sma_20"]):
        return "SELL"
    return "HOLD"


def ma_crossover_strategy(current_bar, prev_bar, position):
    """SMA 20 crosses above SMA 50"""
    if prev_bar["sma_20"] <= prev_bar["sma_50"] and current_bar["sma_20"] > current_bar["sma_50"]:
        return "BUY"
    elif position and prev_bar["sma_20"] >= prev_bar["sma_50"] and current_bar["sma_20"] < current_bar["sma_50"]:
        return "SELL"
    return "HOLD"
