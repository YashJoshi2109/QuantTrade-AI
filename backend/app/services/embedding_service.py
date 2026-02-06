"""
Embedding service for generating vector embeddings
Supports both local (sentence_transformers) and cloud (OpenAI) embeddings
"""
from typing import List, Optional
import numpy as np
from app.config import settings
import json

# Try to import sentence_transformers, fall back to OpenAI if not available
SENTENCE_TRANSFORMERS_AVAILABLE = False
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    pass


class EmbeddingService:
    """Service for generating text embeddings"""
    
    def __init__(self, use_openai: bool = None):
        """
        Initialize embedding service.
        
        Args:
            use_openai: If True, use OpenAI embeddings. If False, use local model.
                       If None, auto-detect based on availability.
        """
        self._model = None
        self._openai_client = None
        
        # Auto-detect which backend to use
        if use_openai is None:
            self.use_openai = not SENTENCE_TRANSFORMERS_AVAILABLE
        else:
            self.use_openai = use_openai
        
        if self.use_openai:
            self.model_name = "text-embedding-3-small"  # OpenAI embedding model
            self.embedding_dim = 1536  # OpenAI dimension
        else:
            self.model_name = "all-MiniLM-L6-v2"  # Local model
            self.embedding_dim = 384
    
    @property
    def model(self):
        """Lazy load the local embedding model"""
        if not self.use_openai and self._model is None:
            print(f"Loading local embedding model: {self.model_name}")
            self._model = SentenceTransformer(self.model_name)
        return self._model
    
    @property
    def openai_client(self):
        """Lazy load OpenAI client"""
        if self.use_openai and self._openai_client is None:
            from openai import OpenAI
            self._openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
        return self._openai_client
    
    def embed_text(self, text: str) -> List[float]:
        """Generate embedding for a single text"""
        if not text or not text.strip():
            return [0.0] * self.embedding_dim
        
        if self.use_openai:
            try:
                response = self.openai_client.embeddings.create(
                    model=self.model_name,
                    input=text[:8191]  # OpenAI max input length
                )
                return response.data[0].embedding
            except Exception as e:
                print(f"OpenAI embedding error: {e}")
                return [0.0] * self.embedding_dim
        else:
            embedding = self.model.encode(text, convert_to_numpy=True)
            return embedding.tolist()
    
    def embed_batch(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        """Generate embeddings for multiple texts"""
        if not texts:
            return []
        
        # Filter empty texts
        valid_texts = [t if t and t.strip() else " " for t in texts]
        
        if self.use_openai:
            try:
                # OpenAI can handle batches up to ~2048 inputs
                results = []
                for i in range(0, len(valid_texts), batch_size):
                    batch = valid_texts[i:i + batch_size]
                    # Truncate each text to max length
                    batch = [t[:8191] for t in batch]
                    response = self.openai_client.embeddings.create(
                        model=self.model_name,
                        input=batch
                    )
                    results.extend([d.embedding for d in response.data])
                return results
            except Exception as e:
                print(f"OpenAI batch embedding error: {e}")
                return [[0.0] * self.embedding_dim] * len(texts)
        else:
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
