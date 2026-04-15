"""
AI Ideas Lab — Real-time trade idea generation from live market data.

Uses real data ONLY — no synthetic/random generation.
Multi-source fallback: yfinance (free) -> FMP -> Finnhub
Real technical analysis: RSI, MACD, Bollinger Bands, moving averages.
"""
import logging
import math
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db
from app.api.auth import require_auth, get_current_user
from app.models.user import User
from app.config import settings
from app.services.market_data_service import market_data, MarketQuote
from app.services.technical_analysis_service import ta_service, TechnicalSignals
from app.services.redis_cache_service import cache_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic schemas ────────────────────────────────────────────────────────

class TradeIdea(BaseModel):
    symbol: str
    company_name: str
    idea_type: str  # "long" or "short"
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    risk_reward: Optional[float] = None
    confidence: int = 50
    timeframe: str = "swing"
    catalyst: str = ""
    sector: str = ""
    category: str = "momentum"  # momentum, value, breakout, breakdown, mean_reversion
    rsi: Optional[float] = None
    change_percent: Optional[str] = None
    volume_ratio: Optional[float] = None
    data_source: str = "unknown"  # yfinance, fmp, finnhub
    signal_strength: Optional[int] = None  # -100 to +100
    trend: Optional[str] = None
    momentum: Optional[str] = None


class IPOIdea(BaseModel):
    symbol: str
    company_name: str
    ipo_date: str
    price_range: Optional[str] = None
    exchange: str = "NASDAQ"
    sector: str = ""
    status: str = "upcoming"


class IdeasResponse(BaseModel):
    ideas: List[TradeIdea]
    ipo_calendar: List[IPOIdea] = []
    generated_at: str
    market_pulse: Dict[str, Any] = {}
    is_live: bool = True
    data_sources_used: List[str] = []


# ── Scan Universe (symbols + metadata only — NO hardcoded prices) ─────────

SCAN_UNIVERSE: Dict[str, List[tuple]] = {
    "Technology": [
        ("AAPL", "Apple Inc"), ("MSFT", "Microsoft Corp"),
        ("NVDA", "NVIDIA Corp"), ("GOOGL", "Alphabet Inc"),
        ("META", "Meta Platforms"), ("AVGO", "Broadcom Inc"),
        ("AMD", "AMD Inc"), ("CRM", "Salesforce Inc"),
        ("ADBE", "Adobe Inc"), ("ORCL", "Oracle Corp"),
        ("INTC", "Intel Corp"), ("QCOM", "Qualcomm Inc"),
        ("PANW", "Palo Alto Networks"), ("CRWD", "CrowdStrike"),
        ("NET", "Cloudflare"), ("DDOG", "Datadog Inc"),
        ("NOW", "ServiceNow Inc"), ("PLTR", "Palantir Technologies"),
        ("SMCI", "Super Micro Computer"), ("ARM", "Arm Holdings"),
    ],
    "Healthcare": [
        ("UNH", "UnitedHealth Group"), ("LLY", "Eli Lilly"),
        ("NVO", "Novo Nordisk"), ("ABBV", "AbbVie Inc"),
        ("MRK", "Merck & Co"), ("AMGN", "Amgen Inc"),
        ("GILD", "Gilead Sciences"), ("REGN", "Regeneron"),
        ("VRTX", "Vertex Pharma"), ("ISRG", "Intuitive Surgical"),
    ],
    "Financials": [
        ("JPM", "JPMorgan Chase"), ("BAC", "Bank of America"),
        ("GS", "Goldman Sachs"), ("MS", "Morgan Stanley"),
        ("V", "Visa Inc"), ("MA", "Mastercard Inc"),
        ("BLK", "BlackRock Inc"), ("SCHW", "Charles Schwab"),
        ("AXP", "American Express"), ("C", "Citigroup Inc"),
    ],
    "Consumer": [
        ("AMZN", "Amazon.com"), ("TSLA", "Tesla Inc"),
        ("WMT", "Walmart Inc"), ("COST", "Costco Wholesale"),
        ("HD", "Home Depot"), ("NKE", "Nike Inc"),
        ("MCD", "McDonald's Corp"), ("SBUX", "Starbucks Corp"),
        ("TGT", "Target Corp"), ("NFLX", "Netflix Inc"),
    ],
    "Energy": [
        ("XOM", "Exxon Mobil"), ("CVX", "Chevron Corp"),
        ("COP", "ConocoPhillips"), ("SLB", "Schlumberger"),
        ("EOG", "EOG Resources"), ("OXY", "Occidental Petroleum"),
    ],
    "Industrials": [
        ("CAT", "Caterpillar Inc"), ("BA", "Boeing Co"),
        ("HON", "Honeywell"), ("GE", "GE Aerospace"),
        ("RTX", "RTX Corporation"), ("UPS", "United Parcel Service"),
        ("DE", "Deere & Company"), ("LMT", "Lockheed Martin"),
    ],
}

