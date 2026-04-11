"""
Model Index Engine — Configuration & Constants

All factor weights, regime mappings, basket constraints, scenario templates,
and stock universe definitions live here. Fully configurable.
"""

from typing import Dict, List, Any


# ── Stock Universe ───────────────────────────────────────────────────────────

CURATED_UNIVERSE: Dict[str, List[str]] = {
    "Technology": [
        "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSM", "AVGO",
        "ORCL", "CRM", "AMD", "ADBE", "INTC", "CSCO", "NOW", "UBER",
        "SHOP", "SQ", "PLTR", "SNOW", "NET", "CRWD", "DDOG", "MDB",
        "PANW", "FTNT",
    ],
    "Healthcare": [
        "UNH", "LLY", "NVO", "JNJ", "ABBV", "MRK", "PFE", "TMO",
        "ABT", "AMGN", "MDT", "ISRG", "VRTX", "REGN", "BMY", "GILD",
        "CI", "HUM", "ZTS", "SYK", "BSX", "EW", "DXCM", "ILMN",
    ],
    "Financials": [
        "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "BLK", "SCHW",
        "AXP", "C", "USB", "PNC", "TFC", "ICE", "CME", "SPGI",
        "MCO", "AON", "MMC", "CB", "MET", "AIG", "PRU",
    ],
    "Consumer": [
        "TSLA", "WMT", "COST", "HD", "PG", "KO", "PEP", "MCD",
        "NKE", "SBUX", "TGT", "LOW", "TJX", "LULU", "ROST", "DG",
        "EL", "CL", "YUM", "CMG", "DHR", "ABNB", "BKNG", "MAR",
    ],
    "Energy": [
        "XOM", "CVX", "COP", "EOG", "SLB", "PXD", "MPC", "PSX",
        "VLO", "OXY", "HAL", "DVN", "FANG", "HES", "BKR", "KMI",
    ],
    "Industrials": [
        "CAT", "BA", "HON", "GE", "UNP", "RTX", "DE", "LMT",
        "MMM", "UPS", "FDX", "GD", "NOC", "WM", "RSG", "EMR",
        "ETN", "ITW", "APH", "CARR",
    ],
    "Materials": [
        "LIN", "APD", "SHW", "ECL", "FCX", "NEM", "NUE", "DOW",
    ],
    "Utilities": [
        "NEE", "DUK", "SO", "D", "AEP", "SRE", "EXC", "XEL",
    ],
    "Real Estate": [
        "PLD", "AMT", "CCI", "EQIX", "SPG", "O", "PSA", "WELL",
    ],
    "Communication": [
        "GOOG", "DIS", "NFLX", "CMCSA", "T", "VZ", "TMUS", "CHTR",
    ],
}


def get_full_universe() -> List[str]:
    """Return flat list of all tickers in the curated universe."""
    tickers = []
    for sector_tickers in CURATED_UNIVERSE.values():
        tickers.extend(sector_tickers)
    return list(set(tickers))


def get_sector_for_ticker(ticker: str) -> str:
    """Lookup sector for a given ticker."""
    for sector, tickers in CURATED_UNIVERSE.items():
        if ticker in tickers:
            return sector
    return "Unknown"


# ── Factor Weight Profiles (per index type) ──────────────────────────────────
# Each weight set sums to 1.0. These are BASE weights before regime adjustment.

