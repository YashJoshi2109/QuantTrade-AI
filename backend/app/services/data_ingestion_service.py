"""
Data Ingestion Service for RAG-enhanced Copilot.

Fetches fundamentals, news, and technical data from multiple sources,
embeds them, and stores in the vector store for faster copilot retrieval.

Ported from rag/data_ingestion.py, using the backend's existing
EmbeddingService and VectorStore infrastructure.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
import yfinance as yf

from app.config import settings

logger = logging.getLogger(__name__)

# Top tracked symbols for scheduled ingestion
DEFAULT_SYMBOLS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM",
    "V", "JNJ", "WMT", "PG", "UNH", "HD", "MA", "DIS", "BAC", "NFLX",
    "CRM", "AMD",
]


# ---------------------------------------------------------------------------
# Data Processors
# ---------------------------------------------------------------------------


def _process_fundamentals(symbol: str) -> List[Dict[str, Any]]:
    """Fetch and format fundamental data from yfinance + FMP."""
    docs = []
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        content = f"""Company: {info.get('longName', symbol)}
Sector: {info.get('sector', 'N/A')}
Industry: {info.get('industry', 'N/A')}

Financial Metrics:
- Market Cap: ${info.get('marketCap', 'N/A')}
- P/E Ratio: {info.get('trailingPE', 'N/A')}
- Forward P/E: {info.get('forwardPE', 'N/A')}
- P/B Ratio: {info.get('priceToBook', 'N/A')}
- Dividend Yield: {info.get('dividendYield', 'N/A')}
- EPS: {info.get('trailingEps', 'N/A')}
- ROE: {info.get('returnOnEquity', 'N/A')}
- Profit Margin: {info.get('profitMargins', 'N/A')}

Valuation:
- 52 Week High: ${info.get('fiftyTwoWeekHigh', 'N/A')}
- 52 Week Low: ${info.get('fiftyTwoWeekLow', 'N/A')}
- Beta: {info.get('beta', 'N/A')}
- Target Price: ${info.get('targetMeanPrice', 'N/A')}

Description:
{info.get('longBusinessSummary', 'No description available')[:500]}"""

        docs.append({
            "id": f"{symbol}_fundamentals_{datetime.now(timezone.utc).strftime('%Y%m%d')}",
            "content": content,
            "metadata": {
                "symbol": symbol,
                "doc_type": "fundamental",
                "source": "yfinance",
                "ingested_at": datetime.now(timezone.utc).isoformat(),
            },
        })
    except Exception as exc:
        logger.warning("Fundamentals ingestion failed for %s: %s", symbol, exc)

    # FMP enrichment (if API key available)
    fmp_key = getattr(settings, "FMP_API_KEY", None)
    if fmp_key:
        try:
            resp = requests.get(
                f"https://financialmodelingprep.com/api/v3/profile/{symbol}",
                params={"apikey": fmp_key},
                timeout=10,
            )
            if resp.status_code == 200:
                profiles = resp.json()
                if profiles and isinstance(profiles, list):
                    p = profiles[0]
                    content = f"""FMP Profile for {symbol}:
CEO: {p.get('ceo', 'N/A')}
Employees: {p.get('fullTimeEmployees', 'N/A')}
IPO Date: {p.get('ipoDate', 'N/A')}
Exchange: {p.get('exchangeShortName', 'N/A')}
DCF: {p.get('dcf', 'N/A')}
Rating: {p.get('rating', 'N/A')}"""
                    docs.append({
                        "id": f"{symbol}_fmp_profile_{datetime.now(timezone.utc).strftime('%Y%m%d')}",
                        "content": content,
                        "metadata": {
                            "symbol": symbol,
                            "doc_type": "fundamental",
                            "source": "fmp",
                            "ingested_at": datetime.now(timezone.utc).isoformat(),
                        },
                    })
        except Exception as exc:
            logger.warning("FMP profile fetch failed for %s: %s", symbol, exc)

    return docs


def _process_news(symbol: str) -> List[Dict[str, Any]]:
    """Fetch recent news via yfinance."""
    docs = []
    try:
        ticker = yf.Ticker(symbol)
        news = ticker.news or []
        for article in news[:10]:
            title = article.get("title", "")
            link = article.get("link", "")
            publisher = article.get("publisher", "Unknown")
            pub_time = article.get("providerPublishTime", 0)
            pub_dt = datetime.fromtimestamp(pub_time, tz=timezone.utc) if pub_time else datetime.now(timezone.utc)

            content = f"""Title: {title}
