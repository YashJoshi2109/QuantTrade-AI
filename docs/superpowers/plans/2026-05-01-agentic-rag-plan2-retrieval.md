# Agentic RAG — Plan 2: Retrieval Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 5-stage SEC filing retrieval pipeline (Query Analysis → HyDE → Hybrid Search → Rerank → Parent-Child Expansion) and wire it as a LangChain `@tool`.

**Architecture:** BM25 sparse vectors added to Qdrant `sec_filings_chunks` (alongside existing Titan v2 dense vectors); each stage is a focused async function in `retrieval/`; `tools/rag_tool.py` composes them into `search_sec_filings()` callable by LangGraph agents.

**Tech Stack:** qdrant-client 1.x, fastembed (Qdrant/bm25), langchain-aws 1.x (ChatBedrock.ainvoke), Cohere Python SDK 5.x, asyncio

---

## File Map

**Created:**
- `backend/app/services/agentic/sparse_encoder.py` — BM25 fastembed wrapper (shared by ingestion + retrieval)
- `backend/app/services/agentic/retrieval/__init__.py`
- `backend/app/services/agentic/retrieval/query_analysis.py` — Stage 1
- `backend/app/services/agentic/retrieval/hyde.py` — Stage 2
- `backend/app/services/agentic/retrieval/hybrid_search.py` — Stage 3
- `backend/app/services/agentic/retrieval/reranker.py` — Stage 4
- `backend/app/services/agentic/retrieval/parent_child.py` — Stage 5
- `backend/app/services/agentic/tools/__init__.py`
- `backend/app/services/agentic/tools/rag_tool.py` — public search_sec_filings tool
- `backend/tests/agentic/retrieval/__init__.py`
- `backend/tests/agentic/retrieval/test_query_analysis.py`
- `backend/tests/agentic/retrieval/test_hyde.py`
- `backend/tests/agentic/retrieval/test_hybrid_search.py`
- `backend/tests/agentic/retrieval/test_reranker.py`
- `backend/tests/agentic/retrieval/test_parent_child.py`
- `backend/tests/agentic/retrieval/test_rag_tool.py`

**Modified:**
- `backend/app/services/agentic/ingestion/indexer.py` — named vectors (dense + bm25 sparse)
- `backend/app/services/agentic/ingestion/orchestrator.py` — pass sparse vectors to upsert
- `backend/tests/agentic/ingestion/test_indexer.py` — update for named vector assertions

---

## Task 1: BM25 Sparse Encoder + Indexer Named-Vector Update

**Files:**
- Create: `backend/app/services/agentic/sparse_encoder.py`
- Modify: `backend/app/services/agentic/ingestion/indexer.py`
- Modify: `backend/app/services/agentic/ingestion/orchestrator.py`
- Modify: `backend/tests/agentic/ingestion/test_indexer.py`

- [ ] **Step 1: Write failing tests for sparse_encoder**

Create `backend/tests/agentic/test_sparse_encoder.py`:

```python
"""Tests for BM25 sparse encoder."""
import pytest
from unittest.mock import MagicMock, patch


def test_encode_sparse_returns_sparse_vectors():
    """encode_sparse() returns one SparseVector per input text."""
    from qdrant_client.models import SparseVector

    fake_emb = MagicMock()
    fake_emb.indices = __import__("numpy").array([0, 5, 12])
    fake_emb.values = __import__("numpy").array([0.9, 0.5, 0.3])

    with patch(
        "app.services.agentic.sparse_encoder._bm25_model"
    ) as mock_model_fn:
        mock_model = MagicMock()
        mock_model.embed.return_value = iter([fake_emb, fake_emb])
        mock_model_fn.return_value = mock_model

        from app.services.agentic.sparse_encoder import encode_sparse

        results = encode_sparse(["Apple supply chain", "MSFT Azure"])

    assert len(results) == 2
    assert isinstance(results[0], SparseVector)
    assert results[0].indices == [0, 5, 12]
    assert results[0].values == pytest.approx([0.9, 0.5, 0.3])


def test_encode_sparse_empty_text():
    """encode_sparse([]) returns empty list without calling model."""
    with patch("app.services.agentic.sparse_encoder._bm25_model") as mock_model_fn:
        mock_model = MagicMock()
        mock_model.embed.return_value = iter([])
        mock_model_fn.return_value = mock_model

        from app.services.agentic.sparse_encoder import encode_sparse

        results = encode_sparse([])

    assert results == []
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_sparse_encoder.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` (file doesn't exist yet).

- [ ] **Step 3: Create sparse_encoder.py**

Create `backend/app/services/agentic/sparse_encoder.py`:

```python
"""BM25 sparse text encoding via fastembed.

Shared by:
  - ingestion/indexer.py  (upsert sparse vectors)
  - retrieval/hybrid_search.py  (encode query for sparse search)
"""
from __future__ import annotations

import logging
from functools import lru_cache

from fastembed import SparseTextEmbedding
from qdrant_client.models import SparseVector

logger = logging.getLogger(__name__)

BM25_MODEL_NAME = "Qdrant/bm25"


@lru_cache(maxsize=1)
def _bm25_model() -> SparseTextEmbedding:
    """Lazy singleton BM25 model — downloads on first call (~50MB)."""
    logger.info("Loading BM25 model: %s", BM25_MODEL_NAME)
    return SparseTextEmbedding(model_name=BM25_MODEL_NAME)


def encode_sparse(texts: list[str]) -> list[SparseVector]:
    """Encode texts as BM25 sparse vectors compatible with Qdrant hybrid search.

    Returns one SparseVector per input text, preserving order.
    """
    if not texts:
        return []
    model = _bm25_model()
    embeddings = list(model.embed(texts))
    return [
        SparseVector(
            indices=emb.indices.tolist(),
            values=emb.values.tolist(),
        )
        for emb in embeddings
    ]
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/test_sparse_encoder.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Update indexer.py for named vectors + sparse upsert**

Replace `backend/app/services/agentic/ingestion/indexer.py` entirely:

```python
"""Qdrant indexer — collection setup, chunk upsert, and dedup check.

Collection schema uses NAMED vectors:
  "dense"  — Titan Embeddings v2 (1536d), COSINE, HNSW, for ANN search
  "bm25"   — BM25 sparse vectors via fastembed, for keyword search

NOTE: If the sec_filings_chunks collection was previously created with the old
unnamed-vector schema, drop it in Qdrant before restarting (no prod data yet).
"""
from __future__ import annotations

import logging
import os
import uuid
from functools import lru_cache
from typing import Dict, List, Optional, Sequence

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    HnswConfigDiff,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    SparseVector,
    SparseVectorParams,
    VectorParams,
)

from .chunker import Chunk

logger = logging.getLogger(__name__)

CHUNKS_COLLECTION  = "sec_filings_chunks"
PARENTS_COLLECTION = "sec_filings_parents"
VECTOR_DIM         = 1536
DENSE_VECTOR_NAME  = "dense"
SPARSE_VECTOR_NAME = "bm25"


@lru_cache(maxsize=1)
def _qdrant_client() -> QdrantClient:
    url     = os.environ.get("QDRANT_URL", "http://localhost:6333")
    api_key = os.environ.get("QDRANT_API_KEY")
    kwargs: dict = {"url": url}
    if api_key:
        kwargs["api_key"] = api_key
    return QdrantClient(**kwargs)