FACTOR_WEIGHTS: Dict[str, Dict[str, float]] = {
    "growth_leadership": {
        "fundamental": 0.18,
        "valuation": 0.08,
        "quality": 0.12,
        "technical": 0.15,
        "sentiment": 0.10,
        "macro_fit": 0.10,
        "geopolitical": 0.03,
        "risk": 0.08,
        "diversification": 0.06,
        "analyst": 0.10,
    },
    "defensive_quality": {
        "fundamental": 0.12,
        "valuation": 0.12,
        "quality": 0.20,
        "technical": 0.08,
        "sentiment": 0.05,
        "macro_fit": 0.10,
        "geopolitical": 0.05,
        "risk": 0.15,
        "diversification": 0.08,
        "analyst": 0.05,
    },
    "value_dcf": {
        "fundamental": 0.15,
        "valuation": 0.25,
        "quality": 0.15,
        "technical": 0.05,
        "sentiment": 0.05,
        "macro_fit": 0.08,
        "geopolitical": 0.03,
        "risk": 0.10,
        "diversification": 0.06,
        "analyst": 0.08,
    },
    "momentum_swing": {
        "fundamental": 0.05,
        "valuation": 0.05,
        "quality": 0.05,
        "technical": 0.30,
        "sentiment": 0.15,
        "macro_fit": 0.10,
        "geopolitical": 0.02,
        "risk": 0.12,
        "diversification": 0.06,
        "analyst": 0.10,
    },
    "balanced_core": {
        "fundamental": 0.12,
        "valuation": 0.12,
        "quality": 0.12,
        "technical": 0.12,
        "sentiment": 0.08,
        "macro_fit": 0.10,
        "geopolitical": 0.05,
        "risk": 0.12,
        "diversification": 0.10,
        "analyst": 0.07,
    },
    "ai_innovation": {
        "fundamental": 0.15,
        "valuation": 0.05,
        "quality": 0.10,
        "technical": 0.18,
        "sentiment": 0.15,
        "macro_fit": 0.08,
        "geopolitical": 0.03,
        "risk": 0.10,
        "diversification": 0.06,
        "analyst": 0.10,
    },
    "low_volatility": {
        "fundamental": 0.10,
        "valuation": 0.15,
        "quality": 0.18,
        "technical": 0.05,
        "sentiment": 0.03,
        "macro_fit": 0.10,
        "geopolitical": 0.05,
        "risk": 0.22,
        "diversification": 0.07,
        "analyst": 0.05,
    },
    "macro_hedge": {
        "fundamental": 0.08,
        "valuation": 0.10,
        "quality": 0.12,
        "technical": 0.10,
        "sentiment": 0.08,
        "macro_fit": 0.20,
        "geopolitical": 0.10,
        "risk": 0.10,
        "diversification": 0.07,
        "analyst": 0.05,
    },
    "all_weather": {
        "fundamental": 0.12,
        "valuation": 0.12,
        "quality": 0.15,
        "technical": 0.08,
        "sentiment": 0.05,
        "macro_fit": 0.12,
        "geopolitical": 0.06,
        "risk": 0.15,
        "diversification": 0.10,
        "analyst": 0.05,
    },
    "tactical_opportunistic": {
        "fundamental": 0.08,
        "valuation": 0.10,
        "quality": 0.08,
        "technical": 0.22,
        "sentiment": 0.15,
        "macro_fit": 0.12,
        "geopolitical": 0.03,
        "risk": 0.08,
        "diversification": 0.06,
        "analyst": 0.08,
    },
}


# ── Regime Definitions ───────────────────────────────────────────────────────

REGIME_DEFINITIONS = {
    "risk_on_growth": {
        "label": "Risk-On Growth",
        "description": "Bullish environment favoring growth and momentum",
        "conditions": {"vix_max": 18, "breadth_min": 55, "momentum_breadth_min": 55},
    },
    "risk_off_defensive": {
        "label": "Risk-Off Defensive",
        "description": "Flight to safety, defensive posture",
        "conditions": {"vix_min": 28, "breadth_max": 40},
    },
    "high_volatility": {
        "label": "High Volatility",
        "description": "Elevated VIX with choppy price action",
        "conditions": {"vix_min": 25},
    },
    "soft_landing": {
        "label": "Soft Landing",
        "description": "Moderating growth with controlled inflation",
        "conditions": {"vix_max": 22, "breadth_min": 45, "breadth_max": 65},
    },
    "inflationary_pressure": {
        "label": "Inflationary Pressure",
        "description": "Rising inflation impacting valuations",
        "conditions": {"inflation_elevated": True},
    },
    "recession_fear": {
        "label": "Recession Fear",
        "description": "Yield curve inversion, weakening breadth",
        "conditions": {"yield_curve_inverted": True, "breadth_max": 35},
    },
    "fed_easing": {
        "label": "Fed Easing",
        "description": "Rate cuts or dovish pivot supporting risk assets",
        "conditions": {"fed_direction": "easing"},
    },
    "fed_tightening": {
        "label": "Fed Tightening",
        "description": "Rate hikes or hawkish tone pressuring valuations",
        "conditions": {"fed_direction": "tightening"},
    },
    "momentum_leadership": {
        "label": "Momentum Leadership",
        "description": "Strong trending market with narrow leadership",
        "conditions": {"momentum_breadth_min": 65, "vix_max": 20},
    },
    "defensive_rotation": {
        "label": "Defensive Rotation",
        "description": "Capital rotating from growth to defensives",
        "conditions": {"breadth_declining": True, "defensive_outperforming": True},
    },
}


