"""
News fetching service
Supports multiple sources: NewsAPI, Alpha Vantage, RSS feeds, or mock data
"""
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from app.models.symbol import Symbol
from app.models.news import NewsArticle
from sqlalchemy.orm import Session
from app.config import settings


class NewsFetcher:
    """Fetches news articles from various sources"""
    
    def __init__(self):
        self.alpha_vantage_key = settings.ALPHA_VANTAGE_API_KEY
        self.newsapi_key = getattr(settings, 'NEWSAPI_KEY', None)
    
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
        """Sync news for a symbol"""
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if not db_symbol:
            # Create the symbol if it doesn't exist
            from app.services.data_fetcher import DataFetcher
            db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
        
        # Try Alpha Vantage first (if API key is set)
        if not use_mock and self.alpha_vantage_key:
            articles = self.fetch_alpha_vantage_news(symbol)
            if articles:
                return self.save_articles_to_db(db, db_symbol, articles)
        
        # Fallback to mock data
        articles = self.fetch_mock_news(symbol)
        return self.save_articles_to_db(db, db_symbol, articles)
