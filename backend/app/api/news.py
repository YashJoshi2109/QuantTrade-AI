"""
News API endpoints - MVP Lean Implementation

Enhanced with:
- Alpha Vantage (primary - 5 req/min)
- Finnhub backup (60 req/min)
- Image extraction fallback for missing images
- Caching in news_cache table
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.news import NewsArticle
from app.services.news_fetcher import NewsFetcher
from app.services.news_image_extractor import extract_og_image
from app.config import settings
from pydantic import BaseModel
import httpx

router = APIRouter()
news_fetcher = NewsFetcher()


class NewsArticleResponse(BaseModel):
    id: int
    title: str
    content: Optional[str]
    source: Optional[str]
    url: Optional[str]
    published_at: datetime
    sentiment: Optional[str]
    image_url: Optional[str] = None  # Added for frontend display
    
    class Config:
        from_attributes = True


class LiveNewsItem(BaseModel):
    """Response model for live news items"""
    title: str
    summary: str
    source: str
    url: str
    published_at: str
    sentiment: str
    sentiment_score: float
    tickers: List[str]
    image_url: Optional[str] = None


async def _fetch_finnhub_news(symbol: str, limit: int = 10) -> List[dict]:
    """Fetch news from Finnhub API (60 req/min rate limit)"""
    if not settings.FINNHUB_API_KEY:
        return []
    
    try:
        # Finnhub uses YYYY-MM-DD format for dates
        from datetime import timedelta
        today = datetime.now()
        week_ago = today - timedelta(days=7)
        
        url = "https://finnhub.io/api/v1/company-news"
        params = {
            "symbol": symbol.upper(),
            "from": week_ago.strftime("%Y-%m-%d"),
            "to": today.strftime("%Y-%m-%d"),
            "token": settings.FINNHUB_API_KEY
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
        
        if not isinstance(data, list):
            return []
        
        return data[:limit]
    except Exception as e:
        print(f"Finnhub news error: {e}")
        return []


@router.get("/news/{symbol}", response_model=List[NewsArticleResponse])
async def get_news(
    symbol: str,
    limit: int = Query(20, ge=1, le=100),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    sentiment: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Get news articles for a symbol"""
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        raise HTTPException(status_code=404, detail="Symbol not found")
    
    query = db.query(NewsArticle).filter(NewsArticle.symbol_id == db_symbol.id)
    
    if start_date:
        query = query.filter(NewsArticle.published_at >= start_date)
    if end_date:
        query = query.filter(NewsArticle.published_at <= end_date)
    if sentiment:
        query = query.filter(NewsArticle.sentiment == sentiment.capitalize())
    
    articles = query.order_by(NewsArticle.published_at.desc()).limit(limit).all()
    
    return articles


