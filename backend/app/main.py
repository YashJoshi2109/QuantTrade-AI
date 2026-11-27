"""
Main FastAPI application entry point
"""
import asyncio
import logging
import os
import sys
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
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.db.database import SessionLocal
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from app.api import (
    symbols,
    prices,
    indicators,
    news,
    filings,
    risk,
    watchlist,
    backtest,
    backtest_v2,
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
from app.api import copilot as copilot_api
from app.api import ideas
from app.api import model_index as model_index_api
from app.api import community, posts, comments, notifications, users, search
from app.api import community_bots as community_bots_api
from app.api import bookmarks, uploads, reactions
from app.api import mlops
from app.api import moderation as moderation_api
from app.api import research as research_api
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
from app.models.community_bot import CommunityBot as _CommunityBot  # noqa: F401  (community_bots tables)
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
from app.models.ml_training import (
    TrainingRun as _TrainingRun,
    TrainingShard as _TrainingShard,
    TrainingArtifact as _TrainingArtifact,
    ModelVersion as _MLModelVersion,
)
from app.models.edgar import CompanyEDGAR, FinancialStatement
from app.models.news_item import NewsItem as _NewsItem  # noqa: F401  (news_items table)
from app.models.price_alert import PriceAlert as _PriceAlert  # noqa: F401  (price_alerts table)
from app.models.marketwatch import MarketwatchList as _MarketwatchList  # noqa: F401  (marketwatch tables)
from app.models.screener_snapshot import ScreenerSnapshot as _ScreenerSnapshot  # noqa: F401  (screener_snapshots table)
from app.models import admin as _admin_models  # noqa: F401  (admin console tables)


def _create_db_tables():
    """Run DB table creation in background so app can serve /health immediately."""
    if engine is None:
        print("⚠️ Skipping table creation - no database configured")
        return
    # pg_trgm enables fuzzy symbol search. Best effort: a non-superuser role
    # can't create it, and search falls back to ILIKE in that case.
    if engine.dialect.name == "postgresql":
        try:
            from sqlalchemy import text as _text
            with engine.begin() as conn:
                conn.execute(_text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        except Exception as e:
            print(f"⚠️ pg_trgm extension unavailable (symbol search uses ILIKE): {e}")
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        print("✅ Database tables created/verified successfully")
        try:
            from app.models.admin import install_audit_guard
            install_audit_guard(engine)
        except Exception as e:
            print(f"⚠️ admin_audit_log guard not installed (run scripts/create_admin_console_tables.py): {e}")
        try:
            from app.services.admin_metrics import record_deploy
            record_deploy()
        except Exception as e:
            print(f"⚠️ deploy event not recorded: {e}")
        try:
            from app.models.price_alert import ensure_price_alert_columns
            ensure_price_alert_columns(engine)
        except Exception as e:
            print(f"⚠️ price_alerts column migration failed (run scripts/add_price_alert_event_key_column.py): {e}")
        try:
            from app.models.symbol import ensure_symbol_lifecycle_columns
            ensure_symbol_lifecycle_columns(engine)
        except Exception as e:
            print(f"⚠️ symbols lifecycle column migration failed (run scripts/add_symbol_lifecycle_columns.py): {e}")
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
        # User price / indicator alerts (in-app notifications; email for Pro) — every 5 minutes
        def _user_price_alerts():
            db = SessionLocal()
            try:
                from app.services.price_alert_service import run_price_alerts_sync

                run_price_alerts_sync(db)
            except Exception as e:
                print(f"⚠️ User price alerts error: {e}")
            finally:
                db.close()

        sched.add_job(
            _user_price_alerts,
            CronTrigger(minute="*/5"),
            id="user_price_alerts",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # Portfolio value history: one snapshot per portfolio after the US close
        # (21:30 UTC is after 16:00 ET in both EST and EDT), Mon-Fri.
        def _portfolio_snapshots():
            db = SessionLocal()
            try:
                from app.services.portfolio_history import run_daily_snapshots_sync

                res = run_daily_snapshots_sync(db)
                print(f"📈 Portfolio snapshots: {res}")
            except Exception as e:
                print(f"⚠️ Portfolio snapshot job error: {e}")
            finally:
                db.close()

        sched.add_job(
            _portfolio_snapshots,
            CronTrigger(day_of_week="mon-fri", hour=21, minute=30),
            id="portfolio_daily_snapshots",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # ── Real-time Ideas Lab scheduler jobs ──
        from apscheduler.triggers.interval import IntervalTrigger
        from app.services.idea_scheduler import (
            rescore_ideas, update_market_pulse,
            news_sentiment_check, market_open_scan,
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
        # Community bots: labelled, rate-limited data posts (ET cron per slot).
        # Kill switches (COMMUNITY_BOTS_ENABLED / COMMUNITY_BOTS_DISABLED / admin
        # flag) are read at run time, so jobs are always registered.
        try:
            from app.services.community_bots.scheduler import register_bot_jobs
            bot_jobs = register_bot_jobs(sched)
            print(f"🤖 Community bots scheduled: {len(bot_jobs)} jobs")
        except Exception as e:
            print(f"⚠️ Community bot scheduling failed: {e}")
        # (SEC filing index refresh for the copilot runs in the news-worker:
        #  app.services.copilot.sec_refresh — never in the API process.)
        # Free/public datasets (SEC FSDS, Form 4, 13F, FINRA, Treasury/FRED/BLS,
        # Fama-French, filing language metrics): schedule in public_data.service.
        try:
            from app.services.public_data.service import schedule as _schedule_public_data
            _schedule_public_data(sched)
        except Exception as e:
            print(f"⚠️ Public-data jobs not scheduled: {e}")

        sched.start()
        _scheduler = sched
        print("✅ APScheduler started — exchange universe + real-time ideas jobs scheduled")
    except ImportError:
        print("⚠️ APScheduler not installed — skipping batch jobs. Run: pip install APScheduler")
    except Exception as e:
        print(f"⚠️ Scheduler startup error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import os
    # asyncio's default executor is min(32, cpu+4) = 6 threads on the 2-vCPU host.
    # It runs every asyncio.to_thread / run_in_executor(None) (yfinance, forecast
    # fits, Public.com prev-close fills) AND the getaddrinfo DNS lookups behind
    # every httpx request. wait_for() timeouts do not free those threads, so six
    # slow yfinance calls stalled all outbound HTTP (monitor/commodities 55s+).
    from concurrent.futures import ThreadPoolExecutor
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(
            max_workers=int(os.environ.get("ASYNCIO_EXECUTOR_THREADS", "32")),
            thread_name_prefix="asyncio-default",
        )
    )

    # Initialize Redis connection for API caching
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    try:
        import redis.asyncio as aioredis
        # ElastiCache / NAT drop idle TCP connections silently; without
        # keepalive + health checks the next command on such a connection
        # failed (health showed redis "degraded" ~1 in 3 checks and cache
        # reads/writes failed the same way). Retry once on a dropped socket.
        from redis.asyncio.retry import Retry
        from redis.backoff import ExponentialBackoff
        from redis.exceptions import ConnectionError as _RedisConnErr, TimeoutError as _RedisTimeout

        redis_client = aioredis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            socket_keepalive=True,
            health_check_interval=30,
            retry=Retry(ExponentialBackoff(cap=1.0, base=0.05), 2),
            retry_on_error=[_RedisConnErr, _RedisTimeout],
        )
        await redis_client.ping()
        app.state.redis = redis_client
        # Initialize universal Redis cache service
        from app.services.redis_cache_service import cache_service
        cache_service.init_redis(redis_client)
        print(f"✅ Redis connected + cache service initialized: {redis_url.split('@')[-1] if '@' in redis_url else redis_url}")

        # RedisCacheMiddleware is registered at import time and reads app.state.redis.
    except Exception as e:
        app.state.redis = None
        print(f"⚠️ Redis cache disabled: {e}")

    # Run table creation in a thread so /health is available immediately
    t = threading.Thread(target=_create_db_tables, daemon=True)
    t.start()
    # Background jobs (APScheduler + forecast warm) write shared data and call
    # paid/rate-limited APIs: exactly one deployment should run them.
    # RUN_BACKGROUND_JOBS=0 (local dev default) turns them off.
    background_jobs = os.environ.get("RUN_BACKGROUND_JOBS", "1") != "0"
    if background_jobs:
        sched_t = threading.Thread(target=_start_scheduler, daemon=True)
        sched_t.start()
    else:
        print("⏸️  RUN_BACKGROUND_JOBS=0 — scheduler and forecast warm disabled")

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

    # Pre-compute statistical forecasts for popular tickers (runs on this loop,
    # where the async Redis client lives). FORECAST_WARM=0 disables it.
    # A bounded startup warm-up runs first and gates /health/ready (the Docker
    # healthcheck), so `docker compose up --wait` only swaps in a container
    # whose hottest forecasts are cached. WARMUP_TIMEOUT_S caps it so a
    # provider outage can never block a deploy.
    from app.services import warmup as _warmup
    forecast_warm_task = None
    if background_jobs and os.environ.get("FORECAST_WARM", "1") != "0" and "pytest" not in sys.modules:
        from app.api.forecast import forecast_warm_loop, warm_forecasts

        async def _warm_then_loop():
            await _warmup.run_startup_warmup(lambda tickers: warm_forecasts(tickers, pause=0.0))
            await forecast_warm_loop(initial_delay=30.0)

        forecast_warm_task = asyncio.create_task(_warm_then_loop())
    else:
        _warmup.mark_skipped("background jobs or FORECAST_WARM disabled")

    # News intelligence ingestion runs in the separate news-worker container
    # (python -m app.services.news_intel.worker) so the API never loads the
    # models. NEWS_INTEL_IN_API=1 runs it in-process instead (single-process dev
    # only; also needs NEWS_INTEL_MODELS=1 for FinBERT/MiniLM).
    news_intel_task = None
    if (background_jobs and os.environ.get("NEWS_INTEL_IN_API", "0") == "1"
            and "pytest" not in sys.modules):
        try:
            from app.services.news_intel.pipeline import start_news_intel
            news_intel_task = start_news_intel(redis=getattr(app.state, "redis", None))
        except Exception as e:
            print(f"⚠️ News intelligence pipeline not started: {e}")

    # Live system status (/api/v1/system/status): passive provider meter on
    # outbound HTTP + a background collector that probes each dependency on
    # its own cadence.  Never on the request path.  SYSTEM_STATUS_ENABLED=0
    # turns both off.
    status_collector = None
    from app.services import system_status as _system_status
    if _system_status.enabled() and "pytest" not in sys.modules:
        try:
            from app.services import provider_meter as _provider_meter
            from app.services.system_probes import build_collector

            _provider_meter.install()
            status_collector = build_collector(app=app, redis=getattr(app.state, "redis", None))
            # Admin console: persisted status history (30-day availability) + ops events.
            from app.services.admin_metrics import status_history_loop
            status_collector.add_task(status_history_loop)
            _system_status.set_collector(status_collector)
            status_collector.start()
        except Exception as e:
            print(f"⚠️ System status collector not started: {e}")

    yield
    if status_collector is not None:
        await status_collector.stop()
        _system_status.set_collector(None)
    if forecast_warm_task:
        forecast_warm_task.cancel()
    if news_intel_task:
        from app.services.news_intel.pipeline import get_service
        svc = get_service()
        if svc:
            await svc.stop()
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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions — never leak tracebacks to clients."""
    _db_logger.exception("Unhandled error %s %s: %s", request.method, request.url.path, type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
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


# ── Rate limiting middleware (per user / real client IP, in-memory) ──
# Keys on the real client behind Cloudflare/nginx (not the proxy's IP) and gives
# public cached market GETs their own generous bucket. See app/middleware/rate_limit.py.
from app.middleware.rate_limit import RateLimitMiddleware  # noqa: E402

app.add_middleware(RateLimitMiddleware, requests_per_minute=300)
app.add_middleware(CacheControlMiddleware)

# Redis GET-response cache. Registered here (not in lifespan) because Starlette
# rejects add_middleware after startup; it no-ops until lifespan sets app.state.redis.
# Added before CORS so CORS wraps it and cache HITs still get CORS headers.
from app.middleware.redis_cache import RedisCacheMiddleware  # noqa: E402
app.add_middleware(RedisCacheMiddleware)

# Admin console API metrics (latency / status ring buffer; in-process only).
from app.services.admin_metrics import RequestMetricsMiddleware  # noqa: E402
app.add_middleware(RequestMetricsMiddleware)

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
# news_intel first: its /news/feed|categories|health must win over /news/{symbol}
from app.api import news_intel as news_intel_api  # noqa: E402
app.include_router(news_intel_api.router, prefix="/api/v1", tags=["news-intel"])
app.include_router(news.router, prefix="/api/v1", tags=["news"])
app.include_router(filings.router, prefix="/api/v1", tags=["filings"])
app.include_router(risk.router, prefix="/api/v1", tags=["risk"])
app.include_router(watchlist.router, prefix="/api/v1", tags=["watchlist"])
app.include_router(backtest.router, prefix="/api/v1", tags=["backtest"])
app.include_router(backtest_v2.router, prefix="/api/v1", tags=["backtest"])
app.include_router(market.router, prefix="/api/v1", tags=["market"])
app.include_router(market_status.router, prefix="/api/v1", tags=["market-status"])
app.include_router(chat_history.router, prefix="/api/v1", tags=["chat-history"])
app.include_router(enhanced_endpoints.router, prefix="/api/v1/enhanced", tags=["enhanced"])
app.include_router(quotes.router, prefix="/api/v1", tags=["quotes"])
app.include_router(options.router, prefix="/api/v1", tags=["options"])
from app.api import outlook as outlook_api  # noqa: E402
app.include_router(outlook_api.router, prefix="/api/v1", tags=["outlook"])
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

# AI Copilot — /copilot/stream (SSE, tool-use + ticker context pack), usage, admin
app.include_router(copilot_api.router, prefix="/api/v1")

# AI usage guard — /me/ai-usage, /admin/llm-usage, /ai-usage/reserve (Next.js relays)
from app.api.ai_quota import router as ai_quota_router
app.include_router(ai_quota_router, prefix="/api/v1")

# WebSocket — Real-time market data push (ideas, pulse, scanner)
app.include_router(ws_api.router, prefix="/api/v1", tags=["websocket"])

# Community — Social forums, posts, comments, notifications
app.include_router(community.router, prefix="/api/v1", tags=["community"])
app.include_router(posts.router, prefix="/api/v1", tags=["posts"])
app.include_router(comments.router, prefix="/api/v1", tags=["comments"])
app.include_router(notifications.router, prefix="/api/v1", tags=["notifications"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])
# Community bots — automated, labelled data posts (methodology, admin switches)
app.include_router(community_bots_api.router, prefix="/api/v1", tags=["community-bots"])

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

# Messaging — Reddit-style direct messages
from app.api import messages as messages_api
app.include_router(messages_api.router, prefix="/api/v1", tags=["messages"])

# MLOps — model registry, experiments, monitoring, pipeline control
app.include_router(mlops.router, prefix="/api/v1", tags=["mlops"])

# Research — SEC EDGAR financials, company overview, filings, AI insights
app.include_router(research_api.router)

# Portfolios — holdings tracking + simulated paper trading (never routes real orders)
from app.api import portfolios as portfolios_api  # noqa: E402
app.include_router(portfolios_api.router, prefix="/api/v1")

# Price / indicator alerts — user-defined, evaluated by the user_price_alerts job
from app.api import alerts as alerts_api  # noqa: E402
app.include_router(alerts_api.router, prefix="/api/v1")

# Marketwatch — multiple named watchlists + computed Holdings list (read-only, no orders)
from app.api import marketwatch as marketwatch_api  # noqa: E402
app.include_router(marketwatch_api.router, prefix="/api/v1")

# Stock screener — fundamental + technical filters over a DB-built snapshot
from app.api import screener as screener_api  # noqa: E402
app.include_router(screener_api.router, prefix="/api/v1")

# Earnings calendar (Finnhub + Nasdaq, Redis-cached) and the Research "earnings in N days" badge
from app.api import earnings as earnings_api  # noqa: E402
app.include_router(earnings_api.router, prefix="/api/v1")

# Dividend calendar (Nasdaq) + projected dividend income for tracked portfolios (yfinance history)
from app.api import dividends as dividends_api  # noqa: E402
app.include_router(dividends_api.router, prefix="/api/v1")

# Async report jobs (DungBeetle pattern): Console-style statements + data reports
from app.api import reports as reports_api  # noqa: E402
app.include_router(reports_api.router, prefix="/api/v1")

# Agentic RAG Copilot — ingest trigger, status, health check (admin)

# ML Training Pipeline — internal operator API
from app.api import ml_runs
app.include_router(ml_runs.router, prefix="/api/v1", tags=["ml-pipeline"])
# Internal machine-to-machine endpoints (batch callbacks, Lambda callbacks — no user JWT)
app.include_router(ml_runs.internal_router, prefix="/api/v1", tags=["ml-internal"])

# ML Predictions — LSTM inference serving endpoint (used by Cloudflare Worker)
from app.api import predictions
app.include_router(predictions.router, prefix="/api/v1", tags=["predictions"])

# Statistical forecasting — ARIMA/ETS/Theta ensemble + calibrated GARCH bands
from app.api import forecast as forecast_api
app.include_router(forecast_api.router, prefix="/api/v1", tags=["forecast"])

# Free / public datasets: SEC FSDS (PIT fundamentals), Form 4, 13F, FINRA, Treasury/FRED/BLS/Fama-French
from app.api import public_data as public_data_api
app.include_router(public_data_api.router, prefix="/api/v1", tags=["public-datasets"])

# Live system status (every dependency, polled every second by the top-bar pill)
from app.api import system_status as system_status_api
app.include_router(system_status_api.router, prefix="/api/v1", tags=["system"])

# Admin console (every route enforces admin server-side; non-admins get 404)
from app.api import admin as admin_api
app.include_router(admin_api.router, prefix="/api/v1/admin", tags=["admin"])

# Static files — serve locally-uploaded community media (fallback when R2 is not configured)
import pathlib as _pathlib
_storage_root = _pathlib.Path(os.getenv("LOCAL_STORAGE_PATH", "./storage"))
_upload_dir = _storage_root / "community" / "uploads"
_upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=str(_storage_root)), name="static-uploads")

print("✅ FastAPI app fully loaded — all routers mounted, ready to serve requests")


@app.get("/")
async def root():
    return {
        "message": "AI Trading & Research Copilot API",
        "version": "0.1.0",
        "status": "running"
    }


@app.get("/health")
async def health():
    """Production health check — verifies API is up. DB/Redis are informational only.

    Always returns 200 if the API process is alive. Docker health checks
    only need to know the process is responsive — downstream dependency
    failures (DB, Redis) are reported but don't block container startup.
    """
    checks = {"api": "ok"}

    # Database check (informational)
    try:
        if SessionLocal is not None:
            db = SessionLocal()
            try:
                db.execute(text("SELECT 1"))
                checks["database"] = "ok"
            finally:
                db.close()
        else:
            checks["database"] = "not_configured"
    except Exception:
        checks["database"] = "degraded"

    # Redis check — use existing async connection from lifespan if available
    try:
        redis_client = getattr(app.state, "redis", None)
        if redis_client is not None:
            try:
                await redis_client.ping()
            except Exception:
                await asyncio.sleep(0.05)
                await redis_client.ping()  # one retry: a pooled socket may have been dropped
            checks["redis"] = "ok"
        else:
            checks["redis"] = "not_configured"
    except Exception:
        checks["redis"] = "degraded"

    # Email provider keys (cached 15 min). A rejected key silently breaks signup
    # OTP, password reset and login alerts, so surface it here.
    try:
        from app.services.email_service import email_provider_status

        email_state = await asyncio.to_thread(email_provider_status)
        if email_state != "not_configured":
            checks["email"] = email_state
    except Exception:
        checks["email"] = "degraded"

    status = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    from app.services import warmup as _warmup
    # Always 200 — the API is alive. Degraded dependencies don't block startup.
    # `warm` is informational here; /health/ready is the readiness gate.
    return JSONResponse(
        content={"status": status, "checks": checks, "warm": _warmup.status(),
                 "version": os.environ.get("GIT_SHA", "unknown")},
        status_code=200,
    )


@app.get("/health/ready")
async def health_ready():
    """Readiness for the Docker healthcheck: 503 while the bounded startup
    warm-up runs, 200 once it finished, timed out, failed or was skipped."""
    from app.services import warmup as _warmup
    body = {"ready": _warmup.is_ready(), "warm": _warmup.status(),
            "version": os.environ.get("GIT_SHA", "unknown")}
    return JSONResponse(content=body, status_code=200 if body["ready"] else 503)
