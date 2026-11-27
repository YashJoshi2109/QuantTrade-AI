"""Deterministic financial-analysis metrics over normalised XBRL statements.

Every function reads named line items for named fiscal periods and either
returns a number or records *why* it could not (missing XBRL tag, zero
denominator, model not applicable).  Nothing is defaulted silently: when an
optional component that is often simply not reported (e.g. short-term
investments, noncontrolling interests) is treated as zero, that is recorded in
``Ctx.assumptions`` and surfaced in the tool output.

Conventions
-----------
* Balances in ratios over a year use the average of the opening and closing
  balance (opening = prior fiscal year end) unless the definition says
  "ending" or "beginning".
* EBIT is GAAP operating income (``OperatingIncomeLoss``).
* Percentages are returned in percent units (12.34 = 12.34 %), multiples as
  plain ratios (3.125 = 3.125x), days with one decimal.
* Formulas are in ``DEFINITIONS`` and are returned with every tool result.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

from app.services.fundamentals.xbrl import FPeriod, Statements

DAYS_IN_YEAR = 365
DEFAULT_STATUTORY_TAX_RATE_PCT = 21.0     # US federal statutory rate since 2018 (assumption, overridable)
TAX_RATE_BOUNDS = (0.0, 0.5)               # effective rates outside this range are not used for NOPAT

# Altman (1968) public manufacturers; Altman (1995/2000) Z'' non-manufacturers.
ALTMAN_Z = {"X1": 1.2, "X2": 1.4, "X3": 3.3, "X4": 0.6, "X5": 1.0}
ALTMAN_Z_ZONES = (1.81, 2.99)
ALTMAN_Z2 = {"X1": 6.56, "X2": 3.26, "X3": 6.72, "X4": 1.05}
ALTMAN_Z2_ZONES = (1.10, 2.60)
# Beneish (1999) 8-variable model.
BENEISH = {"intercept": -4.84, "DSRI": 0.920, "GMI": 0.528, "AQI": 0.404, "SGI": 0.892, "DEPI": 0.115,
           "SGAI": -0.172, "TATA": 4.679, "LVGI": -0.327}
BENEISH_THRESHOLD = -1.78

DEFINITIONS: Dict[str, str] = {
    # accruals / earnings quality
    "noa": "Net operating assets = (total_assets - cash - short_term_investments) - (total_liabilities - total_debt)",
    "bs_accrual_ratio_pct": "Balance-sheet accrual ratio (CFA) = (NOA_t - NOA_t-1) / ((NOA_t + NOA_t-1)/2)",
    "cf_accrual_ratio_pct": "Cash-flow accrual ratio (CFA) = (net_income - (operating_cash_flow + investing_cash_flow)) / ((NOA_t + NOA_t-1)/2). Investing cash flow includes purchases/sales of marketable securities, which can swing this ratio.",
    "sloan_accrual_pct": "Sloan accruals = (net_income - operating_cash_flow) / average total_assets",
    "ocf_to_net_income": "Cash conversion = operating_cash_flow / net_income",
    "net_income_growth_pct": "net_income_t / net_income_t-1 - 1",
    "ocf_growth_pct": "operating_cash_flow_t / operating_cash_flow_t-1 - 1",
    "growth_gap_pp": "net_income_growth_pct - ocf_growth_pct (percentage points)",
    "dso_days": "Days sales outstanding = average receivables / revenue x 365",
    "dio_days": "Days inventory outstanding = average inventory / cost_of_revenue x 365",
    "dpo_days": "Days payables outstanding = average accounts_payable / cost_of_revenue x 365",
    "ccc_days": "Cash conversion cycle = DSO + DIO - DPO",
    "receivables_growth_pct": "receivables_t / receivables_t-1 - 1 (ending balances)",
    "inventory_growth_pct": "inventory_t / inventory_t-1 - 1 (ending balances)",
    "revenue_growth_pct": "revenue_t / revenue_t-1 - 1",
    "non_cash_working_capital": "(current_assets - cash - short_term_investments) - (current_liabilities - current debt)",
    "sbc_pct_revenue": "sbc / revenue",
    # profitability / capital efficiency
    "gross_margin_pct": "gross_profit / revenue",
    "operating_margin_pct": "operating_income / revenue",
    "net_margin_pct": "net_income / revenue",
    "effective_tax_rate_pct": "income_tax / pretax_income; used for NOPAT only when pretax_income > 0 and 0%-50%, otherwise the statutory rate assumption is used",
    "nopat": "NOPAT = operating_income x (1 - tax rate)",
    "invested_capital": "Invested capital (financing approach) = total_debt + total_equity + minority_interest - cash - short_term_investments (+ operating_lease_liabilities if include_operating_leases)",
    "roic_pct": "ROIC = NOPAT / average invested capital (opening and closing)",
    "roic_ending_pct": "ROIC on ending invested capital = NOPAT / invested_capital_t",
    "incremental_roic_pct": "Incremental ROIC = (NOPAT_t - NOPAT_t-1) / (invested_capital_t - invested_capital_t-1)",
    "reinvestment": "Reinvestment = capex - depreciation_amortization + change in non-cash working capital + acquisitions",
    "reinvestment_rate_pct": "reinvestment / NOPAT",
    "sales_to_capital": "revenue / average invested capital",
    "capex_pct_revenue": "Capital intensity = capex / revenue",
    "capex_to_da": "capex / depreciation_amortization",
    "da_pct_revenue": "Depreciation burden = depreciation_amortization / revenue",
    "economic_profit": "(ROIC - WACC) x average invested capital",
    "roic_minus_wacc_pp": "ROIC - WACC (percentage points)",
    # DuPont
    "roe_pct": "ROE = net_income / average total_equity",
    "dupont3": "ROE = net margin (net_income/revenue) x asset turnover (revenue/avg total_assets) x equity multiplier (avg total_assets/avg total_equity)",
    "dupont5": "ROE = tax burden (net_income/pretax_income) x interest burden (pretax_income/EBIT) x EBIT margin (EBIT/revenue) x asset turnover x equity multiplier; EBIT = operating_income",
    "roe_change_attribution": "ln(ROE_last/ROE_first) = sum of ln(component_last/component_first); each component's share = its log change / total log change (exact, multiplicative)",
    # per-share decomposition
    "eps_computed": "net_income / weighted-average diluted shares",
    "per_share_decomposition": "ln(EPS_last/EPS_first) = ln(NI_last/NI_first) - ln(shares_last/shares_first); share-count contribution = -ln(shares ratio) / ln(EPS ratio)",
    "net_share_change_pct": "diluted weighted shares_t / shares_t-1 - 1 (negative = net buyback)",
    # distress / solvency
    "altman_z": "Z (1968, public manufacturers) = 1.2 X1 + 1.4 X2 + 3.3 X3 + 0.6 X4 + 1.0 X5; X1 = working capital/TA, X2 = retained earnings/TA, X3 = EBIT/TA, X4 = market value of equity/total liabilities, X5 = revenue/TA. Zones: < 1.81 distress, 1.81-2.99 grey, > 2.99 safe",
    "altman_z2": "Z'' (1995, non-manufacturers / emerging markets) = 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4 with X4 = book equity/total liabilities. Zones: < 1.10 distress, 1.10-2.60 grey, > 2.60 safe",
    "piotroski_f": "Piotroski (2000) F-score: 1 point each for ROA>0, CFO>0, dROA>0, CFO/TA>ROA (accrual), dLeverage<0, dCurrent ratio>0, no increase in shares outstanding, dGross margin>0, dAsset turnover>0. ROA and CFO scaled by beginning-of-year total assets; leverage = non-current long-term debt / average total assets; turnover = revenue / beginning total assets",
    "beneish_m": "Beneish (1999) M = -4.84 + 0.920 DSRI + 0.528 GMI + 0.404 AQI + 0.892 SGI + 0.115 DEPI - 0.172 SGAI + 4.679 TATA - 0.327 LVGI; M > -1.78 flags likely earnings manipulation",
    "interest_coverage": "EBIT / interest_expense",
    "ebitda_interest_coverage": "EBITDA / interest_expense",
    "current_ratio": "current_assets / current_liabilities",
    "quick_ratio": "(cash + short_term_investments + receivables) / current_liabilities",
    "cash_ratio": "(cash + short_term_investments) / current_liabilities",
    "net_debt": "total_debt - cash - short_term_investments",
    "debt_to_ebitda": "total_debt / EBITDA",
    "net_debt_to_ebitda": "net_debt / EBITDA",
    "debt_to_equity": "total_debt / total_equity",
    # FCF
    "free_cash_flow": "operating_cash_flow - capex",
    "fcf_margin_pct": "free_cash_flow / revenue",
    "fcf_conversion": "free_cash_flow / net_income",
    "fcf_after_sbc": "free_cash_flow - sbc (treats stock compensation as a cash-equivalent cost)",
    "fcf_after_finance_leases": "free_cash_flow - finance_lease_principal payments",
    "shareholder_payouts": "dividends_paid + buybacks",
    "payout_to_fcf_pct": "shareholder_payouts / free_cash_flow",
    "operating_leverage": "Degree of operating leverage = operating income growth / revenue growth",
}


# Optional balances that a company reporting them in neighbouring years is very
# unlikely to have at exactly zero: a gap means an unmapped tag, so the value is
# reported unavailable instead of being treated as 0.  Other optional items
# (acquisitions, buybacks, dividends, commercial paper, noncontrolling
# interests) are legitimately absent in some years and are treated as 0 with a note.
STRICT_OPTIONAL = {"short_term_investments", "total_debt"}


class Missing(Exception):
    def __init__(self, *items: str):
        super().__init__(", ".join(items))
        self.items = items


class NotApplicable(Exception):
    pass


def _r(v: Optional[float], n: int) -> Optional[float]:
    if v is None or not math.isfinite(v):
        return None
    return round(v, n)


def pct(v: Optional[float]) -> Optional[float]:
    return _r(v * 100 if v is not None else None, 2)


def ratio(v: Optional[float]) -> Optional[float]:
    return _r(v, 3)


def days(v: Optional[float]) -> Optional[float]:
    return _r(v, 1)


def money(v: Optional[float]) -> Optional[float]:
    return _r(v, 0)


@dataclass
class Ctx:
    st: Statements
    periods: List[FPeriod]                      # oldest -> newest (annual)
    unavailable: List[str] = field(default_factory=list)
    assumptions: List[str] = field(default_factory=list)
    statutory_tax_rate_pct: float = DEFAULT_STATUTORY_TAX_RATE_PCT
    include_operating_leases: bool = False
    zeroed: Dict[str, List[str]] = field(default_factory=dict)   # optional item -> periods treated as 0
    grouped: Dict[str, List[str]] = field(default_factory=dict)  # note -> periods it applies to

    def note(self, msg: str, label: str) -> None:
        lbls = self.grouped.setdefault(msg, [])
        if label not in lbls:
            lbls.append(label)

    def assumption_notes(self) -> List[str]:
        out = [f"{item} not tagged for {', '.join(sorted(set(lbls)))}; treated as 0"
               for item, lbls in self.zeroed.items()]
        out += [f"{msg} ({', '.join(sorted(lbls))})" for msg, lbls in self.grouped.items()]
        return out + self.assumptions

    def g(self, i: int, item: str) -> float:
        if i < 0 or i >= len(self.periods):
            raise Missing(f"{item} (prior period not available)")
        v = self.st.v(self.periods[i].key, item)
        if v is None:
            raise Missing(f"{item} {self.periods[i].label}")
        return v

    def opt(self, i: int, item: str) -> float:
        """Components that companies often do not report when they are nil."""
        if i < 0 or i >= len(self.periods):
            raise Missing(f"{item} (prior period not available)")
        v = self.st.v(self.periods[i].key, item)
        if v is None:
            # Reported in a neighbouring year but not this one: probably moved to a
            # tag we do not map, so zero would be wrong -> unavailable, not 0.
            if item in STRICT_OPTIONAL:
                fy = self.periods[i].fiscal_year
                others = [p.label for p in self.st.annual
                          if p.key != self.periods[i].key and abs(p.fiscal_year - fy) <= 2
                          and self.st.v(p.key, item) is not None]
                if others:
                    raise Missing(f"{item} {self.periods[i].label} (tagged for {', '.join(others)} but not this year)")
            lbls = self.zeroed.setdefault(item, [])
            if self.periods[i].label not in lbls:
                lbls.append(self.periods[i].label)
            return 0.0
        return v

    def avg(self, i: int, item: str) -> float:
        return (self.g(i, item) + self.g(i - 1, item)) / 2

    def label(self, i: int) -> str:
        return self.periods[i].label

    def calc(self, name: str, i: int, fn: Callable[[], Optional[float]]) -> Optional[float]:
        try:
            return fn()
        except Missing as m:
            self.unavailable.append(f"{name} {self.label(i) if 0 <= i < len(self.periods) else ''}: missing {m}".strip())
        except ZeroDivisionError:
            self.unavailable.append(f"{name} {self.label(i)}: denominator is zero")
        except NotApplicable as e:
            self.unavailable.append(f"{name} {self.label(i)}: {e}")
        return None


def _div(a: float, b: float) -> float:
    if b == 0:
        raise ZeroDivisionError
    return a / b


def _positive(v: float, name: str) -> float:
    """Denominators for which a ratio is only meaningful when positive."""
    if v <= 0:
        raise NotApplicable(f"{name} <= 0, ratio not meaningful")
    return v


def _growth(a: float, b: float) -> float:
    """a / b - 1; undefined when the base is zero or negative."""
    if b <= 0:
        raise NotApplicable("growth from a zero or negative base is not meaningful")
    return a / b - 1


# ── building blocks ─────────────────────────────────────────────────────────
def noa(c: Ctx, i: int) -> float:
    debt = c.g(i, "total_debt") if c.st.v(c.periods[i].key, "total_debt") is not None else c.opt(i, "total_debt")
    return (c.g(i, "total_assets") - c.g(i, "cash") - c.opt(i, "short_term_investments")) - \
        (c.g(i, "total_liabilities") - debt)


def current_debt(c: Ctx, i: int) -> float:
    key = c.periods[i].key
    if c.st.v(key, "debt_current_total") is not None:
        return c.st.v(key, "debt_current_total")
    return c.opt(i, "ltd_current") + c.opt(i, "commercial_paper") + c.opt(i, "short_term_borrowings")


def nwc(c: Ctx, i: int) -> float:
    return (c.g(i, "current_assets") - c.g(i, "cash") - c.opt(i, "short_term_investments")) - \
        (c.g(i, "current_liabilities") - current_debt(c, i))


def tax_rate(c: Ctx, i: int) -> float:
    """Effective rate when meaningful, otherwise the statutory assumption (recorded)."""
    try:
        pre, tax = c.g(i, "pretax_income"), c.g(i, "income_tax")
        if pre > 0:
            r = tax / pre
            if TAX_RATE_BOUNDS[0] <= r <= TAX_RATE_BOUNDS[1]:
                return r
            why = f"effective rate {r * 100:.1f}% outside 0-50%"
        else:
            why = "pretax income <= 0"
    except Missing as m:
        why = f"missing {m}"
    note = f"{c.label(i)}: statutory tax rate {c.statutory_tax_rate_pct}% used for NOPAT ({why})"
    if note not in c.assumptions:
        c.assumptions.append(note)
    return c.statutory_tax_rate_pct / 100


def nopat(c: Ctx, i: int) -> float:
    return c.g(i, "operating_income") * (1 - tax_rate(c, i))


def invested_capital(c: Ctx, i: int) -> float:
    debt = c.st.v(c.periods[i].key, "total_debt")
    if debt is None:
        debt = c.opt(i, "total_debt")
    ic = debt + c.g(i, "total_equity") + c.opt(i, "minority_interest") - c.g(i, "cash") - \
        c.opt(i, "short_term_investments")
    if c.include_operating_leases:
        ic += c.opt(i, "operating_lease_liabilities")
    return ic


def _avg_ic(c: Ctx, i: int) -> float:
    a, b = invested_capital(c, i), invested_capital(c, i - 1)
    avg = (a + b) / 2
    if avg <= 0:
        raise NotApplicable("average invested capital <= 0 (net cash exceeds debt + equity); ROIC not meaningful")
    return avg


def _year_table(c: Ctx, idx: Sequence[int], spec: Dict[str, Callable[[int], Optional[float]]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for i in idx:
        row = {name: c.calc(name, i, lambda f=f, i=i: f(i)) for name, f in spec.items()}
        out[c.label(i)] = row
    return out


# ── earnings quality ────────────────────────────────────────────────────────
def accruals_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    def bs(i):
        a, b = noa(c, i), noa(c, i - 1)
        return pct(_div(a - b, (a + b) / 2))

    def cf(i):
        a, b = noa(c, i), noa(c, i - 1)
        return pct(_div(c.g(i, "net_income") - (c.g(i, "operating_cash_flow") + c.g(i, "investing_cash_flow")),
                        (a + b) / 2))

    return _year_table(c, idx, {
        "noa": lambda i: money(noa(c, i)),
        "bs_accrual_ratio_pct": bs,
        "cf_accrual_ratio_pct": cf,
        "sloan_accrual_pct": lambda i: pct(_div(c.g(i, "net_income") - c.g(i, "operating_cash_flow"),
                                                c.avg(i, "total_assets"))),
    })


def income_vs_cash_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    def gap(i):
        return _r((_growth(c.g(i, "net_income"), c.g(i - 1, "net_income"))
                   - _growth(c.g(i, "operating_cash_flow"), c.g(i - 1, "operating_cash_flow"))) * 100, 2)

    return _year_table(c, idx, {
        "net_income": lambda i: money(c.g(i, "net_income")),
        "operating_cash_flow": lambda i: money(c.g(i, "operating_cash_flow")),
        "ocf_to_net_income": lambda i: ratio(c.g(i, "operating_cash_flow") / _positive(c.g(i, "net_income"), "net income")),
        "net_income_growth_pct": lambda i: pct(_growth(c.g(i, "net_income"), c.g(i - 1, "net_income"))),
        "ocf_growth_pct": lambda i: pct(_growth(c.g(i, "operating_cash_flow"), c.g(i - 1, "operating_cash_flow"))),
        "growth_gap_pp": gap,
    })


def cumulative_cash_conversion(c: Ctx, idx: Sequence[int]) -> Optional[Dict[str, Any]]:
    try:
        ni = sum(c.g(i, "net_income") for i in idx)
        ocf = sum(c.g(i, "operating_cash_flow") for i in idx)
    except Missing as m:
        c.unavailable.append(f"cumulative cash conversion: missing {m}")
        return None
    return {"periods": f"{c.label(idx[0])}-{c.label(idx[-1])}", "net_income_sum": money(ni),
            "operating_cash_flow_sum": money(ocf), "ocf_to_net_income": ratio(ocf / ni) if ni else None}


def working_capital_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    def dso(i):
        return days(_div(c.avg(i, "receivables"), c.g(i, "revenue")) * DAYS_IN_YEAR)

    def dio(i):
        return days(_div(c.avg(i, "inventory"), c.g(i, "cost_of_revenue")) * DAYS_IN_YEAR)

    def dpo(i):
        return days(_div(c.avg(i, "accounts_payable"), c.g(i, "cost_of_revenue")) * DAYS_IN_YEAR)

    def ccc(i):
        s = (_div(c.avg(i, "receivables"), c.g(i, "revenue")) + _div(c.avg(i, "inventory"), c.g(i, "cost_of_revenue"))
             - _div(c.avg(i, "accounts_payable"), c.g(i, "cost_of_revenue"))) * DAYS_IN_YEAR
        return days(s)

    return _year_table(c, idx, {
        "dso_days": dso, "dio_days": dio, "dpo_days": dpo, "ccc_days": ccc,
        "revenue_growth_pct": lambda i: pct(_growth(c.g(i, "revenue"), c.g(i - 1, "revenue"))),
        "receivables_growth_pct": lambda i: pct(_growth(c.g(i, "receivables"), c.g(i - 1, "receivables"))),
        "inventory_growth_pct": lambda i: pct(_growth(c.g(i, "inventory"), c.g(i - 1, "inventory"))),
        "non_cash_working_capital": lambda i: money(nwc(c, i)),
    })


# ── Beneish M ───────────────────────────────────────────────────────────────
def beneish(c: Ctx, i: int) -> Optional[Dict[str, Any]]:
    """Beneish (1999) 8-variable M-score for year i vs i-1, every variable shown."""
    def dep(j):
        v = c.st.v(c.periods[j].key, "depreciation")
        if v is not None:
            return v
        c.note("Beneish DEPI uses depreciation_amortization (no separate depreciation tag)", c.label(j))
        return c.g(j, "depreciation_amortization")

    def aq(j):
        return 1 - (c.g(j, "current_assets") + c.g(j, "ppe_net")) / c.g(j, "total_assets")

    def gm(j):
        return (c.g(j, "revenue") - c.g(j, "cost_of_revenue")) / c.g(j, "revenue")

    def lev(j):
        ltd = c.st.v(c.periods[j].key, "ltd_noncurrent")
        if ltd is None:
            ltd = c.opt(j, "ltd_noncurrent")
        return (c.g(j, "current_liabilities") + ltd) / c.g(j, "total_assets")

    def compute():
        t, p = i, i - 1
        v = {
            "DSRI": (c.g(t, "receivables") / c.g(t, "revenue")) / (c.g(p, "receivables") / c.g(p, "revenue")),
            "GMI": gm(p) / gm(t),
            "AQI": aq(t) / aq(p),
            "SGI": c.g(t, "revenue") / c.g(p, "revenue"),
            "DEPI": (dep(p) / (dep(p) + c.g(p, "ppe_net"))) / (dep(t) / (dep(t) + c.g(t, "ppe_net"))),
            "SGAI": (c.g(t, "sga_expense") / c.g(t, "revenue")) / (c.g(p, "sga_expense") / c.g(p, "revenue")),
            "LVGI": lev(t) / lev(p),
        }
        inc = c.st.v(c.periods[t].key, "income_continuing_ops")
        if inc is None:
            inc = c.g(t, "net_income")
            c.note("Beneish TATA uses net_income (no continuing-operations income tag)", c.label(t))
        v["TATA"] = (inc - c.g(t, "operating_cash_flow")) / c.g(t, "total_assets")
        m = BENEISH["intercept"] + sum(BENEISH[k] * x for k, x in v.items())
        return {"variables": {k: _r(x, 4) for k, x in v.items()}, "m_score": _r(m, 3),
                "threshold": BENEISH_THRESHOLD, "flag_likely_manipulator": m > BENEISH_THRESHOLD}

    try:
        return compute()
    except Missing as e:
        c.unavailable.append(f"beneish_m {c.label(i)}: missing {e}")
    except ZeroDivisionError:
        c.unavailable.append(f"beneish_m {c.label(i)}: a denominator is zero")
    return None


# ── capital efficiency ─────────────────────────────────────────────────────
def margins_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    return _year_table(c, idx, {
        "revenue": lambda i: money(c.g(i, "revenue")),
        "revenue_growth_pct": lambda i: pct(_growth(c.g(i, "revenue"), c.g(i - 1, "revenue"))),
        "gross_margin_pct": lambda i: pct(_div(c.g(i, "gross_profit"), c.g(i, "revenue"))),
        "operating_margin_pct": lambda i: pct(_div(c.g(i, "operating_income"), c.g(i, "revenue"))),
        "net_margin_pct": lambda i: pct(_div(c.g(i, "net_income"), c.g(i, "revenue"))),
        "sbc_pct_revenue": lambda i: pct(_div(c.g(i, "sbc"), c.g(i, "revenue"))),
        "da_pct_revenue": lambda i: pct(_div(c.g(i, "depreciation_amortization"), c.g(i, "revenue"))),
        "capex_pct_revenue": lambda i: pct(_div(c.g(i, "capex"), c.g(i, "revenue"))),
        "capex_to_da": lambda i: ratio(_div(c.g(i, "capex"), c.g(i, "depreciation_amortization"))),
    })


def roic_table(c: Ctx, idx: Sequence[int], wacc_pct: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
    def roic(i):
        return pct(nopat(c, i) / _avg_ic(c, i))

    def roic_end(i):
        ic = invested_capital(c, i)
        if ic <= 0:
            raise NotApplicable("invested capital <= 0")
        return pct(nopat(c, i) / ic)

    def incr(i):
        d_ic = invested_capital(c, i) - invested_capital(c, i - 1)
        return pct(_div(nopat(c, i) - nopat(c, i - 1), d_ic))

    def reinvest(i):
        return money(c.g(i, "capex") - c.g(i, "depreciation_amortization") + (nwc(c, i) - nwc(c, i - 1))
                     + c.opt(i, "acquisitions"))

    def reinvest_rate(i):
        r = c.g(i, "capex") - c.g(i, "depreciation_amortization") + (nwc(c, i) - nwc(c, i - 1)) + c.opt(i, "acquisitions")
        return pct(_div(r, nopat(c, i)))

    spec: Dict[str, Callable[[int], Optional[float]]] = {
        "effective_tax_rate_pct": lambda i: pct(_div(c.g(i, "income_tax"), c.g(i, "pretax_income"))),
        "tax_rate_used_pct": lambda i: pct(tax_rate(c, i)),
        "nopat": lambda i: money(nopat(c, i)),
        "invested_capital": lambda i: money(invested_capital(c, i)),
        "roic_pct": roic,
        "roic_ending_pct": roic_end,
        "incremental_roic_pct": incr,
        "reinvestment": reinvest,
        "reinvestment_rate_pct": reinvest_rate,
        "sales_to_capital": lambda i: ratio(c.g(i, "revenue") / _avg_ic(c, i)),
    }
    if wacc_pct is not None:
        spec["roic_minus_wacc_pp"] = lambda i: _r(nopat(c, i) / _avg_ic(c, i) * 100 - wacc_pct, 2)
        spec["economic_profit"] = lambda i: money((nopat(c, i) / _avg_ic(c, i) - wacc_pct / 100) * _avg_ic(c, i))
    return _year_table(c, idx, spec)


# ── DuPont ──────────────────────────────────────────────────────────────────
def dupont_components(c: Ctx, i: int) -> Dict[str, float]:
    ni, rev, pre, ebit = c.g(i, "net_income"), c.g(i, "revenue"), c.g(i, "pretax_income"), c.g(i, "operating_income")
    ta, te = c.avg(i, "total_assets"), c.avg(i, "total_equity")
    return {
        "net_margin": _div(ni, rev), "asset_turnover": _div(rev, ta), "equity_multiplier": _div(ta, te),
        "tax_burden": _div(ni, pre), "interest_burden": _div(pre, ebit), "ebit_margin": _div(ebit, rev),
        "roe": _div(ni, te), "avg_equity": te, "avg_assets": ta,
    }


def dupont_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for i in idx:
        try:
            d = dupont_components(c, i)
        except Missing as m:
            c.unavailable.append(f"dupont {c.label(i)}: missing {m}")
            continue
        except ZeroDivisionError:
            c.unavailable.append(f"dupont {c.label(i)}: a denominator is zero")
            continue
        row = {
            "roe_pct": pct(d["roe"]),
            "three_step": {"net_margin_pct": pct(d["net_margin"]), "asset_turnover": ratio(d["asset_turnover"]),
                           "equity_multiplier": ratio(d["equity_multiplier"])},
            "five_step": {"tax_burden": ratio(d["tax_burden"]), "interest_burden": ratio(d["interest_burden"]),
                          "ebit_margin_pct": pct(d["ebit_margin"]), "asset_turnover": ratio(d["asset_turnover"]),
                          "equity_multiplier": ratio(d["equity_multiplier"])},
            "avg_total_equity": money(d["avg_equity"]),
        }
        flags = []
        if d["avg_equity"] <= 0:
            flags.append("average equity <= 0: ROE and the equity multiplier are not meaningful")
        elif d["equity_multiplier"] > 5:
            flags.append(f"equity multiplier {d['equity_multiplier']:.2f}x (> 5x): ROE is inflated by a thin "
                         "equity base (leverage and/or cumulative buybacks), not only by operations")
        if d["interest_burden"] > 1.05:
            flags.append("pretax income exceeds EBIT (net non-operating income, e.g. interest on cash or "
                         "investment gains, adds to ROE)")
        if flags:
            row["flags"] = flags
        out[c.label(i)] = row
    return out


def roe_change_attribution(c: Ctx, first: int, last: int) -> Optional[Dict[str, Any]]:
    try:
        a, b = dupont_components(c, first), dupont_components(c, last)
    except (Missing, ZeroDivisionError) as e:
        c.unavailable.append(f"roe_change_attribution: {e or 'denominator is zero'}")
        return None
    keys = ("tax_burden", "interest_burden", "ebit_margin", "asset_turnover", "equity_multiplier")
    if any(a[k] <= 0 or b[k] <= 0 for k in keys + ("roe",)):
        c.unavailable.append("roe_change_attribution: a DuPont component is <= 0 (log attribution undefined)")
        return None
    total = math.log(b["roe"] / a["roe"])
    logs = {k: math.log(b[k] / a[k]) for k in keys}
    out = {"from": c.label(first), "to": c.label(last), "roe_from_pct": pct(a["roe"]), "roe_to_pct": pct(b["roe"]),
           "log_change_total": _r(total, 4), "log_change_by_component": {k: _r(v, 4) for k, v in logs.items()}}
    if abs(total) > 1e-9:
        out["share_of_change_pct"] = {k: _r(v / total * 100, 1) for k, v in logs.items()}
    return out


# ── per-share decomposition (buybacks vs dilution) ──────────────────────────
def per_share_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    return _year_table(c, idx, {
        "shares_diluted": lambda i: money(c.g(i, "shares_diluted")),
        "net_share_change_pct": lambda i: pct(_growth(c.g(i, "shares_diluted"), c.g(i - 1, "shares_diluted"))),
        "eps_reported": lambda i: _r(c.g(i, "eps_diluted"), 2),
        "eps_computed": lambda i: _r(_div(c.g(i, "net_income"), c.g(i, "shares_diluted")), 4),
        "buybacks": lambda i: money(c.g(i, "buybacks")),
        "sbc": lambda i: money(c.g(i, "sbc")),
        "buybacks_to_sbc": lambda i: ratio(_div(c.g(i, "buybacks"), c.g(i, "sbc"))),
    })


def per_share_decomposition(c: Ctx, first: int, last: int) -> Optional[Dict[str, Any]]:
    """Exact log split of EPS (and FCF/share) growth into the aggregate change and
    the share-count change over [first, last]."""
    try:
        ni0, ni1 = c.g(first, "net_income"), c.g(last, "net_income")
        s0, s1 = c.g(first, "shares_diluted"), c.g(last, "shares_diluted")
    except Missing as m:
        c.unavailable.append(f"per_share_decomposition: missing {m}")
        return None
    if min(ni0, ni1, s0, s1) <= 0:
        c.unavailable.append("per_share_decomposition: net income or share count <= 0 (log split undefined)")
        return None
    years = c.periods[last].fiscal_year - c.periods[first].fiscal_year
    e0, e1 = ni0 / s0, ni1 / s1
    l_eps, l_ni, l_sh = math.log(e1 / e0), math.log(ni1 / ni0), math.log(s1 / s0)
    out: Dict[str, Any] = {
        "from": c.label(first), "to": c.label(last), "years": years,
        "eps_from": _r(e0, 4), "eps_to": _r(e1, 4),
        "eps_growth_pct": pct(e1 / e0 - 1), "net_income_growth_pct": pct(ni1 / ni0 - 1),
        "share_count_change_pct": pct(s1 / s0 - 1),
        "log_eps": _r(l_eps, 4), "log_net_income": _r(l_ni, 4), "log_share_count": _r(l_sh, 4),
    }
    if years > 0:
        out["eps_cagr_pct"] = pct((e1 / e0) ** (1 / years) - 1)
        out["net_income_cagr_pct"] = pct((ni1 / ni0) ** (1 / years) - 1)
        out["share_count_cagr_pct"] = pct((s1 / s0) ** (1 / years) - 1)
    if abs(l_eps) > 1e-9:
        out["share_of_eps_growth_from_share_count_pct"] = _r(-l_sh / l_eps * 100, 1)
        out["share_of_eps_growth_from_net_income_pct"] = _r(l_ni / l_eps * 100, 1)
    try:
        f0 = c.g(first, "free_cash_flow") / s0
        f1 = c.g(last, "free_cash_flow") / s1
        if f0 > 0 and f1 > 0:
            out["fcf_per_share_from"] = _r(f0, 4)
            out["fcf_per_share_to"] = _r(f1, 4)
            out["fcf_per_share_growth_pct"] = pct(f1 / f0 - 1)
    except Missing:
        pass
    return out


# ── distress ───────────────────────────────────────────────────────────────
def altman(c: Ctx, i: int, market_value_equity: Optional[float], sic: Optional[str]) -> Dict[str, Any]:
    """Altman Z (needs market value of equity) and Z'' (book equity), with applicability."""
    sic_n = int(sic) if sic and str(sic).isdigit() else None
    financial = sic_n is not None and 6000 <= sic_n <= 6799
    manufacturer = sic_n is not None and 2000 <= sic_n <= 3999
    out: Dict[str, Any] = {"period": c.label(i), "sic": sic,
                           "applicability": (
                               "Not applicable: financial firms (SIC 6000-6799) have balance sheets the model was not estimated on" if financial else
                               "Z applies (public manufacturer, SIC 2000-3999); Z'' shown for comparison" if manufacturer else
                               "Z'' is the applicable model (non-manufacturer); original Z shown for reference only" if sic_n is not None else
                               "SIC code unknown: applicability could not be determined")}
    try:
        ta, tl = c.g(i, "total_assets"), c.g(i, "total_liabilities")
        x = {"X1": (c.g(i, "current_assets") - c.g(i, "current_liabilities")) / ta,
             "X2": c.g(i, "retained_earnings") / ta, "X3": c.g(i, "operating_income") / ta}
        x5 = c.g(i, "revenue") / ta
        x4_book = c.g(i, "total_equity") / tl
    except Missing as m:
        c.unavailable.append(f"altman {c.label(i)}: missing {m}")
        out["error"] = f"missing {m}"
        return out
    except ZeroDivisionError:
        out["error"] = "total assets or total liabilities is zero"
        return out
    z2 = sum(ALTMAN_Z2[k] * v for k, v in x.items()) + ALTMAN_Z2["X4"] * x4_book
    out["z_double_prime"] = {"inputs": {**{k: _r(v, 4) for k, v in x.items()}, "X4_book": _r(x4_book, 4)},
                             "score": _r(z2, 3), "zone": _zone(z2, ALTMAN_Z2_ZONES)}
    if market_value_equity is not None:
        x4 = market_value_equity / tl
        z = sum(ALTMAN_Z[k] * v for k, v in x.items()) + ALTMAN_Z["X4"] * x4 + ALTMAN_Z["X5"] * x5
        out["z"] = {"inputs": {**{k: _r(v, 4) for k, v in x.items()}, "X4_market": _r(x4, 4), "X5": _r(x5, 4)},
                    "score": _r(z, 3), "zone": _zone(z, ALTMAN_Z_ZONES),
                    "market_value_equity": money(market_value_equity)}
    else:
        out["z"] = None
        c.unavailable.append("altman_z: market value of equity not available (Z'' with book equity shown)")
    return out


def _zone(z: float, zones) -> str:
    return "distress" if z < zones[0] else ("grey" if z <= zones[1] else "safe")


def piotroski(c: Ctx, i: int) -> Dict[str, Any]:
    """All nine Piotroski (2000) signals for year i (needs i-1 and i-2 balances)."""
    signals: Dict[str, Any] = {}

    def sig(name: str, fn: Callable[[], Dict[str, Any]]):
        try:
            signals[name] = fn()
        except Missing as m:
            signals[name] = {"point": None, "unavailable": f"missing {m}"}
        except ZeroDivisionError:
            signals[name] = {"point": None, "unavailable": "denominator is zero"}

    def roa(j):
        return c.g(j, "net_income") / c.g(j - 1, "total_assets")

    def cfo(j):
        return c.g(j, "operating_cash_flow") / c.g(j - 1, "total_assets")

    def lev(j):
        ltd = c.st.v(c.periods[j].key, "ltd_noncurrent")
        if ltd is None:
            ltd = c.opt(j, "ltd_noncurrent")
        return ltd / c.avg(j, "total_assets")

    def cr(j):
        return c.g(j, "current_assets") / c.g(j, "current_liabilities")

    def gm(j):
        return c.g(j, "gross_profit") / c.g(j, "revenue")

    def at(j):
        return c.g(j, "revenue") / c.g(j - 1, "total_assets")

    def shares(j):
        v = c.st.v(c.periods[j].key, "shares_outstanding")
        if v is not None:
            return v, "shares_outstanding"
        return c.g(j, "shares_diluted"), "shares_diluted"

    sig("1_roa_positive", lambda: {"roa": _r(roa(i), 4), "point": int(roa(i) > 0)})
    sig("2_cfo_positive", lambda: {"cfo_to_assets": _r(cfo(i), 4), "point": int(c.g(i, "operating_cash_flow") > 0)})
    sig("3_roa_improving", lambda: {"roa": _r(roa(i), 4), "roa_prior": _r(roa(i - 1), 4), "point": int(roa(i) > roa(i - 1))})
    sig("4_accrual_cfo_exceeds_roa", lambda: {"cfo_to_assets": _r(cfo(i), 4), "roa": _r(roa(i), 4), "point": int(cfo(i) > roa(i))})
    sig("5_leverage_falling", lambda: {"leverage": _r(lev(i), 4), "leverage_prior": _r(lev(i - 1), 4), "point": int(lev(i) < lev(i - 1))})
    sig("6_current_ratio_rising", lambda: {"current_ratio": _r(cr(i), 3), "current_ratio_prior": _r(cr(i - 1), 3), "point": int(cr(i) > cr(i - 1))})

    def no_issue():
        (s1, k1), (s0, k0) = shares(i), shares(i - 1)
        if k1 != k0:
            raise Missing("consistent share count series")
        return {"shares": money(s1), "shares_prior": money(s0), "basis": k1, "point": int(s1 <= s0)}
    sig("7_no_new_shares", no_issue)
    sig("8_gross_margin_rising", lambda: {"gross_margin": _r(gm(i), 4), "gross_margin_prior": _r(gm(i - 1), 4), "point": int(gm(i) > gm(i - 1))})
    sig("9_asset_turnover_rising", lambda: {"asset_turnover": _r(at(i), 4), "asset_turnover_prior": _r(at(i - 1), 4), "point": int(at(i) > at(i - 1))})
    pts = [s.get("point") for s in signals.values()]
    known = [p for p in pts if p is not None]
    return {"period": c.label(i), "signals": signals, "score": sum(known), "computable_signals": len(known),
            "max_score": 9,
            "interpretation": ("8-9 strong, 0-2 weak (Piotroski 2000)" if len(known) == 9 else
                               f"only {len(known)} of 9 signals computable; score is a lower bound")}


def coverage_liquidity_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    def debt(i):
        v = c.st.v(c.periods[i].key, "total_debt")
        if v is None:
            raise Missing(f"total_debt {c.label(i)}")
        return v

    return _year_table(c, idx, {
        "interest_coverage": lambda i: ratio(_div(c.g(i, "operating_income"), c.g(i, "interest_expense"))),
        "ebitda_interest_coverage": lambda i: ratio(_div(c.g(i, "ebitda"), c.g(i, "interest_expense"))),
        "current_ratio": lambda i: ratio(_div(c.g(i, "current_assets"), c.g(i, "current_liabilities"))),
        "quick_ratio": lambda i: ratio(_div(c.g(i, "cash") + c.opt(i, "short_term_investments") + c.g(i, "receivables"),
                                            c.g(i, "current_liabilities"))),
        "cash_ratio": lambda i: ratio(_div(c.g(i, "cash") + c.opt(i, "short_term_investments"), c.g(i, "current_liabilities"))),
        "total_debt": lambda i: money(debt(i)),
        "net_debt": lambda i: money(debt(i) - c.g(i, "cash") - c.opt(i, "short_term_investments")),
        "debt_to_ebitda": lambda i: ratio(debt(i) / _positive(c.g(i, "ebitda"), "EBITDA")),
        "net_debt_to_ebitda": lambda i: ratio((debt(i) - c.g(i, "cash") - c.opt(i, "short_term_investments"))
                                              / _positive(c.g(i, "ebitda"), "EBITDA")),
        "debt_to_equity": lambda i: ratio(_div(debt(i), c.g(i, "total_equity"))),
    })


def debt_maturities(c: Ctx, i: int) -> Dict[str, Any]:
    key = c.periods[i].key
    buckets = {"next_12_months": "debt_due_y1", "year_2": "debt_due_y2", "year_3": "debt_due_y3",
               "year_4": "debt_due_y4", "year_5": "debt_due_y5", "after_year_5": "debt_due_after_y5"}
    sched, prov = {}, {}
    for name, item in buckets.items():
        x = c.st.x(key, item)
        sched[name] = money(x.value) if x else None
        if x:
            prov[name] = x.tag
    out: Dict[str, Any] = {"as_of": c.periods[i].end, "period": c.label(i), "schedule": sched, "tags": prov}
    known = [v for v in sched.values() if v is not None]
    if not known:
        out["unavailable"] = ("no LongTermDebtMaturitiesRepaymentsOfPrincipal* facts in XBRL for this fiscal year "
                              "(see the debt footnote in the 10-K)")
        return out
    out["total_scheduled"] = money(sum(known))
    near = [sched[k] for k in ("next_12_months", "year_2") if sched[k] is not None]
    if near:
        out["due_within_24_months"] = money(sum(near))
    liquid = c.st.v(key, "cash")
    if liquid is not None:
        liquid += c.opt(i, "short_term_investments")
        out["cash_and_short_term_investments"] = money(liquid)
        if sched["next_12_months"]:
            out["liquidity_to_next_12m_maturities"] = ratio(liquid / sched["next_12_months"])
    ocf = c.st.v(key, "operating_cash_flow")
    fcf = c.st.v(key, "free_cash_flow")
    if fcf is not None and near:
        out["fcf_to_24m_maturities"] = ratio(fcf / sum(near)) if sum(near) else None
    if ocf is not None:
        out["operating_cash_flow"] = money(ocf)
    ltd = c.st.v(key, "ltd_total")
    if ltd is None and c.st.v(key, "ltd_noncurrent") is not None:
        ltd = c.st.v(key, "ltd_noncurrent") + (c.st.v(key, "ltd_current") or 0)
    if ltd:
        out["schedule_vs_carrying_debt_note"] = (
            f"scheduled principal {sum(known):,.0f} vs carrying long-term debt {ltd:,.0f}; differences are "
            "unamortised discounts/premiums, fair-value hedge adjustments or buckets not tagged")
    return out


def fcf_table(c: Ctx, idx: Sequence[int]) -> Dict[str, Dict[str, Any]]:
    def payouts(i):
        return c.opt(i, "dividends_paid") + c.opt(i, "buybacks")

    return _year_table(c, idx, {
        "operating_cash_flow": lambda i: money(c.g(i, "operating_cash_flow")),
        "capex": lambda i: money(c.g(i, "capex")),
        "free_cash_flow": lambda i: money(c.g(i, "free_cash_flow")),
        "fcf_margin_pct": lambda i: pct(_div(c.g(i, "free_cash_flow"), c.g(i, "revenue"))),
        "fcf_conversion": lambda i: ratio(c.g(i, "free_cash_flow") / _positive(c.g(i, "net_income"), "net income")),
        "sbc": lambda i: money(c.g(i, "sbc")),
        "fcf_after_sbc": lambda i: money(c.g(i, "free_cash_flow") - c.g(i, "sbc")),
        "fcf_after_finance_leases": lambda i: money(c.g(i, "free_cash_flow") - c.g(i, "finance_lease_principal")),
        "shareholder_payouts": lambda i: money(payouts(i)),
        "payout_to_fcf_pct": lambda i: pct(payouts(i) / _positive(c.g(i, "free_cash_flow"), "free cash flow")),
        "capex_to_da": lambda i: ratio(_div(c.g(i, "capex"), c.g(i, "depreciation_amortization"))),
    })


def fcf_sustainability_summary(c: Ctx, idx: Sequence[int]) -> Dict[str, Any]:
    vals = [(c.label(i), c.st.v(c.periods[i].key, "free_cash_flow")) for i in idx]
    known = [(lbl, v) for lbl, v in vals if v is not None]
    out: Dict[str, Any] = {"years_with_data": len(known), "years_negative_fcf": sum(1 for _, v in known if v < 0)}
    if known:
        out["cumulative_fcf"] = money(sum(v for _, v in known))
        try:
            pay = sum(c.opt(i, "dividends_paid") + c.opt(i, "buybacks") for i in idx
                      if c.st.v(c.periods[i].key, "free_cash_flow") is not None)
            out["cumulative_shareholder_payouts"] = money(pay)
            tot = sum(v for _, v in known)
            out["cumulative_payout_to_fcf_pct"] = pct(pay / tot) if tot > 0 else None
        except Missing:
            pass
    return out


def operating_leverage(c: Ctx, i: int) -> Optional[float]:
    return c.calc("operating_leverage", i, lambda: ratio(_div(
        _growth(c.g(i, "operating_income"), c.g(i - 1, "operating_income")),
        _growth(c.g(i, "revenue"), c.g(i - 1, "revenue")))))


# ── earnings-quality flags ──────────────────────────────────────────────────
FLAG_RULES = {
    "low_cash_conversion": "operating_cash_flow / net_income < 0.8 in the latest year",
    "ni_growth_outpaces_ocf": "net income growth exceeds OCF growth by > 20 pp in the latest year",
    "high_accruals": "|balance-sheet accrual ratio| > 10% in the latest year",
    "receivables_outpace_revenue": "receivables growth exceeds revenue growth by > 10 pp",
    "inventory_outpaces_revenue": "inventory growth exceeds revenue growth by > 10 pp",
    "dso_rising": "DSO up > 15% year over year",
    "beneish_above_threshold": "Beneish M-score > -1.78",
    "cumulative_ocf_below_ni": "cumulative OCF < cumulative net income over the window",
}


def quality_flags(latest: str, cash: Dict[str, Dict[str, Any]], acc: Dict[str, Dict[str, Any]],
                  wc: Dict[str, Dict[str, Any]], ben: Optional[Dict[str, Any]],
                  cum: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    flags: List[Dict[str, Any]] = []

    def add(rule: str, triggered: Optional[bool], evidence: Dict[str, Any]):
        if triggered is None:
            return
        flags.append({"flag": rule, "rule": FLAG_RULES[rule], "triggered": bool(triggered), "evidence": evidence})

    ci, ai, wi = cash.get(latest, {}), acc.get(latest, {}), wc.get(latest, {})
    r = ci.get("ocf_to_net_income")
    add("low_cash_conversion", None if r is None else (r < 0.8), {"ocf_to_net_income": r, "period": latest})
    g = ci.get("growth_gap_pp")
    add("ni_growth_outpaces_ocf", None if g is None else g > 20, {"growth_gap_pp": g, "period": latest})
    b = ai.get("bs_accrual_ratio_pct")
    add("high_accruals", None if b is None else abs(b) > 10, {"bs_accrual_ratio_pct": b, "period": latest})
    rg, ar, ig = wi.get("revenue_growth_pct"), wi.get("receivables_growth_pct"), wi.get("inventory_growth_pct")
    add("receivables_outpace_revenue", None if rg is None or ar is None else ar - rg > 10,
        {"receivables_growth_pct": ar, "revenue_growth_pct": rg, "period": latest})
    add("inventory_outpaces_revenue", None if rg is None or ig is None else ig - rg > 10,
        {"inventory_growth_pct": ig, "revenue_growth_pct": rg, "period": latest})
    labels = list(wc)
    if len(labels) >= 2:
        d1, d0 = wc[labels[-1]].get("dso_days"), wc[labels[-2]].get("dso_days")
        add("dso_rising", None if d1 is None or not d0 else d1 / d0 - 1 > 0.15,
            {"dso_days": d1, "dso_days_prior": d0, "period": latest})
    if ben:
        add("beneish_above_threshold", ben["m_score"] > BENEISH_THRESHOLD,
            {"m_score": ben["m_score"], "threshold": BENEISH_THRESHOLD, "period": latest})
    if cum and cum.get("ocf_to_net_income") is not None:
        add("cumulative_ocf_below_ni", cum["ocf_to_net_income"] < 1,
            {"ocf_to_net_income": cum["ocf_to_net_income"], "periods": cum["periods"]})
    return flags
