# Local development

Local development runs against its **own** Postgres and Redis in Docker. It never
touches the production database: a local backend pointed at prod holds prod
connections, writes prod rows, and runs the production background jobs twice
(on 2026-11-25 two local servers took prod RDS from ~3 to 45 connections and
tripped the `FreeableMemory` alarm).

There is no "migrate local to cloud" step. The schema lives in code (the app
creates its tables on startup), and production fills its own data from the
market-data providers. Deploys stay exactly as they are: push to `main`.

## Start

```bash
cp backend/.env.local.example backend/.env.local     # once; add any API keys you need
docker compose -f docker-compose.dev.yml up -d       # postgres:5433, redis:6380, backend:8000 (hot reload)
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Prefer running the backend on the host?

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
cd backend && set -a && . ./.env.local && set +a && uvicorn app.main:app --reload
```

## Seed real market data (optional)

Copies a small read-only slice of prod: symbols, fundamentals, SEC data, quotes,
and ~400 days of daily bars for 30 popular tickers. Users, posts, portfolios and
other personal data are **never** copied. The prod connection is opened with
`default_transaction_read_only=on`.

```bash
cd backend
SOURCE_DATABASE_URL='<prod url>' python scripts/seed_local_db.py
# custom: --tickers AAPL,NVDA,JPM --days 200
```

## Guard rails

| Setting | Local | Production |
|---|---|---|
| `APP_ENV` | `development` → backend refuses a non-local `DATABASE_URL` (override: `ALLOW_REMOTE_DB=1`) | unset |
| `RUN_BACKGROUND_JOBS` | `0` → no APScheduler jobs, no forecast warm | `1` (default) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `2` / `3` | `10` / `30` |

## Reset

```bash
docker compose -f docker-compose.dev.yml down -v   # wipes local data; re-seed afterwards
```
