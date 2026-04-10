"""
Backtest API — Pro-level backtesting endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, Dict, List
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.backtest_engine import (
    BacktestEngine,
    STRATEGY_REGISTRY,
    rsi_ma_crossover_strategy,
    ma_crossover_strategy,
)
from pydantic import BaseModel, Field

router = APIRouter()


class BacktestRequest(BaseModel):
    symbol: str
    start_date: str
    end_date: str
    strategy: str = "rsi_ma_crossover"
    initial_capital: float = 10000.0
    strategy_params: Optional[Dict] = None
    position_sizing: str = "fixed"
    commission_rate: float = 0.001
    slippage_rate: float = 0.0005
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    trailing_stop_pct: Optional[float] = None
    max_pyramiding: int = 1
    walk_forward: bool = False
    walk_forward_train_pct: float = 0.7
    monte_carlo: bool = True
    monte_carlo_sims: int = 1000


@router.post("/backtest")
async def run_backtest(request: BacktestRequest, db: Session = Depends(get_db)):
    """Run a pro-level backtest with advanced metrics and Monte Carlo validation."""
    # Find the symbol
    symbol = db.query(Symbol).filter(Symbol.ticker == request.symbol.upper()).first()
    if not symbol:
        raise HTTPException(status_code=404, detail=f"Symbol {request.symbol} not found")

    try:
        # Parse dates — strip timezone for naive comparison with DB timestamps
        raw_start = request.start_date.replace("Z", "").replace("+00:00", "")
        raw_end = request.end_date.replace("Z", "").replace("+00:00", "")
        # Handle both "2024-01-01" and "2024-01-01T00:00:00" formats
        start_date = datetime.fromisoformat(raw_start)
        end_date = datetime.fromisoformat(raw_end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format (e.g., 2024-01-01).")

    if start_date >= end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")

    try:
        engine = BacktestEngine()
        result = engine.run_backtest(
            db=db,
            symbol_id=symbol.id,
            start_date=start_date,
            end_date=end_date,
            strategy_name=request.strategy,
            strategy_params=request.strategy_params,
            initial_capital=request.initial_capital,
            position_sizing=request.position_sizing,
            commission_rate=request.commission_rate,
            slippage_rate=request.slippage_rate,
            stop_loss_pct=request.stop_loss_pct,
            take_profit_pct=request.take_profit_pct,
            trailing_stop_pct=request.trailing_stop_pct,
            max_pyramiding=request.max_pyramiding,
            walk_forward=request.walk_forward,
            walk_forward_train_pct=request.walk_forward_train_pct,
            monte_carlo=request.monte_carlo,
            monte_carlo_sims=request.monte_carlo_sims,
        )

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        result["symbol"] = request.symbol.upper()
        return result
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Backtest engine error: {str(e)}")


@router.get("/strategies")
async def get_strategies():
    """Return all available strategies with descriptions and default parameters."""
    strategies = []
    for name, info in STRATEGY_REGISTRY.items():
        strategies.append({
            "id": name,
            "name": name.replace("_", " ").title(),
            "description": info["description"],
            "category": info["category"],
            "default_params": info["default_params"],
        })
    return {"strategies": strategies}
