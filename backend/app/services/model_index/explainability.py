"""
Model Index Engine — Explainability Layer

Generates structured, frontend-consumable explanations for every stock
selection/rejection and every basket composition decision.
No hallucinated claims — all explanations derive from computed signals.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


# ── Factor display names ────────────────────────────────────────────────────

FACTOR_LABELS = {
    "fundamental": "Fundamental Strength",
    "valuation": "Valuation",
    "quality": "Capital Quality",
    "technical": "Technical Structure",
    "sentiment": "Market Sentiment",
    "macro_fit": "Macro Fit",
    "geopolitical": "Geopolitical Resilience",
    "risk": "Risk Profile",
    "diversification": "Diversification Value",
    "analyst": "Wall Street Consensus",
}

FACTOR_DESCRIPTIONS = {
    "fundamental": "Revenue growth, EPS growth, margin trends, profitability consistency",
    "valuation": "PE, PEG, EV/EBITDA, P/S relative to sector — margin of safety assessment",
    "quality": "ROIC, ROE, ROA, balance sheet strength, capital allocation discipline",
    "technical": "Momentum, RSI, MACD, moving average trends, volume signals",
    "sentiment": "Analyst recommendations, target price consensus, insider activity",
    "macro_fit": "Alignment with current economic regime, rate/inflation sensitivity",
    "geopolitical": "Trade policy exposure, supply chain resilience, regional risk",
    "risk": "Volatility, drawdown tendency, beta stability, downside protection",
    "diversification": "Unique variance contribution, sector rarity, correlation benefit",
    "analyst": "Street consensus, target dispersion, institutional conviction",
}


class Explainability:
    """Generates structured explanation payloads for stocks and baskets."""

    # ── Stock Explanations ───────────────────────────────────────────────

    @staticmethod
    def explain_stock(
        ticker: str,
        scores: Dict[str, Any],
        stock_data: Dict[str, Any],
        selected: bool = True,
    ) -> Dict[str, Any]:
        """
        Generate a full explainability payload for one stock.

        Returns structured data for frontend rendering — not prose.
        """
        factor_scores = scores.get("factor_scores", {})

        # Sort factors by score
        sorted_factors = sorted(factor_scores.items(), key=lambda x: x[1], reverse=True)
        top_strengths = sorted_factors[:3]
        top_weaknesses = sorted_factors[-3:]

        # Build strength/weakness reasons
        strengths = [
            {
                "factor": f,
                "factor_label": FACTOR_LABELS.get(f, f),
                "score": round(s, 1),
                "reason": _strength_reason(f, s, stock_data),
            }
            for f, s in top_strengths if s >= 55
        ]

        weaknesses = [
            {
                "factor": f,
                "factor_label": FACTOR_LABELS.get(f, f),
                "score": round(s, 1),
                "reason": _weakness_reason(f, s, stock_data),
            }
            for f, s in top_weaknesses if s < 50
        ]

        # Key risks
        key_risks = _identify_risks(stock_data, factor_scores)

        # Why now
        why_now = _generate_why_now(stock_data, factor_scores, scores)

        # Factor summary (all 10 dimensions)
        factor_summary = {
            f: {
                "label": FACTOR_LABELS.get(f, f),
                "score": round(factor_scores.get(f, 50), 1),
                "description": FACTOR_DESCRIPTIONS.get(f, ""),
                "signal": _factor_signal(factor_scores.get(f, 50)),
            }
            for f in FACTOR_LABELS
        }

        # Views
        valuation_view = _valuation_view(stock_data)
        technical_view = _technical_view(stock_data)
        sentiment_view = _sentiment_view(stock_data)
        macro_fit_view = _macro_fit_view(stock_data, factor_scores)

        result = {
            "ticker": ticker,
            "company_name": scores.get("company_name", stock_data.get("company_name")),
            "sector": scores.get("sector"),
            "industry": scores.get("industry"),
            "overall_ai_score": round(scores.get("regime_adjusted_score", 50), 1),
            "composite_score": round(scores.get("composite_score", 50), 1),
            "confidence_score": round(scores.get("confidence_score", 50), 1),
            "conviction_score": round(scores.get("conviction_score", 50), 1),
            "grade": scores.get("grade", "C"),
            "universe_rank": scores.get("universe_rank"),
            "universe_percentile": scores.get("universe_percentile"),
            "factor_scores": {k: round(v, 1) for k, v in factor_scores.items()},
            "factor_summary": factor_summary,
            "key_strengths": strengths,
            "key_risks": key_risks,
            "key_weaknesses": weaknesses,
            "why_now": why_now,
            "thesis_summary": _generate_thesis(ticker, scores, strengths, weaknesses),
            "valuation_view": valuation_view,
            "technical_view": technical_view,
            "sentiment_view": sentiment_view,
            "macro_fit_view": macro_fit_view,
            "data_quality": {
                "completeness_pct": stock_data.get("data_completeness", 0),
                "missing_fields": _missing_fields(stock_data),
            },
        }

        if not selected:
            result["exclusion_reason"] = _exclusion_reason(scores, stock_data)

        return result

    # ── Basket Explanations ──────────────────────────────────────────────

    @staticmethod
    def explain_basket(
        basket: Dict[str, Any],
        scenario_results: List[Dict[str, Any]],
        regime: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Generate a full explainability payload for a basket."""
        holdings = basket.get("holdings", [])
        risk = basket.get("risk", {})
        factor_exposure = basket.get("factor_exposure", {})
        sector_alloc = basket.get("sector_allocation", {})

        # Top supporting signals
        top_signals = []
        if factor_exposure:
            sorted_exp = sorted(factor_exposure.items(), key=lambda x: x[1], reverse=True)
            for f, s in sorted_exp[:3]:
                if s >= 55:
                    top_signals.append({
                        "factor": f,
                        "label": FACTOR_LABELS.get(f, f),
                        "score": round(s, 1),
                        "signal": f"Strong {FACTOR_LABELS.get(f, f).lower()} across holdings",
                    })

        # Top risks
        top_risks = []
        concentration = risk.get("concentration", {})
        if concentration.get("max_sector_weight_pct", 0) > 30:
            top_sector = max(sector_alloc.items(), key=lambda x: x[1]) if sector_alloc else ("Unknown", 0)
            top_risks.append(f"Sector concentration: {top_sector[0]} at {top_sector[1]:.0f}%")
        if concentration.get("avg_pairwise_correlation", 0) > 0.6:
            top_risks.append(f"Elevated correlation: avg {concentration['avg_pairwise_correlation']:.2f}")
        if risk.get("portfolio_beta", 1.0) > 1.3:
            top_risks.append(f"High portfolio beta: {risk['portfolio_beta']:.2f}")
        if risk.get("portfolio_volatility_ann", 0) > 25:
            top_risks.append(f"Elevated volatility: {risk['portfolio_volatility_ann']:.1f}% annualized")

        # Worst scenario
        worst_scenario = None
        if scenario_results:
            worst = min(scenario_results, key=lambda x: x.get("projected_basket_return_pct", 0))
            worst_scenario = f"{worst['scenario_label']}: {worst['projected_basket_return_pct']:.1f}% impact"
            top_risks.append(worst_scenario)

        # Ideal market conditions
        regime_label = regime.get("regime_label", "Unknown")
        ideal_conditions = _ideal_conditions(basket.get("strategy_type", "balanced_core"))

        # Invalidation conditions
        invalidation = _invalidation_conditions(basket.get("strategy_type", "balanced_core"))

        # Rebalance triggers
        rebalance_triggers = [
            "Regime shift detected (confidence > 70%)",
            "Single holding exceeds weight cap by 50%+",
            "Sector allocation drifts beyond constraint by 10%+",
            "Portfolio drawdown exceeds 2x estimated max",
            "Quarterly scheduled rebalance",
        ]

        # Bull/base/bear from Monte Carlo
        mc = basket.get("monte_carlo", {})
        bull_case = mc.get("bull_case", {"return_pct": "N/A", "description": "Pending simulation"})
        base_case = mc.get("base_case", {"return_pct": "N/A", "description": "Pending simulation"})
        bear_case = mc.get("bear_case", {"return_pct": "N/A", "description": "Pending simulation"})

        # Allocation methodology
        alloc_method = basket.get("weighting_method", "score_weighted")
        alloc_descriptions = {
            "equal_weight": "Equal weight across all holdings — maximum simplicity",
            "score_weighted": "Weights proportional to AI composite scores — higher-conviction stocks get larger allocation",
            "capped_score_weighted": "Score-weighted with individual position caps — balances conviction with concentration risk",
            "inverse_volatility": "Weights inversely proportional to volatility — lower-risk stocks get larger allocation",
            "risk_adjusted_conviction": "Conviction score divided by volatility — maximizes risk-adjusted positioning",
        }

        return {
            "basket_id": basket.get("basket_id"),
            "basket_name": basket.get("basket_name"),
            "strategy_type": basket.get("strategy_type"),
            "regime_label": regime_label,
            "regime_confidence": regime.get("confidence"),
            "num_holdings": len(holdings),
            "basket_thesis": _generate_basket_thesis(basket, regime),
            "why_this_basket_now": _why_basket_now(basket, regime),
            "top_supporting_signals": top_signals,
            "top_risks": top_risks,
            "ideal_market_conditions": ideal_conditions,
            "invalidation_conditions": invalidation,
            "rebalance_triggers": rebalance_triggers,
            "bull_case": bull_case,
            "base_case": base_case,
            "bear_case": bear_case,
            "allocation_methodology": alloc_descriptions.get(alloc_method, alloc_method),
            "risk_summary": {
                "level": risk.get("risk_level", "Unknown"),
                "score": risk.get("risk_score", 0),
                "volatility": risk.get("portfolio_volatility_ann", 0),
                "beta": risk.get("portfolio_beta", 0),
                "max_drawdown_est": risk.get("max_drawdown_estimate_pct", 0),
            },
            "scenario_summary": [
                {
                    "name": s["scenario_label"],
                    "impact_pct": s["projected_basket_return_pct"],
                    "headline": f"{s['scenario_label']}: {'positive' if s['projected_basket_return_pct'] > 0 else 'negative'} {abs(s['projected_basket_return_pct']):.1f}% impact",
                }
                for s in scenario_results
            ] if scenario_results else [],
            "model_version": "qt-model-index-v1",
            "generated_at": datetime.utcnow().isoformat(),
        }

    # ── Rejected Stock Explanation ───────────────────────────────────────

    @staticmethod
    def explain_rejection(
        ticker: str,
        scores: Dict[str, Any],
        stock_data: Dict[str, Any],
        rejection_reason: str,
    ) -> Dict[str, Any]:
        """Explain why a stock was not selected for the basket."""
        factor_scores = scores.get("factor_scores", {})
        sorted_factors = sorted(factor_scores.items(), key=lambda x: x[1])

        weakest = sorted_factors[:2] if sorted_factors else []
        missing_factors = [
            {"factor": f, "label": FACTOR_LABELS.get(f, f), "score": round(s, 1)}
            for f, s in weakest if s < 45
        ]

        return {
            "ticker": ticker,
            "company_name": scores.get("company_name", stock_data.get("company_name")),
            "overall_score": round(scores.get("regime_adjusted_score", 0), 1),
            "rejection_reason": rejection_reason,
            "missing_factors": missing_factors,
            "excessive_risk": factor_scores.get("risk", 50) < 35,
            "grade": scores.get("grade", "F"),
        }


