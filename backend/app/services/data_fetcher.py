"""
Service for fetching market data from various sources
Fallback chain: yfinance -> Alpaca -> Alpha Vantage
"""
import yfinance as yf
import pandas as pd
import requests
from datetime import datetime, timedelta
from typing import List, Optional
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.config import settings
from app.services.ticker_validation import yahoo_symbol
from sqlalchemy.orm import Session


def last_completed_session_date(now_utc: Optional[datetime] = None):
    """Most recent US trading session whose daily bar is final.

    Before ~16:30 ET the current session is still trading, so its daily bar is
    partial and the previous weekday is returned. Exchange holidays are not
    modelled (a holiday just yields a date with no upstream bar).
    """
    from datetime import timezone
    import pytz

    now_utc = now_utc or datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    et = now_utc.astimezone(pytz.timezone("America/New_York"))
    day = et.date()
    if et.hour < 16 or (et.hour == 16 and et.minute < 30):
        day -= timedelta(days=1)
    while day.weekday() >= 5:  # Sat/Sun -> Friday
        day -= timedelta(days=1)
    return day


class DataFetcher:
    """Fetches market data using Alpha Vantage (primary) and yfinance (fallback)"""
    
    @staticmethod
    def fetch_symbol_info(symbol: str) -> dict:
        """Fetch basic symbol information"""
        # Try Alpha Vantage first
        if settings.ALPHA_VANTAGE_API_KEY:
            try:
                url = "https://www.alphavantage.co/query"
                params = {
                    "function": "OVERVIEW",
                    "symbol": symbol,
                    "apikey": settings.ALPHA_VANTAGE_API_KEY
                }
                response = requests.get(url, params=params, timeout=10)
                data = response.json()
                
                if data and "Symbol" in data:
                    return {
                        "symbol": symbol,
                        "name": data.get("Name", symbol),
                        "sector": data.get("Sector"),
                        "industry": data.get("Industry"),
                        "market_cap": int(data.get("MarketCapitalization", 0)) if data.get("MarketCapitalization") else None,
                    }
            except Exception as e:
                print(f"Alpha Vantage overview failed for {symbol}: {e}")
        
        # Fallback to yfinance
        try:
            ticker = yf.Ticker(yahoo_symbol(symbol))
            info = ticker.info
            return {
                "symbol": symbol,
                "name": info.get("longName") or info.get("shortName", ""),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "market_cap": info.get("marketCap"),
            }
        except Exception as e:
            print(f"yfinance info failed for {symbol}: {e}")
            return {
                "symbol": symbol,
                "name": symbol,
                "sector": None,
                "industry": None,
                "market_cap": None,
            }
    
    @staticmethod
    def fetch_historical_data_alpha_vantage(symbol: str, outputsize: str = "full") -> pd.DataFrame:
        """Fetch historical data from Alpha Vantage"""
        if not settings.ALPHA_VANTAGE_API_KEY:
            return pd.DataFrame()
        
        try:
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "TIME_SERIES_DAILY",
                "symbol": symbol,
                "outputsize": outputsize,  # "compact" = 100 days, "full" = 20+ years
                "apikey": settings.ALPHA_VANTAGE_API_KEY
            }
            
            response = requests.get(url, params=params, timeout=30)
            data = response.json()
            
            if "Time Series (Daily)" not in data:
                print(f"Alpha Vantage: No daily data for {symbol}")
                if "Note" in data:
                    print(f"Alpha Vantage rate limit: {data['Note']}")
                return pd.DataFrame()
            
            time_series = data["Time Series (Daily)"]
            
            rows = []
            for date_str, values in time_series.items():
                rows.append({
                    "timestamp": pd.to_datetime(date_str),
                    "open": float(values["1. open"]),
                    "high": float(values["2. high"]),
                    "low": float(values["3. low"]),
                    "close": float(values["4. close"]),
                    "volume": int(values["5. volume"])
                })
            
            df = pd.DataFrame(rows)
            df.sort_values("timestamp", inplace=True)
            df.reset_index(drop=True, inplace=True)
            
            print(f"Alpha Vantage: Fetched {len(df)} bars for {symbol}")
            return df
            
        except Exception as e:
            print(f"Alpha Vantage historical data failed for {symbol}: {e}")
            return pd.DataFrame()
    
    @staticmethod
    def _fetch_historical_alpaca(
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        period: str = "1y",
    ) -> pd.DataFrame:
        """Fetch historical data from Alpaca (free, unlimited for US stocks)."""
        try:
            from app.services.alpaca_client import alpaca_client
            df = alpaca_client.get_historical_bars_df(symbol, start_date, end_date, period)
            if not df.empty:
                print(f"Fetched {len(df)} bars for {symbol} via Alpaca")
            return df
        except Exception as e:
            print(f"Alpaca historical failed for {symbol}: {e}")
            return pd.DataFrame()

    @staticmethod
    def fetch_historical_data(
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        period: str = "1y"
    ) -> pd.DataFrame:
        """Fetch historical OHLCV data — yfinance → Alpaca → Alpha Vantage"""

        # Try yfinance first (works without API key)
        print(f"Fetching data for {symbol} via yfinance...")
        try:
            ticker = yf.Ticker(yahoo_symbol(symbol))

            if start_date and end_date:
                df = ticker.history(start=start_date, end=end_date)
            else:
                df = ticker.history(period=period)

            if df.empty:
                print(f"{symbol}: yfinance returned no data, trying Alpaca...")
                # Fallback 1: Alpaca (free historical bars)
                df = DataFetcher._fetch_historical_alpaca(symbol, start_date, end_date, period)
                if not df.empty:
                    if start_date:
                        df = df[df["timestamp"] >= pd.to_datetime(start_date)]
                    if end_date:
                        df = df[df["timestamp"] <= pd.to_datetime(end_date)]
                    return df

                print(f"{symbol}: Alpaca returned no data, trying Alpha Vantage...")
                # Fallback 2: Alpha Vantage
                df = DataFetcher.fetch_historical_data_alpha_vantage(symbol, "compact")
                if not df.empty:
                    if start_date:
                        df = df[df["timestamp"] >= pd.to_datetime(start_date)]
                    if end_date:
                        df = df[df["timestamp"] <= pd.to_datetime(end_date)]
                    return df

                print(f"{symbol}: No price data found from any source")
                return pd.DataFrame()

            # Reset index to make Date a column
            df.reset_index(inplace=True)
            df.rename(columns={
                "Date": "timestamp",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume"
            }, inplace=True)

            print(f"Fetched {len(df)} bars for {symbol} via yfinance")
            return df
        except Exception as e:
            print(f"yfinance failed for {symbol}: {e}")
            # Try Alpaca, then Alpha Vantage
            df = DataFetcher._fetch_historical_alpaca(symbol, start_date, end_date, period)
            if not df.empty:
                return df
            df = DataFetcher.fetch_historical_data_alpha_vantage(symbol, "compact")
            if not df.empty:
                print(f"Fetched {len(df)} bars for {symbol} via Alpha Vantage")
            return df
    
    @staticmethod
    def sync_symbol_to_db(db: Session, symbol: str) -> Symbol:
        """Sync symbol information to database.

        Raises UnknownTickerError (HTTP 404) when the ticker is malformed or
        unknown upstream, so user input never creates junk Symbol rows.
        """
        from app.services.ticker_validation import (
            UnknownTickerError, normalize_ticker, ticker_exists_upstream,
        )

        symbol = normalize_ticker(symbol)
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol).first()
        
        if not db_symbol:
            if not ticker_exists_upstream(symbol):
                raise UnknownTickerError(symbol)
            info = DataFetcher.fetch_symbol_info(symbol)
            info["symbol"] = symbol
            db_symbol = Symbol(**info)
            db.add(db_symbol)
            db.commit()
            db.refresh(db_symbol)
        
        return db_symbol
    
    @staticmethod
    def sync_price_data_to_db(
        db: Session,
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> int:
        """Sync price data to database, returns number of bars inserted"""
        
        # Get or create symbol
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol)
        
        # Fetch data
        df = DataFetcher.fetch_historical_data(symbol, start_date, end_date)
        
        if df.empty:
            print(f"No data returned for {symbol}")
            return 0
        
        print(f"Got {len(df)} bars for {symbol}, inserting to DB...")
        
        # Get existing timestamps for this symbol to avoid duplicates
        existing_result = db.query(PriceBar.timestamp).filter(PriceBar.symbol_id == db_symbol.id)
        existing_timestamps = {row[0].date() if hasattr(row[0], 'date') else row[0] for row in existing_result}
        newest_existing = max(existing_timestamps) if existing_timestamps else None

        # Only store bars for sessions that have closed. A bar fetched while the
        # session is still trading is partial (SPY 2026-11-25 was stored with
        # ~40% of the day's volume and a mid-session close) and, because
        # existing dates were never rewritten, the chart kept it for good.
        closed_through = last_completed_session_date()

        # Insert new bars using bulk insert for speed
        count = 0
        bars_to_insert = []
        refreshed = 0
        
        for _, row in df.iterrows():
            # Convert timestamp to datetime, normalize to UTC
            ts = row["timestamp"]
            if hasattr(ts, 'to_pydatetime'):
                ts = ts.to_pydatetime()
            # Ensure UTC: convert tz-aware to UTC, assume UTC if naive
            if hasattr(ts, 'tzinfo') and ts.tzinfo is not None:
                import pytz
                ts = ts.astimezone(pytz.UTC)

            # Make timezone-naive for comparison
            ts_date = ts.date() if hasattr(ts, 'date') else ts
            
            if ts_date > closed_through:
                continue  # session still open: bar is not final yet

            if ts_date in existing_timestamps:
                # Rewrite the newest stored bar: it may have been saved partial
                # before this fix, or upstream revised it.
                if newest_existing is not None and ts_date >= newest_existing:
                    refreshed += DataFetcher._refresh_bar(db, db_symbol.id, ts_date, row)
                continue
            
            bar = PriceBar(
                symbol_id=db_symbol.id,
                timestamp=ts,
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=int(row["volume"])
            )
            bars_to_insert.append(bar)
            count += 1
        
        if bars_to_insert:
            db.bulk_save_objects(bars_to_insert)
        if bars_to_insert or refreshed:
            db.commit()
        if bars_to_insert:
            print(f"Inserted {count} new bars for {symbol}")
        else:
            print(f"All {len(df)} bars already exist for {symbol}")

        # Callers treat a non-zero return as "stored data changed, re-query".
        return count + refreshed

    @staticmethod
    def _refresh_bar(db: Session, symbol_id: int, bar_date, row) -> int:
        """Overwrite the stored daily bar for `bar_date` if upstream differs. Returns 1 when changed."""
        day_start = datetime(bar_date.year, bar_date.month, bar_date.day)
        candidates = (
            db.query(PriceBar)
            .filter(
                PriceBar.symbol_id == symbol_id,
                PriceBar.timestamp >= day_start,
                PriceBar.timestamp < day_start + timedelta(days=1),
            )
            .all()
        )
        if not candidates:
            return 0
        bar = candidates[0]
        fresh = {
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": int(row["volume"]),
        }
        if all(getattr(bar, k) == v for k, v in fresh.items()):
            return 0
        for k, v in fresh.items():
            setattr(bar, k, v)
        return 1