# ── Regime Factor Adjustments ────────────────────────────────────────────────
# Multipliers applied to base factor weights depending on detected regime.
# > 1.0 = boost that factor, < 1.0 = dampen it.

REGIME_FACTOR_ADJUSTMENTS: Dict[str, Dict[str, float]] = {
    "risk_on_growth": {
        "fundamental": 1.2, "valuation": 0.7, "quality": 0.8, "technical": 1.3,
        "sentiment": 1.3, "macro_fit": 0.9, "geopolitical": 0.7, "risk": 0.7,
        "diversification": 0.8, "analyst": 1.1,
    },
    "risk_off_defensive": {
        "fundamental": 0.9, "valuation": 1.2, "quality": 1.5, "technical": 0.6,
        "sentiment": 0.7, "macro_fit": 1.2, "geopolitical": 1.3, "risk": 1.5,
        "diversification": 1.2, "analyst": 0.8,
    },
    "high_volatility": {
        "fundamental": 0.9, "valuation": 1.1, "quality": 1.3, "technical": 0.7,
        "sentiment": 0.8, "macro_fit": 1.1, "geopolitical": 1.1, "risk": 1.4,
        "diversification": 1.1, "analyst": 0.8,
    },
    "soft_landing": {
        "fundamental": 1.1, "valuation": 1.1, "quality": 1.1, "technical": 1.0,
        "sentiment": 1.0, "macro_fit": 1.0, "geopolitical": 1.0, "risk": 1.0,
        "diversification": 1.0, "analyst": 1.0,
    },
    "inflationary_pressure": {
        "fundamental": 1.0, "valuation": 1.3, "quality": 1.2, "technical": 0.8,
        "sentiment": 0.8, "macro_fit": 1.4, "geopolitical": 1.2, "risk": 1.2,
        "diversification": 1.0, "analyst": 0.8,
    },
    "recession_fear": {
        "fundamental": 1.0, "valuation": 1.2, "quality": 1.5, "technical": 0.5,
        "sentiment": 0.6, "macro_fit": 1.3, "geopolitical": 1.1, "risk": 1.5,
        "diversification": 1.3, "analyst": 0.7,
    },
    "fed_easing": {
        "fundamental": 1.1, "valuation": 0.8, "quality": 0.9, "technical": 1.2,
        "sentiment": 1.2, "macro_fit": 1.1, "geopolitical": 0.8, "risk": 0.8,
        "diversification": 0.9, "analyst": 1.1,
    },
    "fed_tightening": {
        "fundamental": 1.0, "valuation": 1.3, "quality": 1.3, "technical": 0.7,
        "sentiment": 0.7, "macro_fit": 1.2, "geopolitical": 1.0, "risk": 1.3,
        "diversification": 1.1, "analyst": 0.8,
    },
    "momentum_leadership": {
        "fundamental": 0.8, "valuation": 0.6, "quality": 0.7, "technical": 1.5,
        "sentiment": 1.4, "macro_fit": 0.9, "geopolitical": 0.7, "risk": 0.8,
        "diversification": 0.7, "analyst": 1.2,
    },
    "defensive_rotation": {
        "fundamental": 1.0, "valuation": 1.2, "quality": 1.4, "technical": 0.7,
        "sentiment": 0.7, "macro_fit": 1.2, "geopolitical": 1.2, "risk": 1.4,
        "diversification": 1.2, "analyst": 0.7,
    },
}


# ── Basket Construction Constraints ──────────────────────────────────────────

