"""
Chat/AI Copilot API endpoints with RAG integration and QuantTrade Stock Analysis.
Supports structured visual responses for stock analysis, comparisons, screeners, and sectors.
"""
from datetime import datetime, timedelta, timezone
import re
import uuid
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.symbol import Symbol
from app.models.chat_history import ChatHistory, Conversation
from app.models.user import User
from app.services.rag_service import RAGService
from app.services.stock_analysis_client import fetch_stock_prediction
from app.services.fmp_client import get_fundamentals_snapshot
from app.services.quote_cache import QuoteCacheService
from app.services.indicators import IndicatorService
from app.services.risk_scorer import RiskScorer
from app.services.comprehensive_analysis import build_comprehensive_analysis
from app.models.fundamentals import Fundamentals
from app.api.auth import get_current_user, require_auth

router = APIRouter()
rag_service = RAGService()


# ---------------------------------------------------------------------------
# Intent detection keywords
# ---------------------------------------------------------------------------
ANALYSIS_KEYWORDS = [
    "analyze", "analysis", "tell me about", "how is", "what about",
    "look at", "research", "review", "evaluate", "assess", "check",
    "price of", "forecast", "predict", "outlook", "comprehensive",
    "stock price", "give me", "show me", "what is", "how about",
    "overview", "deep dive", "breakdown", "insight",
]
COMPARISON_KEYWORDS = ["compare", "vs", "versus", "against", "difference between"]
SCREENER_KEYWORDS = [
    "top gainers", "top losers", "gainers", "losers", "screener",
    "best performing", "worst performing", "movers", "biggest gains",
    "biggest losses",
]
SECTOR_KEYWORDS = [
    "sector performance", "sectors", "sector breakdown",
    "industry performance", "which sectors",
]


class ChatMessage(BaseModel):
    message: str
    symbol: Optional[str] = None
    include_news: bool = True
    include_filings: bool = True
    top_k: int = 5
    session_id: Optional[str] = None
    conversation_id: Optional[str] = None


class DataFreshness(BaseModel):
    quote: Optional[str] = None
    technicals: Optional[str] = None
    news: Optional[str] = None
    fundamentals: Optional[str] = None


class ResponseMeta(BaseModel):
    symbol: Optional[str] = None
    as_of: Optional[str] = None
    ttl_expires_at: Optional[str] = None
    data_freshness: Optional[DataFreshness] = None


class ChatResponse(BaseModel):
    version: str = "1.0"
    request_id: Optional[str] = None
    conversation_id: Optional[str] = None
    message_id: Optional[int] = None
    intent: str = "text"
    response: str
    sources: List[str]
    context_docs: int
    symbol: Optional[str] = None
    session_id: Optional[str] = None
    analysis_summary: Optional[str] = None
    response_type: str = "text"
    structured_data: Optional[Dict[str, Any]] = None
    meta: Optional[ResponseMeta] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _detect_intent(msg: str, resolved_symbol: Optional[str], resolved_symbols: List[str]) -> str:
    lower = msg.lower()

    if len(resolved_symbols) >= 2 and any(kw in lower for kw in COMPARISON_KEYWORDS):
        return "comparison"

    if any(kw in lower for kw in SCREENER_KEYWORDS):
        return "screener"

    if any(kw in lower for kw in SECTOR_KEYWORDS):
        return "sector"

    if resolved_symbol:
        if any(kw in lower for kw in ANALYSIS_KEYWORDS):
            return "stock_analysis"
        return "stock_analysis"

    return "text"


def _safe_float(val, default=None):
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


