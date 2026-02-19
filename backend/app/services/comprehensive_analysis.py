"""
Comprehensive stock analysis service for the Visual AI Chat Terminal.

Computes technical signals, regime prediction, risk metrics, and
sentiment indicators using existing data in the database,
without requiring external ML model files or heavy dependencies.
"""
import logging
import numpy as np
import pandas as pd
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session

from app.models.symbol import Symbol
from app.models.fundamentals import Fundamentals
from app.models.price import PriceBar
from app.services.indicators import IndicatorService
from app.services.risk_scorer import RiskScorer
from app.services.quote_cache import QuoteCacheService
from app.services.monte_carlo import run_monte_carlo_simulation

logger = logging.getLogger(__name__)


def _sf(val, default=None):
    """Safe float conversion."""
    if val is None:
        return default
    try:
        v = float(val)
        if np.isnan(v) or np.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


def _compute_technical_signal(indicators: Dict) -> Dict[str, Any]:
    """
    Compute a technical analysis signal from indicator values.
    Returns trend, confidence, and individual signal assessments.
    """
    if not indicators:
        return {"trend": "neutral", "confidence": 50, "signals": []}

    signals = []
    bullish = 0
    bearish = 0
    total_weight = 0

    rsi = _sf(indicators.get("rsi"))
    sma_50 = _sf(indicators.get("sma_50"))
    sma_200 = _sf(indicators.get("sma_200"))
    current_price = _sf(indicators.get("current_price"))
    macd = indicators.get("macd", {})
    macd_val = _sf(macd.get("macd")) if isinstance(macd, dict) else None
    macd_signal = _sf(macd.get("signal")) if isinstance(macd, dict) else None
    macd_hist = _sf(macd.get("histogram")) if isinstance(macd, dict) else None
    bb = indicators.get("bollinger_bands", {})
    bb_upper = _sf(bb.get("upper")) if isinstance(bb, dict) else None
    bb_lower = _sf(bb.get("lower")) if isinstance(bb, dict) else None

    # Price vs SMA200 (weight 20)
    if current_price and sma_200:
        w = 20
        total_weight += w
        if current_price > sma_200:
            bullish += w
            signals.append({"name": "Price > SMA200", "signal": "bullish", "weight": w})
        else:
            bearish += w
            signals.append({"name": "Price < SMA200", "signal": "bearish", "weight": w})

    # Golden/Death cross (weight 20)
    if sma_50 and sma_200:
        w = 20
        total_weight += w
        if sma_50 > sma_200:
            bullish += w
            signals.append({"name": "Golden Cross (SMA50 > SMA200)", "signal": "bullish", "weight": w})
        else:
            bearish += w
            signals.append({"name": "Death Cross (SMA50 < SMA200)", "signal": "bearish", "weight": w})

    # RSI (weight 20)
    if rsi is not None:
        w = 20
        total_weight += w
        if rsi < 30:
            bullish += w
            signals.append({"name": f"RSI Oversold ({rsi:.1f})", "signal": "bullish", "weight": w})
        elif rsi > 70:
            bearish += w
            signals.append({"name": f"RSI Overbought ({rsi:.1f})", "signal": "bearish", "weight": w})
        elif rsi > 50:
            bullish += w * 0.6
            signals.append({"name": f"RSI Bullish ({rsi:.1f})", "signal": "bullish", "weight": w})
        else:
            bearish += w * 0.6
            signals.append({"name": f"RSI Bearish ({rsi:.1f})", "signal": "bearish", "weight": w})

    # MACD (weight 20)
    if macd_hist is not None:
        w = 20
        total_weight += w
        if macd_hist > 0:
            bullish += w
            signals.append({"name": "MACD Bullish Histogram", "signal": "bullish", "weight": w})
        else:
            bearish += w
            signals.append({"name": "MACD Bearish Histogram", "signal": "bearish", "weight": w})

    # Bollinger Bands (weight 20)
    if current_price and bb_upper and bb_lower:
        w = 20
        total_weight += w
        if current_price < bb_lower:
            bullish += w
            signals.append({"name": "Price below Lower BB", "signal": "bullish", "weight": w})
        elif current_price > bb_upper:
            bearish += w
            signals.append({"name": "Price above Upper BB", "signal": "bearish", "weight": w})
        else:
            bullish += w * 0.5
            bearish += w * 0.5
            signals.append({"name": "Price within Bollinger Bands", "signal": "neutral", "weight": w})

    if total_weight == 0:
        return {"trend": "neutral", "confidence": 50, "signals": signals}

    bullish_pct = (bullish / total_weight) * 100

    if bullish_pct >= 70:
        trend = "bullish"
    elif bullish_pct <= 30:
        trend = "bearish"
    else:
        trend = "neutral"

    confidence = round(max(bullish_pct, 100 - bullish_pct), 1)

    return {
        "trend": trend,
        "confidence": confidence,
        "bullish_pct": round(bullish_pct, 1),
        "signals": signals,
    }


