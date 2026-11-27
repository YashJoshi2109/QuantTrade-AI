"""Cost of capital: OLS beta with standard error, CAPM cost of equity, cost of
debt from interest expense / average debt, market-value-weighted WACC.

Formulas (all reported back in the output):
  beta        = cov(r_i, r_m) / var(r_m)           (OLS slope of r_i on r_m)
  SE(beta)    = sqrt( SSR / (n - 2) / sum((r_m - mean r_m)^2) )
  Ke          = rf + beta * ERP                     (CAPM)
  Kd          = interest expense / average(total debt at FY end, prior FY end)
  Kd after tax= Kd * (1 - marginal tax rate)
  WACC        = E/(D+E) * Ke + D/(D+E) * Kd * (1 - t),  E = price * shares out, D = book debt
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

from app.services.valuation.provenance import AssumptionLog, DataUnavailable, Datum, pct, r

# ── documented defaults (every one is reported as an assumption when used) ────
DEFAULT_ERP = 0.05
ERP_RATIONALE = ("Equity risk premium is an ASSUMPTION, not market data. Default 5.0%: close to the "
                 "long-run (1928-2024) US geometric excess return of stocks over T-bonds and to "
                 "Damodaran's implied ERP range (about 4-6% in recent years). Override with erp=.")
DEFAULT_MARGINAL_TAX = 0.21
MARGINAL_TAX_RATIONALE = ("US federal statutory corporate rate (21%, TCJA 2017) used for the interest "
                          "tax shield; state taxes ignored. Override with marginal_tax_rate=.")
DEFAULT_DEBT_SPREAD = 0.01
DEBT_SPREAD_RATIONALE = ("Used ONLY when interest expense / debt cannot be computed or is implausible: "
                         "pre-tax cost of debt = risk-free + 1.0% (roughly an investment-grade spread).")
MIN_OBS = {"weekly": 104, "daily": 500, "monthly": 36}


@dataclass
class BetaResult:
    beta: float
    alpha: float               # intercept per period (not annualised)
    se_beta: float
    t_stat: float
    r_squared: float
    n_obs: int
    frequency: str
    start: Optional[str] = None
    end: Optional[str] = None
    benchmark: str = "SPY"
    source: str = ""

    @property
    def ci95(self) -> tuple:
        return (self.beta - 1.96 * self.se_beta, self.beta + 1.96 * self.se_beta)

    @property
    def blume_adjusted(self) -> float:
        return 0.67 * self.beta + 0.33

    def to_dict(self) -> Dict[str, Any]:
        lo, hi = self.ci95
        return {"beta": r(self.beta), "standard_error": r(self.se_beta), "t_stat": r(self.t_stat, 2),
                "r_squared": r(self.r_squared), "ci95_low": r(lo), "ci95_high": r(hi),
                "blume_adjusted_beta": r(self.blume_adjusted), "alpha_per_period": r(self.alpha, 6),
                "n_observations": self.n_obs, "frequency": self.frequency, "benchmark": self.benchmark,
                "window_start": self.start, "window_end": self.end, "source": self.source,
                "formula": "OLS slope of stock returns on benchmark returns; SE = sqrt(SSR/(n-2)/Sxx); "
                           "Blume adjusted = 0.67*beta + 0.33"}


def ols_beta(stock: np.ndarray, market: np.ndarray) -> Dict[str, float]:
    """Plain OLS of stock returns on market returns with the classical slope SE."""
    y = np.asarray(stock, dtype=float)
    x = np.asarray(market, dtype=float)
    if y.shape != x.shape:
        raise ValueError("return series must be aligned")
    n = int(x.size)
    if n < 3:
        raise DataUnavailable("need at least 3 overlapping returns to estimate beta")
    xm, ym = x.mean(), y.mean()
    sxx = float(((x - xm) ** 2).sum())
    if sxx == 0:
        raise DataUnavailable("benchmark returns have zero variance")
    beta = float(((x - xm) * (y - ym)).sum() / sxx)
    alpha = float(ym - beta * xm)
    resid = y - (alpha + beta * x)
    ssr = float((resid ** 2).sum())
    sst = float(((y - ym) ** 2).sum())
    se = math.sqrt(ssr / (n - 2) / sxx)
    return {"beta": beta, "alpha": alpha, "se_beta": se, "t_stat": beta / se if se > 0 else float("inf"),
            "r_squared": 1.0 - ssr / sst if sst > 0 else 0.0, "n": n}


def period_returns(prices: pd.Series, frequency: str) -> pd.Series:
    """Simple returns from a date-indexed close series. Weekly = Friday closes
    (last close of each W-FRI week), monthly = month-end closes."""
    s = prices.dropna().sort_index()
    s = s[~s.index.duplicated(keep="last")]
    if frequency == "weekly":
        s = s.resample("W-FRI").last().dropna()
    elif frequency == "monthly":
        try:
            s = s.resample("ME").last().dropna()
        except ValueError:          # pandas < 2.2
            s = s.resample("M").last().dropna()
    elif frequency != "daily":
        raise ValueError(f"unknown frequency {frequency!r}")
    return s.pct_change().dropna()


def regress_beta(stock_prices: pd.Series, market_prices: pd.Series, *, frequency: str = "weekly",
                 years: float = 5.0, benchmark: str = "SPY", source: str = "") -> BetaResult:
    if stock_prices is None or market_prices is None or stock_prices.empty or market_prices.empty:
        raise DataUnavailable("price history unavailable for the beta regression")
    end = min(stock_prices.index.max(), market_prices.index.max())
    start = end - pd.Timedelta(days=int(round(365.25 * years)))
    rs = period_returns(stock_prices[(stock_prices.index >= start) & (stock_prices.index <= end)], frequency)
    rm = period_returns(market_prices[(market_prices.index >= start) & (market_prices.index <= end)], frequency)
    df = pd.concat([rs.rename("s"), rm.rename("m")], axis=1, join="inner").dropna()
    need = int(MIN_OBS.get(frequency, 30) * min(years, 5.0) / 5.0)
    if len(df) < max(need, 20):
        raise DataUnavailable(f"only {len(df)} overlapping {frequency} returns vs {benchmark} "
                              f"(need {max(need, 20)}) for a {years:g}-year beta")
    o = ols_beta(df["s"].to_numpy(), df["m"].to_numpy())
    return BetaResult(beta=o["beta"], alpha=o["alpha"], se_beta=o["se_beta"], t_stat=o["t_stat"],
                      r_squared=o["r_squared"], n_obs=o["n"], frequency=frequency,
                      start=df.index.min().date().isoformat(), end=df.index.max().date().isoformat(),
                      benchmark=benchmark, source=source)


def cost_of_debt(interest_expense: Optional[Datum], debt_now: Optional[Datum], debt_prior: Optional[Datum],
                 rf: float, log: AssumptionLog, spread: Optional[float] = None) -> Dict[str, Any]:
    """Pre-tax cost of debt = interest expense / average debt, with explicit fallback."""
    sp = DEFAULT_DEBT_SPREAD if spread is None else spread
    if debt_now is None or debt_now.value <= 0:
        return {"pre_tax": None, "method": "no debt reported", "note": "no debt in XBRL; debt weight is 0"}
    if interest_expense is not None and interest_expense.value > 0:
        avg = (debt_now.value + debt_prior.value) / 2 if debt_prior is not None and debt_prior.value > 0 else debt_now.value
        kd = interest_expense.value / avg
        formula = ("interest expense / average(total debt at FY end, prior FY end)" if debt_prior is not None
                   and debt_prior.value > 0 else "interest expense / total debt at FY end")
        if 0.0 < kd <= 0.20:
            return {"pre_tax": kd, "method": "implied from filings", "formula": formula,
                    "interest_expense": interest_expense.value, "average_debt": avg,
                    "interest_tag": interest_expense.tag, "accession": interest_expense.accession,
                    "note": "reported interest expense can include finance-lease and other interest while debt "
                            "excludes leases, which biases this rate upward"}
        note = f"implied {pct(kd)}% looks implausible (interest tag may include non-debt items)"
    else:
        note = "interest expense not reported in XBRL for the latest fiscal year"
    log.add("pre_tax_cost_of_debt", pct(rf + sp), f"{note}. {DEBT_SPREAD_RATIONALE}")
    return {"pre_tax": rf + sp, "method": "assumption: risk-free + spread", "note": note, "spread": sp}


def compute_wacc(*, rf: Datum, beta: float, erp: float, market_cap: float, total_debt: float,
                 kd_pre_tax: Optional[float], marginal_tax: float) -> Dict[str, Any]:
    ke = rf.value + beta * erp
    d = max(total_debt or 0.0, 0.0)
    e = market_cap
    if e is None or e <= 0:
        raise DataUnavailable("market capitalisation unavailable (needs quote price and shares outstanding)")
    we, wd = e / (e + d), d / (e + d)
    kd_at = (kd_pre_tax or 0.0) * (1 - marginal_tax)
    wacc = we * ke + wd * kd_at
    return {"wacc": wacc, "cost_of_equity": ke, "after_tax_cost_of_debt": kd_at, "weight_equity": we,
            "weight_debt": wd, "risk_free": rf.value, "beta": beta, "erp": erp,
            "pre_tax_cost_of_debt": kd_pre_tax, "marginal_tax_rate": marginal_tax,
            "equity_value": e, "debt_value": d}


def wacc_payload(w: Dict[str, Any]) -> Dict[str, Any]:
    return {"wacc_pct": pct(w["wacc"]), "cost_of_equity_pct": pct(w["cost_of_equity"]),
            "risk_free_pct": pct(w["risk_free"]), "beta_used": r(w["beta"]), "erp_pct": pct(w["erp"]),
            "pre_tax_cost_of_debt_pct": pct(w["pre_tax_cost_of_debt"]),
            "after_tax_cost_of_debt_pct": pct(w["after_tax_cost_of_debt"]),
            "marginal_tax_rate_pct": pct(w["marginal_tax_rate"]),
            "weight_equity_pct": pct(w["weight_equity"]), "weight_debt_pct": pct(w["weight_debt"]),
            "market_value_equity": r(w["equity_value"], 0), "book_value_debt": r(w["debt_value"], 0),
            "formula": "WACC = E/(D+E)*(rf + beta*ERP) + D/(D+E)*Kd*(1-t); E = price x shares outstanding, "
                       "D = book debt (proxy for market value of debt)"}
