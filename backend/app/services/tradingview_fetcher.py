"""
TradingView API integration for stock quotes (fallback data source)

TradingView provides public endpoints that can be used as a fallback
when other data sources fail or return null values.
"""
import httpx
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class TradingViewFetcher:
    """Fetch stock quotes from TradingView public API"""
    
    BASE_URL = "https://scanner.tradingview.com"
    
    @staticmethod
    async def get_quote(symbol: str) -> Optional[Dict[str, Any]]:
        """
        Fetch quote from TradingView using their scanner API.
        
        This uses TradingView's public scanner endpoint which provides
        real-time quotes for stocks.
        """
        try:
            symbol_upper = symbol.upper()
            
            # First, try to find the correct exchange using symbol search
            exchange = await TradingViewFetcher._find_exchange(symbol_upper)
            
            if exchange:
                quote = await TradingViewFetcher._fetch_from_scanner(exchange, symbol_upper)
                if quote and quote.get('price') and quote.get('price') > 0:
                    return quote
            
            # If exchange lookup failed, try common exchanges
            exchanges = ["NASDAQ", "NYSE", "AMEX"]
            for exch in exchanges:
                try:
                    quote = await TradingViewFetcher._fetch_from_scanner(exch, symbol_upper)
                    if quote and quote.get('price') and quote.get('price') > 0:
                        return quote
                except Exception as e:
                    logger.debug(f"TradingView {exch} failed for {symbol}: {e}")
                    continue
            
            return None
            
        except Exception as e:
            logger.error(f"TradingView fetch error for {symbol}: {e}")
            return None
    
    @staticmethod
    async def _find_exchange(symbol: str) -> Optional[str]:
        """Find the exchange for a symbol using TradingView's symbol search"""
        try:
            search_url = "https://symbol-search.tradingview.com/symbol_search"
            params = {
                "text": symbol,
                "lang": "en",
                "search_type": "stock",
                "domain": "production",
                "sort_by_country": "US"
            }
            
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": "https://www.tradingview.com/"
            }
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(search_url, params=params, headers=headers)
                if response.status_code != 200:
                    return None
                
                data = response.json()
                if not data or len(data) == 0:
                    return None
                
                # Get the first matching symbol
                symbol_info = data[0]
                exchange = symbol_info.get("exchange", "")
                
                # Map common exchange names
                exchange_map = {
                    "NASDAQ": "NASDAQ",
                    "NYSE": "NYSE",
                    "AMEX": "AMEX",
                    "NYSEARCA": "NYSE",  # ETFs
                    "NMS": "NASDAQ",
                    "NGM": "NASDAQ"
                }
                
                return exchange_map.get(exchange.upper(), exchange.upper() if exchange else None)
                
        except Exception as e:
            logger.debug(f"TradingView exchange lookup failed for {symbol}: {e}")
            return None
    
    @staticmethod
    async def _fetch_from_scanner(exchange: str, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch quote using TradingView scanner API"""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": "https://www.tradingview.com/"
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                # TradingView scanner endpoint for US markets
                quote_url = "https://scanner.tradingview.com/america/scan"
                
                # TradingView scanner uses a specific query format
                payload = {
                    "filter": [
                        {
                            "left": "name",
                            "operation": "match",
                            "right": symbol
                        }
                    ],
                    "options": {
                        "lang": "en"
                    },
                    "symbols": {
                        "query": {
                            "types": []
                        },
                        "tickers": []
                    },
                    "columns": [
                        "name",
                        "close",
                        "change",
                        "change_abs",
                        "volume",
                        "high",
                        "low",
                        "open"
                    ],
                    "sort": {
                        "sortBy": "volume",
                        "sortOrder": "desc"
                    },
                    "range": [0, 1]
                }
                
                quote_response = await client.post(quote_url, json=payload, headers=headers)
                if quote_response.status_code != 200:
                    return None
                
                quote_data = quote_response.json()
                if not quote_data or "data" not in quote_data or len(quote_data["data"]) == 0:
                    return None
                
                # Extract quote data
                data_row = quote_data["data"][0]
                if len(data_row) < 8:
                    return None
                
                # Parse the data array: [name, close, change, change_abs, volume, high, low, open]
                name = data_row[0] if len(data_row) > 0 else symbol
                close = data_row[1] if len(data_row) > 1 else None
                change = data_row[2] if len(data_row) > 2 else None
                change_abs = data_row[3] if len(data_row) > 3 else None
                volume = data_row[4] if len(data_row) > 4 else None
                high = data_row[5] if len(data_row) > 5 else None
                low = data_row[6] if len(data_row) > 6 else None
                open_price = data_row[7] if len(data_row) > 7 else None
                
                if not close or close <= 0:
                    return None
                
                # Calculate change percent if not provided
                change_percent = None
                if change is not None:
                    change_percent = change
                elif change_abs is not None and close:
                    change_percent = (change_abs / close) * 100 if close > 0 else 0
                
                previous_close = close - (change_abs or 0) if change_abs else close
                
                return {
                    "symbol": symbol.upper(),
                    "price": round(float(close), 2),
                    "change": round(float(change_abs or 0), 2),
                    "change_percent": round(float(change_percent or 0), 4),
                    "volume": int(volume or 0),
                    "high": round(float(high or close), 2),
                    "low": round(float(low or close), 2),
                    "open": round(float(open_price or close), 2),
                    "previous_close": round(float(previous_close), 2),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data_source": "tradingview"
                }
                
        except Exception as e:
            logger.debug(f"TradingView scanner error for {exchange}:{symbol}: {e}")
            return None
    
    @staticmethod
    async def _fetch_from_symbol_search(symbol: str) -> Optional[Dict[str, Any]]:
        """Alternative method: Use TradingView's symbol search and quote endpoints"""
        try:
            # Try to get quote using a simpler approach
            # TradingView has a public quote endpoint for their widgets
            url = f"https://www.tradingview.com/symbols/{symbol}/"
            
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml",
                "Referer": "https://www.tradingview.com/"
            }
            
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(url, headers=headers)
                
                # TradingView pages contain quote data in JSON-LD or script tags
                # This is a fallback - we'll use the scanner method primarily
                # For now, return None to use scanner method
                return None
                
        except Exception as e:
            logger.debug(f"TradingView symbol search error for {symbol}: {e}")
            return None
    
    @staticmethod
    async def get_quotes_bulk(symbols: list[str]) -> Dict[str, Dict[str, Any]]:
        """
        Fetch multiple quotes in parallel from TradingView.
        Returns dict mapping symbol to quote data.
        """
        import asyncio
        
        results = {}
        
        # Fetch quotes in parallel (limit concurrency to avoid rate limits)
        semaphore = asyncio.Semaphore(5)  # Max 5 concurrent requests
        
        async def fetch_with_semaphore(symbol: str):
            async with semaphore:
                quote = await TradingViewFetcher.get_quote(symbol)
                if quote:
                    results[symbol.upper()] = quote
        
        tasks = [fetch_with_semaphore(symbol) for symbol in symbols]
        await asyncio.gather(*tasks, return_exceptions=True)
        
        return results
