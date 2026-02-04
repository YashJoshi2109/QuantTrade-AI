"""
Service for fetching market data from various sources
Uses Alpha Vantage as primary source, yfinance as fallback
"""
import yfinance as yf
import pandas as pd
import requests
from datetime import datetime, timedelta
from typing import List, Optional
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.config import settings
from sqlalchemy.orm import Session


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
            ticker = yf.Ticker(symbol)
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
    def fetch_historical_data(
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        period: str = "1y"
    ) -> pd.DataFrame:
        """Fetch historical OHLCV data - uses yfinance (primary), Alpha Vantage (secondary)"""
        
        # Try yfinance first (works without API key)
        print(f"Fetching data for {symbol} via yfinance...")
        try:
            ticker = yf.Ticker(symbol)
            
            if start_date and end_date:
                df = ticker.history(start=start_date, end=end_date)
            else:
                df = ticker.history(period=period)
            
            if df.empty:
                print(f"{symbol}: yfinance returned no data, trying Alpha Vantage...")
                # Fallback to Alpha Vantage
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
            # Try Alpha Vantage as last resort
            df = DataFetcher.fetch_historical_data_alpha_vantage(symbol, "compact")
            if not df.empty:
                print(f"Fetched {len(df)} bars for {symbol} via Alpha Vantage")
            return df
    
    @staticmethod
    def sync_symbol_to_db(db: Session, symbol: str) -> Symbol:
        """Sync symbol information to database"""
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol).first()
        
        if not db_symbol:
            info = DataFetcher.fetch_symbol_info(symbol)
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
        from sqlalchemy import text
        
        # Get or create symbol
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol)
        
        # Fetch data
        df = DataFetcher.fetch_historical_data(symbol, start_date, end_date)
        
        if df.empty:
            print(f"No data returned for {symbol}")
            return 0
        
        print(f"Got {len(df)} bars for {symbol}, inserting to DB...")
        
        # Get existing timestamps for this symbol to avoid duplicates
        existing_result = db.execute(
            text("SELECT timestamp FROM price_bars WHERE symbol_id = :sid"),
            {"sid": db_symbol.id}
        )
        existing_timestamps = {row[0].date() if hasattr(row[0], 'date') else row[0] for row in existing_result}
        
        # Insert new bars using bulk insert for speed
        count = 0
        bars_to_insert = []
        
        for _, row in df.iterrows():
            # Convert timestamp to datetime
            ts = row["timestamp"]
            if hasattr(ts, 'to_pydatetime'):
                ts = ts.to_pydatetime()
            
            # Make timezone-naive for comparison
            ts_date = ts.date() if hasattr(ts, 'date') else ts
            
            # Skip if already exists
            if ts_date in existing_timestamps:
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
            db.commit()
            print(f"Inserted {count} new bars for {symbol}")
        else:
            print(f"All {len(df)} bars already exist for {symbol}")
        
        return count
