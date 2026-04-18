"""
Application configuration
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

# Always load backend/.env (not cwd) so `uvicorn` from repo root still picks up keys
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_BACKEND_ENV_FILE = _BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # Database (use postgresql+psycopg:// for psycopg3)
    # Priority: DATABASE_URL (from environment) > NEON_DATABASE_URL
    DATABASE_URL: Optional[str] = None
    NEON_DATABASE_URL: Optional[str] = None
    
    # JWT Auth (should be set via environment variable in production)
    # Default secret key (override with SECRET_KEY env var for production)
    SECRET_KEY: str = os.getenv("SECRET_KEY", "7730eae563847420772c890ecb062bb7")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    ALLOWED_ORIGINS: str = ""
    
    # API Keys
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    FAL_API_KEY: Optional[str] = None   # fal.ai image generation
    ELEVENLABS_API_KEY: Optional[str] = None
    ELEVENLABS_MODEL_ID: str = "eleven_multilingual_v2"
    ELEVENLABS_VOICE_NARRATOR: Optional[str] = None
    ELEVENLABS_VOICE_KNIGHT: Optional[str] = None
    ELEVENLABS_VOICE_SCHOLAR: Optional[str] = None
    ELEVENLABS_VOICE_MERCHANT: Optional[str] = None
    ELEVENLABS_VOICE_NOBLE: Optional[str] = None
    ELEVENLABS_VOICE_SAGE: Optional[str] = None
    GROK_API_KEY: Optional[str] = None  # xAI Grok LLM (OpenAI-compatible API)
    ALPHA_VANTAGE_API_KEY: Optional[str] = None
    BYTEZ_API_KEY: Optional[str] = None
    FINNHUB_API_KEY: Optional[str] = None
    SEC_API_KEY: Optional[str] = None  # sec-api.io for SEC filings
    NEWSAPI_KEY: Optional[str] = None  # NewsAPI.org for real-time news
    TWELVEDATA_API_KEY: Optional[str] = None  # Twelve Data for real-time quotes (800 credits/day free)
    FMP_API_KEY: Optional[str] = None         # Financial Modeling Prep — 250 calls/day
    EODHD_API_KEY: Optional[str] = None       # EOD Historical Data — exchange info + EOD quotes
    APILAYER_CURRENCY_KEY: Optional[str] = None  # ApiLayer currency exchange rates
    MARKETSTACK_API_KEY: Optional[str] = None    # Marketstack global stock data
    OPENFIGI_API_KEY: Optional[str] = None       # OpenFIGI real-time stock info

    # Alpaca Markets — free historical data for backtesting + candlesticks
    ALPACA_API_KEY: Optional[str] = None
    ALPACA_SECRET_KEY: Optional[str] = None
    ALPACA_BASE_URL: str = "https://paper-api.alpaca.markets"  # paper trading default

    # Robinhood — US stock quotes fallback (requires account credentials)
    ROBINHOOD_USERNAME: Optional[str] = None
    ROBINHOOD_PASSWORD: Optional[str] = None
    ROBINHOOD_MFA_CODE: Optional[str] = None  # Optional: TOTP or SMS code

    # Public.com — real-time quotes, option chains, batch pricing
    PUBLIC_API_SECRET_KEY: Optional[str] = None
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_PUBLISHABLE_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_CONNECT_THIN_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID: Optional[str] = None
    
    # Global Monitor API Keys
    GROQ_API_KEY: Optional[str] = None  # Groq LLM for threat classification
    OPENROUTER_API_KEY: Optional[str] = None # AI fallback
    ACLED_API_KEY: Optional[str] = None  # Legacy API Key
    ACLED_EMAIL: Optional[str] = None    # ACLED OAuth Email
    ACLED_PASSWORD: Optional[str] = None # ACLED OAuth Password
    UPSTASH_REDIS_URL: Optional[str] = None  # Upstash Redis for deduplication
    UPSTASH_REDIS_TOKEN: Optional[str] = None
    FRED_API_KEY: Optional[str] = None  # Federal Reserve Economic Data
    EIA_API_KEY: Optional[str] = None   # US Energy Information Administration
    USGS_API_KEY: Optional[str] = None  # USGS Earthquake data (optional, public API)
    NASA_API_KEY: Optional[str] = None  # Generic NASA Key
    NASA_FIRMS_API_KEY: Optional[str] = None # NASA FIRMS Specific
    CLOUDFLARE_RADAR_TOKEN: Optional[str] = None # Internet outages
    TURNSTILE_SECRET_KEY: Optional[str] = None  # Cloudflare Turnstile CAPTCHA secret
    GUARDIAN_API_KEY: Optional[str] = None  # The Guardian Open Platform (free "test" key works)
    OPENSKY_USERNAME: Optional[str] = None
    OPENSKY_PASSWORD: Optional[str] = None
    AVIATIONSTACK_API_KEY: Optional[str] = None
    AISSTREAM_API_KEY: Optional[str] = None   # AIS Stream API Key
    
    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None

    # Google Analytics 4 Real-Time (service account)
    GA4_PROPERTY_ID: Optional[str] = None  # e.g. "properties/123456789"
    GA4_CREDENTIALS_JSON: Optional[str] = None  # path to service-account JSON or inline JSON

    # Live visitors (navbar): prefer GA4, or Cloudflare when GA is blocked / unavailable
    # auto = GA4 if configured, else Cloudflare Worker URL, else Cloudflare GraphQL zone stats
    LIVE_VISITORS_SOURCE: str = "auto"  # auto | ga4 | cloudflare_graphql | cloudflare_worker
    CLOUDFLARE_ZONE_TAG: Optional[str] = None  # Zone ID (hex) from Cloudflare dashboard — GraphQL filter zoneTag
    CLOUDFLARE_ANALYTICS_TOKEN: Optional[str] = None  # API token: Zone.Analytics Read (or Account analytics)
    CLOUDFLARE_LIVE_VISITORS_URL: Optional[str] = None  # e.g. https://live-count.your-account.workers.dev (JSON {"count": n})
    CLOUDFLARE_LIVE_VISITORS_SECRET: Optional[str] = None  # Optional Authorization: Bearer … for Worker

    # WebAuthn / Passkey (production: set WEBAUTHN_RP_ID + WEBAUTHN_ORIGINS to your real hostname(s))
    WEBAUTHN_RP_ID: str = os.getenv("WEBAUTHN_RP_ID", "localhost")
    # Single origin (dev); production should set WEBAUTHN_ORIGINS instead or in addition
    WEBAUTHN_ORIGIN: str = os.getenv("WEBAUTHN_ORIGIN", "http://localhost:3000")
    # Comma-separated allowed origins for verify_registration_response / verify_authentication_response
    WEBAUTHN_ORIGINS: str = os.getenv("WEBAUTHN_ORIGINS", "")

    # Email — Brevo (https://www.brevo.com) + optional Resend fallback (https://resend.com)
    BREVO_API_KEY: Optional[str] = None
    BREVO_FROM_EMAIL: str = "QuantTrade AI <noreply@quanttrade.us>"
    RESEND_API_KEY: Optional[str] = None
    RESEND_FROM_EMAIL: Optional[str] = None  # e.g. QuantTrade AI <notify@yourdomain.com>
    
    # Neon Auth
    NEON_AUTH_URL: Optional[str] = None
    NEON_AUTH_JWKS_URL: Optional[str] = None
    NEON_AUTH_AUDIENCE: Optional[str] = None
    
    # Data sources
    DEFAULT_SYMBOLS: str = "AAPL,MSFT,GOOGL,AMZN,TSLA,META,NVDA,JPM,V,JNJ"

    # Billing / Pricing
    APP_URL: str = os.getenv("APP_URL", "https://quanttrade.us")
    # Optional HTTPS URL for Stripe Customer Portal return (e.g. https://www.quanttrade.us/settings).
    # Use when APP_URL is http://localhost but Stripe (live) rejects non-HTTPS return_url.
    BILLING_PORTAL_RETURN_URL: Optional[str] = None
    STRIPE_PRICE_PLUS_MONTHLY: Optional[str] = None
    STRIPE_PRICE_PLUS_YEARLY: Optional[str] = None
    # Optional: Dashboard → Settings → Billing → Customer portal → copy Configuration ID (bpc_...)
    # Required if the default portal was never saved / activated for this Stripe account.
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: Optional[str] = None
    # Welcome email + Checkout: customer-facing promotion code (not the promo_ API id)
    STRIPE_WELCOME_PROMO_CUSTOMER_CODE: str = os.getenv(
        "STRIPE_WELCOME_PROMO_CUSTOMER_CODE", "QUANTTRADE"
    )
    STRIPE_WELCOME_PROMO_AMOUNT_LABEL: str = os.getenv(
        "STRIPE_WELCOME_PROMO_AMOUNT_LABEL", "$15"
    )
    
    # Vector DB
    VECTOR_STORE_BACKEND: str = "pgvector"  # or "qdrant"
    QDRANT_URL: str = "http://localhost:6333"
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    
    # Celery/Redis
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"
    REDIS_URL: str = "redis://localhost:6379"  # For general caching
    
    # Object Storage
    S3_ENDPOINT: Optional[str] = None
    S3_ACCESS_KEY: Optional[str] = None
    S3_SECRET_KEY: Optional[str] = None
    S3_BUCKET: Optional[str] = None
    USE_LOCAL_STORAGE: bool = True
    LOCAL_STORAGE_PATH: str = "./storage"
    
    # App settings
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"
    # DEBUG only: if Brevo fails, log OTP to server logs and treat send as OK (local dev)
    EMAIL_DEV_LOG_OTP: bool = False

    def __init__(self, **values):
        super().__init__(**values)
        db_url = self.DATABASE_URL or self.NEON_DATABASE_URL or ""

        if db_url and not db_url.startswith("postgresql+psycopg://"):
            if db_url.startswith("postgresql://"):
                db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

        if not db_url:
            # Don't crash at startup - allow /health to respond for container probes.
            # DB-dependent routes will fail with a clear error when first used.
            print("⚠️ WARNING: DATABASE_URL/NEON_DATABASE_URL not set - DB features will fail. Set in .env on EC2.")

        self.DATABASE_URL = db_url or ""


settings = Settings()
