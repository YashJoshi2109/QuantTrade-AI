"""
Risk scoring service for Phase 3
"""
import pandas as pd
import numpy as np
from typing import Dict, Optional
from datetime import datetime, timedelta
from app.models.price import PriceBar
from app.models.symbol import Symbol
from sqlalchemy.orm import Session
from app.services.indicators import IndicatorService


class RiskScorer:
    """Calculate risk metrics and scores for symbols"""
    
    @staticmethod
    def calculate_volatility(
        db: Session,
        symbol_id: int,
        period_days: int = 30
    ) -> float:
        """Calculate rolling volatility"""
        df = IndicatorService.get_price_dataframe(db, symbol_id, limit=period_days + 50)
        
        if df.empty or len(df) < period_days:
            return 0.0
        
        returns = df["close"].pct_change().dropna()
        volatility = returns.std() * np.sqrt(252)  # Annualized
        
        return float(volatility * 100)  # Return as percentage
    
    @staticmethod
    def calculate_max_drawdown(
        db: Session,
        symbol_id: int,
        period_days: int = 252
    ) -> float:
        """Calculate maximum drawdown"""
        df = IndicatorService.get_price_dataframe(db, symbol_id, limit=period_days)
        
        if df.empty:
            return 0.0
        
        prices = df["close"]
        cumulative = (1 + prices.pct_change()).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = (cumulative - running_max) / running_max
        
        max_dd = abs(drawdown.min())
        return float(max_dd * 100)  # Return as percentage
    
    @staticmethod
    def calculate_beta(
        db: Session,
        symbol_id: int,
        market_symbol: str = "SPY",
        period_days: int = 252
    ) -> Optional[float]:
        """Calculate beta vs market (simplified - would need market data)"""
        # For Phase 3, return a placeholder
        # In production, fetch market data and calculate covariance
        return 1.0
    
    @staticmethod
    def calculate_risk_score(
        db: Session,
        symbol_id: int
    ) -> Dict:
        """Calculate comprehensive risk score"""
        volatility = RiskScorer.calculate_volatility(db, symbol_id)
        max_drawdown = RiskScorer.calculate_max_drawdown(db, symbol_id)
        beta = RiskScorer.calculate_beta(db, symbol_id) or 1.0
        
        # Get RSI for momentum
        indicators = IndicatorService.get_all_indicators(db, symbol_id)
        rsi = indicators.get("rsi", 50)
        
        # Simple risk score (0-100, higher = riskier)
        # Weighted combination of factors
        volatility_score = min(volatility * 2, 40)  # Max 40 points
        drawdown_score = min(max_drawdown * 1.5, 30)  # Max 30 points
        beta_score = abs(beta - 1) * 10  # Max 20 points
        momentum_score = abs(rsi - 50) / 50 * 10  # Max 10 points
        
        risk_score = volatility_score + drawdown_score + beta_score + momentum_score
        risk_score = min(risk_score, 100)
        
        # Risk level
        if risk_score >= 70:
            risk_level = "High"
        elif risk_score >= 40:
            risk_level = "Medium"
        else:
            risk_level = "Low"
        
        return {
            "risk_score": round(risk_score, 2),
            "risk_level": risk_level,
            "factors": {
                "volatility": round(volatility, 2),
                "max_drawdown": round(max_drawdown, 2),
                "beta": round(beta, 2),
                "rsi": round(rsi, 2) if rsi else None
            },
            "breakdown": {
                "volatility_contribution": round(volatility_score, 2),
                "drawdown_contribution": round(drawdown_score, 2),
                "beta_contribution": round(beta_score, 2),
                "momentum_contribution": round(momentum_score, 2)
            }
        }
