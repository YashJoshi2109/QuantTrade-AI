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
from app.config import settings

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
    """Get major market indices using yfinance with PARALLEL fetching and database cache"""
    import yfinance as yf
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from app.models.realtime_quote import MarketIndex
    
    indices_config = [
        {"symbol": "^GSPC", "name": "S&P 500"},
        {"symbol": "^IXIC", "name": "NASDAQ"},
        {"symbol": "^DJI", "name": "Dow Jones"},
        {"symbol": "^RUT", "name": "Russell 2000"},
    ]
    
    def fetch_index_sync(config: dict) -> dict:
        """Synchronous index fetch for thread pool"""
        try:
            ticker = yf.Ticker(config["symbol"])
            hist = ticker.history(period="2d")
            
            if not hist.empty and len(hist) >= 2:
                current_price = float(hist['Close'].iloc[-1])
                prev_close = float(hist['Close'].iloc[-2])
                change = current_price - prev_close
                change_percent = (change / prev_close * 100) if prev_close else 0
                
                return {
                    "symbol": config["symbol"],
                    "name": config["name"],
                    "price": round(current_price, 2),
                    "change": round(change, 2),
                    "change_percent": round(change_percent, 2),
                    "timestamp": datetime.utcnow(),
                    "success": True
                }
        except Exception as e:
            print(f"yfinance error for {config['symbol']}: {e}")
        
        return {
            "symbol": config["symbol"],
            "name": config["name"],
            "success": False
        }
    
    results = []
    loop = asyncio.get_event_loop()
    
    # Fetch all indices in PARALLEL using thread pool
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [loop.run_in_executor(executor, fetch_index_sync, config) for config in indices_config]
        fetched = await asyncio.gather(*futures)
    
    # Process results and handle fallbacks
    for result in fetched:
        if result.get("success"):
            # Cache to database (async-safe)
            try:
                db_index = db.query(MarketIndex).filter(
                    MarketIndex.index_symbol == result["symbol"]
                ).first()
                
                if db_index:
                    db_index.last_price = result["price"]
                    db_index.change = result["change"]
                    db_index.change_percent = result["change_percent"]
                    db_index.quote_timestamp = result["timestamp"]
                else:
                    db_index = MarketIndex(
                        index_symbol=result["symbol"],
                        index_name=result["name"],
                        last_price=result["price"],
                        change=result["change"],
                        change_percent=result["change_percent"],
                        quote_timestamp=result["timestamp"]
                    )
                    db.add(db_index)
                db.commit()
            except Exception as db_error:
                print(f"DB cache error for {result['symbol']}: {db_error}")
                db.rollback()
            
            results.append({
                "symbol": result["symbol"],
                "name": result["name"],
                "price": result["price"],
                "change": result["change"],
                "change_percent": result["change_percent"],
                "timestamp": result["timestamp"]
            })
        else:
            # Use database cache as fallback
            try:
                db_index = db.query(MarketIndex).filter(
                    MarketIndex.index_symbol == result["symbol"]
                ).first()
                
                if db_index and db_index.last_price:
                    results.append({
                        "symbol": result["symbol"],
                        "name": result["name"],
                        "price": round(db_index.last_price, 2),
                        "change": round(db_index.change or 0, 2),
                        "change_percent": round(db_index.change_percent or 0, 2),
                        "timestamp": db_index.quote_timestamp or datetime.utcnow()
                    })
                else:
                    results.append({
                        "symbol": result["symbol"],
                        "name": result["name"],
                        "price": 0,
                        "change": 0,
                        "change_percent": 0,
                        "timestamp": datetime.utcnow()
                    })
            except Exception:
                results.append({
                    "symbol": result["symbol"],
                    "name": result["name"],
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
                articles.extend(RealtimeNewsFetcher.fetch_marketwatch_news(symbol, max(limit // 2, 5)))
        else:
            # Fetch from all sources - ensure minimum per source
            limit_per_source = max(limit // 4, 5)  # At least 5 per source
            articles = RealtimeNewsFetcher.fetch_combined_realtime_news(
                symbol,
                company_name,
                limit_per_source=limit_per_source
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
    """
    Get breaking market news from multiple sources.
    Combines Google News RSS (multiple queries), yfinance (market ETFs),
    and NewsAPI when available for comprehensive daily coverage.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import re

    BULLISH_KEYWORDS = [
        'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'gain', 'gains',
        'jump', 'jumps', 'rise', 'rises', 'climb', 'climbs', 'record high',
        'all-time high', 'bull', 'bullish', 'upgrade', 'upgrades', 'beat',
        'beats', 'outperform', 'boom', 'recover', 'recovery', 'breakout',
        'positive', 'strong', 'growth', 'profit', 'profits', 'up %',
    ]
    BEARISH_KEYWORDS = [
        'crash', 'crashes', 'plunge', 'plunges', 'tumble', 'tumbles', 'drop',
        'drops', 'fall', 'falls', 'decline', 'declines', 'slump', 'slumps',
        'sell-off', 'selloff', 'bear', 'bearish', 'downgrade', 'downgrades',
        'miss', 'misses', 'underperform', 'recession', 'fear', 'fears',
        'warning', 'risk', 'loss', 'losses', 'negative', 'weak', 'cut',
        'layoff', 'layoffs', 'down %', 'inflation',
    ]

    def classify_sentiment(title: str, content: str = "") -> str:
        text = (title + " " + (content or "")).lower()
        bull_score = sum(1 for kw in BULLISH_KEYWORDS if kw in text)
        bear_score = sum(1 for kw in BEARISH_KEYWORDS if kw in text)
        if bull_score > bear_score and bull_score >= 1:
            return "Bullish"
        if bear_score > bull_score and bear_score >= 1:
            return "Bearish"
        return "Neutral"

    def extract_tickers(title: str) -> list:
        """Extract stock tickers from title (uppercase 1-5 letter words preceded by $ or in parentheses)."""
        tickers = re.findall(r'\$([A-Z]{1,5})\b', title)
        tickers += re.findall(r'\(([A-Z]{1,5})\)', title)
        # Filter common false positives
        noise = {'CEO', 'IPO', 'GDP', 'ETF', 'SEC', 'FDA', 'NYSE', 'AI', 'US', 'UK', 'EU', 'FED', 'CPI', 'AND', 'THE', 'FOR', 'ARE', 'BUT'}
        return [t for t in set(tickers) if t not in noise][:5]

    try:
        all_articles = []

        # ── 1. Google News RSS – multiple market queries in parallel ──
        rss_queries = [
            "stock market today",
            "Wall Street finance",
            "S&P 500 Nasdaq Dow Jones",
            "economy finance breaking news",
            "earnings report stocks",
        ]

        per_query_limit = max(limit // 3, 5)

        def _fetch_rss(q):
            return RealtimeNewsFetcher.fetch_google_news_rss(q, per_query_limit)

        with ThreadPoolExecutor(max_workers=5) as pool:
            rss_futures = {pool.submit(_fetch_rss, q): q for q in rss_queries}

            # ── 2. yfinance – broad market ETFs for real financial-grade news ──
            yf_symbols = ["SPY", "QQQ", "DIA"]
            yf_futures = {}
            for sym in yf_symbols:
                yf_futures[pool.submit(RealtimeNewsFetcher.fetch_yfinance_news, sym, per_query_limit)] = sym

            # ── 3. NewsAPI (if key configured) ──
            newsapi_future = None
            if getattr(settings, 'NEWSAPI_KEY', None):
                newsapi_future = pool.submit(
                    RealtimeNewsFetcher.fetch_newsapi_news,
                    "stock market",
                    "stock market Wall Street finance",
                    per_query_limit
                )

            # Collect RSS results
            for future in as_completed(rss_futures):
                try:
                    all_articles.extend(future.result())
                except Exception as e:
                    print(f"RSS query error: {e}")

            # Collect yfinance results
            for future in as_completed(yf_futures):
                try:
                    all_articles.extend(future.result())
                except Exception as e:
                    print(f"yfinance error: {e}")

            # Collect NewsAPI results
            if newsapi_future:
                try:
                    all_articles.extend(newsapi_future.result())
                except Exception as e:
                    print(f"NewsAPI error: {e}")

        # ── Deduplicate by URL + title ──
        seen_urls = set()
        seen_titles = set()
        unique = []
        for article in all_articles:
            url = (article.get('url') or '').strip()
            title = (article.get('title') or '').strip()
            title_key = title.lower()[:80]  # normalize for comparison
            if url and url in seen_urls:
                continue
            if title_key and title_key in seen_titles:
                continue
            if url:
                seen_urls.add(url)
            if title_key:
                seen_titles.add(title_key)

            # Apply sentiment classification if not already set
            if article.get('sentiment') in (None, 'Neutral', ''):
                article['sentiment'] = classify_sentiment(
                    article.get('title', ''),
                    article.get('content', ''),
                )

            # Extract tickers from title if not provided
            if not article.get('related_tickers'):
                tickers = extract_tickers(article.get('title', ''))
                if tickers:
                    article['related_tickers'] = tickers

            unique.append(article)

        # ── Sort by recency ──
        unique.sort(
            key=lambda x: x.get('published_at', datetime.utcnow()),
            reverse=True,
        )

        final = unique[:limit]
        print(f"✓ Breaking news: {len(final)} articles (from {len(all_articles)} raw, {len(unique)} unique)")
        return [NewsArticleResponse(**a) for a in final]

    except Exception as e:
        print(f"Error fetching breaking news: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fundamentals/{symbol}")
async def get_fundamentals(symbol: str, db: Session = Depends(get_db)):
    """Get fundamental data for a symbol"""
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
    needs_refresh = False
    if fundamentals is None or fundamentals.fetched_at is None:
        needs_refresh = True
    else:
        # Handle timezone-aware vs naive datetimes safely
        from datetime import timezone
        now = datetime.now(tz=fundamentals.fetched_at.tzinfo or timezone.utc)
        age_seconds = (now - fundamentals.fetched_at).total_seconds()
        needs_refresh = age_seconds > 3600

    if needs_refresh:
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
        # Use week_52_* naming to match frontend expectations
        "week_52_high": fundamentals.week_52_high,
        "week_52_low": fundamentals.week_52_low,
        
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