async def _build_stock_analysis_data(
    symbol: str,
    db: Session,
    quote_service: QuoteCacheService,
) -> Dict[str, Any]:
    """Assemble structured data for a single stock analysis."""
    data: Dict[str, Any] = {"symbol": symbol}

    # Quote
    try:
        quote = await quote_service.get_quote(symbol)
        if quote and not quote.get("unavailable"):
            data["quote"] = {
                "price": _safe_float(quote.get("price")),
                "change": _safe_float(quote.get("change")),
                "change_percent": _safe_float(quote.get("change_percent")),
                "volume": quote.get("volume"),
                "high": _safe_float(quote.get("high")),
                "low": _safe_float(quote.get("low")),
                "open": _safe_float(quote.get("open")),
                "previous_close": _safe_float(quote.get("previous_close")),
                "data_source": quote.get("data_source"),
            }
    except Exception:
        pass

    # Indicators
    try:
        db_sym = db.query(Symbol).filter(Symbol.symbol == symbol).first()
        if db_sym:
            indicators = IndicatorService.get_all_indicators(db, db_sym.id)
            if indicators:
                data["indicators"] = indicators
    except Exception:
        pass

    # Fundamentals from Fundamentals table
    try:
        db_sym = db.query(Symbol).filter(Symbol.symbol == symbol).first()
        if db_sym:
            fund = db.query(Fundamentals).filter(Fundamentals.symbol_id == db_sym.id).first()
            if fund:
                data["fundamentals"] = {
                    "market_cap": _safe_float(fund.market_cap),
                    "pe_ratio": _safe_float(fund.pe_ratio),
                    "forward_pe": _safe_float(fund.forward_pe),
                    "peg_ratio": _safe_float(fund.peg_ratio),
                    "price_to_book": _safe_float(fund.price_to_book),
                    "eps": _safe_float(fund.eps),
                    "beta": _safe_float(fund.beta),
                    "rsi": _safe_float(fund.rsi),
                    "dividend_yield": _safe_float(fund.dividend_yield),
                    "week_52_high": _safe_float(fund.week_52_high),
                    "week_52_low": _safe_float(fund.week_52_low),
                    "profit_margin": _safe_float(fund.profit_margin),
                    "operating_margin": _safe_float(fund.operating_margin),
                    "roe": _safe_float(fund.roe),
                    "roa": _safe_float(fund.roa),
                    "debt_to_equity": _safe_float(fund.debt_to_equity),
                    "current_ratio": _safe_float(fund.current_ratio),
                    "target_price": _safe_float(fund.target_price),
                    "recommendation": fund.recommendation,
                    "earnings_date": fund.earnings_date,
                    "revenue": _safe_float(fund.revenue),
                    "volume": fund.volume,
                    "avg_volume": fund.avg_volume,
                }
    except Exception:
        pass

    # Risk metrics
    try:
        db_sym = db.query(Symbol).filter(Symbol.symbol == symbol).first()
        if db_sym:
            risk = RiskScorer.calculate_risk_score(db, db_sym.id)
            if risk:
                data["risk"] = risk
    except Exception:
        pass

    # Company metadata from Symbol table
    try:
        db_sym = db.query(Symbol).filter(Symbol.symbol == symbol).first()
        if db_sym:
            data["company"] = {
                "name": db_sym.name,
                "sector": db_sym.sector,
                "industry": db_sym.industry,
                "market_cap": _safe_float(db_sym.market_cap),
            }
    except Exception:
        pass

    return data


async def _build_screener_data(db: Session) -> Dict[str, Any]:
    """Fetch market movers for screener intent."""
    try:
        from app.api.market import get_top_gainers, get_top_losers
        gainers = await get_top_gainers(10, db)
        losers = await get_top_losers(10, db)
        return {
            "gainers": [g.dict() if hasattr(g, "dict") else g for g in (gainers or [])],
            "losers": [l.dict() if hasattr(l, "dict") else l for l in (losers or [])],
        }
    except Exception:
        return {"gainers": [], "losers": []}


