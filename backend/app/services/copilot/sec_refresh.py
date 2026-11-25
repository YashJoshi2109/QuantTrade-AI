"""Incremental SEC filing refresh for the copilot index — runs in the news-worker.

Replaces the 6-hourly ``ingest_rag_data`` APScheduler job in the API process
(which always failed: the pgvector store raised NotImplementedError, and it
loaded torch into the 768M API container).

Every COPILOT_SEC_REFRESH_HOURS (default 6):
  * tickers = static universe (35) + tickers users viewed in the last 14 days
    (Research page views / copilot questions, Redis zset ``copilot:viewed``)
    + admin-queued tickers (Redis set ``copilot:sec:queue``)
  * for each ticker, list EDGAR submissions and index only accessions not seen
    before (Redis set ``copilot:sec:seen:{ticker}``, verified against Qdrant)
  * first sight of a ticker indexes the latest 10-K, last 3 10-Qs, last 2 8-Ks
  * embeddings use the pinned guarded embedder, billed to the system budget
    (ai_guard.system_context("sec_refresh")); a budget stop ends the run.
A Redis lock keeps it to one worker.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional

logger = logging.getLogger("copilot.sec_refresh")

UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "JNJ", "UNH", "XOM", "V", "LLY",
    "AVGO", "PG", "HD", "MA", "CVX", "ABBV", "MRK", "COST", "PEP", "KO", "ADBE", "CRM", "TMO", "ACN",
    "MCD", "CSCO", "BAC", "WMT", "NKE", "ABT", "LIN", "DHR",
]
FIRST_RUN_QUOTA = {"10-K": 1, "10-Q": 3, "8-K": 2}
INTERVAL_H = float(os.getenv("COPILOT_SEC_REFRESH_HOURS", "6"))
MAX_TICKERS_PER_RUN = int(os.getenv("COPILOT_SEC_MAX_TICKERS", "60"))
LOCK_KEY = "copilot:sec:lock"
STATUS_KEY = "copilot:sec:status"


def _seen_key(t: str) -> str:
    return f"copilot:sec:seen:{t}"


def select_new(filings: list, seen: set, first_run: bool) -> list:
    """Filings to index: unseen accessions, newest first; first run is capped per form."""
    out, per_form = [], {}
    for f in sorted(filings, key=lambda f: f.filed_date, reverse=True):
        if f.accession_num in seen or f.filing_type not in FIRST_RUN_QUOTA:
            continue
        if first_run:
            if per_form.get(f.filing_type, 0) >= FIRST_RUN_QUOTA[f.filing_type]:
                continue
            per_form[f.filing_type] = per_form.get(f.filing_type, 0) + 1
        out.append(f)
    return out


async def refresh_ticker(ticker: str, redis, embed_fn, spec) -> int:
    from app.services.copilot import sec_fetcher, sec_index
    filings = await asyncio.to_thread(sec_fetcher.fetch_filings_for_ticker, ticker, 2)
    seen = set(await redis.smembers(_seen_key(ticker))) if redis is not None else set()
    todo = select_new(filings, seen, first_run=not seen)
    new_chunks = 0
    for f in todo:
        try:
            if await asyncio.to_thread(sec_index.accession_indexed, ticker, f.accession_num):
                if redis is not None:
                    await redis.sadd(_seen_key(ticker), f.accession_num)
                continue
        except Exception:
            pass
        text = await asyncio.to_thread(sec_fetcher.download_filing_text, f)
        if not text or len(text) < 500:
            continue
        meta = sec_index.FilingMeta(ticker=ticker, cik=f.cik, accession=f.accession_num,
                                    filing_type=f.filing_type, filed_date=f.filed_date,
                                    fiscal_year=f.fiscal_year, url=f.primary_doc_url)
        new_chunks += await asyncio.to_thread(sec_index.index_filing, text, meta, embed_fn, spec)
        if redis is not None:
            await redis.sadd(_seen_key(ticker), f.accession_num)
    return new_chunks


async def run_once(redis, tickers: Optional[List[str]] = None) -> Dict[str, object]:
    from app.services import ai_guard
    from app.services.agentic.bedrock_client import EmbeddingUnavailable, embed_texts, embedding_spec
    from app.services.copilot import sec_index
    from app.services.copilot.viewed import QUEUE_KEY, recent_views

    spec = embedding_spec()
    await asyncio.to_thread(sec_index.ensure_collections, spec.dim)
    if tickers is None:
        queued = list(await redis.smembers(QUEUE_KEY)) if redis is not None else []
        viewed = await recent_views(redis)
        tickers = list(dict.fromkeys([*queued, *viewed, *UNIVERSE]))[:MAX_TICKERS_PER_RUN]
    status: Dict[str, object] = {"started_at": time.time(), "tickers": len(tickers), "processed": 0,
                                 "new_chunks": 0, "failed": [], "is_running": True}
    with ai_guard.system_context("sec_refresh"):
        for t in tickers:
            try:
                status["new_chunks"] += await refresh_ticker(t, redis, embed_texts, spec)
                status["processed"] += 1
                if redis is not None:
                    await redis.srem(QUEUE_KEY, t)
            except ai_guard.AIQuotaError as e:
                logger.warning("sec refresh stopped: AI budget (%s)", e.detail)
                status["stopped"] = "budget"
                break
            except EmbeddingUnavailable as e:
                logger.error("sec refresh stopped: %s", e)
                status["stopped"] = "embedder_unavailable"
                break
            except Exception as e:
                logger.warning("sec refresh failed for %s: %s", t, e)
                status["failed"].append(t)
            if redis is not None:
                await redis.set(STATUS_KEY, json.dumps(status), ex=7 * 86400)
    status.update(is_running=False, finished_at=time.time())
    if redis is not None:
        await redis.set(STATUS_KEY, json.dumps(status), ex=7 * 86400)
    logger.info("sec refresh done: %s", {k: v for k, v in status.items() if k != "failed"})
    return status


async def refresh_loop(redis, initial_delay: float = 300.0) -> None:
    """Worker loop; one instance holds the Redis lock per run."""
    await asyncio.sleep(initial_delay)
    while True:
        try:
            got = True
            if redis is not None:
                got = await redis.set(LOCK_KEY, str(os.getpid()), nx=True, ex=int(INTERVAL_H * 3600))
            if got:
                await run_once(redis)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("sec refresh loop error")
        await asyncio.sleep(INTERVAL_H * 3600)
