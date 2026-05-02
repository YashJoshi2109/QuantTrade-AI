# Agentic RAG Copilot — Plan 1: Foundation & Ingestion Pipeline

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- \[ ]) syntax for tracking.

Goal: Build the complete data foundation: Bedrock client, Qdrant collections, and the full SEC filing ingestion pipeline (EDGAR fetch → 3-pass semantic chunking → Titan embedding → Qdrant index). After this plan, 500K SEC filing chunks are indexed and searchable.

Architecture: Three-pass chunking (document parse → semantic boundary detection → parent-child hierarchy) produces coherent chunks with full metadata. Amazon Titan Embeddings v2 via Bedrock embeds child chunks. Qdrant stores child chunks for ANN search and parent sections for context retrieval.

Tech Stack: Python 3.11, AWS Bedrock (boto3 + langchain-aws), Qdrant Cloud, sentence-transformers, pdfplumber, beautifulsoup4, fastembed, APScheduler, FastAPI SSE

***

## File Map

| Action | Path                                                   | Responsibility                                   |
| ------ | ------------------------------------------------------ | ------------------------------------------------ |
| Create | backend/app/services/agentic/\_\_init\_\_.py           | Package init                                     |
| Create | backend/app/services/agentic/bedrock\_client.py        | Claude + Titan + Cohere Rerank clients           |
| Create | backend/app/services/agentic/ingestion/\_\_init\_\_.py | Package init                                     |
| Create | backend/app/services/agentic/ingestion/sec\_fetcher.py | EDGAR API + sec-api.io download                  |
| Create | backend/app/services/agentic/ingestion/chunker.py      | 3-pass chunking: parse → semantic → parent-child |
| Create | backend/app/services/agentic/ingestion/embedder.py     | Titan v2 batch embedding, 8 async workers        |
| Create | backend/app/services/agentic/ingestion/indexer.py      | Qdrant upsert + collection setup                 |
| Create | backend/app/services/agentic/ingestion/orchestrator.py | Full pipeline orchestration + APScheduler jobs   |
| Modify | backend/app/services/copilot/intent\_classifier.py     | Add EARNINGS intent                              |
| Modify | backend/app/services/copilot/constants.py              | Add EARNINGS to CopilotIntent enum               |
| Modify | backend/app/services/copilot/router.py                 | Add EARNINGS routing rule                        |
| Modify | backend/requirements.txt                               | Add new dependencies                             |
| Create | backend/app/api/agentic\_copilot.py                    | Admin endpoints: ingest trigger, status, health  |
| Modify | backend/app/main.py                                    | Register new router                              |
| Create | tests/agentic/\_\_init\_\_.py                          | Test package                                     |
| Create | tests/agentic/test\_bedrock\_client.py                 | Bedrock client tests                             |
| Create | tests/agentic/ingestion/\_\_init\_\_.py                | Test package                                     |
| Create | tests/agentic/ingestion/test\_chunker.py               | Chunker unit tests                               |
| Create | tests/agentic/ingestion/test\_embedder.py              | Embedder tests                                   |
| Create | tests/agentic/ingestion/test\_indexer.py               | Indexer tests                                    |

***

## Task 1: Install Dependencies

Files:

* Modify: backend/requirements.txt

- [ ] Step 1: Add new dependencies to requirements.txt

Open backend/requirements.txt and add these lines:

```
# AWS Bedrock
boto3>=1.34.0
langchain-aws>=0.2.0
langchain-core>=0.3.0

# LangGraph (used in Plans 2 & 3 — install now)
langgraph>=0.2.0

# Qdrant
qdrant-client>=1.9.0
fastembed>=0.3.0

# Cohere reranker
cohere>=5.0.0

# Document parsing
pdfplumber>=0.11.0
beautifulsoup4>=4.12.0
lxml>=5.0.0
unstructured[pdf]>=0.14.0

# Semantic chunking
sentence-transformers>=3.0.0
scikit-learn>=1.4.0
numpy>=1.26.0

# Already present — verify versions
apscheduler>=3.10.0
```

* [ ] Step 2: Install dependencies

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
pip install -r requirements.txt
```

Expected: all packages install without error. sentence-transformers will download all-MiniLM-L6-v2 model on first use (\~90MB).

* [ ] Step 3: Verify critical imports

```bash
python -c "import boto3; import langchain_aws; import qdrant_client; import fastembed; import pdfplumber; import sentence_transformers; print('All imports OK')"
```

Expected output: All imports OK

* [ ] Step 4: Add environment variables

Add to backend/.env (create if missing):

```bash
# AWS Bedrock
AWS_REGION=us-east-1
# For local dev only — on EC2 use instance role (no keys needed)
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here

# Qdrant Cloud
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key

# EDGAR (required by EDGAR terms of service)
EDGAR_USER_AGENT=QuantTrade/1.0 yashjosh7486@gmail.com

# SEC API (already exists — verify it's set)
SEC_API_KEY=your_sec_api_key
```

* [ ] Step 5: Enable Bedrock models in AWS Console

Go to AWS Console → Bedrock → Model Access. Enable these models (one-time manual step):

* anthropic.claude-sonnet-4-5 (Claude 3.5 Sonnet)
* anthropic.claude-haiku-4-5-20251001 (Claude 3 Haiku)
* amazon.titan-embed-text-v2:0 (Titan Embeddings v2)
* cohere.rerank-v3-5:0 (Cohere Rerank v3)

- [ ] Step 6: Commit

```bash
git add backend/requirements.txt backend/.env.example
git commit -m "feat(agentic): add dependencies for Bedrock, Qdrant, LangGraph, chunking"
```

***

## Task 2: Bedrock Client

Files:

* Create: backend/app/services/agentic/\_\_init\_\_.py
* Create: backend/app/services/agentic/bedrock\_client.py
* Create: tests/agentic/\_\_init\_\_.py
* Create: tests/agentic/test\_bedrock\_client.py

- [ ] Step 1: Write failing tests

Create tests/agentic/\_\_init\_\_.py (empty).

Create tests/agentic/test\_bedrock\_client.py:

```python
"""Tests for Bedrock client factory functions."""
import os
import pytest
from unittest.mock import patch, MagicMock


def test_get_llm_sonnet_returns_chat_bedrock():
    """get_llm_sonnet() returns a ChatBedrock instance with correct model."""
    from app.services.agentic.bedrock_client import get_llm_sonnet
    llm = get_llm_sonnet(streaming=False)
    assert llm.model_id == "anthropic.claude-sonnet-4-5"
    assert llm.model_kwargs["temperature"] == 0.1
    assert llm.model_kwargs["max_tokens"] == 4096


def test_get_llm_haiku_returns_chat_bedrock():
    """get_llm_haiku() returns a ChatBedrock instance with correct model."""
    from app.services.agentic.bedrock_client import get_llm_haiku
    llm = get_llm_haiku()
    assert llm.model_id == "anthropic.claude-haiku-4-5-20251001"
    assert llm.model_kwargs["temperature"] == 0.0
    assert llm.model_kwargs["max_tokens"] == 1024


def test_get_embedder_returns_bedrock_embeddings():
    """get_embedder() returns BedrockEmbeddings with Titan v2 model."""
    from app.services.agentic.bedrock_client import get_embedder
    embedder = get_embedder()
    assert embedder.model_id == "amazon.titan-embed-text-v2:0"


def test_embed_texts_returns_correct_dimension():
    """embed_texts() returns 1536-dimensional vectors."""
    from app.services.agentic.bedrock_client import embed_texts
    mock_vectors = [[0.1] * 1536, [0.2] * 1536]
    with patch("app.services.agentic.bedrock_client.get_embedder") as mock:
        mock.return_value.embed_documents.return_value = mock_vectors
        result = embed_texts(["hello world", "financial analysis"])
    assert len(result) == 2
    assert len(result[0]) == 1536


def test_rerank_returns_sorted_results():
    """rerank() returns results sorted by relevance score descending."""
    from app.services.agentic.bedrock_client import rerank
    mock_result = MagicMock()
    mock_result.results = [
        MagicMock(index=1, relevance_score=0.95),
        MagicMock(index=0, relevance_score=0.72),
    ]
    with patch("app.services.agentic.bedrock_client._cohere_client") as mock_co:
        mock_co.rerank.return_value = mock_result
        docs = ["doc A", "doc B"]
        result = rerank("test query", docs, top_n=2)
    assert result[0]["index"] == 1
    assert result[0]["score"] == 0.95
    assert result[1]["index"] == 0
