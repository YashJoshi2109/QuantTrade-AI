"""
AI Copilot Streaming Endpoint — Full Pipeline

Flow:
  User Query → Intent Classification → RAG Retrieval (pgvector) →
  Quant Model Output → Confidence Scoring → LLM Streaming (GROQ/OpenRouter) →
  Structured Response

SSE event types:
  - event: structured_data   → JSON payload with all analysis data
  - event: token             → LLM text chunk
  - event: done              → Stream complete
  - event: error             → Error message
"""
import json
import re
import uuid
import httpx
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.config import settings
from app.models.symbol import Symbol
from app.models.chat_history import ChatHistory, Conversation
from app.models.user import User
from app.models.billing import Subscription
from app.services.rag_service import RAGService
from app.services.stock_analysis_client import fetch_stock_prediction
from app.services.fmp_client import get_fundamentals_snapshot
from app.services.quote_cache import QuoteCacheService
from app.services.comprehensive_analysis import build_comprehensive_analysis
from app.services.confidence_engine import compute_confidence, determine_time_horizon
from app.api.auth import get_current_user, require_auth

router = APIRouter()
rag_service = RAGService()

# ---------------------------------------------------------------------------
# System prompt — institutional-grade financial analyst
# ---------------------------------------------------------------------------
COPILOT_SYSTEM_PROMPT = """You are QuantTrade AI Copilot — an institutional-grade financial analyst powered by quantitative models, real-time data, and explainable AI.

Your role is NOT a generic chatbot. You are a hybrid of: hedge fund analyst, quant researcher, macro strategist, and equity research associate.

You ALWAYS provide structured, data-driven, and explainable responses.

## OUTPUT FORMAT (MANDATORY)

Always structure responses using these sections (use ## headers):

## Snapshot Summary
Ticker, Current Price, Trend (Bullish/Bearish/Neutral), Confidence Score (0-100%), Time Horizon

## Investment Thesis
3-5 bullet points explaining WHY this stock matters right now

## Quantitative Analysis
Trend analysis (momentum, volatility), key indicators (RSI, MACD, moving averages), support/resistance levels, volume behavior, anomalies or signals

## Forecast & Prediction
Directional prediction (Up/Down/Sideways) for short-term (1-7 days), medium-term (1-3 months), long-term (6-12 months). Probability-based confidence. Mention model type if applicable.

## Fundamental Analysis
Revenue growth trend, profitability (margins, EPS), valuation (P/E vs sector), competitive positioning, key risks

## Macro & External Factors
Interest rates impact, sector rotation, global/macroeconomic signals, regulatory or geopolitical impact

## News & Sentiment
Recent key headlines, market sentiment (Positive/Negative/Mixed), impact analysis

## Risk Factors
Downside triggers, volatility risks, black swan possibilities

## Actionable Insights
Bull case, bear case, neutral scenario, suggested strategy (e.g., swing trade, long-term hold, options idea)

## Sources & Explainability
Cite data sources, news drivers, indicators used. If unsure, say "Data not available".

## BEHAVIOR RULES
- NEVER give vague answers
- NEVER hallucinate financial data — use ONLY the data provided in context
- ALWAYS explain reasoning
- ALWAYS quantify confidence
- Think step-by-step before answering
- Be professional, sharp, and analytical — no fluff
- For comparisons, provide side-by-side tables
- End with: *This is AI-generated analysis for informational purposes only. Not financial advice.*"""


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------
class CopilotStreamRequest(BaseModel):
    message: str
    symbol: Optional[str] = None
    conversation_id: Optional[str] = None
    include_news: bool = True
    include_filings: bool = True
    top_k: int = 5


# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------
ANALYSIS_KEYWORDS = [
    "analyze", "analysis", "tell me about", "how is", "what about",
    "look at", "research", "review", "evaluate", "assess", "check",
    "price of", "forecast", "predict", "outlook", "comprehensive",
    "stock price", "give me", "show me", "what is", "how about",
    "overview", "deep dive", "breakdown", "insight",
]
COMPARISON_KEYWORDS = ["compare", "vs", "versus", "against", "difference between"]
SCREENER_KEYWORDS = ["top gainers", "top losers", "gainers", "losers", "screener", "movers"]
SECTOR_KEYWORDS = ["sector performance", "sectors", "sector breakdown", "which sectors"]

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


