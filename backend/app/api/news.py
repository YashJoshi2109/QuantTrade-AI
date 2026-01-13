"""
News API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.news import NewsArticle
from app.services.news_fetcher import NewsFetcher
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
    
    class Config:
        from_attributes = True


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
                "banner_image": item.get("banner_image", "")
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
                "banner_image": item.get("banner_image", "")
            })
        
        return {
            "news": news_items,
            "count": len(news_items),
            "symbol": symbol.upper()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch live news: {str(e)}")
