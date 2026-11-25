"""Ticker-scoped hybrid retrieval over the SEC filing index.

  1. ticker filter is ALWAYS applied — a search without tickers returns nothing
     (v1 ran cross-company searches whenever query analysis found no section)
  2. dense (pinned embedder, guarded) + sparse BM25 in parallel, fused with RRF
  3. optional Cohere rerank (guarded) only when COHERE_API_KEY is configured
  4. recency decay (half-life COPILOT_RECENCY_HALF_LIFE_DAYS, default 540)
  5. parent expansion under a token budget
  6. defence in depth: payload ticker / embed_model re-checked after search

No HyDE / multi-query: the ticker context pack answers most questions and each
extra LLM hop added ~1s before the first token.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Dict, List, Optional, Sequence

from app.services.copilot import bm25
from app.services.copilot.models import FilingChunkFact
from app.services.copilot.sources import looks_injected

logger = logging.getLogger(__name__)

RRF_K = 60
HALF_LIFE_DAYS = float(os.getenv("COPILOT_RECENCY_HALF_LIFE_DAYS", "540"))
CONTEXT_TOKEN_BUDGET = int(os.getenv("COPILOT_FILING_TOKEN_BUDGET", "3500"))
CANDIDATES = 30


@dataclass
class Hit:
    id: str
    payload: dict
    score: float


def _filter(tickers: Sequence[str], filing_types: Optional[Sequence[str]], section: Optional[str]):
    from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue
    must = [FieldCondition(key="ticker", match=MatchAny(any=[t.upper() for t in tickers]))]
    if filing_types:
        must.append(FieldCondition(key="filing_type", match=MatchAny(any=list(filing_types))))
    if section:
        must.append(FieldCondition(key="section", match=MatchValue(value=section)))
    return Filter(must=must)


def rrf(lists: List[List[Hit]], k: int = RRF_K) -> List[Hit]:
    score: Dict[str, float] = {}
    keep: Dict[str, Hit] = {}
    for lst in lists:
        for rank, h in enumerate(lst):
            score[h.id] = score.get(h.id, 0.0) + 1.0 / (k + rank + 1)
            keep.setdefault(h.id, h)
    return [Hit(i, keep[i].payload, s) for i, s in sorted(score.items(), key=lambda x: -x[1])]


def recency_weight(filed: Optional[str], today: Optional[date] = None) -> float:
    try:
        d = datetime.fromisoformat(str(filed)[:10]).date()
    except Exception:
        return 0.5
    age = max(0, ((today or date.today()) - d).days)
    return 0.5 ** (age / HALF_LIFE_DAYS)


def _dense(vec, flt, limit) -> List[Hit]:
    from app.services.copilot.sec_index import CHUNKS_COLLECTION, DENSE, qdrant
    r = qdrant().query_points(CHUNKS_COLLECTION, query=vec, using=DENSE, query_filter=flt,
                              limit=limit, with_payload=True)
    return [Hit(str(p.id), p.payload or {}, p.score) for p in r.points]


def _sparse(idx, val, flt, limit) -> List[Hit]:
    from qdrant_client.models import SparseVector
    from app.services.copilot.sec_index import CHUNKS_COLLECTION, SPARSE, qdrant
    r = qdrant().query_points(CHUNKS_COLLECTION, query=SparseVector(indices=idx, values=val),
                              using=SPARSE, query_filter=flt, limit=limit, with_payload=True)
    return [Hit(str(p.id), p.payload or {}, p.score) for p in r.points]


def _parents(ids: List[str]) -> Dict[str, str]:
    from app.services.copilot.sec_index import PARENTS_COLLECTION, qdrant
    if not ids:
        return {}
    recs = qdrant().retrieve(PARENTS_COLLECTION, ids=ids, with_payload=True, with_vectors=False)
    return {str(r.id): (r.payload or {}).get("text", "") for r in recs}


def _window(parent: str, child: str, max_words: int) -> str:
    """Child-centred window of the parent section, capped at max_words."""
    words = parent.split()
    if len(words) <= max_words:
        return parent
    pos = parent.find(child[:80])
    start_word = len(parent[:pos].split()) if pos >= 0 else 0
    lo = max(0, start_word - max_words // 3)
    return " ".join(words[lo:lo + max_words])


async def search_filings(query: str, tickers: Sequence[str], *, filing_types: Optional[Sequence[str]] = None,
                         section: Optional[str] = None, limit: int = 4,
                         token_budget: int = CONTEXT_TOKEN_BUDGET) -> List[FilingChunkFact]:
    tickers = [t.upper() for t in tickers if t]
    if not tickers:
        logger.info("search_filings refused: no ticker scope")
        return []
    from app.services.agentic.bedrock_client import (EmbeddingUnavailable, embed_query,
                                                     embedding_spec, rerank, rerank_configured)
    flt = _filter(tickers, filing_types, section)
    spec = embedding_spec()

    async def dense() -> List[Hit]:
        try:
            vec = await asyncio.to_thread(embed_query, query)   # to_thread keeps the guard context
        except EmbeddingUnavailable as e:
            logger.warning("dense retrieval disabled: %s", e)
            return []
        return await asyncio.to_thread(_dense, vec, flt, CANDIDATES)

    async def sparse() -> List[Hit]:
        idx, val = bm25.encode_query(query)
        return await asyncio.to_thread(_sparse, idx, val, flt, CANDIDATES) if idx else []

    lists: List[List[Hit]] = []
    for r in await asyncio.gather(dense(), sparse(), return_exceptions=True):
        if isinstance(r, Exception):
            logger.warning("filing search leg failed: %s", r)
        elif r:
            lists.append(r)
    if not lists:
        return []

    fused = []
    for h in rrf(lists):
        p = h.payload
        if (p.get("ticker") or "").upper() not in tickers:
            continue                                   # never leak another company
        if p.get("embed_model") not in (None, spec.key):
            logger.error("dropping %s: embed_model %s != pinned %s", h.id, p.get("embed_model"), spec.key)
            continue
        fused.append(Hit(h.id, p, h.score * recency_weight(p.get("filed_date"))))
    fused.sort(key=lambda h: -h.score)
    fused = fused[:CANDIDATES]

    if rerank_configured() and len(fused) > limit:
        try:
            ranked = await asyncio.to_thread(rerank, query, [h.payload.get("text", "") for h in fused], limit * 2)
            fused = [Hit(fused[r["index"]].id, fused[r["index"]].payload,
                         r["score"] * recency_weight(fused[r["index"]].payload.get("filed_date")))
                     for r in ranked]
            fused.sort(key=lambda h: -h.score)
        except Exception as e:
            logger.warning("rerank skipped: %s", e)

    top = fused[:limit]
    try:
        parents = await asyncio.to_thread(_parents, list({h.payload.get("parent_id") for h in top if h.payload.get("parent_id")}))
    except Exception as e:
        logger.warning("parent fetch failed: %s", e)
        parents = {}

    out: List[FilingChunkFact] = []
    used = 0
    per_chunk = max(120, int(token_budget / max(1, len(top)) / 1.3))
    for h in top:
        p = h.payload
        child = p.get("text", "")
        text = _window(parents.get(p.get("parent_id"), "") or child, child, per_chunk)
        cost = math.ceil(len(text.split()) * 1.3)
        if used + cost > token_budget and out:
            break
        used += cost
        out.append(FilingChunkFact(
            id=f"filing:{h.id[:12]}", source=f"SEC {p.get('filing_type')} (EDGAR, accession {p.get('accession')})",
            as_of=p.get("filed_date"), ticker=p.get("ticker"), filing_type=p.get("filing_type") or "",
            fiscal_year=p.get("fiscal_year"), section=p.get("section"), filed_date=p.get("filed_date"),
            accession=p.get("accession"), url=p.get("url"), text=text, score=round(h.score, 5),
            suspicious=looks_injected(text)))
    return out
