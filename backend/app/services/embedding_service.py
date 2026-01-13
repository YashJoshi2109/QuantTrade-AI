"""
Embedding service for generating vector embeddings
"""
from typing import List, Optional
import numpy as np
from sentence_transformers import SentenceTransformer
from app.config import settings
import json


class EmbeddingService:
    """Service for generating text embeddings"""
    
    def __init__(self):
        self.model_name = "all-MiniLM-L6-v2"  # Fast, good quality
        self._model = None
        self.embedding_dim = 384  # Dimension for all-MiniLM-L6-v2
    
    @property
    def model(self):
        """Lazy load the embedding model"""
        if self._model is None:
            print(f"Loading embedding model: {self.model_name}")
            self._model = SentenceTransformer(self.model_name)
        return self._model
    
    def embed_text(self, text: str) -> List[float]:
        """Generate embedding for a single text"""
        if not text or not text.strip():
            return [0.0] * self.embedding_dim
        
        embedding = self.model.encode(text, convert_to_numpy=True)
        return embedding.tolist()
    
    def embed_batch(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        """Generate embeddings for multiple texts"""
        if not texts:
            return []
        
        # Filter empty texts
        valid_texts = [t if t and t.strip() else " " for t in texts]
        
        embeddings = self.model.encode(
            valid_texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            show_progress_bar=False
        )
        
        return embeddings.tolist()
    
    def update_filing_chunk_embeddings(
        self,
        chunks: List,
        embeddings: List[List[float]]
    ):
        """Update chunk objects with embeddings"""
        for chunk, embedding in zip(chunks, embeddings):
            # Store as JSON string (will be converted to vector in DB)
            chunk.embedding = json.dumps(embedding)
    
    def similarity(self, embedding1: List[float], embedding2: List[float]) -> float:
        """Calculate cosine similarity between two embeddings"""
        vec1 = np.array(embedding1)
        vec2 = np.array(embedding2)
        
        dot_product = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return float(dot_product / (norm1 * norm2))