BASKET_CONSTRAINTS: Dict[str, Dict[str, Any]] = {
    "growth_leadership": {
        "min_holdings": 12, "max_holdings": 25,
        "sector_cap_pct": 0.35, "max_single_stock_pct": 0.08,
        "min_score_threshold": 45, "correlation_ceiling": 0.85,
        "weighting_method": "score_weighted",
        "preferred_roles": ["growth_driver", "core_compounder", "tactical_momentum"],
    },
    "defensive_quality": {
        "min_holdings": 15, "max_holdings": 30,
        "sector_cap_pct": 0.30, "max_single_stock_pct": 0.06,
        "min_score_threshold": 50, "correlation_ceiling": 0.75,
        "weighting_method": "inverse_volatility",
        "preferred_roles": ["defensive_stabilizer", "cashflow_anchor", "core_compounder"],
    },
    "value_dcf": {
        "min_holdings": 15, "max_holdings": 30,
        "sector_cap_pct": 0.30, "max_single_stock_pct": 0.07,
        "min_score_threshold": 45, "correlation_ceiling": 0.80,
        "weighting_method": "score_weighted",
        "preferred_roles": ["valuation_rebound", "cashflow_anchor", "core_compounder"],
    },
    "momentum_swing": {
        "min_holdings": 8, "max_holdings": 18,
        "sector_cap_pct": 0.40, "max_single_stock_pct": 0.10,
        "min_score_threshold": 50, "correlation_ceiling": 0.85,
        "weighting_method": "score_weighted",
        "preferred_roles": ["tactical_momentum", "growth_driver", "cyclical_upside"],
    },
    "balanced_core": {
        "min_holdings": 20, "max_holdings": 35,
        "sector_cap_pct": 0.25, "max_single_stock_pct": 0.05,
        "min_score_threshold": 40, "correlation_ceiling": 0.75,
        "weighting_method": "capped_score_weighted",
        "preferred_roles": ["core_compounder", "defensive_stabilizer", "growth_driver"],
    },
    "ai_innovation": {
        "min_holdings": 10, "max_holdings": 20,
        "sector_cap_pct": 0.50, "max_single_stock_pct": 0.10,
        "min_score_threshold": 45, "correlation_ceiling": 0.85,
        "weighting_method": "score_weighted",
        "preferred_roles": ["growth_driver", "tactical_momentum", "core_compounder"],
    },
    "low_volatility": {
        "min_holdings": 20, "max_holdings": 35,
        "sector_cap_pct": 0.25, "max_single_stock_pct": 0.05,
        "min_score_threshold": 45, "correlation_ceiling": 0.70,
        "weighting_method": "inverse_volatility",
        "preferred_roles": ["defensive_stabilizer", "cashflow_anchor", "core_compounder"],
    },
    "macro_hedge": {
        "min_holdings": 10, "max_holdings": 20,
        "sector_cap_pct": 0.35, "max_single_stock_pct": 0.08,
        "min_score_threshold": 40, "correlation_ceiling": 0.75,
        "weighting_method": "risk_adjusted_conviction",
        "preferred_roles": ["macro_hedge", "defensive_stabilizer", "cyclical_upside"],
    },
    "all_weather": {
        "min_holdings": 20, "max_holdings": 35,
        "sector_cap_pct": 0.20, "max_single_stock_pct": 0.05,
        "min_score_threshold": 40, "correlation_ceiling": 0.70,
        "weighting_method": "risk_adjusted_conviction",
        "preferred_roles": ["core_compounder", "defensive_stabilizer", "macro_hedge"],
    },
    "tactical_opportunistic": {
        "min_holdings": 8, "max_holdings": 15,
        "sector_cap_pct": 0.45, "max_single_stock_pct": 0.12,
        "min_score_threshold": 55, "correlation_ceiling": 0.90,
        "weighting_method": "score_weighted",
        "preferred_roles": ["tactical_momentum", "cyclical_upside", "valuation_rebound"],
    },
}


# ── Stock Roles ──────────────────────────────────────────────────────────────