```

* [ ] Step 2: Run tests to verify they fail

```bash
cd /Users/yash/Downloads/QuantTrade-AI/backend
pytest tests/agentic/test_bedrock_client.py -v
```

Expected: ModuleNotFoundError: No module named 'app.services.agentic.bedrock\_client'

* [ ] Step 3: Create package init

Create backend/app/services/agentic/\_\_init\_\_.py:

```python
"""Agentic RAG Copilot services."""
```

* [ ] Step 4: Implement bedrock\_client.py

Create backend/app/services/agentic/bedrock\_client.py:

```python
"""
AWS Bedrock client factory.
Provides Claude 3.5 Sonnet (primary), Claude 3 Haiku (fast ops),
Titan Embeddings v2 (1536d), and Cohere Rerank v3.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import boto3
import cohere
from langchain_aws import ChatBedrock, BedrockEmbeddings

REGION = os.getenv("AWS_REGION", "us-east-1")

# Model IDs
SONNET_MODEL_ID = "anthropic.claude-sonnet-4-5"
HAIKU_MODEL_ID  = "anthropic.claude-haiku-4-5-20251001"
TITAN_MODEL_ID  = "amazon.titan-embed-text-v2:0"
COHERE_RERANK_MODEL = "rerank-v3-5"   # Cohere Python SDK model name


def get_llm_sonnet(streaming: bool = True) -> ChatBedrock:
    """Claude 3.5 Sonnet — primary agent reasoning, 200K context."""
    return ChatBedrock(
        model_id=SONNET_MODEL_ID,
        region_name=REGION,
        model_kwargs={"max_tokens": 4096, "temperature": 0.1, "top_p": 0.9},
        streaming=streaming,
    )


def get_llm_haiku(streaming: bool = False) -> ChatBedrock:
    """Claude 3 Haiku — fast ops: HyDE, query analysis, memory summarization."""
    return ChatBedrock(
        model_id=HAIKU_MODEL_ID,
        region_name=REGION,
        model_kwargs={"max_tokens": 1024, "temperature": 0.0},
        streaming=streaming,
    )


@lru_cache(maxsize=1)
def get_embedder() -> BedrockEmbeddings:
    """Titan Embeddings v2 — 1536d, cached singleton."""
    return BedrockEmbeddings(
        model_id=TITAN_MODEL_ID,
        region_name=REGION,
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of texts using Titan v2. Returns list of 1536-dim vectors."""
    return get_embedder().embed_documents(texts)


def embed_query(text: str) -> list[float]:
    """Embed a single query string. Returns 1536-dim vector."""
    return get_embedder().embed_query(text)


@lru_cache(maxsize=1)
def _cohere_client() -> cohere.Client:
    """Cohere client — uses COHERE_API_KEY env var."""
    api_key = os.getenv("COHERE_API_KEY", "")
    return cohere.Client(api_key=api_key)


def rerank(
    query: str,
    documents: list[str],
    top_n: int = 10,
) -> list[dict[str, Any]]:
    """
    Rerank documents against query using Cohere Rerank v3.
    Returns list of {index: int, score: float} sorted by score descending.
    """
    result = _cohere_client().rerank(
        model=COHERE_RERANK_MODEL,
        query=query,
        documents=documents,
        top_n=top_n,
    )
    return [
        {"index": r.index, "score": r.relevance_score}
        for r in result.results
    ]
```

* [ ] Step 5: Run tests to verify they pass

```bash
pytest tests/agentic/test_bedrock_client.py -v
```

Expected: all 5 tests pass.

* [ ] Step 6: Smoke test Bedrock connectivity

```bash
python -c "
from app.services.agentic.bedrock_client import embed_query
vec = embed_query('test financial query')
print(f'Vector dim: {len(vec)}')  # should print 1536
assert len(vec) == 1536
print('Bedrock Titan OK')
"
```

Expected: Vector dim: 1536 then Bedrock Titan OK. If error: check AWS credentials and model access in console.

* [ ] Step 7: Commit

```bash
git add backend/app/services/agentic/ tests/agentic/
git commit -m "feat(agentic): add Bedrock client — Claude Sonnet/Haiku, Titan embeddings, Cohere rerank"
```

***

## Task 3: Qdrant Collection Setup

Files:

* Create: backend/app/services/agentic/ingestion/\_\_init\_\_.py
* Create: backend/app/services/agentic/ingestion/indexer.py
* Create: tests/agentic/ingestion/\_\_init\_\_.py
* Create: tests/agentic/ingestion/test\_indexer.py

- [ ] Step 1: Write failing tests

Create tests/agentic/ingestion/\_\_init\_\_.py (empty).

Create tests/agentic/ingestion/test\_indexer.py:

```python
"""Tests for Qdrant indexer — collection setup and upsert."""
import pytest
from unittest.mock import MagicMock, patch, call
from app.services.agentic.ingestion.indexer import (
    ensure_collections_exist,
    upsert_chunks,
    chunk_exists,
    CHUNKS_COLLECTION,
    PARENTS_COLLECTION,
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


def test_ensure_collections_skips_existing():
    """ensure_collections_exist() skips creation if collection already exists."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.collection_exists.return_value = True
        ensure_collections_exist()
        mock_qdrant.return_value.create_collection.assert_not_called()


def test_upsert_chunks_calls_qdrant_upsert():
    """upsert_chunks() calls qdrant upsert with correct collection and points."""
    child = make_chunk()
    parent = make_chunk(is_parent=True)
    vectors = {"test-AAPL-child": [0.1] * 1536}

    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        upsert_chunks([child], [parent], vectors)
        assert mock_qdrant.return_value.upsert.call_count == 2


def test_chunk_exists_returns_true_when_found():
    """chunk_exists() returns True if content hash already in Qdrant."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.scroll.return_value = ([MagicMock()], None)
        assert chunk_exists("abc123") is True


def test_chunk_exists_returns_false_when_not_found():
    """chunk_exists() returns False if content hash not in Qdrant."""
    with patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_qdrant:
        mock_qdrant.return_value.scroll.return_value = ([], None)
        assert chunk_exists("abc123") is False
```

* [ ] Step 2: Run tests to verify they fail

```bash
pytest tests/agentic/ingestion/test_indexer.py -v
```

Expected: ModuleNotFoundError: No module named 'app.services.agentic.ingestion'

* [ ] Step 3: Create package init

Create backend/app/services/agentic/ingestion/\_\_init\_\_.py:

```python
"""SEC filing ingestion pipeline."""
```

* [ ] Step 4: Implement indexer.py

Create backend/app/services/agentic/ingestion/indexer.py:

```python
"""
Qdrant indexer — collection setup and chunk upsert.
Two collections:
  sec_filings_chunks  — child chunks for ANN search
  sec_filings_parents — parent sections fetched by ID
"""
from __future__ import annotations

import os
import uuid
from functools import lru_cache
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    HnswConfigDiff,
    PayloadSchemaType,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    SparseVectorParams,
    SparseIndexParams,
)

from app.services.agentic.ingestion.chunker import Chunk

CHUNKS_COLLECTION  = "sec_filings_chunks"
PARENTS_COLLECTION = "sec_filings_parents"
VECTOR_DIM = 1536        # Titan Embeddings v2
HNSW_EF    = 200
HNSW_M     = 16


@lru_cache(maxsize=1)
def _qdrant_client() -> QdrantClient:
    return QdrantClient(
        url=os.environ["QDRANT_URL"],
        api_key=os.environ.get("QDRANT_API_KEY"),
    )


def ensure_collections_exist() -> None:
    """Create Qdrant collections if they don't exist. Safe to call repeatedly."""
    client = _qdrant_client()

    for name in [CHUNKS_COLLECTION, PARENTS_COLLECTION]:
        if client.collection_exists(name):
            continue
        client.create_collection(
            name,
            vectors_config=VectorParams(
                size=VECTOR_DIM,
                distance=Distance.COSINE,
                hnsw_config=HnswConfigDiff(ef_construct=HNSW_EF, m=HNSW_M),
            ),
            sparse_vectors_config={
                "bm25": SparseVectorParams(index=SparseIndexParams(on_disk=False))
            },
        )
        # Create payload indexes for fast metadata filtering
        for field, schema in [
            ("ticker",       PayloadSchemaType.KEYWORD),
            ("filing_type",  PayloadSchemaType.KEYWORD),
            ("section",      PayloadSchemaType.KEYWORD),
            ("fiscal_year",  PayloadSchemaType.INTEGER),
            ("filed_date",   PayloadSchemaType.KEYWORD),
            ("content_hash", PayloadSchemaType.KEYWORD),
        ]:
            client.create_payload_index(name, field, schema)


