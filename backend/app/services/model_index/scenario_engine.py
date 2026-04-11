"""
Model Index Engine — Monte Carlo & Scenario Engine

Basket-level Monte Carlo projections and named stress scenario analysis.
Extends the existing monte_carlo.py to work at portfolio level.
"""

import logging
import numpy as np
from typing import Dict, Any, List, Optional

from app.services.model_index.config import (
    SCENARIO_TEMPLATES,
    SECTOR_CORRELATIONS,
    get_sector_for_ticker,
)

logger = logging.getLogger(__name__)


def _sf(val, default=0.0):
    if val is None:
        return default
    try:
        v = float(val)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


class ScenarioEngine:
    """
    Probabilistic basket analytics: Monte Carlo simulation
    and named scenario stress tests.
    """

    @staticmethod
    def monte_carlo_basket(
        basket: Dict[str, Any],
        universe_data: Dict[str, Dict[str, Any]],
        days: int = 90,
        num_simulations: int = 5000,
    ) -> Dict[str, Any]:
        """
        Run Monte Carlo simulation at the basket level.

        For each simulation:
        1. Simulate each holding independently using per-stock drift/vol
        2. Combine returns via basket weights
        3. Compute portfolio-level path

        Returns percentiles, probabilities, confidence intervals.
        """
        holdings = basket.get("holdings", [])
        if not holdings:
            return {"error": "No holdings in basket"}

        # Extract per-stock parameters
        stock_params = []
        for h in holdings:
            ticker = h["ticker"]
            w = _sf(h.get("weight"), 0)
            sd = universe_data.get(ticker, {})

            vol_ann = _sf(sd.get("volatility"), 25.0) / 100  # Decimal
            daily_vol = vol_ann / np.sqrt(252)

            # Drift from price change or estimate
            change = _sf(sd.get("change_pct"), 0) / 100
            # Use a blend of recent momentum and mean reversion
            drift = change * 0.01  # Very conservative daily drift

            stock_params.append({
                "ticker": ticker,
                "weight": w,
                "daily_vol": daily_vol,
                "drift": drift,
                "sector": h.get("sector", "Unknown"),
            })

        # Simulation
        np.random.seed(None)  # Non-deterministic for each run
        portfolio_final_returns = np.zeros(num_simulations)

        for sim in range(num_simulations):
            portfolio_return = 0.0
            for sp in stock_params:
                # Simulate stock return over 'days' trading days
                daily_returns = np.random.normal(
                    sp["drift"],
                    sp["daily_vol"],
                    days,
                )
                cumulative = np.prod(1 + daily_returns) - 1
                portfolio_return += sp["weight"] * cumulative

            portfolio_final_returns[sim] = portfolio_return

        # Convert to percentages
        returns_pct = portfolio_final_returns * 100

        # Percentiles
        percentiles = {
            "p5": round(float(np.percentile(returns_pct, 5)), 2),
            "p10": round(float(np.percentile(returns_pct, 10)), 2),
            "p25": round(float(np.percentile(returns_pct, 25)), 2),
            "p50": round(float(np.percentile(returns_pct, 50)), 2),
            "p75": round(float(np.percentile(returns_pct, 75)), 2),
            "p90": round(float(np.percentile(returns_pct, 90)), 2),
            "p95": round(float(np.percentile(returns_pct, 95)), 2),
        }

        # Probabilities
        probabilities = {
            "positive_return": round(float(np.mean(returns_pct > 0)) * 100, 1),
            "gain_5pct": round(float(np.mean(returns_pct > 5)) * 100, 1),
            "gain_10pct": round(float(np.mean(returns_pct > 10)) * 100, 1),
            "gain_20pct": round(float(np.mean(returns_pct > 20)) * 100, 1),
            "loss_5pct": round(float(np.mean(returns_pct < -5)) * 100, 1),
            "loss_10pct": round(float(np.mean(returns_pct < -10)) * 100, 1),
            "loss_20pct": round(float(np.mean(returns_pct < -20)) * 100, 1),
        }

        # Confidence intervals
        confidence_intervals = {
            "80": {
                "lower": round(float(np.percentile(returns_pct, 10)), 2),
                "upper": round(float(np.percentile(returns_pct, 90)), 2),
            },
            "95": {
                "lower": round(float(np.percentile(returns_pct, 2.5)), 2),
                "upper": round(float(np.percentile(returns_pct, 97.5)), 2),
            },
        }

        expected_return = round(float(np.mean(returns_pct)), 2)
        return_std = round(float(np.std(returns_pct)), 2)

        # Max drawdown distribution (approximate from final returns)
        max_dd_estimate = round(abs(float(np.percentile(returns_pct, 5))), 2)

        # Bull / Base / Bear cases
        bull_case = {
            "return_pct": percentiles["p90"],
            "description": f"Top 10% outcome: +{percentiles['p90']:.1f}% over {days} days",
        }
        base_case = {
            "return_pct": percentiles["p50"],
            "description": f"Median outcome: {'+' if percentiles['p50'] > 0 else ''}{percentiles['p50']:.1f}% over {days} days",
        }
        bear_case = {
            "return_pct": percentiles["p10"],
            "description": f"Bottom 10% outcome: {percentiles['p10']:.1f}% over {days} days",
        }

        return {
            "simulation_type": "monte_carlo",
            "days": days,
            "num_simulations": num_simulations,
            "expected_return_pct": expected_return,
            "return_std_pct": return_std,
            "percentiles": percentiles,
            "probabilities": probabilities,
            "confidence_intervals": confidence_intervals,
            "max_drawdown_estimate_pct": max_dd_estimate,
            "bull_case": bull_case,
            "base_case": base_case,
            "bear_case": bear_case,
            "sharpe_estimate": round(expected_return / max(return_std, 0.01), 2),
        }

    @staticmethod
    def run_scenario(
        basket: Dict[str, Any],
        universe_data: Dict[str, Dict[str, Any]],
        scenario_name: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Apply a named scenario template to the basket.
        Adjusts per-stock drift/vol based on sector sensitivity.
        """
        # Find scenario template
        template = None
        for t in SCENARIO_TEMPLATES:
            if t["name"] == scenario_name:
                template = t
                break

        if template is None:
            logger.warning(f"Scenario '{scenario_name}' not found")
            return None

        holdings = basket.get("holdings", [])
        if not holdings:
            return None

        sector_impacts = template.get("sector_impacts", {})
        vol_mult = template.get("vol_multiplier", 1.0)
        drift_adj = template.get("drift_adjustment", 0.0)

        # Compute impact per holding
        holding_impacts = []
        weighted_impact = 0.0

        for h in holdings:
            ticker = h["ticker"]
            w = _sf(h.get("weight"), 0)
            sector = h.get("sector", get_sector_for_ticker(ticker))
            sd = universe_data.get(ticker, {})

            # Sector-specific return multiplier
            sector_mult = sector_impacts.get(sector, 1.0)
            vol = _sf(sd.get("volatility"), 25.0) / 100
            beta = _sf(sd.get("beta"), 1.0)

            # Scenario return = sector_mult * drift_adj * beta-scaling
            scenario_return = (sector_mult - 1.0) * 100 + drift_adj * beta * 100
            scenario_vol = vol * vol_mult * 100

            holding_impacts.append({
                "ticker": ticker,
                "weight_pct": round(w * 100, 2),
                "sector": sector,
                "sector_multiplier": sector_mult,
                "projected_return_pct": round(scenario_return, 2),
                "projected_vol_pct": round(scenario_vol, 2),
                "impact_contribution": round(w * scenario_return, 3),
            })

            weighted_impact += w * scenario_return

        # Sort by impact (worst first for downside scenarios)
        holding_impacts.sort(key=lambda x: x["projected_return_pct"])

        # Basket-level scenario result
        most_affected = holding_impacts[0] if holding_impacts else None
        least_affected = holding_impacts[-1] if holding_impacts else None

        return {
            "scenario_name": template["name"],
            "scenario_label": template["label"],
            "scenario_description": template["description"],
            "projected_basket_return_pct": round(weighted_impact, 2),
            "vol_multiplier": vol_mult,
            "drift_adjustment": drift_adj,
            "impact_by_holding": holding_impacts,
            "most_negatively_affected": most_affected["ticker"] if most_affected and most_affected["projected_return_pct"] < 0 else None,
            "most_positively_affected": least_affected["ticker"] if least_affected and least_affected["projected_return_pct"] > 0 else None,
            "sector_exposure_at_risk": ScenarioEngine._sectors_at_risk(holding_impacts),
        }

    @staticmethod
    def run_all_scenarios(
        basket: Dict[str, Any],
        universe_data: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Run all configured scenario templates."""
        results = []
        for template in SCENARIO_TEMPLATES:
            result = ScenarioEngine.run_scenario(basket, universe_data, template["name"])
            if result:
                results.append(result)

        # Sort by impact (most negative first)
        results.sort(key=lambda x: x.get("projected_basket_return_pct", 0))
        return results

    @staticmethod
    def _sectors_at_risk(impacts: List[Dict]) -> List[str]:
        """Identify sectors with negative projected returns."""
        negative_sectors = set()
        for h in impacts:
            if h.get("projected_return_pct", 0) < -3:
                negative_sectors.add(h.get("sector", "Unknown"))
        return sorted(negative_sectors)

    @staticmethod
    def get_scenario_summary(scenario_results: List[Dict]) -> Dict[str, Any]:
        """Produce a high-level summary across all scenarios."""
        if not scenario_results:
            return {"total_scenarios": 0}

        worst = min(scenario_results, key=lambda x: x.get("projected_basket_return_pct", 0))
        best = max(scenario_results, key=lambda x: x.get("projected_basket_return_pct", 0))

        avg_impact = np.mean([r.get("projected_basket_return_pct", 0) for r in scenario_results])

        return {
            "total_scenarios": len(scenario_results),
            "worst_scenario": {
                "name": worst["scenario_label"],
                "impact_pct": worst["projected_basket_return_pct"],
            },
            "best_scenario": {
                "name": best["scenario_label"],
                "impact_pct": best["projected_basket_return_pct"],
            },
            "average_scenario_impact_pct": round(avg_impact, 2),
            "stress_resilience": "Strong" if avg_impact > -5 else "Moderate" if avg_impact > -10 else "Weak",
        }
