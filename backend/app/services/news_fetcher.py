"""
News fetching service
Supports multiple sources: NewsAPI, Alpha Vantage, Finnhub, or fallback data
"""
import requests
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from app.models.symbol import Symbol
from app.models.news import NewsArticle
from sqlalchemy.orm import Session
from app.config import settings


def ensure_naive_datetime(dt: datetime) -> datetime:
    """Convert any datetime to naive UTC datetime for consistent comparison"""
    if dt is None:
        return datetime.utcnow()
    if dt.tzinfo is not None:
        # Convert to UTC and remove timezone info
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class NewsFetcher:
    """Fetches news articles from various sources with real-time data"""
    
    # Company name mapping for better NewsAPI search
    COMPANY_NAMES = {
        "AAPL": "Apple",
        "MSFT": "Microsoft", 
        "GOOGL": "Google Alphabet",
        "AMZN": "Amazon",
        "TSLA": "Tesla",
        "META": "Meta Facebook",
        "NVDA": "NVIDIA",
        "JPM": "JPMorgan",
        "V": "Visa",
        "JNJ": "Johnson Johnson",
        "WMT": "Walmart",
        "PG": "Procter Gamble",
        "UNH": "UnitedHealth",
        "HD": "Home Depot",
        "MA": "Mastercard",
        "DIS": "Disney",
        "PYPL": "PayPal",
        "NFLX": "Netflix",
        "INTC": "Intel",
        "AMD": "AMD",
        "CRM": "Salesforce",
        "ADBE": "Adobe",
        "CSCO": "Cisco",
        "PEP": "PepsiCo",
        "KO": "Coca-Cola",
        "NKE": "Nike",
        "MRK": "Merck",
        "PFE": "Pfizer",
        "TMO": "Thermo Fisher",
        "ABBV": "AbbVie",
        "COST": "Costco",
        "AVGO": "Broadcom",
        "ACN": "Accenture",
        "MCD": "McDonalds",
        "DHR": "Danaher",
        "TXN": "Texas Instruments",
        "NEE": "NextEra Energy",
        "LIN": "Linde",
        "BMY": "Bristol-Myers",
        "UPS": "UPS",
        "QCOM": "Qualcomm",
        "LOW": "Lowes",
        "HON": "Honeywell",
        "SBUX": "Starbucks",
        "IBM": "IBM",
        "GE": "General Electric",
        "BA": "Boeing",
        "CAT": "Caterpillar",
        "GS": "Goldman Sachs",
        "MMM": "3M",
        "AXP": "American Express",
    }
    
    def __init__(self):
        self.alpha_vantage_key = settings.ALPHA_VANTAGE_API_KEY
        self.newsapi_key = settings.NEWSAPI_KEY
        self.finnhub_key = getattr(settings, 'FINNHUB_API_KEY', None)
    
    def fetch_newsapi_news(
        self,
        symbol: str,
        limit: int = 20
    ) -> List[Dict]:
        """Fetch real-time news from NewsAPI.org"""
        if not self.newsapi_key:
            print("NewsAPI key not configured")
            return []
        
        try:
            # Get company name for better search results
            company_name = self.COMPANY_NAMES.get(symbol.upper(), symbol)
            
            url = "https://newsapi.org/v2/everything"
            params = {
                "q": f'"{company_name}" OR "{symbol}" stock',
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": min(limit, 100),  # NewsAPI max is 100
                "apiKey": self.newsapi_key
            }
            
            print(f"Fetching news from NewsAPI for {symbol} ({company_name})...")
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") != "ok":
                print(f"NewsAPI error: {data.get('message', 'Unknown error')}")
                return []
            
            articles = []
            for item in data.get("articles", [])[:limit]:
                try:
                    # Parse ISO date format
                    published_str = item.get("publishedAt", "")
                    if published_str:
                        try:
                            dt = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
                            published_at = ensure_naive_datetime(dt)
                        except ValueError:
                            published_at = datetime.utcnow()
                    else:
                        published_at = datetime.utcnow()
                    
                    # Analyze sentiment from title and description
                    title = item.get("title", "")
                    description = item.get("description", "") or ""
                    sentiment = self._analyze_text_sentiment(f"{title} {description}")
                    
                    articles.append({
                        "title": title,
                        "content": description,
                        "source": item.get("source", {}).get("name", "NewsAPI"),
                        "url": item.get("url", ""),
                        "published_at": published_at,
                        "sentiment": sentiment,
                        "image_url": item.get("urlToImage", "")
                    })
                except Exception as e:
                    print(f"Error parsing NewsAPI article: {e}")
                    continue
            
            print(f"✓ Fetched {len(articles)} articles from NewsAPI")
            return articles
            
        except requests.exceptions.Timeout:
            print("NewsAPI request timed out")
            return []
        except requests.exceptions.RequestException as e:
            print(f"Error fetching NewsAPI news: {e}")
            return []
        except Exception as e:
            print(f"Unexpected error fetching NewsAPI news: {e}")
            return []

    def fetch_market_news(self, limit: int = 30) -> List[Dict]:
        """Fetch general market/finance news from NewsAPI"""
        if not self.newsapi_key:
            print("NewsAPI key not configured")
            return []
        
        try:
            url = "https://newsapi.org/v2/top-headlines"
            params = {
                "category": "business",
                "language": "en",
                "pageSize": min(limit, 100),
                "apiKey": self.newsapi_key
            }
            
            print("Fetching market news from NewsAPI...")
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") != "ok":
                print(f"NewsAPI error: {data.get('message', 'Unknown error')}")
                return []
            
            articles = []
            for item in data.get("articles", [])[:limit]:
                try:
                    published_str = item.get("publishedAt", "")
                    if published_str:
                        try:
                            dt = datetime.fromisoformat(published_str.replace("Z", "+00:00"))
                            published_at = ensure_naive_datetime(dt)
                        except ValueError:
                            published_at = datetime.utcnow()
                    else:
                        published_at = datetime.utcnow()
                    
                    title = item.get("title", "")
                    description = item.get("description", "") or ""
                    sentiment = self._analyze_text_sentiment(f"{title} {description}")
                    
                    articles.append({
                        "title": title,
                        "content": description,
                        "source": item.get("source", {}).get("name", "NewsAPI"),
                        "url": item.get("url", ""),
                        "published_at": published_at,
                        "sentiment": sentiment,
                        "image_url": item.get("urlToImage", "")
                    })
                except Exception as e:
                    continue
            
            print(f"✓ Fetched {len(articles)} market news articles")
            return articles
            
        except Exception as e:
            print(f"Error fetching market news: {e}")
            return []
    
    def _analyze_text_sentiment(self, text: str) -> str:
        """Simple keyword-based sentiment analysis"""
        text_lower = text.lower()
        
        bullish_words = [
            'surge', 'soar', 'jump', 'rally', 'gain', 'rise', 'up', 'high', 'record',
            'beat', 'exceed', 'strong', 'growth', 'profit', 'boost', 'bullish', 'buy',
            'upgrade', 'outperform', 'positive', 'optimistic', 'breakout', 'momentum'
        ]
        
        bearish_words = [
            'fall', 'drop', 'plunge', 'crash', 'decline', 'down', 'low', 'loss',
            'miss', 'weak', 'bearish', 'sell', 'downgrade', 'underperform', 'negative',
            'pessimistic', 'warning', 'risk', 'concern', 'fear', 'crisis', 'cut'
        ]
        
        bullish_count = sum(1 for word in bullish_words if word in text_lower)
        bearish_count = sum(1 for word in bearish_words if word in text_lower)
        
        if bullish_count > bearish_count + 1:
            return "Bullish"
        elif bearish_count > bullish_count + 1:
            return "Bearish"
        else:
            return "Neutral"
    
    def fetch_alpha_vantage_news(
        self,
        symbol: str,
        limit: int = 50
    ) -> List[Dict]:
        """Fetch news from Alpha Vantage API"""
        if not self.alpha_vantage_key:
            print("Alpha Vantage API key not configured")
            return []
        
        try:
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "NEWS_SENTIMENT",
                "tickers": symbol.upper(),
                "apikey": self.alpha_vantage_key,
                "limit": limit
            }
            
            print(f"Fetching news from Alpha Vantage for {symbol}...")
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            # Check for API errors
            if "Information" in data:
                print(f"Alpha Vantage API message: {data['Information']}")
                return []
            
            if "Note" in data:
                print(f"Alpha Vantage rate limit: {data['Note']}")
                return []
            
            if "feed" not in data:
                print(f"No 'feed' in Alpha Vantage response. Keys: {data.keys()}")
                return []
            
            articles = []
            for item in data["feed"][:limit]:
                try:
                    # Parse Alpha Vantage date format: "20240115T143000"
                    time_str = item.get("time_published", "")
                    if time_str:
                        try:
                            published_at = datetime.strptime(time_str, "%Y%m%dT%H%M%S")
                        except ValueError:
                            # Try alternative formats
                            published_at = datetime.now()
                    else:
                        published_at = datetime.now()
                    
                    # Get ticker-specific sentiment
                    ticker_sentiment = "Neutral"
                    overall_score = item.get("overall_sentiment_score", 0)
                    ticker_sentiment = self._parse_sentiment(float(overall_score) if overall_score else 0)
                    
                    articles.append({
                        "title": item.get("title", ""),
                        "content": item.get("summary", ""),
                        "source": item.get("source", "Unknown"),
                        "url": item.get("url", ""),
                        "published_at": published_at,
                        "sentiment": ticker_sentiment
                    })
                except Exception as e:
                    print(f"Error parsing article: {e}")
                    continue
            
            print(f"✓ Fetched {len(articles)} articles from Alpha Vantage")
            return articles
            
        except requests.exceptions.Timeout:
            print("Alpha Vantage request timed out")
            return []
        except requests.exceptions.RequestException as e:
            print(f"Error fetching Alpha Vantage news: {e}")
            return []
        except Exception as e:
            print(f"Unexpected error fetching Alpha Vantage news: {e}")
            return []
    
    def fetch_mock_news(self, symbol: str, count: int = 10) -> List[Dict]:
        """Generate mock news for testing"""
        headlines = [
            f"{symbol} Reports Strong Quarterly Earnings, Beats Estimates",
            f"Analysts Upgrade {symbol} Following Product Launch",
            f"{symbol} Stock Dips on Market Uncertainty",
            f"Institutional Investors Increase Holdings in {symbol}",
            f"{symbol} Announces Strategic Partnership",
            f"Market Watch: {symbol} Shows Technical Breakout Pattern",
            f"{symbol} Expands Into New Markets",
            f"Options Activity Surges for {symbol}",
            f"{symbol} CEO Discusses Future Growth Plans",
            f"Sector Analysis: {symbol} Positioned for Growth"
        ]
        
        sentiments = ["Bullish", "Bullish", "Bearish", "Neutral", "Bullish", 
                     "Neutral", "Bullish", "Neutral", "Bullish", "Bullish"]
        sources = ["Bloomberg", "Reuters", "CNBC", "MarketWatch", "Financial Times",
                  "WSJ", "Yahoo Finance", "Benzinga", "Seeking Alpha", "TheStreet"]
        
        articles = []
        for i in range(min(count, len(headlines))):
            articles.append({
                "title": headlines[i],
                "content": f"This is a detailed analysis about {symbol}. " +
                          f"Market analysts suggest the sentiment is {sentiments[i].lower()}. " +
                          f"Investors should monitor key technical levels and upcoming earnings.",
                "source": sources[i],
                "url": f"https://example.com/news/{symbol.lower()}-{i+1}",
                "published_at": datetime.now() - timedelta(hours=i * 2),
                "sentiment": sentiments[i]
            })
        
        return articles
    
    def _parse_sentiment(self, score: float) -> str:
        """Parse sentiment score to label"""
        if score > 0.15:
            return "Bullish"
        elif score < -0.15:
            return "Bearish"
        else:
            return "Neutral"
    
    def save_articles_to_db(
        self,
        db: Session,
        symbol: Symbol,
        articles: List[Dict]
    ) -> int:
        """Save articles to database"""
        count = 0
        for article_data in articles:
            try:
                # Check if article already exists by URL
                if article_data.get("url"):
                    existing = db.query(NewsArticle).filter(
                        NewsArticle.url == article_data["url"]
                    ).first()
                    if existing:
                        continue
                
                article = NewsArticle(
                    symbol_id=symbol.id,
                    title=article_data["title"],
                    content=article_data.get("content", ""),
                    source=article_data.get("source", "Unknown"),
                    url=article_data.get("url", ""),
                    published_at=article_data["published_at"],
                    sentiment=article_data.get("sentiment", "Neutral")
                )
                db.add(article)
                count += 1
            except Exception as e:
                print(f"Error saving article: {e}")
                continue
        
        try:
            db.commit()
        except Exception as e:
            print(f"Error committing articles: {e}")
            db.rollback()
            return 0
            
        return count
    
    def sync_news_for_symbol(
        self,
        db: Session,
        symbol: str,
        use_mock: bool = False  # Default to real data now
    ) -> int:
        """Sync news for a symbol - tries NewsAPI first, then Alpha Vantage"""
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if not db_symbol:
            # Create the symbol if it doesn't exist
            from app.services.data_fetcher import DataFetcher
            db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
        
        # Try NewsAPI first (primary source for real-time news)
        if not use_mock and self.newsapi_key:
            articles = self.fetch_newsapi_news(symbol)
            if articles:
                return self.save_articles_to_db(db, db_symbol, articles)
        
        # Fallback to Alpha Vantage (if API key is set)
        if not use_mock and self.alpha_vantage_key:
            articles = self.fetch_alpha_vantage_news(symbol)
            if articles:
                return self.save_articles_to_db(db, db_symbol, articles)
        
        # Final fallback to mock data (only if both APIs fail)
        if use_mock:
            articles = self.fetch_mock_news(symbol)
            return self.save_articles_to_db(db, db_symbol, articles)
        
        return 0

    async def fetch_news_parallel(
        self,
        symbols: List[str],
        limit_per_symbol: int = 10
    ) -> Dict[str, List[Dict]]:
        """Fetch news for multiple symbols in parallel"""
        results = {}
        
        def fetch_for_symbol(symbol: str) -> tuple:
            # Try NewsAPI first
            if self.newsapi_key:
                articles = self.fetch_newsapi_news(symbol, limit_per_symbol)
                if articles:
                    return (symbol, articles)
            
            # Fallback to Alpha Vantage
            if self.alpha_vantage_key:
                articles = self.fetch_alpha_vantage_news(symbol, limit_per_symbol)
                if articles:
                    return (symbol, articles)
            
            return (symbol, [])
        
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=5) as executor:
            tasks = [
                loop.run_in_executor(executor, fetch_for_symbol, symbol)
                for symbol in symbols
            ]
            completed = await asyncio.gather(*tasks)
        
        for symbol, articles in completed:
            results[symbol] = articles
        
        return results
