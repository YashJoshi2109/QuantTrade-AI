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
    
    # API Keys
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    ALPHA_VANTAGE_API_KEY: Optional[str] = None
    BYTEZ_API_KEY: Optional[str] = None
    FINNHUB_API_KEY: Optional[str] = None
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    
    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    
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
            raise ValueError(
                "DATABASE_URL or NEON_DATABASE_URL environment variable must be set. "
                "Get your Neon connection string from https://console.neon.tech"
            )

        self.DATABASE_URL = db_url
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
