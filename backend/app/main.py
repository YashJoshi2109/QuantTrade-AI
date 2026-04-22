"""
Main FastAPI application entry point
"""
import logging
import threading
from contextlib import asynccontextmanager

# Inject AWS Secrets Manager values BEFORE any app imports read os.environ
try:
    from app.config_aws import inject_aws_secrets
    inject_aws_secrets()
except Exception as _aws_err:
    print(f"⚠️ AWS secrets load skipped: {_aws_err}")

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
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
    connect,
    finviz,
    global_monitor,
    game,
    ai_image,
    voice,
    account,
    user_preferences,
)
from app.api import options
from app.api import monitor_extended
from app.api import copilot_stream
from app.api import ideas
from app.api import model_index as model_index_api
from app.api import community, posts, comments, notifications, users, search
from app.api import bookmarks, uploads, reactions
from app.api import mlops
from app.api import moderation as moderation_api
from app.api import bans
from app.api import ws as ws_api
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
    ConnectedAccount,
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
from app.models.game import (
    GameCharacter, GameWallet, GameMission,
    GameCommunityGroup, GameCharacterCommunity,
    GamePortfolioHolding, GameEventLog,
)
from app.models.api_usage import APIUsage
from app.models.community import (
    Community, CommunityMember, Post, Comment,
    Vote, Reaction, Notification, UserFollow,
    ModerationReport, ModerationAction, AuditLog,
    CommunityBan,
)
from app.models.global_monitor import (
    GlobalEvent,
    CountryInstability,
    EventAnomaly,
    GeographicCluster,
    TickerImpact,
    DataIngestionLog,
    MarketImpactHistory,
)
from app.models.model_index import (
    ModelIndexSnapshot,
    BasketHolding,
    FactorScoreHistory,
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

        def _pro_watchlist_alerts():
            db = SessionLocal()
            try:
                from app.services.watchlist_alert_service import run_watchlist_alerts_sync

                run_watchlist_alerts_sync(db)
            except Exception as e:
                print(f"⚠️ Pro watchlist alerts error: {e}")
            finally:
                db.close()

        sched = BackgroundScheduler(timezone="UTC")
        # Nightly at 00:30 UTC — refresh universe
        sched.add_job(_nightly_sync, CronTrigger(hour=0, minute=30), id="exchange_nightly_sync", replace_existing=True)
        # Weekly cleanup — Sunday 03:00 UTC
        sched.add_job(_weekly_cleanup, CronTrigger(day_of_week="sun", hour=3, minute=0), id="exchange_weekly_cleanup", replace_existing=True)
        # Pro watchlist price + news emails — every 20 minutes UTC
        sched.add_job(
            _pro_watchlist_alerts,
            CronTrigger(minute="*/20"),
            id="pro_watchlist_alerts",
            replace_existing=True,
        )
        # ── Real-time Ideas Lab scheduler jobs ──
        from apscheduler.triggers.interval import IntervalTrigger
        from app.services.idea_scheduler import (
            rescore_ideas, update_market_pulse,
            news_sentiment_check, market_open_scan,
            ingest_rag_data,
        )
        # Re-score ideas every 5 minutes with real market data
        sched.add_job(rescore_ideas, IntervalTrigger(minutes=5),
                      id="rescore_ideas", replace_existing=True)
        # Update market pulse every 2 minutes
        sched.add_job(update_market_pulse, IntervalTrigger(minutes=2),
                      id="update_market_pulse", replace_existing=True)
        # News sentiment check every 10 minutes
        sched.add_job(news_sentiment_check, IntervalTrigger(minutes=10),
                      id="news_sentiment_check", replace_existing=True)
        # Market open full scan at 9:30 AM ET (13:30 UTC)
        sched.add_job(market_open_scan, CronTrigger(hour=13, minute=30),
                      id="market_open_scan", replace_existing=True)
        # RAG data ingestion every 6 hours for copilot retrieval
        sched.add_job(ingest_rag_data, IntervalTrigger(hours=6),
                      id="rag_data_ingestion", replace_existing=True)

        sched.start()
        _scheduler = sched
        print("✅ APScheduler started — exchange universe + real-time ideas jobs scheduled")
    except ImportError:
        print("⚠️ APScheduler not installed — skipping batch jobs. Run: pip install APScheduler")
    except Exception as e:
        print(f"⚠️ Scheduler startup error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize Redis connection for API caching
    import os
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    try:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(redis_url, decode_responses=True, socket_connect_timeout=5)
        await redis_client.ping()
        app.state.redis = redis_client
        # Initialize universal Redis cache service
        from app.services.redis_cache_service import cache_service
        cache_service.init_redis(redis_client)
        print(f"✅ Redis connected + cache service initialized: {redis_url.split('@')[-1] if '@' in redis_url else redis_url}")

        # Register Redis cache middleware
        from app.middleware.redis_cache import RedisCacheMiddleware
        app.add_middleware(RedisCacheMiddleware, redis_client=redis_client)
    except Exception as e:
        app.state.redis = None
        print(f"⚠️ Redis cache disabled: {e}")

    # Run table creation in a thread so /health is available immediately
    t = threading.Thread(target=_create_db_tables, daemon=True)
    t.start()
    # Start background scheduler
    sched_t = threading.Thread(target=_start_scheduler, daemon=True)
    sched_t.start()

    # Warm caches after DB is ready (non-blocking)
    def _warm_caches():
        import time
        time.sleep(8)  # Wait for DB tables
        try:
            from app.db.database import SessionLocal
            if SessionLocal is None:
                return
            db = SessionLocal()
            try:
                # Pre-load model index snapshots into memory cache
                from app.api.model_index import _snapshot_cache, _batch_cache
                from app.models.model_index import ModelIndexSnapshot
                from app.services.model_index.model_index import INDEX_DEFINITIONS
                import json as _json
                loaded = 0
                for index_id in INDEX_DEFINITIONS:
                    snap = (
                        db.query(ModelIndexSnapshot)
                        .filter(ModelIndexSnapshot.index_id == index_id)
                        .order_by(ModelIndexSnapshot.created_at.desc())
                        .first()
                    )
                    if snap and snap.snapshot_data:
                        try:
                            _snapshot_cache[index_id] = _json.loads(snap.snapshot_data)
                            loaded += 1
                        except Exception:
                            pass
                print(f"✅ Cache warmed: {loaded} model index snapshots pre-loaded")
            finally:
                db.close()
        except Exception as e:
            print(f"⚠️ Cache warming failed: {e}")

    warm_t = threading.Thread(target=_warm_caches, daemon=True)
    warm_t.start()

    yield
    # Shutdown
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    if hasattr(app.state, 'redis') and app.state.redis:
        await app.state.redis.close()
    t.join(timeout=1.0)


app = FastAPI(
    title="AI Trading & Research Copilot API",
    description="Backend API for AI-powered trading and research platform",
    version="0.1.0",
    lifespan=lifespan,
)

_db_logger = logging.getLogger("api.database")


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
    """Never return raw SQL / schema details to clients (OWASP: error handling)."""
    _db_logger.exception(
        "Database error %s %s",
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Service temporarily unavailable. Please try again shortly.",
        },
    )


# Cache control middleware for market data endpoints
class CacheControlMiddleware(BaseHTTPMiddleware):
    """Add Cache-Control + stale-while-revalidate headers for GET endpoints."""

    # More specific paths first (startswith matches first hit)
    CACHE_PATHS = {
        # Market data
        "/api/v1/market/ipo-calendar": 300,
        "/api/v1/market/sectors": 60,
        "/api/v1/market/movers": 60,
        "/api/v1/market/yahoo-screener": 60,
        "/api/v1/market/": 30,
        # Model index / AI baskets
        "/api/v1/model-index/batch": 120,
        "/api/v1/model-index/indices": 120,
        "/api/v1/model-index/regime": 60,
        # Enhanced endpoints
        "/api/v1/enhanced/market-indices": 30,
        "/api/v1/enhanced/news/": 120,
        "/api/v1/enhanced/api-stats": 30,
        "/api/v1/enhanced/prediction-alerts": 60,
        "/api/v1/enhanced/quote/": 30,
        # Quotes
        "/api/v1/quotes": 30,
        # Monitor / geopolitical
        "/api/v1/monitor/economic-indicators": 300,
        "/api/v1/monitor/trade-policies": 300,
        "/api/v1/monitor/": 120,
        # Ideas
        "/api/v1/ideas/trending": 120,
    }

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if request.method != "GET":
            return response

        path = request.url.path
        for cache_path, max_age in self.CACHE_PATHS.items():
            if path.startswith(cache_path):
                response.headers["Cache-Control"] = (
                    f"public, max-age={max_age}, stale-while-revalidate={max_age * 2}"
                )
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
app.include_router(options.router, prefix="/api/v1", tags=["options"])
app.include_router(billing.router, prefix="/api/v1/billing", tags=["billing"])
app.include_router(account.router, prefix="/api/v1/account", tags=["account"])
app.include_router(
    user_preferences.router, prefix="/api/v1/user", tags=["user-preferences"]
)
app.include_router(connect.router, prefix="/api/v1/connect", tags=["connect"])

# Finviz stock data endpoint
app.include_router(finviz.router, prefix="/api/v1", tags=["finviz"])

# Global Monitor endpoint
app.include_router(global_monitor.router, tags=["global-monitor"])
app.include_router(monitor_extended.router, tags=["global-monitor-extended"])

# QuantTrade Life — Game engine (all routes JWT-protected server-side)
app.include_router(game.router, prefix="/api/v1/game", tags=["game"])
app.include_router(ai_image.router, prefix="/api/v1/ai-image", tags=["ai-image"])
app.include_router(voice.router, prefix="/api/v1/voice", tags=["voice"])

# AI Ideas Lab — Trade idea generation
app.include_router(ideas.router, prefix="/api/v1/ideas", tags=["ideas"])

# Model Index Engine — AI basket intelligence
app.include_router(model_index_api.router, prefix="/api/v1/model-index", tags=["model-index"])

# AI Copilot — Streaming SSE endpoint (RAG + Quant + LLM pipeline)
app.include_router(copilot_stream.router, prefix="/api/v1", tags=["copilot"])

# WebSocket — Real-time market data push (ideas, pulse, scanner)
app.include_router(ws_api.router, prefix="/api/v1", tags=["websocket"])

# Community — Social forums, posts, comments, notifications
app.include_router(community.router, prefix="/api/v1", tags=["community"])
app.include_router(posts.router, prefix="/api/v1", tags=["posts"])
app.include_router(comments.router, prefix="/api/v1", tags=["comments"])
app.include_router(notifications.router, prefix="/api/v1", tags=["notifications"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])

# Bookmarks — save/unsave posts
app.include_router(bookmarks.router, prefix="/api/v1", tags=["bookmarks"])

# Reactions — emoji reactions on posts
app.include_router(reactions.router, prefix="/api/v1", tags=["reactions"])

# Uploads — image upload for community media
app.include_router(uploads.router, prefix="/api/v1", tags=["uploads"])

# Moderation — AI content moderation pipeline + audit log
app.include_router(moderation_api.router, prefix="/api/v1", tags=["moderation"])

# Search — unified full-text search across community content
app.include_router(search.router, prefix="/api/v1", tags=["search"])

# Bans — community ban management
app.include_router(bans.router, prefix="/api/v1", tags=["bans"])

# MLOps — model registry, experiments, monitoring, pipeline control
app.include_router(mlops.router, prefix="/api/v1", tags=["mlops"])

# ML Training Pipeline — internal operator API
from app.api import ml_runs
app.include_router(ml_runs.router, prefix="/api/v1", tags=["ml-pipeline"])


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