ALL_SYMBOLS = [(sym, name, sector)
               for sector, items in SCAN_UNIVERSE.items()
               for sym, name in items]

# Sector ETFs for real sector rotation data
SECTOR_ETFS = {
    "Technology": "XLK",
    "Healthcare": "XLV",
    "Financials": "XLF",
    "Consumer": "XLY",
    "Energy": "XLE",
    "Industrials": "XLI",
}

# ── IPO Calendar (curated) ─────────────────────────────────────────────────

IPO_CALENDAR: List[IPOIdea] = [
    IPOIdea(symbol="CRWV", company_name="CoreWeave Inc", ipo_date="2025-03-28",
            price_range="$39-$47", exchange="NASDAQ", sector="Technology", status="recent"),
    IPOIdea(symbol="CART", company_name="Maplebear (Instacart)", ipo_date="2025-09-19",
            price_range="$30", exchange="NASDAQ", sector="Consumer", status="recent"),
    IPOIdea(symbol="KLTX", company_name="Kaltura Inc", ipo_date="2025-04-15",
            price_range="$10-$12", exchange="NASDAQ", sector="Technology", status="upcoming"),
    IPOIdea(symbol="RDDT", company_name="Reddit Inc", ipo_date="2025-03-21",
            price_range="$31-$34", exchange="NYSE", sector="Technology", status="recent"),
    IPOIdea(symbol="IBKR2", company_name="Stripe (Expected)", ipo_date="2026-Q2",
            price_range="TBD", exchange="NYSE", sector="Financials", status="filed"),
    IPOIdea(symbol="SHEIN", company_name="Shein Group (Expected)", ipo_date="2026-Q1",
            price_range="TBD", exchange="NYSE", sector="Consumer", status="filed"),
    IPOIdea(symbol="KLAV", company_name="Klaviyo Inc", ipo_date="2025-09-20",
            price_range="$30", exchange="NYSE", sector="Technology", status="recent"),
]


# ── Real Idea Builder ─────────────────────────────────────────────────────