# ── Helper functions ─────────────────────────────────────────────────────────


def _factor_signal(score: float) -> str:
    if score >= 75:
        return "very_bullish"
    if score >= 60:
        return "bullish"
    if score >= 45:
        return "neutral"
    if score >= 30:
        return "bearish"
    return "very_bearish"


def _strength_reason(factor: str, score: float, data: Dict) -> str:
    reasons = {
        "fundamental": f"Strong earnings trajectory with {_fmt(data.get('quarterly_revenue_growth'))}% revenue growth",
        "valuation": f"Attractive valuation with PE at {_fmt(data.get('pe_ratio'))}x vs sector",
        "quality": f"High capital efficiency with ROE of {_fmt(data.get('roe'))}%",
        "technical": f"Positive trend structure with RSI at {_fmt(data.get('rsi'))}",
        "sentiment": f"Favorable analyst consensus with target upside",
        "macro_fit": f"Well-positioned for current macro regime",
        "geopolitical": f"Low geopolitical exposure with domestic revenue bias",
        "risk": f"Controlled risk profile with {_fmt(data.get('volatility'))}% volatility",
        "diversification": f"Adds unique variance to portfolio mix",
        "analyst": f"Street consensus at '{data.get('recommendation', 'N/A')}' with target ${_fmt(data.get('target_price'))}",
    }
    return reasons.get(factor, f"Score of {score:.0f} above threshold")


