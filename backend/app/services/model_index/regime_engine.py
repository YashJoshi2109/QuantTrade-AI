"""
Model Index Engine — Market Regime Detection

Classifies the current market environment into regime states that
dynamically adjust factor weights and basket construction rules.
"""

import logging
from typing import Dict, Any, Optional

from app.services.model_index.config import (
    REGIME_DEFINITIONS,
    REGIME_FACTOR_ADJUSTMENTS,
)

logger = logging.getLogger(__name__)


class RegimeEngine:
    """
    Detects market regime from macro indicators and universe breadth data.
    Outputs regime label + factor weight adjustment multipliers.
    """

    @staticmethod
    def detect_regime(
        macro: Dict[str, Any],
        breadth: Dict[str, float],
    ) -> Dict[str, Any]:
        """
        Determine current market regime based on VIX, breadth, and macro signals.

        Args:
            macro: Dict with keys: vix, spy_price, tlt_price, etc.
            breadth: Dict with keys: above_sma200_pct, above_sma50_pct, positive_macd_pct

        Returns:
            {
                regime: str,
                regime_label: str,
                regime_description: str,
                confidence: float (0-100),
                signals: {...},
                factor_adjustments: Dict[str, float],
                secondary_regime: str | None,
            }
        """
        vix = macro.get("vix")
        breadth_200 = breadth.get("above_sma200_pct", 50.0)
        breadth_50 = breadth.get("above_sma50_pct", 50.0)
        momentum_breadth = breadth.get("positive_macd_pct", 50.0)

        # Score each regime candidate
        regime_scores: Dict[str, float] = {}

        for regime_id, regime_def in REGIME_DEFINITIONS.items():
            score = RegimeEngine._score_regime(
                regime_id, regime_def["conditions"],
                vix, breadth_200, breadth_50, momentum_breadth, macro,
            )
            regime_scores[regime_id] = score

        # Sort by score descending
        sorted_regimes = sorted(regime_scores.items(), key=lambda x: x[1], reverse=True)
        best_regime_id, best_score = sorted_regimes[0]
        secondary = sorted_regimes[1] if len(sorted_regimes) > 1 else None

        # Confidence = how much the top regime beats the second
        if secondary and secondary[1] > 0:
            confidence = min(95.0, max(25.0, (best_score / max(secondary[1], 1)) * 40))
        else:
            confidence = min(95.0, max(25.0, best_score * 10))

        # Fallback to soft_landing if no regime scores well
        if best_score < 5:
            best_regime_id = "soft_landing"
            confidence = 30.0

        regime_def = REGIME_DEFINITIONS.get(best_regime_id, {})
        factor_adj = REGIME_FACTOR_ADJUSTMENTS.get(best_regime_id, {})

        # Build signal summary
        signals = {
            "vix": vix,
            "vix_signal": RegimeEngine._vix_signal(vix),
            "breadth_sma200_pct": breadth_200,
            "breadth_sma50_pct": breadth_50,
            "momentum_breadth_pct": momentum_breadth,
            "breadth_signal": RegimeEngine._breadth_signal(breadth_200),
            "momentum_signal": RegimeEngine._momentum_signal(momentum_breadth),
        }

        return {
            "regime": best_regime_id,
            "regime_label": regime_def.get("label", best_regime_id),
            "regime_description": regime_def.get("description", ""),
            "confidence": round(confidence, 1),
            "signals": signals,
            "factor_adjustments": factor_adj or _default_adjustments(),
            "secondary_regime": secondary[0] if secondary else None,
            "all_regime_scores": {k: round(v, 2) for k, v in sorted_regimes[:5]},
        }

    @staticmethod
    def _score_regime(
        regime_id: str,
        conditions: Dict,
        vix: Optional[float],
        breadth_200: float,
        breadth_50: float,
        momentum_breadth: float,
        macro: Dict,
    ) -> float:
        """Score how well current conditions match a regime definition."""
        score = 0.0
        checks = 0

        # VIX conditions
        if vix is not None:
            if "vix_max" in conditions:
                checks += 1
                if vix <= conditions["vix_max"]:
                    score += 10
                else:
                    score -= 5 * min(1.0, (vix - conditions["vix_max"]) / 10)

            if "vix_min" in conditions:
                checks += 1
                if vix >= conditions["vix_min"]:
                    score += 10
                else:
                    score -= 5 * min(1.0, (conditions["vix_min"] - vix) / 10)

        # Breadth conditions (SMA200)
        if "breadth_min" in conditions:
            checks += 1
            if breadth_200 >= conditions["breadth_min"]:
                score += 10
            else:
                score -= 3

        if "breadth_max" in conditions:
            checks += 1
            if breadth_200 <= conditions["breadth_max"]:
                score += 10
            else:
                score -= 3

        # Momentum breadth
        if "momentum_breadth_min" in conditions:
            checks += 1
            if momentum_breadth >= conditions["momentum_breadth_min"]:
                score += 10
            else:
                score -= 3

        # Yield curve
        if conditions.get("yield_curve_inverted"):
            checks += 1
            tlt = macro.get("tlt_price")
            # TLT rising = yields falling; simplified proxy
            if tlt and tlt > 95:
                score += 5
            else:
                score -= 2

        # Breadth declining (compare SMA50 vs SMA200 breadth)
        if conditions.get("breadth_declining"):
            checks += 1
            if breadth_50 < breadth_200 - 10:
                score += 8
            else:
                score -= 3

        # Defensive outperforming
        if conditions.get("defensive_outperforming"):
            checks += 1
            # Heuristic: if momentum breadth is low but overall breadth okay
            if momentum_breadth < 45 and breadth_200 > 40:
                score += 6

        # Fed direction
        if "fed_direction" in conditions:
            checks += 1
            # This would need external data; for now use VIX + breadth as proxy
            if conditions["fed_direction"] == "easing":
                if vix and vix < 20 and breadth_200 > 50:
                    score += 5
            elif conditions["fed_direction"] == "tightening":
                if vix and vix > 20 and breadth_200 < 50:
                    score += 5

        # Inflation flag
        if conditions.get("inflation_elevated"):
            checks += 1
            # Proxy: would need CPI data; use energy-heavy breadth as proxy
            score += 3  # Weak signal without real data

        # Normalize by number of checks (avoid penalizing regimes with fewer conditions)
        if checks > 0:
            score = score * (5 / checks)

        return max(0, score)

    @staticmethod
    def _vix_signal(vix: Optional[float]) -> str:
        if vix is None:
            return "unknown"
        if vix < 14:
            return "very_low_complacency"
        if vix < 18:
            return "low_calm"
        if vix < 22:
            return "normal"
        if vix < 28:
            return "elevated"
        if vix < 35:
            return "high_fear"
        return "extreme_panic"

    @staticmethod
    def _breadth_signal(breadth: float) -> str:
        if breadth > 70:
            return "very_strong"
        if breadth > 55:
            return "healthy"
        if breadth > 40:
            return "mixed"
        if breadth > 25:
            return "weak"
        return "very_weak"

    @staticmethod
    def _momentum_signal(momentum: float) -> str:
        if momentum > 65:
            return "strong_uptrend"
        if momentum > 50:
            return "positive"
        if momentum > 35:
            return "fading"
        return "bearish"

    @staticmethod
    def get_regime_description(regime_id: str) -> Dict[str, str]:
        """Get human-readable regime details."""
        regime_def = REGIME_DEFINITIONS.get(regime_id, {})
        return {
            "id": regime_id,
            "label": regime_def.get("label", regime_id),
            "description": regime_def.get("description", ""),
        }

    @staticmethod
    def get_all_regimes() -> list:
        """List all defined regime types."""
        return [
            {"id": k, "label": v["label"], "description": v["description"]}
            for k, v in REGIME_DEFINITIONS.items()
        ]


def _default_adjustments() -> Dict[str, float]:
    """Neutral adjustments (no modification)."""
    return {
        "fundamental": 1.0, "valuation": 1.0, "quality": 1.0,
        "technical": 1.0, "sentiment": 1.0, "macro_fit": 1.0,
        "geopolitical": 1.0, "risk": 1.0, "diversification": 1.0,
        "analyst": 1.0,
    }
