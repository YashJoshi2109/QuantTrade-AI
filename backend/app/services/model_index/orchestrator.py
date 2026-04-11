"""
Model Index Engine — Orchestrator

Main entry point that runs the complete pipeline:
DataCollection → Regime → Scoring → Basket → Risk → Scenarios → Explainability → Index

This is the only class external code needs to interact with.
"""

import logging
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime

from sqlalchemy.orm import Session

from app.services.model_index.config import get_full_universe, BASKET_CONSTRAINTS
from app.services.model_index.data_collector import DataCollector
from app.services.model_index.regime_engine import RegimeEngine
from app.services.model_index.factor_engine import FactorEngine
from app.services.model_index.risk_engine import RiskEngine
from app.services.model_index.basket_engine import BasketEngine
from app.services.model_index.scenario_engine import ScenarioEngine
from app.services.model_index.explainability import Explainability
from app.services.model_index.model_index import ModelIndex, INDEX_DEFINITIONS

logger = logging.getLogger(__name__)


class Orchestrator:
    """
    Runs the full Model Index Engine pipeline.
    Single entry point for all basket intelligence operations.
    """

    def __init__(self, db: Session):
        self.db = db
        self.collector = DataCollector(db)
        self._cache: Dict[str, Any] = {}

    async def run_full_pipeline(
        self,
        index_id: str = "qt_balanced_core",
        skip_monte_carlo: bool = False,
        skip_scenarios: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute the complete pipeline for one index.

        Steps:
        1. Collect universe data + macro indicators
        2. Compute market breadth
        3. Detect market regime
        4. Score all stocks on 10 factors
        5. Construct optimized basket
        6. Run Monte Carlo projections (optional)
        7. Run scenario analysis (optional)
        8. Generate explainability outputs
        9. Build publishable index snapshot

        Returns: Complete IndexSnapshot dict ready for API response.
        """
        start_time = datetime.utcnow()

        # Resolve index definition
        index_def = ModelIndex.get_index_definition(index_id)
        if not index_def:
            return {"error": f"Unknown index: {index_id}"}

        strategy_type = index_def["strategy_type"]
        logger.info(f"Starting pipeline for {index_id} (strategy: {strategy_type})")

        # ── Step 1: Data Collection ──────────────────────────────────────
        logger.info("Step 1: Collecting universe data...")
        universe_data = await self.collector.collect_universe()
        macro = await self.collector.collect_macro()

        if not universe_data:
            return {"error": "No universe data collected"}

        logger.info(f"Collected data for {len(universe_data)} stocks")

        # ── Step 2: Market Breadth ───────────────────────────────────────
        logger.info("Step 2: Computing market breadth...")
        breadth = self.collector.compute_breadth(universe_data)

        # ── Step 3: Regime Detection ─────────────────────────────────────
        logger.info("Step 3: Detecting market regime...")
        regime = RegimeEngine.detect_regime(macro, breadth)
        logger.info(f"Regime: {regime['regime_label']} (confidence: {regime['confidence']}%)")

        # ── Step 4: Factor Scoring ───────────────────────────────────────
        logger.info("Step 4: Scoring universe on 10 factors...")
        scored_universe = FactorEngine.score_universe(universe_data, regime, strategy_type)

        if not scored_universe:
            return {"error": "No stocks scored successfully"}

        logger.info(f"Scored {len(scored_universe)} stocks")

        # ── Step 5: Basket Construction ──────────────────────────────────
        logger.info("Step 5: Constructing basket...")
        basket = BasketEngine.construct_basket(scored_universe, universe_data, strategy_type, regime)
        logger.info(f"Basket built: {basket['num_holdings']} holdings")

        # ── Step 6: Monte Carlo ──────────────────────────────────────────
        monte_carlo = None
        if not skip_monte_carlo and basket["num_holdings"] > 0:
            logger.info("Step 6: Running Monte Carlo simulation...")
            monte_carlo = ScenarioEngine.monte_carlo_basket(basket, universe_data)
            basket["monte_carlo"] = monte_carlo

        # ── Step 7: Scenario Analysis ────────────────────────────────────
        scenario_results = []
        if not skip_scenarios and basket["num_holdings"] > 0:
            logger.info("Step 7: Running scenario analysis...")
            scenario_results = ScenarioEngine.run_all_scenarios(basket, universe_data)

        # ── Step 8: Explainability ───────────────────────────────────────
        logger.info("Step 8: Generating explanations...")
        basket_explanation = Explainability.explain_basket(basket, scenario_results, regime)

        # Generate per-stock explanations
        stock_explanations = {}
        for holding in basket.get("holdings", []):
            ticker = holding["ticker"]
            if ticker in scored_universe:
                stock_explanations[ticker] = Explainability.explain_stock(
                    ticker, scored_universe[ticker], universe_data.get(ticker, {}), selected=True,
                )

        # ── Step 9: Build Index Snapshot ─────────────────────────────────
        logger.info("Step 9: Building index snapshot...")
        snapshot = ModelIndex.build_index_snapshot(
            index_id=index_id,
            basket=basket,
            explanation=basket_explanation,
            regime=regime,
            monte_carlo=monte_carlo,
            scenario_results=scenario_results,
        )

        # Add stock-level explanations
        snapshot["stock_explanations"] = stock_explanations

        # Add timing
        elapsed = (datetime.utcnow() - start_time).total_seconds()
        snapshot["pipeline_elapsed_seconds"] = round(elapsed, 2)

        logger.info(f"Pipeline complete for {index_id} in {elapsed:.1f}s")

        # Cache result
        self._cache[index_id] = snapshot

        return snapshot

    async def run_all_indices(
        self,
        skip_monte_carlo: bool = False,
        skip_scenarios: bool = False,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Run the pipeline for ALL defined indices.
        Shares data collection across runs for efficiency.
        """
        start = datetime.utcnow()
        logger.info("Running full pipeline for all indices...")

        # Collect data once
        universe_data = await self.collector.collect_universe()
        macro = await self.collector.collect_macro()
        breadth = self.collector.compute_breadth(universe_data)
        regime = RegimeEngine.detect_regime(macro, breadth)

        results = {}
        for index_id, index_def in INDEX_DEFINITIONS.items():
            strategy_type = index_def["strategy_type"]

            try:
                # Score for this strategy type
                scored = FactorEngine.score_universe(universe_data, regime, strategy_type)
                if not scored:
                    results[index_id] = {"error": "No stocks scored"}
                    continue

                # Build basket
                basket = BasketEngine.construct_basket(scored, universe_data, strategy_type, regime)

                # Monte Carlo
                mc = None
                if not skip_monte_carlo and basket["num_holdings"] > 0:
                    mc = ScenarioEngine.monte_carlo_basket(basket, universe_data)
                    basket["monte_carlo"] = mc

                # Scenarios
                scenarios = []
                if not skip_scenarios and basket["num_holdings"] > 0:
                    scenarios = ScenarioEngine.run_all_scenarios(basket, universe_data)

                # Explain
                explanation = Explainability.explain_basket(basket, scenarios, regime)

                # Build snapshot
                snapshot = ModelIndex.build_index_snapshot(
                    index_id, basket, explanation, regime, mc, scenarios,
                )
                results[index_id] = snapshot

            except Exception as e:
                logger.error(f"Pipeline failed for {index_id}: {e}", exc_info=True)
                results[index_id] = {"error": str(e)}

        elapsed = (datetime.utcnow() - start).total_seconds()
        logger.info(f"All-indices pipeline complete in {elapsed:.1f}s")

        return results

    async def get_regime(self) -> Dict[str, Any]:
        """Quick regime detection without full pipeline."""
        universe_data = await self.collector.collect_universe()
        macro = await self.collector.collect_macro()
        breadth = self.collector.compute_breadth(universe_data)
        regime = RegimeEngine.detect_regime(macro, breadth)
        regime["breadth"] = breadth
        regime["macro"] = {
            "vix": macro.get("vix"),
            "spy_price": macro.get("spy_price"),
        }
        return regime

    async def get_stock_deep_dive(self, ticker: str) -> Dict[str, Any]:
        """
        Full factor analysis for a single stock.
        Returns all 10 dimension scores + explainability.
        """
        # Collect data for just this stock + macro
        stock_data = await self.collector.collect_stock(ticker)
        if not stock_data.get("_symbol_found"):
            return {"error": f"Symbol {ticker} not found"}

        macro = await self.collector.collect_macro()
        breadth = {"above_sma200_pct": 50, "above_sma50_pct": 50, "positive_macd_pct": 50}
        regime = RegimeEngine.detect_regime(macro, breadth)

        # Score across all index types
        scores_by_strategy = {}
        for strategy_type in BASKET_CONSTRAINTS.keys():
            scores = FactorEngine.score_stock(
                stock_data, regime, strategy_type, {ticker: stock_data},
            )
            scores_by_strategy[strategy_type] = scores

        # Primary scores (using balanced_core)
        primary = scores_by_strategy.get("balanced_core", {})

        # Risk
        risk = RiskEngine.stock_risk(stock_data)

        # Explanation
        explanation = Explainability.explain_stock(
            ticker, primary, stock_data, selected=True,
        )

        return {
            "ticker": ticker,
            "company_name": stock_data.get("company_name"),
            "sector": stock_data.get("sector"),
            "industry": stock_data.get("industry"),
            "price": stock_data.get("price"),
            "market_cap": stock_data.get("market_cap"),
            "primary_scores": primary,
            "scores_by_strategy": {
                k: {
                    "composite_score": v.get("composite_score"),
                    "regime_adjusted_score": v.get("regime_adjusted_score"),
                    "grade": v.get("grade", "C"),
                }
                for k, v in scores_by_strategy.items()
            },
            "risk": risk,
            "explanation": explanation,
            "regime": {
                "regime": regime.get("regime"),
                "regime_label": regime.get("regime_label"),
                "confidence": regime.get("confidence"),
            },
            "raw_data_snapshot": {
                "pe_ratio": stock_data.get("pe_ratio"),
                "forward_pe": stock_data.get("forward_pe"),
                "peg_ratio": stock_data.get("peg_ratio"),
                "roe": stock_data.get("roe"),
                "roic": stock_data.get("roic"),
                "profit_margin": stock_data.get("profit_margin"),
                "debt_to_equity": stock_data.get("debt_to_equity"),
                "beta": stock_data.get("beta"),
                "rsi": stock_data.get("rsi"),
                "volatility": stock_data.get("volatility"),
                "target_price": stock_data.get("target_price"),
                "recommendation": stock_data.get("recommendation"),
                "data_completeness": stock_data.get("data_completeness"),
            },
            "generated_at": datetime.utcnow().isoformat(),
        }

    async def get_universe_rankings(self, index_type: str = "balanced_core") -> Dict[str, Any]:
        """
        Score and rank the entire universe without building a basket.
        Returns all stocks sorted by composite score.
        """
        universe_data = await self.collector.collect_universe()
        macro = await self.collector.collect_macro()
        breadth = self.collector.compute_breadth(universe_data)
        regime = RegimeEngine.detect_regime(macro, breadth)

        scored = FactorEngine.score_universe(universe_data, regime, index_type)

        # Sort by score
        ranked = sorted(
            scored.values(),
            key=lambda x: x.get("regime_adjusted_score", 0),
            reverse=True,
        )

        return {
            "index_type": index_type,
            "regime": regime.get("regime_label"),
            "regime_confidence": regime.get("confidence"),
            "total_scored": len(ranked),
            "rankings": [
                {
                    "rank": i + 1,
                    "ticker": s.get("ticker"),
                    "company_name": s.get("company_name"),
                    "sector": s.get("sector"),
                    "composite_score": round(s.get("composite_score", 0), 1),
                    "regime_adjusted_score": round(s.get("regime_adjusted_score", 0), 1),
                    "grade": s.get("grade"),
                    "confidence": round(s.get("confidence_score", 0), 1),
                    "factor_scores": {k: round(v, 1) for k, v in s.get("factor_scores", {}).items()},
                }
                for i, s in enumerate(ranked)
            ],
            "generated_at": datetime.utcnow().isoformat(),
        }

    def get_cached_snapshot(self, index_id: str) -> Optional[Dict[str, Any]]:
        """Return the most recently cached pipeline result."""
        return self._cache.get(index_id)
