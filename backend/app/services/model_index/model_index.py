"""
Model Index Engine — Synthetic Index Definitions

Wraps baskets into publishable, trackable AI-generated model indices
with clear methodology, constituents, and performance hooks.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


# ── Index Definitions ────────────────────────────────────────────────────────

INDEX_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "qt_growth_leadership": {
        "index_id": "qt_growth_leadership",
        "name": "QT Growth Leadership Index",
        "short_name": "QT Growth",
        "description": "High-conviction growth stocks with quality filters, optimized for earnings acceleration and revenue momentum.",
        "strategy_type": "growth_leadership",
        "benchmark": "QQQ",
        "target_holdings": (12, 25),
        "rebalance_cadence": "monthly",
        "methodology": "Multi-factor scoring with emphasis on fundamental growth, technical momentum, and analyst sentiment. Regime-adjusted weights favor growth and momentum factors in risk-on environments.",
        "risk_profile": "High",
        "category": "Growth",
    },
    "qt_defensive_quality": {
        "index_id": "qt_defensive_quality",
        "name": "QT Defensive Quality Index",
        "short_name": "QT Defensive",
        "description": "Quality-screened defensive stocks for capital preservation and downside protection.",
        "strategy_type": "defensive_quality",
        "benchmark": "SPLV",
        "target_holdings": (15, 30),
        "rebalance_cadence": "monthly",
        "methodology": "Quality-first scoring emphasizing ROIC, balance sheet strength, and low volatility. Risk factor heavily weighted. Regime adjustments boost quality and risk weights in uncertain environments.",
        "risk_profile": "Low",
        "category": "Defensive",
    },
    "qt_dcf_value": {
        "index_id": "qt_dcf_value",
        "name": "QT Deep Value Index",
        "short_name": "QT Value",
        "description": "Undervalued stocks with margin of safety based on relative valuation metrics and quality screens.",
        "strategy_type": "value_dcf",
        "benchmark": "VTV",
        "target_holdings": (15, 30),
        "rebalance_cadence": "monthly",
        "methodology": "Valuation-dominant scoring using PE, PEG, EV/EBITDA, and P/B relative to sector medians. Quality filter prevents value traps. Regime adjustments reduce momentum weighting.",
        "risk_profile": "Medium",
        "category": "Value",
    },
    "qt_momentum_alpha": {
        "index_id": "qt_momentum_alpha",
        "name": "QT Momentum Alpha Index",
        "short_name": "QT Momentum",
        "description": "Stocks exhibiting strong technical momentum and trend persistence for tactical positioning.",
        "strategy_type": "momentum_swing",
        "benchmark": "MTUM",
        "target_holdings": (8, 18),
        "rebalance_cadence": "bi-weekly",
        "methodology": "Technical-first scoring: RSI, MACD, moving average trends, and volume confirmation. Sentiment acts as a momentum amplifier. Higher turnover strategy.",
        "risk_profile": "High",
        "category": "Momentum",
    },
    "qt_balanced_core": {
        "index_id": "qt_balanced_core",
        "name": "QT Balanced Core Index",
        "short_name": "QT Core",
        "description": "Diversified all-factor core holding designed as a primary portfolio allocation.",
        "strategy_type": "balanced_core",
        "benchmark": "SPY",
        "target_holdings": (20, 35),
        "rebalance_cadence": "monthly",
        "methodology": "Equal-weighted factor scoring across all 10 dimensions. Maximum diversification constraints. Capped score-weighted allocation. Designed for all-weather performance.",
        "risk_profile": "Medium",
        "category": "Core",
    },
    "qt_ai_innovation": {
        "index_id": "qt_ai_innovation",
        "name": "QT AI Innovation Index",
        "short_name": "QT AI/Tech",
        "description": "AI and technology innovation leaders positioned for the secular technology adoption cycle.",
        "strategy_type": "ai_innovation",
        "benchmark": "ARKK",
        "target_holdings": (10, 20),
        "rebalance_cadence": "monthly",
        "methodology": "Growth and technical scoring with sentiment amplification. Allows higher sector concentration in Technology. Regime adjustments favor this basket in tech-led rallies.",
        "risk_profile": "Very High",
        "category": "Thematic",
    },
    "qt_low_volatility": {
        "index_id": "qt_low_volatility",
        "name": "QT Low Volatility Index",
        "short_name": "QT Low Vol",
        "description": "Minimum volatility stocks with inverse-volatility weighting for smooth returns.",
        "strategy_type": "low_volatility",
        "benchmark": "SPLV",
        "target_holdings": (20, 35),
        "rebalance_cadence": "monthly",
        "methodology": "Risk-factor dominant scoring. Inverse volatility weighting. Low correlation ceiling. Targets stocks with consistently low realized volatility and drawdown.",
        "risk_profile": "Low",
        "category": "Defensive",
    },
    "qt_macro_resilience": {
        "index_id": "qt_macro_resilience",
        "name": "QT Macro Resilience Index",
        "short_name": "QT Macro",
        "description": "Macro-aware basket designed to weather regime transitions and policy shifts.",
        "strategy_type": "macro_hedge",
        "benchmark": "SPY",
        "target_holdings": (10, 20),
        "rebalance_cadence": "monthly",
        "methodology": "Macro fit and geopolitical resilience heavily weighted. Risk-adjusted conviction weighting. Designed for periods of elevated policy uncertainty.",
        "risk_profile": "Medium",
        "category": "Macro",
    },
    "qt_all_weather": {
        "index_id": "qt_all_weather",
        "name": "QT All-Weather Index",
        "short_name": "QT All-Weather",
        "description": "Multi-regime balanced basket built to deliver consistent returns across all market environments.",
        "strategy_type": "all_weather",
        "benchmark": "SPY",
        "target_holdings": (20, 35),
        "rebalance_cadence": "monthly",
        "methodology": "Maximum sector diversification with low correlation ceiling. Risk-adjusted conviction weighting. Quality and risk factors elevated. Designed for long-term core allocation.",
        "risk_profile": "Low-Medium",
        "category": "Core",
    },
    "qt_tactical_swing": {
        "index_id": "qt_tactical_swing",
        "name": "QT Tactical Swing Index",
        "short_name": "QT Tactical",
        "description": "High-conviction tactical positions exploiting short-term dislocations and catalyst events.",
        "strategy_type": "tactical_opportunistic",
        "benchmark": "SPY",
        "target_holdings": (8, 15),
        "rebalance_cadence": "bi-weekly",
        "methodology": "Technical and sentiment dominant. Highest score threshold for entry. Allows concentrated positions. Short-duration holding strategy with catalyst focus.",
        "risk_profile": "Very High",
        "category": "Tactical",
    },
}


class ModelIndex:
    """
    Manages synthetic index definitions and produces publishable snapshots.
    """

    @staticmethod
    def list_indices() -> List[Dict[str, Any]]:
        """Return metadata for all defined indices (no basket data)."""
        return [
            {
                "index_id": idx["index_id"],
                "name": idx["name"],
                "short_name": idx["short_name"],
                "description": idx["description"],
                "category": idx["category"],
                "risk_profile": idx["risk_profile"],
                "benchmark": idx["benchmark"],
                "rebalance_cadence": idx["rebalance_cadence"],
                "target_holdings": idx["target_holdings"],
            }
            for idx in INDEX_DEFINITIONS.values()
        ]

    @staticmethod
    def get_index_definition(index_id: str) -> Optional[Dict[str, Any]]:
        """Get full definition for a specific index."""
        return INDEX_DEFINITIONS.get(index_id)

    @staticmethod
    def build_index_snapshot(
        index_id: str,
        basket: Dict[str, Any],
        explanation: Dict[str, Any],
        regime: Dict[str, Any],
        monte_carlo: Optional[Dict] = None,
        scenario_results: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Package basket + explanation + analytics into a publishable index snapshot.
        This is the final output format for the API.
        """
        index_def = INDEX_DEFINITIONS.get(index_id)
        if not index_def:
            return {"error": f"Index '{index_id}' not found"}

        holdings = basket.get("holdings", [])

        # Format holdings for API output
        formatted_holdings = []
        for h in holdings:
            formatted_holdings.append({
                "ticker": h["ticker"],
                "company_name": h.get("company_name"),
                "sector": h.get("sector"),
                "industry": h.get("industry"),
                "weight_pct": round(h.get("weight", 0) * 100, 2),
                "overall_ai_score": round(h.get("regime_adjusted_score", 0), 1),
                "confidence_score": round(h.get("confidence_score", 0), 1),
                "grade": h.get("grade", "C"),
                "fundamental_score": round(h.get("factor_scores", {}).get("fundamental", 50), 1),
                "valuation_score": round(h.get("factor_scores", {}).get("valuation", 50), 1),
                "quality_score": round(h.get("factor_scores", {}).get("quality", 50), 1),
                "technical_score": round(h.get("factor_scores", {}).get("technical", 50), 1),
                "sentiment_score": round(h.get("factor_scores", {}).get("sentiment", 50), 1),
                "macro_fit_score": round(h.get("factor_scores", {}).get("macro_fit", 50), 1),
                "geopolitical_resilience_score": round(h.get("factor_scores", {}).get("geopolitical", 50), 1),
                "risk_score": round(h.get("factor_scores", {}).get("risk", 50), 1),
                "diversification_score": round(h.get("factor_scores", {}).get("diversification", 50), 1),
                "analyst_score": round(h.get("factor_scores", {}).get("analyst", 50), 1),
                "role": h.get("role", {}),
                "suggested_weight_pct": round(h.get("weight", 0) * 100, 2),
                "data_completeness": h.get("data_completeness", 0),
            })

        # Rejected stocks summary
        rejected = basket.get("rejected", [])
        rejected_summary = [
            {
                "ticker": r.get("ticker"),
                "exclusion_reason": r.get("reason", "Did not meet criteria"),
            }
            for r in rejected[:10]
        ]

        risk = basket.get("risk", {})

        # Expected return range from Monte Carlo
        expected_return_range = None
        if monte_carlo:
            ci = monte_carlo.get("confidence_intervals", {}).get("80", {})
            expected_return_range = {
                "low_pct": ci.get("lower"),
                "high_pct": ci.get("upper"),
                "expected_pct": monte_carlo.get("expected_return_pct"),
                "horizon_days": monte_carlo.get("days"),
            }

        return {
            # Index metadata
            "index_id": index_id,
            "index_name": index_def["name"],
            "short_name": index_def["short_name"],
            "description": index_def["description"],
            "category": index_def["category"],
            "methodology": index_def["methodology"],
            "benchmark": index_def["benchmark"],
            "rebalance_cadence": index_def["rebalance_cadence"],
            "risk_profile": index_def["risk_profile"],

            # Regime context
            "regime_label": regime.get("regime_label"),
            "regime": regime.get("regime"),
            "regime_confidence": regime.get("confidence"),
            "regime_signals": regime.get("signals", {}),

            # Basket summary
            "strategy_type": basket.get("strategy_type"),
            "num_holdings": len(formatted_holdings),
            "avg_ai_score": basket.get("avg_composite_score"),
            "avg_confidence": basket.get("avg_confidence"),
            "weighting_method": basket.get("weighting_method"),

            # Holdings (the main payload)
            "holdings": formatted_holdings,
            "rejected": rejected_summary,

            # Allocations & exposures
            "sector_allocation": basket.get("sector_allocation", {}),
            "factor_exposure": basket.get("factor_exposure", {}),

            # Risk
            "risk_level": risk.get("risk_level"),
            "risk_score": risk.get("risk_score"),
            "portfolio_volatility_ann": risk.get("portfolio_volatility_ann"),
            "portfolio_beta": risk.get("portfolio_beta"),
            "max_drawdown_estimate_pct": risk.get("max_drawdown_estimate_pct"),
            "var_95_daily_pct": risk.get("var_95_daily_pct"),
            "concentration": risk.get("concentration", {}),

            # Projections
            "expected_return_range": expected_return_range,
            "monte_carlo": monte_carlo,
            "scenarios": scenario_results,

            # Explainability
            "explanation": explanation,

            # Meta
            "model_version": "qt-model-index-v1",
            "generated_at": datetime.utcnow().isoformat(),
        }
