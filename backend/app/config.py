"""
Application configuration
"""
import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Database (use postgresql+psycopg:// for psycopg3)
    # Priority: DATABASE_URL (from environment) > RENDER_DATABASE_URL > NETLIFY_DATABASE_URL > default
    # Note: Convert postgresql:// to postgresql+psycopg:// if needed for psycopg3
    _db_url = (
        os.getenv("DATABASE_URL", "") or 
        os.getenv("RENDER_DATABASE_URL", "") or 
        os.getenv("NETLIFY_DATABASE_URL", "")
    )
    
    if _db_url and not _db_url.startswith("postgresql+psycopg://"):
        # Convert postgresql:// to postgresql+psycopg:// for psycopg3
        if _db_url.startswith("postgresql://"):
            _db_url = _db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    
    # Default: Render database (external for local, internal for Render deployment)
    if not _db_url:
        # Use external URL for local development
        _db_url = "postgresql+psycopg://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5"
    
    DATABASE_URL: str = _db_url
    
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
    
    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    
    # Data sources
    DEFAULT_SYMBOLS: str = "AAPL,MSFT,GOOGL,AMZN,TSLA,META,NVDA,JPM,V,JNJ"
    
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
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
