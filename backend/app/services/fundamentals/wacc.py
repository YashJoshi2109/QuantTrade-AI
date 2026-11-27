"""Weighted average cost of capital with every input explicit.

    cost of equity  = risk_free + beta x equity_risk_premium            (CAPM)
    after-tax Kd    = pre-tax cost of debt x (1 - tax rate)
    WACC            = E/(D+E) x Ke + D/(D+E) x after-tax Kd

Inputs and their default sources (each returned with the result):

* risk-free rate      FRED DGS10 (10-year Treasury constant maturity), latest observation
* beta                provider beta from the fundamentals table (source stated); overridable
* equity risk premium ASSUMPTION, default 5.0 % (``DEFAULT_ERP_PCT``); overridable
* pre-tax Kd          interest_expense / average total_debt, latest fiscal year (XBRL)
* tax rate            effective rate when 0-50 % and pretax income > 0, else statutory 21 % (assumption)
* E                   market capitalisation (price x SEC cover-page shares, or provider market cap)
* D                   book total debt (XBRL), as a proxy for market value of debt

The valuation engine can supply its own WACC: ``register_wacc_provider(fn)``
with ``fn(ticker) -> Optional[dict]`` returning at least ``{"wacc_pct": float,
"source": str}``.  A caller-supplied ``wacc_pct`` always wins and is labelled
as a user assumption.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional

DEFAULT_ERP_PCT = 5.0

_provider: Optional[Callable[[str], Awaitable[Optional[Dict[str, Any]]]]] = None


def register_wacc_provider(fn: Optional[Callable[[str], Awaitable[Optional[Dict[str, Any]]]]]) -> None:
    global _provider
    _provider = fn


def wacc_provider():
    return _provider


def compute_wacc(*, risk_free_pct: float, beta: float, equity_risk_premium_pct: float,
                 pre_tax_cost_of_debt_pct: Optional[float], tax_rate_pct: float,
                 market_value_equity: float, total_debt: float) -> Dict[str, Any]:
    if market_value_equity <= 0:
        raise ValueError("market value of equity must be positive")
    if total_debt < 0:
        raise ValueError("total debt cannot be negative")
    ke = risk_free_pct + beta * equity_risk_premium_pct
    v = market_value_equity + total_debt
    we, wd = market_value_equity / v, total_debt / v
    if total_debt > 0 and pre_tax_cost_of_debt_pct is None:
        raise ValueError("pre-tax cost of debt is required when the company has debt")
    kd_after = (pre_tax_cost_of_debt_pct or 0.0) * (1 - tax_rate_pct / 100)
    wacc = we * ke + wd * kd_after
    return {
        "wacc_pct": round(wacc, 2),
        "cost_of_equity_pct": round(ke, 2),
        "after_tax_cost_of_debt_pct": round(kd_after, 2),
        "weight_equity_pct": round(we * 100, 2),
        "weight_debt_pct": round(wd * 100, 2),
        "formula": "WACC = E/(D+E) x (rf + beta x ERP) + D/(D+E) x Kd x (1 - t)",
    }