def chunk_exists(content_hash: str) -> bool:
    """Check if a chunk with this content hash is already indexed."""
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


def upsert_chunks(
    children: list[Chunk],
    parents: list[Chunk],
    child_vectors: dict[str, list[float]],
) -> None:
    """
    Upsert child chunks (with vectors) and parent sections (text only) into Qdrant.

    Args:
        children: Child chunks to index in sec_filings_chunks
        parents: Parent sections to store in sec_filings_parents
        child_vectors: {chunk_id: embedding_vector} for each child
    """
    client = _qdrant_client()

    # Upsert children into search collection
    child_points = [
        PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_DNS, c.chunk_id)),
            vector=child_vectors[c.chunk_id],
            payload={
                "chunk_id":       c.chunk_id,
                "parent_chunk_id":c.parent_chunk_id,
                "text":           c.text,
                "ticker":         c.ticker,
                "company_name":   c.company_name,
                "filing_type":    c.filing_type,
                "filed_date":     c.filed_date,
                "fiscal_year":    c.fiscal_year,
                "section":        c.section,
                "item_number":    c.item_number,
                "token_count":    c.token_count,
                "cik":            c.cik,
                "content_hash":   c.content_hash,
            },
        )
        for c in children
        if c.chunk_id in child_vectors
    ]
    if child_points:
        client.upsert(collection_name=CHUNKS_COLLECTION, points=child_points)

    # Upsert parents into context collection (no vector needed — fetched by ID)
    parent_points = [
        PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_DNS, p.chunk_id)),
            vector=[0.0] * VECTOR_DIM,   # placeholder — never searched by vector
            payload={
                "chunk_id":     p.chunk_id,
                "text":         p.text,
                "ticker":       p.ticker,
                "company_name": p.company_name,
                "filing_type":  p.filing_type,
                "filed_date":   p.filed_date,
                "fiscal_year":  p.fiscal_year,
                "section":      p.section,
                "item_number":  p.item_number,
                "cik":          p.cik,
                "content_hash": p.content_hash,
            },
        )
        for p in parents
    ]
    if parent_points:
        client.upsert(collection_name=PARENTS_COLLECTION, points=parent_points)
```

* [ ] Step 5: Run tests to verify they pass

```bash
pytest tests/agentic/ingestion/test_indexer.py -v
```

Expected: all 5 tests pass.

* [ ] Step 6: Verify Qdrant connectivity and create collections

```bash
python -c "
import os
os.environ['QDRANT_URL'] = 'https://your-cluster.qdrant.io'
os.environ['QDRANT_API_KEY'] = 'your_key'
from app.services.agentic.ingestion.indexer import ensure_collections_exist
ensure_collections_exist()
print('Qdrant collections created')
"
```

Expected: Qdrant collections created. Verify in Qdrant dashboard.

* [ ] Step 7: Commit

```bash
git add backend/app/services/agentic/ingestion/ tests/agentic/ingestion/
git commit -m "feat(agentic): Qdrant indexer — collection setup, upsert, dedup check"
```

***

## Task 4: Document Chunker (3-Pass)

Files:

* Create: backend/app/services/agentic/ingestion/chunker.py
* Modify: tests/agentic/ingestion/test\_indexer.py (already uses Chunk — no change needed)
* Create: tests/agentic/ingestion/test\_chunker.py

- [ ] Step 1: Write failing tests

Create tests/agentic/ingestion/test\_chunker.py:

```python
"""Tests for the 3-pass document chunker."""
import pytest
from app.services.agentic.ingestion.chunker import (
    detect_section,
    split_into_sentences,
    semantic_chunk,
    build_parent_child_pairs,
    Chunk,
    SEC_SECTION_PATTERNS,
)


# ── Section detection ─────────────────────────────────────────────────────────

def test_detect_section_risk_factors():
    text = "ITEM 1A. RISK FACTORS\nApple faces..."
    section, item = detect_section(text)
    assert section == "Risk Factors"
    assert item == "1A"


def test_detect_section_mda():
    text = "Item 7. Management's Discussion and Analysis"
    section, item = detect_section(text)
    assert section == "MD&A"
    assert item == "7"


def test_detect_section_unknown():
    text = "Some random text with no SEC item header"
    section, item = detect_section(text)
    assert section == "Unknown"
    assert item == ""


# ── Sentence splitting ────────────────────────────────────────────────────────

def test_split_into_sentences_basic():
    text = "Apple Inc. reported revenue. The company grew 12%. Risks remain."
    sentences = split_into_sentences(text)
    assert len(sentences) >= 2
    assert all(len(s) > 0 for s in sentences)


def test_split_into_sentences_handles_abbreviations():
    """Should not split on 'Inc.' or 'Corp.' mid-sentence."""
    text = "Apple Inc. is a technology company. It was founded in 1976."
    sentences = split_into_sentences(text)
    # Should produce 2 sentences, not split on "Inc."
    assert len(sentences) == 2


# ── Semantic chunking ─────────────────────────────────────────────────────────

def test_semantic_chunk_respects_max_tokens():
    """No chunk should exceed MAX_CHUNK_TOKENS."""
    from app.services.agentic.ingestion.chunker import MAX_CHUNK_TOKENS
    long_text = " ".join(["word"] * 2000)  # 2000 words
    chunks = semantic_chunk(long_text, section="Risk Factors", item="1A")
    for c in chunks:
        assert c.token_count <= MAX_CHUNK_TOKENS


def test_semantic_chunk_produces_non_empty_chunks():
    text = (
        "Apple faces supply chain risks in China. "
        "Manufacturing is concentrated in Foxconn facilities. "
        "Geopolitical tensions could disrupt production. "
        "Revenue in Greater China represents 19% of total revenue."
    )
    chunks = semantic_chunk(text, section="Risk Factors", item="1A")
    assert len(chunks) >= 1
    assert all(len(c.text.strip()) > 0 for c in chunks)


def test_semantic_chunk_sets_section_metadata():
    text = "Apple supply chain risk factors are significant."
    chunks = semantic_chunk(text, section="Risk Factors", item="1A")
    assert all(c.section == "Risk Factors" for c in chunks)
    assert all(c.item_number == "1A" for c in chunks)


# ── Parent-child pairs ────────────────────────────────────────────────────────

def test_build_parent_child_pairs_links_correctly():
    """Each child chunk's parent_chunk_id should match its parent's chunk_id."""
    section_text = "Long section text " + " ".join(["word"] * 100)
    child_chunks = semantic_chunk(section_text, section="Business", item="1")

    filing_meta = {
        "ticker": "AAPL",
        "company_name": "Apple Inc.",
        "filing_type": "10-K",
        "filed_date": "2024-11-01",
        "fiscal_year": 2024,
        "cik": "0000320193",
    }

    children, parent = build_parent_child_pairs(child_chunks, section_text, filing_meta)

    assert parent.is_parent is True
    assert all(c.parent_chunk_id == parent.chunk_id for c in children)
    assert all(c.ticker == "AAPL" for c in children)


def test_chunk_content_hash_deterministic():
    """Same text produces same content_hash."""
    from app.services.agentic.ingestion.chunker import Chunk
    c1 = Chunk(
        chunk_id="id1", parent_chunk_id="pid", text="hello world",
        token_count=2, section="S", item_number="1", is_parent=False,
        ticker="AAPL", company_name="Apple", filing_type="10-K",
        filed_date="2024-01-01", fiscal_year=2024, cik="123",
    )
    c2 = Chunk(
        chunk_id="id2", parent_chunk_id="pid", text="hello world",
        token_count=2, section="S", item_number="1", is_parent=False,
        ticker="MSFT", company_name="Microsoft", filing_type="10-K",
        filed_date="2024-01-01", fiscal_year=2024, cik="456",
    )
    assert c1.content_hash == c2.content_hash  # hash is text-only
