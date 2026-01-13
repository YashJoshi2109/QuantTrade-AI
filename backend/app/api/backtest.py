"""
Backtesting API endpoints (Phase 4)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.backtest_engine import BacktestEngine, rsi_ma_crossover_strategy, ma_crossover_strategy
from pydantic import BaseModel

router = APIRouter()


class BacktestRequest(BaseModel):
    symbol: str
    start_date: datetime
    end_date: datetime
    strategy: str = "rsi_ma_crossover"  # or "ma_crossover"
    initial_capital: float = 10000.0


@router.post("/backtest")
async def run_backtest(
    request: BacktestRequest,
    db: Session = Depends(get_db)
):
    """Run a backtest"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == request.symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    # Select strategy
    strategy_map = {
        "rsi_ma_crossover": rsi_ma_crossover_strategy,
        "ma_crossover": ma_crossover_strategy
    }
    
    if request.strategy not in strategy_map:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategy. Available: {list(strategy_map.keys())}"
        )
    
    strategy_func = strategy_map[request.strategy]
    
    # Run backtest
    engine = BacktestEngine()
    result = engine.run_backtest(
        db=db,
        symbol_id=db_symbol.id,
        start_date=request.start_date,
        end_date=request.end_date,
        strategy_func=strategy_func,
        initial_capital=request.initial_capital
    )
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return {
        "symbol": request.symbol.upper(),
        "strategy": request.strategy,
        **result
    }


@router.get("/strategies")
async def get_strategies():
    """Get available strategy templates"""
    return {
        "strategies": [
            {
                "id": "rsi_ma_crossover",
                "name": "RSI + MA Crossover",
                "description": "Buy when RSI < 30 and price above SMA 20, sell when RSI > 70 or price below SMA 20"
            },
            {
                "id": "ma_crossover",
                "name": "Moving Average Crossover",
                "description": "Buy when SMA 20 crosses above SMA 50, sell when SMA 20 crosses below SMA 50"
            }
        ]
    }
