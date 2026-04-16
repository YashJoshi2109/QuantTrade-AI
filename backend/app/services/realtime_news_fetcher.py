"""
Real-time news fetcher with multiple sources
Supports: yfinance, Alpha Vantage, NewsAPI, and web scraping
"""
import html
import re
import yfinance as yf
import requests
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from bs4 import BeautifulSoup
import feedparser
from urllib.parse import quote_plus
from app.config import settings

# Google RSS often blocks generic clients; use a normal browser UA.
_RSS_REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


def _is_likely_ticker_symbol(s: str) -> bool:
    t = (s or "").strip().upper()
    return 1 <= len(t) <= 5 and t.isalpha()


def ensure_naive_datetime(dt: datetime) -> datetime:
    """Convert any datetime to naive UTC datetime for consistent comparison"""
    if dt is None:
        return datetime.utcnow()
    if dt.tzinfo is not None:
        # Convert to UTC and remove timezone info
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class RealtimeNewsFetcher:
    """Fetches real-time news from multiple sources with sub-second latency"""
    
    def __init__(self):
        self.alpha_vantage_key = settings.ALPHA_VANTAGE_API_KEY
        self.newsapi_key = getattr(settings, 'NEWSAPI_KEY', None)
    
    @staticmethod
    def fetch_yfinance_news(symbol: str, limit: int = 20) -> List[Dict]:
        """
        Fetch real-time news from yfinance (fastest source).
        yfinance wraps article data under item['content'] since ~2025.
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
                    # yfinance now nests data under 'content'; fall back to
                    # top-level keys for older versions
                    c = item.get('content', {}) if isinstance(item.get('content'), dict) else {}

                    title = (
                        c.get('title')
                        or item.get('title', '')
                    )
                    summary = (
                        c.get('summary')
                        or c.get('description')
                        or item.get('summary', '')
                        or item.get('description', '')
                        or ''
                    )

                    # Publisher / source
                    provider = c.get('provider', {})
                    source = (
                        (provider.get('displayName') if isinstance(provider, dict) else None)
                        or item.get('publisher')
                        or 'Yahoo Finance'
                    )

                    # URL
                    click_url = c.get('clickThroughUrl', {})
                    canonical_url = c.get('canonicalUrl', {})
                    url = (
                        (click_url.get('url') if isinstance(click_url, dict) else None)
                        or (canonical_url.get('url') if isinstance(canonical_url, dict) else None)
                        or item.get('link', '')
                        or item.get('url', '')
                    )

                    # Timestamp
                    published_at = datetime.utcnow()
                    timestamp = (
                        c.get('pubDate')
                        or item.get('providerPublishTime')
                        or item.get('publish_time')
                    )
                    if timestamp is not None:
                        try:
                            if isinstance(timestamp, (int, float)):
                                published_at = ensure_naive_datetime(datetime.fromtimestamp(timestamp))
                            elif isinstance(timestamp, str):
                                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                                published_at = ensure_naive_datetime(dt)
                            elif isinstance(timestamp, datetime):
                                published_at = ensure_naive_datetime(timestamp)
                        except Exception:
                            published_at = datetime.utcnow()

                    # Thumbnail — check content.thumbnail first, then top-level
                    thumbnail = None
                    thumb_data = c.get('thumbnail') or item.get('thumbnail')
                    if isinstance(thumb_data, dict):
                        resolutions = thumb_data.get('resolutions', [])
                        if resolutions and isinstance(resolutions, list):
                            # Prefer a mid-size resolution (~600px wide) for cards
                            best = resolutions[0]
                            for r in resolutions:
                                w = r.get('width', 0)
                                if 400 <= w <= 1200:
                                    best = r
                                    break
                            if not best.get('url') and len(resolutions) > 0:
                                best = resolutions[-1]
                            thumbnail = best.get('url')
                        if not thumbnail:
                            thumbnail = thumb_data.get('originalUrl') or thumb_data.get('url')
                    elif isinstance(thumb_data, str):
                        thumbnail = thumb_data
                    if not thumbnail:
                        thumbnail = item.get('image') or item.get('heroImage')

                    # Related tickers
                    finance_data = c.get('finance', {})
                    related = (
                        (finance_data.get('stockTickers', []) if isinstance(finance_data, dict) else [])
                        or item.get('relatedTickers', [])
                        or item.get('related_tickers', [])
                    )
                    # stockTickers can be list of dicts with 'symbol' key
                    if related and isinstance(related[0], dict):
                        related = [t.get('symbol', '') for t in related if t.get('symbol')]

                    if not title:
                        continue  # skip articles without a title

                    articles.append({
                        "title": title,
                        "content": summary,
                        "source": source,
                        "url": url,
                        "published_at": published_at,
                        "sentiment": "Neutral",
                        "thumbnail": thumbnail,
                        "related_tickers": related[:5] if related else [],
                    })
                except Exception as e:
                    print(f"Error parsing yfinance article: {e}")
                    continue

            print(f"✓ Fetched {len(articles)} articles from yfinance for {symbol}")
            return articles

        except Exception:
            # yfinance can fail due to rate limits, cookie issues, or API changes
            # Silently return empty - other sources will provide coverage
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
                        # Parse ISO format and ensure naive datetime
                        dt = datetime.fromisoformat(published_str.replace('Z', '+00:00'))
                        published_at = ensure_naive_datetime(dt)
                    else:
                        published_at = datetime.utcnow()
                    
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
    def fetch_google_news_rss(
        query: str,
        limit: int = 20,
        *,
        append_stock_suffix: bool = False,
    ) -> List[Dict]:
        """
        Fetch news from Google News RSS (free). Use append_stock_suffix=True for
        short ticker-style queries (e.g. AAPL); keep False for phrases like
        "stock market today" so results are not over-narrowed.
        """
        try:
            q = quote_plus(query.strip())
            if append_stock_suffix:
                q = f"{q}+stock"
            url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

            resp = requests.get(url, headers=_RSS_REQUEST_HEADERS, timeout=12)
            resp.raise_for_status()
            feed = feedparser.parse(resp.content)

            if getattr(feed, "bozo", False) and not feed.entries:
                print(f"Google News RSS parse issue for q={query!r}: {getattr(feed, 'bozo_exception', '')}")

            articles = []
            for entry in feed.entries[:limit]:
                try:
                    if hasattr(entry, 'published_parsed') and entry.published_parsed:
                        published_at = ensure_naive_datetime(datetime(*entry.published_parsed[:6]))
                    else:
                        published_at = datetime.utcnow()

                    raw_title = html.unescape(entry.get('title', '') or '')
                    # Google often uses "Headline - Publisher"
                    pub_from_title = None
                    if " - " in raw_title:
                        head, tail = raw_title.rsplit(" - ", 1)
                        if len(tail) < 90 and not re.match(r"^https?://", tail.strip()):
                            raw_title = head.strip()
                            pub_from_title = tail.strip()

                    src = "Google News"
                    if pub_from_title:
                        src = pub_from_title
                    else:
                        st = entry.get("source")
                        if isinstance(st, dict) and st.get("title"):
                            src = st["title"]
                        elif hasattr(entry, "source") and getattr(entry.source, "title", None):
                            src = entry.source.title

                    link = (entry.get("link") or "").strip()
                    if not link and getattr(entry, "links", None):
                        for ln in entry.links:
                            if ln.get("rel") == "alternate" and ln.get("href"):
                                link = ln["href"].strip()
                                break

                    thumbnail = None
                    media_content = getattr(entry, 'media_content', None)
                    if media_content and isinstance(media_content, list) and len(media_content) > 0:
                        thumbnail = media_content[0].get('url')
                    if not thumbnail:
                        media_thumb = getattr(entry, 'media_thumbnail', None)
                        if media_thumb and isinstance(media_thumb, list) and len(media_thumb) > 0:
                            thumbnail = media_thumb[0].get('url')
                    if not thumbnail and hasattr(entry, 'enclosures') and entry.enclosures:
                        for enc in entry.enclosures:
                            if enc.get('type', '').startswith('image/'):
                                thumbnail = enc.get('href') or enc.get('url')
                                break

                    summary = entry.get('summary', '') or ''
                    if summary:
                        summary = html.unescape(summary)

                    articles.append({
                        "title": raw_title,
                        "content": summary,
                        "source": src,
                        "url": link,
                        "published_at": published_at,
                        "sentiment": "Neutral",
                        "thumbnail": thumbnail
                    })
                except Exception as e:
                    print(f"Error parsing Google News article: {e}")
                    continue

            print(f"✓ Fetched {len(articles)} articles from Google News RSS (q={query[:40]!r}…)")
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
                    published_at = datetime.utcnow()  # Default to now if can't parse
                    
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
        google_articles = RealtimeNewsFetcher.fetch_google_news_rss(
            symbol,
            limit_per_source,
            append_stock_suffix=_is_likely_ticker_symbol(symbol),
        )
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
        
        # Sort by published date (newest first) - all datetimes are now naive UTC
        unique_articles.sort(key=lambda x: x.get('published_at', datetime.utcnow()), reverse=True)
        
        print(f"✓ Total unique articles: {len(unique_articles)}")
        return unique_articles