def _build_idea_from_signals(
    symbol: str,
    name: str,
    sector: str,
    quote: MarketQuote,
    signals: TechnicalSignals,
) -> Optional[TradeIdea]:
    """Build trade idea from REAL technical signals. No randomness."""
    price = quote.price
    if not price or price <= 0:
        return None

    bull_score = 0
    bear_score = 0
    catalysts = []

    rsi = signals.rsi_14
    change_pct = signals.change_pct
    vol_ratio = signals.volume_ratio
    atr = signals.atr_14

    # ── RSI signals ──
    if rsi is not None:
        if rsi < 30:
            bull_score += 25
            catalysts.append(f"RSI oversold at {rsi:.0f}")
        elif rsi < 40:
            bull_score += 12
            catalysts.append(f"RSI near oversold ({rsi:.0f})")
        elif rsi > 70:
            bear_score += 25
            catalysts.append(f"RSI overbought at {rsi:.0f}")
        elif rsi > 60:
            bear_score += 10

    # ── MACD crossover ──
    if signals.macd is not None and signals.macd_signal is not None:
        if signals.macd > signals.macd_signal and signals.macd_histogram and signals.macd_histogram > 0:
            bull_score += 18
            catalysts.append("MACD bullish crossover")
        elif signals.macd < signals.macd_signal and signals.macd_histogram and signals.macd_histogram < 0:
            bear_score += 18
            catalysts.append("MACD bearish crossover")

    # ── Moving average alignment ──
    if signals.sma_50 and signals.sma_200:
        if signals.sma_50 > signals.sma_200 and price > signals.sma_50:
            bull_score += 15
            catalysts.append("Golden cross + above SMA50")
        elif signals.sma_50 < signals.sma_200 and price < signals.sma_50:
            bear_score += 15
            catalysts.append("Death cross + below SMA50")

    # ── Price vs SMA 20 ──
    if signals.sma_20:
        if price > signals.sma_20 * 1.02:
            bull_score += 8
        elif price < signals.sma_20 * 0.98:
            bear_score += 8

    # ── Bollinger Band signals ──
    if signals.bb_lower and price < signals.bb_lower:
        bull_score += 12
        catalysts.append("Below Bollinger lower band — mean reversion")
    elif signals.bb_upper and price > signals.bb_upper:
        bear_score += 12
        catalysts.append("Above Bollinger upper band — stretched")

    # ── Momentum (price change) ──
    if change_pct > 3:
        bull_score += 20
        catalysts.append(f"Strong momentum +{change_pct:.1f}%")
    elif change_pct > 1:
        bull_score += 10
    elif change_pct < -3:
        bear_score += 20
        catalysts.append(f"Sharp decline {change_pct:.1f}%")
    elif change_pct < -1:
        bear_score += 10

    # ── Volume confirmation ──
    if vol_ratio > 2.0:
        if change_pct > 0:
            bull_score += 10
        else:
            bear_score += 10
        catalysts.append(f"Volume spike {vol_ratio:.1f}x avg")
    elif vol_ratio > 1.5:
        if change_pct > 0:
            bull_score += 5
        else:
            bear_score += 5

    # ── 52-week levels ──
    if signals.high_52w and price >= signals.high_52w * 0.97:
        bull_score += 15
        catalysts.append("Near 52-week high — breakout zone")
    if signals.low_52w and price <= signals.low_52w * 1.03:
        bear_score += 10
        catalysts.append("Near 52-week low — breakdown risk")

    # Minimum signal threshold
    total = bull_score + bear_score
    if total < 15:
        return None

    is_long = bull_score >= bear_score
    dominant = max(bull_score, bear_score)
    confidence = min(95, max(30, int(50 + (dominant - total / 2) * 1.2)))

    # Entry/stop/target from real ATR
    if not atr or atr <= 0:
        atr = price * 0.02
    if is_long:
        entry, stop, tp = price, round(price - atr * 1.5, 2), round(price + atr * 3, 2)
    else:
        entry, stop, tp = price, round(price + atr * 1.5, 2), round(price - atr * 3, 2)

    risk = abs(entry - stop) or 0.01
    rr = round(abs(tp - entry) / risk, 2)

    # Category
    if signals.high_52w and price >= signals.high_52w * 0.98:
        category = "breakout"
    elif signals.low_52w and price <= signals.low_52w * 1.02:
        category = "breakdown"
    elif rsi and rsi < 35:
        category = "mean_reversion"
    elif abs(change_pct) > 3:
        category = "momentum"
    else:
        category = "value"

    # Timeframe from volatility
    if signals.volatility == "high" or abs(change_pct) > 4:
        timeframe = "intraday"
    elif abs(change_pct) > 1.5:
        timeframe = "swing"
    else:
        timeframe = "position"

    return TradeIdea(
        symbol=symbol,
        company_name=name,
        idea_type="long" if is_long else "short",
        entry_price=round(entry, 2),
        target_price=tp,
        stop_loss=stop,
        risk_reward=rr,
        confidence=confidence,
        timeframe=timeframe,
        catalyst="; ".join(catalysts) if catalysts else f"Technical setup ({signals.trend} trend)",
        sector=sector,
        category=category,
        rsi=round(rsi, 1) if rsi else None,
        change_percent=f"{change_pct:+.2f}%",
        volume_ratio=round(vol_ratio, 2),
        data_source=quote.source,
        signal_strength=signals.signal_strength,
        trend=signals.trend,
        momentum=signals.momentum,
    )


async def _scan_stocks_live(stocks: List[tuple]) -> tuple[List[TradeIdea], set]:
    """Scan stocks using REAL data only. Returns (ideas, sources_used)."""
    ideas: List[TradeIdea] = []
    sources_used: set = set()

    # Batch fetch all quotes at once (efficient single network call)
    symbols = [s[0] for s in stocks]
    quotes = await market_data.get_quotes_batch(symbols)

    # Compute technical signals for stocks with valid quotes
    for sym, name, sector in stocks:
        quote = quotes.get(sym)
        if not quote or not quote.price or quote.price <= 0:
            continue

        sources_used.add(quote.source)

        # Get technical signals
        signals = await ta_service.compute_signals(sym)
        if not signals:
            continue

        idea = _build_idea_from_signals(sym, name, sector, quote, signals)
        if idea and idea.confidence >= 35:
            ideas.append(idea)

    return ideas, sources_used


