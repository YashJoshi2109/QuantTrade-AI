"""
Rate limiter for Finnhub API with intelligent caching
60 calls/minute limit management
"""
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Callable
import json
import hashlib


class RateLimiter:
    """
    Token bucket rate limiter for Finnhub API
    Limit: 60 calls per minute
    """
    def __init__(self, max_calls: int = 60, time_window: int = 60):
        self.max_calls = max_calls
        self.time_window = time_window  # seconds
        self.calls = deque()
    
    def can_make_call(self) -> bool:
        """Check if we can make an API call within rate limit"""
        now = time.time()
        
        # Remove calls older than time window
        while self.calls and self.calls[0] < now - self.time_window:
            self.calls.popleft()
        
        return len(self.calls) < self.max_calls
    
    def record_call(self):
        """Record that an API call was made"""
        self.calls.append(time.time())
    
    def wait_time(self) -> float:
        """Get seconds to wait before next call is available"""
        if len(self.calls) < self.max_calls:
            return 0.0
        
        now = time.time()
        oldest_call = self.calls[0]
        wait = self.time_window - (now - oldest_call)
        return max(0.0, wait)
    
    def get_remaining_calls(self) -> int:
        """Get number of calls remaining in current window"""
        now = time.time()
        
        # Remove expired calls
        while self.calls and self.calls[0] < now - self.time_window:
            self.calls.popleft()
        
        return self.max_calls - len(self.calls)


class APICache:
    """
    Simple in-memory cache for API responses
    Reduces redundant API calls
    """
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}
    
    def _make_key(self, endpoint: str, params: Dict) -> str:
        """Generate cache key from endpoint and params"""
        params_str = json.dumps(params, sort_keys=True)
        return hashlib.md5(f"{endpoint}:{params_str}".encode()).hexdigest()
    
    def get(self, endpoint: str, params: Dict, ttl: int) -> Optional[Any]:
        """Get cached response if not expired"""
        key = self._make_key(endpoint, params)
        
        if key in self.cache:
            cached = self.cache[key]
            if datetime.now() < cached['expires']:
                return cached['data']
            else:
                # Expired, remove from cache
                del self.cache[key]
        
        return None
    
    def set(self, endpoint: str, params: Dict, data: Any, ttl: int):
        """Cache response with TTL (seconds)"""
        key = self._make_key(endpoint, params)
        self.cache[key] = {
            'data': data,
            'expires': datetime.now() + timedelta(seconds=ttl),
            'cached_at': datetime.now()
        }
    
    def clear(self):
        """Clear all cached data"""
        self.cache.clear()
    
    def cleanup_expired(self):
        """Remove expired entries from cache"""
        now = datetime.now()
        expired_keys = [
            key for key, value in self.cache.items()
            if now >= value['expires']
        ]
        for key in expired_keys:
            del self.cache[key]


# Global instances
finnhub_rate_limiter = RateLimiter(max_calls=60, time_window=60)
finnhub_cache = APICache()


# Cache TTL configurations (in seconds)
CACHE_TTL = {
    'quote': 5,              # Real-time quotes: 5 seconds
    'company_profile': 3600, # Company profile: 1 hour
    'basic_financials': 3600,# Financials: 1 hour
    'company_news': 300,     # Company news: 5 minutes
    'market_news': 180,      # Market news: 3 minutes
    'recommendation': 1800,  # Recommendations: 30 minutes
    'price_target': 1800,    # Price targets: 30 minutes
    'sentiment': 600,        # Sentiment: 10 minutes
    'peers': 3600,           # Peers: 1 hour
    'market_status': 60,     # Market status: 1 minute
    'economic_calendar': 3600, # Economic calendar: 1 hour
    'earnings_calendar': 3600, # Earnings: 1 hour
    'insider': 3600,         # Insider transactions: 1 hour
}


def rate_limited_api_call(
    endpoint: str,
    params: Dict,
    api_function: Callable,
    cache_ttl: Optional[int] = None,
    priority: str = 'normal'
) -> Any:
    """
    Make rate-limited API call with caching
    
    Args:
        endpoint: API endpoint name (e.g., 'quote', 'company_news')
        params: API parameters
        api_function: Function to call if cache miss
        cache_ttl: Cache TTL in seconds (None = no cache)
        priority: 'high' for research/markets pages, 'normal' for others
    
    Returns:
        API response or cached data
    """
    # Try cache first
    if cache_ttl:
        cached_data = finnhub_cache.get(endpoint, params, cache_ttl)
        if cached_data is not None:
            return cached_data
    
    # Check rate limit
    if not finnhub_rate_limiter.can_make_call():
        wait_time = finnhub_rate_limiter.wait_time()
        
        # For low priority, return cached data even if expired or empty dict
        if priority == 'normal':
            print(f"⚠️  Rate limit reached. Skipping low-priority call to {endpoint}")
            return {}
        
        # For high priority, wait if needed
        if priority == 'high' and wait_time > 0:
            print(f"⏳ Rate limit reached. Waiting {wait_time:.1f}s for high-priority {endpoint}")
            time.sleep(wait_time)
    
    # Make API call
    try:
        finnhub_rate_limiter.record_call()
        remaining = finnhub_rate_limiter.get_remaining_calls()
        print(f"🔥 Finnhub API: {endpoint} | Remaining calls: {remaining}/60")
        
        result = api_function()
        
        # Cache result
        if cache_ttl:
            finnhub_cache.set(endpoint, params, result, cache_ttl)
        
        return result
    
    except Exception as e:
        print(f"❌ Finnhub API error ({endpoint}): {e}")
        return {}


def get_api_stats() -> Dict[str, Any]:
    """Get current API usage statistics"""
    return {
        'remaining_calls': finnhub_rate_limiter.get_remaining_calls(),
        'max_calls': finnhub_rate_limiter.max_calls,
        'wait_time': finnhub_rate_limiter.wait_time(),
        'cache_size': len(finnhub_cache.cache),
    }
