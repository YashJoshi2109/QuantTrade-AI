"""
Enhanced data fetcher with Finviz integration and real-time capabilities
Combines Alpha Vantage, yfinance, and Finviz for comprehensive market data
"""
import yfinance as yf
import pandas as pd
import requests
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from app.models.symbol import Symbol
from app.models.price import PriceBar
from app.models.fundamentals import Fundamentals
from app.models.realtime_quote import RealtimeQuote, MarketIndex
from app.services.finviz_fetcher import FinvizFetcher
from app.config import settings
from sqlalchemy.orm import Session


class EnhancedDataFetcher:
    """
    Enhanced data fetcher with multiple sources for speed and reliability
    Priority: Finviz (fast) -> Alpha Vantage (reliable) -> yfinance (fallback)
    """
    
    @staticmethod
    def fetch_realtime_quote(symbol: str, db: Session) -> Dict:
        """
        Fetch real-time quote with sub-second priority
        Uses fastest available source
        """
        start_time = datetime.utcnow()
        
        # Try Finviz first (fastest for single quotes)
        try:
            fundamentals = FinvizFetcher.fetch_stock_fundamentals(symbol)
            if fundamentals and 'price' in fundamentals and fundamentals['price']:
                latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                
                quote_data = {
                    "symbol": symbol.upper(),
                    "last_price": fundamentals['price'],
                    "change": fundamentals.get('change', ''),
                    "volume": fundamentals.get('volume'),
                    "high": fundamentals.get('52w_high'),
                    "low": fundamentals.get('52w_low'),
                    "market_cap": fundamentals.get('market_cap'),
                    "pe_ratio": fundamentals.get('pe_ratio'),
                    "data_source": "finviz",
                    "latency_ms": latency_ms,
                    "timestamp": datetime.utcnow()
                }
                
                # Update database
                EnhancedDataFetcher._update_realtime_quote(db, symbol, quote_data)
                return quote_data
        except Exception as e:
            print(f"Finviz quote error for {symbol}: {e}")
        
        # Fallback to Alpha Vantage
        if settings.ALPHA_VANTAGE_API_KEY:
            try:
                url = "https://www.alphavantage.co/query"
                params = {
                    "function": "GLOBAL_QUOTE",
                    "symbol": symbol.upper(),
                    "apikey": settings.ALPHA_VANTAGE_API_KEY
                }
                response = requests.get(url, params=params, timeout=5)
                data = response.json()
                
                if "Global Quote" in data and data["Global Quote"]:
                    quote = data["Global Quote"]
                    latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
                    
                    quote_data = {
                        "symbol": symbol.upper(),
                        "last_price": float(quote.get("05. price", 0)),
                        "change": float(quote.get("09. change", 0)),
                        "change_percent": float(quote.get("10. change percent", "0%").rstrip('%')),
                        "volume": int(quote.get("06. volume", 0)),
                        "high": float(quote.get("03. high", 0)),
                        "low": float(quote.get("04. low", 0)),
                        "open": float(quote.get("02. open", 0)),
                        "previous_close": float(quote.get("08. previous close", 0)),
                        "data_source": "alphavantage",
                        "latency_ms": latency_ms,
                        "timestamp": datetime.utcnow()
                    }
                    
                    EnhancedDataFetcher._update_realtime_quote(db, symbol, quote_data)
                    return quote_data
            except Exception as e:
                print(f"Alpha Vantage quote error for {symbol}: {e}")
        
        # Final fallback to yfinance
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            
            quote_data = {
                "symbol": symbol.upper(),
                "last_price": info.get('currentPrice') or info.get('regularMarketPrice', 0),
                "change": info.get('regularMarketChange', 0),
                "change_percent": info.get('regularMarketChangePercent', 0),
                "volume": info.get('regularMarketVolume', 0),
                "high": info.get('dayHigh', 0),
                "low": info.get('dayLow', 0),
                "open": info.get('regularMarketOpen', 0),
                "previous_close": info.get('previousClose', 0),
                "data_source": "yfinance",
                "latency_ms": latency_ms,
                "timestamp": datetime.utcnow()
            }
            
            EnhancedDataFetcher._update_realtime_quote(db, symbol, quote_data)
            return quote_data
            
        except Exception as e:
            print(f"yfinance quote error for {symbol}: {e}")
            return {"error": "Failed to fetch quote", "symbol": symbol}
    
    @staticmethod
    def _update_realtime_quote(db: Session, symbol: str, quote_data: Dict):
        """Update or create realtime quote in database"""
        try:
            db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
            if not db_symbol:
                return
            
            quote = db.query(RealtimeQuote).filter(
                RealtimeQuote.symbol_id == db_symbol.id
            ).first()
            
            if not quote:
                quote = RealtimeQuote(symbol_id=db_symbol.id)
                db.add(quote)
            
            # Update fields
            quote.last_price = quote_data.get('last_price', 0)
            quote.open_price = quote_data.get('open')
            quote.high_price = quote_data.get('high')
            quote.low_price = quote_data.get('low')
            quote.previous_close = quote_data.get('previous_close')
            quote.volume = quote_data.get('volume')
            quote.change = quote_data.get('change')
            quote.change_percent = quote_data.get('change_percent')
            quote.data_source = quote_data.get('data_source')
            quote.latency_ms = quote_data.get('latency_ms')
            quote.quote_timestamp = quote_data.get('timestamp', datetime.utcnow())
            
            db.commit()
        except Exception as e:
            print(f"Error updating realtime quote: {e}")
            db.rollback()
    
    @staticmethod
    def sync_fundamentals(symbol: str, db: Session) -> Fundamentals:
        """
        Sync comprehensive fundamentals from Finviz
        Much faster than yfinance for bulk data
        """
        try:
            # Get symbol
            db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
            if not db_symbol:
                # Create symbol if doesn't exist
                from app.services.data_fetcher import DataFetcher
                db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
            
            # Fetch from Finviz
            data = FinvizFetcher.fetch_stock_fundamentals(symbol)
            
            # Check if fundamentals exist
            fundamentals = db.query(Fundamentals).filter(
                Fundamentals.symbol_id == db_symbol.id
            ).first()
            
            if not fundamentals:
                fundamentals = Fundamentals(symbol_id=db_symbol.id)
                db.add(fundamentals)
            
            # Update all fields
            fundamentals.company_name = data.get('company_name')
            fundamentals.sector = data.get('sector')
            fundamentals.industry = data.get('industry')
            fundamentals.country = data.get('country')
            
            # Price metrics
            fundamentals.price = data.get('price')
            fundamentals.change = data.get('change')
            fundamentals.volume = data.get('volume')
            fundamentals.avg_volume = data.get('avg_volume')
            
            # Valuation
            fundamentals.market_cap = data.get('market_cap')
            fundamentals.pe_ratio = data.get('pe_ratio')
            fundamentals.forward_pe = data.get('forward_pe')
            fundamentals.peg_ratio = data.get('peg_ratio')
            fundamentals.price_to_sales = data.get('price_to_sales')
            fundamentals.price_to_book = data.get('price_to_book')
            
            # Dividends
            fundamentals.dividend_yield = data.get('dividend_yield')
            
            # Profitability
            fundamentals.profit_margin = data.get('profit_margin')
            fundamentals.operating_margin = data.get('operating_margin')
            fundamentals.gross_margin = data.get('gross_margin')
            fundamentals.roa = data.get('roa')
            fundamentals.roe = data.get('roe')
            fundamentals.roi = data.get('roi')
            
            # Financial health
            fundamentals.debt_to_equity = data.get('debt_to_equity')
            fundamentals.current_ratio = data.get('current_ratio')
            fundamentals.quick_ratio = data.get('quick_ratio')
            
            # Performance
            fundamentals.week_52_high = data.get('52w_high')
            fundamentals.week_52_low = data.get('52w_low')
            fundamentals.rsi = data.get('rsi')
            fundamentals.beta = data.get('beta')
            fundamentals.atr = data.get('atr')
            
            # Earnings
            fundamentals.eps = data.get('eps')
            fundamentals.eps_next_quarter = data.get('eps_next_quarter')
            fundamentals.eps_next_year = data.get('eps_next_year')
            fundamentals.earnings_date = data.get('earnings_date')
            
            # Trading
            fundamentals.shares_outstanding = data.get('shares_outstanding')
            fundamentals.shares_float = data.get('shares_float')
            fundamentals.short_float = data.get('short_float')
            fundamentals.short_ratio = data.get('short_ratio')
            fundamentals.insider_ownership = data.get('insider_ownership')
            fundamentals.institutional_ownership = data.get('institutional_ownership')
            
            # Analyst
            fundamentals.target_price = data.get('target_price')
            fundamentals.recommendation = data.get('recommendation')
            
            fundamentals.fetched_at = datetime.utcnow()
            
            db.commit()
            db.refresh(fundamentals)
            return fundamentals
            
        except Exception as e:
            print(f"Error syncing fundamentals for {symbol}: {e}")
            db.rollback()
            raise
    
    @staticmethod
    def sync_market_indices(db: Session):
        """Sync major market indices (S&P 500, NASDAQ, DOW)"""
        indices = {
            "^GSPC": "S&P 500",
            "^IXIC": "NASDAQ Composite",
            "^DJI": "Dow Jones Industrial Average"
        }
        
        for symbol, name in indices.items():
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info
                hist = ticker.history(period="1d")
                
                if hist.empty:
                    continue
                
                latest = hist.iloc[-1]
                
                index_obj = db.query(MarketIndex).filter(
                    MarketIndex.index_symbol == symbol
                ).first()
                
                if not index_obj:
                    index_obj = MarketIndex(index_symbol=symbol, index_name=name)
                    db.add(index_obj)
                
                index_obj.last_price = latest['Close']
                index_obj.open_price = latest['Open']
                index_obj.high_price = latest['High']
                index_obj.low_price = latest['Low']
                index_obj.previous_close = info.get('previousClose', 0)
                index_obj.change = info.get('regularMarketChange', 0)
                index_obj.change_percent = info.get('regularMarketChangePercent', 0)
                index_obj.quote_timestamp = datetime.utcnow()
                
                db.commit()
                
            except Exception as e:
                print(f"Error syncing index {symbol}: {e}")
                db.rollback()
    
    @staticmethod
    def bulk_sync_sp500(db: Session, limit: Optional[int] = None):
        """Bulk sync S&P 500 stocks"""
        symbols = FinvizFetcher.get_sp500_symbols()
        
        if limit:
            symbols = symbols[:limit]
        
        print(f"Syncing {len(symbols)} S&P 500 stocks...")
        
        from app.services.data_fetcher import DataFetcher
        
        for i, symbol in enumerate(symbols, 1):
            try:
                print(f"[{i}/{len(symbols)}] Syncing {symbol}...")
                
                # Sync symbol and prices
                db_symbol = DataFetcher.sync_symbol_to_db(db, symbol)
                DataFetcher.sync_price_data_to_db(db, symbol)
                
                # Sync fundamentals from Finviz
                EnhancedDataFetcher.sync_fundamentals(symbol, db)
                
                print(f"✅ {symbol} synced")
                
            except Exception as e:
                print(f"❌ Error syncing {symbol}: {e}")
                continue
        
        print(f"✅ Bulk sync complete!")
    
    @staticmethod
    def bulk_sync_nasdaq(db: Session, limit: Optional[int] = None):
        """Bulk sync NASDAQ 100 stocks"""
        symbols = FinvizFetcher.get_nasdaq_symbols()
        
        if limit:
            symbols = symbols[:limit]
        
        print(f"Syncing {len(symbols)} NASDAQ stocks...")
        
        from app.services.data_fetcher import DataFetcher
        
        for i, symbol in enumerate(symbols, 1):
            try:
                print(f"[{i}/{len(symbols)}] Syncing {symbol}...")
                
                db_symbol = DataFetcher.sync_symbol_to_db(db, symbol)
                DataFetcher.sync_price_data_to_db(db, symbol)
                EnhancedDataFetcher.sync_fundamentals(symbol, db)
                
                print(f"✅ {symbol} synced")
                
            except Exception as e:
                print(f"❌ Error syncing {symbol}: {e}")
                continue
        
        print(f"✅ Bulk sync complete!")