Source: {publisher}
Published: {pub_dt.isoformat()}
URL: {link}"""

            docs.append({
                "id": f"{symbol}_news_{hash(title)}",
                "content": content,
                "metadata": {
                    "symbol": symbol,
                    "doc_type": "news",
                    "source": publisher,
                    "title": title,
                    "published_at": pub_dt.isoformat(),
                    "ingested_at": datetime.now(timezone.utc).isoformat(),
                },
            })
    except Exception as exc:
        logger.warning("News ingestion failed for %s: %s", symbol, exc)
    return docs


def _process_technical(symbol: str) -> List[Dict[str, Any]]:
    """Fetch price history and compute technical summary."""
    docs = []
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="3mo")
        if df is None or df.empty:
            return docs

        latest = df.iloc[-1]
        sma_20 = df["Close"].rolling(20).mean().iloc[-1] if len(df) >= 20 else None
        sma_50 = df["Close"].rolling(50).mean().iloc[-1] if len(df) >= 50 else None

        # RSI
        delta = df["Close"].diff()
        gain = delta.where(delta > 0, 0).rolling(14).mean().iloc[-1]
        loss = (-delta.where(delta < 0, 0)).rolling(14).mean().iloc[-1]
        rsi = 100 - (100 / (1 + gain / loss)) if loss != 0 else 50

        # Price changes
        pct_1w = ((latest["Close"] / df["Close"].iloc[-5] - 1) * 100) if len(df) >= 5 else 0
        pct_1m = ((latest["Close"] / df["Close"].iloc[-21] - 1) * 100) if len(df) >= 21 else 0

        content = f"""Technical Analysis for {symbol}
Current Price: ${latest['Close']:.2f}
Volume: {latest['Volume']:,.0f}

Moving Averages:
- SMA 20: ${sma_20:.2f if sma_20 else 'N/A'}
- SMA 50: ${sma_50:.2f if sma_50 else 'N/A'}

Indicators:
- RSI (14): {rsi:.1f}

Price Trends:
- 1 Week: {pct_1w:.2f}%
- 1 Month: {pct_1m:.2f}%"""

        docs.append({
            "id": f"{symbol}_technical_{datetime.now(timezone.utc).strftime('%Y%m%d')}",
            "content": content,
            "metadata": {
                "symbol": symbol,
                "doc_type": "technical",
                "source": "yfinance",
                "rsi": round(rsi, 1),
                "sma_20": round(sma_20, 2) if sma_20 else None,
                "sma_50": round(sma_50, 2) if sma_50 else None,
                "ingested_at": datetime.now(timezone.utc).isoformat(),
            },
        })
    except Exception as exc:
        logger.warning("Technical ingestion failed for %s: %s", symbol, exc)
    return docs


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def ingest_symbol(symbol: str, mode: str = "full") -> Dict[str, Any]:
    """
    Ingest data for a single symbol into the vector store.

    Args:
        symbol: Stock ticker (e.g. "AAPL")
        mode: "full" | "fundamentals" | "news" | "technical"

    Returns:
        Summary dict with counts of ingested documents.
    """
    from app.services.embedding_service import EmbeddingService

    embedding_svc = EmbeddingService()
    all_docs: List[Dict[str, Any]] = []

    if mode in ("full", "fundamentals"):
        all_docs.extend(_process_fundamentals(symbol))
    if mode in ("full", "news"):
        all_docs.extend(_process_news(symbol))
    if mode in ("full", "technical"):
        all_docs.extend(_process_technical(symbol))

    if not all_docs:
        return {"symbol": symbol, "ingested": 0, "error": "No data fetched"}

    # Embed and store
    stored = 0
    try:
        from app.services.vector_store import VectorStore
        vs = VectorStore(backend="pgvector")

        contents = [d["content"] for d in all_docs]
        embeddings = embedding_svc.embed_batch(contents)
        metadata = [d["metadata"] for d in all_docs]
        ids = [d["id"] for d in all_docs]

        vs.store_embeddings(
            collection_name="copilot_rag",
            embeddings=[e.tolist() if hasattr(e, "tolist") else e for e in embeddings],
            metadata=metadata,
            ids=ids,
        )
        stored = len(all_docs)
    except Exception as exc:
        logger.error("Vector store write failed for %s: %s", symbol, exc)
        return {"symbol": symbol, "ingested": 0, "error": str(exc)}

    logger.info("Ingested %d documents for %s (mode=%s)", stored, symbol, mode)
    return {"symbol": symbol, "ingested": stored, "mode": mode}


async def ingest_batch(
    symbols: Optional[List[str]] = None,
    mode: str = "full",
) -> List[Dict[str, Any]]:
    """Ingest data for multiple symbols. Defaults to DEFAULT_SYMBOLS."""
    symbols = symbols or DEFAULT_SYMBOLS
    results = []
    for sym in symbols:
        result = await ingest_symbol(sym, mode=mode)
        results.append(result)
    return results
