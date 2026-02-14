"""
Chat/AI Copilot API endpoints with RAG integration and QuantTrade Stock Analysis.
"""
from datetime import datetime, timedelta, timezone
import re
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.chat_history import ChatHistory
from app.models.user import User
from app.services.rag_service import RAGService
from app.services.stock_analysis_client import fetch_stock_prediction
from app.services.fmp_client import get_fundamentals_snapshot
from app.services.quote_cache import QuoteCacheService
from app.api.auth import get_current_user, require_auth

router = APIRouter()
rag_service = RAGService()


class ChatMessage(BaseModel):
    message: str
    symbol: Optional[str] = None
    include_news: bool = True
    include_filings: bool = True
    top_k: int = 5
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    sources: List[str]
    context_docs: int
    symbol: Optional[str] = None
    session_id: Optional[str] = None
    analysis_summary: Optional[str] = None


class ChatHistoryItem(BaseModel):
    id: int
    role: str
    content: str
    symbol: Optional[str]
    session_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/chat", response_model=ChatResponse)
async def chat(
    message: ChatMessage,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    AI copilot chat endpoint with RAG, QuantTrade Stock Analysis integration,
    simple Apple->AAPL symbol resolution, and per-user stock limits.
    """
    symbol_id = None
    resolved_symbol: Optional[str] = None

    # ------------------------------------------------------------------
    # 1) Resolve symbol from explicit field OR from free text
    # ------------------------------------------------------------------
    raw_symbol_input = (message.symbol or "").strip()

    def _resolve_symbol(candidate: str) -> Optional[Symbol]:
        """Try resolving a single token as ticker first, then as company name."""
        if not candidate:
            return None
        # Exact ticker
        db_symbol = db.query(Symbol).filter(Symbol.symbol == candidate.upper()).first()
        if db_symbol:
            return db_symbol
        # Fuzzy company name match, prefer highest market cap
        return (
            db.query(Symbol)
            .filter(Symbol.name.ilike(f"%{candidate}%"))
            .order_by(Symbol.market_cap.desc().nullslast())
            .first()
        )

    db_symbol_obj: Optional[Symbol] = None

    if raw_symbol_input:
        db_symbol_obj = _resolve_symbol(raw_symbol_input)
    else:
        # No explicit symbol field – try to infer from the message text.
        # Heuristic:
        # - Prefer tokens that look like tickers (ALL CAPS, <=5 chars)
        # - Then capitalized words (e.g. "Apple") as company names
        raw_tokens = re.findall(r"[A-Za-z]{2,15}", message.message)
        ticker_like = [t for t in raw_tokens if t.isupper() and 1 <= len(t) <= 5]
        name_like = [t for t in raw_tokens if t[0].isupper() and t[1:].islower()]
        tokens = ticker_like + name_like
        seen = set()
        for token in tokens:
            t = token.strip()
            if not t or t.lower() in seen:
                continue
            seen.add(t.lower())
            db_symbol_obj = _resolve_symbol(t)
            if db_symbol_obj:
                break

    if db_symbol_obj:
        symbol_id = db_symbol_obj.id
        resolved_symbol = db_symbol_obj.symbol.upper()
    elif raw_symbol_input:
        # If symbol not found but user explicitly provided something, keep it.
        resolved_symbol = raw_symbol_input.upper()

    # Ensure we have a session id for grouping messages
    session_id = message.session_id or str(uuid.uuid4())
    user_id = current_user.id if current_user else None
    symbol_value = resolved_symbol  # stored in history

    # ------------------------------------------------------------------
    # 2) Enforce simple stock-analysis quotas over a rolling 12h window
    #    - Authenticated user: up to 10 distinct symbols / 12h
    #    - Anonymous (session only): up to 5 distinct symbols / 12h
    # ------------------------------------------------------------------
    if symbol_value:
        window_start = datetime.now(timezone.utc) - timedelta(hours=12)
        base_q = db.query(ChatHistory).filter(
            ChatHistory.symbol.isnot(None),
            ChatHistory.created_at >= window_start,
        )
        if current_user:
            base_q = base_q.filter(ChatHistory.user_id == current_user.id)
            max_symbols = 10
        else:
            base_q = base_q.filter(ChatHistory.session_id == session_id)
            max_symbols = 5

        distinct_symbols = {row.symbol for row in base_q.with_entities(ChatHistory.symbol).distinct()}
        if symbol_value not in distinct_symbols and len(distinct_symbols) >= max_symbols:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Stock analysis limit reached for this 12-hour window: "
                    f"max {max_symbols} symbols. Please try again later or "
                    f"upgrade your plan in settings."
                ),
            )

    # ------------------------------------------------------------------
    # 3) Fetch real-time quote (Yahoo direct / yfinance / Finnhub via cache)
    # ------------------------------------------------------------------
    realtime_snippet: Optional[str] = None
    if resolved_symbol:
        try:
            quote_service = QuoteCacheService(db)
            quote = await quote_service.get_quote(resolved_symbol)
            if quote and not quote.get("unavailable"):
                price = quote.get("price")
                change = quote.get("change")
                change_pct = quote.get("change_percent")
                source = quote.get("data_source", "unknown")
                if price is not None:
                    realtime_snippet = (
                        f"[REALTIME QUOTE]\n"
                        f"Symbol: {resolved_symbol}\n"
                        f"Last price: {price:.2f}\n"
                        f"Change: {change:+.2f} ({change_pct:+.2f}%)\n"
                        f"Data source: {source}\n"
                    )
        except Exception as exc:  # pragma: no cover - defensive
            print(f"⚠️ Realtime quote fetch failed for {resolved_symbol}: {exc}")
            realtime_snippet = None

    # ------------------------------------------------------------------
    # 4) Fetch QuantTrade Stock Analysis summary (prediction service)
    # ------------------------------------------------------------------
    prediction_summary: Optional[str] = None
    if resolved_symbol:
        prediction_summary = fetch_stock_prediction(resolved_symbol)

    # ------------------------------------------------------------------
    # 5) Fetch FMP fundamentals snapshot (within 20 req/hour budget)
    # ------------------------------------------------------------------
    fundamentals_snippet: Optional[str] = None
    if resolved_symbol:
        fundamentals_snippet = get_fundamentals_snapshot(resolved_symbol)

    # ------------------------------------------------------------------
    # 6) Build augmented query for RAG: include quote + analysis summary + FMP
    # ------------------------------------------------------------------
    sections: List[str] = []
    if realtime_snippet:
        sections.append(realtime_snippet)
    if fundamentals_snippet:
        sections.append(f"[FUNDAMENTALS]\n{fundamentals_snippet}")
    if prediction_summary:
        sections.append(
            f"[QUANTTRADE STOCK ANALYSIS SUMMARY FOR {resolved_symbol}]\n"
            f"{prediction_summary}"
        )
    sections.append(f"[USER QUESTION]\n{message.message}")
    augmented_query = "\n\n".join(sections)

    # Query RAG service
    result = rag_service.query(
        db=db,
        query=augmented_query,
        symbol=resolved_symbol,
        symbol_id=symbol_id,
        include_news=message.include_news,
        include_filings=message.include_filings,
        top_k=message.top_k,
    )

    # Persist chat messages (user + assistant). Fail soft if something goes wrong.
    try:
        now = datetime.now(timezone.utc)
        user_msg = ChatHistory(
            user_id=user_id,
            session_id=session_id,
            symbol=symbol_value,
            role="user",
            content=message.message,
            created_at=now,
        )
        assistant_msg = ChatHistory(
            user_id=user_id,
            session_id=session_id,
            symbol=symbol_value,
            role="assistant",
            content=result["response"],
            created_at=now,
        )
        db.add_all([user_msg, assistant_msg])
        db.commit()
    except Exception as e:
        print(f"⚠️ Failed to save chat history: {e}")
        db.rollback()

    return ChatResponse(
        response=result["response"],
        sources=result.get("sources", []),
        context_docs=result.get("context_docs", 0),
        symbol=resolved_symbol or message.symbol,
        session_id=session_id,
        analysis_summary=prediction_summary,
    )


@router.get("/chat/history", response_model=List[ChatHistoryItem])
async def get_chat_history(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(require_auth),
):
    """Get recent chat history for the authenticated user"""
    history = (
        db.query(ChatHistory)
        .filter(ChatHistory.user_id == user.id)
        .order_by(ChatHistory.created_at.desc())
        .limit(limit)
        .all()
    )
    return history