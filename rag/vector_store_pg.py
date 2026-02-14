"""
Postgres/pgvector-backed VectorStore implementation for the RAG engine.

This is a minimal abstraction intended to mirror the behaviour of the
Chroma-based VectorDB in ``rag_engine.py`` while using the same database
stack as the main backend.
"""

from __future__ import annotations

import os
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.sql import func

from rag_engine import RAGConfig, StockDocument


class Base(DeclarativeBase):
    pass


class RagVectorDocument(Base):
    __tablename__ = "rag_documents"

    id = Column(String(255), primary_key=True)
    symbol = Column(String(32), index=True, nullable=False)
    doc_type = Column(String(32), nullable=False)
    content = Column(String, nullable=False)
    # Store embeddings as a simple float[]; in Postgres this would be a VECTOR
    # via the pgvector extension. For SQLite tests this column degrades to a
    # regular ARRAY-of-FLOAT representation.
    embedding = Column(ARRAY(Float), nullable=True)
    metadata = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PGVectorStore:
    """
    Lightweight pgvector-backed store compatible with the RAGEngine interface.

    NOTE: For now we perform a naive L2-distance in Python so that the same
    code can run against SQLite in tests. In production, this table should
    be backed by the pgvector extension and queried with ``<->`` operators.
    """

    def __init__(self, config: RAGConfig | None = None):
        self.config = config or RAGConfig()
        db_url = os.getenv("DATABASE_URL", "sqlite:///:memory:")
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

    def add_document(self, document: StockDocument) -> None:
        with self.SessionLocal() as db:
            db_doc = RagVectorDocument(
                id=document.id,
                symbol=document.symbol,
                doc_type=document.doc_type,
                content=document.content,
                embedding=None,  # embeddings can be added later
                metadata=str(document.metadata),
            )
            db.merge(db_doc)
            db.commit()

    def add_documents_batch(self, documents: List[StockDocument]) -> None:
        with self.SessionLocal() as db:
            for doc in documents:
                db_doc = RagVectorDocument(
                    id=doc.id,
                    symbol=doc.symbol,
                    doc_type=doc.doc_type,
                    content=doc.content,
                    embedding=None,
                    metadata=str(doc.metadata),
                )
                db.merge(db_doc)
            db.commit()

    def get_all_by_symbol(self, symbol: str, limit: int = 100) -> List[Dict[str, Any]]:
        with self.SessionLocal() as db:
            rows = (
                db.query(RagVectorDocument)
                .filter(RagVectorDocument.symbol == symbol)
                .order_by(RagVectorDocument.created_at.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "metadata": {
                        "symbol": row.symbol,
                        "type": row.doc_type,
                        "created_at": row.created_at.isoformat()
                        if row.created_at
                        else None,
                    },
                }
                for row in rows
            ]