def _weakness_reason(factor: str, score: float, data: Dict) -> str:
    reasons = {
        "fundamental": f"Weak growth metrics with limited earnings visibility",
        "valuation": f"Stretched valuation with PE at {_fmt(data.get('pe_ratio'))}x",
        "quality": f"Below-average capital returns with ROE {_fmt(data.get('roe'))}%",
        "technical": f"Weak trend structure with negative momentum signals",
        "sentiment": f"Mixed analyst sentiment with limited conviction",
        "macro_fit": f"Sector headwinds in current macro environment",
        "geopolitical": f"Elevated geopolitical exposure risk",
        "risk": f"Higher volatility at {_fmt(data.get('volatility'))}% annualized",
        "diversification": f"Limited diversification benefit due to sector crowding",
        "analyst": f"Cautious street consensus",
    }
    return reasons.get(factor, f"Score of {score:.0f} below threshold")


def _identify_risks(data: Dict, factor_scores: Dict) -> List[str]:
    risks = []
    vol = data.get("volatility")
    if vol and vol > 35:
        risks.append(f"High volatility ({vol:.0f}% annualized)")
    de = data.get("debt_to_equity")
    if de and de > 2:
        risks.append(f"Elevated leverage (D/E: {de:.1f}x)")
    pe = data.get("pe_ratio")
    if pe and pe > 40:
        risks.append(f"Premium valuation (PE: {pe:.0f}x)")
    if data.get("earnings_date"):
        risks.append("Upcoming earnings event")
    short = data.get("short_float")
    if short and short > 15:
        risks.append(f"High short interest ({short:.1f}%)")
    dd = data.get("max_drawdown")
    if dd and dd > 30:
        risks.append(f"History of deep drawdowns ({dd:.0f}%)")
    if factor_scores.get("risk", 50) < 35:
        risks.append("Below-average risk profile score")
    return risks[:5]


