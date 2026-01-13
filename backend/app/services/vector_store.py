"""
Vector store service for RAG - supports pgvector and Qdrant
"""
from typing import List, Dict, Optional
import numpy as np
from app.config import settings

# Try to import pgvector support
try:
    from pgvector.sqlalchemy import Vector
    PGVECTOR_AVAILABLE = True
except ImportError:
    PGVECTOR_AVAILABLE = False

# Try to import Qdrant
try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False


class VectorStore:
    """Unified interface for vector storage"""
    
    def __init__(self, backend: str = "pgvector"):
        """
        Initialize vector store
        
        Args:
            backend: "pgvector" or "qdrant"
        """
        self.backend = backend
        
        if backend == "qdrant" and QDRANT_AVAILABLE:
            qdrant_url = getattr(settings, 'QDRANT_URL', 'http://localhost:6333')
            self.client = QdrantClient(url=qdrant_url)
        elif backend == "pgvector" and not PGVECTOR_AVAILABLE:
            raise ValueError("pgvector not available. Install pgvector extension.")
    
    def store_embeddings(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        metadata: List[Dict],
        ids: Optional[List[str]] = None
    ):
        """Store embeddings with metadata"""
        if self.backend == "qdrant" and QDRANT_AVAILABLE:
            return self._store_qdrant(collection_name, embeddings, metadata, ids)
        elif self.backend == "pgvector":
            return self._store_pgvector(collection_name, embeddings, metadata, ids)
        else:
            raise ValueError(f"Backend {self.backend} not available")
    
    def search(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int = 10,
        filter: Optional[Dict] = None
    ) -> List[Dict]:
        """Search for similar embeddings"""
        if self.backend == "qdrant" and QDRANT_AVAILABLE:
            return self._search_qdrant(collection_name, query_embedding, top_k, filter)
        elif self.backend == "pgvector":
            return self._search_pgvector(collection_name, query_embedding, top_k, filter)
        else:
            raise ValueError(f"Backend {self.backend} not available")
    
    def _store_qdrant(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        metadata: List[Dict],
        ids: Optional[List[str]] = None
    ):
        """Store in Qdrant"""
        if not QDRANT_AVAILABLE:
            raise ValueError("Qdrant not available")
        
        # Create collection if it doesn't exist
        try:
            self.client.get_collection(collection_name)
        except:
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=len(embeddings[0]),
                    distance=Distance.COSINE
                )
            )
        
        # Prepare points
        points = []
        for i, (emb, meta) in enumerate(zip(embeddings, metadata)):
            point_id = ids[i] if ids else i
            points.append(
                PointStruct(
                    id=point_id,
                    vector=emb,
                    payload=meta
                )
            )
        
        self.client.upsert(collection_name=collection_name, points=points)
        return {"status": "success", "count": len(points)}
    
    def _search_qdrant(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int = 10,
        filter: Optional[Dict] = None
    ) -> List[Dict]:
        """Search in Qdrant"""
        if not QDRANT_AVAILABLE:
            raise ValueError("Qdrant not available")
        
        results = self.client.search(
            collection_name=collection_name,
            query_vector=query_embedding,
            limit=top_k,
            query_filter=filter
        )
        
        return [
            {
                "id": result.id,
                "score": result.score,
                "metadata": result.payload
            }
            for result in results
        ]
    
    def _store_pgvector(
        self,
        collection_name: str,
        embeddings: List[List[float]],
        metadata: List[Dict],
        ids: Optional[List[str]] = None
    ):
        """Store in pgvector (PostgreSQL)"""
        # This would require a database model with Vector column
        # Implementation depends on your schema
        raise NotImplementedError("pgvector storage not yet implemented")
    
    def _search_pgvector(
        self,
        collection_name: str,
        query_embedding: List[float],
        top_k: int = 10,
        filter: Optional[Dict] = None
    ) -> List[Dict]:
        """Search in pgvector"""
        # This would use SQL queries with vector similarity
        raise NotImplementedError("pgvector search not yet implemented")