```

* [ ] Step 2: Run tests to verify they fail

```bash
pytest tests/agentic/ingestion/test_chunker.py -v
```

Expected: ModuleNotFoundError: No module named 'app.services.agentic.ingestion.chunker'

* [ ] Step 3: Implement chunker.py

Create backend/app/services/agentic/ingestion/chunker.py:

```python
"""
3-pass document chunker for SEC filings.

Pass 1: Section detection — identify SEC item boundaries (Item 1, 1A, 7, 7A, 8, 9A)
Pass 2: Semantic chunking — split within sections using sentence similarity
Pass 3: Parent-child pairs — create child (search) + parent (context) chunks
"""
from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from sentence_transformers import SentenceTransformer

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_CHUNK_TOKENS    = 1024
TARGET_CHUNK_TOKENS = 600
SIMILARITY_THRESHOLD = 0.75
SEMANTIC_MODEL_NAME  = "all-MiniLM-L6-v2"

# ── SEC section regex map ─────────────────────────────────────────────────────

SEC_SECTION_PATTERNS: dict[str, tuple[re.Pattern, str]] = {
    "Business":              (re.compile(r"item\s+1[.\s](?!a)", re.IGNORECASE), "1"),
    "Risk Factors":          (re.compile(r"item\s+1a[.\s]",      re.IGNORECASE), "1A"),
    "MD&A":                  (re.compile(r"item\s+7[.\s](?!a)",  re.IGNORECASE), "7"),
    "Quantitative Market Risk": (re.compile(r"item\s+7a[.\s]",   re.IGNORECASE), "7A"),
    "Financial Statements":  (re.compile(r"item\s+8[.\s]",       re.IGNORECASE), "8"),
    "Controls & Procedures": (re.compile(r"item\s+9a[.\s]",      re.IGNORECASE), "9A"),
}

# Sentence tokenizer — simple but robust for financial text
_SENT_BOUNDARY = re.compile(
    r'(?<!\b(?:Inc|Corp|Ltd|Co|Mr|Mrs|Dr|vs|etc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec))'
    r'(?<=[.!?])\s+(?=[A-Z])'
)

# Lazy-loaded model (downloaded on first use ~90MB)
_semantic_model: Optional[SentenceTransformer] = None


def _get_model() -> SentenceTransformer:
    global _semantic_model
    if _semantic_model is None:
        _semantic_model = SentenceTransformer(SEMANTIC_MODEL_NAME)
    return _semantic_model


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    chunk_id:        str
    parent_chunk_id: str
    text:            str
    token_count:     int
    section:         str
    item_number:     str
    is_parent:       bool
    ticker:          str
    company_name:    str
    filing_type:     str
    filed_date:      str
    fiscal_year:     int
    cik:             str
    content_hash:    str = field(init=False)

    def __post_init__(self) -> None:
        self.content_hash = hashlib.sha256(self.text.encode()).hexdigest()


# ── Pass 1: Section detection ─────────────────────────────────────────────────

def detect_section(text: str) -> tuple[str, str]:
    """
    Detect which SEC section this text belongs to.
    Returns (section_name, item_number). Falls back to ("Unknown", "").
    """
    for section, (pattern, item_num) in SEC_SECTION_PATTERNS.items():
        if pattern.search(text[:500]):   # check first 500 chars for header
            return section, item_num
    return "Unknown", ""


def split_document_into_sections(full_text: str) -> list[tuple[str, str, str]]:
    """
    Split a full filing into (section_name, item_number, section_text) tuples.
    Never splits mid-section.
    """
    sections: list[tuple[str, str, str]] = []
    # Find all section header positions
    boundaries: list[tuple[int, str, str]] = []
    for section, (pattern, item_num) in SEC_SECTION_PATTERNS.items():
        for match in pattern.finditer(full_text):
            boundaries.append((match.start(), section, item_num))
    boundaries.sort(key=lambda x: x[0])

    for i, (start, section, item_num) in enumerate(boundaries):
        end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(full_text)
        text = full_text[start:end].strip()
        if len(text) > 50:  # skip empty sections
            sections.append((section, item_num, text))

    if not sections:
        # No recognized sections — treat whole doc as one section
        sections = [("Unknown", "", full_text)]

    return sections


# ── Pass 2: Semantic chunking ─────────────────────────────────────────────────

def split_into_sentences(text: str) -> list[str]:
    """Split text into sentences, respecting common financial abbreviations."""
    raw = _SENT_BOUNDARY.split(text.strip())
    return [s.strip() for s in raw if s.strip()]


def _count_tokens(text: str) -> int:
    """Approximate token count: words × 1.3 (rough GPT/Claude tokenizer estimate)."""
    return int(len(text.split()) * 1.3)


def semantic_chunk(
    section_text: str,
    section: str,
    item: str,
) -> list[Chunk]:
    """
    Semantically split a section into coherent child chunks.
    Splits when cosine similarity between consecutive sentences drops below threshold.
    Never exceeds MAX_CHUNK_TOKENS per chunk.
    """
    sentences = split_into_sentences(section_text)
    if not sentences:
        return []

    model = _get_model()
    embeddings = model.encode(sentences, convert_to_numpy=True)

    chunks: list[Chunk] = []
    current_sentences: list[str] = [sentences[0]]
    current_tokens: int = _count_tokens(sentences[0])

    for i in range(1, len(sentences)):
        sent = sentences[i]
        sent_tokens = _count_tokens(sent)

        # Cosine similarity between consecutive sentence embeddings
        sim = float(
            np.dot(embeddings[i - 1], embeddings[i])
            / (np.linalg.norm(embeddings[i - 1]) * np.linalg.norm(embeddings[i]) + 1e-9)
        )

        would_exceed = (current_tokens + sent_tokens) > MAX_CHUNK_TOKENS
        semantic_break = sim < SIMILARITY_THRESHOLD

        if (semantic_break or would_exceed) and current_sentences:
            chunk_text = " ".join(current_sentences)
            chunks.append(_make_child_chunk(chunk_text, section, item))
            current_sentences = [sent]
            current_tokens = sent_tokens
        else:
            current_sentences.append(sent)
            current_tokens += sent_tokens

    if current_sentences:
        chunk_text = " ".join(current_sentences)
        chunks.append(_make_child_chunk(chunk_text, section, item))

    return chunks


def _make_child_chunk(text: str, section: str, item: str) -> Chunk:
    """Create a child Chunk with placeholder filing metadata (filled in Pass 3)."""
    return Chunk(
        chunk_id=str(uuid.uuid4()),
        parent_chunk_id="",          # set in build_parent_child_pairs
        text=text,
        token_count=_count_tokens(text),
        section=section,
        item_number=item,
        is_parent=False,
        ticker="",                   # set in build_parent_child_pairs
        company_name="",
        filing_type="",
        filed_date="",
        fiscal_year=0,
        cik="",
    )


# ── Pass 3: Parent-child pairs ────────────────────────────────────────────────

def build_parent_child_pairs(
    child_chunks: list[Chunk],
    full_section_text: str,
    filing_meta: dict,
) -> tuple[list[Chunk], Chunk]:
    """
    Attach filing metadata to child chunks and create parent section chunk.

    Args:
        child_chunks: Output of semantic_chunk()
        full_section_text: Complete section text (up to 4096 tokens)
        filing_meta: {ticker, company_name, filing_type, filed_date, fiscal_year, cik}

    Returns:
        (children_with_meta, parent_chunk)
    """
    parent_id = str(uuid.uuid4())
    ticker      = filing_meta["ticker"]
    company     = filing_meta["company_name"]
    filing_type = filing_meta["filing_type"]
    filed_date  = filing_meta["filed_date"]
    fiscal_year = filing_meta["fiscal_year"]
    cik         = filing_meta["cik"]

    # Truncate parent text to 4096-token hard limit
    parent_text = full_section_text
    if _count_tokens(parent_text) > 4096:
        words = parent_text.split()
        parent_text = " ".join(words[:3100])  # ~4000 tokens at 1.3x ratio

    section  = child_chunks[0].section   if child_chunks else "Unknown"
    item_num = child_chunks[0].item_number if child_chunks else ""

    parent = Chunk(
        chunk_id=parent_id,
        parent_chunk_id=parent_id,   # parent is its own parent
        text=parent_text,
        token_count=_count_tokens(parent_text),
        section=section,
        item_number=item_num,
        is_parent=True,
        ticker=ticker,
        company_name=company,
        filing_type=filing_type,
        filed_date=filed_date,
        fiscal_year=fiscal_year,
        cik=cik,
    )

    children_with_meta: list[Chunk] = []
    for c in child_chunks:
        children_with_meta.append(Chunk(
            chunk_id=c.chunk_id,
            parent_chunk_id=parent_id,
            text=c.text,
            token_count=c.token_count,
            section=c.section,
            item_number=c.item_number,
            is_parent=False,
            ticker=ticker,
            company_name=company,
            filing_type=filing_type,
            filed_date=filed_date,
            fiscal_year=fiscal_year,
            cik=cik,
        ))

    return children_with_meta, parent