def _detect_intent(msg: str, resolved_symbol: Optional[str], resolved_symbols: List[str]) -> str:
    lower = msg.lower()
    if len(resolved_symbols) >= 2 and any(kw in lower for kw in COMPARISON_KEYWORDS):
        return "comparison"
    if any(kw in lower for kw in SCREENER_KEYWORDS):
        return "screener"
    if any(kw in lower for kw in SECTOR_KEYWORDS):
        return "sector"
    if resolved_symbol:
        return "stock_analysis"
    return "text"


def _resolve_symbols(message: str, explicit_symbol: Optional[str], db: Session):
    """Resolve symbol(s) from explicit field or free text."""
    all_resolved = []
    primary_obj = None

    def _resolve(candidate: str) -> Optional[Symbol]:
        if not candidate:
            return None
        obj = db.query(Symbol).filter(Symbol.symbol == candidate.upper()).first()
        if obj:
            return obj
        return (
            db.query(Symbol)
            .filter(Symbol.name.ilike(f"%{candidate}%"))
            .order_by(Symbol.market_cap.desc().nullslast())
            .first()
        )

    if explicit_symbol and explicit_symbol.strip():
        primary_obj = _resolve(explicit_symbol.strip())
    else:
        raw_tokens = re.findall(r"[A-Za-z]{2,15}", message)
        ticker_like = [t for t in raw_tokens if t.isupper() and 1 <= len(t) <= 5]
        name_like = [t for t in raw_tokens if len(t) > 1 and t[0].isupper() and t[1:].islower()]
        lowercase_like = [t for t in raw_tokens if t.islower() and len(t) >= 3 and t not in STOP_WORDS]
        tokens = ticker_like + name_like + lowercase_like
        seen = set()
        for token in tokens:
            t = token.strip()
            if not t or t.lower() in seen or t.lower() in STOP_WORDS:
                continue
            seen.add(t.lower())
            obj = _resolve(t)
            if obj:
                all_resolved.append(obj.symbol.upper())
                if not primary_obj:
                    primary_obj = obj

    if primary_obj:
        sym = primary_obj.symbol.upper()
        if sym not in all_resolved:
            all_resolved.insert(0, sym)

    return primary_obj, all_resolved


# ---------------------------------------------------------------------------
# LLM streaming — GROQ primary, OpenRouter fallback
# ---------------------------------------------------------------------------
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


_last_model_used = "groq"  # Track which model was used for meta event


async def _stream_llm(
    messages: List[Dict[str, str]],
) -> AsyncGenerator[str, None]:
    """Stream from GROQ, fallback to OpenRouter, fallback to direct Anthropic context."""
    global _last_model_used
    # Try GROQ first
    if settings.GROQ_API_KEY:
        _last_model_used = "groq"
        async for chunk in _stream_groq(messages):
            yield chunk
        return

    # Fallback to OpenRouter
    if settings.OPENROUTER_API_KEY:
        _last_model_used = "openrouter"
        async for chunk in _stream_openrouter(messages):
            yield chunk
        return

    _last_model_used = "none"
    yield "LLM API keys not configured. Please set GROQ_API_KEY or OPENROUTER_API_KEY."


