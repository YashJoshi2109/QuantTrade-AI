"""
Finnhub API integration for real-time market data
API Key: d60jvp1r01qto1rdeangd60jvp1r01qto1rdeao0
Docs: https://finnhub.io/docs/api

Rate limited to 60 calls/minute with intelligent caching
"""
import requests
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import time
from app.services.rate_limiter import rate_limited_api_call, CACHE_TTL


class FinnhubFetcher:
    """Fetch market data from Finnhub API"""
    
    BASE_URL = "https://finnhub.io/api/v1"
    API_KEY = "d60jvp1r01qto1rdeangd60jvp1r01qto1rdeao0"
    
    @staticmethod
    def _make_request(endpoint: str, params: Optional[Dict] = None) -> Dict:
        """Make API request with error handling"""
        if params is None:
            params = {}
        params['token'] = FinnhubFetcher.API_KEY
        
        try:
            response = requests.get(
                f"{FinnhubFetcher.BASE_URL}/{endpoint}",
                params=params,
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Finnhub API error ({endpoint}): {e}")
            return {}
    
    @staticmethod
    def get_quote(symbol: str, priority: str = 'high') -> Dict:
        """
        Get real-time quote for a symbol
        Returns: {'c': current_price, 'h': high, 'l': low, 'o': open, 'pc': prev_close, 't': timestamp}
        Priority: 'high' for research/markets, 'normal' for others
        """
        def _fetch():
            return FinnhubFetcher._make_request("quote", {"symbol": symbol})
        
        return rate_limited_api_call(
            endpoint='quote',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['quote'],
            priority=priority
        )
    
    @staticmethod
    def get_market_news(category: str = "general", limit: int = 20, priority: str = 'high') -> List[Dict]:
        """
        Get latest market news
        Categories: general, forex, crypto, merger
        Returns list of: {'category', 'datetime', 'headline', 'id', 'image', 'related', 'source', 'summary', 'url'}
        Priority: 'high' for dashboard/markets, 'normal' for others
        """
        def _fetch():
            data = FinnhubFetcher._make_request("news", {"category": category})
            return data[:limit] if isinstance(data, list) else []
        
        return rate_limited_api_call(
            endpoint='market_news',
            params={'category': category, 'limit': limit},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['market_news'],
            priority=priority
        )
    
    @staticmethod
    def get_company_news(symbol: str, from_date: Optional[str] = None, to_date: Optional[str] = None, priority: str = 'high') -> List[Dict]:
        """
        Get company-specific news
        Date format: YYYY-MM-DD
        Returns list of news articles
        Priority: 'high' for research page, 'normal' for others
        """
        if not from_date:
            from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        if not to_date:
            to_date = datetime.now().strftime("%Y-%m-%d")
        
        def _fetch():
            data = FinnhubFetcher._make_request("company-news", {
                "symbol": symbol,
                "from": from_date,
                "to": to_date
            })
            return data if isinstance(data, list) else []
        
        return rate_limited_api_call(
            endpoint='company_news',
            params={'symbol': symbol, 'from': from_date, 'to': to_date},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['company_news'],
            priority=priority
        )
    
    @staticmethod
    def get_company_profile(symbol: str, priority: str = 'normal') -> Dict:
        """
        Get company profile/fundamentals
        Returns: {'country', 'currency', 'exchange', 'finnhubIndustry', 'ipo', 'logo', 
                  'marketCapitalization', 'name', 'phone', 'shareOutstanding', 'ticker', 'weburl'}
        Priority: 'normal' - cached for 1 hour
        """
        def _fetch():
            return FinnhubFetcher._make_request("stock/profile2", {"symbol": symbol})
        
        return rate_limited_api_call(
            endpoint='company_profile',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['company_profile'],
            priority=priority
        )
    
    @staticmethod
    def get_basic_financials(symbol: str, metric: str = "all", priority: str = 'normal') -> Dict:
        """
        Get basic financial metrics
        Metrics: all, price, valuation, growth, margin, management, financialStrength
        Priority: 'normal' - cached for 1 hour
        """
        def _fetch():
            return FinnhubFetcher._make_request("stock/metric", {
                "symbol": symbol,
                "metric": metric
            })
        
        return rate_limited_api_call(
            endpoint='basic_financials',
            params={'symbol': symbol, 'metric': metric},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['basic_financials'],
            priority=priority
        )
    
    @staticmethod
    def get_recommendation_trends(symbol: str, priority: str = 'normal') -> List[Dict]:
        """
        Get analyst recommendation trends with rate limiting
        Args:
            symbol: Stock symbol
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: [{'buy': N, 'hold': N, 'period': 'YYYY-MM-01', 'sell': N, 'strongBuy': N, 'strongSell': N, 'symbol': 'AAPL'}]
        """
        def _fetch():
            data = FinnhubFetcher._make_request("stock/recommendation", {"symbol": symbol})
            return data if isinstance(data, list) else []
        
        return rate_limited_api_call(
            endpoint='recommendations',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['recommendations'],
            priority=priority
        )
    
    @staticmethod
    def get_price_target(symbol: str, priority: str = 'normal') -> Dict:
        """
        Get price target from analysts with rate limiting
        Args:
            symbol: Stock symbol
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: {'lastUpdated', 'symbol', 'targetHigh', 'targetLow', 'targetMean', 'targetMedian'}
        """
        def _fetch():
            return FinnhubFetcher._make_request("stock/price-target", {"symbol": symbol})
        
        return rate_limited_api_call(
            endpoint='price_target',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['recommendations'],
            priority=priority
        )
    
    @staticmethod
    def get_earnings_calendar(from_date: Optional[str] = None, to_date: Optional[str] = None, symbol: Optional[str] = None) -> Dict:
        """
        Get earnings calendar
        Date format: YYYY-MM-DD
        """
        if not from_date:
            from_date = datetime.now().strftime("%Y-%m-%d")
        if not to_date:
            to_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        params = {"from": from_date, "to": to_date}
        if symbol:
            params["symbol"] = symbol
        
        data = FinnhubFetcher._make_request("calendar/earnings", params)
        return data
    
    @staticmethod
    def get_peers(symbol: str, priority: str = 'normal') -> List[str]:
        """
        Get company peers (similar companies) with rate limiting
        Args:
            symbol: Stock symbol
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: ['MSFT', 'GOOGL', 'AMZN', ...]
        """
        def _fetch():
            data = FinnhubFetcher._make_request("stock/peers", {"symbol": symbol})
            return data if isinstance(data, list) else []
        
        return rate_limited_api_call(
            endpoint='peers',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['company_profile'],  # Cache peers for 1 hour like profile
            priority=priority
        )
    
    @staticmethod
    def get_sentiment(symbol: str, priority: str = 'normal') -> Dict:
        """
        Get social sentiment data from Reddit, Twitter, etc. with rate limiting
        Args:
            symbol: Stock symbol
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: {'buzz', 'companyNewsScore', 'sectorAverageBullishPercent', 'sectorAverageNewsScore', 'sentiment', 'symbol'}
        """
        def _fetch():
            return FinnhubFetcher._make_request("news-sentiment", {"symbol": symbol})
        
        return rate_limited_api_call(
            endpoint='sentiment',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['sentiment'],
            priority=priority
        )
    
    @staticmethod
    def get_market_status(exchange: str = "US", priority: str = 'normal') -> Dict:
        """
        Get market status (open/closed) with rate limiting
        Args:
            exchange: Exchange code (default: US)
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: {'exchange', 'holiday', 'isOpen', 'session', 't'}
        """
        def _fetch():
            return FinnhubFetcher._make_request("stock/market-status", {"exchange": exchange})
        
        return rate_limited_api_call(
            endpoint='market_status',
            params={'exchange': exchange},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['market_status'],
            priority=priority
        )
    
    @staticmethod
    def get_economic_calendar(from_date: Optional[str] = None, to_date: Optional[str] = None) -> Dict:
        """
        Get economic calendar (events that may impact markets)
        """
        if not from_date:
            from_date = datetime.now().strftime("%Y-%m-%d")
        if not to_date:
            to_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        data = FinnhubFetcher._make_request("calendar/economic", {
            "from": from_date,
            "to": to_date
        })
        return data
    
    @staticmethod
    def search_symbols(query: str, priority: str = 'normal') -> Dict:
        """
        Search for symbols with rate limiting
        Args:
            query: Search query
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: {'count', 'result': [{'description', 'displaySymbol', 'symbol', 'type'}]}
        """
        def _fetch():
            return FinnhubFetcher._make_request("search", {"q": query})
        
        return rate_limited_api_call(
            endpoint='search',
            params={'q': query},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['company_profile'],  # Cache search results for 1 hour
            priority=priority
        )
    
    @staticmethod
    def get_insider_transactions(symbol: str, priority: str = 'normal') -> Dict:
        """
        Get insider transactions with rate limiting
        Args:
            symbol: Stock symbol
            priority: 'high' or 'normal' - high will wait, normal will skip if rate limited
        Returns: {'data': [{'name', 'share', 'change', 'filingDate', 'transactionDate', 'transactionCode', 'transactionPrice'}], 'symbol'}
        """
        def _fetch():
            return FinnhubFetcher._make_request("stock/insider-transactions", {"symbol": symbol})
        
        return rate_limited_api_call(
            endpoint='insider_transactions',
            params={'symbol': symbol},
            api_function=_fetch,
            cache_ttl=CACHE_TTL['company_news'],  # Cache insider data for 5 minutes
            priority=priority
        )
    
    @staticmethod
    def get_etfs_holdings(isin: str) -> Dict:
        """
        Get ETF holdings
        """
        data = FinnhubFetcher._make_request("etf/holdings", {"isin": isin})
        return data
    
    @staticmethod
    def get_crypto_candles(symbol: str, resolution: str = "D", from_ts: Optional[int] = None, to_ts: Optional[int] = None) -> Dict:
        """
        Get crypto candles (OHLCV data)
        Symbol format: BINANCE:BTCUSDT
        Resolution: 1, 5, 15, 30, 60, D, W, M
        """
        if not from_ts:
            from_ts = int((datetime.now() - timedelta(days=30)).timestamp())
        if not to_ts:
            to_ts = int(datetime.now().timestamp())
        
        data = FinnhubFetcher._make_request("crypto/candle", {
            "symbol": symbol,
            "resolution": resolution,
            "from": from_ts,
            "to": to_ts
        })
        return data
