"""SEC filing chunker and embedder for RAG corpus.

Uses character-based chunking with overlap (no tiktoken required).
Embedding uses ``sentence-transformers`` (``all-MiniLM-L6-v2``, dim=384).
The ``sentence-transformers`` library is imported lazily so the module
loads successfully even when it is not installed.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from data.config import FreeDataConfig

log = logging.getLogger(__name__)


class SECChunker:
    """Chunk and optionally embed SEC filing texts for downstream RAG.

    Parameters
    ----------
    config:
        ``FreeDataConfig`` instance; uses ``rag_chunk_size``,
        ``rag_chunk_overlap``, and ``rag_embedding_model``.
    """

    def __init__(self, config: FreeDataConfig) -> None:
        self.chunk_size = config.rag_chunk_size
        self.chunk_overlap = config.rag_chunk_overlap
        self.embedding_model_name = config.rag_embedding_model
        self._model: Optional[Any] = None  # lazy load sentence-transformers

    # ------------------------------------------------------------------
    # Chunking
    # ------------------------------------------------------------------

    def chunk_filing(self, text: str, metadata: dict) -> List[dict]:
        """Split *text* into overlapping character-based chunks.

        Parameters
        ----------
        text:
            Raw filing text.
        metadata:
            Dict with keys: symbol, cik, form_type, filing_date,
            accepted_datetime, section, accession_number.

        Returns
        -------
        List of dicts with keys: text, metadata, char_start, char_end,
        chunk_index.
        """
        if not text:
            return []

        chunks: List[dict] = []
        start = 0
        chunk_idx = 0
        text_len = len(text)

        while start < text_len:
            end = min(start + self.chunk_size, text_len)
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append({
                    "id": str(uuid.uuid4()),
                    "text": chunk_text,
                    "metadata": {**metadata, "chunk_index": chunk_idx},
                    "char_start": start,
                    "char_end": end,
                    "chunk_index": chunk_idx,
                })
                chunk_idx += 1
            # Advance by (chunk_size - overlap) for sliding window
            step = max(1, self.chunk_size - self.chunk_overlap)
            start += step

        log.debug(
            "sec_chunker %s %s: %d chunks from %d chars",
            metadata.get("symbol", "?"),
            metadata.get("form_type", "?"),
            len(chunks),
            text_len,
        )
        return chunks

    def chunk_all_filings(
        self,
        filing_texts: Dict[str, str],
        filings_df: pd.DataFrame,
    ) -> List[dict]:
        """Chunk all filings in *filing_texts* using metadata from *filings_df*.

        Parameters
        ----------
        filing_texts:
            ``{accessionNumber: text}``
        filings_df:
            DataFrame with metadata; accessionNumber is used as join key.
        """
        # Build lookup from accessionNumber → row metadata
        meta_lookup: Dict[str, dict] = {}
        if not filings_df.empty and "accessionNumber" in filings_df.columns:
            for _, row in filings_df.iterrows():
                acc = row.get("accessionNumber", "")
                if acc:
                    meta_lookup[acc] = {
                        "symbol": row.get("symbol", ""),
                        "cik": row.get("cik", ""),
                        "form_type": row.get("form", ""),
                        "filing_date": str(row.get("filingDate", "")),
                        "accepted_datetime": str(row.get("acceptedDatetime", "")),
                        "accession_number": acc,
                        "section": "full",
                    }

        all_chunks: List[dict] = []
        for acc, text in filing_texts.items():
            metadata = meta_lookup.get(acc, {"accession_number": acc, "section": "full"})
            chunks = self.chunk_filing(text, metadata)
            all_chunks.extend(chunks)

        log.info(
            "sec_chunker: %d total chunks from %d filings",
            len(all_chunks),
            len(filing_texts),
        )
        return all_chunks

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------

    def embed_chunks(self, chunks: List[dict]) -> List[dict]:
        """Add ``embedding`` (numpy array, dim=384) to each chunk dict.

        Uses ``all-MiniLM-L6-v2`` via sentence-transformers in batches
        of 64 for efficiency.
        """
        if not chunks:
            return chunks

        model = self._load_model()
        if model is None:
            log.error("sec_chunker: sentence-transformers not available; skipping embeddings")
            return chunks

        import numpy as np  # noqa: PLC0415

        texts = [c["text"] for c in chunks]
        batch_size = 64
        all_embeddings: list = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i: i + batch_size]
            try:
                embs = model.encode(batch, show_progress_bar=False)
                all_embeddings.extend(embs)
            except Exception as e:
                log.error("sec_chunker: embedding batch %d failed — %s", i // batch_size, e)
                all_embeddings.extend([None] * len(batch))

        for chunk, emb in zip(chunks, all_embeddings):
            chunk["embedding"] = emb

        log.info("sec_chunker: embedded %d chunks", len(chunks))
        return chunks

    def _load_model(self) -> Optional[Any]:
        """Lazily load sentence-transformers model."""
        if self._model is not None:
            return self._model
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore

            self._model = SentenceTransformer(self.embedding_model_name)
            log.info("sec_chunker: loaded embedding model '%s'", self.embedding_model_name)
        except ImportError:
            log.error(
                "sec_chunker: sentence-transformers not installed; "
                "pip install sentence-transformers"
            )
            return None
        except Exception as e:
            log.error("sec_chunker: failed to load model '%s' — %s", self.embedding_model_name, e)
            return None
        return self._model

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_local(self, chunks: List[dict], output_dir: str) -> None:
        """Save chunks to JSONL and embedded chunks to Parquet.

        Files written:
        - ``sec_rag_chunks.jsonl``         — chunks without embeddings
        - ``sec_rag_chunks_embedded.parquet`` — chunks with embeddings as lists
        """
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        # JSONL — strip embedding field for leaner file
        jsonl_path = out / "sec_rag_chunks.jsonl"
        with open(jsonl_path, "w") as f:
            for chunk in chunks:
                record = {k: v for k, v in chunk.items() if k != "embedding"}
                f.write(json.dumps(record, default=str) + "\n")
        log.info("sec_chunker: %d chunks written to %s", len(chunks), jsonl_path)

        # Parquet — include embeddings as Python lists
        embedded = [c for c in chunks if c.get("embedding") is not None]
        if embedded:
            rows = []
            for c in embedded:
                emb = c["embedding"]
                emb_list = emb.tolist() if hasattr(emb, "tolist") else list(emb)
                rows.append({
                    "id": c.get("id", ""),
                    "text": c["text"],
                    "embedding": emb_list,
                    "char_start": c.get("char_start"),
                    "char_end": c.get("char_end"),
                    "chunk_index": c.get("chunk_index"),
                    "metadata": json.dumps(c.get("metadata", {}), default=str),
                })
            parquet_path = out / "sec_rag_chunks_embedded.parquet"
            pd.DataFrame(rows).to_parquet(parquet_path, index=False)
            log.info("sec_chunker: %d embedded chunks written to %s", len(embedded), parquet_path)

    def to_pgvector_rows(self, chunks: List[dict]) -> pd.DataFrame:
        """Convert embedded chunks to pgvector-compatible DataFrame.

        Returns DataFrame with columns: id, content, embedding (list),
        metadata (JSON string).
        """
        rows = []
        for c in chunks:
            emb = c.get("embedding")
            if emb is None:
                continue
            emb_list = emb.tolist() if hasattr(emb, "tolist") else list(emb)
            rows.append({
                "id": c.get("id", str(uuid.uuid4())),
                "content": c["text"],
                "embedding": emb_list,
                "metadata": json.dumps(c.get("metadata", {}), default=str),
            })
        return pd.DataFrame(rows)