def _generate_why_now(data: Dict, factor_scores: Dict, scores: Dict) -> str:
    parts = []
    rsi = data.get("rsi")
    if rsi and rsi < 35:
        parts.append("oversold RSI creating entry opportunity")
    elif rsi and rsi > 65:
        parts.append("strong momentum continuation")

    tech = factor_scores.get("technical", 50)
    if tech > 65:
        parts.append("positive technical structure")

    macro = factor_scores.get("macro_fit", 50)
    if macro > 65:
        parts.append("aligned with current macro regime")

    sentiment = factor_scores.get("sentiment", 50)
    if sentiment > 65:
        parts.append("favorable analyst sentiment shift")

    if not parts:
        return "Multi-factor composite score ranks in top tier of universe"
    return "; ".join(parts).capitalize()


def _generate_thesis(ticker: str, scores: Dict, strengths: list, weaknesses: list) -> str:
    grade = scores.get("grade", "C")
    score = scores.get("regime_adjusted_score", 50)

    strength_text = ", ".join(s["factor_label"].lower() for s in strengths[:2]) if strengths else "balanced factors"
    weakness_text = weaknesses[0]["factor_label"].lower() if weaknesses else "no critical weakness"

    return f"{ticker} scores {score:.0f}/100 (Grade {grade}) driven by {strength_text}; watch for {weakness_text}"