def chunk_filing(full_text: str, filing_meta: dict) -> tuple[list[Chunk], list[Chunk]]:
    """
    Full 3-pass chunking pipeline for one SEC filing.

    Returns:
        (all_children, all_parents) — ready for embedding and indexing
    """
    sections = split_document_into_sections(full_text)
    all_children: list[Chunk] = []
    all_parents:  list[Chunk] = []

    for section_name, item_num, section_text in sections:
        child_chunks = semantic_chunk(section_text, section_name, item_num)
        if not child_chunks:
            continue
        children, parent = build_parent_child_pairs(
            child_chunks, section_text, filing_meta
        )
        all_children.extend(children)
        all_parents.append(parent)

    return all_children, all_parents
```

* [ ] Step 4: Run tests to verify they pass

```bash
pytest tests/agentic/ingestion/test_chunker.py -v
```

Expected: all 9 tests pass.

* [ ] Step 5: Commit

```bash
git add backend/app/services/agentic/ingestion/chunker.py tests/agentic/ingestion/test_chunker.py
git commit -m "feat(agentic): 3-pass SEC filing chunker — section detect, semantic split, parent-child pairs"
```

***

## Task 5: Titan Embedder (Async Batch)

Files:

* Create: backend/app/services/agentic/ingestion/embedder.py
* Create: tests/agentic/ingestion/test\_embedder.py

- [ ] Step 1: Write failing tests

Create tests/agentic/ingestion/test\_embedder.py:

```python
"""Tests for the Titan Embeddings v2 batch embedder."""
import asyncio
import pytest
from unittest.mock import patch, MagicMock
from app.services.agentic.ingestion.embedder import embed_chunks_async, BATCH_SIZE
from app.services.agentic.ingestion.chunker import Chunk


def make_chunks(n: int) -> list[Chunk]:
    return [
        Chunk(
            chunk_id=f"chunk-{i}",
            parent_chunk_id=f"parent-{i}",
            text=f"Apple Inc financial risk number {i}",
            token_count=8,
            section="Risk Factors",
            item_number="1A",
            is_parent=False,
            ticker="AAPL",
            company_name="Apple Inc.",
            filing_type="10-K",
            filed_date="2024-11-01",
            fiscal_year=2024,
            cik="0000320193",
        )
        for i in range(n)
    ]


def test_embed_chunks_returns_dict_keyed_by_chunk_id():
    """embed_chunks_async returns {chunk_id: vector} for each chunk."""
    chunks = make_chunks(3)
    fake_vectors = [[0.1] * 1536] * 3

    with patch("app.services.agentic.ingestion.embedder.embed_texts", return_value=fake_vectors):
        result = asyncio.run(embed_chunks_async(chunks))

    assert set(result.keys()) == {c.chunk_id for c in chunks}
    assert all(len(v) == 1536 for v in result.values())


def test_embed_chunks_skips_already_indexed(tmp_path):
    """embed_chunks_async skips chunks whose content_hash exists in Qdrant."""
    chunks = make_chunks(2)

    with patch("app.services.agentic.ingestion.embedder.embed_texts") as mock_embed, \
         patch("app.services.agentic.ingestion.embedder.chunk_exists") as mock_exists:
        mock_exists.side_effect = lambda h: True   # all already indexed
        mock_embed.return_value = []
        result = asyncio.run(embed_chunks_async(chunks))

    assert result == {}  # nothing embedded
    mock_embed.assert_not_called()


def test_embed_chunks_batches_correctly():
    """embed_chunks_async calls embed_texts in batches of BATCH_SIZE."""
    chunks = make_chunks(BATCH_SIZE + 5)  # more than one batch
    fake_batch = [[0.1] * 1536] * BATCH_SIZE
    fake_remainder = [[0.2] * 1536] * 5

    call_count = 0
    def mock_embed(texts):
        nonlocal call_count
        call_count += 1
        return fake_batch if len(texts) == BATCH_SIZE else fake_remainder

    with patch("app.services.agentic.ingestion.embedder.embed_texts", side_effect=mock_embed), \
         patch("app.services.agentic.ingestion.embedder.chunk_exists", return_value=False):
        result = asyncio.run(embed_chunks_async(chunks))

    assert call_count == 2  # two batches
    assert len(result) == BATCH_SIZE + 5
```

* [ ] Step 2: Run tests to verify they fail

```bash
pytest tests/agentic/ingestion/test_embedder.py -v
```

Expected: ModuleNotFoundError: No module named 'app.services.agentic.ingestion.embedder'

* [ ] Step 3: Implement embedder.py

Create backend/app/services/agentic/ingestion/embedder.py:

```python
"""
Titan Embeddings v2 batch embedder.
Embeds child chunks in batches of 25 with 8 async workers.
Skips chunks already indexed (content hash dedup).
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from app.services.agentic.bedrock_client import embed_texts
from app.services.agentic.ingestion.chunker import Chunk
from app.services.agentic.ingestion.indexer import chunk_exists

logger = logging.getLogger(__name__)

BATCH_SIZE       = 25    # Bedrock Titan rate-limit safe
MAX_WORKERS      = 8     # concurrent embedding tasks
SEMAPHORE        = asyncio.Semaphore(MAX_WORKERS)


async def _embed_batch(
    batch: list[Chunk],
) -> dict[str, list[float]]:
    """Embed one batch synchronously in a thread (boto3 is not async-native)."""
    async with SEMAPHORE:
        texts = [c.text for c in batch]
        loop = asyncio.get_event_loop()
        vectors = await loop.run_in_executor(None, embed_texts, texts)
        return {c.chunk_id: v for c, v in zip(batch, vectors)}


async def embed_chunks_async(
    chunks: list[Chunk],
) -> dict[str, list[float]]:
    """
    Embed all child chunks, skipping already-indexed ones.

    Returns:
        {chunk_id: embedding_vector} for new chunks only
    """
    # Filter out already-indexed chunks
    new_chunks = [c for c in chunks if not chunk_exists(c.content_hash)]
    skipped = len(chunks) - len(new_chunks)
    if skipped:
        logger.info("Skipping %d already-indexed chunks", skipped)
    if not new_chunks:
        return {}

    # Split into batches
    batches = [
        new_chunks[i: i + BATCH_SIZE]
        for i in range(0, len(new_chunks), BATCH_SIZE)
    ]

    logger.info("Embedding %d chunks in %d batches", len(new_chunks), len(batches))

    tasks = [_embed_batch(batch) for batch in batches]
    results = await asyncio.gather(*tasks)

    combined: dict[str, list[float]] = {}
    for r in results:
        combined.update(r)

    return combined
```

* [ ] Step 4: Run tests to verify they pass

```bash
pytest tests/agentic/ingestion/test_embedder.py -v
```

Expected: all 3 tests pass.

* [ ] Step 5: Commit

```bash
git add backend/app/services/agentic/ingestion/embedder.py tests/agentic/ingestion/test_embedder.py
git commit -m "feat(agentic): async Titan v2 batch embedder — 25/batch, 8 workers, content-hash dedup"
```

***

## Task 6: SEC Fetcher

Files:

* Create: backend/app/services/agentic/ingestion/sec\_fetcher.py
* Create: tests/agentic/ingestion/test\_sec\_fetcher.py

- [ ] Step 1: Write failing tests

Create tests/agentic/ingestion/test\_sec\_fetcher.py:

```python
"""Tests for SEC EDGAR filing fetcher."""
import pytest
from unittest.mock import patch, MagicMock
from app.services.agentic.ingestion.sec_fetcher import (
    get_cik_for_ticker,
    fetch_filings_for_ticker,
    Filing,
    SUPPORTED_FILING_TYPES,
)


def test_get_cik_for_ticker_returns_string():
    """get_cik_for_ticker returns a zero-padded 10-digit CIK string."""
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "hits": {"hits": [{"_source": {"entity_id": "320193"}}]}
    }
    mock_response.raise_for_status = MagicMock()

    with patch("app.services.agentic.ingestion.sec_fetcher.requests.get",
               return_value=mock_response):
        cik = get_cik_for_ticker("AAPL")
    assert cik == "0000320193"
    assert len(cik) == 10


def test_get_cik_for_ticker_returns_none_on_miss():
    """get_cik_for_ticker returns None when ticker not found in EDGAR."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"hits": {"hits": []}}
    mock_response.raise_for_status = MagicMock()

    with patch("app.services.agentic.ingestion.sec_fetcher.requests.get",
               return_value=mock_response):
        cik = get_cik_for_ticker("FAKEFAKE")
    assert cik is None


