"""
Main FastAPI application entry point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import symbols, prices, indicators, chat, news, filings, risk, watchlist, backtest, auth, market
from app.db.database import engine, Base

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="AI Trading & Research Copilot API",
    description="Backend API for AI-powered trading and research platform",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
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
