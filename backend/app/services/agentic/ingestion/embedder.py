"""
Titan Embeddings v2 batch embedder.
Embeds child chunks in batches of 25 with 8 async workers.
Skips chunks already indexed (content hash dedup).
"""
from __future__ import annotations

import asyncio
import logging

from app.services.agentic.bedrock_client import embed_texts
from app.services.agentic.ingestion.chunker import Chunk
from app.services.agentic.ingestion.indexer import chunk_exists

logger = logging.getLogger(__name__)

BATCH_SIZE  = 25
MAX_WORKERS = 8


async def _embed_batch(
    batch: list[Chunk],
    semaphore: asyncio.Semaphore,
) -> dict[str, list[float]]:
    """Embed one batch synchronously in a thread (boto3 is not async-native)."""
    async with semaphore:
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
    semaphore = asyncio.Semaphore(MAX_WORKERS)

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

    tasks = [_embed_batch(batch, semaphore) for batch in batches]
    results = await asyncio.gather(*tasks)

    combined: dict[str, list[float]] = {}
    for r in results:
        combined.update(r)

    return combined
