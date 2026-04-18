"""
Alpaca Markets Client — Free historical bars + US quotes

Provides:
- Historical OHLCV bars (daily/intraday) for backtesting and candlestick charts
- Real-time US stock quotes (paper or live account)
- No rate limit on historical data (free tier)

Usage:
    from app.services.alpaca_client import alpaca_client

    # Historical bars for backtesting
    df = alpaca_client.get_historical_bars("AAPL", start, end)

    # Real-time quote
    quote = alpaca_client.get_quote("AAPL")
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import pandas as pd

from app.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded client singletons
_stock_client = None
_trading_client = None


def _get_stock_client():
    """Lazy-init Alpaca StockHistoricalDataClient."""
    global _stock_client
    if _stock_client is not None:
        return _stock_client
    if not settings.ALPACA_API_KEY or not settings.ALPACA_SECRET_KEY:
        return None
    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.common.exceptions import APIError
        _stock_client = StockHistoricalDataClient(
            api_key=settings.ALPACA_API_KEY,
            secret_key=settings.ALPACA_SECRET_KEY,
        )
        logger.info("Alpaca StockHistoricalDataClient initialized")
        return _stock_client
    except Exception as e:
        logger.warning(f"Alpaca client init failed: {e}")
        return None


def _get_trading_client():
    """Lazy-init Alpaca TradingClient (for account info, not trading)."""
    global _trading_client
    if _trading_client is not None:
        return _trading_client
    if not settings.ALPACA_API_KEY or not settings.ALPACA_SECRET_KEY:
        return None
    try:
        from alpaca.trading.client import TradingClient
        _trading_client = TradingClient(
            api_key=settings.ALPACA_API_KEY,
            secret_key=settings.ALPACA_SECRET_KEY,
            paper=("paper" in settings.ALPACA_BASE_URL),
        )
        return _trading_client
    except Exception as e:
        logger.warning(f"Alpaca TradingClient init failed: {e}")
        return None


class AlpacaClient:
    """Alpaca Markets data client for historical bars and quotes."""

    def get_historical_bars(
        self,
        symbol: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        timeframe: str = "1Day",
    ) -> pd.DataFrame:
        """
        Fetch historical OHLCV bars from Alpaca.

        Args:
            symbol: Stock ticker (US stocks only)
            start: Start datetime (default: 1 year ago)
            end: End datetime (default: now)
            timeframe: "1Min", "5Min", "15Min", "1Hour", "1Day" (default)

        Returns:
            DataFrame with columns: open, high, low, close, volume
            Empty DataFrame if unavailable.
        """
        client = _get_stock_client()
        if client is None:
            return pd.DataFrame()

        try:
            from alpaca.data.requests import StockBarsRequest
            from alpaca.data.timeframe import TimeFrame

            tf_map = {
                "1Min": TimeFrame.Minute,
                "5Min": TimeFrame(5, "Min") if hasattr(TimeFrame, '__init__') else TimeFrame.Minute,
                "15Min": TimeFrame(15, "Min") if hasattr(TimeFrame, '__init__') else TimeFrame.Minute,
                "1Hour": TimeFrame.Hour,
                "1Day": TimeFrame.Day,
                "1Week": TimeFrame.Week,
                "1Month": TimeFrame.Month,
            }
            tf = tf_map.get(timeframe, TimeFrame.Day)

            if not start:
                start = datetime.now(timezone.utc) - timedelta(days=365)
            if not end:
                end = datetime.now(timezone.utc)

            # Ensure timezone-aware
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)

            request = StockBarsRequest(
                symbol_or_symbols=symbol.upper(),
                timeframe=tf,
                start=start,
                end=end,
            )

            bars = client.get_stock_bars(request)
            df = bars.df

            if df.empty:
                logger.debug(f"Alpaca: No bars for {symbol}")
                return pd.DataFrame()

            # Reset multi-index (symbol, timestamp) to just timestamp
            if isinstance(df.index, pd.MultiIndex):
                df = df.droplevel("symbol")

            # Standardize column names
            df = df.rename(columns={
                "open": "open",
                "high": "high",
                "low": "low",
                "close": "close",
                "volume": "volume",
            })

            # Remove timezone for consistency with other sources
            if hasattr(df.index, 'tz') and df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            logger.info(f"Alpaca: Fetched {len(df)} bars for {symbol} ({timeframe})")
            return df[["open", "high", "low", "close", "volume"]]

        except Exception as e:
            logger.debug(f"Alpaca bars failed for {symbol}: {e}")
            return pd.DataFrame()

    def get_historical_bars_df(
        self,
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        period: str = "1y",
    ) -> pd.DataFrame:
        """
        Convenience wrapper matching DataFetcher.fetch_historical_data() signature.
        Returns DataFrame with columns: timestamp, open, high, low, close, volume
        """
        if not start_date:
            period_map = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825}
            days = period_map.get(period, 365)
            start_date = datetime.now(timezone.utc) - timedelta(days=days)

        df = self.get_historical_bars(symbol, start_date, end_date)
        if df.empty:
            return pd.DataFrame()

        # Convert index to 'timestamp' column for compatibility
        df = df.reset_index()
        if "timestamp" not in df.columns and "date" not in df.columns:
            df.columns = ["timestamp"] + list(df.columns[1:])
        elif "date" in df.columns:
            df = df.rename(columns={"date": "timestamp"})

        return df

    def get_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Fetch latest quote/snapshot from Alpaca.
        Returns standardized quote dict or None.
        """
        client = _get_stock_client()
        if client is None:
            return None

        try:
            from alpaca.data.requests import StockLatestQuoteRequest, StockSnapshotRequest

            # Use snapshot for richer data (OHLCV + quote)
            snapshot = client.get_stock_snapshot(
                StockSnapshotRequest(symbol_or_symbols=symbol.upper())
            )

            if not snapshot:
                return None

            snap = snapshot.get(symbol.upper()) if isinstance(snapshot, dict) else snapshot
            if not snap:
                return None

            price = float(snap.latest_trade.price) if snap.latest_trade else 0
            if price <= 0:
                return None

            prev_close = float(snap.previous_daily_bar.close) if snap.previous_daily_bar else price
            change = price - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0

            return {
                "symbol": symbol.upper(),
                "price": round(price, 2),
                "change": round(change, 2),
                "change_percent": round(change_pct, 4),
                "volume": int(snap.daily_bar.volume) if snap.daily_bar else 0,
                "high": round(float(snap.daily_bar.high), 2) if snap.daily_bar else 0,
                "low": round(float(snap.daily_bar.low), 2) if snap.daily_bar else 0,
                "open": round(float(snap.daily_bar.open), 2) if snap.daily_bar else 0,
                "previous_close": round(prev_close, 2),
                "market_cap": None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data_source": "alpaca",
            }
        except Exception as e:
            logger.debug(f"Alpaca quote failed for {symbol}: {e}")
            return None

    def get_intraday_bars(
        self,
        symbol: str,
        interval: str = "5Min",
        days_back: int = 1,
    ) -> pd.DataFrame:
        """
        Fetch intraday bars for candlestick charts.

        Args:
            symbol: Stock ticker
            interval: "1Min", "5Min", "15Min", "1Hour"
            days_back: How many days of intraday data (max ~30 for free)
        """
        start = datetime.now(timezone.utc) - timedelta(days=days_back)
        return self.get_historical_bars(symbol, start=start, timeframe=interval)


# Singleton
alpaca_client = AlpacaClient()
