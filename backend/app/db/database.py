"""
Database connection and session management
"""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

# Lazily create engine only when DATABASE_URL is set (allows /health to work without DB)
engine = None
SessionLocal = None

if settings.DATABASE_URL:
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://") and "+psycopg" not in database_url:
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    import os
    from urllib.parse import urlsplit

    # Local development must never talk to a shared/prod database: a local run
    # would hold prod connections and write prod rows. APP_ENV=development
    # (set by docker-compose.dev.yml and backend/.env.local.example) enforces it.
    _LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db", "host.docker.internal"}
    _db_host = (urlsplit(database_url).hostname or "").lower()
    if (
        os.environ.get("APP_ENV", "").lower() in {"development", "dev", "local"}
        and _db_host not in _LOCAL_DB_HOSTS
        and os.environ.get("ALLOW_REMOTE_DB") != "1"
    ):
        raise RuntimeError(
            f"APP_ENV=development but DATABASE_URL points at remote host {_db_host!r}. "
            "Use the local Postgres from docker-compose.dev.yml (see docs/LOCAL_DEV.md), "
            "or set ALLOW_REMOTE_DB=1 if you really mean it."
        )

    _connect_args = {}
    # Server-side cap per statement (ms; 0 disables). One runaway query must not
    # pin a pooled connection for minutes while every other request queues.
    _stmt_timeout_ms = int(os.environ.get("DB_STATEMENT_TIMEOUT_MS", "60000") or 0)
    # PgBouncer-style poolers (Neon "-pooler" hosts) reject the `options` startup parameter.
    if _stmt_timeout_ms > 0 and database_url.startswith("postgresql") and "pooler" not in database_url:
        _connect_args["options"] = f"-c statement_timeout={_stmt_timeout_ms}"
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        # 10 + 30 = 40 = anyio's default threadpool size: every sync handler
        # thread can hold a session without starving the others.
        pool_size=int(os.environ.get("DB_POOL_SIZE", "10")),
        max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "30")),
        pool_recycle=1800,  # Recycle connections after 30min (PostgreSQL idle timeout)
        # Fail fast when the pool is exhausted instead of stacking 30s waits.
        pool_timeout=int(os.environ.get("DB_POOL_TIMEOUT", "10")),
        connect_args=_connect_args,
        echo=settings.DEBUG,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency for getting database session"""
    if SessionLocal is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database not configured (DATABASE_URL missing)")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
