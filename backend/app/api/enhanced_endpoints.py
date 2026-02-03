"""
Enhanced API endpoints for real-time quotes, fundamentals, and portfolio management
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.fundamentals import Fundamentals
from app.models.realtime_quote import RealtimeQuote, MarketIndex
from app.models.portfolio import Portfolio, Position, Transaction, TransactionType
from app.services.enhanced_data_fetcher import EnhancedDataFetcher
from app.services.portfolio_service import PortfolioService
from app.services.realtime_news_fetcher import RealtimeNewsFetcher
from app.services.finnhub_fetcher import FinnhubFetcher
from app.services.rate_limiter import get_api_stats
from app.api.auth import get_current_user
from app.models.user import User

router = APIRouter()


# ============= REAL-TIME QUOTES =============

class QuoteResponse(BaseModel):
    symbol: str
    last_price: float
    change: Optional[float]
    change_percent: Optional[float]
    volume: Optional[int]
    high: Optional[float]
    low: Optional[float]
    open: Optional[float]
    data_source: str
    latency_ms: int
    timestamp: datetime
    
    class Config:
        from_attributes = True


@router.get("/quote/{symbol}", response_model=QuoteResponse)
async def get_realtime_quote(symbol: str, db: Session = Depends(get_db)):
    """Get real-time quote with millisecond-level latency tracking"""
    from datetime import datetime
    from app.models.price import PriceBar
    
    start_time = datetime.utcnow()

    def _to_float(value: Optional[object], default: float = 0.0) -> float:
        try:
            if value is None:
                return default
            if isinstance(value, str):
                return float(value.replace('%', '').replace(',', '').strip())
            return float(value)
        except Exception:
            return default
    
    try:
        # Get symbol from database
        db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
        if not db_symbol:
            fallback_data = EnhancedDataFetcher.fetch_realtime_quote(symbol.upper(), db)
            if fallback_data.get("error"):
                raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")

            return QuoteResponse(
                symbol=symbol.upper(),
                last_price=_to_float(fallback_data.get("last_price")),
                change=_to_float(fallback_data.get("change"), None),
                change_percent=_to_float(fallback_data.get("change_percent"), None),
                volume=int(_to_float(fallback_data.get("volume"), 0)),
                high=_to_float(fallback_data.get("high"), None),
                low=_to_float(fallback_data.get("low"), None),
                open=_to_float(fallback_data.get("open"), None),
                data_source=fallback_data.get("data_source", "external"),
                latency_ms=int(fallback_data.get("latency_ms") or (datetime.utcnow() - start_time).total_seconds() * 1000),
                timestamp=fallback_data.get("timestamp") or datetime.utcnow()
            )
        
        # Get latest price from database
        latest_price = db.query(PriceBar).filter(
            PriceBar.symbol_id == db_symbol.id
        ).order_by(PriceBar.timestamp.desc()).first()
        
        if not latest_price:
            fallback_data = EnhancedDataFetcher.fetch_realtime_quote(symbol.upper(), db)
            if fallback_data.get("error"):
                raise HTTPException(status_code=404, detail=f"No price data for {symbol}")

            return QuoteResponse(
                symbol=symbol.upper(),
                last_price=_to_float(fallback_data.get("last_price")),
                change=_to_float(fallback_data.get("change"), None),
                change_percent=_to_float(fallback_data.get("change_percent"), None),
                volume=int(_to_float(fallback_data.get("volume"), 0)),
                high=_to_float(fallback_data.get("high"), None),
                low=_to_float(fallback_data.get("low"), None),
                open=_to_float(fallback_data.get("open"), None),
                data_source=fallback_data.get("data_source", "external"),
                latency_ms=int(fallback_data.get("latency_ms") or (datetime.utcnow() - start_time).total_seconds() * 1000),
                timestamp=fallback_data.get("timestamp") or datetime.utcnow()
            )
        
        # Get previous price for change calculation
        prev_price = db.query(PriceBar).filter(
            PriceBar.symbol_id == db_symbol.id,
            PriceBar.timestamp < latest_price.timestamp
        ).order_by(PriceBar.timestamp.desc()).first()
        
        change = latest_price.close - (prev_price.close if prev_price else latest_price.open)
        change_percent = (change / (prev_price.close if prev_price else latest_price.open)) * 100
        
        latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        
        quote_data = {
            "symbol": symbol.upper(),
            "last_price": float(latest_price.close),
            "change": float(change),
            "change_percent": float(change_percent),
            "volume": int(latest_price.volume) if latest_price.volume else 0,
            "high": float(latest_price.high),
            "low": float(latest_price.low),
            "open": float(latest_price.open),
            "data_source": "database",
            "latency_ms": latency_ms,
            "timestamp": latest_price.timestamp
        }
        
        return QuoteResponse(**quote_data)
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Quote error for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch quote: {str(e)}")


@router.get("/market-indices", response_model=List[dict])
async def get_market_indices(db: Session = Depends(get_db)):
    """Get major market indices (S&P 500, NASDAQ, DOW) from Finnhub"""
    from app.services.finnhub_fetcher import FinnhubFetcher
    
    indices_config = [
        {"symbol": "^GSPC", "name": "S&P 500"},
        {"symbol": "^IXIC", "name": "NASDAQ"},
        {"symbol": "^DJI", "name": "Dow Jones"},
        {"symbol": "^RUT", "name": "Russell 2000"},
    ]
    
    results = []
    for config in indices_config:
        try:
            quote = FinnhubFetcher.get_quote(config["symbol"])
            if quote and 'c' in quote:
                change = quote.get('c', 0) - quote.get('pc', 0)
                change_percent = (change / quote.get('pc', 1)) * 100 if quote.get('pc') else 0
                
                results.append({
                    "symbol": config["symbol"],
                    "name": config["name"],
                    "price": quote.get('c', 0),
                    "change": change,
                    "change_percent": change_percent,
                    "timestamp": datetime.utcnow()
                })
        except Exception as e:
            print(f"Error fetching {config['symbol']}: {e}")
            # Return N/A data
            results.append({
                "symbol": config["symbol"],
                "name": config["name"],
                "price": 0,
                "change": 0,
                "change_percent": 0,
                "timestamp": datetime.utcnow()
            })
    
    return results


# ============= FUNDAMENTALS =============

class FundamentalsResponse(BaseModel):
    symbol: str
    company_name: Optional[str]
    sector: Optional[str]
    industry: Optional[str]
    market_cap: Optional[float]
    pe_ratio: Optional[float]
    price_to_book: Optional[float]
    dividend_yield: Optional[float]
    profit_margin: Optional[float]
    roe: Optional[float]
    debt_to_equity: Optional[float]
    beta: Optional[float]
    target_price: Optional[float]
    recommendation: Optional[str]
    fetched_at: Optional[datetime]
    
    class Config:
        from_attributes = True


@router.get("/fundamentals/{symbol}", response_model=dict)
async def get_fundamentals(symbol: str, db: Session = Depends(get_db)):
    """Get comprehensive fundamentals from Finviz"""
    try:
        fundamentals = EnhancedDataFetcher.sync_fundamentals(db, symbol.upper())
        
        if not fundamentals:
            raise HTTPException(status_code=404, detail=f"No fundamentals found for {symbol}")
        
        return {
            "symbol": fundamentals.symbol_id,
            "company_name": fundamentals.company_name,
            "sector": fundamentals.sector,
            "industry": fundamentals.industry,
            "market_cap": fundamentals.market_cap,
            "pe_ratio": fundamentals.pe_ratio,
            "price_to_book": fundamentals.price_to_book,
            "dividend_yield": fundamentals.dividend_yield,
            "profit_margin": fundamentals.profit_margin,
            "roe": fundamentals.roe,
            "debt_to_equity": fundamentals.debt_to_equity,
            "beta": fundamentals.beta,
            "target_price": fundamentals.target_price,
            "recommendation": fundamentals.recommendation,
            "fetched_at": fundamentals.fetched_at
        }
    except Exception as e:
        print(f"Error fetching fundamentals: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= REAL-TIME NEWS =============

class NewsArticleResponse(BaseModel):
    title: str
    content: Optional[str]
    source: str
    url: str
    published_at: datetime
    sentiment: Optional[str] = "Neutral"
    thumbnail: Optional[str] = None
    related_tickers: Optional[List[str]] = []


@router.get("/news/{symbol}/realtime", response_model=List[NewsArticleResponse])
async def get_realtime_news(
    symbol: str,
    limit: int = Query(20, ge=1, le=100),
    sources: Optional[str] = Query(
        None,
        description="Comma-separated sources: yfinance,google,newsapi,marketwatch. Default: all"
    )
):
    """
    Get real-time news from multiple sources
    - yfinance: Fastest, most reliable (200-500ms)
    - Google News: Free RSS feed
    - NewsAPI: Requires API key
    - MarketWatch: Web scraping
    """
    try:
        # Get company name for better search results
        company_name = None  # Could fetch from DB if available
        
        if sources:
            # Fetch from specific sources
            source_list = [s.strip().lower() for s in sources.split(',')]
            articles = []
            
            if 'yfinance' in source_list:
                articles.extend(RealtimeNewsFetcher.fetch_yfinance_news(symbol, limit))
            if 'google' in source_list:
                articles.extend(RealtimeNewsFetcher.fetch_google_news_rss(symbol, limit))
            if 'newsapi' in source_list:
                articles.extend(RealtimeNewsFetcher.fetch_newsapi_news(symbol, company_name, limit))
            if 'marketwatch' in source_list:
                articles.extend(RealtimeNewsFetcher.fetch_marketwatch_news(symbol, limit // 2))
        else:
            # Fetch from all sources
            articles = RealtimeNewsFetcher.fetch_combined_realtime_news(
                symbol,
                company_name,
                limit_per_source=limit // 4
            )
        
        # Limit total results
        articles = articles[:limit]
        
        return [NewsArticleResponse(**article) for article in articles]
        
    except Exception as e:
        print(f"Error fetching real-time news: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch news: {str(e)}")


@router.get("/news/{symbol}/yfinance", response_model=List[NewsArticleResponse])
async def get_yfinance_news(symbol: str, limit: int = Query(20, ge=1, le=50)):
    """Get news exclusively from yfinance (fastest)"""
    try:
        articles = RealtimeNewsFetcher.fetch_yfinance_news(symbol, limit)
        return [NewsArticleResponse(**article) for article in articles]
    except Exception as e:
        print(f"Error fetching yfinance news: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/news/market/breaking")
async def get_breaking_market_news(limit: int = Query(10, ge=1, le=50)):
    """Get breaking market news from Google News RSS"""
    try:
        # Fetch general market news
        articles = RealtimeNewsFetcher.fetch_google_news_rss("stock market", limit)
        return [NewsArticleResponse(**article) for article in articles]
    except Exception as e:
        print(f"Error fetching breaking news: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    db_symbol = db.query(Symbol).filter(Symbol.symbol == symbol.upper()).first()
    
    if not db_symbol:
        # Create symbol
        from app.services.data_fetcher import DataFetcher
        db_symbol = DataFetcher.sync_symbol_to_db(db, symbol.upper())
    
    # Get cached fundamentals
    fundamentals = db.query(Fundamentals).filter(
        Fundamentals.symbol_id == db_symbol.id
    ).first()
    
    # Refresh if older than 1 hour or doesn't exist
    if not fundamentals or (datetime.utcnow() - fundamentals.fetched_at).seconds > 3600:
        fundamentals = EnhancedDataFetcher.sync_fundamentals(symbol.upper(), db)
    
    return {
        "symbol": db_symbol.symbol,
        "company_name": fundamentals.company_name,
        "sector": fundamentals.sector,
        "industry": fundamentals.industry,
        "country": fundamentals.country,
        
        # Valuation
        "market_cap": fundamentals.market_cap,
        "pe_ratio": fundamentals.pe_ratio,
        "forward_pe": fundamentals.forward_pe,
        "peg_ratio": fundamentals.peg_ratio,
        "price_to_sales": fundamentals.price_to_sales,
        "price_to_book": fundamentals.price_to_book,
        
        # Profitability
        "profit_margin": fundamentals.profit_margin,
        "operating_margin": fundamentals.operating_margin,
        "gross_margin": fundamentals.gross_margin,
        "roe": fundamentals.roe,
        "roa": fundamentals.roa,
        "roi": fundamentals.roi,
        
        # Financial health
        "debt_to_equity": fundamentals.debt_to_equity,
        "current_ratio": fundamentals.current_ratio,
        "quick_ratio": fundamentals.quick_ratio,
        
        # Performance
        "beta": fundamentals.beta,
        "rsi": fundamentals.rsi,
        "52w_high": fundamentals.week_52_high,
        "52w_low": fundamentals.week_52_low,
        
        # Earnings
        "eps": fundamentals.eps,
        "eps_next_quarter": fundamentals.eps_next_quarter,
        "earnings_date": fundamentals.earnings_date,
        
        # Analyst
        "target_price": fundamentals.target_price,
        "recommendation": fundamentals.recommendation,
        
        "fetched_at": fundamentals.fetched_at
    }


@router.post("/fundamentals/{symbol}/sync")
async def sync_fundamentals(symbol: str, db: Session = Depends(get_db)):
    """Force refresh fundamentals from Finviz"""
    try:
        fundamentals = EnhancedDataFetcher.sync_fundamentals(symbol.upper(), db)
        return {
            "symbol": symbol.upper(),
            "message": "Fundamentals synced successfully",
            "fetched_at": fundamentals.fetched_at
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============= BULK SYNC =============

@router.post("/sync/sp500")
async def sync_sp500_stocks(
    limit: Optional[int] = Query(None, description="Limit number of stocks to sync"),
    db: Session = Depends(get_db)
):
    """Sync all S&P 500 stocks (use with caution, may take time)"""
    try:
        EnhancedDataFetcher.bulk_sync_sp500(db, limit)
        return {"message": f"S&P 500 sync initiated (limit: {limit or 'all'})"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync/nasdaq")
async def sync_nasdaq_stocks(
    limit: Optional[int] = Query(None, description="Limit number of stocks to sync"),
    db: Session = Depends(get_db)
):
    """Sync all NASDAQ 100 stocks"""
    try:
        EnhancedDataFetcher.bulk_sync_nasdaq(db, limit)
        return {"message": f"NASDAQ sync initiated (limit: {limit or 'all'})"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============= PORTFOLIO MANAGEMENT =============

class CreatePortfolioRequest(BaseModel):
    name: str
    initial_cash: float = 100000.0


class TradeRequest(BaseModel):
    symbol: str
    transaction_type: str  # "BUY" or "SELL"
    quantity: float
    price: Optional[float] = None
    fees: float = 0.0
    notes: Optional[str] = None


@router.post("/portfolio/create")
async def create_portfolio(
    request: CreatePortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create new portfolio for authenticated user"""
    portfolio = PortfolioService.create_portfolio(
        db, current_user.id, request.name, request.initial_cash
    )
    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "initial_cash": portfolio.initial_cash,
        "cash_balance": portfolio.cash_balance
    }