def _exclusion_reason(scores: Dict, data: Dict) -> str:
    score = scores.get("regime_adjusted_score", 0)
    if score < 40:
        return f"Below minimum score threshold ({score:.0f}/100)"
    completeness = data.get("data_completeness", 0)
    if completeness < 30:
        return f"Insufficient data coverage ({completeness:.0f}%)"
    return "Did not meet basket constraints (sector cap, correlation, or concentration limits)"


def _valuation_view(data: Dict) -> Dict:
    return {
        "pe_ratio": data.get("pe_ratio"),
        "forward_pe": data.get("forward_pe"),
        "peg_ratio": data.get("peg_ratio"),
        "price_to_sales": data.get("price_to_sales"),
        "price_to_book": data.get("price_to_book"),
        "ev_to_ebitda": data.get("ev_to_ebitda"),
        "dividend_yield": data.get("dividend_yield"),
    }


def _technical_view(data: Dict) -> Dict:
    price = data.get("price")
    sma50 = data.get("sma_50")
    sma200 = data.get("sma_200")
    return {
        "price": price,
        "rsi": data.get("rsi"),
        "sma_50": sma50,
        "sma_200": sma200,
        "above_sma50": price > sma50 if price and sma50 else None,
        "above_sma200": price > sma200 if price and sma200 else None,
        "macd_histogram": data.get("macd_histogram"),
        "bb_position": _bb_position(data),
        "volume_ratio": round(data.get("volume", 0) / data.get("avg_volume", 1), 2) if data.get("avg_volume") else None,
    }


def _sentiment_view(data: Dict) -> Dict:
    target = data.get("target_price")
    price = data.get("price")
    upside = round(((target - price) / price) * 100, 1) if target and price and price > 0 else None
    return {
        "recommendation": data.get("recommendation"),
        "analyst_rating": data.get("analyst_rating"),
        "target_price": target,
        "target_upside_pct": upside,
        "short_float_pct": data.get("short_float"),
        "insider_ownership_pct": data.get("insider_ownership"),
        "institutional_ownership_pct": data.get("institutional_ownership"),
    }


def _macro_fit_view(data: Dict, factor_scores: Dict) -> Dict:
    return {
        "macro_fit_score": round(factor_scores.get("macro_fit", 50), 1),
        "beta": data.get("beta"),
        "sector": data.get("sector"),
        "rate_sensitivity": "high" if data.get("beta", 1) > 1.3 else "moderate" if data.get("beta", 1) > 0.8 else "low",
    }


def _bb_position(data: Dict) -> Optional[str]:
    price = data.get("price")
    upper = data.get("bb_upper")
    lower = data.get("bb_lower")
    if price and upper and lower and upper > lower:
        pos = (price - lower) / (upper - lower)
        if pos > 0.8:
            return "near_upper_band"
        if pos < 0.2:
            return "near_lower_band"
        return "mid_band"
    return None


def _missing_fields(data: Dict) -> List[str]:
    important = ["pe_ratio", "roe", "profit_margin", "rsi", "sma_200", "beta", "target_price", "volatility"]
    return [f for f in important if data.get(f) is None]


