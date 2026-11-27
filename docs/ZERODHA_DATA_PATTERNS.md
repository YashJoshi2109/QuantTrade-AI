# Zerodha data patterns, and what QuantTrade takes from them

Researched 2026-11-27. Facts are from Zerodha's own posts and repositories unless
marked "secondary". QuantTrade facts are from this repo (`backend/app/models`,
`backend/app/services`, `.github/workflows/deploy.yml`).

## 1. What Zerodha does

### 1.1 PostgreSQL as the system of record (Console)

Source: [Working with PostgreSQL](https://zerodha.tech/blog/working-with-postgresql/) (zerodha.tech, Apr 2021).

- Scale: about 20 TB across four sharded nodes, with hundreds of billions of rows.
  The largest warehouse DB takes tens of millions of new rows a day and serves up to
  40-50k queries per second at peak. Self-hosted on EC2.
- Write pattern: about 99% of writes happen in a nightly end-of-day (EOD) batch.
  Daily bulk inserts land in a temporary table first and are synced into the main
  table asynchronously.
- Schema: mostly denormalized (parent data copied into child tables to avoid JOINs).
  Materialized views cover data that is joined often. Foreign keys were dropped to
  speed up bulk imports. No auto-increment ids.
- Partitioning: most tables are partitioned by month. Daily partitions made inserts
  faster but date-range queries slower, so they went with monthly partitions.
- Sharding: since early 2020 they shard with `postgres_fdw` (they chose it over Citus,
  which needed a reference id column on every table and query rewrites). Old
  partitions move to smaller shards, and they move again every financial year.
- Tuning: `work_mem` about 600 MB, `shared_buffers` under about 1/3 of RAM,
  `max_parallel_workers` equal to the core count. Autovacuum is off on the heavily
  updated DBs; a cron `VACUUM ANALYZE` runs in the EOD job. They keep indexes few and
  targeted (partial and composite), and watch `pg_stat_statements`.
- Report caching: a separate Postgres instance is a hot cache, fed by their job queue
  (sql-jobber, now DungBeetle). Each query result goes to its own table. That cache DB
  runs with `fsync` and WAL off, no replication, and very low `work_mem`. It is
  dropped and rebuilt nightly. They considered Redis for this and rejected it:
  filtering and sorting across dozens of report types would be complex and need
  ever-growing RAM.

### 1.2 DungBeetle: async read-only SQL jobs

Sources: [github.com/zerodha/dungbeetle](https://github.com/zerodha/dungbeetle);
Kailash Nadh's [IndiaFOSS 2024 talk](https://nadh.in/files/indiafoss-2024-dungbeetle.pdf)
("a single node Postgres with more than 7 million ephemeral tables as a cache").

- A single-binary job server that queues and runs large numbers of read-only SQL
  jobs (reports, statements). Source DBs: PostgreSQL, MySQL, ClickHouse. Result DBs:
  PostgreSQL, MySQL.
- Tasks are named queries in `.sql` files (goyesql format: `-- name:`, plus optional
  `-- db:`, `-- queue:`, `-- results:` tags). Clients post a task name and positional
  args, never SQL.
- HTTP API: `GET /tasks`, `POST /tasks/{task}/jobs`, `GET /jobs/{id}`,
  `DELETE /jobs/{id}`, job groups, Prometheus `/metrics`.
- Queues route jobs to worker pools with their own concurrency, so heavy reports
  cannot starve light ones. Workers coordinate through a broker (Redis or AMQP).
- Each job's result set is written to a new table in the results DB, with a schema
  generated from the result columns. `job_id` can be supplied, and only one job with
  a given id runs at a time. A running query can be cancelled on PostgreSQL only.
- It does not handle transactional writes (read jobs only).

### 1.3 Blobasaur: the new storage engine (Nov 2026)

Sources: [Distributed, high-performance blob storage on SQLite](https://zerodha.tech/blog/high-performance-distributed-blob-storage/)
(zerodha.tech) and the [Z-Connect announcement](https://zerodha.com/z-connect/updates/blobasaur-an-open-source-storage-engine-built-at-zerodha).

- Why: UI and workspace preferences for millions of users, which grew after the Kite
  Terminal mode launch. These are blobs (p99 935 KiB before compression), not rows.
  It replaced SSDB (single node, unmaintained, effectively capped at 1 MB values).
- What: an AGPLv3 Rust server that speaks the Redis protocol and stores data in
  SQLite files. It is in production at Zerodha.
- Sharding: cluster level uses 16,384 CRC16 hash slots per node range, with gossip
  and `MOVED` redirects (static assignment, no live rebalancing or automatic
  failover yet). Node level uses multi-probe consistent hashing across several
  SQLite shard files (4 to 5 shards moves about 20% of keys). Resharding is offline.
- Write path: SQLite WAL allows one writer per file, so each shard has one writer
  task fed by a bounded queue that group-commits batches in one
  `BEGIN IMMEDIATE ... COMMIT`. Reads use a pool of read-only connections.
  `synchronous=NORMAL`; optional async writes with an in-memory pending map.
- Expiry: an `expires_at` column with a partial index. Reads filter expired rows, and
  a background worker deletes them in chunks of 1,000 to avoid latency spikes.
- Compression: zstd in production, about 11x on average payloads.
- Numbers they report: 3 nodes of 4 vCPU / 8 GB; p99 about 2 ms and p50 250-550 us
  across a trading session.
- Rollout: new workloads first, then a month of dual writes to SSDB and Blobasaur
  (reads preferring Blobasaur) with zero discrepancies before turning SSDB off.

### 1.4 The common thread

1. Keep the primary database boring and doing one job well. Push heavy reads to a
   separate, disposable store.
2. Precompute or materialize what is read often (materialized views, nightly
   rebuilds, per-job result tables).
3. Partition time-series data by the range people query (monthly, not daily).
4. Bounded queues and dedicated workers instead of unbounded concurrency.
5. Expiry is a column plus a chunked background sweep, not a big delete.
6. Migrate by dual-writing and comparing before cutting over.

## 2. QuantTrade today

| Area | Current state |
|---|---|
| Primary DB | One PostgreSQL (AWS RDS) behind one uvicorn worker in a 768 MB container. SQLAlchemy pool 10 + 30 overflow, `statement_timeout` 60 s per connection (`app/db/database.py`). |
| `price_bars` | One table, integer id, unique `(symbol_id, timestamp)` (`scripts/add_price_bars_unique_index.py`). Not partitioned. Read by research charts, screener build, backtests, forecasting and ML data collection. |
| `quote_snapshots` | One row per symbol holding the latest provider payload, TTL 60 s / 300 s / 600 s by session (`app/models/quote_snapshot.py`). It is a cache, not history. |
| `quote_history` | Model exists (`app/models/realtime_quote.py`) but nothing in `app/services` writes to it. |
| Redis | Cache-aside through `RedisCacheService` (with an in-memory fallback), pub/sub for WebSocket fan-out, and durable backtest job snapshots. |
| Heavy jobs | Backtests already run as in-process background jobs with a per-user limit, time budget and Redis snapshots (`app/services/backtesting/jobs.py`). The screener reads a rebuilt `screener_snapshots` table. Both are DungBeetle-like already. |
| Statements | Portfolio CSV export runs inline in the request (`/portfolios/{id}/export`). There is no date-ranged tradebook, realized P&L or dividend statement. |
| Migrations | Idempotent Python scripts in `backend/scripts`, run by `deploy.yml` after the containers are healthy. `Base.metadata.create_all` also runs at startup. |

## 3. Fit assessment

| Zerodha pattern | Fit for QuantTrade now | Decision |
|---|---|---|
| DungBeetle-style async report jobs with a results store | High. Statements and data-quality reports are exactly the heavy, read-only, cacheable queries it is built for, and they must not hold request threads on a 1-worker container. | **Built (section 4.1).** |
| Request coalescing on the read cache | High. Hot quote and batch keys expire together, and every concurrent miss called the provider (cache stampede). Blobasaur's single writer per shard and DungBeetle's one-job-per-id are the same idea. | **Built (section 4.2).** |
| Monthly range partitioning of `price_bars` | Medium later, low now. The prod row count was not measured for this doc (we do not query prod from dev). As an upper estimate, 5,000 symbols x 10 years x 252 daily bars is about 12.6M rows, which one btree on `(symbol_id, timestamp)` serves well; every hot query filters by symbol first. Converting a live table to a partitioned one needs a new table, a copy and a swap, and the unique index must include the partition key (it already does). Risk is higher than the gain today. | Deferred. Plan in section 5.1. |
| Partitioned tick history (`quote_history`) | Only if intraday history becomes a product feature. Nothing writes it today. | Deferred. If built, create it partitioned by month from day one (no conversion needed). |
| Materialized views for hot joins | Already done in spirit (`screener_snapshots`, `model_index` snapshots). | Keep. |
| Separate cache DB with `fsync` off | Not worth a second database at our size. A results table in the same DB with TTL and a chunked sweep gives the isolation we need. | Not adopted. Revisit if `report_results` grows beyond a few GB. |
| `postgres_fdw` sharding | Far beyond our size. | Not adopted. |
| Autovacuum off + nightly VACUUM | Our writes are not EOD-batched (quotes and caches update all day), so autovacuum must stay on. | Not adopted. |
| Blobasaur for UI preferences | Our preferences are a small JSON column on `users`. Blobasaur solves blob size and write rate we do not have. | Not adopted. The dual-write rollout method is the lesson to reuse. |

## 4. What was implemented

### 4.1 Async report jobs (DungBeetle pattern)

Code: `backend/app/services/reports/` (`registry.py`, `runner.py`, `tasks/*.sql`),
`backend/app/api/reports.py`, `backend/app/models/report_job.py`.

- **Tasks are SQL files**, goyesql style, so a report is reviewed as SQL:

  ```sql
  -- name: tradebook
  -- scope: user
  -- ttl: 300
  -- args: from_date:date=2000-01-01, to_date:date_end=today
  SELECT ... WHERE p.user_id = :user_id AND t.transaction_date >= :from_date ...
  ```

  The loader rejects anything that is not a single `SELECT`/`WITH` statement, a user
  task that does not filter by `:user_id`, and any client argument named `user_id`.
- **Shipped tasks**: `tradebook`, `realized_pnl_by_symbol`, `dividend_income`
  (user scope; Console-style statements) and `price_bar_coverage` (public scope;
  bars per symbol, which shows what history forecasts and backtests can use).
  Every figure comes straight from stored rows. Amounts stay in each portfolio's
  currency (the `currency` column; no FX). Dates are UTC days, and `to_date` is
  inclusive. `realized_pnl_by_symbol` reports `sells_missing_pnl` so an incomplete
  total is visible instead of silently low.
- **Deterministic job ids**: `sha256(task, owner, canonical args)`. A fresh finished
  result is returned at once (`cached: true`). A queued or running job with the same id
  is shared. A public task has one result for all users. `today` resolves to the
  date, so yesterday's cache is never served for today.
- **Isolation**: a thread pool (`REPORT_JOB_WORKERS`, default 1), at most 3 active jobs
  per user and 16 in the queue. On PostgreSQL each job runs in a `READ ONLY`
  transaction with `SET LOCAL statement_timeout` (`REPORT_STATEMENT_TIMEOUT_MS`,
  default 20000). At most 50,000 rows are kept, and `truncated` says when there were
  more.
- **Results store**: `report_results` holds one row per job (status, columns, rows as
  JSON, timings, `expires_at`). We use one table instead of DungBeetle's table per job:
  at our volume it is simpler, needs no DDL at run time, and still keeps result reads
  off the source tables. Expired rows are swept at most once a minute in chunks of
  500 (the Blobasaur expiry approach).
- **Restarts**: a row left queued/running by a restart is reported as an error with a
  clear message, and the next submit re-runs it.
- **API** (all need a signed-in user):

  | Method | Path | Purpose |
  |---|---|---|
  | GET | `/api/v1/reports/tasks` | Task names, titles, descriptions, args |
  | POST | `/api/v1/reports/tasks/{name}/jobs` | Queue (202) or get the cached result. Body `{"args": {...}}` |
  | GET | `/api/v1/reports/jobs/{id}?offset=&limit=` | Status, plus a page of rows when done |
  | GET | `/api/v1/reports/jobs/{id}/csv` | Full result as CSV (formula-injection safe) |
  | DELETE | `/api/v1/reports/jobs/{id}` | Cancel a pending job or delete your result |

  Errors: 404 for an unknown task or a job you cannot see, 400 for bad args, 409 when
  you already have 3 running, 429 when the queue is full.
- **Adding a report**: add a `-- name:` block to a file in `tasks/`, then add a test.
  No code change is needed.

### 4.2 Single-flight read cache

`RedisCacheService.get_or_fetch` (`backend/app/services/redis_cache_service.py`) now
coalesces concurrent misses for the same key in the process: one `fetch_fn` call runs,
and every waiter gets its result (or its exception). A cancelled waiter does not cancel
the shared fetch. `None` is still not cached. Callers do not change. This covers the
quote, batch-quote and technical-signal paths in `market_data_service.py` and
`technical_analysis_service.py`, plus the community feed in `posts.py`.

## 5. Deferred plans

### 5.1 Partitioning `price_bars` by month (when it is worth it)

Do this when `price_bars` passes about 50M rows, when intraday bars are stored, or
when `pg_stat_statements` shows range scans on it in the top 10. Steps, following
Zerodha's own dual-write cutover:

1. Create `price_bars_p` with `PARTITION BY RANGE (timestamp)`, monthly partitions,
   primary key `(symbol_id, timestamp)` (the unique key already includes the
   partition key) and a default partition.
2. Dual-write: `DataFetcher._insert_bars_ignore_duplicates` writes to both tables.
3. Backfill month by month with `INSERT ... SELECT ... ON CONFLICT DO NOTHING`.
4. Compare per-symbol counts and min/max timestamps (the `price_bar_coverage` report
   gives exactly this) until they match for a week.
5. Swap names in one transaction, keep the old table for a release, then drop it.
6. A nightly job creates next month's partition ahead of time.

### 5.2 More report tasks

Good next candidates: a portfolio daily-value statement from `portfolio_snapshots`,
a per-model prediction accuracy report from `ml_prediction_stats`, and a screener
history report. Each is one SQL block plus a test.

## 6. Rollout and rollback

- **Migration**: `backend/scripts/create_report_results_table.py` creates the table and
  its two indexes. It is idempotent, adds a new table only and changes no existing
  table. `deploy.yml` runs it after the containers are healthy; startup
  `create_all` would also create it.
- **Backward compatibility**: all new routes are additive. The cache change keeps the
  `get_or_fetch` signature and semantics; only concurrent duplicate fetches go away.
- **Rollback**:
  1. Revert the PR. The old image ignores `report_results`.
  2. Optionally drop the table:
     `python scripts/create_report_results_table.py --drop`
     (same as `DROP TABLE IF EXISTS report_results;`). Nothing references it.
  3. The single-flight change has no state; reverting the code is enough.
- **Kill switch without a deploy**: set `REPORT_STATEMENT_TIMEOUT_MS` lower to stop
  heavy reports early. The routes stay available but bounded.

## 7. Tests

- `backend/tests/test_report_jobs.py`: registry safety (rejects writes, multiple
  statements, a missing `:user_id`, a reserved arg), arg validation and inclusive end
  dates, per-user privacy, cache hits and expiry, public sharing, paging, restart
  recovery, per-user limit, failed queries, the sweep, and the API end to end
  (including CSV formula-injection escaping and 401 without auth).
- An optional PostgreSQL test (`REPORTS_TEST_PG_URL=postgresql+psycopg://...`, against
  a throwaway database) checks that the SQL runs on Postgres, that a writing statement
  is refused by the READ ONLY transaction, and that `statement_timeout` stops a slow
  query.
- `backend/tests/test_cache_single_flight.py`: 20 concurrent misses run one fetch,
  errors reach every waiter, a cancelled waiter keeps the fetch alive, and `None` is
  not cached.