@router.get("/portfolio/{portfolio_id}/summary")
async def get_portfolio_summary(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get comprehensive portfolio summary"""
    # Verify ownership
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio or portfolio.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    summary = PortfolioService.get_portfolio_summary(db, portfolio_id)
    return summary


@router.post("/portfolio/{portfolio_id}/trade")
async def execute_trade(
    portfolio_id: int,
    request: TradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Execute a trade (BUY or SELL)"""
    # Verify ownership
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio or portfolio.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    try:
        transaction_type = TransactionType[request.transaction_type.upper()]
    except KeyError:
        raise HTTPException(status_code=400, detail="Invalid transaction type. Use BUY or SELL")
    
    try:
        transaction = PortfolioService.execute_trade(
            db=db,
            portfolio_id=portfolio_id,
            symbol=request.symbol,
            transaction_type=transaction_type,
            quantity=request.quantity,
            price=request.price,
            fees=request.fees,
            notes=request.notes
        )
        
        return {
            "transaction_id": transaction.id,
            "symbol": request.symbol,
            "type": request.transaction_type,
            "quantity": request.quantity,
            "price": transaction.price,
            "total_amount": transaction.total_amount,
            "timestamp": transaction.transaction_date
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/portfolio/{portfolio_id}/positions")
async def get_positions(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all positions in portfolio"""
    # Verify ownership
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio or portfolio.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    positions = db.query(Position).filter(Position.portfolio_id == portfolio_id).all()
    
    result = []
    for pos in positions:
        symbol = db.query(Symbol).filter(Symbol.id == pos.symbol_id).first()
        result.append({
            "symbol": symbol.symbol if symbol else "",
            "quantity": pos.quantity,
            "avg_cost_basis": pos.avg_cost_basis,
            "current_price": pos.current_price,
            "market_value": pos.market_value,
            "unrealized_pnl": pos.unrealized_pnl,
            "unrealized_pnl_percent": pos.unrealized_pnl_percent
        })
    
    return result


@router.get("/portfolio/{portfolio_id}/transactions")
async def get_transaction_history(
    portfolio_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get transaction history"""
    # Verify ownership
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio or portfolio.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    
    transactions = db.query(Transaction).filter(
        Transaction.portfolio_id == portfolio_id
    ).order_by(Transaction.transaction_date.desc()).limit(limit).all()
    
    result = []
    for txn in transactions:
        symbol = db.query(Symbol).filter(Symbol.id == txn.symbol_id).first()
        result.append({
            "id": txn.id,
            "symbol": symbol.symbol if symbol else "",
            "type": txn.transaction_type.value,
            "quantity": txn.quantity,
            "price": txn.price,
            "total_amount": txn.total_amount,
            "fees": txn.fees,
            "realized_pnl": txn.realized_pnl,
            "notes": txn.notes,
            "date": txn.transaction_date
        })
    
    return result


# ============= FINNHUB INTEGRATION =============

@router.get("/quote/{symbol}/finnhub", response_model=QuoteResponse)
async def get_finnhub_quote(symbol: str, priority: str = Query('high', regex='^(high|normal)$'), db: Session = Depends(get_db)):
    """
    Get real-time quote from Finnhub (ultra-fast)
    Priority: 'high' for research/markets pages (default), 'normal' for others
    """
    start_time = datetime.utcnow()
    
    try:
        quote_data = FinnhubFetcher.get_quote(symbol.upper(), priority=priority)
        
        if not quote_data or 'c' not in quote_data:
            raise HTTPException(status_code=404, detail=f"Quote not found for {symbol}")
        
        change = quote_data.get('c', 0) - quote_data.get('pc', 0)
        change_percent = (change / quote_data.get('pc', 1)) * 100 if quote_data.get('pc') else 0
        latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        
        return QuoteResponse(
            symbol=symbol.upper(),
            last_price=quote_data.get('c', 0),
            change=change,
            change_percent=change_percent,
            volume=None,
            high=quote_data.get('h'),
            low=quote_data.get('l'),
            open=quote_data.get('o'),
            data_source="finnhub",
            latency_ms=latency_ms,
            timestamp=datetime.utcnow()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Finnhub error: {str(e)}")


@router.get("/news/{symbol}/finnhub")
async def get_finnhub_company_news(symbol: str, limit: int = Query(20, le=50), priority: str = Query('high', regex='^(high|normal)$')):
    """Get company news from Finnhub with rate limiting"""
    try:
        news_data = FinnhubFetcher.get_company_news(symbol.upper(), priority=priority)
        
        articles = []
        for item in news_data[:limit]:
            articles.append({
                "title": item.get('headline', ''),
                "summary": item.get('summary', ''),
                "url": item.get('url', ''),
                "source": item.get('source', 'Finnhub'),
                "published_at": datetime.fromtimestamp(item.get('datetime', 0)).isoformat() if item.get('datetime') else datetime.utcnow().isoformat(),
                "thumbnail": item.get('image'),
                "related_tickers": item.get('related', '').split(',') if item.get('related') else [symbol.upper()],
                "sentiment": None
            })
        
        return articles
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Finnhub news error: {str(e)}")


@router.get("/news/market/finnhub")
async def get_finnhub_market_news(category: str = "general", limit: int = Query(20, le=50), priority: str = Query('high', regex='^(high|normal)$')):
    """Get market news from Finnhub with rate limiting"""
    try:
        news_data = FinnhubFetcher.get_market_news(category, limit, priority=priority)
        
        articles = []
        for item in news_data:
            articles.append({
                "title": item.get('headline', ''),
                "summary": item.get('summary', ''),
                "url": item.get('url', ''),
                "source": item.get('source', 'Finnhub'),
                "published_at": datetime.fromtimestamp(item.get('datetime', 0)).isoformat() if item.get('datetime') else datetime.utcnow().isoformat(),
                "thumbnail": item.get('image'),
                "related_tickers": item.get('related', '').split(',') if item.get('related') else [],
                "sentiment": None
            })
        
        return articles
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Finnhub market news error: {str(e)}")


@router.get("/company/{symbol}/profile")
async def get_company_profile(symbol: str, priority: str = Query('normal', regex='^(high|normal)$')):
    """Get company profile from Finnhub with rate limiting"""
    try:
        profile = FinnhubFetcher.get_company_profile(symbol.upper(), priority=priority)
        financials = FinnhubFetcher.get_basic_financials(symbol.upper())
        
        return {
            "symbol": symbol.upper(),
            "name": profile.get('name'),
            "logo": profile.get('logo'),
            "country": profile.get('country'),
            "currency": profile.get('currency'),
            "exchange": profile.get('exchange'),
            "industry": profile.get('finnhubIndustry'),
            "ipo_date": profile.get('ipo'),
            "market_cap": profile.get('marketCapitalization'),
            "shares_outstanding": profile.get('shareOutstanding'),
            "website": profile.get('weburl'),
            "metrics": financials.get('metric', {})
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Company profile error: {str(e)}")


@router.get("/sentiment/{symbol}")
async def get_market_sentiment(symbol: str):
    """Get social sentiment for a symbol from Finnhub"""
    try:
        sentiment_data = FinnhubFetcher.get_sentiment(symbol.upper())
        return sentiment_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sentiment error: {str(e)}")


@router.get("/recommendations/{symbol}")
async def get_recommendations(symbol: str, priority: str = Query('normal', regex='^(high|normal)$')):
    """Get analyst recommendations from Finnhub with rate limiting"""
    try:
        recs = FinnhubFetcher.get_recommendation_trends(symbol.upper(), priority=priority)
        target = FinnhubFetcher.get_price_target(symbol.upper(), priority=priority)
        
        return {
            "recommendations": recs,
            "price_target": target
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recommendations error: {str(e)}")


@router.get("/api-stats")
async def get_finnhub_api_stats():
    """Get Finnhub API usage statistics and rate limit info"""
    stats = get_api_stats()
    return {
        "finnhub": {
            "rate_limit": {
                "max_calls_per_minute": stats['max_calls'],
                "remaining_calls": stats['remaining_calls'],
                "wait_time_seconds": round(stats['wait_time'], 2),
                "status": "available" if stats['remaining_calls'] > 0 else "rate_limited"
            },
            "cache": {
                "entries": stats['cache_size'],
                "hit_ratio": "calculated_on_client"  # Can be enhanced later
            },
            "recommendations": {
                "use_priority_high": "research and markets pages",
                "use_priority_normal": "dashboard and other pages",
                "cache_enabled": True
            }
        }
    }