@router.post("/news/{symbol}/sync")
async def sync_news(
    symbol: str,
    use_mock: bool = Query(False, description="Use mock data for testing (default: use real Alpha Vantage data)"),
    db: Session = Depends(get_db)
):
    """Sync news articles for a symbol from Alpha Vantage"""
    try:
        count = news_fetcher.sync_news_for_symbol(db, symbol, use_mock=use_mock)
        return {
            "symbol": symbol.upper(),
            "articles_synced": count,
            "message": "News synced successfully",
            "source": "mock" if use_mock else "alpha_vantage"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# GET endpoint for easy browser testing
@router.get("/news/{symbol}/sync")
async def sync_news_get(
    symbol: str,
    use_mock: bool = Query(False, description="Use mock data for testing"),
    db: Session = Depends(get_db)
):
    """Sync news articles (GET version for browser testing)"""
    try:
        count = news_fetcher.sync_news_for_symbol(db, symbol, use_mock=use_mock)
        return {
            "symbol": symbol.upper(),
            "articles_synced": count,
            "message": "News synced successfully",
            "source": "mock" if use_mock else "alpha_vantage"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/news/live/market")
async def get_live_market_news(
    topics: str = Query("technology,earnings", description="Comma-separated topics"),
    limit: int = Query(20, ge=1, le=50)
):
    """Get live market news from Alpha Vantage (no database storage)"""
    if not settings.ALPHA_VANTAGE_API_KEY:
        raise HTTPException(status_code=500, detail="Alpha Vantage API key not configured")
    
    try:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "NEWS_SENTIMENT",
            "topics": topics,
            "limit": limit,
            "apikey": settings.ALPHA_VANTAGE_API_KEY
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
        
        if "feed" not in data:
            # Return empty list if no news (API limit reached, etc.)
            return {"news": [], "count": 0, "topics": topics}
        
        news_items = []
        for item in data["feed"][:limit]:
            # Determine sentiment
            sentiment_score = float(item.get("overall_sentiment_score", 0))
            if sentiment_score >= 0.15:
                sentiment = "Bullish"
            elif sentiment_score <= -0.15:
                sentiment = "Bearish"
            else:
                sentiment = "Neutral"
            
            # Extract ticker mentions
            tickers = [t.get("ticker", "") for t in item.get("ticker_sentiment", [])[:5]]
            
            news_items.append({
                "title": item.get("title", ""),
                "summary": item.get("summary", "")[:500],
                "source": item.get("source", "Unknown"),
                "url": item.get("url", ""),
                "published_at": item.get("time_published", ""),
                "sentiment": sentiment,
                "sentiment_score": sentiment_score,
                "tickers": tickers,
                "image_url": item.get("banner_image", "")  # Standardized field name
            })
        
        return {
            "news": news_items,
            "count": len(news_items),
            "topics": topics
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch live news: {str(e)}")


@router.get("/news/live/{symbol}")
async def get_live_symbol_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=50)
):
    """Get live news for a specific symbol from Alpha Vantage"""
    if not settings.ALPHA_VANTAGE_API_KEY:
        raise HTTPException(status_code=500, detail="Alpha Vantage API key not configured")
    
    try:
        url = "https://www.alphavantage.co/query"
        params = {
            "function": "NEWS_SENTIMENT",
            "tickers": symbol.upper(),
            "limit": limit,
            "apikey": settings.ALPHA_VANTAGE_API_KEY
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params=params)
            data = response.json()
        
        if "feed" not in data:
            return {"news": [], "count": 0, "symbol": symbol.upper()}
        
        news_items = []
        for item in data["feed"][:limit]:
            sentiment_score = float(item.get("overall_sentiment_score", 0))
            if sentiment_score >= 0.15:
                sentiment = "Bullish"
            elif sentiment_score <= -0.15:
                sentiment = "Bearish"
            else:
                sentiment = "Neutral"
            
            news_items.append({
                "title": item.get("title", ""),
                "summary": item.get("summary", "")[:500],
                "source": item.get("source", "Unknown"),
                "url": item.get("url", ""),
                "published_at": item.get("time_published", ""),
                "sentiment": sentiment,
                "sentiment_score": sentiment_score,
                "image_url": item.get("banner_image", "")  # Standardized field name
            })
        
        return {
            "news": news_items,
            "count": len(news_items),
            "symbol": symbol.upper()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch live news: {str(e)}")


@router.get("/news/finnhub/{symbol}")
async def get_finnhub_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=50),
    extract_images: bool = Query(False, description="Extract images from article URLs if missing")
):
    """
    Get news from Finnhub API (60 req/min - better rate limit than Alpha Vantage).
    Finnhub provides images directly in the response.
    """
    articles = await _fetch_finnhub_news(symbol, limit)
    
    if not articles:
        # Fallback to Alpha Vantage if Finnhub fails
        return await get_live_symbol_news(symbol, limit)
    
    news_items = []
    for item in articles:
        image_url = item.get("image", "")
        
        # If extract_images is True and no image, try to fetch from article
        if extract_images and not image_url and item.get("url"):
            try:
                image_url = await extract_og_image(item["url"]) or ""
            except Exception:
                pass
        
        # Convert Unix timestamp to ISO format
        published_timestamp = item.get("datetime", 0)
        if published_timestamp:
            published_at = datetime.fromtimestamp(published_timestamp).isoformat()
        else:
            published_at = datetime.now().isoformat()
        
        news_items.append({
            "title": item.get("headline", ""),
            "summary": item.get("summary", "")[:500],
            "source": item.get("source", "Unknown"),
            "url": item.get("url", ""),
            "published_at": published_at,
            "sentiment": "Neutral",  # Finnhub doesn't provide sentiment
            "sentiment_score": 0,
            "image_url": image_url,
            "category": item.get("category", ""),
            "related": item.get("related", "")
        })
    
    return {
        "news": news_items,
        "count": len(news_items),
        "symbol": symbol.upper(),
        "source": "finnhub"
    }