def ensure_collections_exist() -> None:
    """Create Qdrant collections if absent. Safe to call on every startup."""
    client = _qdrant_client()

    if not client.collection_exists(CHUNKS_COLLECTION):
        client.create_collection(
            CHUNKS_COLLECTION,
            vectors_config={
                DENSE_VECTOR_NAME: VectorParams(
                    size=VECTOR_DIM,
                    distance=Distance.COSINE,
                )
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: SparseVectorParams()
            },
            hnsw_config=HnswConfigDiff(m=16, ef_construct=100),
        )
        for field, schema in [
            ("ticker",       PayloadSchemaType.KEYWORD),
            ("filing_type",  PayloadSchemaType.KEYWORD),
            ("fiscal_year",  PayloadSchemaType.INTEGER),
            ("content_hash", PayloadSchemaType.KEYWORD),
            ("section",      PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                CHUNKS_COLLECTION, field_name=field, field_schema=schema
            )
        logger.info("Created collection: %s", CHUNKS_COLLECTION)

    if not client.collection_exists(PARENTS_COLLECTION):
        client.create_collection(
            PARENTS_COLLECTION,
            vectors_config={
                DENSE_VECTOR_NAME: VectorParams(
                    size=VECTOR_DIM,
                    distance=Distance.COSINE,
                )
            },
        )
        for field, schema in [
            ("ticker",      PayloadSchemaType.KEYWORD),
            ("filing_type", PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(
                PARENTS_COLLECTION, field_name=field, field_schema=schema
            )
        logger.info("Created collection: %s", PARENTS_COLLECTION)


def chunk_exists(content_hash: str) -> bool:
    """True if a chunk with this content_hash is already indexed."""
    client = _qdrant_client()
    results, _ = client.scroll(
        collection_name=CHUNKS_COLLECTION,
        scroll_filter=Filter(
            must=[FieldCondition(key="content_hash", match=MatchValue(value=content_hash))]
        ),
        limit=1,
        with_payload=False,
        with_vectors=False,
    )
    return len(results) > 0


def _chunk_to_payload(chunk: Chunk) -> dict:
    return {
        "chunk_id":        chunk.chunk_id,
        "parent_chunk_id": chunk.parent_chunk_id,
        "text":            chunk.text,
        "token_count":     chunk.token_count,
        "section":         chunk.section,
        "item_number":     chunk.item_number,
        "is_parent":       chunk.is_parent,
        "ticker":          chunk.ticker,
        "company_name":    chunk.company_name,
        "filing_type":     chunk.filing_type,
        "filed_date":      chunk.filed_date,
        "fiscal_year":     chunk.fiscal_year,
        "cik":             chunk.cik,
        "content_hash":    chunk.content_hash,
    }


def upsert_chunks(
    children: Sequence[Chunk],
    parents: Sequence[Chunk],
    child_vectors: Dict[str, List[float]],
    child_sparse_vectors: Optional[Dict[str, SparseVector]] = None,
) -> None:
    """Upsert child chunks (dense + optional sparse) and parent sections.

    Args:
        children:             Child Chunk objects (400–800 tokens, ANN searchable).
        parents:              Parent Chunk objects (up to 4096 tokens, ID-fetched).
        child_vectors:        chunk_id → 1536-dim dense vector.
        child_sparse_vectors: chunk_id → BM25 SparseVector. None = skip sparse.
    """
    client = _qdrant_client()

    if children:
        child_points = []
        for c in children:
            dense = child_vectors.get(c.chunk_id, [0.0] * VECTOR_DIM)
            if child_sparse_vectors and c.chunk_id in child_sparse_vectors:
                vector: dict = {
                    DENSE_VECTOR_NAME: dense,
                    SPARSE_VECTOR_NAME: child_sparse_vectors[c.chunk_id],
                }
            else:
                vector = {DENSE_VECTOR_NAME: dense}
            child_points.append(
                PointStruct(
                    id=str(uuid.uuid5(uuid.NAMESPACE_DNS, c.chunk_id)),
                    vector=vector,
                    payload=_chunk_to_payload(c),
                )
            )
        client.upsert(collection_name=CHUNKS_COLLECTION, points=child_points)
        logger.debug("Upserted %d child chunks", len(child_points))

    if parents:
        parent_points = [
            PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_DNS, p.chunk_id)),
                vector={DENSE_VECTOR_NAME: [0.0] * VECTOR_DIM},
                payload=_chunk_to_payload(p),
            )
            for p in parents
        ]
        client.upsert(collection_name=PARENTS_COLLECTION, points=parent_points)
        logger.debug("Upserted %d parent sections", len(parent_points))
```

- [ ] **Step 6: Update test_indexer.py for named vectors**

Replace `backend/tests/agentic/ingestion/test_indexer.py`:

```python
"""Tests for Qdrant indexer — collection setup and upsert."""
import pytest
from unittest.mock import MagicMock, patch

from qdrant_client.models import SparseVector

from app.services.agentic.ingestion.indexer import (
    CHUNKS_COLLECTION,
    DENSE_VECTOR_NAME,
    PARENTS_COLLECTION,
    SPARSE_VECTOR_NAME,
    chunk_exists,
    ensure_collections_exist,
    upsert_chunks,
)
from app.services.agentic.ingestion.chunker import Chunk


def make_chunk(symbol: str = "AAPL", is_parent: bool = False) -> Chunk:
    return Chunk(
        chunk_id=f"test-{symbol}-child",
        parent_chunk_id=f"test-{symbol}-parent",
        text="Apple Inc faces supply chain risks.",
        token_count=8,
        section="Risk Factors",
        item_number="1A",
        is_parent=is_parent,
        ticker=symbol,
        company_name="Apple Inc.",
        filing_type="10-K",
        filed_date="2024-11-01",
        fiscal_year=2024,
        cik="0000320193",
    )


def test_ensure_collections_creates_both_collections():
    """ensure_collections_exist() creates sec_filings_chunks and sec_filings_parents."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.collection_exists.return_value = False
        ensure_collections_exist()
        create_calls = mock_qdrant.return_value.create_collection.call_args_list
        names = [c.args[0] for c in create_calls]
        assert CHUNKS_COLLECTION in names
        assert PARENTS_COLLECTION in names


def test_ensure_collections_chunks_has_sparse_config():
    """sec_filings_chunks is created with sparse_vectors_config for BM25."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.collection_exists.return_value = False
        ensure_collections_exist()
        chunks_call = next(
            c for c in mock_qdrant.return_value.create_collection.call_args_list
            if c.args[0] == CHUNKS_COLLECTION
        )
        sparse_cfg = chunks_call.kwargs.get("sparse_vectors_config", {})
        assert SPARSE_VECTOR_NAME in sparse_cfg


def test_ensure_collections_skips_existing():
    """ensure_collections_exist() skips creation if collection already exists."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.collection_exists.return_value = True
        ensure_collections_exist()
        mock_qdrant.return_value.create_collection.assert_not_called()


def test_upsert_chunks_calls_qdrant_upsert_twice():
    """upsert_chunks() calls qdrant.upsert for children then parents."""
    child  = make_chunk()
    parent = make_chunk(is_parent=True)
    dense  = {"test-AAPL-child": [0.1] * 1536}

    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        upsert_chunks([child], [parent], dense)
        assert mock_qdrant.return_value.upsert.call_count == 2


def test_upsert_chunks_child_has_named_dense_vector():
    """Child point vector is a dict with 'dense' key."""
    child = make_chunk()
    dense = {"test-AAPL-child": [0.1] * 1536}

    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        upsert_chunks([child], [], dense)
        call = mock_qdrant.return_value.upsert.call_args_list[0]
        points = call.kwargs["points"]
        assert DENSE_VECTOR_NAME in points[0].vector


def test_upsert_chunks_includes_sparse_when_provided():
    """Child point vector includes 'bm25' key when sparse vectors provided."""
    child   = make_chunk()
    dense   = {"test-AAPL-child": [0.1] * 1536}
    sparse  = {"test-AAPL-child": SparseVector(indices=[0, 3], values=[0.8, 0.4])}

    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        upsert_chunks([child], [], dense, sparse)
        call   = mock_qdrant.return_value.upsert.call_args_list[0]
        points = call.kwargs["points"]
        assert SPARSE_VECTOR_NAME in points[0].vector
        assert points[0].vector[SPARSE_VECTOR_NAME].indices == [0, 3]


def test_chunk_exists_returns_true_when_found():
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.scroll.return_value = ([MagicMock()], None)
        assert chunk_exists("abc123") is True


def test_chunk_exists_returns_false_when_not_found():
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.scroll.return_value = ([], None)
        assert chunk_exists("abc123") is False
```

- [ ] **Step 7: Update orchestrator.py to compute and pass sparse vectors**

In `backend/app/services/agentic/ingestion/orchestrator.py`, find the `ingest_ticker` function and update the upsert call. Read the file first, then make this targeted change.

Find the section that calls `upsert_chunks(...)` and replace it with:

```python
        # Compute sparse (BM25) vectors for child chunks
        from app.services.agentic.sparse_encoder import encode_sparse
        child_texts  = [c.text for c in children]
        sparse_vecs  = encode_sparse(child_texts)
        child_sparse = {c.chunk_id: sv for c, sv in zip(children, sparse_vecs)}

        upsert_chunks(children, parents, vectors, child_sparse)
```

The old call was:
```python
        upsert_chunks(children, parents, vectors)
```

- [ ] **Step 8: Run all ingestion tests → all pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/ingestion/ tests/agentic/test_sparse_encoder.py tests/agentic/test_bedrock_client.py -v
```

Expected: all pass (exact count depends on existing tests; no new failures).

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/agentic/sparse_encoder.py \
        backend/app/services/agentic/ingestion/indexer.py \
        backend/app/services/agentic/ingestion/orchestrator.py \
        backend/tests/agentic/test_sparse_encoder.py \
        backend/tests/agentic/ingestion/test_indexer.py
git commit -m "feat(retrieval): BM25 sparse encoder + named-vector Qdrant schema"
```

---

## Task 2: Stage 1 — Query Analysis

**Files:**
- Create: `backend/app/services/agentic/retrieval/__init__.py`
- Create: `backend/app/services/agentic/retrieval/query_analysis.py`
- Create: `backend/tests/agentic/retrieval/__init__.py`
- Create: `backend/tests/agentic/retrieval/test_query_analysis.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/agentic/retrieval/__init__.py` (empty).

Create `backend/tests/agentic/retrieval/test_query_analysis.py`:

```python
"""Tests for Stage 1: Query Analysis."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_analyze_query_extracts_ticker_and_section():
    """analyze_query() returns QueryAnalysisResult with tickers and sections."""
    llm_json = """{
        "tickers": ["AAPL"],
        "filing_types": ["10-K"],
        "sections": ["Risk Factors"],
        "date_from": "2023-01-01",
        "query_variants": [
            "Apple supply chain risk",
            "AAPL China manufacturing dependency",
            "Apple geographic revenue concentration"
        ]
    }"""
    mock_response = MagicMock()
    mock_response.content = llm_json

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("What are Apple's biggest risks in China?")

    assert result.tickers == ["AAPL"]
    assert "Risk Factors" in result.sections
    assert len(result.query_variants) == 3
    assert result.date_from == "2023-01-01"
    assert result.original_query == "What are Apple's biggest risks in China?"