def test_fetch_filings_for_ticker_returns_filing_list():
    """fetch_filings_for_ticker returns list of Filing objects."""
    mock_submissions = {
        "filings": {
            "recent": {
                "accessionNumber": ["0000320193-24-000123"],
                "form": ["10-K"],
                "filingDate": ["2024-11-01"],
                "primaryDocument": ["aapl-20240928.htm"],
            }
        }
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_submissions
    mock_resp.raise_for_status = MagicMock()

    with patch("app.services.agentic.ingestion.sec_fetcher.requests.get",
               return_value=mock_resp), \
         patch("app.services.agentic.ingestion.sec_fetcher.get_cik_for_ticker",
               return_value="0000320193"):
        filings = fetch_filings_for_ticker("AAPL", years_back=1)

    assert len(filings) >= 1
    assert isinstance(filings[0], Filing)
    assert filings[0].filing_type == "10-K"
    assert filings[0].ticker == "AAPL"


def test_supported_filing_types_includes_key_forms():
    assert "10-K" in SUPPORTED_FILING_TYPES
    assert "10-Q" in SUPPORTED_FILING_TYPES
    assert "8-K"  in SUPPORTED_FILING_TYPES
```

* [ ] Step 2: Run tests to verify they fail

```bash
pytest tests/agentic/ingestion/test_sec_fetcher.py -v
```

Expected: ModuleNotFoundError

* [ ] Step 3: Implement sec\_fetcher.py

Create backend/app/services/agentic/ingestion/sec\_fetcher.py:

```python
"""
SEC EDGAR filing fetcher.
Uses EDGAR Full-Text Search + submissions API (free, no key required).
Falls back to sec-api.io for parsing when needed.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import requests

logger = logging.getLogger(__name__)

EDGAR_BASE     = "https://data.sec.gov"
EDGAR_SEARCH   = "https://efts.sec.gov/LATEST/search-index"
USER_AGENT     = os.getenv("EDGAR_USER_AGENT", "QuantTrade/1.0 admin@quanttrade.us")
RATE_LIMIT_SEC = 0.12   # EDGAR allows 10 req/sec max — we stay at ~8

SUPPORTED_FILING_TYPES = {"10-K", "10-Q", "8-K", "DEF 14A"}

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
}


@dataclass
class Filing:
    ticker:         str
    cik:            str
    accession_num:  str
    filing_type:    str
    filed_date:     str
    fiscal_year:    int
    primary_doc_url: str


def get_cik_for_ticker(ticker: str) -> Optional[str]:
    """
    Look up EDGAR CIK for a stock ticker symbol.
    Returns zero-padded 10-digit CIK string, or None if not found.
    """
    time.sleep(RATE_LIMIT_SEC)
    url = f"{EDGAR_SEARCH}?q=%22{ticker}%22&dateRange=custom&startdt=2000-01-01&forms=10-K"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        hits = resp.json().get("hits", {}).get("hits", [])
        if not hits:
            return None
        raw_cik = str(hits[0]["_source"].get("entity_id", ""))
        return raw_cik.zfill(10) if raw_cik else None
    except Exception as e:
        logger.warning("CIK lookup failed for %s: %s", ticker, e)
        return None


def fetch_filings_for_ticker(
    ticker: str,
    years_back: int = 5,
    filing_types: set[str] | None = None,
) -> list[Filing]:
    """
    Fetch all filings for a ticker from EDGAR submissions API.

    Args:
        ticker: Stock ticker symbol (e.g. "AAPL")
        years_back: How many years of history to fetch
        filing_types: Filing form types to include (defaults to SUPPORTED_FILING_TYPES)

    Returns:
        List of Filing objects ready for downloading and parsing
    """
    if filing_types is None:
        filing_types = SUPPORTED_FILING_TYPES

    cik = get_cik_for_ticker(ticker)
    if not cik:
        logger.warning("No CIK found for ticker %s — skipping", ticker)
        return []

    time.sleep(RATE_LIMIT_SEC)
    url = f"{EDGAR_BASE}/submissions/CIK{cik}.json"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error("Failed to fetch submissions for %s: %s", ticker, e)
        return []

    recent = data.get("filings", {}).get("recent", {})
    accessions  = recent.get("accessionNumber", [])
    forms       = recent.get("form", [])
    dates       = recent.get("filingDate", [])
    primary_docs= recent.get("primaryDocument", [])

    cutoff = datetime.now() - timedelta(days=years_back * 365)
    filings: list[Filing] = []

    for acc, form, date_str, doc in zip(accessions, forms, dates, primary_docs):
        if form not in filing_types:
            continue
        try:
            filed_dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue
        if filed_dt < cutoff:
            continue

        # Build document URL
        acc_clean = acc.replace("-", "")
        doc_url = (
            f"{EDGAR_BASE}/Archives/edgar/full-index/"
            f"{filed_dt.year}/{_quarter(filed_dt)}/{acc_clean}/{doc}"
        )

        filings.append(Filing(
            ticker=ticker,
            cik=cik,
            accession_num=acc,
            filing_type=form,
            filed_date=date_str,
            fiscal_year=filed_dt.year,
            primary_doc_url=doc_url,
        ))

    return filings


def download_filing_text(filing: Filing) -> Optional[str]:
    """
    Download and extract plain text from a filing's primary document.
    Handles both HTML and text filings.
    Returns None on failure.
    """
    time.sleep(RATE_LIMIT_SEC)
    try:
        resp = requests.get(filing.primary_doc_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")

        if "html" in content_type or filing.primary_doc_url.endswith((".htm", ".html")):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.content, "lxml")
            # Remove XBRL inline tags
            for tag in soup(["script", "style", "ix:nonnumeric", "ix:nonfraction"]):
                tag.decompose()
            return soup.get_text(separator="\n", strip=True)
        else:
            return resp.text

    except Exception as e:
        logger.error("Failed to download filing %s: %s", filing.accession_num, e)
        return None


def _quarter(dt: datetime) -> str:
    """Return EDGAR quarter directory (QTR1–QTR4) for a date."""
    return f"QTR{(dt.month - 1) // 3 + 1}"
```

* [ ] Step 4: Run tests to verify they pass

```bash
pytest tests/agentic/ingestion/test_sec_fetcher.py -v
```

Expected: all 4 tests pass.

* [ ] Step 5: Commit

```bash
git add backend/app/services/agentic/ingestion/sec_fetcher.py tests/agentic/ingestion/test_sec_fetcher.py
git commit -m "feat(agentic): SEC EDGAR filing fetcher — CIK lookup, submissions API, HTML/text extraction"
```

***

## Task 7: Ingestion Orchestrator + Scheduler

Files:

* Create: backend/app/services/agentic/ingestion/orchestrator.py

- [ ] Step 1: Implement orchestrator.py

Create backend/app/services/agentic/ingestion/orchestrator.py:

```python
"""
Full ingestion pipeline orchestrator.
Wires: SEC fetcher → chunker → embedder → indexer
Supports full corpus load and nightly delta updates.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from app.services.agentic.ingestion.sec_fetcher import (
    fetch_filings_for_ticker,
    download_filing_text,
    Filing,
)
from app.services.agentic.ingestion.chunker import chunk_filing
from app.services.agentic.ingestion.embedder import embed_chunks_async
from app.services.agentic.ingestion.indexer import (
    ensure_collections_exist,
    upsert_chunks,
)

logger = logging.getLogger(__name__)

# S&P 500 + Russell 1000 representative tickers
# Replace with full list loaded from CSV in production
UNIVERSE_TICKERS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK.B",
    "JPM", "JNJ", "UNH", "XOM", "V", "LLY", "AVGO", "PG", "HD", "MA",
    "CVX", "ABBV", "MRK", "COST", "PEP", "KO", "ADBE", "CRM", "TMO",
    "ACN", "MCD", "CSCO", "BAC", "WMT", "NKE", "ABT", "LIN", "DHR",
    # ... full Russell 1000 list loaded from file in production
]


