"""Seed the LOCAL dev database with a small, read-only slice of production market data.

Copies only market/reference tables (symbols, fundamentals, SEC data, quotes, and
~1 year of daily bars for a handful of tickers). It never copies users, auth,
billing, messages, portfolios or any other personal data.

Safety:
  * the source connection is opened with default_transaction_read_only=on, so the
    script cannot write to production even by mistake;
  * the target must be a local host (localhost / 127.0.0.1 / postgres).

Usage (from backend/):
    docker compose -f ../docker-compose.dev.yml up -d postgres
    SOURCE_DATABASE_URL='postgresql://...prod...' \
    TARGET_DATABASE_URL='postgresql://postgres:postgres@localhost:5433/quanttrade' \
    python scripts/seed_local_db.py [--tickers AAPL,MSFT,...] [--days 400]
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import MetaData, create_engine, inspect, select, text

DEFAULT_TICKERS = (
    "SPY,QQQ,IWM,DIA,AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,AVGO,NFLX,"
    "JPM,BAC,V,MA,BRK.B,LLY,UNH,XOM,CVX,COST,WMT,KO,PLTR,SOFI,COIN,INTC"
)

# Market/reference data only, in foreign-key order. Personal data is never copied.
FULL_TABLES = ("symbols", "symbols_master", "exchange_ranked_symbols", "market_indices")
PER_SYMBOL_TABLES = ("fundamentals", "company_edgar", "financial_statements", "realtime_quotes")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db", "host.docker.internal"}
BATCH = 2000


def _psycopg(url: str) -> str:
    return url.replace("postgresql://", "postgresql+psycopg://", 1) if url.startswith("postgresql://") else url


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _copy(src_conn, dst_conn, src_table, dst_table, where=None) -> int:
    cols = [c.name for c in dst_table.columns if c.name in src_table.columns]
    stmt = select(*[src_table.c[c] for c in cols])
    if where is not None:
        stmt = stmt.where(where)
    result = src_conn.execution_options(stream_results=True).execute(stmt)
    n = 0
    while True:
        rows = result.fetchmany(BATCH)
        if not rows:
            break
        dst_conn.execute(dst_table.insert(), [dict(zip(cols, r)) for r in rows])
        n += len(rows)
    return n


def _reset_sequences(dst_conn, tables) -> None:
    for t in tables:
        if "id" in t.columns and t.c.id.autoincrement:
            dst_conn.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{t.name}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {t.name}), 1))"
            ))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tickers", default=DEFAULT_TICKERS, help="comma-separated tickers for per-symbol data and price bars")
    ap.add_argument("--days", type=int, default=400, help="days of daily price bars to copy")
    args = ap.parse_args()

    src_url = os.environ.get("SOURCE_DATABASE_URL")
    dst_url = os.environ.get("TARGET_DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/quanttrade")
    if not src_url:
        print("SOURCE_DATABASE_URL is required (the production URL; it is opened read-only).", file=sys.stderr)
        return 2
    if _host(dst_url) not in LOCAL_HOSTS:
        print(f"Refusing: target host {_host(dst_url)!r} is not local.", file=sys.stderr)
        return 2
    if _host(src_url) == _host(dst_url) and urlsplit(src_url).port == urlsplit(dst_url).port:
        print("Refusing: source and target are the same database.", file=sys.stderr)
        return 2

    # Create the local schema from the app's models (the same way the app does on startup).
    os.environ["DATABASE_URL"] = dst_url
    os.environ.setdefault("APP_ENV", "development")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import app.models  # noqa: F401  (registers every model on Base.metadata)
    from app.db.database import Base

    src = create_engine(_psycopg(src_url), connect_args={"options": "-c default_transaction_read_only=on"})
    dst = create_engine(_psycopg(dst_url))
    with dst.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(dst)

    src_meta = MetaData()
    wanted = list(FULL_TABLES) + list(PER_SYMBOL_TABLES) + ["price_bars"]
    existing = set(inspect(src).get_table_names())
    src_meta.reflect(src, only=[t for t in wanted if t in existing])
    dst_tables = Base.metadata.tables
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    since = datetime.now(timezone.utc) - timedelta(days=args.days)

    with src.connect() as s, dst.begin() as d:
        # Wipe only the tables we seed (children first), so re-running is idempotent.
        for name in ("price_bars", *reversed(PER_SYMBOL_TABLES), *reversed(FULL_TABLES)):
            if name in dst_tables:
                d.execute(text(f"TRUNCATE {name} CASCADE"))

        for name in FULL_TABLES:
            if name in src_meta.tables and name in dst_tables:
                print(f"  {name:<26} {_copy(s, d, src_meta.tables[name], dst_tables[name]):>8} rows")

        sym = src_meta.tables["symbols"]
        ids = [r[0] for r in s.execute(select(sym.c.id).where(sym.c.symbol.in_(tickers)))]
        missing = sorted(set(tickers) - {r[0] for r in s.execute(select(sym.c.symbol).where(sym.c.id.in_(ids)))})
        for name in PER_SYMBOL_TABLES:
            if name in src_meta.tables and name in dst_tables:
                t = src_meta.tables[name]
                print(f"  {name:<26} {_copy(s, d, t, dst_tables[name], t.c.symbol_id.in_(ids)):>8} rows")

        if "price_bars" in src_meta.tables:
            pb = src_meta.tables["price_bars"]
            n = _copy(s, d, pb, dst_tables["price_bars"], (pb.c.symbol_id.in_(ids)) & (pb.c.timestamp >= since))
            print(f"  {'price_bars':<26} {n:>8} rows ({len(ids)} tickers, {args.days} days)")

        _reset_sequences(d, [dst_tables[n] for n in (*FULL_TABLES, *PER_SYMBOL_TABLES, "price_bars") if n in dst_tables])

    if missing:
        print(f"Not in source symbols table: {', '.join(missing)}")
    print("Local database seeded. Everything else (users, posts, portfolios) starts empty.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
