"""
Main FastAPI application entry point
"""
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
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
    finviz,
    global_monitor,
)
from app.api import monitor_extended
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
from app.models.passkey_credential import PasskeyCredential
from app.models.global_monitor import (
    GlobalEvent,
    CountryInstability,
    EventAnomaly,
    GeographicCluster,
    TickerImpact,
    DataIngestionLog,
    MarketImpactHistory,
)


def _create_db_tables():
    """Run DB table creation in background so app can serve /health immediately."""
    if engine is None:
        print("⚠️ Skipping table creation - no database configured")
        return
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


# ── APScheduler — Exchange universe batch jobs ─────────────────────────────────
_scheduler = None

def _start_scheduler():
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from app.db.database import SessionLocal
        from app.services.exchange_universe_service import sync_all_exchanges, cleanup_stale_symbols

        if SessionLocal is None:
            print("⚠️ Skipping scheduler — no database configured")
            return

        def _nightly_sync():
            db = SessionLocal()
            try:
                results = sync_all_exchanges(db)
                total = sum(v for v in results.values() if v > 0)
                print(f"🌍 Exchange universe nightly sync complete: {total} symbols updated")
            except Exception as e:
                print(f"⚠️ Exchange universe sync error: {e}")
            finally:
                db.close()

        def _weekly_cleanup():
            db = SessionLocal()
            try:
                n = cleanup_stale_symbols(db)
                print(f"🧹 Weekly cleanup: {n} stale symbols marked inactive")
            except Exception as e:
                print(f"⚠️ Weekly cleanup error: {e}")
            finally:
                db.close()

        sched = BackgroundScheduler(timezone="UTC")
        # Nightly at 00:30 UTC — refresh universe
        sched.add_job(_nightly_sync, CronTrigger(hour=0, minute=30), id="exchange_nightly_sync", replace_existing=True)
        # Weekly cleanup — Sunday 03:00 UTC
        sched.add_job(_weekly_cleanup, CronTrigger(day_of_week="sun", hour=3, minute=0), id="exchange_weekly_cleanup", replace_existing=True)
        sched.start()
        _scheduler = sched
        print("✅ APScheduler started — exchange universe batch jobs scheduled")
    except ImportError:
        print("⚠️ APScheduler not installed — skipping batch jobs. Run: pip install APScheduler")
    except Exception as e:
        print(f"⚠️ Scheduler startup error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run table creation in a thread so /health is available immediately
    t = threading.Thread(target=_create_db_tables, daemon=True)
    t.start()
    # Start background scheduler
    sched_t = threading.Thread(target=_start_scheduler, daemon=True)
    sched_t.start()
    yield
    # Shutdown
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    t.join(timeout=1.0)


app = FastAPI(
    title="AI Trading & Research Copilot API",
    description="Backend API for AI-powered trading and research platform",
    version="0.1.0",
    lifespan=lifespan,
)


# Cache control middleware for market data endpoints
class CacheControlMiddleware(BaseHTTPMiddleware):
    """Add cache headers for specific endpoints to improve performance"""
    
    # More specific paths first (startswith matches first hit)
    CACHE_PATHS = {
        "/api/v1/market/ipo-calendar": 300,  # IPO list changes slowly
        "/api/v1/market/": 30,  # 30 second cache for market data
        "/api/v1/enhanced/market-indices": 30,  # 30 second cache for indices
        "/api/v1/market/sectors": 60,  # 60 second cache for sectors
        "/api/v1/market/movers": 60,  # 60 second cache for movers
    }
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        path = request.url.path
        for cache_path, max_age in self.CACHE_PATHS.items():
            if path.startswith(cache_path):
                response.headers["Cache-Control"] = f"public, max-age={max_age}"
                break
        
        return response


app.add_middleware(CacheControlMiddleware)

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

# Finviz stock data endpoint
app.include_router(finviz.router, prefix="/api/v1", tags=["finviz"])

# Global Monitor endpoint
app.include_router(global_monitor.router, tags=["global-monitor"])
app.include_router(monitor_extended.router, tags=["global-monitor-extended"])


@app.get("/")
async def root():
    return {
        "message": "AI Trading & Research Copilot API",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health")
async def health():
    return {"status": "healthy chal raha hai sab kuch"}