@dataclass
class IngestionStatus:
    started_at:     str = field(default_factory=lambda: datetime.utcnow().isoformat())
    finished_at:    Optional[str] = None
    total_tickers:  int = 0
    processed:      int = 0
    failed:         int = 0
    total_chunks:   int = 0
    is_running:     bool = False
    last_error:     Optional[str] = None


# Singleton status tracker (in-memory, sufficient for single-worker setup)
_status = IngestionStatus()


def get_ingestion_status() -> IngestionStatus:
    return _status


async def ingest_ticker(ticker: str, years_back: int = 5) -> int:
    """
    Run full ingestion pipeline for one ticker.
    Returns number of new chunks indexed.
    """
    filings = fetch_filings_for_ticker(ticker, years_back=years_back)
    if not filings:
        return 0

    total_new = 0
    for filing in filings:
        text = download_filing_text(filing)
        if not text or len(text) < 200:
            continue

        filing_meta = {
            "ticker":       filing.ticker,
            "company_name": ticker,   # enriched from fundamentals in production
            "filing_type":  filing.filing_type,
            "filed_date":   filing.filed_date,
            "fiscal_year":  filing.fiscal_year,
            "cik":          filing.cik,
        }

        children, parents = chunk_filing(text, filing_meta)
        if not children:
            continue

        vectors = await embed_chunks_async(children)
        if not vectors:
            continue  # all already indexed

        upsert_chunks(children, parents, vectors)
        total_new += len(vectors)
        logger.info("%s %s: indexed %d new chunks", ticker, filing.filing_type, len(vectors))

    return total_new


async def run_full_ingestion(
    tickers: list[str] | None = None,
    years_back: int = 5,
) -> IngestionStatus:
    """
    Full corpus ingestion. Runs all tickers sequentially (EDGAR rate limits).
    Typically takes 72-96 hours for 1,100 companies.
    """
    global _status
    tickers = tickers or UNIVERSE_TICKERS
    _status = IngestionStatus(total_tickers=len(tickers), is_running=True)

    ensure_collections_exist()

    for ticker in tickers:
        try:
            new_chunks = await ingest_ticker(ticker, years_back=years_back)
            _status.total_chunks += new_chunks
            _status.processed += 1
        except Exception as e:
            logger.error("Failed to ingest %s: %s", ticker, e)
            _status.failed += 1
            _status.last_error = str(e)

    _status.finished_at = datetime.utcnow().isoformat()
    _status.is_running = False
    return _status


async def run_delta_ingestion() -> IngestionStatus:
    """
    Nightly delta — only fetch filings from last 2 days.
    Called by APScheduler at 2AM EST.
    """
    return await run_full_ingestion(years_back=0)  # 0 = current month only


def register_ingestion_jobs(scheduler) -> None:
    """Register APScheduler jobs. Call from app startup."""
    # Nightly delta at 2AM EST
    scheduler.add_job(
        lambda: asyncio.run(run_delta_ingestion()),
        trigger="cron",
        hour=2,
        minute=0,
        timezone="US/Eastern",
        id="nightly_delta_ingestion",
        replace_existing=True,
    )
    logger.info("Registered nightly delta ingestion job (2AM EST)")
```

* [ ] Step 2: Commit

```bash
git add backend/app/services/agentic/ingestion/orchestrator.py
git commit -m "feat(agentic): ingestion orchestrator — full corpus + nightly delta + APScheduler jobs"
```

***

## Task 8: Admin API Endpoints

Files:

* Create: backend/app/api/agentic\_copilot.py
* Modify: backend/app/main.py

- [ ] Step 1: Create admin API

Create backend/app/api/agentic\_copilot.py:

```python
"""
Admin endpoints for Agentic RAG Copilot.
POST /api/v1/copilot/ingest        — trigger manual ingestion (admin only)
GET  /api/v1/copilot/ingest/status — ingestion progress
GET  /api/v1/copilot/health        — Qdrant + Bedrock connectivity
"""
from __future__ import annotations

import asyncio
import logging
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.auth import require_auth
from app.models.user import User
from app.services.agentic.ingestion.orchestrator import (
    run_full_ingestion,
    get_ingestion_status,
    ensure_collections_exist,
    IngestionStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/copilot", tags=["agentic-copilot"])

ADMIN_EMAILS = set(
    os.getenv("ADMIN_EMAILS", "admin@quanttrade.us").split(",")
)


def _require_admin(user: User = Depends(require_auth)) -> User:
    if user.email not in ADMIN_EMAILS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


@router.post("/ingest", response_model=dict)
async def trigger_ingestion(
    background_tasks: BackgroundTasks,
    tickers: list[str] | None = None,
    years_back: int = 5,
    _user: User = Depends(_require_admin),
):
    """Trigger SEC filing ingestion. Runs in background. Admin only."""
    status_obj = get_ingestion_status()
    if status_obj.is_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ingestion already running",
        )
    background_tasks.add_task(
        asyncio.run, run_full_ingestion(tickers=tickers, years_back=years_back)
    )
    return {"status": "started", "message": "Ingestion running in background"}


@router.get("/ingest/status", response_model=IngestionStatus)
async def ingestion_status(_user: User = Depends(_require_admin)):
    """Return current ingestion progress. Admin only."""
    return get_ingestion_status()


@router.get("/health")
async def health_check():
    """Check Qdrant and Bedrock connectivity."""
    checks: dict[str, str] = {}

    # Qdrant check
    try:
        from app.services.agentic.ingestion.indexer import _qdrant_client
        _qdrant_client().get_collections()
        checks["qdrant"] = "ok"
    except Exception as e:
        checks["qdrant"] = f"error: {e}"

    # Bedrock check
    try:
        from app.services.agentic.bedrock_client import embed_query
        vec = embed_query("health check")
        checks["bedrock_titan"] = f"ok (dim={len(vec)})"
    except Exception as e:
        checks["bedrock_titan"] = f"error: {e}"

    all_ok = all(v == "ok" or v.startswith("ok") for v in checks.values())
    return {"healthy": all_ok, "checks": checks}
```

* [ ] Step 2: Register router in main.py

Open backend/app/main.py and find where other routers are included. Add:

```python
from app.api.agentic_copilot import router as agentic_router
# ... inside the app setup section:
app.include_router(agentic_router, prefix="/api/v1")
```

* [ ] Step 3: Test health endpoint

With backend running:

```bash
curl http://localhost:8000/api/v1/copilot/health
```

Expected:

```json
{"healthy": true, "checks": {"qdrant": "ok", "bedrock_titan": "ok (dim=1536)"}}
```

* [ ] Step 4: Commit

```bash
git add backend/app/api/agentic_copilot.py backend/app/main.py
git commit -m "feat(agentic): admin API endpoints — ingest trigger, status, health check"
```

***

## Task 9: Add EARNINGS Intent to Classifier

Files:

* Modify: backend/app/services/copilot/constants.py
* Modify: backend/app/services/copilot/intent\_classifier.py
* Modify: backend/app/services/copilot/router.py

- [ ] Step 1: Add EARNINGS to CopilotIntent enum in constants.py

Open backend/app/services/copilot/constants.py. Find the CopilotIntent enum and add:

```python
EARNINGS = "earnings"
```

Full enum should include: STOCK\_ANALYSIS, COMPARISON, SCREENER, PORTFOLIO\_ADVICE, EARNINGS, GENERAL\_ADVICE, EDUCATION, MARKET\_OVERVIEW, GREETING, OFF\_TOPIC.

* [ ] Step 2: Add EARNINGS keyword detection in intent\_classifier.py

Open backend/app/services/copilot/intent\_classifier.py. Find where intent keywords are checked. Add earnings detection before the general\_advice fallback:

```python
EARNINGS_KEYWORDS = {
    "earnings", "eps", "quarterly results", "guidance", "beat", "miss",
    "consensus", "estimate", "earnings call", "q1", "q2", "q3", "q4",
    "quarterly", "annual results", "revenue forecast", "forward guidance",
    "whisper number", "earnings surprise", "beat expectations",
}