@pytest.mark.asyncio
async def test_analyze_query_json_in_markdown_fence():
    """analyze_query() parses JSON even when wrapped in ```json fence."""
    llm_json = """```json\n{"tickers": ["MSFT"], "filing_types": ["10-Q"],
    "sections": ["MD&A"], "date_from": null,
    "query_variants": ["Microsoft cloud revenue", "Azure growth"]}\n```"""
    mock_response = MagicMock()
    mock_response.content = llm_json

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("How is Microsoft cloud revenue growing?")

    assert result.tickers == ["MSFT"]
    assert result.date_from is None


@pytest.mark.asyncio
async def test_analyze_query_fallback_on_bad_json():
    """analyze_query() returns fallback with original query when JSON is malformed."""
    mock_response = MagicMock()
    mock_response.content = "Sorry, I cannot answer that."

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("some query")

    assert result.original_query == "some query"
    assert result.query_variants == ["some query"]
    assert result.tickers == []


@pytest.mark.asyncio
async def test_analyze_query_accepts_tickers_hint():
    """analyze_query() merges tickers_hint into result when provided."""
    llm_json = '{"tickers": [], "filing_types": ["10-K"], "sections": [], "date_from": null, "query_variants": ["risk analysis"]}'
    mock_response = MagicMock()
    mock_response.content = llm_json

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.query_analysis import analyze_query

        result = await analyze_query("risk analysis", tickers_hint=["NVDA"])

    assert "NVDA" in result.tickers
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_query_analysis.py -v
```

Expected: `ImportError` (modules don't exist yet).

- [ ] **Step 3: Create retrieval/__init__.py and query_analysis.py**

Create `backend/app/services/agentic/retrieval/__init__.py` (empty file).

Create `backend/app/services/agentic/retrieval/query_analysis.py`:

```python
"""Stage 1 — Query Analysis.

Claude Haiku extracts structured metadata from the user query and generates
3–5 search query variants for parallel retrieval.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from app.services.agentic.bedrock_client import get_llm_haiku

logger = logging.getLogger(__name__)

_PROMPT = """\
You are a financial document search assistant. Extract structured search metadata \
from the user's query about SEC filings.

Return ONLY a valid JSON object with these fields:
- tickers: list of stock tickers mentioned (uppercase, e.g. ["AAPL", "MSFT"]), empty list if none
- filing_types: relevant SEC filing types, subset of ["10-K", "10-Q", "8-K", "DEF 14A"]
- sections: relevant sections, subset of ["Business", "Risk Factors", "MD&A", \
"Quantitative Market Risk", "Financial Statements", "Controls & Procedures"]
- date_from: ISO date "YYYY-MM-DD" for earliest relevant filing, or null
- query_variants: list of 3–5 search query phrasings covering different angles

User query: {query}

Respond with ONLY the JSON object, no explanation or markdown."""


@dataclass
class QueryAnalysisResult:
    tickers: list[str]
    filing_types: list[str]
    sections: list[str]
    date_from: str | None
    query_variants: list[str]
    original_query: str


def _extract_json(text: str) -> dict:
    """Extract JSON from LLM response, handling optional markdown code fences."""
    # Strip ```json ... ``` fences
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    # Try raw JSON object
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"No JSON found in LLM response: {text[:200]!r}")


def _fallback(query: str, tickers_hint: list[str] | None) -> QueryAnalysisResult:
    return QueryAnalysisResult(
        tickers=list(tickers_hint or []),
        filing_types=["10-K", "10-Q"],
        sections=[],
        date_from=None,
        query_variants=[query],
        original_query=query,
    )


async def analyze_query(
    query: str,
    tickers_hint: list[str] | None = None,
    filing_types_hint: list[str] | None = None,
) -> QueryAnalysisResult:
    """Use Claude Haiku to extract metadata and generate query variants.

    Falls back to a minimal result if the LLM response is unparseable.
    """
    llm = get_llm_haiku()
    try:
        response = await llm.ainvoke([("human", _PROMPT.format(query=query))])
        data = _extract_json(response.content)
    except Exception as exc:
        logger.warning("Query analysis failed (%s) — using fallback", exc)
        return _fallback(query, tickers_hint)

    # Merge hints: keep LLM tickers + add any hints not already present
    tickers = data.get("tickers") or []
    if tickers_hint:
        for t in tickers_hint:
            if t not in tickers:
                tickers.append(t)

    return QueryAnalysisResult(
        tickers=tickers,
        filing_types=data.get("filing_types") or (filing_types_hint or ["10-K", "10-Q"]),
        sections=data.get("sections") or [],
        date_from=data.get("date_from"),
        query_variants=data.get("query_variants") or [query],
        original_query=query,
    )
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_query_analysis.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/retrieval/__init__.py \
        backend/app/services/agentic/retrieval/query_analysis.py \
        backend/tests/agentic/retrieval/__init__.py \
        backend/tests/agentic/retrieval/test_query_analysis.py
git commit -m "feat(retrieval): Stage 1 — query analysis with Haiku + multi-query expansion"
```

---

## Task 3: Stage 2 — HyDE

**Files:**
- Create: `backend/app/services/agentic/retrieval/hyde.py`
- Create: `backend/tests/agentic/retrieval/test_hyde.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/agentic/retrieval/test_hyde.py`:

```python
"""Tests for Stage 2: Hypothetical Document Embeddings (HyDE)."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_generate_hypothetical_document_returns_string():
    """generate_hypothetical_document() returns non-empty string from Haiku."""
    hypo_text = (
        "Apple faces significant supply chain concentration risk with approximately "
        "19% of revenue from China-based manufacturing operations. Foxconn's Zhengzhou "
        "facility produces an estimated 85% of iPhone units globally."
    )
    mock_response = MagicMock()
    mock_response.content = hypo_text

    with patch("app.services.agentic.retrieval.hyde.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.hyde import generate_hypothetical_document

        result = await generate_hypothetical_document("Apple China supply chain risk")

    assert isinstance(result, str)
    assert len(result) > 50


@pytest.mark.asyncio
async def test_get_hyde_embedding_returns_1536_dim_vector():
    """get_hyde_embedding() embeds the hypothetical doc with Titan v2 (1536d)."""
    mock_vector = [0.01] * 1536
    hypo_text = "Hypothetical document about supply chain risks."
    mock_response = MagicMock()
    mock_response.content = hypo_text

    with patch("app.services.agentic.retrieval.hyde.get_llm_haiku") as mock_haiku_fn, \
         patch("app.services.agentic.retrieval.hyde.embed_query") as mock_embed:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=mock_response)
        mock_haiku_fn.return_value = mock_llm
        mock_embed.return_value = mock_vector

        from app.services.agentic.retrieval.hyde import get_hyde_embedding

        vec = await get_hyde_embedding("Apple China supply chain risk")

    assert len(vec) == 1536
    assert vec[0] == pytest.approx(0.01)


