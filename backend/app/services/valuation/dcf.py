"""Three-stage free-cash-flow-to-firm DCF (vectorised so Monte Carlo and the
sensitivity grids run the exact same math as the point estimate).

Stages
  1. explicit growth: years 1..n1 grow revenue at g1
  2. fade: years n1+1..n1+n2, growth moves linearly from g1 to g_T
     (year n1+k grows at g1 + (g_T - g1) * k / n2)
  3. terminal: Gordon growth on year N+1 FCFF, or an EV/EBITDA exit multiple

Each explicit year t:
  revenue_t     = revenue_{t-1} * (1 + g_t)
  margin_t      = m_0 + (m_target - m_0) * min(t / convergence_years, 1)
  EBIT_t        = revenue_t * margin_t
  NOPAT_t       = EBIT_t - tax * max(EBIT_t, 0)           (no tax credit on losses)
  reinvest_t    = (revenue_t - revenue_{t-1}) / sales_to_capital
  FCFF_t        = NOPAT_t - reinvest_t
  PV_t          = FCFF_t / (1 + WACC)^t                  (t - 0.5 with mid-year convention)
Terminal (Gordon)
  FCFF_{N+1}    = NOPAT_{N+1} * (1 - g_T / ROIC_T)        (reinvestment rate = g / ROIC)
  TV_N          = FCFF_{N+1} / (WACC - g_T),  PV_TV = TV_N / (1 + WACC)^N
Terminal (exit multiple)
  TV_N          = (EBIT_N + D&A%_rev * revenue_N) * EV/EBITDA multiple
Equity bridge
  equity        = EV - total debt + cash & short-term investments
                  + long-term marketable securities - minority interest
  value / share = equity / shares outstanding (cover page)
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app.services.valuation.provenance import DataUnavailable, pct, r


@dataclass
class DCFAssumptions:
    stage1_growth: float
    terminal_growth: float
    operating_margin_start: float
    target_operating_margin: float
    tax_rate: float
    sales_to_capital: float
    wacc: float
    stage1_years: int = 5
    fade_years: int = 5
    margin_convergence_years: Optional[int] = None    # None -> stage1_years + fade_years
    terminal_method: str = "gordon"                    # "gordon" | "exit_multiple"
    terminal_roic: Optional[float] = None              # None -> WACC (no excess returns in perpetuity)
    exit_ev_ebitda: Optional[float] = None
    da_pct_revenue: Optional[float] = None
    mid_year: bool = False

    @property
    def horizon(self) -> int:
        return self.stage1_years + self.fade_years

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        for k in ("stage1_growth", "terminal_growth", "operating_margin_start", "target_operating_margin",
                  "tax_rate", "wacc", "terminal_roic", "da_pct_revenue"):
            if d.get(k) is not None:
                d[k + "_pct"] = pct(d.pop(k))
            else:
                d.pop(k, None)
        if d.get("margin_convergence_years") is None:
            d["margin_convergence_years"] = self.horizon
        if d.get("sales_to_capital") is not None:
            d["sales_to_capital"] = r(d["sales_to_capital"], 3)
        return d


@dataclass
class EquityBridge:
    total_debt: float = 0.0
    cash_and_sti: float = 0.0
    long_term_investments: float = 0.0
    minority_interest: float = 0.0
    shares_outstanding: Optional[float] = None
    price: Optional[float] = None                      # in reporting currency per share
    notes: List[str] = field(default_factory=list)

    def equity(self, ev):
        return ev - self.total_debt + self.cash_and_sti + self.long_term_investments - self.minority_interest


def _col(x, n: int) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    return np.broadcast_to(a.reshape(-1, 1) if a.ndim else a, (n, 1)).astype(float)


def project(revenue0: float, a: DCFAssumptions, *, g1=None, g_t=None, m_target=None, wacc=None,
            s2c=None, roic_t=None, exit_mult=None, m_start=None) -> Dict[str, np.ndarray]:
    """Vectorised projection. Any of the keyword arrays (shape (N,)) overrides
    the scalar in ``a``; results have shape (N, T) / (N,)."""
    vals = dict(g1=a.stage1_growth if g1 is None else g1,
                g_t=a.terminal_growth if g_t is None else g_t,
                m_target=a.target_operating_margin if m_target is None else m_target,
                m_start=a.operating_margin_start if m_start is None else m_start,
                wacc=a.wacc if wacc is None else wacc,
                s2c=a.sales_to_capital if s2c is None else s2c,
                roic_t=(a.terminal_roic if a.terminal_roic is not None else None) if roic_t is None else roic_t,
                exit_mult=a.exit_ev_ebitda if exit_mult is None else exit_mult)
    n = max(int(np.size(v)) for v in vals.values() if v is not None)
    G1, GT, MT, M0, W, S = (_col(vals[k], n) for k in ("g1", "g_t", "m_target", "m_start", "wacc", "s2c"))
    RT = W if vals["roic_t"] is None else _col(vals["roic_t"], n)
    n1, n2 = int(a.stage1_years), int(a.fade_years)
    T = n1 + n2
    if T < 1:
        raise ValueError("DCF horizon must be at least one year")
    t = np.arange(1, T + 1, dtype=float).reshape(1, -1)
    k = np.clip(t - n1, 0, None)
    growth = np.where(t <= n1, G1, G1 + (GT - G1) * (k / n2 if n2 else 0.0))
    revenue = revenue0 * np.cumprod(1.0 + growth, axis=1)
    prev = np.concatenate([np.full((n, 1), float(revenue0)), revenue[:, :-1]], axis=1)
    conv = float(a.margin_convergence_years or T)
    margin = M0 + (MT - M0) * np.minimum(t / conv, 1.0)
    ebit = revenue * margin
    nopat = ebit - a.tax_rate * np.maximum(ebit, 0.0)
    reinvest = (revenue - prev) / S
    fcff = nopat - reinvest
    expo = t - 0.5 if a.mid_year else t
    df = (1.0 + W) ** (-expo)
    pv = fcff * df
    df_n = (1.0 + W[:, 0]) ** (-float(T))
    if a.terminal_method == "exit_multiple":
        if vals["exit_mult"] is None or a.da_pct_revenue is None:
            raise DataUnavailable("exit-multiple terminal value needs exit_ev_ebitda and D&A % of revenue")
        ebitda_n = ebit[:, -1] + a.da_pct_revenue * revenue[:, -1]
        tv = ebitda_n * _col(vals["exit_mult"], n)[:, 0]
        fcff_next = np.full(n, np.nan)
    else:
        rev_next = revenue[:, -1] * (1.0 + GT[:, 0])
        ebit_next = rev_next * margin[:, -1]
        nopat_next = ebit_next - a.tax_rate * np.maximum(ebit_next, 0.0)
        fcff_next = nopat_next * (1.0 - GT[:, 0] / RT[:, 0])
        spread = W[:, 0] - GT[:, 0]
        tv = np.where(spread > 0, fcff_next / np.where(spread > 0, spread, 1.0), np.nan)
    pv_tv = tv * df_n
    ev = pv.sum(axis=1) + pv_tv
    return {"growth": growth, "revenue": revenue, "margin": margin, "ebit": ebit, "nopat": nopat,
            "reinvestment": reinvest, "fcff": fcff, "discount_factor": df, "pv_fcff": pv,
            "fcff_terminal_year": fcff_next, "terminal_value": tv, "pv_terminal_value": pv_tv,
            "enterprise_value": ev, "sum_pv_fcff": pv.sum(axis=1)}


def validate(a: DCFAssumptions) -> None:
    if a.stage1_years < 1 or a.fade_years < 0:
        raise ValueError("stage1_years must be >= 1 and fade_years >= 0")
    if a.sales_to_capital <= 0:
        raise ValueError("sales_to_capital must be positive")
    if a.terminal_method == "gordon":
        if a.terminal_growth >= a.wacc:
            raise ValueError(f"terminal growth ({pct(a.terminal_growth)}%) must be below WACC ({pct(a.wacc)}%)")
        if (a.terminal_roic if a.terminal_roic is not None else a.wacc) <= 0:
            raise ValueError("terminal ROIC must be positive")
    elif a.terminal_method != "exit_multiple":
        raise ValueError("terminal_method must be 'gordon' or 'exit_multiple'")


def per_share(ev, bridge: EquityBridge):
    if not bridge.shares_outstanding:
        raise DataUnavailable("shares outstanding unavailable; cannot compute value per share")
    return bridge.equity(ev) / bridge.shares_outstanding


def run_dcf(revenue0: float, a: DCFAssumptions, bridge: EquityBridge, base_fiscal_year: Optional[int] = None) -> Dict[str, Any]:
    """Point estimate with the full year-by-year table."""
    validate(a)
    p = project(revenue0, a)
    ev = float(p["enterprise_value"][0])
    equity = float(bridge.equity(ev))
    vps = per_share(ev, bridge)
    rows = []
    for i in range(a.horizon):
        stage = "explicit" if i < a.stage1_years else "fade"
        rows.append({
            "year": i + 1, "fiscal_year": (base_fiscal_year + i + 1) if base_fiscal_year else None, "stage": stage,
            "revenue": r(p["revenue"][0, i], 0), "revenue_growth_pct": pct(p["growth"][0, i]),
            "operating_margin_pct": pct(p["margin"][0, i]), "ebit": r(p["ebit"][0, i], 0),
            "nopat": r(p["nopat"][0, i], 0), "reinvestment": r(p["reinvestment"][0, i], 0),
            "fcff": r(p["fcff"][0, i], 0), "discount_factor": r(p["discount_factor"][0, i], 4),
            "pv_fcff": r(p["pv_fcff"][0, i], 0)})
    tv = float(p["terminal_value"][0])
    out = {
        "projection": rows,
        "terminal": {"method": a.terminal_method, "terminal_value": r(tv, 0),
                     "pv_terminal_value": r(p["pv_terminal_value"][0], 0),
                     "fcff_year_after_horizon": r(p["fcff_terminal_year"][0], 0) if a.terminal_method == "gordon" else None,
                     "share_of_enterprise_value_pct": pct(p["pv_terminal_value"][0] / ev) if ev else None,
                     "implied_exit_ev_ebitda": (r(tv / (p["ebit"][0, -1] + a.da_pct_revenue * p["revenue"][0, -1]), 2)
                                                if a.da_pct_revenue is not None and a.terminal_method == "gordon"
                                                and (p["ebit"][0, -1] + a.da_pct_revenue * p["revenue"][0, -1]) > 0 else None),
                     "formula": ("TV = FCFF_{N+1} / (WACC - g), FCFF_{N+1} = NOPAT_{N+1} * (1 - g / ROIC_terminal)"
                                 if a.terminal_method == "gordon" else "TV = EBITDA_N * EV/EBITDA exit multiple")},
        "sum_pv_fcff": r(p["sum_pv_fcff"][0], 0),
        "enterprise_value": r(ev, 0),
        "equity_bridge": {"enterprise_value": r(ev, 0), "less_total_debt": r(bridge.total_debt, 0),
                          "plus_cash_and_short_term_investments": r(bridge.cash_and_sti, 0),
                          "plus_long_term_marketable_securities": r(bridge.long_term_investments, 0),
                          "less_minority_interest": r(bridge.minority_interest, 0),
                          "equity_value": r(equity, 0), "shares_outstanding": r(bridge.shares_outstanding, 0),
                          "notes": bridge.notes or None},
        "value_per_share": r(vps, 2),
    }
    if bridge.price:
        out["vs_market"] = {"price": r(bridge.price, 2), "market_cap": r(bridge.price * bridge.shares_outstanding, 0),
                            "implied_equity_value": r(equity, 0),
                            "upside_downside_pct": pct(vps / bridge.price - 1.0),
                            "formula": "upside = value per share / price - 1; market cap = price x shares outstanding"}
    return out


def sensitivity(revenue0: float, a: DCFAssumptions, bridge: EquityBridge, row_param: str, row_values: Sequence[float],
                col_param: str, col_values: Sequence[float]) -> Dict[str, Any]:
    """Value per share over a 2-D grid (rows x cols). Cells where the Gordon
    model is undefined (g >= WACC) are None."""
    rv, cv = np.asarray(row_values, float), np.asarray(col_values, float)
    R, C = np.meshgrid(rv, cv, indexing="ij")
    kw = {_KW[row_param]: R.ravel(), _KW[col_param]: C.ravel()}
    p = project(revenue0, a, **kw)
    vps = per_share(p["enterprise_value"], bridge).reshape(R.shape)
    grid = [[(None if not np.isfinite(v) else r(v, 2)) for v in row] for row in vps]
    return {"rows": {"param": row_param, "values_pct": [pct(x) for x in rv]},
            "cols": {"param": col_param, "values_pct": [pct(x) for x in cv]},
            "value_per_share": grid,
            "note": "None = undefined (terminal growth >= WACC)"}


_KW = {"wacc": "wacc", "terminal_growth": "g_t", "stage1_growth": "g1", "target_operating_margin": "m_target",
       "sales_to_capital": "s2c"}


def default_grid(center: float, step: float, n_each_side: int = 2) -> List[float]:
    return [center + step * i for i in range(-n_each_side, n_each_side + 1)]


def with_(a: DCFAssumptions, **kw) -> DCFAssumptions:
    return replace(a, **kw)