@router.get("/news/combined/{symbol}")
async def get_combined_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=30)
):
    """
    Get combined news from both Finnhub and Alpha Vantage.
    Returns deduplicated results sorted by date.
    """
    # Fetch from both sources in parallel
    import asyncio
    
    try:
        finnhub_task = _fetch_finnhub_news(symbol, limit)
        finnhub_articles = await finnhub_task
    except Exception:
        finnhub_articles = []
    
    all_news = []
    seen_titles = set()
    
    # Process Finnhub articles first (usually more available)
    for item in finnhub_articles:
        title = item.get("headline", "")
        if title and title not in seen_titles:
            seen_titles.add(title)
            
            published_timestamp = item.get("datetime", 0)
            published_at = datetime.fromtimestamp(published_timestamp) if published_timestamp else datetime.now()
            
            all_news.append({
                "title": title,
                "summary": item.get("summary", "")[:500],
                "source": item.get("source", "Unknown"),
                "url": item.get("url", ""),
                "published_at": published_at.isoformat(),
                "sentiment": "Neutral",
                "image_url": item.get("image", ""),
                "data_source": "finnhub"
            })
    
    # Try to add Alpha Vantage articles if we don't have enough
    if len(all_news) < limit and settings.ALPHA_VANTAGE_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    "https://www.alphavantage.co/query",
                    params={
                        "function": "NEWS_SENTIMENT",
                        "tickers": symbol.upper(),
                        "limit": limit,
                        "apikey": settings.ALPHA_VANTAGE_API_KEY
                    }
                )
                av_data = response.json()
            
            if "feed" in av_data:
                for item in av_data["feed"]:
                    title = item.get("title", "")
                    if title and title not in seen_titles:
                        seen_titles.add(title)
                        
                        sentiment_score = float(item.get("overall_sentiment_score", 0))
                        if sentiment_score >= 0.15:
                            sentiment = "Bullish"
                        elif sentiment_score <= -0.15:
                            sentiment = "Bearish"
                        else:
                            sentiment = "Neutral"
                        
                        all_news.append({
                            "title": title,
                            "summary": item.get("summary", "")[:500],
                            "source": item.get("source", "Unknown"),
                            "url": item.get("url", ""),
                            "published_at": item.get("time_published", ""),
                            "sentiment": sentiment,
                            "image_url": item.get("banner_image", ""),
                            "data_source": "alpha_vantage"
                        })
        except Exception:
            pass
    
    # Sort by date (most recent first) and limit
    all_news.sort(key=lambda x: x["published_at"], reverse=True)
    
    return {
        "news": all_news[:limit],
        "count": min(len(all_news), limit),
        "symbol": symbol.upper()
    }


@router.get("/news/realtime/market")
async def get_realtime_market_news(
    limit: int = Query(20, ge=1, le=50)
):
    """
    Get real-time market/business news from NewsAPI (primary source).
    Returns top business headlines with sentiment analysis.
    """
    articles = news_fetcher.fetch_market_news(limit)
    
    if not articles:
        # Fallback to Alpha Vantage if NewsAPI fails
        return await get_live_market_news(topics="technology,earnings", limit=limit)
    
    return {
        "news": [
            {
                "title": a["title"],
                "summary": a["content"],
                "source": a["source"],
                "url": a["url"],
                "published_at": a["published_at"].isoformat() if hasattr(a["published_at"], 'isoformat') else str(a["published_at"]),
                "sentiment": a["sentiment"],
                "sentiment_score": 0.2 if a["sentiment"] == "Bullish" else (-0.2 if a["sentiment"] == "Bearish" else 0),
                "image_url": a.get("image_url", ""),
                "tickers": []
            }
            for a in articles
        ],
        "count": len(articles),
        "source": "newsapi"
    }