def _compute_regime(indicators: Dict, risk_data: Dict, fundamentals: Optional[Fundamentals]) -> Dict[str, Any]:
    """
    Predict market regime from available indicator and risk data.
    Uses a rule-based ensemble instead of requiring a pre-trained ML model.
    """
    scores = {"BULLISH": 0.0, "BEARISH": 0.0, "NEUTRAL": 0.0}
    total_weight = 0.0

    rsi = _sf(indicators.get("rsi"))
    sma_50 = _sf(indicators.get("sma_50"))
    sma_200 = _sf(indicators.get("sma_200"))
    current_price = _sf(indicators.get("current_price"))
    macd = indicators.get("macd", {})
    macd_hist = _sf(macd.get("histogram")) if isinstance(macd, dict) else None

    # Trend component (40%)
    w = 40
    if current_price and sma_200:
        total_weight += w
        if current_price > sma_200:
            scores["BULLISH"] += w * 0.7
            scores["NEUTRAL"] += w * 0.2
            scores["BEARISH"] += w * 0.1
        else:
            scores["BEARISH"] += w * 0.7
            scores["NEUTRAL"] += w * 0.2
            scores["BULLISH"] += w * 0.1

    # Momentum (30%)
    w = 30
    if rsi is not None:
        total_weight += w
        if rsi > 60:
            scores["BULLISH"] += w * 0.6
            scores["NEUTRAL"] += w * 0.3
            scores["BEARISH"] += w * 0.1
        elif rsi < 40:
            scores["BEARISH"] += w * 0.6
            scores["NEUTRAL"] += w * 0.3
            scores["BULLISH"] += w * 0.1
        else:
            scores["NEUTRAL"] += w * 0.6
            scores["BULLISH"] += w * 0.2
            scores["BEARISH"] += w * 0.2

    # MACD (30%)
    w = 30
    if macd_hist is not None:
        total_weight += w
        if macd_hist > 0:
            scores["BULLISH"] += w * 0.6
            scores["NEUTRAL"] += w * 0.3
            scores["BEARISH"] += w * 0.1
        else:
            scores["BEARISH"] += w * 0.6
            scores["NEUTRAL"] += w * 0.3
            scores["BULLISH"] += w * 0.1

    if total_weight == 0:
        return {
            "regime": "NEUTRAL",
            "confidence": 33.3,
            "probabilities": {"BULLISH": 33.3, "BEARISH": 33.3, "NEUTRAL": 33.3},
        }

    probabilities = {k: round((v / total_weight) * 100, 1) for k, v in scores.items()}
    regime = max(probabilities, key=probabilities.get)  # type: ignore
    confidence = probabilities[regime]

    return {
        "regime": regime,
        "confidence": round(confidence, 1),
        "probabilities": probabilities,
    }