@pytest.mark.asyncio
async def test_get_hyde_embedding_falls_back_on_error():
    """get_hyde_embedding() returns None when Haiku call fails."""
    with patch("app.services.agentic.retrieval.hyde.get_llm_haiku") as mock_haiku_fn:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(side_effect=Exception("Bedrock timeout"))
        mock_haiku_fn.return_value = mock_llm

        from app.services.agentic.retrieval.hyde import get_hyde_embedding

        result = await get_hyde_embedding("any query")

    assert result is None
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_hyde.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Create hyde.py**

Create `backend/app/services/agentic/retrieval/hyde.py`:

```python
"""Stage 2 — Hypothetical Document Embeddings (HyDE).

Generates a hypothetical answer to the query using Claude Haiku,
then embeds it with Titan v2. The resulting vector captures the
semantic space of answers, not just the question.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.agentic.bedrock_client import embed_query, get_llm_haiku

logger = logging.getLogger(__name__)

_HYDE_PROMPT = """\
You are a financial analyst. Write a short excerpt (150–200 words) from a hypothetical \
SEC filing section that would directly answer the following question.

Write as if it were real text from a 10-K or 10-Q filing. Use specific numbers \
and financial language. Do NOT add any preamble — start directly with the document text.

Question: {query}"""


async def generate_hypothetical_document(query: str) -> str:
    """Use Claude Haiku to produce a hypothetical SEC filing excerpt for the query."""
    llm = get_llm_haiku()
    response = await llm.ainvoke([("human", _HYDE_PROMPT.format(query=query))])
    return response.content


async def get_hyde_embedding(query: str) -> list[float] | None:
    """Generate hypothetical document and embed it with Titan v2.

    Returns 1536-dim vector, or None if Haiku/Bedrock call fails.
    """
    try:
        hypo_doc = await generate_hypothetical_document(query)
        loop = asyncio.get_running_loop()
        vector = await loop.run_in_executor(None, embed_query, hypo_doc)
        return vector
    except Exception as exc:
        logger.warning("HyDE failed for query %r: %s", query[:60], exc)
        return None
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_hyde.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/retrieval/hyde.py \
        backend/tests/agentic/retrieval/test_hyde.py
git commit -m "feat(retrieval): Stage 2 — HyDE hypothetical document embedding"
```

---

## Task 4: Stage 3 — Hybrid Search + RRF Fusion

**Files:**
- Create: `backend/app/services/agentic/retrieval/hybrid_search.py`
- Create: `backend/tests/agentic/retrieval/test_hybrid_search.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/agentic/retrieval/test_hybrid_search.py`:

```python
"""Tests for Stage 3: Hybrid Search + RRF Fusion."""
import pytest
from unittest.mock import MagicMock, patch

from app.services.agentic.retrieval.query_analysis import QueryAnalysisResult


def _make_qr(
    tickers=None, sections=None, query_variants=None, date_from=None
) -> QueryAnalysisResult:
    return QueryAnalysisResult(
        tickers=tickers or ["AAPL"],
        filing_types=["10-K"],
        sections=sections or ["Risk Factors"],
        date_from=date_from,
        query_variants=query_variants or ["Apple supply chain risk"],
        original_query="Apple supply chain risk",
    )


def _make_scored_point(chunk_id: str, score: float, parent_id: str = "parent-1") -> MagicMock:
    p = MagicMock()
    p.id = chunk_id
    p.score = score
    p.payload = {
        "chunk_id":        chunk_id,
        "parent_chunk_id": parent_id,
        "text":            f"Text for {chunk_id}",
        "ticker":          "AAPL",
        "company_name":    "Apple Inc.",
        "filing_type":     "10-K",
        "filed_date":      "2024-11-01",
        "fiscal_year":     2024,
        "section":         "Risk Factors",
        "item_number":     "1A",
    }
    return p


def test_rrf_fusion_merges_and_deduplicates():
    """rrf_fusion() combines two ranked lists, deduplicates by chunk_id, returns by score."""
    from app.services.agentic.retrieval.hybrid_search import SearchResult, rrf_fusion

    r_a = SearchResult(
        chunk_id="c1", parent_chunk_id="p1", text="text1", score=0.9,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", item_number="1A",
    )
    r_b = SearchResult(
        chunk_id="c2", parent_chunk_id="p1", text="text2", score=0.8,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", item_number="1A",
    )
    # c1 appears in both lists (duplicate), c2 only in second
    merged = rrf_fusion([[r_a, r_b], [r_b, r_a]])
    ids = [r.chunk_id for r in merged]
    # c1 and c2 each appear exactly once
    assert ids.count("c1") == 1
    assert ids.count("c2") == 1


def test_rrf_fusion_top_ranked_chunk_has_higher_score():
    """rrf_fusion() assigns higher score to chunk ranked first in more lists."""
    from app.services.agentic.retrieval.hybrid_search import SearchResult, rrf_fusion

    def _r(cid: str) -> SearchResult:
        return SearchResult(
            chunk_id=cid, parent_chunk_id="p", text="t", score=0.5,
            ticker="AAPL", company_name="Apple", filing_type="10-K",
            filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors", item_number="1A",
        )

    # c1 ranked #1 in both lists; c2 ranked #2 in both
    merged = rrf_fusion([[_r("c1"), _r("c2")], [_r("c1"), _r("c2")]])
    assert merged[0].chunk_id == "c1"
    assert merged[0].score > merged[1].score


@pytest.mark.asyncio
async def test_hybrid_search_calls_qdrant_three_times():
    """hybrid_search() fires dense + sparse + section-targeted queries."""
    qr = _make_qr()

    mock_point = _make_scored_point("c1", 0.9)
    mock_response = MagicMock()
    mock_response.points = [mock_point]

    with patch("app.services.agentic.retrieval.hybrid_search._qdrant_client") as mock_qd, \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0], values=[0.9])]):
        mock_qd.return_value.query_points.return_value = mock_response

        from app.services.agentic.retrieval.hybrid_search import hybrid_search

        results = await hybrid_search(qr, hyde_embedding=None, top_k=50)

    # 3 search types (dense, sparse, section) per query variant
    num_variants = len(qr.query_variants)
    assert mock_qd.return_value.query_points.call_count == 3 * num_variants


@pytest.mark.asyncio
async def test_hybrid_search_returns_search_results():
    """hybrid_search() returns list[SearchResult] with required fields."""
    qr = _make_qr()

    mock_point = _make_scored_point("c1", 0.9)
    mock_response = MagicMock()
    mock_response.points = [mock_point]

    with patch("app.services.agentic.retrieval.hybrid_search._qdrant_client") as mock_qd, \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0], values=[0.9])]):
        mock_qd.return_value.query_points.return_value = mock_response

        from app.services.agentic.retrieval.hybrid_search import SearchResult, hybrid_search

        results = await hybrid_search(qr, hyde_embedding=None)

    assert len(results) > 0
    assert isinstance(results[0], SearchResult)
    assert results[0].chunk_id == "c1"
    assert results[0].ticker == "AAPL"
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_hybrid_search.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Create hybrid_search.py**

Create `backend/app/services/agentic/retrieval/hybrid_search.py`:

```python
"""Stage 3 — Hybrid Search + RRF Fusion.

Runs three parallel Qdrant queries per query variant:
  1. Dense  — Titan v2 semantic similarity, metadata-filtered
  2. Sparse — BM25 keyword matching
  3. Section-targeted — Dense, section-filtered, cross-company

All results merged via Reciprocal Rank Fusion: score = Σ 1/(60 + rank).
Top 50 unique chunks returned to reranker.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue, SparseVector

from app.services.agentic.bedrock_client import embed_query
from app.services.agentic.ingestion.indexer import (
    CHUNKS_COLLECTION,
    DENSE_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
    _qdrant_client,
)
from app.services.agentic.sparse_encoder import encode_sparse
from .query_analysis import QueryAnalysisResult

logger = logging.getLogger(__name__)

RRF_K = 60  # RRF constant; 60 is standard


@dataclass
class SearchResult:
    chunk_id:        str
    parent_chunk_id: str
    text:            str
    score:           float
    ticker:          str
    company_name:    str
    filing_type:     str
    filed_date:      str
    fiscal_year:     int
    section:         str
    item_number:     str


def _build_metadata_filter(
    tickers: list[str],
    filing_types: list[str],
    date_from: str | None,
    section: str | None = None,
) -> Filter | None:
    conditions = []
    if tickers:
        conditions.append(FieldCondition(key="ticker", match=MatchAny(any=tickers)))
    if filing_types:
        conditions.append(FieldCondition(key="filing_type", match=MatchAny(any=filing_types)))
    if section:
        conditions.append(FieldCondition(key="section", match=MatchValue(value=section)))
    # date_from: filed_date is stored as "YYYY-MM-DD" string; range filter not used here
    # (keep simple — complex date filtering via payload index added in later tasks if needed)
    return Filter(must=conditions) if conditions else None


def _point_to_result(point) -> SearchResult:
    p = point.payload or {}
    return SearchResult(
        chunk_id=        p.get("chunk_id", str(point.id)),
        parent_chunk_id= p.get("parent_chunk_id", ""),
        text=            p.get("text", ""),
        score=           point.score,
        ticker=          p.get("ticker", ""),
        company_name=    p.get("company_name", ""),
        filing_type=     p.get("filing_type", ""),
        filed_date=      p.get("filed_date", ""),
        fiscal_year=     int(p.get("fiscal_year", 0)),
        section=         p.get("section", ""),
        item_number=     p.get("item_number", ""),
    )


def rrf_fusion(
    all_ranked_lists: list[list[SearchResult]],
    k: int = RRF_K,
) -> list[SearchResult]:
    """Merge multiple ranked result lists via Reciprocal Rank Fusion.

    score = Σ 1 / (k + rank)  where rank is 1-indexed.
    Returns results sorted by descending RRF score, deduplicated by chunk_id.
    """
    scores:  dict[str, float]        = {}
    chunks:  dict[str, SearchResult] = {}

    for ranked_list in all_ranked_lists:
        for rank_0, result in enumerate(ranked_list):
            cid = result.chunk_id
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank_0 + 1)
            chunks[cid] = result

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [
        SearchResult(**{**vars(chunks[cid]), "score": scores[cid]})
        for cid in sorted_ids
    ]


def _dense_search(
    query_vec: list[float],
    metadata_filter: Filter | None,
    limit: int,
) -> list[SearchResult]:
    """Synchronous dense ANN search (called via run_in_executor)."""
    client = _qdrant_client()
    resp = client.query_points(
        collection_name=CHUNKS_COLLECTION,
        query=query_vec,
        using=DENSE_VECTOR_NAME,
        query_filter=metadata_filter,
        limit=limit,
        with_payload=True,
    )
    return [_point_to_result(p) for p in resp.points]


def _sparse_search(
    sparse_vec: SparseVector,
    metadata_filter: Filter | None,
    limit: int,
) -> list[SearchResult]:
    """Synchronous BM25 sparse search (called via run_in_executor)."""
    client = _qdrant_client()
    resp = client.query_points(
        collection_name=CHUNKS_COLLECTION,
        query=sparse_vec,
        using=SPARSE_VECTOR_NAME,
        query_filter=metadata_filter,
        limit=limit,
        with_payload=True,
    )
    return [_point_to_result(p) for p in resp.points]


async def hybrid_search(
    query_result: QueryAnalysisResult,
    hyde_embedding: list[float] | None,
    top_k: int = 50,
) -> list[SearchResult]:
    """Run dense + sparse + section-targeted searches and RRF-fuse results.

    For each query variant, fires 3 parallel Qdrant queries.
    All results merged and top_k unique chunks returned.
    """
    loop = asyncio.get_running_loop()
    all_ranked_lists: list[list[SearchResult]] = []

    # Collect coroutines for all variants
    tasks = []
    for variant in query_result.query_variants:
        tasks.append(_search_one_variant(
            variant,
            query_result,
            hyde_embedding,
            top_k,
            loop,
        ))

    variant_results = await asyncio.gather(*tasks, return_exceptions=True)

    for vr in variant_results:
        if isinstance(vr, Exception):
            logger.warning("Search variant failed: %s", vr)
            continue
        all_ranked_lists.extend(vr)

    if not all_ranked_lists:
        return []

    merged = rrf_fusion(all_ranked_lists)
    return merged[:top_k]


async def _search_one_variant(
    variant: str,
    qr: QueryAnalysisResult,
    hyde_embedding: list[float] | None,
    top_k: int,
    loop: asyncio.AbstractEventLoop,
) -> list[list[SearchResult]]:
    """Run the 3 search types for a single query variant. Returns 3 ranked lists."""
    # 1) Embed the query variant (use HyDE vector for dense if available, else embed variant)
    dense_vec = await loop.run_in_executor(None, embed_query, variant)
    if hyde_embedding:
        # Average the variant embedding and HyDE embedding
        dense_vec = [(a + b) / 2 for a, b in zip(dense_vec, hyde_embedding)]

    # 2) Sparse encoding
    sparse_vecs = await loop.run_in_executor(None, encode_sparse, [variant])
    sparse_vec  = sparse_vecs[0] if sparse_vecs else None

    # 3) Build metadata filter (ticker + filing_type filtered for dense/sparse)
    meta_filter = _build_metadata_filter(
        tickers=qr.tickers,
        filing_types=qr.filing_types,
        date_from=qr.date_from,
    )

    # 4) Section-targeted filter (uses sections from query analysis, no ticker filter)
    section_filter = None
    if qr.sections:
        section_filter = _build_metadata_filter(
            tickers=[],  # cross-company
            filing_types=qr.filing_types,
            date_from=qr.date_from,
            section=qr.sections[0],  # primary section
        )

    # 5) Run all 3 searches concurrently
    coros = [
        loop.run_in_executor(None, _dense_search, dense_vec, meta_filter, top_k),
        loop.run_in_executor(None, _dense_search, dense_vec, section_filter, top_k // 2),
    ]
    if sparse_vec is not None:
        coros.append(loop.run_in_executor(None, _sparse_search, sparse_vec, meta_filter, top_k))

    results = await asyncio.gather(*coros, return_exceptions=True)

    ranked_lists = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning("Qdrant search failed: %s", r)
        elif r:
            ranked_lists.append(r)

    return ranked_lists
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_hybrid_search.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/retrieval/hybrid_search.py \
        backend/tests/agentic/retrieval/test_hybrid_search.py
git commit -m "feat(retrieval): Stage 3 — hybrid search (dense+sparse+RRF fusion)"
```

---

## Task 5: Stage 4 — Cohere Reranker

**Files:**
- Create: `backend/app/services/agentic/retrieval/reranker.py`
- Create: `backend/tests/agentic/retrieval/test_reranker.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/agentic/retrieval/test_reranker.py`:

```python
"""Tests for Stage 4: Cohere Reranker."""
import pytest
from unittest.mock import patch

from app.services.agentic.retrieval.hybrid_search import SearchResult


def _make_result(cid: str, text: str, score: float = 0.5) -> SearchResult:
    return SearchResult(
        chunk_id=cid, parent_chunk_id="p1", text=text, score=score,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024,
        section="Risk Factors", item_number="1A",
    )


@pytest.mark.asyncio
async def test_rerank_results_returns_top_n():
    """rerank_results() returns at most top_n SearchResults."""
    results = [_make_result(f"c{i}", f"text {i}") for i in range(5)]

    with patch("app.services.agentic.retrieval.reranker.rerank") as mock_rerank:
        mock_rerank.return_value = [
            {"index": 2, "score": 0.95},
            {"index": 0, "score": 0.88},
            {"index": 4, "score": 0.72},
        ]

        from app.services.agentic.retrieval.reranker import rerank_results

        reranked = await rerank_results("Apple China risk", results, top_n=3)

    assert len(reranked) == 3


@pytest.mark.asyncio
async def test_rerank_results_score_is_updated():
    """rerank_results() replaces original scores with Cohere relevance scores."""
    results = [_make_result("c0", "text0", score=0.1)]

    with patch("app.services.agentic.retrieval.reranker.rerank") as mock_rerank:
        mock_rerank.return_value = [{"index": 0, "score": 0.92}]

        from app.services.agentic.retrieval.reranker import rerank_results

        reranked = await rerank_results("Apple China risk", results, top_n=1)

    assert reranked[0].score == pytest.approx(0.92)


@pytest.mark.asyncio
async def test_rerank_results_preserves_order_by_score():
    """rerank_results() returns results sorted by descending Cohere score."""
    results = [_make_result(f"c{i}", f"text {i}") for i in range(3)]

    with patch("app.services.agentic.retrieval.reranker.rerank") as mock_rerank:
        mock_rerank.return_value = [
            {"index": 1, "score": 0.95},
            {"index": 0, "score": 0.80},
            {"index": 2, "score": 0.60},
        ]

        from app.services.agentic.retrieval.reranker import rerank_results

        reranked = await rerank_results("query", results, top_n=3)

    assert reranked[0].chunk_id == "c1"
    assert reranked[1].chunk_id == "c0"
    assert reranked[2].chunk_id == "c2"


@pytest.mark.asyncio
async def test_rerank_results_handles_empty_input():
    """rerank_results() returns empty list when given empty input."""
    from app.services.agentic.retrieval.reranker import rerank_results
    result = await rerank_results("query", [], top_n=10)
    assert result == []


@pytest.mark.asyncio
async def test_rerank_results_falls_back_on_cohere_error():
    """rerank_results() returns original results (truncated) on Cohere failure."""
    results = [_make_result(f"c{i}", f"text {i}", score=float(i)) for i in range(5)]

    with patch("app.services.agentic.retrieval.reranker.rerank",
               side_effect=Exception("Cohere API error")):
        from app.services.agentic.retrieval.reranker import rerank_results
        reranked = await rerank_results("query", results, top_n=3)

    assert len(reranked) == 3
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_reranker.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Create reranker.py**

Create `backend/app/services/agentic/retrieval/reranker.py`:

```python
"""Stage 4 — Cross-Encoder Reranking via Cohere.

