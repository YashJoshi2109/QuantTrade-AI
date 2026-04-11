"""
Model Index Engine — Risk Engine

Stock-level and basket-level risk analytics: VaR, CVaR, concentration,
drawdown estimation, and risk-budget constraints.
"""

import logging
import numpy as np
from typing import Dict, Any, List, Optional

from app.services.model_index.config import SECTOR_CORRELATIONS

logger = logging.getLogger(__name__)


def _sf(val, default=0.0):
    if val is None:
        return default
    try:
        v = float(val)
        return default if (np.isnan(v) or np.isinf(v)) else v
    except (TypeError, ValueError):
        return default


class RiskEngine:
    """Enhanced risk analytics for individual stocks and baskets."""

    # ── Stock-Level Risk ─────────────────────────────────────────────────

    @staticmethod
    def stock_risk(stock_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Compute enhanced single-stock risk metrics.
        Uses data already collected by DataCollector.
        """
        ticker = stock_data.get("ticker", "???")
        vol = _sf(stock_data.get("volatility"), 25.0)  # annualized %
        beta = _sf(stock_data.get("beta"), 1.0)
        max_dd = _sf(stock_data.get("max_drawdown"), 15.0)
        dd_dev = _sf(stock_data.get("downside_deviation"), vol * 0.7)
        price = _sf(stock_data.get("price"), 100.0)

        # Daily volatility
        daily_vol = vol / (np.sqrt(252) * 100) if vol > 0 else 0.01

        # Parametric VaR (95%, 1-day)
        var_95_1d = price * 1.645 * daily_vol
        var_95_pct = 1.645 * daily_vol * 100  # as percentage

        # CVaR (Expected Shortfall) ≈ VaR * 1.4 for normal distribution
        cvar_95_1d = var_95_1d * 1.4
        cvar_95_pct = var_95_pct * 1.4

        # 10-day VaR/CVaR
        var_95_10d_pct = var_95_pct * np.sqrt(10)
        cvar_95_10d_pct = cvar_95_pct * np.sqrt(10)

        # Gap risk proxy (earnings + high short float)
        earnings_date = stock_data.get("earnings_date")
        short_float = _sf(stock_data.get("short_float"), 5.0)
        has_earnings_soon = bool(earnings_date)
        gap_risk = "high" if (has_earnings_soon and short_float > 10) else \
                   "medium" if has_earnings_soon else "low"

        # Valuation compression risk
        pe = _sf(stock_data.get("pe_ratio"), 20)
        forward_pe = _sf(stock_data.get("forward_pe"), pe)
        val_compression_risk = "high" if pe > 40 else "medium" if pe > 25 else "low"

        # Overall risk level
        risk_points = 0
        risk_points += min(vol * 0.5, 25)
        risk_points += min(max_dd * 0.4, 20)
        risk_points += min(abs(beta - 1) * 15, 15)
        risk_points += min(dd_dev * 0.3, 15) if dd_dev else 0
        risk_points += 10 if gap_risk == "high" else 5 if gap_risk == "medium" else 0
        risk_points += 10 if val_compression_risk == "high" else 5 if val_compression_risk == "medium" else 0

        risk_score = min(100, risk_points)
        risk_level = "High" if risk_score >= 65 else "Medium" if risk_score >= 35 else "Low"

        return {
            "ticker": ticker,
            "risk_score": round(risk_score, 2),
            "risk_level": risk_level,
            "volatility_annualized": round(vol, 2),
            "beta": round(beta, 3),
            "max_drawdown_pct": round(max_dd, 2),
            "downside_deviation": round(dd_dev, 2) if dd_dev else None,
            "var_95_1d_pct": round(var_95_pct, 3),
            "cvar_95_1d_pct": round(cvar_95_pct, 3),
            "var_95_10d_pct": round(var_95_10d_pct, 3),
            "cvar_95_10d_pct": round(cvar_95_10d_pct, 3),
            "gap_risk": gap_risk,
            "valuation_compression_risk": val_compression_risk,
            "earnings_event_flag": has_earnings_soon,
            "short_float_pct": round(short_float, 2),
        }

    # ── Basket-Level Risk ────────────────────────────────────────────────

    @staticmethod
    def basket_risk(
        holdings: List[Dict[str, Any]],
        universe_data: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Compute portfolio-level risk metrics for a basket.

        Args:
            holdings: List of {ticker, weight, sector, ...}
            universe_data: Full stock data for all tickers
        """
        if not holdings:
            return {"error": "No holdings provided"}

        weights = []
        vols = []
        betas = []
        sectors: Dict[str, float] = {}
        tickers_in_basket = []

        for h in holdings:
            ticker = h["ticker"]
            w = _sf(h.get("weight"), 0)
            sd = universe_data.get(ticker, {})

            weights.append(w)
            vol = _sf(sd.get("volatility"), 25.0)
            vols.append(vol)
            beta = _sf(sd.get("beta"), 1.0)
            betas.append(beta)
            tickers_in_basket.append(ticker)

            sector = h.get("sector", sd.get("sector", "Unknown"))
            sectors[sector] = sectors.get(sector, 0) + w

        weights = np.array(weights)
        vols = np.array(vols) / 100  # Convert to decimal
        betas = np.array(betas)

        # Weighted portfolio beta
        portfolio_beta = float(np.sum(weights * betas))

        # Portfolio volatility (using sector correlation matrix as proxy)
        # Simplified: weighted average vol with correlation dampening
        sector_list = [h.get("sector", universe_data.get(h["ticker"], {}).get("sector", "Unknown"))
                       for h in holdings]

        # Build correlation matrix from sector proxies
        n = len(holdings)
        corr_matrix = np.ones((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                s1 = sector_list[i]
                s2 = sector_list[j]
                corr = SECTOR_CORRELATIONS.get(s1, {}).get(s2, 0.5)
                corr_matrix[i][j] = corr
                corr_matrix[j][i] = corr

        # Portfolio variance: w' * Sigma * w
        # Sigma_ij = vol_i * vol_j * corr_ij
        cov_matrix = np.outer(vols, vols) * corr_matrix
        portfolio_var = float(weights @ cov_matrix @ weights)
        portfolio_vol = float(np.sqrt(portfolio_var)) * 100  # Back to percentage

        # Portfolio VaR / CVaR
        daily_port_vol = portfolio_vol / (np.sqrt(252))
        port_var_95 = 1.645 * daily_port_vol
        port_cvar_95 = port_var_95 * 1.4

        # Concentration metrics
        hhi = float(np.sum(weights ** 2))  # Herfindahl-Hirschman Index
        max_single_weight = float(np.max(weights)) if len(weights) > 0 else 0
        top5_weight = float(np.sum(np.sort(weights)[-5:])) if len(weights) >= 5 else float(np.sum(weights))

        # Sector concentration
        max_sector_weight = max(sectors.values()) if sectors else 0
        num_sectors = len(sectors)

        # Average pairwise correlation
        upper_tri = corr_matrix[np.triu_indices_from(corr_matrix, k=1)]
        avg_correlation = float(np.mean(upper_tri)) if len(upper_tri) > 0 else 0

        # Max drawdown estimate (historical-vol based approximation)
        # Approximation: max_dd ≈ 2.5 * portfolio_vol * sqrt(T/252) for T=90 days
        max_dd_estimate = 2.5 * portfolio_vol * np.sqrt(90 / 252)

        # Downside scenario (2-sigma move)
        downside_2sigma = portfolio_vol * 2 / np.sqrt(252) * np.sqrt(21)  # 1-month

        # Overall basket risk score (0-100)
        risk_points = 0
        risk_points += min(portfolio_vol * 0.6, 25)
        risk_points += min(abs(portfolio_beta - 1) * 20, 15)
        risk_points += min(hhi * 200, 15)  # HHI concentration penalty
        risk_points += min(max_sector_weight * 20, 15)
        risk_points += min(avg_correlation * 20, 15)
        risk_points += 10 if max_single_weight > 0.10 else 5 if max_single_weight > 0.06 else 0

        basket_risk_score = min(100, risk_points)
        basket_risk_level = "High" if basket_risk_score >= 60 else "Medium" if basket_risk_score >= 35 else "Low"

        return {
            "risk_score": round(basket_risk_score, 2),
            "risk_level": basket_risk_level,
            "portfolio_volatility_ann": round(portfolio_vol, 2),
            "portfolio_beta": round(portfolio_beta, 3),
            "var_95_daily_pct": round(port_var_95, 3),
            "cvar_95_daily_pct": round(port_cvar_95, 3),
            "max_drawdown_estimate_pct": round(max_dd_estimate, 2),
            "downside_1m_2sigma_pct": round(downside_2sigma, 2),
            "concentration": {
                "hhi": round(hhi, 4),
                "max_single_weight_pct": round(max_single_weight * 100, 2),
                "top5_weight_pct": round(top5_weight * 100, 2),
                "max_sector_weight_pct": round(max_sector_weight * 100, 2),
                "num_sectors": num_sectors,
                "avg_pairwise_correlation": round(avg_correlation, 3),
            },
            "sector_allocation": {k: round(v * 100, 2) for k, v in sorted(sectors.items(), key=lambda x: -x[1])},
            "num_holdings": len(holdings),
        }

    @staticmethod
    def risk_contribution(
        holdings: List[Dict[str, Any]],
        universe_data: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Calculate each holding's marginal contribution to portfolio risk.
        """
        contributions = []
        for h in holdings:
            ticker = h["ticker"]
            w = _sf(h.get("weight"), 0)
            sd = universe_data.get(ticker, {})
            vol = _sf(sd.get("volatility"), 25.0)
            beta = _sf(sd.get("beta"), 1.0)

            # Marginal risk contribution ≈ weight * vol * beta
            marginal = w * vol * beta / 100
            contributions.append({
                "ticker": ticker,
                "weight": round(w * 100, 2),
                "volatility": round(vol, 2),
                "beta": round(beta, 3),
                "risk_contribution": round(marginal * 100, 3),
            })

        # Sort by risk contribution
        contributions.sort(key=lambda x: x["risk_contribution"], reverse=True)
        return contributions
