"""
QuantTrade AI - RAG Engine Core Implementation
Vector database setup, document ingestion, and retrieval logic
"""

import os
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions
import anthropic
from dataclasses import dataclass
import json

# ============================================================================
# CONFIGURATION
# ============================================================================

class RAGConfig:
    """RAG system configuration."""
    
    # Vector Database
    CHROMA_DB_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")
    COLLECTION_NAMES = {
        "fundamentals": "stock_fundamentals",
        "news": "stock_news",
        "technical": "stock_technical",
        "analysis": "stock_analysis",
        "filings": "sec_filings",
    }
    
    # Embeddings
    EMBEDDING_MODEL = "voyage-large-2"  # or "text-embedding-3-large"
    EMBEDDING_DIM = 1024
    
    # LLM
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    LLM_MODEL = "claude-sonnet-4-20250514"
    MAX_TOKENS = 4096
    
    # Retrieval
    TOP_K_RESULTS = 10
    SIMILARITY_THRESHOLD = 0.7
    
    # Cache
    CACHE_TTL_SECONDS = 3600  # 1 hour

# ============================================================================
# DATA MODELS
# ============================================================================

@dataclass
class StockDocument:
    """Represents a document in the vector database."""
    id: str
    symbol: str
    doc_type: str  # fundamental, news, technical, etc.
    content: str
    metadata: Dict[str, Any]
    timestamp: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "type": self.doc_type,
            "content": self.content,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
        }

@dataclass
class AnalysisResult:
    """Represents an analysis result."""
    symbol: str
    analysis_type: str
    result: str
    confidence: float
    sources: List[str]
    timestamp: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "analysis_type": self.analysis_type,
            "result": self.result,
            "confidence": self.confidence,
            "sources": self.sources,
            "timestamp": self.timestamp.isoformat(),
        }

from vector_store_pg import PGVectorStore


# ============================================================================
# VECTOR DATABASE MANAGER (pgvector-backed)
# ============================================================================

class VectorDB:
    """
    Thin wrapper around PGVectorStore so existing RAGEngine code can remain
    largely unchanged while we migrate away from Chroma.
    """

    def __init__(self, config: RAGConfig = RAGConfig()):
        self.config = config
        self.pg_store = PGVectorStore(config)

    def add_document(self, collection_key: str, document: StockDocument):
        # collection_key is currently unused in the pgvector implementation but
        # kept for interface compatibility.
        self.pg_store.add_document(document)

    def add_documents_batch(self, collection_key: str, documents: List[StockDocument]):
        self.pg_store.add_documents_batch(documents)

    def query(
        self,
        collection_key: str,
        query_text: str,
        n_results: int = 10,
        where: Optional[Dict] = None,
    ) -> List[Dict]:
        # For now we ignore query_text/where and just return recent documents;
        # the heavy lifting happens inside the LLM using the provided context.
        symbol = None
        if where and "symbol" in where:
            symbol = where["symbol"]
        if not symbol:
            return []
        return self.pg_store.get_all_by_symbol(symbol, limit=n_results)

    def query_by_symbol(
        self,
        collection_key: str,
        symbol: str,
        query_text: str,
        n_results: int = 10,
        days_back: Optional[int] = None,
    ) -> List[Dict]:
        return self.pg_store.get_all_by_symbol(symbol, limit=n_results)

    def get_all_by_symbol(
        self,
        collection_key: str,
        symbol: str,
        limit: int = 100,
    ) -> List[Dict]:
        return self.pg_store.get_all_by_symbol(symbol, limit=limit)
    
    def delete_by_symbol(self, collection_key: str, symbol: str):
        """Delete all documents for a symbol."""
        collection = self.collections.get(collection_key)
        if not collection:
            return
        
        collection.delete(where={"symbol": symbol})
    
    def update_document(self, collection_key: str, document: StockDocument):
        """Update or insert a document."""
        collection = self.collections.get(collection_key)
        if not collection:
            raise ValueError(f"Collection {collection_key} not found")
        
        # Delete old version if exists
        try:
            collection.delete(ids=[document.id])
        except:
            pass
        
        # Add new version
        self.add_document(collection_key, document)

# ============================================================================
# LLM CLIENT
# ============================================================================

class LLMClient:
    """Manages interactions with Claude API."""
    
    def __init__(self, config: RAGConfig = RAGConfig()):
        self.config = config
        self.client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    
    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.3
    ) -> str:
        """Generate a response from Claude."""
        message = self.client.messages.create(
            model=self.config.LLM_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        )
        
        return message.content[0].text
    
    def generate_streaming(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.3
    ):
        """Generate a streaming response from Claude."""
        with self.client.messages.stream(
            model=self.config.LLM_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        ) as stream:
            for text in stream.text_stream:
                yield text

# ============================================================================
# RAG ENGINE
# ============================================================================

