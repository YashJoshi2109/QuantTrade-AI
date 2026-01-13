"""
Technical indicators computation service
"""
import pandas as pd
import numpy as np
from typing import List, Dict, Optional
from app.models.price import PriceBar
from sqlalchemy.orm import Session
from sqlalchemy import func


class IndicatorService:
    """Service for computing technical indicators"""
    
    @staticmethod
    def get_price_dataframe(db: Session, symbol_id: int, limit: int = 500) -> pd.DataFrame:
        """Get price data as DataFrame for indicator computation"""
        bars = db.query(PriceBar).filter(
            PriceBar.symbol_id == symbol_id
        ).order_by(PriceBar.timestamp.desc()).limit(limit).all()
        
        if not bars:
            return pd.DataFrame()
        
        data = [{
            "timestamp": bar.timestamp,
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": bar.volume
        } for bar in reversed(bars)]
        
        df = pd.DataFrame(data)
        df.set_index("timestamp", inplace=True)
        return df
    
    @staticmethod
    def compute_sma(df: pd.DataFrame, period: int = 20) -> pd.Series:
        """Simple Moving Average"""
        return df["close"].rolling(window=period).mean()
    
    @staticmethod
    def compute_ema(df: pd.DataFrame, period: int = 20) -> pd.Series:
        """Exponential Moving Average"""
        return df["close"].ewm(span=period, adjust=False).mean()
    
    @staticmethod
    def compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
        """Relative Strength Index"""
        delta = df["close"].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    @staticmethod
    def compute_macd(
        df: pd.DataFrame,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9
    ) -> Dict[str, pd.Series]:
        """MACD indicator"""
        ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
        ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
        macd = ema_fast - ema_slow
        signal_line = macd.ewm(span=signal, adjust=False).mean()
        histogram = macd - signal_line
        
        return {
            "macd": macd,
            "signal": signal_line,
            "histogram": histogram
        }
    
    @staticmethod
    def compute_bollinger_bands(
        df: pd.DataFrame,
        period: int = 20,
        std_dev: int = 2
    ) -> Dict[str, pd.Series]:
        """Bollinger Bands"""
        sma = IndicatorService.compute_sma(df, period)
        std = df["close"].rolling(window=period).std()
        upper = sma + (std * std_dev)
        lower = sma - (std * std_dev)
        
        return {
            "upper": upper,
            "middle": sma,
            "lower": lower
        }
    
    @staticmethod
    def _safe_value(val) -> Optional[float]:
        """Convert value to float, return None if NaN or invalid"""
        if val is None:
            return None
        try:
            if pd.isna(val) or np.isnan(val):
                return None
            return float(val)
        except (TypeError, ValueError):
            return None
    
    @staticmethod
    def get_all_indicators(
        db: Session,
        symbol_id: int,
        periods: Optional[Dict[str, int]] = None
    ) -> Dict:
        """Get all computed indicators for a symbol"""
        if periods is None:
            periods = {
                "sma_20": 20,
                "sma_50": 50,
                "sma_200": 200,
                "rsi": 14
            }
        
        df = IndicatorService.get_price_dataframe(db, symbol_id)
        
        if df.empty:
            return {}
        
        indicators = {}
        safe = IndicatorService._safe_value
        
        # Moving averages
        if "sma_20" in periods:
            sma_20 = IndicatorService.compute_sma(df, periods["sma_20"])
            indicators["sma_20"] = safe(sma_20.iloc[-1]) if len(sma_20) > 0 else None
        if "sma_50" in periods:
            sma_50 = IndicatorService.compute_sma(df, periods["sma_50"])
            indicators["sma_50"] = safe(sma_50.iloc[-1]) if len(sma_50) > 0 else None
        if "sma_200" in periods:
            sma_200 = IndicatorService.compute_sma(df, periods["sma_200"])
            indicators["sma_200"] = safe(sma_200.iloc[-1]) if len(sma_200) > 0 else None
        
        # RSI
        if "rsi" in periods:
            rsi = IndicatorService.compute_rsi(df, periods["rsi"])
            indicators["rsi"] = safe(rsi.iloc[-1]) if len(rsi) > 0 else None
        
        # MACD
        macd_data = IndicatorService.compute_macd(df)
        indicators["macd"] = {
            "macd": safe(macd_data["macd"].iloc[-1]) if len(macd_data["macd"]) > 0 else None,
            "signal": safe(macd_data["signal"].iloc[-1]) if len(macd_data["signal"]) > 0 else None,
            "histogram": safe(macd_data["histogram"].iloc[-1]) if len(macd_data["histogram"]) > 0 else None
        }
        
        # Bollinger Bands
        bb = IndicatorService.compute_bollinger_bands(df)
        indicators["bollinger_bands"] = {
            "upper": safe(bb["upper"].iloc[-1]) if len(bb["upper"]) > 0 else None,
            "middle": safe(bb["middle"].iloc[-1]) if len(bb["middle"]) > 0 else None,
            "lower": safe(bb["lower"].iloc[-1]) if len(bb["lower"]) > 0 else None
        }
        
        # Current price
        indicators["current_price"] = safe(df["close"].iloc[-1])
        
        return indicators
