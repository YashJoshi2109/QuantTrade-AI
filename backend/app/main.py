"""
Main FastAPI application entry point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import (
    symbols,
    prices,
    indicators,
    chat,
    news,
    filings,
    risk,
    watchlist,
    backtest,
    auth,
    market,
    market_status,
    chat_history,
    enhanced_endpoints,
    quotes,
    billing,
)
from app.db.database import engine, Base

# Import all models to ensure they're registered with SQLAlchemy
from app.models import (
    Symbol,
    PriceBar,
    Watchlist,
    NewsArticle,
    Filing,
    FilingChunk,
    ChatHistory,
    BillingCustomer,
    Subscription,
    BillingEvent,
    Fundamentals,
    Portfolio,
    Position,
    Transaction,
    TransactionType,
    PortfolioSnapshot,
    RealtimeQuote,
    MarketIndex,
    QuoteHistory,
)
from app.models.user import User

# Create database tables (with error handling for production)
try:
    Base.metadata.create_all(bind=engine, checkfirst=True)
    print("✅ Database tables created/verified successfully")
except Exception as e:
    error_msg = str(e)
    if "already exists" in error_msg or "DuplicateTable" in error_msg:
        print("✅ Database tables already exist - skipping creation")
    else:
        print(f"⚠️ Database table creation error: {e}")
        print("   App will continue but some database features may not work")

app = FastAPI(
    title="AI Trading & Research Copilot API",
    description="Backend API for AI-powered trading and research platform",
    version="0.1.0"
)

# CORS middleware
# Get allowed origins from environment or use defaults
import os
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,https://quanttrade.us,https://www.quanttrade.us"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(symbols.router, prefix="/api/v1", tags=["symbols"])
app.include_router(prices.router, prefix="/api/v1", tags=["prices"])
app.include_router(indicators.router, prefix="/api/v1", tags=["indicators"])
app.include_router(chat.router, prefix="/api/v1", tags=["chat"])
app.include_router(news.router, prefix="/api/v1", tags=["news"])
app.include_router(filings.router, prefix="/api/v1", tags=["filings"])
app.include_router(risk.router, prefix="/api/v1", tags=["risk"])
app.include_router(watchlist.router, prefix="/api/v1", tags=["watchlist"])
app.include_router(backtest.router, prefix="/api/v1", tags=["backtest"])
app.include_router(market.router, prefix="/api/v1", tags=["market"])
app.include_router(market_status.router, prefix="/api/v1", tags=["market-status"])
app.include_router(chat_history.router, prefix="/api/v1", tags=["chat-history"])
app.include_router(enhanced_endpoints.router, prefix="/api/v1/enhanced", tags=["enhanced"])
app.include_router(quotes.router, prefix="/api/v1", tags=["quotes"])
app.include_router(billing.router, prefix="/api/v1/billing", tags=["billing"])


@app.get("/")
async def root():
    return {
        "message": "AI Trading & Research Copilot API",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}