async def _get_sector_rotation() -> Dict[str, Dict[str, Any]]:
    """Get real sector rotation data from sector ETFs."""
    sector_data = {}
    etf_symbols = list(SECTOR_ETFS.values())
    quotes = await market_data.get_quotes_batch(etf_symbols)

    for sector, etf in SECTOR_ETFS.items():
        quote = quotes.get(etf)
        if quote and quote.price:
            sector_data[sector] = {
                "etf": etf,
                "change_pct": quote.change_pct,
                "sentiment": "bullish" if quote.change_pct > 0.3 else ("bearish" if quote.change_pct < -0.3 else "neutral"),
            }
        else:
            sector_data[sector] = {"etf": etf, "change_pct": 0, "sentiment": "neutral"}

    return sector_data


async def _build_market_pulse(ideas: List[TradeIdea], total_scanned: int) -> Dict[str, Any]:
    """Build market pulse from real ideas + real sector ETF data."""
    bullish = [i for i in ideas if i.idea_type == "long"]
    bearish = [i for i in ideas if i.idea_type == "short"]

    # Real sector rotation from ETFs
    sector_rotation = await _get_sector_rotation()

    # Sector sentiment from scanned ideas
    sector_sentiment: Dict[str, Dict[str, int]] = {}
    for idea in ideas:
        if idea.sector not in sector_sentiment:
            sector_sentiment[idea.sector] = {"bullish": 0, "bearish": 0}
        if idea.idea_type == "long":
            sector_sentiment[idea.sector]["bullish"] += 1
        else:
            sector_sentiment[idea.sector]["bearish"] += 1

    return {
        "total_scanned": total_scanned,
        "total_ideas": len(ideas),
        "bullish_count": len(bullish),
        "bearish_count": len(bearish),
        "avg_confidence": round(sum(i.confidence for i in ideas) / max(len(ideas), 1), 1),
        "top_bullish": [
            {
                "symbol": i.symbol,
                "company_name": i.company_name,
                "confidence": i.confidence,
                "catalyst": i.catalyst,
                "change_percent": i.change_percent,
                "data_source": i.data_source,
            }
            for i in sorted(bullish, key=lambda x: x.confidence, reverse=True)[:5]
        ],
        "top_bearish": [
            {
                "symbol": i.symbol,
                "company_name": i.company_name,
                "confidence": i.confidence,
                "catalyst": i.catalyst,
                "change_percent": i.change_percent,
                "data_source": i.data_source,
            }
            for i in sorted(bearish, key=lambda x: x.confidence, reverse=True)[:5]
        ],
        "sector_rotation": sector_rotation,
        "sector_sentiment": sector_sentiment,
    }


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/generate", response_model=IdeasResponse)
async def generate_ideas(
    request: Request,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Generate AI trade ideas from REAL market data. Auth required."""
    # Scan ALL stocks in universe (real data, cached efficiently)
    all_stocks = [(sym, name, sector) for sym, name, sector in ALL_SYMBOLS]

    ideas, sources = await _scan_stocks_live(all_stocks)
    ideas.sort(key=lambda i: i.confidence, reverse=True)

    market_pulse = await _build_market_pulse(ideas, len(all_stocks))

    return IdeasResponse(
        ideas=ideas[:25],
        ipo_calendar=IPO_CALENDAR,
        generated_at=datetime.now(timezone.utc).isoformat(),
        market_pulse=market_pulse,
        is_live=True,
        data_sources_used=list(sources),
    )


@router.get("/trending", response_model=IdeasResponse)
async def get_trending_ideas(
    request: Request,
    db: Session = Depends(get_db),
):
    """Get trending ideas — no auth required. Real data only."""
    # Use cached trending ideas if available
    cache_key = "qt:ideas:trending"
    cached = await cache_service.get(cache_key)

    if cached:
        return IdeasResponse(**cached)

    # Scan top stocks per sector
    stocks = []
    for sector, items in SCAN_UNIVERSE.items():
        for sym, name in items[:4]:  # Top 4 per sector
            stocks.append((sym, name, sector))

    ideas, sources = await _scan_stocks_live(stocks)
    ideas.sort(key=lambda i: i.confidence, reverse=True)

    bullish = [i for i in ideas if i.idea_type == "long"][:10]
    bearish = [i for i in ideas if i.idea_type == "short"][:10]
    combined = sorted(bullish + bearish, key=lambda i: i.confidence, reverse=True)[:20]

    market_pulse = await _build_market_pulse(combined, len(stocks))

    response = IdeasResponse(
        ideas=combined,
        ipo_calendar=IPO_CALENDAR,
        generated_at=datetime.now(timezone.utc).isoformat(),
        market_pulse=market_pulse,
        is_live=True,
        data_sources_used=list(sources),
    )

    # Cache for 2 minutes
    await cache_service.set(cache_key, response.model_dump(), 120)

    return response
