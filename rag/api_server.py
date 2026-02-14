"""
QuantTrade AI - RAG API Server
FastAPI backend for stock analysis using RAG
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import asyncio
import os

from rag_engine import RAGEngine, RAGConfig, VectorDB
from data_ingestion import DataIngestionPipeline

# ============================================================================
# INITIALIZE APP
# ============================================================================

app = FastAPI(
    title="QuantTrade AI RAG API",
    description="Stock analysis API using Retrieval-Augmented Generation",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize RAG engine
config = RAGConfig()
rag_engine = RAGEngine(config)
vector_db = VectorDB(config)
ingestion_pipeline = DataIngestionPipeline(
    vector_db=vector_db,
    alpha_vantage_key=os.getenv("ALPHA_VANTAGE_API_KEY"),
    fmp_key=os.getenv("FMP_API_KEY")
)

# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class AnalysisRequest(BaseModel):
    """Request model for stock analysis."""
    symbol: str
    analysis_type: str  # fundamental, sentiment, technical, holistic
    stream: bool = False

class ChatRequest(BaseModel):
    """Request model for chat interface."""
    symbol: str
    message: str
    conversation_history: List[Dict[str, str]] = []
    stream: bool = False

class CompareRequest(BaseModel):
    """Request model for stock comparison."""
    symbols: List[str]
    analysis_type: str = "holistic"

class IngestionRequest(BaseModel):
    """Request model for data ingestion."""
    symbols: List[str]

class AnalysisResponse(BaseModel):
    """Response model for analysis."""
    symbol: str
    analysis_type: str
    result: str
    timestamp: datetime
    sources: List[str] = []

class ChatResponse(BaseModel):
    """Response model for chat."""
    message: str
    timestamp: datetime

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "QuantTrade AI RAG API",
        "version": "1.0.0",
        "endpoints": {
            "analyze": "/api/analyze/stock",
            "chat": "/api/chat/stock",
            "compare": "/api/analyze/compare",
            "ingest": "/api/ingest"
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

# ============================================================================
# ANALYSIS ENDPOINTS
# ============================================================================

@app.post("/api/analyze/stock", response_model=AnalysisResponse)
async def analyze_stock(request: AnalysisRequest):
    """
    Analyze a stock using RAG.
    
    Analysis types:
    - fundamental: Financial metrics, valuation, balance sheet
    - sentiment: News analysis, social media, analyst ratings
    - technical: Price trends, indicators, patterns
    - holistic: Combined analysis with recommendation
    """
    try:
        # Validate analysis type
        valid_types = ["fundamental", "sentiment", "technical", "holistic"]
        if request.analysis_type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid analysis_type. Must be one of: {', '.join(valid_types)}"
            )
        
        # Handle streaming response
        if request.stream:
            async def generate():
                for chunk in rag_engine.analyze(
                    symbol=request.symbol,
                    analysis_type=request.analysis_type,
                    stream=True
                ):
                    yield f"data: {chunk}\n\n"
                yield "data: [DONE]\n\n"
            
            return StreamingResponse(
                generate(),
                media_type="text/event-stream"
            )
        
        # Non-streaming response
        result = rag_engine.analyze(
            symbol=request.symbol,
            analysis_type=request.analysis_type,
            stream=False
        )
        
        return AnalysisResponse(
            symbol=request.symbol,
            analysis_type=request.analysis_type,
            result=result,
            timestamp=datetime.now(),
            sources=[]
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/analyze/fundamental")
async def analyze_fundamental(symbol: str, stream: bool = False):
    """Perform fundamental analysis on a stock."""
    return await analyze_stock(AnalysisRequest(
        symbol=symbol,
        analysis_type="fundamental",
        stream=stream
    ))

@app.post("/api/analyze/sentiment")
async def analyze_sentiment(symbol: str, stream: bool = False):
    """Perform sentiment analysis on a stock."""
    return await analyze_stock(AnalysisRequest(
        symbol=symbol,
        analysis_type="sentiment",
        stream=stream
    ))

@app.post("/api/analyze/technical")
async def analyze_technical(symbol: str, stream: bool = False):
    """Perform technical analysis on a stock."""
    return await analyze_stock(AnalysisRequest(
        symbol=symbol,
        analysis_type="technical",
        stream=stream
    ))

@app.post("/api/analyze/holistic")
async def analyze_holistic(symbol: str, stream: bool = False):
    """Perform holistic (combined) analysis on a stock."""
    return await analyze_stock(AnalysisRequest(
        symbol=symbol,
        analysis_type="holistic",
        stream=stream
    ))

@app.post("/api/analyze/compare")
async def compare_stocks(request: CompareRequest):
    """
    Compare multiple stocks.
    
    Provides side-by-side comparison of fundamental, sentiment, and technical metrics.
    """
    try:
        if len(request.symbols) < 2:
            raise HTTPException(
                status_code=400,
                detail="At least 2 symbols required for comparison"
            )
        
        if len(request.symbols) > 5:
            raise HTTPException(
                status_code=400,
                detail="Maximum 5 symbols allowed for comparison"
            )
        
        # Get analysis for each symbol
        results = {}
        for symbol in request.symbols:
            result = rag_engine.analyze(
                symbol=symbol,
                analysis_type=request.analysis_type,
                stream=False
            )
            results[symbol] = result
        
        # TODO: Implement comparative analysis prompt
        # For now, return individual analyses
        
        return {
            "symbols": request.symbols,
            "analysis_type": request.analysis_type,
            "results": results,
            "timestamp": datetime.now().isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# CHAT ENDPOINT
# ============================================================================

@app.post("/api/chat/stock", response_model=ChatResponse)
async def chat_stock(request: ChatRequest):
    """
    Chat interface for stock analysis.
    
    Allows conversational queries about a specific stock with context awareness.
    """
    try:
        if request.stream:
            async def generate():
                for chunk in rag_engine.chat(
                    symbol=request.symbol,
                    message=request.message,
                    conversation_history=request.conversation_history,
                    stream=True
                ):
                    yield f"data: {chunk}\n\n"
                yield "data: [DONE]\n\n"
            
            return StreamingResponse(
                generate(),
                media_type="text/event-stream"
            )
        
        result = rag_engine.chat(
            symbol=request.symbol,
            message=request.message,
            conversation_history=request.conversation_history,
            stream=False
        )
        
        return ChatResponse(
            message=result,
            timestamp=datetime.now()
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# DATA MANAGEMENT ENDPOINTS
# ============================================================================

@app.post("/api/ingest")
async def ingest_data(request: IngestionRequest, background_tasks: BackgroundTasks):
    """
    Trigger data ingestion for specified stocks.
    
    This runs in the background and populates the vector database.
    """
    try:
        # Add ingestion task to background
        background_tasks.add_task(
            ingestion_pipeline.ingest_multiple_stocks,
            request.symbols
        )
        
        return {
            "status": "ingestion_started",
            "symbols": request.symbols,
            "timestamp": datetime.now().isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stocks/{symbol}/documents")
async def get_stock_documents(symbol: str, collection: str = "fundamentals"):
    """Get all documents for a stock from a specific collection."""
    try:
        documents = vector_db.get_all_by_symbol(collection, symbol)
        return {
            "symbol": symbol,
            "collection": collection,
            "count": len(documents),
            "documents": documents
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/stocks/{symbol}/documents")
async def delete_stock_documents(symbol: str, collection: str = "fundamentals"):
    """Delete all documents for a stock from a specific collection."""
    try:
        vector_db.delete_by_symbol(collection, symbol)
        return {
            "status": "deleted",
            "symbol": symbol,
            "collection": collection,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# RUN SERVER
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api_server:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