Reranks top-50 hybrid-search results to top-10 using Cohere Rerank v3.
Falls back to returning the original list (truncated to top_n) on failure.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.agentic.bedrock_client import rerank
from .hybrid_search import SearchResult

logger = logging.getLogger(__name__)


async def rerank_results(
    query: str,
    results: list[SearchResult],
    top_n: int = 10,
) -> list[SearchResult]:
    """Rerank results using Cohere Rerank v3.

    Args:
        query:   The original user query string.
        results: Candidates from hybrid search (up to 50).
        top_n:   Number of results to return.

    Returns:
        top_n SearchResults with scores updated to Cohere relevance scores,
        sorted by descending score.
        Falls back to original results[:top_n] on Cohere failure.
    """
    if not results:
        return []

    texts = [r.text for r in results]

    try:
        loop = asyncio.get_running_loop()
        ranked = await loop.run_in_executor(None, rerank, query, texts, top_n)
    except Exception as exc:
        logger.warning("Cohere rerank failed (%s) — using original order", exc)
        return results[:top_n]

    reranked: list[SearchResult] = []
    for item in ranked:
        original = results[item["index"]]
        reranked.append(
            SearchResult(**{**vars(original), "score": item["score"]})
        )

    # Return sorted by descending score (Cohere already sorts, but enforce)
    reranked.sort(key=lambda r: r.score, reverse=True)
    return reranked
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_reranker.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/retrieval/reranker.py \
        backend/tests/agentic/retrieval/test_reranker.py
git commit -m "feat(retrieval): Stage 4 — Cohere reranking top-50 → top-10"
```

---

## Task 6: Stage 5 — Parent-Child Expansion + Citations

**Files:**
- Create: `backend/app/services/agentic/retrieval/parent_child.py`
- Create: `backend/tests/agentic/retrieval/test_parent_child.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/agentic/retrieval/test_parent_child.py`:

```python
"""Tests for Stage 5: Parent-Child Expansion."""
import pytest
import uuid
from unittest.mock import MagicMock, patch

from app.services.agentic.retrieval.hybrid_search import SearchResult


def _make_result(
    chunk_id: str = "child-001",
    parent_chunk_id: str = "parent-001",
    ticker: str = "AAPL",
    filed_date: str = "2024-11-01",
    fiscal_year: int = 2024,
    section: str = "Risk Factors",
) -> SearchResult:
    return SearchResult(
        chunk_id=chunk_id, parent_chunk_id=parent_chunk_id,
        text="Child text about supply chain.",
        score=0.92,
        ticker=ticker, company_name="Apple Inc.", filing_type="10-K",
        filed_date=filed_date, fiscal_year=fiscal_year,
        section=section, item_number="1A",
    )


def _make_parent_record(chunk_id: str, text: str, ticker: str = "AAPL") -> MagicMock:
    parent_qdrant_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_id))
    rec = MagicMock()
    rec.id = parent_qdrant_id
    rec.payload = {
        "chunk_id":  chunk_id,
        "text":      text,
        "ticker":    ticker,
        "section":   "Risk Factors",
        "filed_date": "2024-11-01",
    }
    return rec


@pytest.mark.asyncio
async def test_expand_to_parents_fetches_parent_text():
    """expand_to_parents() returns parent section text, not child snippet text."""
    child  = _make_result()
    parent_text = "Full parent section: Apple faces concentrated supply chain risks. " * 10

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = [
            _make_parent_record("parent-001", parent_text)
        ]

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child])

    assert len(chunks) == 1
    assert chunks[0].text == parent_text


@pytest.mark.asyncio
async def test_expand_to_parents_citation_format():
    """expand_to_parents() attaches correctly formatted citation label."""
    child = _make_result(ticker="AAPL", filed_date="2024-11-01", section="Risk Factors")

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = [
            _make_parent_record("parent-001", "Parent text.")
        ]

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child])

    # Expected: "[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]"
    label = chunks[0].citation_label
    assert "AAPL" in label
    assert "10-K" in label
    assert "2024" in label
    assert "Risk Factors" in label
    assert "2024-11-01" in label


@pytest.mark.asyncio
async def test_expand_to_parents_falls_back_to_child_text():
    """expand_to_parents() uses child text when parent not found in Qdrant."""
    child = _make_result()

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = []  # parent not found

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child])

    assert len(chunks) == 1
    assert chunks[0].text == child.text


@pytest.mark.asyncio
async def test_expand_to_parents_deduplicates_parent_id():
    """expand_to_parents() fetches each unique parent once even if multiple children share it."""
    child1 = _make_result("child-001", "parent-001")
    child2 = _make_result("child-002", "parent-001")  # same parent

    with patch("app.services.agentic.retrieval.parent_child._qdrant_client") as mock_qd:
        mock_qd.return_value.retrieve.return_value = [
            _make_parent_record("parent-001", "Shared parent text.")
        ]

        from app.services.agentic.retrieval.parent_child import expand_to_parents

        chunks = await expand_to_parents([child1, child2])

    # retrieve() should be called once (batched), not twice
    assert mock_qd.return_value.retrieve.call_count == 1
    assert len(chunks) == 2
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_parent_child.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Create parent_child.py**

Create `backend/app/services/agentic/retrieval/parent_child.py`:

```python
"""Stage 5 — Parent-Child Expansion and Citation Assembly.

For each top-10 child chunk from the reranker:
  1. Compute the Qdrant point ID for its parent_chunk_id
  2. Batch-fetch all unique parents from sec_filings_parents
  3. Return full parent section text with structured citation

Falls back to child text when parent is not found.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass

from app.services.agentic.ingestion.indexer import PARENTS_COLLECTION, _qdrant_client
from .hybrid_search import SearchResult

logger = logging.getLogger(__name__)


@dataclass
class ChunkWithCitation:
    text:          str
    citation_label: str
    ticker:        str
    company_name:  str
    filing_type:   str
    filed_date:    str
    fiscal_year:   int
    section:       str
    score:         float


def _parent_qdrant_id(parent_chunk_id: str) -> str:
    """Compute the Qdrant point ID for a parent chunk (must match indexer.py)."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, parent_chunk_id))


def _build_citation(source_n: int, result: SearchResult) -> str:
    return (
        f"[Source {source_n}: {result.ticker} {result.filing_type} "
        f"{result.fiscal_year}, {result.section} | Filed: {result.filed_date}]"
    )


async def expand_to_parents(results: list[SearchResult]) -> list[ChunkWithCitation]:
    """Fetch parent sections and attach citations for each reranked child.

    Args:
        results: Top-N reranked SearchResult objects.

    Returns:
        ChunkWithCitation list, same length as results, same order.
        Text is the full parent section (up to 4096 tokens).
    """
    if not results:
        return []

    # Deduplicate parent IDs for a single batched Qdrant retrieve call
    unique_parent_ids = list({r.parent_chunk_id for r in results if r.parent_chunk_id})
    qdrant_ids = [_parent_qdrant_id(pid) for pid in unique_parent_ids]

    # Batch fetch parents
    loop = asyncio.get_running_loop()
    try:
        records = await loop.run_in_executor(
            None,
            lambda: _qdrant_client().retrieve(
                collection_name=PARENTS_COLLECTION,
                ids=qdrant_ids,
                with_payload=True,
                with_vectors=False,
            ),
        )
    except Exception as exc:
        logger.warning("Parent fetch failed (%s) — falling back to child text", exc)
        records = []

    # Build lookup: parent_chunk_id → full text
    parent_text_by_id: dict[str, str] = {}
    for rec in records:
        payload = rec.payload or {}
        pid = payload.get("chunk_id", "")
        if pid:
            parent_text_by_id[pid] = payload.get("text", "")

    # Assemble results
    chunks: list[ChunkWithCitation] = []
    for idx, result in enumerate(results, start=1):
        parent_text = parent_text_by_id.get(result.parent_chunk_id, "")
        text = parent_text if parent_text else result.text
        chunks.append(
            ChunkWithCitation(
                text=           text,
                citation_label= _build_citation(idx, result),
                ticker=         result.ticker,
                company_name=   result.company_name,
                filing_type=    result.filing_type,
                filed_date=     result.filed_date,
                fiscal_year=    result.fiscal_year,
                section=        result.section,
                score=          result.score,
            )
        )

    return chunks
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_parent_child.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/retrieval/parent_child.py \
        backend/tests/agentic/retrieval/test_parent_child.py
git commit -m "feat(retrieval): Stage 5 — parent-child expansion + citation assembly"
```

