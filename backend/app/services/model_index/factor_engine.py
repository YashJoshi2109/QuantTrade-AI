"""
Model Index Engine — Multi-Factor Scoring Engine

Scores every stock on 10 orthogonal dimensions (0-100 each),
applies regime-based weight adjustments, and produces a composite score.
"""

import logging
import numpy as np
from typing import Dict, Any, Optional, List, Tuple

from app.services.model_index.config import (
    FACTOR_WEIGHTS,
    SECTOR_VALUATION_MEDIANS,
    SECTOR_MACRO_SENSITIVITY,
    DATA_QUALITY,
    get_sector_for_ticker,
)

logger = logging.getLogger(__name__)


def _sf(val, default=0.0):
    """Safe float with default."""
    if val is None:
        return default
    try:
        v = float(val)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


def _clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, val))


class FactorEngine:
    """
    Computes 10-dimension factor scores for each stock, then combines
    them into a regime-adjusted composite score.
    """

    # ── 1. FUNDAMENTAL SCORE ─────────────────────────────────────────────

    @staticmethod
    def _score_fundamental(d: Dict) -> float:
        """
        Revenue growth, EPS growth, margins, FCF quality.
        Higher growth + wider margins = higher score.
        """
        points = []

        # Revenue growth (quarterly YoY)
        rev_g = d.get("quarterly_revenue_growth")
        if rev_g is not None:
            # 0% = 40, 10% = 55, 25% = 70, 50%+ = 85
            points.append(_clamp(40 + _sf(rev_g) * 1.0, 10, 95))

        # Earnings growth (quarterly YoY)
        earn_g = d.get("quarterly_earnings_growth")
        if earn_g is not None:
            points.append(_clamp(40 + _sf(earn_g) * 0.8, 10, 95))

        # EPS (positive = good, negative = bad)
        eps = d.get("eps")
        if eps is not None:
            if eps > 0:
                points.append(_clamp(50 + min(eps, 20) * 2, 30, 90))
            else:
                points.append(_clamp(30 + eps * 2, 5, 40))

        # Gross margin
        gm = d.get("gross_margin")
        if gm is not None:
            # 30% = 45, 50% = 60, 70%+ = 80
            points.append(_clamp(20 + _sf(gm) * 0.85, 10, 90))

        # Operating margin
        om = d.get("operating_margin")
        if om is not None:
            points.append(_clamp(30 + _sf(om) * 1.5, 10, 90))

        # Profit margin
        pm = d.get("profit_margin")
        if pm is not None:
            points.append(_clamp(30 + _sf(pm) * 1.5, 10, 90))

        if not points:
            return 50.0  # neutral
        return round(np.mean(points), 1)

    # ── 2. VALUATION SCORE ───────────────────────────────────────────────

    @staticmethod
    def _score_valuation(d: Dict) -> float:
        """
        PE relative to sector, PEG, P/B, EV/EBITDA.
        Lower (cheaper) = higher score.
        """
        sector = d.get("sector", "Unknown")
        medians = SECTOR_VALUATION_MEDIANS.get(sector, SECTOR_VALUATION_MEDIANS.get("Technology"))
        points = []

        # PE ratio vs sector median (cheaper = better)
        pe = d.get("pe_ratio")
        if pe is not None and pe > 0 and medians:
            median_pe = medians.get("pe", 20)
            ratio = pe / median_pe
            # ratio < 0.7 = very cheap (85), ratio = 1.0 = fair (55), ratio > 1.5 = expensive (25)
            points.append(_clamp(85 - (ratio - 0.7) * 60, 10, 95))

        # Forward PE (forward-looking valuation)
        fpe = d.get("forward_pe")
        if fpe is not None and fpe > 0:
            median_pe = medians.get("pe", 20) if medians else 20
            ratio = fpe / (median_pe * 0.9)  # Forward typically lower
            points.append(_clamp(80 - (ratio - 0.7) * 55, 10, 90))

        # PEG ratio (< 1 = undervalued growth, > 2 = overvalued)
        peg = d.get("peg_ratio")
        if peg is not None and peg > 0:
            points.append(_clamp(85 - (peg - 0.5) * 30, 10, 95))

        # EV/EBITDA
        ev_ebitda = d.get("ev_to_ebitda")
        if ev_ebitda is not None and ev_ebitda > 0 and medians:
            median_ev = medians.get("ev_ebitda", 15)
            ratio = ev_ebitda / median_ev
            points.append(_clamp(80 - (ratio - 0.7) * 50, 10, 90))

        # P/B
        pb = d.get("price_to_book")
        if pb is not None and pb > 0 and medians:
            median_pb = medians.get("pb", 4)
            ratio = pb / median_pb
            points.append(_clamp(75 - (ratio - 0.5) * 40, 10, 85))

        # P/S
        ps = d.get("price_to_sales")
        if ps is not None and ps > 0 and medians:
            median_ps = medians.get("ps", 3)
            ratio = ps / median_ps
            points.append(_clamp(75 - (ratio - 0.5) * 35, 10, 85))

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── 3. QUALITY SCORE ─────────────────────────────────────────────────

    @staticmethod
    def _score_quality(d: Dict) -> float:
        """
        ROIC, ROE, ROA, margins, capital discipline, balance sheet strength.
        """
        points = []

        # ROE
        roe = d.get("roe")
        if roe is not None:
            points.append(_clamp(30 + _sf(roe) * 2.0, 10, 95))

        # ROA
        roa = d.get("roa")
        if roa is not None:
            points.append(_clamp(30 + _sf(roa) * 3.0, 10, 95))

        # ROIC
        roic = d.get("roic")
        if roic is not None:
            points.append(_clamp(25 + _sf(roic) * 2.5, 10, 95))

        # ROI
        roi = d.get("roi")
        if roi is not None:
            points.append(_clamp(30 + _sf(roi) * 2.0, 10, 90))

        # Debt to equity (lower = better quality)
        de = d.get("debt_to_equity")
        if de is not None:
            # D/E 0 = 90, D/E 0.5 = 70, D/E 1 = 55, D/E 2+ = 25
            points.append(_clamp(90 - _sf(de) * 30, 10, 95))

        # Current ratio (liquidity; 1.5-3.0 ideal)
        cr = d.get("current_ratio")
        if cr is not None:
            if cr >= 1.5 and cr <= 3.0:
                points.append(75)
            elif cr >= 1.0:
                points.append(55)
            elif cr > 3.0:
                points.append(60)  # Too much cash sitting idle
            else:
                points.append(30)

        # Operating margin (profitability quality)
        om = d.get("operating_margin")
        if om is not None:
            points.append(_clamp(25 + _sf(om) * 2.0, 10, 90))

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── 4. TECHNICAL SCORE ───────────────────────────────────────────────

    @staticmethod
    def _score_technical(d: Dict) -> float:
        """
        RSI positioning, price vs SMA trend, MACD, Bollinger position,
        volume anomaly, momentum.
        """
        points = []
        price = d.get("price")

        # RSI — mean-reversion + trend signal
        rsi = d.get("rsi")
        if rsi is not None:
            if 40 <= rsi <= 60:
                points.append(55)  # Neutral
            elif 30 <= rsi < 40:
                points.append(65)  # Oversold opportunity
            elif rsi < 30:
                points.append(75)  # Deep oversold = contrarian buy
            elif 60 < rsi <= 70:
                points.append(60)  # Momentum
            elif rsi > 70:
                points.append(45)  # Overbought risk

        # Price vs SMA200 (trend)
        sma200 = d.get("sma_200")
        if price and sma200 and sma200 > 0:
            pct_above = ((price - sma200) / sma200) * 100
            if pct_above > 0:
                points.append(_clamp(55 + min(pct_above, 20) * 1.5, 50, 85))
            else:
                points.append(_clamp(50 + pct_above * 1.0, 15, 50))

        # Golden / death cross (SMA50 vs SMA200)
        sma50 = d.get("sma_50")
        if sma50 and sma200 and sma200 > 0:
            if sma50 > sma200:
                points.append(70)  # Golden cross territory
            else:
                points.append(35)  # Death cross territory

        # Price vs SMA50 (near-term trend)
        if price and sma50 and sma50 > 0:
            if price > sma50:
                points.append(65)
            else:
                points.append(40)

        # MACD
        macd_hist = d.get("macd_histogram")
        if macd_hist is not None:
            if macd_hist > 0:
                points.append(_clamp(55 + min(abs(macd_hist) * 10, 25), 55, 80))
            else:
                points.append(_clamp(45 - min(abs(macd_hist) * 10, 20), 25, 45))

        # Bollinger Band position
        bb_upper = d.get("bb_upper")
        bb_lower = d.get("bb_lower")
        if price and bb_upper and bb_lower and bb_upper > bb_lower:
            position = (price - bb_lower) / (bb_upper - bb_lower)
            if 0.3 <= position <= 0.7:
                points.append(55)  # Middle of band
            elif position > 0.8:
                points.append(40)  # Near upper (stretched)
            elif position < 0.2:
                points.append(65)  # Near lower (bounce potential)
            else:
                points.append(50)

        # Volume anomaly
        vol = d.get("volume")
        avg_vol = d.get("avg_volume")
        if vol and avg_vol and avg_vol > 0:
            vol_ratio = vol / avg_vol
            if vol_ratio > 1.5:
                # High volume is a confirming signal (positive if price up)
                chg = _sf(d.get("change_pct"), 0)
                points.append(65 if chg > 0 else 40)
            else:
                points.append(50)

        # 52-week range position
        w52h = d.get("week_52_high")
        w52l = d.get("week_52_low")
        if price and w52h and w52l and w52h > w52l:
            range_pos = (price - w52l) / (w52h - w52l)
            # Near high = momentum, near low = value but risky
            if 0.6 <= range_pos <= 0.85:
                points.append(65)  # Healthy uptrend
            elif range_pos > 0.9:
                points.append(50)  # Extended
            elif 0.3 <= range_pos < 0.6:
                points.append(55)  # Mid-range
            else:
                points.append(40)  # Near lows

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── 5. SENTIMENT SCORE ───────────────────────────────────────────────

    @staticmethod
    def _score_sentiment(d: Dict) -> float:
        """
        Analyst recommendation, target upside, short float (contrarian),
        insider ownership, institutional ownership.
        """
        points = []

        # Analyst recommendation (1=strong buy, 5=strong sell)
        rec = d.get("analyst_rating")
        if rec is not None:
            # 1.0 = 90, 2.0 = 75, 3.0 = 50, 4.0 = 30, 5.0 = 15
            points.append(_clamp(105 - _sf(rec) * 20, 10, 95))

        # Target price upside
        target = d.get("target_price")
        price = d.get("price")
        if target and price and price > 0:
            upside = ((target - price) / price) * 100
            points.append(_clamp(50 + upside * 1.5, 10, 95))

        # Short float (contrarian — very high short can mean squeeze potential)
        short_f = d.get("short_float")
        if short_f is not None:
            if short_f > 20:
                points.append(40)  # Heavy short — bearish consensus
            elif short_f > 10:
                points.append(45)
            elif short_f < 3:
                points.append(65)  # Low short interest — bullish consensus
            else:
                points.append(55)

        # Insider ownership (higher = aligned incentives)
        insider = d.get("insider_ownership")
        if insider is not None:
            if insider > 10:
                points.append(70)
            elif insider > 5:
                points.append(60)
            else:
                points.append(50)

        # Institutional ownership
        inst = d.get("institutional_ownership")
        if inst is not None:
            if 40 <= inst <= 85:
                points.append(65)  # Sweet spot
            elif inst > 85:
                points.append(50)  # Crowded
            else:
                points.append(45)

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── 6. MACRO FIT SCORE ───────────────────────────────────────────────

    @staticmethod
    def _score_macro_fit(d: Dict, regime: Dict) -> float:
        """
        How well the stock's sector/characteristics fit the current macro regime.
        """
        sector = d.get("sector", "Unknown")
        regime_id = regime.get("regime", "soft_landing")
        sensitivity = SECTOR_MACRO_SENSITIVITY.get(sector, {})

        points = []

        # Regime-specific scoring
        if regime_id in ("risk_on_growth", "momentum_leadership", "fed_easing"):
            # Growth-friendly: favor low rate sensitivity, high beta
            rate_sens = sensitivity.get("rate_sensitive", 0.5)
            points.append(_clamp(70 - rate_sens * 30, 30, 85))  # Low rate sens = good
            beta = _sf(d.get("beta"), 1.0)
            points.append(_clamp(40 + beta * 20, 30, 80))  # Higher beta = more upside

        elif regime_id in ("risk_off_defensive", "recession_fear"):
            # Defensive: favor low recession sensitivity, low beta
            rec_sens = sensitivity.get("recession_sensitive", 0.5)
            points.append(_clamp(80 - rec_sens * 50, 20, 90))  # Low recession sens = good
            beta = _sf(d.get("beta"), 1.0)
            points.append(_clamp(80 - beta * 25, 20, 85))  # Low beta = safe

        elif regime_id in ("inflationary_pressure", "commodity_spike"):
            # Inflation: favor energy/materials, pricing power
            energy_sens = sensitivity.get("energy_sensitive", 0.5)
            inf_sens = sensitivity.get("inflation_sensitive", 0.5)
            points.append(_clamp(40 + energy_sens * 40, 30, 85))
            margin = _sf(d.get("gross_margin"), 40)
            points.append(_clamp(30 + margin * 0.7, 30, 80))  # Pricing power

        elif regime_id in ("fed_tightening", "high_volatility"):
            # Tightening: favor quality, low leverage
            de = _sf(d.get("debt_to_equity"), 1.0)
            points.append(_clamp(80 - de * 25, 20, 85))
            rate_sens = sensitivity.get("rate_sensitive", 0.5)
            points.append(_clamp(75 - rate_sens * 40, 20, 80))

        else:
            # Neutral / soft landing: balanced
            points.append(55)

        # Dividend yield bonus in defensive regimes
        if regime_id in ("risk_off_defensive", "recession_fear", "fed_easing"):
            div_y = d.get("dividend_yield")
            if div_y and div_y > 2:
                points.append(_clamp(55 + div_y * 5, 55, 80))

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── 7. GEOPOLITICAL RESILIENCE SCORE ─────────────────────────────────

    @staticmethod
    def _score_geopolitical(d: Dict) -> float:
        """
        Trade policy sensitivity, supply chain exposure, energy shock sensitivity.
        Based on sector-level proxies.
        """
        sector = d.get("sector", "Unknown")
        sensitivity = SECTOR_MACRO_SENSITIVITY.get(sector, {})
        points = []

        # Trade sensitivity (lower = more resilient)
        trade = sensitivity.get("trade_sensitive", 0.5)
        points.append(_clamp(80 - trade * 50, 20, 90))

        # Energy shock sensitivity (lower = more resilient)
        energy = sensitivity.get("energy_sensitive", 0.5)
        points.append(_clamp(75 - energy * 40, 20, 85))

        # Domestic revenue bias (proxy: healthcare, utilities less exposed)
        if sector in ("Healthcare", "Utilities"):
            points.append(72)
        elif sector in ("Technology", "Materials", "Energy"):
            points.append(40)
        else:
            points.append(55)

        return round(np.mean(points), 1)

    # ── 8. RISK SCORE (inverted: higher = LOWER risk = BETTER) ───────────

    @staticmethod
    def _score_risk(d: Dict) -> float:
        """
        Inverse risk: low volatility, low drawdown, moderate beta = high score.
        """
        points = []

        # Volatility (lower = better)
        vol = d.get("volatility")
        if vol is not None:
            # vol 10% = 80, vol 20% = 60, vol 40% = 30, vol 60%+ = 15
            points.append(_clamp(90 - vol * 1.2, 10, 95))

        # Max drawdown (lower = better)
        dd = d.get("max_drawdown")
        if dd is not None:
            points.append(_clamp(90 - dd * 1.5, 10, 90))

        # Beta (close to 0.8-1.0 is ideal; > 1.5 or < 0.3 penalized)
        beta = d.get("beta")
        if beta is not None:
            if 0.7 <= beta <= 1.2:
                points.append(70)
            elif 0.5 <= beta <= 1.5:
                points.append(55)
            else:
                points.append(35)

        # Downside deviation (lower = better)
        dd_dev = d.get("downside_deviation")
        if dd_dev is not None:
            points.append(_clamp(85 - dd_dev * 1.0, 10, 90))

        # Risk score from RiskScorer (invert it: low raw risk = high safety score)
        raw_risk = d.get("risk_score_raw")
        if raw_risk is not None:
            points.append(_clamp(100 - raw_risk, 10, 95))

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── 9. DIVERSIFICATION SCORE ─────────────────────────────────────────

    @staticmethod
    def _score_diversification(d: Dict, universe_data: Dict[str, Dict]) -> float:
        """
        How much unique variance this stock adds to a portfolio.
        Based on sector rarity and beta distance from universe mean.
        """
        sector = d.get("sector", "Unknown")
        ticker = d.get("ticker", "")

        # Count sector concentration in universe
        sector_counts: Dict[str, int] = {}
        betas = []
        for t, ud in universe_data.items():
            s = ud.get("sector", "Unknown")
            sector_counts[s] = sector_counts.get(s, 0) + 1
            b = ud.get("beta")
            if b is not None:
                betas.append(b)

        total = max(len(universe_data), 1)
        sector_pct = sector_counts.get(sector, 0) / total

        # Rarer sector = higher diversification value
        sector_score = _clamp(80 - sector_pct * 100, 20, 85)

        # Beta distance from mean (more different = more diversification)
        beta = _sf(d.get("beta"), 1.0)
        mean_beta = np.mean(betas) if betas else 1.0
        beta_diff = abs(beta - mean_beta)
        beta_score = _clamp(40 + beta_diff * 30, 30, 75)

        return round((sector_score * 0.6 + beta_score * 0.4), 1)

    # ── 10. ANALYST SCORE ────────────────────────────────────────────────

    @staticmethod
    def _score_analyst(d: Dict) -> float:
        """
        Wall Street consensus: target dispersion, recommendation, upgrade trend.
        """
        points = []

        # Analyst rating (1-5 scale, 1 = strong buy)
        rating = d.get("analyst_rating")
        if rating is not None:
            points.append(_clamp(100 - (_sf(rating) - 1) * 22, 10, 95))

        # Recommendation text mapping
        rec = d.get("recommendation")
        if rec:
            rec_lower = str(rec).lower()
            rec_scores = {
                "strong buy": 90, "buy": 75, "outperform": 70,
                "overweight": 65, "hold": 50, "neutral": 50,
                "underweight": 35, "underperform": 30,
                "sell": 20, "strong sell": 10,
            }
            for key, score in rec_scores.items():
                if key in rec_lower:
                    points.append(score)
                    break

        # Target upside
        target = d.get("target_price")
        price = d.get("price")
        if target and price and price > 0:
            upside = ((target - price) / price) * 100
            points.append(_clamp(50 + upside * 1.2, 10, 90))

        # Institutional ownership as consensus proxy
        inst = d.get("institutional_ownership")
        if inst is not None:
            if inst > 70:
                points.append(65)
            elif inst > 50:
                points.append(60)
            elif inst > 30:
                points.append(50)
            else:
                points.append(40)

        if not points:
            return 50.0
        return round(np.mean(points), 1)

    # ── COMPOSITE SCORING ────────────────────────────────────────────────

    @staticmethod
    def score_stock(
        stock_data: Dict[str, Any],
        regime: Dict[str, Any],
        index_type: str,
        universe_data: Optional[Dict[str, Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Score a single stock across all 10 dimensions with regime adjustment.

        Returns full score breakdown + composite + confidence.
        """
        if universe_data is None:
            universe_data = {}

        # Compute raw dimension scores
        scores = {
            "fundamental": FactorEngine._score_fundamental(stock_data),
            "valuation": FactorEngine._score_valuation(stock_data),
            "quality": FactorEngine._score_quality(stock_data),
            "technical": FactorEngine._score_technical(stock_data),
            "sentiment": FactorEngine._score_sentiment(stock_data),
            "macro_fit": FactorEngine._score_macro_fit(stock_data, regime),
            "geopolitical": FactorEngine._score_geopolitical(stock_data),
            "risk": FactorEngine._score_risk(stock_data),
            "diversification": FactorEngine._score_diversification(stock_data, universe_data),
            "analyst": FactorEngine._score_analyst(stock_data),
        }

        # Get base weights for this index type
        base_weights = FACTOR_WEIGHTS.get(index_type, FACTOR_WEIGHTS["balanced_core"])

        # Apply regime adjustments
        regime_adj = regime.get("factor_adjustments", {})
        adjusted_weights = {}
        for factor, base_w in base_weights.items():
            adj = regime_adj.get(factor, 1.0)
            adjusted_weights[factor] = base_w * adj

        # Normalize adjusted weights to sum to 1.0
        total_weight = sum(adjusted_weights.values())
        if total_weight > 0:
            adjusted_weights = {k: v / total_weight for k, v in adjusted_weights.items()}

        # Compute weighted composite
        composite = sum(
            scores[factor] * adjusted_weights.get(factor, 0)
            for factor in scores
        )

        # Regime-adjusted score
        regime_adjusted = composite

        # Data quality penalty
        completeness = stock_data.get("data_completeness", 100)
        if completeness < DATA_QUALITY["completeness_penalty_threshold"] * 100:
            penalty = DATA_QUALITY["completeness_penalty_factor"]
            regime_adjusted *= (1 - penalty)

        # Confidence score (based on data quality + regime confidence)
        regime_confidence = regime.get("confidence", 50)
        confidence = _clamp(
            (completeness * 0.6 + regime_confidence * 0.4),
            10, 95,
        )

        # Conviction score (how decisive the factor signals are)
        score_variance = np.std(list(scores.values()))
        conviction = _clamp(40 + score_variance * 1.5, 20, 90)

        return {
            "ticker": stock_data.get("ticker"),
            "company_name": stock_data.get("company_name"),
            "sector": stock_data.get("sector"),
            "industry": stock_data.get("industry"),
            "factor_scores": scores,
            "composite_score": round(composite, 2),
            "regime_adjusted_score": round(regime_adjusted, 2),
            "confidence_score": round(confidence, 1),
            "conviction_score": round(conviction, 1),
            "data_completeness": completeness,
            "weights_used": {k: round(v, 4) for k, v in adjusted_weights.items()},
        }

    @staticmethod
    def score_universe(
        universe_data: Dict[str, Dict[str, Any]],
        regime: Dict[str, Any],
        index_type: str,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Score all stocks in the universe with rank-normalization.
        Returns scored_universe keyed by ticker.
        """
        # Score all stocks
        raw_scores = {}
        for ticker, data in universe_data.items():
            if data.get("data_completeness", 0) < DATA_QUALITY["min_completeness_for_scoring"] * 100:
                continue
            raw_scores[ticker] = FactorEngine.score_stock(
                data, regime, index_type, universe_data,
            )

        if not raw_scores:
            return {}

        # Rank-normalize composite scores within universe
        composites = [(t, s["composite_score"]) for t, s in raw_scores.items()]
        composites.sort(key=lambda x: x[1], reverse=True)

        total = len(composites)
        for rank, (ticker, _) in enumerate(composites):
            percentile = ((total - rank) / total) * 100
            raw_scores[ticker]["universe_rank"] = rank + 1
            raw_scores[ticker]["universe_percentile"] = round(percentile, 1)
            raw_scores[ticker]["universe_size"] = total

            # Grade assignment
            if percentile >= 90:
                raw_scores[ticker]["grade"] = "A+"
            elif percentile >= 80:
                raw_scores[ticker]["grade"] = "A"
            elif percentile >= 70:
                raw_scores[ticker]["grade"] = "B+"
            elif percentile >= 60:
                raw_scores[ticker]["grade"] = "B"
            elif percentile >= 50:
                raw_scores[ticker]["grade"] = "C+"
            elif percentile >= 40:
                raw_scores[ticker]["grade"] = "C"
            elif percentile >= 30:
                raw_scores[ticker]["grade"] = "D"
            else:
                raw_scores[ticker]["grade"] = "F"

        logger.info(
            f"Scored {len(raw_scores)} stocks for index_type={index_type}, "
            f"top: {composites[0][0]}={composites[0][1]:.1f}, "
            f"median: {composites[len(composites)//2][1]:.1f}"
        )

        return raw_scores