STOCK_ROLES = {
    "core_compounder": {
        "label": "Core Compounder",
        "description": "High-quality business with consistent growth",
        "signals": {"quality_min": 65, "fundamental_min": 55},
    },
    "growth_driver": {
        "label": "Growth Driver",
        "description": "High-growth stock driving portfolio returns",
        "signals": {"fundamental_min": 65, "technical_min": 55},
    },
    "tactical_momentum": {
        "label": "Tactical Momentum",
        "description": "Strong near-term momentum play",
        "signals": {"technical_min": 70, "sentiment_min": 55},
    },
    "defensive_stabilizer": {
        "label": "Defensive Stabilizer",
        "description": "Low-volatility stabilizer in downturns",
        "signals": {"risk_min": 60, "quality_min": 55},
    },
    "macro_hedge": {
        "label": "Macro Hedge",
        "description": "Positioned to benefit from macro shifts",
        "signals": {"macro_fit_min": 65, "geopolitical_min": 55},
    },
    "cyclical_upside": {
        "label": "Cyclical Upside",
        "description": "Cyclical stock poised for upswing",
        "signals": {"macro_fit_min": 60, "technical_min": 55},
    },
    "valuation_rebound": {
        "label": "Valuation Rebound",
        "description": "Undervalued stock with catalyst for re-rating",
        "signals": {"valuation_min": 65, "analyst_min": 50},
    },
    "cashflow_anchor": {
        "label": "Cash Flow Anchor",
        "description": "Strong FCF generator providing portfolio ballast",
        "signals": {"quality_min": 60, "valuation_min": 50, "risk_min": 55},
    },
}


# ── Scenario Templates ──────────────────────────────────────────────────────

SCENARIO_TEMPLATES: List[Dict[str, Any]] = [
    {
        "name": "fed_cuts",
        "label": "Fed Rate Cuts",
        "description": "Federal Reserve begins cutting interest rates",
        "sector_impacts": {
            "Technology": 1.15, "Healthcare": 1.05, "Financials": 0.92,
            "Consumer": 1.08, "Energy": 1.02, "Industrials": 1.06,
            "Real Estate": 1.12, "Utilities": 1.10, "Materials": 1.04,
            "Communication": 1.08,
        },
        "vol_multiplier": 1.1,
        "drift_adjustment": 0.02,
    },
    {
        "name": "fed_hikes",
        "label": "Fed Rate Hikes",
        "description": "Federal Reserve raises interest rates unexpectedly",
        "sector_impacts": {
            "Technology": 0.88, "Healthcare": 0.97, "Financials": 1.06,
            "Consumer": 0.93, "Energy": 1.00, "Industrials": 0.95,
            "Real Estate": 0.85, "Utilities": 0.90, "Materials": 0.95,
            "Communication": 0.90,
        },
        "vol_multiplier": 1.3,
        "drift_adjustment": -0.03,
    },
    {
        "name": "recession_shock",
        "label": "Recession Shock",
        "description": "Sudden economic contraction and earnings downgrades",
        "sector_impacts": {
            "Technology": 0.82, "Healthcare": 0.95, "Financials": 0.80,
            "Consumer": 0.85, "Energy": 0.78, "Industrials": 0.80,
            "Real Estate": 0.82, "Utilities": 0.96, "Materials": 0.78,
            "Communication": 0.88,
        },
        "vol_multiplier": 1.8,
        "drift_adjustment": -0.08,
    },
    {
        "name": "inflation_surprise",
        "label": "Inflation Surprise",
        "description": "CPI comes in significantly above expectations",
        "sector_impacts": {
            "Technology": 0.90, "Healthcare": 0.95, "Financials": 1.02,
            "Consumer": 0.88, "Energy": 1.15, "Industrials": 0.95,
            "Real Estate": 0.88, "Utilities": 0.92, "Materials": 1.12,
            "Communication": 0.90,
        },
        "vol_multiplier": 1.4,
        "drift_adjustment": -0.02,
    },
    {
        "name": "geopolitical_shock",
        "label": "Geopolitical Shock",
        "description": "Major geopolitical event disrupts global markets",
        "sector_impacts": {
            "Technology": 0.88, "Healthcare": 0.95, "Financials": 0.85,
            "Consumer": 0.90, "Energy": 1.20, "Industrials": 0.85,
            "Real Estate": 0.90, "Utilities": 0.98, "Materials": 0.92,
            "Communication": 0.88,
        },
        "vol_multiplier": 2.0,
        "drift_adjustment": -0.05,
    },
    {
        "name": "volatility_spike",
        "label": "Volatility Spike",
        "description": "VIX surges above 35, triggering risk-off behavior",
        "sector_impacts": {
            "Technology": 0.85, "Healthcare": 0.94, "Financials": 0.88,
            "Consumer": 0.92, "Energy": 0.90, "Industrials": 0.88,
            "Real Estate": 0.90, "Utilities": 0.97, "Materials": 0.88,
            "Communication": 0.88,
        },
        "vol_multiplier": 2.2,
        "drift_adjustment": -0.04,
    },
    {
        "name": "tech_rally",
        "label": "Tech-Led Rally",
        "description": "AI / tech sector leads broad market higher",
        "sector_impacts": {
            "Technology": 1.25, "Healthcare": 1.02, "Financials": 1.05,
            "Consumer": 1.08, "Energy": 0.98, "Industrials": 1.05,
            "Real Estate": 1.00, "Utilities": 0.95, "Materials": 1.02,
            "Communication": 1.15,
        },
        "vol_multiplier": 1.1,
        "drift_adjustment": 0.05,
    },
    {
        "name": "commodity_spike",
        "label": "Commodity Spike",
        "description": "Oil and commodity prices surge on supply disruption",
        "sector_impacts": {
            "Technology": 0.92, "Healthcare": 0.95, "Financials": 0.95,
            "Consumer": 0.88, "Energy": 1.30, "Industrials": 0.92,
            "Real Estate": 0.93, "Utilities": 0.90, "Materials": 1.20,
            "Communication": 0.93,
        },
        "vol_multiplier": 1.5,
        "drift_adjustment": -0.02,
    },
]