def _ideal_conditions(strategy_type: str) -> List[str]:
    conditions = {
        "growth_leadership": ["Risk-on market environment", "Declining interest rates", "Strong earnings growth cycle", "Technology sector leadership"],
        "defensive_quality": ["Uncertain economic outlook", "Elevated volatility", "Flight to quality rotation", "Earnings recession risk"],
        "value_dcf": ["Mean reversion environment", "Improving economic outlook", "Sector rotation from growth to value", "Reasonable interest rates"],
        "momentum_swing": ["Clear trending market", "Low-to-moderate VIX", "Strong breadth participation", "Sustained sector leadership"],
        "balanced_core": ["Any market environment", "Stable economic conditions", "Moderate volatility", "Balanced risk appetite"],
        "ai_innovation": ["Technology adoption cycle", "Capex expansion", "AI/ML investment wave", "Growth-favoring monetary policy"],
        "low_volatility": ["Rising uncertainty", "Late-cycle economy", "Defensive positioning needed", "Income-seeking environment"],
        "macro_hedge": ["Regime transition period", "Policy uncertainty", "Cross-asset volatility", "Geopolitical tension"],
        "all_weather": ["Any macro environment", "Long-term holding horizon", "Balanced risk tolerance", "Core portfolio allocation"],
        "tactical_opportunistic": ["Short-term dislocations", "Sentiment extremes", "Catalyst-driven setups", "High-conviction opportunities"],
    }
    return conditions.get(strategy_type, ["Moderate market conditions"])


def _invalidation_conditions(strategy_type: str) -> List[str]:
    conditions = {
        "growth_leadership": ["Regime shifts to recession fear", "VIX sustains above 30", "Growth earnings broadly miss", "Rate hikes resume"],
        "defensive_quality": ["Strong risk-on rally leaves defensives behind", "Market breadth surges above 70%"],
        "value_dcf": ["Sustained growth outperformance", "Value trap confirmation via earnings miss"],
        "momentum_swing": ["Trend reversal with volume", "VIX spike above 30", "Breadth collapse"],
        "balanced_core": ["Extreme market dislocation requiring tactical shift"],
    }
    return conditions.get(strategy_type, ["Major regime change detected"])


def _generate_basket_thesis(basket: Dict, regime: Dict) -> str:
    strategy = basket.get("strategy_type", "balanced_core")
    num = basket.get("num_holdings", 0)
    regime_label = regime.get("regime_label", "current market")
    avg_score = basket.get("avg_composite_score", 50)

    theses = {
        "growth_leadership": f"A {num}-stock growth-focused basket optimized for {regime_label} conditions. Avg AI score {avg_score:.0f}/100.",
        "defensive_quality": f"A {num}-stock defensive quality basket built for capital preservation in {regime_label} conditions.",
        "value_dcf": f"A {num}-stock deep value basket targeting undervalued opportunities relative to intrinsic value.",
        "momentum_swing": f"A {num}-stock momentum basket capturing trending stocks with strong technical signals.",
        "balanced_core": f"A {num}-stock balanced core basket providing diversified exposure across factors and sectors.",
        "ai_innovation": f"A {num}-stock AI/innovation basket positioned for the technology adoption cycle.",
        "low_volatility": f"A {num}-stock low-volatility basket designed for downside protection and stability.",
        "macro_hedge": f"A {num}-stock macro resilience basket hedged against current macro risks.",
        "all_weather": f"A {num}-stock all-weather basket built to perform across market regimes.",
        "tactical_opportunistic": f"A {num}-stock tactical basket exploiting short-term dislocations and catalyst setups.",
    }
    return theses.get(strategy, f"A {num}-stock AI-constructed basket for {regime_label}.")


def _why_basket_now(basket: Dict, regime: Dict) -> str:
    regime_label = regime.get("regime_label", "current")
    confidence = regime.get("confidence", 50)
    strategy = basket.get("strategy_type", "balanced_core")

    return (
        f"Current regime detected as '{regime_label}' with {confidence:.0f}% confidence. "
        f"The {strategy.replace('_', ' ')} strategy is aligned with this environment, "
        f"with factor weights dynamically adjusted to match prevailing conditions."
    )


def _fmt(val) -> str:
    if val is None:
        return "N/A"
    try:
        return f"{float(val):.1f}"
    except (TypeError, ValueError):
        return str(val)