---

## Task 7: RAG Tool — Public `search_sec_filings` API

**Files:**
- Create: `backend/app/services/agentic/tools/__init__.py`
- Create: `backend/app/services/agentic/tools/rag_tool.py`
- Create: `backend/tests/agentic/retrieval/test_rag_tool.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/agentic/retrieval/test_rag_tool.py`:

```python
"""Tests for the public search_sec_filings RAG tool."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.agentic.retrieval.query_analysis import QueryAnalysisResult
from app.services.agentic.retrieval.hybrid_search import SearchResult
from app.services.agentic.retrieval.parent_child import ChunkWithCitation


def _make_qr() -> QueryAnalysisResult:
    return QueryAnalysisResult(
        tickers=["AAPL"], filing_types=["10-K"], sections=["Risk Factors"],
        date_from=None,
        query_variants=["Apple China risk", "AAPL supply chain"],
        original_query="Apple China risk",
    )


def _make_search_result(cid: str = "c1") -> SearchResult:
    return SearchResult(
        chunk_id=cid, parent_chunk_id="p1", text="text", score=0.9,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024,
        section="Risk Factors", item_number="1A",
    )


def _make_chunk_with_citation() -> ChunkWithCitation:
    return ChunkWithCitation(
        text="Full parent section text about Apple supply chain risks in China.",
        citation_label="[Source 1: AAPL 10-K 2024, Risk Factors | Filed: 2024-11-01]",
        ticker="AAPL", company_name="Apple Inc.", filing_type="10-K",
        filed_date="2024-11-01", fiscal_year=2024, section="Risk Factors",
        score=0.92,
    )


@pytest.mark.asyncio
async def test_search_sec_filings_calls_all_5_stages():
    """search_sec_filings() invokes all 5 pipeline stages in order."""
    qr      = _make_qr()
    sr      = [_make_search_result()]
    cwc     = [_make_chunk_with_citation()]

    with patch("app.services.agentic.tools.rag_tool.analyze_query",
               new_callable=AsyncMock, return_value=qr) as mock_s1, \
         patch("app.services.agentic.tools.rag_tool.get_hyde_embedding",
               new_callable=AsyncMock, return_value=[0.1] * 1536) as mock_s2, \
         patch("app.services.agentic.tools.rag_tool.hybrid_search",
               new_callable=AsyncMock, return_value=sr) as mock_s3, \
         patch("app.services.agentic.tools.rag_tool.rerank_results",
               new_callable=AsyncMock, return_value=sr) as mock_s4, \
         patch("app.services.agentic.tools.rag_tool.expand_to_parents",
               new_callable=AsyncMock, return_value=cwc) as mock_s5:

        from app.services.agentic.tools.rag_tool import search_sec_filings

        result = await search_sec_filings.arun(
            query="Apple China risk",
            tickers=["AAPL"],
        )

    mock_s1.assert_awaited_once()
    mock_s2.assert_awaited_once()
    mock_s3.assert_awaited_once()
    mock_s4.assert_awaited_once()
    mock_s5.assert_awaited_once()


@pytest.mark.asyncio
async def test_search_sec_filings_returns_chunk_with_citations():
    """search_sec_filings() returns list of ChunkWithCitation."""
    qr  = _make_qr()
    sr  = [_make_search_result()]
    cwc = [_make_chunk_with_citation()]

    with patch("app.services.agentic.tools.rag_tool.analyze_query",
               new_callable=AsyncMock, return_value=qr), \
         patch("app.services.agentic.tools.rag_tool.get_hyde_embedding",
               new_callable=AsyncMock, return_value=None), \
         patch("app.services.agentic.tools.rag_tool.hybrid_search",
               new_callable=AsyncMock, return_value=sr), \
         patch("app.services.agentic.tools.rag_tool.rerank_results",
               new_callable=AsyncMock, return_value=sr), \
         patch("app.services.agentic.tools.rag_tool.expand_to_parents",
               new_callable=AsyncMock, return_value=cwc):

        from app.services.agentic.tools.rag_tool import search_sec_filings

        result = await search_sec_filings.arun(
            query="Apple China risk",
        )

    assert len(result) == 1
    assert result[0].citation_label.startswith("[Source 1:")


@pytest.mark.asyncio
async def test_search_sec_filings_returns_empty_on_no_results():
    """search_sec_filings() returns [] when hybrid_search finds nothing."""
    qr = _make_qr()

    with patch("app.services.agentic.tools.rag_tool.analyze_query",
               new_callable=AsyncMock, return_value=qr), \
         patch("app.services.agentic.tools.rag_tool.get_hyde_embedding",
               new_callable=AsyncMock, return_value=None), \
         patch("app.services.agentic.tools.rag_tool.hybrid_search",
               new_callable=AsyncMock, return_value=[]), \
         patch("app.services.agentic.tools.rag_tool.rerank_results",
               new_callable=AsyncMock, return_value=[]), \
         patch("app.services.agentic.tools.rag_tool.expand_to_parents",
               new_callable=AsyncMock, return_value=[]):

        from app.services.agentic.tools.rag_tool import search_sec_filings

        result = await search_sec_filings.arun(query="obscure query")

    assert result == []
```

- [ ] **Step 2: Run to verify failure**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_rag_tool.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Create tools/__init__.py and rag_tool.py**

Create `backend/app/services/agentic/tools/__init__.py` (empty file).

Create `backend/app/services/agentic/tools/rag_tool.py`:

```python
"""RAG Tool — search_sec_filings.

Public LangChain @tool that composes the 5-stage retrieval pipeline.
Called by LangGraph agents (Research, Comparison, Earnings, General, etc.).

Stages:
  1. Query Analysis  — Claude Haiku, multi-query expansion
  2. HyDE            — hypothetical doc embedding (parallel with Stage 1)
  3. Hybrid Search   — dense + sparse + section-targeted + RRF
  4. Reranking       — Cohere Rerank top-50 → top-10
  5. Parent-Child    — fetch full parent sections + citations
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from langchain_core.tools import tool

from app.services.agentic.retrieval.hybrid_search import hybrid_search
from app.services.agentic.retrieval.hyde import get_hyde_embedding
from app.services.agentic.retrieval.parent_child import ChunkWithCitation, expand_to_parents
from app.services.agentic.retrieval.query_analysis import analyze_query
from app.services.agentic.retrieval.reranker import rerank_results

logger = logging.getLogger(__name__)


@tool
async def search_sec_filings(
    query: str,
    tickers: Optional[list[str]] = None,
    filing_types: Optional[list[str]] = None,
    sections: Optional[list[str]] = None,
    date_from: Optional[str] = None,
    limit: int = 10,
) -> list[ChunkWithCitation]:
    """Search SEC filings corpus using 5-stage RAG pipeline.

    Args:
        query:        Natural language search query.
        tickers:      Optional list of stock tickers to filter (e.g. ["AAPL"]).
        filing_types: Optional list of filing types (e.g. ["10-K", "10-Q"]).
        sections:     Optional list of SEC sections (e.g. ["Risk Factors"]).
        date_from:    Optional ISO date string for earliest filing (e.g. "2023-01-01").
        limit:        Max number of results to return (default 10).

    Returns:
        List of ChunkWithCitation — full parent section text + structured citation.
    """
    # Stage 1 + 2 run concurrently (independent)
    stage1_task = asyncio.create_task(
        analyze_query(query, tickers_hint=tickers, filing_types_hint=filing_types)
    )
    stage2_task = asyncio.create_task(get_hyde_embedding(query))

    query_result, hyde_embedding = await asyncio.gather(stage1_task, stage2_task)

    # Apply any explicit parameter overrides
    if sections and not query_result.sections:
        query_result.sections = sections
    if date_from and not query_result.date_from:
        query_result.date_from = date_from

    # Stage 3: Hybrid search
    candidates = await hybrid_search(query_result, hyde_embedding, top_k=50)

    if not candidates:
        return []

    # Stage 4: Rerank
    reranked = await rerank_results(query, candidates, top_n=limit)

    if not reranked:
        return []

    # Stage 5: Expand to parents + citations
    chunks = await expand_to_parents(reranked)
    return chunks
```