# ── Sector Correlation Proxies ───────────────────────────────────────────────
# Simplified pairwise sector correlations (avoids per-stock calculation).

SECTOR_CORRELATIONS: Dict[str, Dict[str, float]] = {
    "Technology":     {"Technology": 1.0, "Healthcare": 0.45, "Financials": 0.55, "Consumer": 0.60, "Energy": 0.25, "Industrials": 0.55, "Materials": 0.40, "Utilities": 0.15, "Real Estate": 0.30, "Communication": 0.75},
    "Healthcare":     {"Technology": 0.45, "Healthcare": 1.0, "Financials": 0.40, "Consumer": 0.50, "Energy": 0.20, "Industrials": 0.40, "Materials": 0.30, "Utilities": 0.35, "Real Estate": 0.25, "Communication": 0.40},
    "Financials":     {"Technology": 0.55, "Healthcare": 0.40, "Financials": 1.0, "Consumer": 0.50, "Energy": 0.45, "Industrials": 0.60, "Materials": 0.50, "Utilities": 0.30, "Real Estate": 0.55, "Communication": 0.50},
    "Consumer":       {"Technology": 0.60, "Healthcare": 0.50, "Financials": 0.50, "Consumer": 1.0, "Energy": 0.30, "Industrials": 0.55, "Materials": 0.40, "Utilities": 0.25, "Real Estate": 0.35, "Communication": 0.55},
    "Energy":         {"Technology": 0.25, "Healthcare": 0.20, "Financials": 0.45, "Consumer": 0.30, "Energy": 1.0, "Industrials": 0.50, "Materials": 0.65, "Utilities": 0.35, "Real Estate": 0.20, "Communication": 0.25},
    "Industrials":    {"Technology": 0.55, "Healthcare": 0.40, "Financials": 0.60, "Consumer": 0.55, "Energy": 0.50, "Industrials": 1.0, "Materials": 0.60, "Utilities": 0.30, "Real Estate": 0.40, "Communication": 0.50},
    "Materials":      {"Technology": 0.40, "Healthcare": 0.30, "Financials": 0.50, "Consumer": 0.40, "Energy": 0.65, "Industrials": 0.60, "Materials": 1.0, "Utilities": 0.30, "Real Estate": 0.30, "Communication": 0.35},
    "Utilities":      {"Technology": 0.15, "Healthcare": 0.35, "Financials": 0.30, "Consumer": 0.25, "Energy": 0.35, "Industrials": 0.30, "Materials": 0.30, "Utilities": 1.0, "Real Estate": 0.50, "Communication": 0.20},
    "Real Estate":    {"Technology": 0.30, "Healthcare": 0.25, "Financials": 0.55, "Consumer": 0.35, "Energy": 0.20, "Industrials": 0.40, "Materials": 0.30, "Utilities": 0.50, "Real Estate": 1.0, "Communication": 0.30},
    "Communication":  {"Technology": 0.75, "Healthcare": 0.40, "Financials": 0.50, "Consumer": 0.55, "Energy": 0.25, "Industrials": 0.50, "Materials": 0.35, "Utilities": 0.20, "Real Estate": 0.30, "Communication": 1.0},
}


