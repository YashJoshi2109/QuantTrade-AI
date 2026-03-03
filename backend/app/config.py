"""
Application configuration
"""
import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
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
    ALPHA_VANTAGE_API_KEY: Optional[str] = None
    BYTEZ_API_KEY: Optional[str] = None
    FINNHUB_API_KEY: Optional[str] = None
    SEC_API_KEY: Optional[str] = None  # sec-api.io for SEC filings
    NEWSAPI_KEY: Optional[str] = None  # NewsAPI.org for real-time news
    TWELVEDATA_API_KEY: Optional[str] = None  # Twelve Data for real-time quotes (800 credits/day free)
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    
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
    OPENSKY_USERNAME: Optional[str] = None
    OPENSKY_PASSWORD: Optional[str] = None
    AVIATIONSTACK_API_KEY: Optional[str] = None
    AISSTREAM_API_KEY: Optional[str] = None   # AIS Stream API Key
    
    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None

    # Email OTP (Resend - https://resend.com)
    RESEND_API_KEY: Optional[str] = None
    RESEND_FROM_EMAIL: str = "QuantTrade <onboarding@resend.dev>"  # Replace with verified domain
    
    # Neon Auth
    NEON_AUTH_URL: Optional[str] = None
    NEON_AUTH_JWKS_URL: Optional[str] = None
    NEON_AUTH_AUDIENCE: Optional[str] = None
    
    # Data sources
    DEFAULT_SYMBOLS: str = "AAPL,MSFT,GOOGL,AMZN,TSLA,META,NVDA,JPM,V,JNJ"

    # Billing / Pricing
    APP_URL: str = os.getenv("APP_URL", "https://quanttrade.us")
    STRIPE_PRICE_PLUS_MONTHLY: Optional[str] = None
    STRIPE_PRICE_PLUS_YEARLY: Optional[str] = None
    
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
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Ignore frontend-only vars (e.g. NEXT_PUBLIC_*) when loading .env


settings = Settings()