- [ ] **Step 4: Run tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_rag_tool.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agentic/tools/__init__.py \
        backend/app/services/agentic/tools/rag_tool.py \
        backend/tests/agentic/retrieval/test_rag_tool.py
git commit -m "feat(retrieval): RAG tool — search_sec_filings wires all 5 stages"
```

---

## Task 8: Full Retrieval Integration Test

**Files:**
- Create: `backend/tests/agentic/retrieval/test_integration_retrieval.py`

- [ ] **Step 1: Write integration test**

Create `backend/tests/agentic/retrieval/test_integration_retrieval.py`:

```python
"""Integration test: full 5-stage retrieval pipeline with all external calls mocked.

Validates that data flows correctly from query string → ChunkWithCitation.
"""
import asyncio
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ── Shared fixtures ────────────────────────────────────────────────────────────

AAPL_CHUNK_ID     = "aapl-risk-child-001"
AAPL_PARENT_ID    = "aapl-risk-parent-001"
AAPL_PARENT_TEXT  = (
    "Apple Inc. (AAPL) faces significant geographic concentration risk with China "
    "representing approximately 19% of net sales. The company's primary manufacturing "
    "partner, Foxconn, operates its largest assembly facility in Zhengzhou, China. "
    "Disruptions to these operations could materially affect production capacity."
)

HAIKU_QA_JSON = """{
    "tickers": ["AAPL"],
    "filing_types": ["10-K"],
    "sections": ["Risk Factors"],
    "date_from": "2023-01-01",
    "query_variants": [
        "Apple China supply chain risk",
        "AAPL geographic revenue concentration",
        "Apple Foxconn manufacturing dependency"
    ]
}"""

HAIKU_HYDE_TEXT = (
    "Apple faces concentrated China manufacturing risk. Approximately 19% of net sales "
    "originate from Greater China. Primary supplier Foxconn's Zhengzhou plant produces "
    "an estimated 85% of global iPhone volume. Trade policy changes or geopolitical "
    "events could disrupt supply chains and impact financial results materially."
)


def _make_qdrant_point(chunk_id: str, parent_id: str, score: float = 0.85) -> MagicMock:
    p = MagicMock()
    p.id = str(uuid.uuid5(uuid.NAMESPACE_DNS, chunk_id))
    p.score = score
    p.payload = {
        "chunk_id":        chunk_id,
        "parent_chunk_id": parent_id,
        "text":            "Child chunk: Apple faces China manufacturing risk.",
        "ticker":          "AAPL",
        "company_name":    "Apple Inc.",
        "filing_type":     "10-K",
        "filed_date":      "2024-11-01",
        "fiscal_year":     2024,
        "section":         "Risk Factors",
        "item_number":     "1A",
    }
    return p


def _make_parent_record(parent_id: str, text: str) -> MagicMock:
    rec = MagicMock()
    rec.id = str(uuid.uuid5(uuid.NAMESPACE_DNS, parent_id))
    rec.payload = {
        "chunk_id":  parent_id,
        "text":      text,
        "ticker":    "AAPL",
        "section":   "Risk Factors",
        "filed_date": "2024-11-01",
    }
    return rec


# ── Integration test ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_retrieval_pipeline_end_to_end():
    """Complete pipeline: query → ChunkWithCitation with correct text and citation."""
    # Mock Haiku responses
    qa_response   = MagicMock(); qa_response.content   = HAIKU_QA_JSON
    hyde_response = MagicMock(); hyde_response.content = HAIKU_HYDE_TEXT

    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=[qa_response, hyde_response])

    # Mock Qdrant
    qdrant_point  = _make_qdrant_point(AAPL_CHUNK_ID, AAPL_PARENT_ID)
    search_resp   = MagicMock(); search_resp.points = [qdrant_point]
    parent_record = _make_parent_record(AAPL_PARENT_ID, AAPL_PARENT_TEXT)

    mock_client = MagicMock()
    mock_client.query_points.return_value = search_resp
    mock_client.retrieve.return_value     = [parent_record]

    # Mock Cohere rerank: index 0 → score 0.95
    cohere_rerank_result = [{"index": 0, "score": 0.95}]

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hyde.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hybrid_search._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.parent_child._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0, 3], values=[0.9, 0.5])]), \
         patch("app.services.agentic.retrieval.reranker.rerank",
               return_value=cohere_rerank_result):

        from app.services.agentic.tools.rag_tool import search_sec_filings

        results = await search_sec_filings.arun(
            query="What are Apple's biggest risks from China manufacturing?",
            tickers=["AAPL"],
        )

    assert len(results) >= 1

    top = results[0]
    assert top.text == AAPL_PARENT_TEXT         # parent text, not child snippet
    assert "AAPL" in top.citation_label
    assert "10-K" in top.citation_label
    assert "Risk Factors" in top.citation_label
    assert top.score == pytest.approx(0.95)


@pytest.mark.asyncio
async def test_pipeline_graceful_on_haiku_failure():
    """Pipeline completes even when Haiku fails — falls back to original query."""
    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=Exception("Bedrock throttled"))

    qdrant_point = _make_qdrant_point(AAPL_CHUNK_ID, AAPL_PARENT_ID)
    search_resp  = MagicMock(); search_resp.points = [qdrant_point]
    parent_rec   = _make_parent_record(AAPL_PARENT_ID, AAPL_PARENT_TEXT)

    mock_client = MagicMock()
    mock_client.query_points.return_value = search_resp
    mock_client.retrieve.return_value     = [parent_rec]

    with patch("app.services.agentic.retrieval.query_analysis.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hyde.get_llm_haiku",
               return_value=mock_llm), \
         patch("app.services.agentic.retrieval.hybrid_search._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.parent_child._qdrant_client",
               return_value=mock_client), \
         patch("app.services.agentic.retrieval.hybrid_search.embed_query",
               return_value=[0.1] * 1536), \
         patch("app.services.agentic.retrieval.hybrid_search.encode_sparse",
               return_value=[MagicMock(indices=[0], values=[0.8])]), \
         patch("app.services.agentic.retrieval.reranker.rerank",
               return_value=[{"index": 0, "score": 0.80}]):

        from app.services.agentic.tools.rag_tool import search_sec_filings

        results = await search_sec_filings.arun(
            query="Apple China risk",
            tickers=["AAPL"],
        )

    # Should not raise — fallback analysis should still allow search
    assert isinstance(results, list)
```

- [ ] **Step 2: Run integration tests → pass**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/retrieval/test_integration_retrieval.py -v
```

Expected: 2 passed.

- [ ] **Step 3: Run complete test suite**

```
cd /Users/yash/Downloads/QuantTrade-AI/backend
python -m pytest tests/agentic/ -v --tb=short
```

Expected: all agentic tests pass (31 from Plan 1 + ~25 new = ~56 total).

- [ ] **Step 4: Commit**

```bash
git add backend/tests/agentic/retrieval/test_integration_retrieval.py
git commit -m "test(retrieval): integration test — full 5-stage pipeline end-to-end"
```

---

## Self-Review Checklist

**Spec coverage:**
- Stage 1 (Query Analysis + multi-query): ✅ Task 2
- Stage 2 (HyDE): ✅ Task 3
- Stage 3 (Dense + Sparse + Section + RRF): ✅ Task 4
- Stage 4 (Cohere Rerank top-50→top-10): ✅ Task 5
- Stage 5 (Parent-Child expansion + citations): ✅ Task 6
- Public `search_sec_filings` tool: ✅ Task 7
- BM25 sparse vectors in Qdrant: ✅ Task 1
- Latency via parallel Stage 1+2: ✅ Task 7 (`asyncio.gather`)
- Citation format `[Source N: TICKER TYPE YEAR, Section | Filed: DATE]`: ✅ Task 6

**Type consistency:**
- `QueryAnalysisResult` defined in Task 2, used as input in Tasks 4, 7
- `SearchResult` defined in Task 4, used in Tasks 5, 6, 7
- `ChunkWithCitation` defined in Task 6, returned from Task 7
- All function signatures consistent across import chains

**No placeholders:** All code blocks are complete implementations.