# ── Sector Macro Sensitivity ────────────────────────────────────────────────
# How sensitive each sector is to different macro conditions (0-1 scale).

SECTOR_MACRO_SENSITIVITY: Dict[str, Dict[str, float]] = {
    "Technology":     {"rate_sensitive": 0.8, "inflation_sensitive": 0.6, "recession_sensitive": 0.5, "energy_sensitive": 0.2, "trade_sensitive": 0.7},
    "Healthcare":     {"rate_sensitive": 0.3, "inflation_sensitive": 0.3, "recession_sensitive": 0.2, "energy_sensitive": 0.1, "trade_sensitive": 0.4},
    "Financials":     {"rate_sensitive": 0.9, "inflation_sensitive": 0.5, "recession_sensitive": 0.7, "energy_sensitive": 0.2, "trade_sensitive": 0.3},
    "Consumer":       {"rate_sensitive": 0.6, "inflation_sensitive": 0.7, "recession_sensitive": 0.6, "energy_sensitive": 0.4, "trade_sensitive": 0.5},
    "Energy":         {"rate_sensitive": 0.3, "inflation_sensitive": 0.4, "recession_sensitive": 0.5, "energy_sensitive": 0.9, "trade_sensitive": 0.6},
    "Industrials":    {"rate_sensitive": 0.5, "inflation_sensitive": 0.5, "recession_sensitive": 0.6, "energy_sensitive": 0.5, "trade_sensitive": 0.7},
    "Materials":      {"rate_sensitive": 0.4, "inflation_sensitive": 0.6, "recession_sensitive": 0.6, "energy_sensitive": 0.6, "trade_sensitive": 0.7},
    "Utilities":      {"rate_sensitive": 0.7, "inflation_sensitive": 0.4, "recession_sensitive": 0.2, "energy_sensitive": 0.5, "trade_sensitive": 0.1},
    "Real Estate":    {"rate_sensitive": 0.9, "inflation_sensitive": 0.5, "recession_sensitive": 0.5, "energy_sensitive": 0.2, "trade_sensitive": 0.2},
    "Communication":  {"rate_sensitive": 0.6, "inflation_sensitive": 0.4, "recession_sensitive": 0.4, "energy_sensitive": 0.2, "trade_sensitive": 0.5},
}


# ── Valuation Sector Medians (approximate) ──────────────────────────────────
# Used to compute relative valuation scores.

SECTOR_VALUATION_MEDIANS: Dict[str, Dict[str, float]] = {
    "Technology":     {"pe": 28.0, "ps": 6.0, "pb": 8.0, "ev_ebitda": 22.0},
    "Healthcare":     {"pe": 22.0, "ps": 4.0, "pb": 4.5, "ev_ebitda": 16.0},
    "Financials":     {"pe": 14.0, "ps": 3.0, "pb": 1.8, "ev_ebitda": 12.0},
    "Consumer":       {"pe": 24.0, "ps": 2.5, "pb": 6.0, "ev_ebitda": 18.0},
    "Energy":         {"pe": 12.0, "ps": 1.5, "pb": 2.0, "ev_ebitda": 8.0},
    "Industrials":    {"pe": 20.0, "ps": 2.5, "pb": 4.0, "ev_ebitda": 14.0},
    "Materials":      {"pe": 16.0, "ps": 2.0, "pb": 3.0, "ev_ebitda": 10.0},
    "Utilities":      {"pe": 18.0, "ps": 2.5, "pb": 2.0, "ev_ebitda": 12.0},
    "Real Estate":    {"pe": 35.0, "ps": 6.0, "pb": 2.5, "ev_ebitda": 20.0},
    "Communication":  {"pe": 18.0, "ps": 3.5, "pb": 4.0, "ev_ebitda": 12.0},
}


# ── Data Quality Thresholds ─────────────────────────────────────────────────

DATA_QUALITY = {
    "min_completeness_for_scoring": 0.30,  # Must have 30% of fields populated
    "completeness_penalty_threshold": 0.50,  # Haircut below 50%
    "completeness_penalty_factor": 0.20,  # 20% score reduction
    "stale_data_days": 7,  # Data older than 7 days considered stale
}
