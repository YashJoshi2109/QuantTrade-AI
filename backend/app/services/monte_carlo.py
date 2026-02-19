"""
Monte Carlo simulation service for stock price forecasting.

Uses historical price data to simulate future price paths using
geometric Brownian motion (GBM) model.
"""
import logging
import numpy as np
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.models.price import PriceBar
from app.models.symbol import Symbol

logger = logging.getLogger(__name__)


def _sf(val, default=None):
    """Safe float conversion."""
    if val is None:
        return default
    try:
        v = float(val)
        if np.isnan(v) or np.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


def calculate_returns(prices: List[float]) -> List[float]:
    """Calculate daily returns from price series."""
    if len(prices) < 2:
        return []
    returns = []
    for i in range(1, len(prices)):
        if prices[i-1] > 0:
            ret = (prices[i] - prices[i-1]) / prices[i-1]
            returns.append(ret)
    return returns


def calculate_statistics(returns: List[float]) -> Dict[str, float]:
    """Calculate mean and standard deviation of returns."""
    if not returns:
        return {"mean": 0.0, "std": 0.0}
    
    returns_array = np.array(returns)
    mean = float(np.mean(returns_array))
    std = float(np.std(returns_array))
    
    return {"mean": mean, "std": std}


def simulate_price_path(
    current_price: float,
    mean_return: float,
    volatility: float,
    days: int,
    num_simulations: int = 10000
) -> Dict[str, Any]:
    """
    Run Monte Carlo simulation using Geometric Brownian Motion.
    
    Parameters:
    - current_price: Starting price
    - mean_return: Expected daily return (drift)
    - volatility: Daily volatility (standard deviation)
    - days: Number of days to simulate
    - num_simulations: Number of simulation paths
    
    Returns:
    Dictionary with simulation results including percentiles, probabilities, etc.
    """
    if current_price <= 0:
        return {
            "error": "Invalid current price",
            "simulations": [],
            "percentiles": {},
            "probabilities": {},
        }
    
    # Annualize the parameters (assuming 252 trading days)
    dt = 1.0 / 252.0  # Daily time step
    mu = mean_return * 252  # Annual drift
    sigma = volatility * np.sqrt(252)  # Annual volatility
    
    # Generate random shocks
    np.random.seed(42)  # For reproducibility
    random_shocks = np.random.normal(0, 1, (num_simulations, days))
    
    # Simulate price paths
    price_paths = np.zeros((num_simulations, days + 1))
    price_paths[:, 0] = current_price
    
    for t in range(days):
        # GBM formula: S(t+1) = S(t) * exp((mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*Z)
        drift = (mu - 0.5 * sigma ** 2) * dt
        diffusion = sigma * np.sqrt(dt) * random_shocks[:, t]
        price_paths[:, t + 1] = price_paths[:, t] * np.exp(drift + diffusion)
    
    # Calculate final prices
    final_prices = price_paths[:, -1]
    
    # Calculate percentiles
    percentiles = {
        "p5": float(np.percentile(final_prices, 5)),
        "p10": float(np.percentile(final_prices, 10)),
        "p25": float(np.percentile(final_prices, 25)),
        "p50": float(np.percentile(final_prices, 50)),  # Median
        "p75": float(np.percentile(final_prices, 75)),
        "p90": float(np.percentile(final_prices, 90)),
        "p95": float(np.percentile(final_prices, 95)),
    }
    
    # Calculate probabilities
    probabilities = {
        "price_up": float(np.mean(final_prices > current_price)) * 100,
        "price_down": float(np.mean(final_prices < current_price)) * 100,
        "gain_5pct": float(np.mean(final_prices > current_price * 1.05)) * 100,
        "gain_10pct": float(np.mean(final_prices > current_price * 1.10)) * 100,
        "gain_20pct": float(np.mean(final_prices > current_price * 1.20)) * 100,
        "loss_5pct": float(np.mean(final_prices < current_price * 0.95)) * 100,
        "loss_10pct": float(np.mean(final_prices < current_price * 0.90)) * 100,
        "loss_20pct": float(np.mean(final_prices < current_price * 0.80)) * 100,
    }
    
    # Expected value
    expected_price = float(np.mean(final_prices))
    expected_return_pct = ((expected_price - current_price) / current_price) * 100
    
    # Calculate confidence intervals
    confidence_intervals = {
        "80": {
            "lower": float(np.percentile(final_prices, 10)),
            "upper": float(np.percentile(final_prices, 90)),
        },
        "95": {
            "lower": float(np.percentile(final_prices, 2.5)),
            "upper": float(np.percentile(final_prices, 97.5)),
        },
    }
    
    return {
        "current_price": current_price,
        "days": days,
        "num_simulations": num_simulations,
        "expected_price": expected_price,
        "expected_return_pct": round(expected_return_pct, 2),
        "percentiles": percentiles,
        "probabilities": probabilities,
        "confidence_intervals": confidence_intervals,
        "min_price": float(np.min(final_prices)),
        "max_price": float(np.max(final_prices)),
        "sample_paths": price_paths[:100].tolist(),  # Return first 100 paths for visualization
    }


def run_monte_carlo_simulation(
    symbol: str,
    db: Session,
    days: int = 30,
    num_simulations: int = 10000
) -> Optional[Dict[str, Any]]:
    """
    Run Monte Carlo simulation for a given symbol.
    
    Parameters:
    - symbol: Stock symbol
    - db: Database session
    - days: Number of days to forecast (default: 30)
    - num_simulations: Number of simulation paths (default: 10000)
    
    Returns:
    Dictionary with simulation results or None if data is insufficient
    """
    try:
        # Get symbol from database
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if not db_symbol:
            logger.warning(f"Symbol {symbol} not found in database")
            return None
        
        # Get recent price history (last 252 trading days ~ 1 year)
        cutoff_date = datetime.utcnow() - timedelta(days=400)  # Extra buffer for weekends/holidays
        price_bars = (
            db.query(PriceBar)
            .filter(
                PriceBar.symbol_id == db_symbol.id,
                PriceBar.timestamp >= cutoff_date
            )
            .order_by(PriceBar.timestamp.asc())
            .all()
        )
        
        if len(price_bars) < 30:  # Need at least 30 days of data
            logger.warning(f"Insufficient price data for {symbol}: {len(price_bars)} bars")
            return None
        
        # Extract closing prices
        prices = [_sf(bar.close) for bar in price_bars if _sf(bar.close) is not None]
        
        if len(prices) < 30:
            return None
        
        # Calculate returns
        returns = calculate_returns(prices)
        
        if len(returns) < 10:
            return None
        
        # Calculate statistics
        stats = calculate_statistics(returns)
        mean_return = stats["mean"]
        volatility = stats["std"]
        
        # Get current price (most recent close)
        current_price = prices[-1]
        
        if current_price <= 0:
            return None
        
        # Run simulation
        result = simulate_price_path(
            current_price=current_price,
            mean_return=mean_return,
            volatility=volatility,
            days=days,
            num_simulations=num_simulations
        )
        
        # Add metadata
        result["symbol"] = symbol.upper()
        result["historical_days"] = len(prices)
        result["mean_daily_return"] = round(mean_return * 100, 4)
        result["daily_volatility"] = round(volatility * 100, 4)
        result["annualized_volatility"] = round(volatility * np.sqrt(252) * 100, 2)
        
        return result
        
    except Exception as e:
        logger.error(f"Monte Carlo simulation failed for {symbol}: {e}", exc_info=True)
        return None
