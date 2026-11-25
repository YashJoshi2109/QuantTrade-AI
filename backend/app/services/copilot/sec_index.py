"""SEC filing index in Qdrant (v2): chunking, ids, upsert.

Fixes over v1 (sec_filings_chunks / sec_filings_parents):
  * ids are content hashes of (ticker, accession, section, text) — re-ingesting
    the same filing is a no-op (existing ids are skipped before embedding);
    v1 used uuid4 ids + a hash dedupe that wrote [0.0]*1536 vectors on re-ingest.
  * a point is NEVER written without a real dense vector of the pinned
    dimension; zero / wrong-size vectors raise.
  * every point stores ``embed_model`` + ``embed_dim``; retrieval drops points
    whose model differs from the pinned one (fail closed on drift).
  * sparse BM25 vectors (pure Python, collection modifier=IDF) for hybrid search.
  * chunking is deterministic sentence packing — no sentence-transformers / torch.

Runs in the news-worker (sec_refresh), never in the API process.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from app.services.copilot import bm25

logger = logging.getLogger(__name__)

CHUNKS_COLLECTION = os.getenv("COPILOT_CHUNKS_COLLECTION", "sec_chunks_v2")
PARENTS_COLLECTION = os.getenv("COPILOT_PARENTS_COLLECTION", "sec_parents_v2")
DENSE = "dense"
SPARSE = "bm25"
CHILD_WORDS = 280            # ~360 tokens
CHILD_OVERLAP_SENTENCES = 1
PARENT_MAX_WORDS = 2400      # ~3k tokens; long sections become several parents
_NS = uuid.UUID("6f1c9c1e-4a52-4f0e-9a39-2f0d1d6c0b7e")

SEC_SECTION_PATTERNS: Dict[str, Tuple[re.Pattern, str]] = {
    "Business": (re.compile(r"item\s+1[.\s:](?!a)", re.I), "1"),
    "Risk Factors": (re.compile(r"item\s+1a[.\s:]", re.I), "1A"),
    "MD&A": (re.compile(r"item\s+7[.\s:](?!a)", re.I), "7"),
    "Quantitative Market Risk": (re.compile(r"item\s+7a[.\s:]", re.I), "7A"),
    "Financial Statements": (re.compile(r"item\s+8[.\s:]", re.I), "8"),
    "Controls & Procedures": (re.compile(r"item\s+9a[.\s:]", re.I), "9A"),
    # 10-Q part I items
    "MD&A (10-Q)": (re.compile(r"item\s+2[.\s:]\s*management", re.I), "2"),
    "Results of Operations (8-K)": (re.compile(r"item\s+2\.02", re.I), "2.02"),
}
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])")


@dataclass
class FilingMeta:
    ticker: str
    cik: str
    accession: str
    filing_type: str
    filed_date: str
    fiscal_year: int
    company_name: str = ""
    url: str = ""


@dataclass
class Chunk:
    id: str
    parent_id: str
    text: str
    section: str
    item: str
    is_parent: bool
    meta: FilingMeta

    def payload(self, embed_key: Optional[str], embed_dim: Optional[int]) -> dict:
        m = self.meta
        return {
            "chunk_id": self.id, "parent_id": self.parent_id, "text": self.text,
            "section": self.section, "item_number": self.item, "is_parent": self.is_parent,
            "ticker": m.ticker, "cik": m.cik, "accession": m.accession, "filing_type": m.filing_type,
            "filed_date": m.filed_date, "fiscal_year": m.fiscal_year, "company_name": m.company_name,
            "url": m.url, "embed_model": embed_key, "embed_dim": embed_dim,
            "content_hash": hashlib.sha256(self.text.encode()).hexdigest(),
        }


def content_id(*parts: str) -> str:
    """Deterministic point id from content (re-ingest = same id)."""
    return str(uuid.uuid5(_NS, hashlib.sha256("\x1f".join(parts).encode()).hexdigest()))


def split_sections(text: str) -> List[Tuple[str, str, str]]:
    bounds = sorted((m.start(), name, item) for name, (rx, item) in SEC_SECTION_PATTERNS.items()
                    for m in rx.finditer(text))
    out = []
    for i, (start, name, item) in enumerate(bounds):
        end = bounds[i + 1][0] if i + 1 < len(bounds) else len(text)
        body = text[start:end].strip()
        if len(body.split()) >= 40:            # skip table-of-contents stubs
            out.append((name, item, body))
    return out or [("Document", "", text.strip())]


def _pack(sentences: List[str], max_words: int, overlap: int) -> List[str]:
    chunks, cur, n = [], [], 0
    for s in sentences:
        w = len(s.split())
        if w > max_words:                      # pathological sentence: hard split
            if cur:
                chunks.append(" ".join(cur)); cur, n = [], 0
            words = s.split()
            chunks += [" ".join(words[i:i + max_words]) for i in range(0, len(words), max_words)]
            continue
        if n + w > max_words and cur:
            chunks.append(" ".join(cur))
            cur = cur[-overlap:] if overlap else []
            n = sum(len(x.split()) for x in cur)
        cur.append(s)
        n += w
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def chunk_filing(text: str, meta: FilingMeta) -> Tuple[List[Chunk], List[Chunk]]:
    children: List[Chunk] = []
    parents: List[Chunk] = []
    for section, item, body in split_sections(text):
        sentences = [s.strip() for s in _SENT.split(re.sub(r"\s+", " ", body)) if s.strip()]
        for p_text in _pack(sentences, PARENT_MAX_WORDS, 0):
            pid = content_id(meta.ticker, meta.accession, section, "parent", p_text)
            parents.append(Chunk(pid, pid, p_text, section, item, True, meta))
            p_sent = [s.strip() for s in _SENT.split(p_text) if s.strip()]
            for c_text in _pack(p_sent, CHILD_WORDS, CHILD_OVERLAP_SENTENCES):
                cid = content_id(meta.ticker, meta.accession, section, c_text)
                children.append(Chunk(cid, pid, c_text, section, item, False, meta))
    # identical boilerplate inside one filing collapses to one id
    uniq = {c.id: c for c in children}
    return list(uniq.values()), list({p.id: p for p in parents}.values())


@lru_cache(maxsize=1)
def qdrant():
    from qdrant_client import QdrantClient
    from app.config import settings
    kw = {"url": settings.QDRANT_URL, "timeout": 5}
    if settings.QDRANT_API_KEY:
        kw["api_key"] = settings.QDRANT_API_KEY
    return QdrantClient(**kw)


def ensure_collections(dim: int) -> None:
    from qdrant_client.models import (Distance, HnswConfigDiff, Modifier, PayloadSchemaType,
                                      SparseVectorParams, VectorParams)
    c = qdrant()
    if c.collection_exists(CHUNKS_COLLECTION):
        info = c.get_collection(CHUNKS_COLLECTION)
        vecs = info.config.params.vectors
        size = vecs[DENSE].size if isinstance(vecs, dict) else getattr(vecs, "size", None)
        if size != dim:
            raise RuntimeError(f"{CHUNKS_COLLECTION} has dim={size} but pinned embedder dim={dim}; "
                               "set COPILOT_CHUNKS_COLLECTION to a new name and re-index")
    else:
        c.create_collection(
            CHUNKS_COLLECTION,
            vectors_config={DENSE: VectorParams(size=dim, distance=Distance.COSINE)},
            sparse_vectors_config={SPARSE: SparseVectorParams(modifier=Modifier.IDF)},
            hnsw_config=HnswConfigDiff(m=16, ef_construct=100),
        )
        for f, t in [("ticker", PayloadSchemaType.KEYWORD), ("filing_type", PayloadSchemaType.KEYWORD),
                     ("section", PayloadSchemaType.KEYWORD), ("accession", PayloadSchemaType.KEYWORD),
                     ("fiscal_year", PayloadSchemaType.INTEGER), ("embed_model", PayloadSchemaType.KEYWORD)]:
            c.create_payload_index(CHUNKS_COLLECTION, field_name=f, field_schema=t)
    if not c.collection_exists(PARENTS_COLLECTION):
        # parents are fetched by id only: no dense vector needed at all
        c.create_collection(PARENTS_COLLECTION, vectors_config={})
        c.create_payload_index(PARENTS_COLLECTION, field_name="ticker", field_schema=PayloadSchemaType.KEYWORD)


def existing_ids(collection: str, ids: Sequence[str]) -> set:
    found: set = set()
    for i in range(0, len(ids), 256):
        recs = qdrant().retrieve(collection, ids=list(ids[i:i + 256]), with_payload=False, with_vectors=False)
        found.update(str(r.id) for r in recs)
    return found


def accession_indexed(ticker: str, accession: str) -> bool:
    from qdrant_client.models import FieldCondition, Filter, MatchValue
    r = qdrant().count(CHUNKS_COLLECTION, count_filter=Filter(must=[
        FieldCondition(key="ticker", match=MatchValue(value=ticker)),
        FieldCondition(key="accession", match=MatchValue(value=accession))]), exact=False)
    return r.count > 0


def index_filing(text: str, meta: FilingMeta, embed_fn, spec) -> int:
    """Chunk + embed + upsert one filing.  Returns number of NEW child chunks.

    ``embed_fn(texts) -> vectors`` must be the guarded embedder; any vector that
    is not exactly ``spec.dim`` long and non-zero aborts the batch."""
    from qdrant_client.models import PointStruct, SparseVector

    children, parents = chunk_filing(text, meta)
    if not children:
        return 0
    have = existing_ids(CHUNKS_COLLECTION, [c.id for c in children])
    todo = [c for c in children if c.id not in have]
    if not todo:
        return 0
    new = 0
    for i in range(0, len(todo), 64):
        batch = todo[i:i + 64]
        vecs = embed_fn([c.text for c in batch])
        if len(vecs) != len(batch):
            raise RuntimeError("embedder returned wrong number of vectors")
        points = []
        for c, v in zip(batch, vecs):
            if len(v) != spec.dim or not any(v):
                raise RuntimeError(f"refusing to index {c.id}: vector dim={len(v)} zero={not any(v)}")
            idx, val = bm25.encode_document(c.text)
            vector = {DENSE: v}
            if idx:
                vector[SPARSE] = SparseVector(indices=idx, values=val)
            points.append(PointStruct(id=c.id, vector=vector, payload=c.payload(spec.key, spec.dim)))
        qdrant().upsert(CHUNKS_COLLECTION, points=points)
        new += len(points)
    p_have = existing_ids(PARENTS_COLLECTION, [p.id for p in parents])
    p_new = [PointStruct(id=p.id, vector={}, payload=p.payload(None, None)) for p in parents if p.id not in p_have]
    for i in range(0, len(p_new), 32):
        qdrant().upsert(PARENTS_COLLECTION, points=p_new[i:i + 32])
    logger.info("indexed %s %s %s: %d new chunks", meta.ticker, meta.filing_type, meta.accession, new)
    return new


def iter_texts(chunks: Iterable[Chunk]) -> List[str]:
    return [c.text for c in chunks]
