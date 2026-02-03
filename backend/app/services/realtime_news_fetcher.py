"""
Real-time news fetcher with multiple sources
Supports: yfinance, Alpha Vantage, NewsAPI, and web scraping
"""
import yfinance as yf
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from bs4 import BeautifulSoup
import feedparser
from app.config import settings


class RealtimeNewsFetcher:
    """Fetches real-time news from multiple sources with sub-second latency"""
    
    def __init__(self):
        self.alpha_vantage_key = settings.ALPHA_VANTAGE_API_KEY
        self.newsapi_key = getattr(settings, 'NEWSAPI_KEY', None)
    
    @staticmethod
    def fetch_yfinance_news(symbol: str, limit: int = 20) -> List[Dict]:
        """
        Fetch real-time news from yfinance (fastest source)
        Latency: 200-500ms
        """
        try:
            ticker = yf.Ticker(symbol)
            news_items = ticker.news
            
            if not news_items:
                print(f"No news found for {symbol} on yfinance")
                return []
            
            articles = []
            for item in news_items[:limit]:
                try:
                    # Parse timestamp
                    timestamp = item.get('providerPublishTime')
                    if timestamp:
                        published_at = datetime.fromtimestamp(timestamp)
                    else:
                        published_at = datetime.now()
                    
                    articles.append({
                        "title": item.get('title', ''),
                        "content": item.get('summary', ''),
                        "source": item.get('publisher', 'Yahoo Finance'),
                        "url": item.get('link', ''),
                        "published_at": published_at,
                        "sentiment": "Neutral",  # yfinance doesn't provide sentiment
                        "thumbnail": item.get('thumbnail', {}).get('resolutions', [{}])[0].get('url'),
                        "related_tickers": item.get('relatedTickers', [])
                    })
                except Exception as e:
                    print(f"Error parsing yfinance article: {e}")
                    continue
            
            print(f"✓ Fetched {len(articles)} articles from yfinance")
            return articles
            
        except Exception as e:
            print(f"Error fetching yfinance news: {e}")
            return []
    
    @staticmethod
    def fetch_newsapi_news(
        symbol: str,
        company_name: Optional[str] = None,
        limit: int = 20
    ) -> List[Dict]:
        """
        Fetch news from NewsAPI.org
        Free tier: 100 requests/day, 1 month old data
        """
        newsapi_key = getattr(settings, 'NEWSAPI_KEY', None)
        if not newsapi_key:
            return []
        
        try:
            # Search by company name if available, otherwise symbol
            query = company_name if company_name else symbol
            
            url = "https://newsapi.org/v2/everything"
            params = {
                'q': query,
                'apiKey': newsapi_key,
                'language': 'en',
                'sortBy': 'publishedAt',
                'pageSize': limit
            }
            
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            
            articles = []
            for item in data.get('articles', []):
                try:
                    published_str = item.get('publishedAt', '')
                    if published_str:
                        published_at = datetime.fromisoformat(published_str.replace('Z', '+00:00'))
                    else:
                        published_at = datetime.now()
                    
                    articles.append({
                        "title": item.get('title', ''),
                        "content": item.get('description', ''),
                        "source": item.get('source', {}).get('name', 'NewsAPI'),
                        "url": item.get('url', ''),
                        "published_at": published_at,
                        "sentiment": "Neutral",
                        "thumbnail": item.get('urlToImage')
                    })
                except Exception as e:
                    print(f"Error parsing NewsAPI article: {e}")
                    continue
            
            print(f"✓ Fetched {len(articles)} articles from NewsAPI")
            return articles
            
        except Exception as e:
            print(f"Error fetching NewsAPI news: {e}")
            return []
    
    @staticmethod
    def fetch_google_news_rss(symbol: str, limit: int = 20) -> List[Dict]:
        """
        Fetch news from Google News RSS feed (free, real-time)
        """
        try:
            # Google News RSS feed for stock symbol
            from urllib.parse import quote_plus
            encoded_symbol = quote_plus(symbol)
            url = f"https://news.google.com/rss/search?q={encoded_symbol}+stock&hl=en-US&gl=US&ceid=US:en"
            
            feed = feedparser.parse(url)
            
            articles = []
            for entry in feed.entries[:limit]:
                try:
                    # Parse published date
                    if hasattr(entry, 'published_parsed'):
                        published_at = datetime(*entry.published_parsed[:6])
                    else:
                        published_at = datetime.now()
                    
                    articles.append({
                        "title": entry.get('title', ''),
                        "content": entry.get('summary', ''),
                        "source": entry.get('source', {}).get('title', 'Google News'),
                        "url": entry.get('link', ''),
                        "published_at": published_at,
                        "sentiment": "Neutral"
                    })
                except Exception as e:
                    print(f"Error parsing Google News article: {e}")
                    continue
            
            print(f"✓ Fetched {len(articles)} articles from Google News RSS")
            return articles
            
        except Exception as e:
            print(f"Error fetching Google News RSS: {e}")
            return []
    
    @staticmethod
    def fetch_marketwatch_news(symbol: str, limit: int = 10) -> List[Dict]:
        """
        Scrape MarketWatch for real-time news
        """
        try:
            url = f"https://www.marketwatch.com/investing/stock/{symbol.lower()}"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
            
            response = requests.get(url, headers=headers, timeout=5)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            articles = []
            # MarketWatch news articles
            news_items = soup.find_all('div', class_='article__content', limit=limit)
            
            for item in news_items:
                try:
                    headline = item.find('a', class_='link')
                    if not headline:
                        continue
                    
                    timestamp_elem = item.find('span', class_='article__timestamp')
                    published_at = datetime.now()  # Default to now if can't parse
                    
                    articles.append({
                        "title": headline.get_text(strip=True),
                        "content": "",
                        "source": "MarketWatch",
                        "url": headline.get('href', ''),
                        "published_at": published_at,
                        "sentiment": "Neutral"
                    })
                except Exception as e:
                    print(f"Error parsing MarketWatch article: {e}")
                    continue
            
            print(f"✓ Fetched {len(articles)} articles from MarketWatch")
            return articles
            
        except Exception as e:
            print(f"Error fetching MarketWatch news: {e}")
            return []
    
    @staticmethod
    def fetch_combined_realtime_news(
        symbol: str,
        company_name: Optional[str] = None,
        limit_per_source: int = 10
    ) -> List[Dict]:
        """
        Fetch news from all sources and combine (fastest first)
        Priority: yfinance > Google News > NewsAPI > MarketWatch
        """
        all_articles = []
        
        # 1. yfinance (fastest, most reliable)
        yf_articles = RealtimeNewsFetcher.fetch_yfinance_news(symbol, limit_per_source)
        all_articles.extend(yf_articles)
        
        # 2. Google News RSS (free, real-time)
        google_articles = RealtimeNewsFetcher.fetch_google_news_rss(symbol, limit_per_source)
        all_articles.extend(google_articles)
        
        # 3. NewsAPI (if configured)
        newsapi_articles = RealtimeNewsFetcher.fetch_newsapi_news(symbol, company_name, limit_per_source)
        all_articles.extend(newsapi_articles)
        
        # 4. MarketWatch (scraping)
        mw_articles = RealtimeNewsFetcher.fetch_marketwatch_news(symbol, limit_per_source // 2)
        all_articles.extend(mw_articles)
        
        # Remove duplicates by URL and title
        seen_urls = set()
        seen_titles = set()
        unique_articles = []
        
        for article in all_articles:
            url = article.get('url', '')
            title = article.get('title', '')
            
            if url and url not in seen_urls:
                seen_urls.add(url)
                seen_titles.add(title)
                unique_articles.append(article)
            elif title and title not in seen_titles:
                seen_titles.add(title)
                unique_articles.append(article)
        
        # Sort by published date (newest first)
        unique_articles.sort(key=lambda x: x.get('published_at', datetime.now()), reverse=True)
        
        print(f"✓ Total unique articles: {len(unique_articles)}")
        return unique_articles