@router.get("/news/realtime/{symbol}")
async def get_realtime_symbol_news(
    symbol: str,
    limit: int = Query(15, ge=1, le=50)
):
    """
    Get real-time news for a specific symbol from NewsAPI (primary).
    Falls back to Finnhub and Alpha Vantage if NewsAPI fails.
    """
    # Try NewsAPI first
    articles = news_fetcher.fetch_newsapi_news(symbol, limit)
    
    if articles:
        return {
            "news": [
                {
                    "title": a["title"],
                    "summary": a["content"],
                    "source": a["source"],
                    "url": a["url"],
                    "published_at": a["published_at"].isoformat() if hasattr(a["published_at"], 'isoformat') else str(a["published_at"]),
                    "sentiment": a["sentiment"],
                    "sentiment_score": 0.2 if a["sentiment"] == "Bullish" else (-0.2 if a["sentiment"] == "Bearish" else 0),
                    "image_url": a.get("image_url", "")
                }
                for a in articles
            ],
            "count": len(articles),
            "symbol": symbol.upper(),
            "source": "newsapi"
        }
    
    # Fallback to Finnhub
    return await get_finnhub_news(symbol, limit)


@router.get("/news/all/{symbol}")
async def get_all_news_sources(
    symbol: str,
    limit: int = Query(20, ge=1, le=50)
):
    """
    Get news from ALL available sources (NewsAPI, Finnhub, Alpha Vantage).
    Returns deduplicated, sorted results with source attribution.
    """
    import asyncio
    
    all_news = []
    seen_urls = set()
    
    # 1. Try NewsAPI first (real-time)
    newsapi_articles = news_fetcher.fetch_newsapi_news(symbol, limit)
    for a in newsapi_articles:
        if a["url"] and a["url"] not in seen_urls:
            seen_urls.add(a["url"])
            all_news.append({
                "title": a["title"],
                "summary": a["content"],
                "source": a["source"],
                "url": a["url"],
                "published_at": a["published_at"].isoformat() if hasattr(a["published_at"], 'isoformat') else str(a["published_at"]),
                "sentiment": a["sentiment"],
                "image_url": a.get("image_url", ""),
                "data_source": "newsapi"
            })
    
    # 2. Add Finnhub articles
    finnhub_articles = await _fetch_finnhub_news(symbol, limit)
    for item in finnhub_articles:
        url = item.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            published_timestamp = item.get("datetime", 0)
            published_at = datetime.fromtimestamp(published_timestamp).isoformat() if published_timestamp else datetime.now().isoformat()
            
            all_news.append({
                "title": item.get("headline", ""),
                "summary": item.get("summary", "")[:500],
                "source": item.get("source", "Unknown"),
                "url": url,
                "published_at": published_at,
                "sentiment": "Neutral",
                "image_url": item.get("image", ""),
                "data_source": "finnhub"
            })
    
    # 3. Add Alpha Vantage articles
    if settings.ALPHA_VANTAGE_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    "https://www.alphavantage.co/query",
                    params={
                        "function": "NEWS_SENTIMENT",
                        "tickers": symbol.upper(),
                        "limit": limit,
                        "apikey": settings.ALPHA_VANTAGE_API_KEY
                    }
                )
                av_data = response.json()
            
            if "feed" in av_data:
                for item in av_data["feed"]:
                    url = item.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        
                        sentiment_score = float(item.get("overall_sentiment_score", 0))
                        sentiment = "Bullish" if sentiment_score >= 0.15 else ("Bearish" if sentiment_score <= -0.15 else "Neutral")
                        
                        all_news.append({
                            "title": item.get("title", ""),
                            "summary": item.get("summary", "")[:500],
                            "source": item.get("source", "Unknown"),
                            "url": url,
                            "published_at": item.get("time_published", ""),
                            "sentiment": sentiment,
                            "image_url": item.get("banner_image", ""),
                            "data_source": "alpha_vantage"
                        })
        except Exception as e:
            print(f"Alpha Vantage error in combined news: {e}")
    
    # Sort by date (most recent first)
    all_news.sort(key=lambda x: x["published_at"], reverse=True)
    
    return {
        "news": all_news[:limit],
        "count": min(len(all_news), limit),
        "symbol": symbol.upper(),
        "sources_used": list(set(item["data_source"] for item in all_news[:limit]))
    }
