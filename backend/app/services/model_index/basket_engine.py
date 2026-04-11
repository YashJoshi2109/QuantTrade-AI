"""
Model Index Engine — Basket Construction Engine

Intelligent basket construction with sector caps, correlation controls,
risk budgets, factor balance, and role assignment.
"""

import logging
import numpy as np
from typing import Dict, Any, List, Optional

from app.services.model_index.config import (
    BASKET_CONSTRAINTS,
    STOCK_ROLES,
    SECTOR_CORRELATIONS,
    get_sector_for_ticker,
)
from app.services.model_index.risk_engine import RiskEngine

logger = logging.getLogger(__name__)


def _sf(val, default=0.0):
    if val is None:
        return default
    try:
        v = float(val)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


class BasketEngine:
    """
    Constructs optimized stock baskets using greedy constraint-aware selection.
    Does NOT simply take top-N ranked stocks.
    """

    @staticmethod
    def construct_basket(
        scored_universe: Dict[str, Dict[str, Any]],
        universe_data: Dict[str, Dict[str, Any]],
        index_type: str,
        regime: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Build a basket from scored universe with constraints.

        Steps:
        1. Sort candidates by composite score
        2. Greedily add stocks checking constraints:
           - Sector cap
           - Max single-stock weight
           - Correlation ceiling
           - Minimum score threshold
        3. Assign weights based on weighting method
        4. Assign roles to each holding
        5. Compute basket-level metrics

        Returns: Full BasketResult dict.
        """
        constraints = BASKET_CONSTRAINTS.get(index_type, BASKET_CONSTRAINTS["balanced_core"])
        min_holdings = constraints["min_holdings"]
        max_holdings = constraints["max_holdings"]
        sector_cap = constraints["sector_cap_pct"]
        max_single = constraints["max_single_stock_pct"]
        min_score = constraints["min_score_threshold"]
        corr_ceiling = constraints["correlation_ceiling"]
        weighting_method = constraints["weighting_method"]

        # Sort candidates by regime-adjusted score
        candidates = [
            (ticker, scores)
            for ticker, scores in scored_universe.items()
            if scores.get("regime_adjusted_score", 0) >= min_score
        ]
        candidates.sort(key=lambda x: x[1]["regime_adjusted_score"], reverse=True)

        if not candidates:
            logger.warning(f"No candidates above score threshold {min_score} for {index_type}")
            return BasketEngine._empty_basket(index_type, regime)

        # Greedy selection
        selected: List[Dict[str, Any]] = []
        rejected: List[Dict[str, Any]] = []
        sector_weights: Dict[str, float] = {}

        for ticker, scores in candidates:
            if len(selected) >= max_holdings:
                rejected.append({"ticker": ticker, "reason": "max_holdings_reached"})
                continue

            sector = scores.get("sector", get_sector_for_ticker(ticker))
            stock_data = universe_data.get(ticker, {})

            # Check sector cap
            current_sector_count = sum(1 for s in selected if s.get("sector") == sector)
            projected_sector_pct = (current_sector_count + 1) / max(len(selected) + 1, 1)
            if projected_sector_pct > sector_cap and len(selected) >= min_holdings // 2:
                rejected.append({"ticker": ticker, "reason": f"sector_cap_exceeded ({sector})"})
                continue

            # Check correlation with existing holdings
            if selected and len(selected) > 3:
                avg_corr = BasketEngine._avg_correlation_with_basket(sector, selected)
                if avg_corr > corr_ceiling:
                    rejected.append({"ticker": ticker, "reason": f"correlation_too_high ({avg_corr:.2f})"})
                    continue

            # Add to basket
            holding = {
                "ticker": ticker,
                "company_name": scores.get("company_name"),
                "sector": sector,
                "industry": scores.get("industry"),
                "composite_score": scores.get("composite_score", 0),
                "regime_adjusted_score": scores.get("regime_adjusted_score", 0),
                "confidence_score": scores.get("confidence_score", 0),
                "factor_scores": scores.get("factor_scores", {}),
                "grade": scores.get("grade", "C"),
                "universe_rank": scores.get("universe_rank"),
                "data_completeness": scores.get("data_completeness", 0),
            }
            selected.append(holding)
            sector_weights[sector] = sector_weights.get(sector, 0) + 1

        # If we don't have minimum holdings, relax constraints and retry
        if len(selected) < min_holdings:
            logger.info(f"Only {len(selected)} selected, relaxing constraints for {index_type}")
            selected, rejected = BasketEngine._relax_and_fill(
                selected, rejected, candidates, universe_data, min_holdings
            )

        if not selected:
            return BasketEngine._empty_basket(index_type, regime)

        # Assign weights
        selected = BasketEngine._assign_weights(selected, universe_data, weighting_method, max_single)

        # Assign roles
        for holding in selected:
            holding["role"] = BasketEngine._assign_role(holding, index_type)

        # Compute basket-level risk
        basket_risk = RiskEngine.basket_risk(selected, universe_data)

        # Risk contributions
        risk_contributions = RiskEngine.risk_contribution(selected, universe_data)

        # Sector allocation
        sector_alloc: Dict[str, float] = {}
        for h in selected:
            s = h.get("sector", "Unknown")
            sector_alloc[s] = sector_alloc.get(s, 0) + h.get("weight", 0)

        # Factor exposure (weighted average factor scores)
        factor_exposure = BasketEngine._compute_factor_exposure(selected)

        # Basket metadata
        avg_score = np.mean([h.get("regime_adjusted_score", 0) for h in selected])
        avg_confidence = np.mean([h.get("confidence_score", 0) for h in selected])

        return {
            "basket_id": f"qt_{index_type}_{len(selected)}",
            "basket_name": BasketEngine._get_basket_name(index_type),
            "strategy_type": index_type,
            "regime_label": regime.get("regime_label", "Unknown"),
            "regime": regime.get("regime", "unknown"),
            "num_holdings": len(selected),
            "avg_composite_score": round(avg_score, 2),
            "avg_confidence": round(avg_confidence, 1),
            "holdings": selected,
            "rejected": rejected[:20],  # Top 20 rejections
            "sector_allocation": {k: round(v * 100, 2) for k, v in sorted(sector_alloc.items(), key=lambda x: -x[1])},
            "factor_exposure": factor_exposure,
            "risk": basket_risk,
            "risk_contributions": risk_contributions,
            "constraints_used": constraints,
            "weighting_method": weighting_method,
        }

    @staticmethod
    def _assign_weights(
        holdings: List[Dict],
        universe_data: Dict[str, Dict],
        method: str,
        max_single: float,
    ) -> List[Dict]:
        """Apply weighting method and cap individual weights."""

        if method == "equal_weight":
            w = 1.0 / len(holdings)
            for h in holdings:
                h["weight"] = w

        elif method == "score_weighted":
            total_score = sum(h.get("regime_adjusted_score", 50) for h in holdings)
            if total_score > 0:
                for h in holdings:
                    h["weight"] = h.get("regime_adjusted_score", 50) / total_score

        elif method == "capped_score_weighted":
            # Score-weighted but capped
            total_score = sum(h.get("regime_adjusted_score", 50) for h in holdings)
            if total_score > 0:
                for h in holdings:
                    h["weight"] = min(
                        h.get("regime_adjusted_score", 50) / total_score,
                        max_single,
                    )
            # Re-normalize after capping
            total_w = sum(h["weight"] for h in holdings)
            if total_w > 0:
                for h in holdings:
                    h["weight"] /= total_w

        elif method == "inverse_volatility":
            inv_vols = []
            for h in holdings:
                sd = universe_data.get(h["ticker"], {})
                vol = _sf(sd.get("volatility"), 25.0)
                inv_vols.append(1.0 / max(vol, 5.0))
            total_inv = sum(inv_vols)
            if total_inv > 0:
                for i, h in enumerate(holdings):
                    h["weight"] = inv_vols[i] / total_inv

        elif method == "risk_adjusted_conviction":
            # Conviction * inverse-vol
            scores = []
            for h in holdings:
                sd = universe_data.get(h["ticker"], {})
                vol = _sf(sd.get("volatility"), 25.0)
                conviction = h.get("regime_adjusted_score", 50)
                scores.append(conviction / max(vol, 5.0))
            total = sum(scores)
            if total > 0:
                for i, h in enumerate(holdings):
                    h["weight"] = scores[i] / total

        else:
            # Fallback: equal weight
            w = 1.0 / len(holdings)
            for h in holdings:
                h["weight"] = w

        # Apply max single-stock cap and re-normalize
        capped = False
        for h in holdings:
            if h["weight"] > max_single:
                h["weight"] = max_single
                capped = True

        if capped:
            total_w = sum(h["weight"] for h in holdings)
            if total_w > 0:
                for h in holdings:
                    h["weight"] /= total_w

        # Round weights
        for h in holdings:
            h["weight"] = round(h["weight"], 6)

        return holdings

    @staticmethod
    def _assign_role(holding: Dict, index_type: str) -> Dict[str, str]:
        """Assign a strategic role based on factor scores."""
        factor_scores = holding.get("factor_scores", {})
        best_role = "core_compounder"
        best_match_score = 0

        for role_id, role_def in STOCK_ROLES.items():
            match = 0
            signals = role_def.get("signals", {})
            for signal_key, min_val in signals.items():
                # signal_key format: "{factor}_min"
                factor = signal_key.replace("_min", "")
                actual = factor_scores.get(factor, 50)
                if actual >= min_val:
                    match += 1
            # Full match = all signals met
            if match > best_match_score:
                best_match_score = match
                best_role = role_id

        role_def = STOCK_ROLES.get(best_role, {})
        return {
            "role_id": best_role,
            "role_label": role_def.get("label", best_role),
            "role_description": role_def.get("description", ""),
        }

    @staticmethod
    def _avg_correlation_with_basket(
        new_sector: str,
        existing: List[Dict],
    ) -> float:
        """Estimate average correlation of new stock with existing basket."""
        if not existing:
            return 0.0
        corrs = []
        for h in existing:
            s = h.get("sector", "Unknown")
            corr = SECTOR_CORRELATIONS.get(new_sector, {}).get(s, 0.5)
            corrs.append(corr)
        return float(np.mean(corrs))

    @staticmethod
    def _relax_and_fill(
        selected: List[Dict],
        rejected: List[Dict],
        candidates: list,
        universe_data: Dict,
        min_holdings: int,
    ) -> tuple:
        """Relax constraints to reach minimum holdings."""
        selected_tickers = {h["ticker"] for h in selected}
        for ticker, scores in candidates:
            if len(selected) >= min_holdings:
                break
            if ticker in selected_tickers:
                continue

            sector = scores.get("sector", "Unknown")
            holding = {
                "ticker": ticker,
                "company_name": scores.get("company_name"),
                "sector": sector,
                "industry": scores.get("industry"),
                "composite_score": scores.get("composite_score", 0),
                "regime_adjusted_score": scores.get("regime_adjusted_score", 0),
                "confidence_score": scores.get("confidence_score", 0),
                "factor_scores": scores.get("factor_scores", {}),
                "grade": scores.get("grade", "C"),
                "universe_rank": scores.get("universe_rank"),
                "data_completeness": scores.get("data_completeness", 0),
            }
            selected.append(holding)
            selected_tickers.add(ticker)

        # Remove relaxed additions from rejected list
        new_rejected = [r for r in rejected if r["ticker"] not in selected_tickers]
        return selected, new_rejected

    @staticmethod
    def _compute_factor_exposure(holdings: List[Dict]) -> Dict[str, float]:
        """Weighted average factor scores across the basket."""
        factors = [
            "fundamental", "valuation", "quality", "technical",
            "sentiment", "macro_fit", "geopolitical", "risk",
            "diversification", "analyst",
        ]
        exposure = {}
        total_weight = sum(h.get("weight", 0) for h in holdings)
        if total_weight == 0:
            return {f: 50.0 for f in factors}

        for factor in factors:
            weighted_sum = sum(
                h.get("factor_scores", {}).get(factor, 50) * h.get("weight", 0)
                for h in holdings
            )
            exposure[factor] = round(weighted_sum / total_weight, 2)

        return exposure

    @staticmethod
    def _get_basket_name(index_type: str) -> str:
        """Human-readable basket name."""
        names = {
            "growth_leadership": "QT Growth Leadership Basket",
            "defensive_quality": "QT Defensive Quality Basket",
            "value_dcf": "QT Deep Value Basket",
            "momentum_swing": "QT Momentum Alpha Basket",
            "balanced_core": "QT Balanced Core Basket",
            "ai_innovation": "QT AI Innovation Basket",
            "low_volatility": "QT Low Volatility Basket",
            "macro_hedge": "QT Macro Resilience Basket",
            "all_weather": "QT All-Weather Basket",
            "tactical_opportunistic": "QT Tactical Opportunities Basket",
        }
        return names.get(index_type, f"QT {index_type.replace('_', ' ').title()} Basket")

    @staticmethod
    def _empty_basket(index_type: str, regime: Dict) -> Dict:
        return {
            "basket_id": f"qt_{index_type}_empty",
            "basket_name": BasketEngine._get_basket_name(index_type),
            "strategy_type": index_type,
            "regime_label": regime.get("regime_label", "Unknown"),
            "regime": regime.get("regime", "unknown"),
            "num_holdings": 0,
            "avg_composite_score": 0,
            "avg_confidence": 0,
            "holdings": [],
            "rejected": [],
            "sector_allocation": {},
            "factor_exposure": {},
            "risk": {},
            "risk_contributions": [],
            "constraints_used": BASKET_CONSTRAINTS.get(index_type, {}),
            "weighting_method": "none",
        }