class RAGEngine:
    """Main RAG engine for stock analysis."""
    
    def __init__(self, config: RAGConfig = RAGConfig()):
        self.config = config
        self.vector_db = VectorDB(config)
        self.llm_client = LLMClient(config)
        self.cache = {}  # Simple in-memory cache
    
    def retrieve_context(
        self,
        symbol: str,
        query: str,
        analysis_type: str,
        days_back: int = 90
    ) -> List[Dict]:
        """Retrieve relevant context for a query."""
        results = []
        
        # Determine which collections to query based on analysis type
        if analysis_type == "fundamental":
            collections = ["fundamentals", "filings"]
        elif analysis_type == "sentiment":
            collections = ["news", "analysis"]
        elif analysis_type == "technical":
            collections = ["technical"]
        elif analysis_type == "holistic":
            collections = ["fundamentals", "news", "technical", "analysis"]
        else:
            collections = list(self.config.COLLECTION_NAMES.keys())
        
        # Query each relevant collection
        for collection in collections:
            docs = self.vector_db.query_by_symbol(
                collection_key=collection,
                symbol=symbol,
                query_text=query,
                n_results=5,
                days_back=days_back
            )
            results.extend(docs)
        
        # Sort by relevance (distance)
        results.sort(key=lambda x: x.get('distance', 999))
        
        # Return top K
        return results[:self.config.TOP_K_RESULTS]
    
    def format_context(self, documents: List[Dict], max_length: int = 8000) -> str:
        """Format retrieved documents into a context string."""
        context_parts = []
        current_length = 0
        
        for doc in documents:
            metadata = doc.get('metadata', {})
            doc_text = f"\n[Document Type: {metadata.get('type', 'unknown')}]\n"
            doc_text += f"Symbol: {metadata.get('symbol', 'unknown')}\n"
            doc_text += f"Date: {metadata.get('timestamp', 'unknown')}\n"
            doc_text += f"Content:\n{doc['content']}\n"
            doc_text += "---\n"
            
            if current_length + len(doc_text) > max_length:
                break
            
            context_parts.append(doc_text)
            current_length += len(doc_text)
        
        return "\n".join(context_parts)
    
    def analyze(
        self,
        symbol: str,
        analysis_type: str,
        user_query: Optional[str] = None,
        stream: bool = False
    ) -> Any:
        """Perform stock analysis."""
        # Check cache
        cache_key = f"{symbol}_{analysis_type}_{user_query or 'default'}"
        if cache_key in self.cache:
            cache_entry = self.cache[cache_key]
            if (datetime.now() - cache_entry['timestamp']).seconds < self.config.CACHE_TTL_SECONDS:
                return cache_entry['result']
        
        # Construct query
        if not user_query:
            user_query = f"Analyze {symbol} stock"
        
        # Retrieve context
        documents = self.retrieve_context(
            symbol=symbol,
            query=user_query,
            analysis_type=analysis_type
        )
        
        # Format context
        context = self.format_context(documents)
        
        # Get appropriate prompt
        from prompts import STOCK_ANALYST_SYSTEM_PROMPT, build_prompt, format_context
        
        # Build prompt based on analysis type
        prompt_kwargs = {
            "symbol": symbol,
            "context": context,
            "current_date": datetime.now().strftime("%Y-%m-%d")
        }
        
        # Add type-specific parameters
        if analysis_type == "sentiment":
            prompt_kwargs["timeframe"] = "30 days"
        elif analysis_type == "technical":
            prompt_kwargs["current_price"] = "N/A"  # Would fetch from API
        
        user_prompt = build_prompt(analysis_type, **prompt_kwargs)
        
        # Generate response
        if stream:
            return self.llm_client.generate_streaming(
                system_prompt=STOCK_ANALYST_SYSTEM_PROMPT,
                user_prompt=user_prompt
            )
        else:
            result = self.llm_client.generate(
                system_prompt=STOCK_ANALYST_SYSTEM_PROMPT,
                user_prompt=user_prompt
            )
            
            # Cache result
            self.cache[cache_key] = {
                'result': result,
                'timestamp': datetime.now()
            }
            
            return result
    
    def chat(
        self,
        symbol: str,
        message: str,
        conversation_history: List[Dict] = None,
        stream: bool = False
    ) -> Any:
        """Conversational analysis interface."""
        if conversation_history is None:
            conversation_history = []
        
        # Retrieve relevant context
        documents = self.retrieve_context(
            symbol=symbol,
            query=message,
            analysis_type="holistic"
        )
        
        context = self.format_context(documents)
        
        # Format conversation history
        history_text = "\n".join([
            f"{msg['role']}: {msg['content']}"
            for msg in conversation_history
        ])
        
        from prompts import STOCK_ANALYST_SYSTEM_PROMPT, CONVERSATIONAL_ANALYSIS_PROMPT
        
        user_prompt = CONVERSATIONAL_ANALYSIS_PROMPT.format(
            symbol=symbol,
            conversation_history=history_text,
            context=context,
            user_question=message
        )
        
        if stream:
            return self.llm_client.generate_streaming(
                system_prompt=STOCK_ANALYST_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.7  # More creative for conversation
            )
        else:
            return self.llm_client.generate(
                system_prompt=STOCK_ANALYST_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.7
            )