def _compute_enhanced_risk(risk_data: Dict, indicators: Dict) -> Dict[str, Any]:
    """Enhance risk data with additional metrics."""
    base = dict(risk_data) if risk_data else {}

    volatility = _sf(base.get("factors", {}).get("volatility"), 0) / 100
    max_dd = _sf(base.get("factors", {}).get("max_drawdown"), 0) / 100
    beta = _sf(base.get("factors", {}).get("beta"), 1.0)

    sharpe = 0.0
    if volatility > 0:
        sharpe = round((0.08 - 0.04) / volatility, 2)

    var_95 = round(-1.645 * (volatility / np.sqrt(252)) * 100, 2) if volatility > 0 else 0

    base["enhanced"] = {
        "sharpe_ratio": sharpe,
        "annualized_volatility": round(volatility * 100, 2),
        "var_95": var_95,
        "beta": round(beta, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
    }

    return base


def _compute_52w_from_prices(db: Session, symbol_id: int) -> Dict[str, Optional[float]]:
    """Compute 52-week high/low from price bar history when fundamentals lack them."""
    from datetime import datetime, timedelta
    try:
        cutoff = datetime.utcnow() - timedelta(days=365)
        bars = (
            db.query(PriceBar.high, PriceBar.low)
            .filter(PriceBar.symbol_id == symbol_id, PriceBar.timestamp >= cutoff)
            .all()
        )
        if not bars:
            return {"week_52_high": None, "week_52_low": None}

        highs = [b.high for b in bars if b.high is not None]
        lows = [b.low for b in bars if b.low is not None]
        return {
            "week_52_high": round(max(highs), 2) if highs else None,
            "week_52_low": round(min(lows), 2) if lows else None,
        }
    except Exception:
        return {"week_52_high": None, "week_52_low": None}


def _compute_sentiment_from_fundamentals(fund: Optional[Fundamentals], quote_change: Optional[float]) -> Dict[str, Any]:
    """
    Build sentiment data from fundamentals and price action.
    This uses analyst recommendation and price momentum rather than NLP.
    """
    sentiment: Dict[str, Any] = {
        "overall": "neutral",
        "score": 0.0,
        "analyst_recommendation": None,
        "target_price": None,
        "target_upside": None,
    }

    if fund:
        sentiment["analyst_recommendation"] = fund.recommendation
        sentiment["target_price"] = _sf(fund.target_price)

    score = 0.0
    factors = 0

    if fund and fund.recommendation:
        rec = fund.recommendation.lower()
        if rec in ("buy", "strong buy", "outperform", "overweight"):
            score += 0.6
        elif rec in ("sell", "strong sell", "underperform", "underweight"):
            score -= 0.6
        else:
            score += 0.0
        factors += 1

    if quote_change is not None:
        if quote_change > 3:
            score += 0.4
        elif quote_change > 0:
            score += 0.2
        elif quote_change < -3:
            score -= 0.4
        else:
            score -= 0.2
        factors += 1

    if fund and fund.target_price:
        current = _sf(fund.price)
        if current and current > 0:
            upside = ((fund.target_price - current) / current) * 100
            sentiment["target_upside"] = round(upside, 1)
            if upside > 15:
                score += 0.3
            elif upside > 0:
                score += 0.1
            elif upside < -15:
                score -= 0.3
            else:
                score -= 0.1
            factors += 1

    if factors > 0:
        score = score / factors

    sentiment["score"] = round(score, 2)
    if score > 0.2:
        sentiment["overall"] = "positive"
    elif score < -0.2:
        sentiment["overall"] = "negative"
    else:
        sentiment["overall"] = "neutral"

    return sentiment


async def build_comprehensive_analysis(
    symbol: str,
    db: Session,
    quote_service: QuoteCacheService,
) -> Dict[str, Any]:
    """
    Build a comprehensive stock analysis payload combining quote, indicators,
    fundamentals, risk, regime prediction, technical signals, and sentiment.

    This is the main entry point called from chat.py for stock_analysis intent.
    """
    data: Dict[str, Any] = {"symbol": symbol}

    # --- Quote ---
    quote_change_pct: Optional[float] = None
    try:
        quote = await quote_service.get_quote(symbol)
        if quote and not quote.get("unavailable"):
            data["quote"] = {
                "price": _sf(quote.get("price")),
                "change": _sf(quote.get("change")),
                "change_percent": _sf(quote.get("change_percent")),
                "volume": quote.get("volume"),
                "high": _sf(quote.get("high")),
                "low": _sf(quote.get("low")),
                "open": _sf(quote.get("open")),
                "previous_close": _sf(quote.get("previous_close")),
                "data_source": quote.get("data_source"),
            }
            quote_change_pct = _sf(quote.get("change_percent"))
    except Exception as e:
        logger.warning(f"Quote fetch failed for {symbol}: {e}")

    # --- Resolve DB symbol ---
    db_sym = db.query(Symbol).filter(Symbol.symbol == symbol).first()

    # --- Company metadata ---
    if db_sym:
        data["company"] = {
            "name": db_sym.name,
            "sector": db_sym.sector,
            "industry": db_sym.industry,
            "market_cap": _sf(db_sym.market_cap),
        }

    # --- Technical Indicators ---
    indicators: Dict = {}
    if db_sym:
        try:
            indicators = IndicatorService.get_all_indicators(db, db_sym.id)
            if indicators:
                data["indicators"] = indicators
        except Exception as e:
            logger.warning(f"Indicators failed for {symbol}: {e}")

    # --- Fundamentals ---
    fund: Optional[Fundamentals] = None
    if db_sym:
        try:
            fund = db.query(Fundamentals).filter(Fundamentals.symbol_id == db_sym.id).first()
            if fund:
                data["fundamentals"] = {
                    "market_cap": _sf(fund.market_cap),
                    "pe_ratio": _sf(fund.pe_ratio),
                    "forward_pe": _sf(fund.forward_pe),
                    "peg_ratio": _sf(fund.peg_ratio),
                    "price_to_book": _sf(fund.price_to_book),
                    "eps": _sf(fund.eps),
                    "beta": _sf(fund.beta),
                    "rsi": _sf(fund.rsi),
                    "dividend_yield": _sf(fund.dividend_yield),
                    "week_52_high": _sf(fund.week_52_high),
                    "week_52_low": _sf(fund.week_52_low),
                    "profit_margin": _sf(fund.profit_margin),
                    "operating_margin": _sf(fund.operating_margin),
                    "roe": _sf(fund.roe),
                    "roa": _sf(fund.roa),
                    "debt_to_equity": _sf(fund.debt_to_equity),
                    "current_ratio": _sf(fund.current_ratio),
                    "target_price": _sf(fund.target_price),
                    "recommendation": fund.recommendation,
                    "earnings_date": fund.earnings_date,
                    "revenue": _sf(fund.revenue),
                    "volume": fund.volume,
                    "avg_volume": fund.avg_volume,
                }
        except Exception as e:
            logger.warning(f"Fundamentals failed for {symbol}: {e}")

    # --- 52W High/Low fallback from price history ---
    if db_sym:
        fund_data = data.get("fundamentals", {})
        if fund_data.get("week_52_high") is None or fund_data.get("week_52_low") is None:
            try:
                price_52w = _compute_52w_from_prices(db, db_sym.id)
                if "fundamentals" not in data:
                    data["fundamentals"] = {}
                if data["fundamentals"].get("week_52_high") is None and price_52w["week_52_high"]:
                    data["fundamentals"]["week_52_high"] = price_52w["week_52_high"]
                if data["fundamentals"].get("week_52_low") is None and price_52w["week_52_low"]:
                    data["fundamentals"]["week_52_low"] = price_52w["week_52_low"]
            except Exception as e:
                logger.warning(f"52W fallback failed for {symbol}: {e}")

    # --- Risk ---
    risk_data: Dict = {}
    if db_sym:
        try:
            risk_data = RiskScorer.calculate_risk_score(db, db_sym.id)
            if risk_data:
                data["risk"] = _compute_enhanced_risk(risk_data, indicators)
        except Exception as e:
            logger.warning(f"Risk scoring failed for {symbol}: {e}")

    # --- Technical Signal ---
    if indicators:
        data["technical_signal"] = _compute_technical_signal(indicators)

    # --- Regime Prediction ---
    data["regime"] = _compute_regime(indicators, risk_data, fund)

    # --- Sentiment ---
    data["sentiment"] = _compute_sentiment_from_fundamentals(fund, quote_change_pct)

    # --- Monte Carlo Simulation ---
    try:
        current_price = data.get("quote", {}).get("price")
        if current_price and db_sym:
            # Run simulations for multiple timeframes
            monte_carlo_30d = run_monte_carlo_simulation(symbol, db, days=30, num_simulations=10000)
            monte_carlo_90d = run_monte_carlo_simulation(symbol, db, days=90, num_simulations=10000)
            
            if monte_carlo_30d or monte_carlo_90d:
                data["monte_carlo"] = {
                    "forecast_30d": monte_carlo_30d,
                    "forecast_90d": monte_carlo_90d,
                }
    except Exception as e:
        logger.warning(f"Monte Carlo simulation failed for {symbol}: {e}")

    return data
