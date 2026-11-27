"""
Technical indicators computation service

Computes SMA, EMA, RSI, MACD, and Bollinger Bands from either
database price history or live yfinance data (fallback).
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
    def clean_daily(df: pd.DataFrame) -> pd.DataFrame:
        """Valid daily bars only, from the last unadjusted split onwards.

        Null-close bars are dropped (they turned every rolling window NaN) and a
        >4x one-day jump (unadjusted reverse split / reused ticker: PARA went
        $0.03 -> $3.04 on 2026-11-24) starts a new series, so SMA/RSI/MACD are
        never computed across two incomparable price scales.
        """
        from app.services.bar_hygiene import clean_ohlcv_df, clean_tail_start

        df = clean_ohlcv_df(df)
        if df is None or df.empty:
            return pd.DataFrame()
        start = clean_tail_start(list(df["close"].astype(float)))
        return df.iloc[start:]

    @staticmethod
    def indicators_from_df(df: pd.DataFrame, source: str) -> Dict:
        """Indicator set from daily bars; each value is None when there is not
        enough clean history for its window (never a partial-window value)."""
        df = IndicatorService.clean_daily(df)
        if df.empty:
            return {}
        safe = IndicatorService._safe_value
        n = len(df)

        def last(series, need):
            return safe(series.iloc[-1]) if n >= need and len(series) else None

        macd_data = IndicatorService.compute_macd(df)
        bb = IndicatorService.compute_bollinger_bands(df)
        macd_ok = n >= 35  # 26-period slow EMA + 9-period signal
        return {
            "current_price": safe(df["close"].iloc[-1]),
            "sma_20": last(IndicatorService.compute_sma(df, 20), 20),
            "sma_50": last(IndicatorService.compute_sma(df, 50), 50),
            "sma_200": last(IndicatorService.compute_sma(df, 200), 200),
            "rsi": last(IndicatorService.compute_rsi(df, 14), 15),
            "macd": {
                "macd": safe(macd_data["macd"].iloc[-1]) if macd_ok else None,
                "signal": safe(macd_data["signal"].iloc[-1]) if macd_ok else None,
                "histogram": safe(macd_data["histogram"].iloc[-1]) if macd_ok else None,
            },
            "bollinger_bands": {
                "upper": last(bb["upper"], 20),
                "middle": last(bb["middle"], 20),
                "lower": last(bb["lower"], 20),
            },
            "bars_used": n,
            "history_start": str(df.index[0])[:10],
            "data_source": source,
        }

    @staticmethod
    def get_all_indicators(
        db: Session,
        symbol_id: int,
        periods: Optional[Dict[str, int]] = None
    ) -> Dict:
        """Indicators from stored daily bars (``periods`` kept for callers; the
        standard 20/50/200 SMA + RSI14 + MACD 12/26/9 + BB 20/2 set is used)."""
        df = IndicatorService.get_price_dataframe(db, symbol_id)
        if df.empty:
            return {}
        return IndicatorService.indicators_from_df(df, "database")

    @staticmethod
    def get_indicators_from_yfinance(symbol: str) -> Optional[Dict]:
        """Indicators from 2y of yfinance daily bars (enough for SMA200)."""
        try:
            import yfinance as yf
            from app.services.ticker_validation import yahoo_symbol

            hist = yf.Ticker(yahoo_symbol(symbol)).history(period="2y")
            if hist.empty:
                return None
            df = hist[["Open", "High", "Low", "Close", "Volume"]].copy()
            df.columns = ["open", "high", "low", "close", "volume"]
            out = IndicatorService.indicators_from_df(df, "yfinance")
            return out or None
        except Exception as e:
            print(f"yfinance indicators error for {symbol}: {e}")
            return None

    @staticmethod
    def get_indicators_from_sip(symbol: str, days: int = 1100) -> Optional[Dict]:
        """Indicators from Alpaca SIP daily bars (raw, consolidated tape)."""
        try:
            from app.services.alpaca_client import alpaca_client

            rows = alpaca_client.get_daily_bars_sip([symbol], days=days).get(symbol.upper()) or []
            if not rows:
                return None
            df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df.set_index("timestamp", inplace=True)
            out = IndicatorService.indicators_from_df(df, "alpaca_sip")
            return out or None
        except Exception as e:
            print(f"SIP indicators error for {symbol}: {e}")
            return None