async def _build_sector_data(db: Session) -> Dict[str, Any]:
    """Fetch sector performance for sector intent."""
    try:
        from app.api.market import get_sector_performance
        sectors = await get_sector_performance(db)
        return {
            "sectors": [s.dict() if hasattr(s, "dict") else s for s in (sectors or [])],
        }
    except Exception:
        return {"sectors": []}


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def chat(
    message: ChatMessage,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """
    AI copilot chat endpoint with RAG, QuantTrade Stock Analysis integration,
    structured visual responses, persistent conversations, and snapshot storage.
    Requires authentication.
    """
    request_id = str(uuid.uuid4())
    symbol_id = None
    resolved_symbol: Optional[str] = None
    all_resolved_symbols: List[str] = []

    # ------------------------------------------------------------------
    # 1) Resolve symbol(s) from explicit field OR from free text
    # ------------------------------------------------------------------
    raw_symbol_input = (message.symbol or "").strip()

    def _resolve_symbol(candidate: str) -> Optional[Symbol]:
        if not candidate:
            return None
        db_symbol = db.query(Symbol).filter(Symbol.symbol == candidate.upper()).first()
        if db_symbol:
            return db_symbol
        return (
            db.query(Symbol)
            .filter(Symbol.name.ilike(f"%{candidate}%"))
            .order_by(Symbol.market_cap.desc().nullslast())
            .first()
        )

    # Common English words that should NOT be resolved as company names
    STOP_WORDS = {
        "the", "and", "for", "are", "but", "not", "you", "all", "can",
        "had", "her", "was", "one", "our", "out", "has", "his", "how",
        "its", "may", "new", "now", "old", "see", "way", "who", "did",
        "get", "let", "say", "she", "too", "use", "give", "show", "tell",
        "stock", "stocks", "price", "share", "shares", "market", "trade",
        "buy", "sell", "hold", "analysis", "analyze", "research", "review",
        "what", "which", "about", "comprehensive", "deep", "dive", "please",
        "with", "from", "this", "that", "have", "will", "been", "some",
        "like", "just", "also", "more", "much", "very", "most", "make",
        "top", "best", "worst", "compare", "versus", "sector", "sectors",
        "gainers", "losers", "performance", "prediction", "forecast",
        "overview", "insight", "breakdown", "today", "current",
    }

    db_symbol_obj: Optional[Symbol] = None

    if raw_symbol_input:
        db_symbol_obj = _resolve_symbol(raw_symbol_input)
    else:
        raw_tokens = re.findall(r"[A-Za-z]{2,15}", message.message)
        ticker_like = [t for t in raw_tokens if t.isupper() and 1 <= len(t) <= 5]
        name_like = [t for t in raw_tokens if t[0].isupper() and t[1:].islower()]
        # Also try lowercase tokens (3+ chars) as potential company names
        lowercase_like = [
            t for t in raw_tokens
            if t.islower() and len(t) >= 3 and t not in STOP_WORDS
        ]
        tokens = ticker_like + name_like + lowercase_like
        seen = set()
        for token in tokens:
            t = token.strip()
            if not t or t.lower() in seen or t.lower() in STOP_WORDS:
                continue
            seen.add(t.lower())
            obj = _resolve_symbol(t)
            if obj:
                all_resolved_symbols.append(obj.symbol.upper())
                if not db_symbol_obj:
                    db_symbol_obj = obj

    if db_symbol_obj:
        symbol_id = db_symbol_obj.id
        resolved_symbol = db_symbol_obj.symbol.upper()
        if resolved_symbol not in all_resolved_symbols:
            all_resolved_symbols.insert(0, resolved_symbol)
    elif raw_symbol_input:
        resolved_symbol = raw_symbol_input.upper()

    session_id = message.session_id or str(uuid.uuid4())
    user_id = current_user.id
    symbol_value = resolved_symbol

    # --- Resolve or create conversation ---
    conversation_id = message.conversation_id
    if conversation_id:
        conv = (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .first()
        )
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = Conversation(
            id=str(uuid.uuid4()),
            user_id=user_id,
            title=message.message[:80] if message.message else None,
        )
        db.add(conv)
        db.flush()
        conversation_id = conv.id

    # ------------------------------------------------------------------
    # 2) Enforce stock-analysis quotas
    # ------------------------------------------------------------------
    if symbol_value:
        window_start = datetime.now(timezone.utc) - timedelta(hours=12)
        base_q = db.query(ChatHistory).filter(
            ChatHistory.symbol.isnot(None),
            ChatHistory.created_at >= window_start,
        )
        base_q = base_q.filter(ChatHistory.user_id == user_id)
        max_symbols = 10

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
    # 3) Detect intent
    # ------------------------------------------------------------------
    response_type = _detect_intent(message.message, resolved_symbol, all_resolved_symbols)

    # ------------------------------------------------------------------
    # 4) Fetch real-time quote for RAG context
    # ------------------------------------------------------------------
    realtime_snippet: Optional[str] = None
    quote_service = QuoteCacheService(db)

    if resolved_symbol:
        try:
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
        except Exception as exc:
            print(f"⚠️ Realtime quote fetch failed for {resolved_symbol}: {exc}")

    # ------------------------------------------------------------------
    # 5) Fetch prediction summary
    # ------------------------------------------------------------------
    prediction_summary: Optional[str] = None
    if resolved_symbol:
        prediction_summary = fetch_stock_prediction(resolved_symbol)

    # ------------------------------------------------------------------
    # 6) Fetch FMP fundamentals snippet for RAG
    # ------------------------------------------------------------------
    fundamentals_snippet: Optional[str] = None
    if resolved_symbol:
        fundamentals_snippet = get_fundamentals_snapshot(resolved_symbol)

    # ------------------------------------------------------------------
    # 7) Build augmented RAG query
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

    result = rag_service.query(
        db=db,
        query=augmented_query,
        symbol=resolved_symbol,
        symbol_id=symbol_id,
        include_news=message.include_news,
        include_filings=message.include_filings,
        top_k=message.top_k,
    )

    # ------------------------------------------------------------------
    # 8) Build structured_data based on intent
    # ------------------------------------------------------------------
    structured_data: Optional[Dict[str, Any]] = None

    try:
        if response_type == "stock_analysis" and resolved_symbol:
            structured_data = await build_comprehensive_analysis(
                resolved_symbol, db, quote_service
            )
            if prediction_summary:
                structured_data["prediction"] = {"summary": prediction_summary}

        elif response_type == "comparison" and len(all_resolved_symbols) >= 2:
            stocks = []
            for sym in all_resolved_symbols[:2]:
                stock_data = await build_comprehensive_analysis(sym, db, quote_service)
                stocks.append(stock_data)
            structured_data = {"stocks": stocks}

        elif response_type == "screener":
            structured_data = await _build_screener_data(db)

        elif response_type == "sector":
            structured_data = await _build_sector_data(db)
    except Exception as e:
        print(f"⚠️ Failed to build structured data: {e}")
        structured_data = None
        if response_type != "text":
            response_type = "text"

    # ------------------------------------------------------------------
    # 9) Persist chat history with snapshot
    # ------------------------------------------------------------------
    assistant_msg_id: Optional[int] = None
    now = datetime.now(timezone.utc)

    from app.services.ttl_cache import DEFAULT_TTLS

    ttl_seconds = DEFAULT_TTLS.get("quote", 60)
    if response_type in ("stock_analysis", "comparison"):
        ttl_seconds = DEFAULT_TTLS.get("technicals", 900)
    ttl_expires = now + timedelta(seconds=ttl_seconds)

    try:
        user_msg = ChatHistory(
            user_id=user_id,
            session_id=session_id,
            conversation_id=conversation_id,
            symbol=symbol_value,
            role="user",
            content=message.message,
            created_at=now,
        )
        assistant_msg = ChatHistory(
            user_id=user_id,
            session_id=session_id,
            conversation_id=conversation_id,
            symbol=symbol_value,
            role="assistant",
            content=result["response"],
            intent_type=response_type,
            payload_json=structured_data,
            as_of=now if structured_data else None,
            ttl_expires_at=ttl_expires if structured_data else None,
            created_at=now,
        )
        db.add_all([user_msg, assistant_msg])
        db.flush()
        assistant_msg_id = assistant_msg.id

        # Update conversation timestamp
        if conv:
            conv.updated_at = now

        db.commit()
    except Exception as e:
        print(f"⚠️ Failed to save chat history: {e}")
        db.rollback()

    # Build meta
    meta = ResponseMeta(
        symbol=resolved_symbol,
        as_of=now.isoformat() if structured_data else None,
        ttl_expires_at=ttl_expires.isoformat() if structured_data else None,
        data_freshness=DataFreshness(
            quote=now.isoformat() if structured_data else None,
            technicals=now.isoformat() if structured_data else None,
        ) if structured_data else None,
    )

    return ChatResponse(
        version="1.0",
        request_id=request_id,
        conversation_id=conversation_id,
        message_id=assistant_msg_id,
        intent=response_type,
        response=result["response"],
        sources=result.get("sources", []),
        context_docs=result.get("context_docs", 0),
        symbol=resolved_symbol or message.symbol,
        session_id=session_id,
        analysis_summary=prediction_summary,
        response_type=response_type,
        structured_data=structured_data,
        meta=meta,
    )