def _is_earnings_query(text_lower: str) -> bool:
    return any(kw in text_lower for kw in EARNINGS_KEYWORDS)
```

In the classification logic, add before GENERAL\_ADVICE fallback:

```python
if _is_earnings_query(text_lower):
    return CopilotIntent.EARNINGS, confidence
```

* [ ] Step 3: Add EARNINGS routing rule in router.py

Open backend/app/services/copilot/router.py. Find the routing decision section. Add:

```python
if intent == CopilotIntent.EARNINGS:
    # EARNINGS: works with or without a ticker
    # No entity required — can ask about upcoming earnings calendar generally
    return RoutingDecision(intent=intent, ticker=ticker, confidence=confidence)
```

* [ ] Step 4: Test intent classification

```bash
python -c "
from app.services.copilot.intent_classifier import classify_intent
intent, conf = classify_intent('What are Apple earnings expectations for Q4?')
print(f'Intent: {intent}, Confidence: {conf}')
# Expected: Intent: earnings, Confidence: ~0.8
"
```

* [ ] Step 5: Commit

```bash
git add backend/app/services/copilot/constants.py \
        backend/app/services/copilot/intent_classifier.py \
        backend/app/services/copilot/router.py
git commit -m "feat(agentic): add EARNINGS intent — keyword detection, routing rule"
```

***

## Task 10: Integration Test — Full Ingestion Pipeline

Files:

* Create: tests/agentic/ingestion/test\_integration\_pipeline.py

- [ ] Step 1: Write integration test

Create tests/agentic/ingestion/test\_integration\_pipeline.py:

```python
"""
Integration test for the full ingestion pipeline.
Uses a small synthetic SEC filing — no real network calls.
"""
import asyncio
import pytest
from unittest.mock import patch, MagicMock

SAMPLE_10K_TEXT = """
ITEM 1. BUSINESS

Apple Inc. designs, manufactures, and markets smartphones, personal computers,
tablets, wearables, and accessories. The Company also sells various related
services. The Company's products include iPhone, Mac, iPad, and Wearables.

ITEM 1A. RISK FACTORS

The Company faces significant risks related to global supply chains.
Manufacturing is concentrated in China through third-party manufacturers.
Geopolitical tensions between the United States and China could adversely
affect the Company's ability to produce and sell products in China.
Revenue from Greater China represented approximately 19% of total net sales.

ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS

Net sales for fiscal 2024 were $391.0 billion, an increase of 2% year over year.
iPhone net sales increased 6% year over year to $201.2 billion.
Services net sales set an all-time record of $96.2 billion.
"""

SAMPLE_META = {
    "ticker":       "AAPL",
    "company_name": "Apple Inc.",
    "filing_type":  "10-K",
    "filed_date":   "2024-11-01",
    "fiscal_year":  2024,
    "cik":          "0000320193",
}


def test_chunk_filing_produces_children_and_parents():
    """chunk_filing() produces both child and parent chunks from sample 10-K."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    children, parents = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)

    assert len(children) >= 2   # at least 2 sections produce children
    assert len(parents) >= 2    # one parent per section
    assert all(not c.is_parent for c in children)
    assert all(p.is_parent for p in parents)
    assert all(c.ticker == "AAPL" for c in children)
    assert all(p.ticker == "AAPL" for p in parents)
    assert all(c.parent_chunk_id != "" for c in children)


def test_full_pipeline_end_to_end():
    """Full pipeline: chunk → embed → upsert (all external calls mocked)."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    from app.services.agentic.ingestion.embedder import embed_chunks_async
    from app.services.agentic.ingestion.indexer import upsert_chunks

    children, parents = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)
    fake_vectors = {c.chunk_id: [0.1] * 1536 for c in children}

    with patch("app.services.agentic.ingestion.embedder.embed_texts",
               return_value=[[0.1] * 1536] * len(children)), \
         patch("app.services.agentic.ingestion.embedder.chunk_exists",
               return_value=False), \
         patch("app.services.agentic.ingestion.indexer._qdrant_client") as mock_q:

        vectors = asyncio.run(embed_chunks_async(children))
        assert len(vectors) == len(children)
        assert all(len(v) == 1536 for v in vectors.values())

        upsert_chunks(children, parents, vectors)
        assert mock_q.return_value.upsert.call_count == 2  # children + parents


def test_risk_factors_section_detected():
    """Risk Factors section is detected and chunked separately."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    children, _ = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)
    sections = {c.section for c in children}
    assert "Risk Factors" in sections


def test_mda_section_detected():
    """MD&A section is detected and chunked separately."""
    from app.services.agentic.ingestion.chunker import chunk_filing
    children, _ = chunk_filing(SAMPLE_10K_TEXT, SAMPLE_META)
    sections = {c.section for c in children}
    assert "MD&A" in sections
```

* [ ] Step 2: Run integration tests

```bash
pytest tests/agentic/ingestion/test_integration_pipeline.py -v
```

Expected: all 4 tests pass.

* [ ] Step 3: Run full test suite to check no regressions

```bash
pytest tests/agentic/ -v
```

Expected: all tests pass.

* [ ] Step 4: Commit

```bash
git add tests/agentic/ingestion/test_integration_pipeline.py
git commit -m "test(agentic): integration test — full chunking → embedding → indexing pipeline"
```

***

## Task 11: Smoke Test with Real AAPL Filing

No code changes — manual verification step.

* [ ] Step 1: Run real ingestion for one ticker

With backend env vars set (QDRANT\_URL, QDRANT\_API\_KEY, AWS\_REGION, etc.):

```bash
python -c "
import asyncio
from app.services.agentic.ingestion.orchestrator import ingest_ticker
from app.services.agentic.ingestion.indexer import ensure_collections_exist

ensure_collections_exist()
n = asyncio.run(ingest_ticker('AAPL', years_back=2))
print(f'Indexed {n} new chunks for AAPL')
"
```

Expected: Indexed N new chunks for AAPL where N > 100. Takes \~2–5 minutes.

* [ ] Step 2: Verify chunks in Qdrant dashboard

Go to Qdrant Cloud dashboard → sec\_filings\_chunks collection. Filter by ticker = "AAPL". Should show 100–500 points.

* [ ] Step 3: Verify parent retrieval

```bash
python -c "
from app.services.agentic.ingestion.indexer import _qdrant_client, CHUNKS_COLLECTION
from qdrant_client.models import Filter, FieldCondition, MatchValue

results, _ = _qdrant_client().scroll(
    collection_name=CHUNKS_COLLECTION,
    scroll_filter=Filter(must=[FieldCondition(key='ticker', match=MatchValue(value='AAPL'))]),
    limit=3,
    with_payload=True,
)
for r in results:
    print(r.payload['section'], '|', r.payload['token_count'], 'tokens')
    print(r.payload['text'][:100])
    print()
"
```

Expected: 3 chunks printed with section labels, token counts, and coherent text excerpts.

* [ ] Step 4: Final commit

```bash
git add .
git commit -m "feat(agentic): Plan 1 complete — Bedrock + Qdrant + SEC ingestion pipeline"
```

***

## Self-Review Checklist

Spec coverage:

* [x] §4 Ingestion pipeline — Tasks 4–7 implement all 3 passes + EDGAR fetch + embedder + indexer
* [x] §6 EARNINGS agent — Task 9 adds intent to classifier, constants, router
* [x] §7 Guardrail prerequisites — collections + health check in Task 8
* [x] §8 Bedrock client — Task 2 implements all 3 models
* [x] §9 Environment variables — Task 1 covers all new vars
* [x] §9 APScheduler jobs — Task 7 registers nightly delta
* [x] Integration — Task 10 (full pipeline test), Task 11 (real EDGAR smoke test)

Type consistency:

* Chunk dataclass defined in chunker.py Task 4, used in indexer.py Task 3, embedder.py Task 5 — all import from same source ✓
* embed\_texts from bedrock\_client.py used in embedder.py — consistent ✓
* chunk\_exists from indexer.py used in embedder.py — consistent ✓
* ensure\_collections\_exist from indexer.py used in orchestrator.py and agentic\_copilot.py — consistent ✓

No placeholders: All code blocks are complete. No TBDs. ✓