async def _stream_groq(
    messages: List[Dict[str, str]],
    model_idx: int = 0,
) -> AsyncGenerator[str, None]:
    """Stream from GROQ with model fallback."""
    model = GROQ_MODELS[model_idx] if model_idx < len(GROQ_MODELS) else GROQ_MODELS[0]

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0.3,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            async with client.stream(
                "POST",
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code == 429 and model_idx == 0:
                    # Rate limited — try smaller model
                    global _last_model_used
                    _last_model_used = "fallback"
                    async for chunk in _stream_groq(messages, model_idx=1):
                        yield chunk
                    return

                if response.status_code != 200:
                    # Try OpenRouter fallback
                    if settings.OPENROUTER_API_KEY:
                        _last_model_used = "openrouter"
                        async for chunk in _stream_openrouter(messages):
                            yield chunk
                        return
                    yield f"GROQ API error: {response.status_code}"
                    return

                buffer = ""
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or line == "data: [DONE]":
                        continue
                    if not line.startswith("data: "):
                        continue
                    try:
                        data = json.loads(line[6:])
                        delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except httpx.TimeoutException:
            if settings.OPENROUTER_API_KEY:
                async for chunk in _stream_openrouter(messages):
                    yield chunk
            else:
                yield "Request timed out. Please try again."


async def _stream_openrouter(
    messages: List[Dict[str, str]],
) -> AsyncGenerator[str, None]:
    """Stream from OpenRouter (Claude or Gemini)."""
    payload = {
        "model": "google/gemini-2.0-flash-001",
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0.3,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        try:
            async with client.stream(
                "POST",
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://quanttrade.us",
                    "X-Title": "QuantTrade AI Copilot",
                },
                json=payload,
            ) as response:
                if response.status_code != 200:
                    yield f"OpenRouter API error: {response.status_code}"
                    return

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or line == "data: [DONE]":
                        continue
                    if not line.startswith("data: "):
                        continue
                    try:
                        data = json.loads(line[6:])
                        delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except httpx.TimeoutException:
            yield "Request timed out. Please try again."


# ---------------------------------------------------------------------------
# SSE generator
# ---------------------------------------------------------------------------
def _sse_event(event: str, data: Any) -> str:
    """Format an SSE event."""
    payload = json.dumps(data, default=str) if not isinstance(data, str) else data
    return f"event: {event}\ndata: {payload}\n\n"


async def _copilot_stream_generator(
    req: CopilotStreamRequest,
    db: Session,
    user: User,
) -> AsyncGenerator[str, None]:
    """Main SSE generator for the copilot pipeline."""
    request_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    from app.services.billing_service import subscription_entitled
    from app.services.user_preferences_service import load_preferences

    sub = (
        db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    )
    is_pro = subscription_entitled(sub)
    prefs = load_preferences(user) if is_pro else {}
    if is_pro:
        ds = prefs.get("data_sources") or {}
        include_news = bool(ds.get("social", True)) and req.include_news
        include_filings = bool(ds.get("sec", True)) and req.include_filings
        personality = (prefs.get("analyst_personality") or "balanced").lower()
        persona_addon = {
            "conservative": "Risk-averse framing; emphasize downside, quality, and margin of safety.",
            "balanced": "Balanced framing; weigh upside and downside with equal rigor.",
            "aggressive": "Opportunistic framing; emphasize momentum and upside while still listing material risks.",
        }.get(
            personality,
            "Balanced framing; weigh upside and downside with equal rigor.",
        )
        system_prompt = (
            COPILOT_SYSTEM_PROMPT
            + "\n\n## User preference (Pro)\n"
            + persona_addon
        )
    else:
        include_news = req.include_news
        include_filings = req.include_filings
        system_prompt = COPILOT_SYSTEM_PROMPT

    # --- 1) Resolve symbols ---
    primary_obj, all_symbols = _resolve_symbols(req.message, req.symbol, db)
    resolved_symbol = primary_obj.symbol.upper() if primary_obj else None
    symbol_id = primary_obj.id if primary_obj else None

    # --- 2) Detect intent ---
    intent = _detect_intent(req.message, resolved_symbol, all_symbols)

    # Send intent immediately
    yield _sse_event("intent", {"intent": intent, "symbol": resolved_symbol, "symbols": all_symbols})

    # --- 3) Build structured data (quant models + comprehensive analysis) ---
    structured_data = None
    quote_service = QuoteCacheService(db)

    try:
        if intent == "stock_analysis" and resolved_symbol:
            structured_data = await build_comprehensive_analysis(
                resolved_symbol, db, quote_service
            )
            # Add prediction
            prediction_summary = fetch_stock_prediction(resolved_symbol)
            if prediction_summary:
                structured_data["prediction"] = {"summary": prediction_summary}

            # Add confidence scoring
            structured_data["confidence"] = compute_confidence(structured_data)
            structured_data["time_horizons"] = determine_time_horizon(structured_data)

        elif intent == "comparison" and len(all_symbols) >= 2:
            stocks = []
            for sym in all_symbols[:2]:
                stock_data = await build_comprehensive_analysis(sym, db, quote_service)
                stock_data["confidence"] = compute_confidence(stock_data)
                stock_data["time_horizons"] = determine_time_horizon(stock_data)
                stocks.append(stock_data)
            structured_data = {"stocks": stocks}

        elif intent == "screener":
            try:
                from app.api.market import get_top_gainers, get_top_losers
                gainers = await get_top_gainers(10, db)
                losers = await get_top_losers(10, db)
                structured_data = {
                    "gainers": [g.dict() if hasattr(g, "dict") else g for g in (gainers or [])],
                    "losers": [l.dict() if hasattr(l, "dict") else l for l in (losers or [])],
                }
            except Exception:
                structured_data = {"gainers": [], "losers": []}

        elif intent == "sector":
            try:
                from app.api.market import get_sector_performance
                sectors = await get_sector_performance(db)
                structured_data = {
                    "sectors": [s.dict() if hasattr(s, "dict") else s for s in (sectors or [])],
                }
            except Exception:
                structured_data = {"sectors": []}
    except Exception as e:
        yield _sse_event("error", {"message": f"Analysis error: {str(e)}"})

    # Send structured data to frontend
    if structured_data:
        yield _sse_event("structured_data", structured_data)

    # --- 4) RAG retrieval ---
    rag_context = ""
    rag_sources = []

    # Real-time quote snippet
    if resolved_symbol:
        try:
            quote = await quote_service.get_quote(resolved_symbol)
            if quote and not quote.get("unavailable"):
                price = quote.get("price")
                change = quote.get("change")
                change_pct = quote.get("change_percent")
                if price is not None:
                    rag_context += (
                        f"[REALTIME QUOTE]\n"
                        f"Symbol: {resolved_symbol}\n"
                        f"Last price: {price:.2f}\n"
                        f"Change: {change:+.2f} ({change_pct:+.2f}%)\n\n"
                    )
        except Exception:
            pass

    # Fundamentals snippet
    if resolved_symbol:
        fmp_snap = get_fundamentals_snapshot(resolved_symbol)
        if fmp_snap:
            rag_context += f"[FUNDAMENTALS]\n{fmp_snap}\n\n"

    # Prediction snippet
    if resolved_symbol:
        pred = fetch_stock_prediction(resolved_symbol)
        if pred:
            rag_context += f"[QUANTTRADE ML PREDICTION FOR {resolved_symbol}]\n{pred}\n\n"

    # Structured analysis summary for LLM context
    if structured_data and intent == "stock_analysis":
        conf = structured_data.get("confidence", {})
        ts = structured_data.get("technical_signal", {})
        regime = structured_data.get("regime", {})
        risk = structured_data.get("risk", {})
        mc = structured_data.get("monte_carlo", {})

        rag_context += f"[TECHNICAL SIGNALS]\n"
        rag_context += f"Trend: {ts.get('trend', 'unknown')}, Confidence: {ts.get('confidence', 'N/A')}%\n"
        for sig in ts.get("signals", [])[:5]:
            rag_context += f"  - {sig.get('name', '')}: {sig.get('signal', '')}\n"
        rag_context += f"\n[REGIME PREDICTION]\n"
        rag_context += f"Regime: {regime.get('regime', 'N/A')}, Confidence: {regime.get('confidence', 'N/A')}%\n"
        probs = regime.get("probabilities", {})
        for k, v in probs.items():
            rag_context += f"  {k}: {v}%\n"

        if risk:
            enhanced = risk.get("enhanced", {})
            rag_context += f"\n[RISK METRICS]\n"
            rag_context += f"Risk Score: {risk.get('score', 'N/A')}/100\n"
            rag_context += f"Sharpe Ratio: {enhanced.get('sharpe_ratio', 'N/A')}\n"
            rag_context += f"VaR (95%): {enhanced.get('var_95', 'N/A')}%\n"
            rag_context += f"Max Drawdown: {enhanced.get('max_drawdown_pct', 'N/A')}%\n"
            rag_context += f"Beta: {enhanced.get('beta', 'N/A')}\n"

        if mc:
            for period_key, period_data in mc.items():
                if isinstance(period_data, dict):
                    rag_context += f"\n[MONTE CARLO {period_key.upper()}]\n"
                    rag_context += f"Median: ${period_data.get('median', 'N/A')}\n"
                    rag_context += f"P10: ${period_data.get('p10', 'N/A')}, P90: ${period_data.get('p90', 'N/A')}\n"

        rag_context += f"\n[CONFIDENCE SCORING]\n"
        rag_context += f"Overall: {conf.get('overall', 'N/A')}% ({conf.get('label', 'N/A')})\n"
        for comp_k, comp_v in conf.get("components", {}).items():
            rag_context += f"  {comp_k}: {comp_v}%\n"

    # RAG document retrieval (news + filings)
    try:
        rag_result = rag_service.query(
            db=db,
            query=req.message,
            symbol=resolved_symbol,
            symbol_id=symbol_id,
            include_news=include_news,
            include_filings=include_filings,
            top_k=req.top_k,
        )
        # We only want the context docs, not the LLM response from RAG
        # So extract source info manually
        rag_sources = rag_result.get("sources", [])

        # Get raw docs for context
        if include_news and symbol_id:
            news_docs = rag_service.retrieve_news(db, req.message, symbol_id, req.top_k)
            if news_docs:
                rag_context += "\n[RECENT NEWS]\n"
                for i, doc in enumerate(news_docs[:5], 1):
                    sentiment = doc.get("sentiment", "Neutral")
                    rag_context += f"[{i}] {doc.get('title', 'N/A')} (Sentiment: {sentiment})\n"
                    content = doc.get("content", "")[:300]
                    if content:
                        rag_context += f"    {content}\n"

        if include_filings and symbol_id:
            filing_docs = rag_service.retrieve_filing_chunks(db, req.message, symbol_id, req.top_k)
            if filing_docs:
                rag_context += "\n[SEC FILINGS]\n"
                for i, doc in enumerate(filing_docs[:3], 1):
                    rag_context += f"[{i}] {doc.get('form_type', '')} - {doc.get('section', '')}\n"
                    content = doc.get("content", "")[:400]
                    if content:
                        rag_context += f"    {content}\n"
    except Exception as e:
        rag_context += f"\n[RAG retrieval error: {str(e)}]\n"

    # --- 5) Build LLM messages ---
    user_prompt = f"""Analyze the following based on all data provided.

{rag_context}

[USER QUESTION]
{req.message}

Provide your analysis following the mandatory output format. Use the real data above — do NOT hallucinate numbers."""

    llm_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    # --- 6) Stream LLM response (Smart Router) ---
    from app.services.llm_router import smart_stream_llm
    full_response = ""
    model_used = "none"
    async for token, model_id in smart_stream_llm(llm_messages, user.id, db):
        full_response += token
        model_used = model_id
        yield _sse_event("token", {"text": token})

    # --- 7) Persist chat history ---
    try:
        # Resolve or create conversation
        conversation_id = req.conversation_id
        if conversation_id:
            conv = db.query(Conversation).filter(
                Conversation.id == conversation_id,
                Conversation.user_id == user.id,
            ).first()
        else:
            conv = Conversation(
                id=str(uuid.uuid4()),
                user_id=user.id,
                title=req.message[:80],
            )
            db.add(conv)
            db.flush()
            conversation_id = conv.id

        user_msg = ChatHistory(
            user_id=user.id,
            session_id=request_id,
            conversation_id=conversation_id,
            symbol=resolved_symbol,
            role="user",
            content=req.message,
            created_at=now,
        )
        assistant_msg = ChatHistory(
            user_id=user.id,
            session_id=request_id,
            conversation_id=conversation_id,
            symbol=resolved_symbol,
            role="assistant",
            content=full_response,
            intent_type=intent,
            payload_json=structured_data,
            as_of=now if structured_data else None,
            ttl_expires_at=(now + timedelta(seconds=900)) if structured_data else None,
            created_at=now,
        )
        db.add_all([user_msg, assistant_msg])
        if conv:
            conv.updated_at = now
        db.commit()

        yield _sse_event("meta", {
            "request_id": request_id,
            "conversation_id": conversation_id,
            "message_id": assistant_msg.id,
            "sources": rag_sources,
            "intent": intent,
            "symbol": resolved_symbol,
            "model": model_used,
        })
    except Exception as e:
        db.rollback()
        yield _sse_event("error", {"message": f"Failed to save history: {str(e)}"})

    yield _sse_event("done", {"request_id": request_id})


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.post("/copilot/stream")
async def copilot_stream(
    req: CopilotStreamRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """
    Streaming AI copilot endpoint.
    Returns Server-Sent Events with structured data + LLM tokens.
    """
    return StreamingResponse(
        _copilot_stream_generator(req, db, current_user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/copilot/usage")
async def copilot_usage(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    """Get per-user API usage stats for today."""
    from app.services.llm_router import get_user_usage_summary
    return get_user_usage_summary(db, current_user.id)
