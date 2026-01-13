"""
Chat/AI Copilot API endpoints with RAG integration
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.symbol import Symbol
from app.services.rag_service import RAGService

router = APIRouter()
rag_service = RAGService()


class ChatMessage(BaseModel):
    message: str
    symbol: Optional[str] = None
    include_news: bool = True
    include_filings: bool = True
    top_k: int = 5


class ChatResponse(BaseModel):
    response: str
    sources: List[str]
    context_docs: int
    symbol: Optional[str] = None


@router.post("/chat", response_model=ChatResponse)
async def chat(
    message: ChatMessage,
    db: Session = Depends(get_db)
):
    """AI copilot chat endpoint with RAG"""
    symbol_id = None
    
    if message.symbol:
        db_symbol = db.query(Symbol).filter(
            Symbol.symbol == message.symbol.upper()
        ).first()
        if db_symbol:
            symbol_id = db_symbol.id
        else:
            # Symbol not found, but continue anyway
            pass
    
    # Query RAG service
    result = rag_service.query(
        db=db,
        query=message.message,
        symbol=message.symbol,
        symbol_id=symbol_id,
        include_news=message.include_news,
        include_filings=message.include_filings,
        top_k=message.top_k
    )
    
    return ChatResponse(
        response=result["response"],
        sources=result.get("sources", []),
        context_docs=result.get("context_docs", 0),
        symbol=message.symbol
    )
