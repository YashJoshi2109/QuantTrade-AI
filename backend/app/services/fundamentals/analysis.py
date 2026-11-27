"""Assemble the fundamentals-engine tool payloads.

Each payload is plain JSON: the computed tables, the line items they were
computed from (with filing provenance), the formula definitions, the
assumptions applied and an explicit ``unavailable`` list.  Nothing here calls
an LLM.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence

from app.services.fundamentals import metrics as M
from app.services.fundamentals.wacc import DEFAULT_ERP_PCT, compute_wacc
from app.services.fundamentals.xbrl import FPeriod, Statements, item_label, ttm

SOURCE = "SEC EDGAR XBRL companyfacts (data.sec.gov/api/xbrl/companyfacts)"
BASIS = ("Values are as most recently reported: when a later filing restated a period, the restated value is "
         "used and the original is listed in value_notes. Fiscal-year labels follow the company's fiscal calendar.")

STATEMENT_ITEMS = {
    "income": ["revenue", "cost_of_revenue", "gross_profit", "rd_expense", "sga_expense", "operating_income",
               "interest_expense", "pretax_income", "income_tax", "net_income", "eps_diluted", "shares_diluted"],
    "balance": ["cash", "short_term_investments", "receivables", "inventory", "current_assets", "ppe_net",
                "goodwill", "total_assets", "accounts_payable", "current_liabilities", "total_debt",
                "operating_lease_liabilities", "total_liabilities", "total_equity", "retained_earnings"],
    "cashflow": ["operating_cash_flow", "capex", "free_cash_flow", "depreciation_amortization", "sbc",
                 "buybacks", "dividends_paid", "acquisitions", "investing_cash_flow", "financing_cash_flow"],
}


@dataclass
class MarketInputs:
    """Market data from named non-XBRL sources (each with source + as_of)."""
    price: Optional[float] = None
    price_source: Optional[str] = None
    price_as_of: Optional[str] = None
    market_cap_usd: Optional[float] = None
    market_cap_source: Optional[str] = None
    market_cap_as_of: Optional[str] = None
    beta: Optional[float] = None
    beta_source: Optional[str] = None
    forward_pe: Optional[float] = None
    forward_pe_source: Optional[str] = None
    risk_free_pct: Optional[float] = None
    risk_free_source: Optional[str] = None
    risk_free_as_of: Optional[str] = None
    fx_usd_per_unit: Optional[float] = None      # reporting currency -> USD
    fx_source: Optional[str] = None
    fx_as_of: Optional[str] = None
    notes: List[str] = field(default_factory=list)

    def block(self) -> Dict[str, Any]:
        d = {k: v for k, v in self.__dict__.items() if v is not None and k != "notes"}
        if self.notes:
            d["notes"] = self.notes
        return d


def resolve_market_cap(st: Statements, m: MarketInputs, provider_market_cap: Optional[float],
                       provider_source: Optional[str], provider_as_of: Optional[str]) -> None:
    """Market cap = price x SEC cover-page shares outstanding when the filer reports
    in USD and a single share count; otherwise the provider's market cap."""
    cs = st.cover_shares
    if m.price and cs and st.currency == "USD":
        m.market_cap_usd = m.price * cs["value"]
        m.market_cap_source = (f"price ({m.price_source}) x {cs['value']:,.0f} shares outstanding "
                               f"({cs['tag']} as of {cs['as_of']}, {cs['form']} {cs['accn']})")
        m.market_cap_as_of = m.price_as_of
    elif provider_market_cap:
        m.market_cap_usd = provider_market_cap
        m.market_cap_source = provider_source
        m.market_cap_as_of = provider_as_of
        if st.currency != "USD":
            m.notes.append(f"{st.ticker} reports in {st.currency}; market cap taken from {provider_source} "
                           "(USD) because the ADR price cannot be multiplied by ordinary-share counts")
    else:
        m.notes.append("market capitalisation not available (no quote x share count and no provider value)")


def _fx(st: Statements, m: MarketInputs) -> Optional[float]:
    if st.currency == "USD":
        return 1.0
    return m.fx_usd_per_unit


# ── shared blocks ───────────────────────────────────────────────────────────
def header(st: Statements, periods: Sequence[FPeriod], analysis: str) -> Dict[str, Any]:
    return {
        "analysis": analysis, "ticker": st.ticker, "company": st.entity_name, "cik": st.cik,
        "reporting_currency": st.currency, "taxonomy": st.taxonomy, "source": SOURCE, "basis": BASIS,
        "periods": [dict(p.ref(), url=st.sec_filing_url(p.accn)) if p.accn else p.ref() for p in periods],
    }


def inputs_block(st: Statements, periods: Sequence[FPeriod], items: Iterable[str]) -> Dict[str, Any]:
    """Line items used (value per period) + tags + notes on restated/derived values."""
    table: Dict[str, Dict[str, Any]] = {}
    tags: Dict[str, List[str]] = {}
    notes: List[str] = []
    derived: Dict[tuple, List[str]] = {}
    for item in items:
        row = {}
        for p in periods:
            x = st.x(p.key, item)
            if x is None:
                continue
            row[p.label] = M.money(x.value) if abs(x.value) >= 1000 else x.value
            if x.tag != "derived" and x.tag not in tags.setdefault(item, []):
                tags[item].append(x.tag)
            if x.original_value is not None:
                notes.append(f"{item} {p.label}: restated to {x.value:,.0f} in {x.accn} ({x.form} filed {x.filed}); "
                             f"originally {x.original_value:,.0f} in {x.original_accn}")
            elif x.derived:
                derived.setdefault((item, re.sub(r"\s*\([^)]*\)", "", x.derived)), []).append(p.label)
            elif p.accn and x.accn and x.accn != p.accn and p.fiscal_quarter is None:
                notes.append(f"{item} {p.label}: from {x.accn} ({x.form} filed {x.filed})")
        if row:
            table[item] = row
    by_formula: Dict[tuple, List[str]] = {}
    for (item, f), lbls in derived.items():
        by_formula.setdefault((f, tuple(lbls)), []).append(item)
    notes += [f"{', '.join(items)} {', '.join(lbls)}: derived = {f}" for (f, lbls), items in by_formula.items()]
    out: Dict[str, Any] = {"line_items": table, "xbrl_tags": tags}
    if notes:
        out["value_notes"] = notes[:40]
    return out


def _defs(*keys: str) -> Dict[str, str]:
    return {k: M.DEFINITIONS[k] for k in keys if k in M.DEFINITIONS}


def _window(st: Statements, years: int, lookback: int, **ctx_kw) -> tuple[M.Ctx, List[int]]:
    periods = st.last_annual(years + lookback)
    c = M.Ctx(st=st, periods=periods, **ctx_kw)
    first = max(0, len(periods) - years)
    return c, list(range(first, len(periods)))


def _finish(out: Dict[str, Any], c: M.Ctx) -> Dict[str, Any]:
    notes = c.assumption_notes()
    if notes:
        out.setdefault("assumptions", []).extend(notes)
    if c.unavailable:
        out["unavailable"] = sorted(set(c.unavailable))
    if c.st.notes:
        out["data_notes"] = c.st.notes[:15]
    return out


def _no_annual(st: Statements) -> Optional[Dict[str, Any]]:
    if not st.annual:
        return {"ticker": st.ticker, "error": "no annual 10-K/20-F/40-F periods found in SEC XBRL companyfacts"}
    return None


# ── 1. normalised history ───────────────────────────────────────────────────
def history_payload(st: Statements, period: str = "annual", years: int = 5,
                    statement: str = "all") -> Dict[str, Any]:
    if period == "quarterly":
        periods = st.last_quarters(min(12, max(1, years) * 4))
    else:
        periods = st.last_annual(years)
    if not periods:
        return {"ticker": st.ticker, "error": f"no {period} periods in SEC XBRL companyfacts"}
    groups = STATEMENT_ITEMS if statement == "all" else {statement: STATEMENT_ITEMS[statement]}
    out = header(st, periods, f"normalised {period} financial statements")
    out["statements"] = {}
    for name, items in groups.items():
        blk = inputs_block(st, periods, items)
        out["statements"][name] = blk["line_items"]
        out.setdefault("xbrl_tags", {}).update(blk["xbrl_tags"])
        out.setdefault("value_notes", []).extend(blk.get("value_notes", []))
    out["labels"] = {k: item_label(k) for g in groups.values() for k in g}
    out["units"] = f"{st.currency} (per-share items {st.currency}/share; share counts in shares)"
    if not out["value_notes"]:
        out.pop("value_notes")
    if period == "quarterly":
        out["quarter_note"] = ("3-month values; where a filing reports only year-to-date amounts the quarter is "
                               "derived (see value_notes). Fiscal Q4 comes from the 10-K (FY minus 9M YTD).")
    if st.notes:
        out["data_notes"] = st.notes[:15]
    return out


# ── 2. earnings quality / forensic ──────────────────────────────────────────
def earnings_quality_payload(st: Statements, years: int = 5) -> Dict[str, Any]:
    if (e := _no_annual(st)):
        return e
    c, idx = _window(st, years, 1)
    out = header(st, [c.periods[i] for i in idx], "forensic earnings quality")
    acc = M.accruals_table(c, idx)
    cash = M.income_vs_cash_table(c, idx)
    wc = M.working_capital_table(c, idx)
    ben = {c.label(i): M.beneish(c, i) for i in idx}
    cum = M.cumulative_cash_conversion(c, idx)
    latest = c.label(idx[-1])
    out.update({
        "net_income_vs_operating_cash_flow": cash,
        "cumulative_cash_conversion": cum,
        "accruals": acc,
        "working_capital": wc,
        "beneish_m": {k: v for k, v in ben.items() if v is not None},
        "stock_based_compensation_pct_revenue": {c.label(i): c.calc("sbc_pct_revenue", i, lambda i=i: M.pct(
            M._div(c.g(i, "sbc"), c.g(i, "revenue")))) for i in idx},
        "flags": M.quality_flags(latest, cash, acc, wc, ben.get(latest), cum),
        "definitions": _defs("noa", "bs_accrual_ratio_pct", "cf_accrual_ratio_pct", "sloan_accrual_pct",
                             "ocf_to_net_income", "growth_gap_pp", "dso_days", "dio_days", "dpo_days", "ccc_days",
                             "non_cash_working_capital", "beneish_m", "sbc_pct_revenue"),
        "limitations": [
            "Accrual ratios use XBRL balance-sheet totals; acquisitions and FX translation move balances without "
            "operating accruals.",
            "Investing cash flow includes marketable-securities purchases, which can dominate the cash-flow accrual ratio.",
            "Beneish M was estimated on 1982-1992 manipulators; it flags, it does not prove, manipulation.",
            "Flags are mechanical thresholds (see each rule); interpretation requires the filings' MD&A.",
        ],
    })
    out.update(inputs_block(st, c.periods[max(0, idx[0] - 1):], ["revenue", "cost_of_revenue", "net_income", "operating_cash_flow",
                                            "investing_cash_flow", "total_assets", "total_liabilities", "cash",
                                            "short_term_investments", "total_debt", "receivables", "inventory",
                                            "accounts_payable", "sga_expense", "ppe_net", "current_assets",
                                            "current_liabilities", "depreciation_amortization", "sbc"]))
    return _finish(out, c)


# ── 3. capital efficiency (ROIC vs WACC, DuPont, per-share) ─────────────────
def _cost_of_debt(c: M.Ctx, i: int) -> Optional[tuple]:
    """interest_expense / average total_debt for the latest year that tags both
    (looking back at most 3 fiscal years; the year used is reported)."""
    for j in range(i, max(0, i - 3), -1):
        try:
            return c.g(j, "interest_expense") / c.avg(j, "total_debt") * 100, c.label(j)
        except (M.Missing, ZeroDivisionError):
            continue
    return None


def wacc_block(st: Statements, c: M.Ctx, m: MarketInputs, *, wacc_pct: Optional[float],
               erp_pct: float, external: Optional[Dict[str, Any]],
               cost_of_debt_pct: Optional[float] = None) -> Dict[str, Any]:
    if wacc_pct is not None:
        return {"wacc_pct": wacc_pct, "source": "caller-supplied assumption"}
    if external and external.get("wacc_pct") is not None:
        return {**external, "source": external.get("source") or "valuation engine"}
    i = len(c.periods) - 1
    missing = []
    if m.risk_free_pct is None:
        missing.append("risk-free rate (FRED DGS10)")
    if m.beta is None:
        missing.append("beta")
    if m.market_cap_usd is None:
        missing.append("market capitalisation")
    fx = _fx(st, m)
    if fx is None:
        missing.append(f"{st.currency}->USD FX rate")
    debt = st.v(c.periods[i].key, "total_debt") if c.periods else None
    if missing:
        return {"wacc_pct": None, "unavailable": "WACC not computed: missing " + ", ".join(missing),
                "hint": "pass wacc_pct to compare ROIC with a WACC of your choice"}
    kd, kd_src = None, None
    if debt:
        if cost_of_debt_pct is not None:
            kd, kd_src = cost_of_debt_pct, "caller-supplied assumption"
        else:
            found = _cost_of_debt(c, i)
            if found is None:
                return {"wacc_pct": None, "unavailable": "WACC not computed: interest expense not tagged in the last "
                                                          "3 fiscal years, so the pre-tax cost of debt is unknown",
                        "hint": "pass cost_of_debt_pct or wacc_pct"}
            kd, yr = found
            kd_src = f"interest_expense / average total_debt, {yr} (XBRL)"
            if yr != c.label(i):
                kd_src += f"; {c.label(i)} does not tag interest expense"
    t = M.tax_rate(c, i) * 100
    res = compute_wacc(risk_free_pct=m.risk_free_pct, beta=m.beta, equity_risk_premium_pct=erp_pct,
                       pre_tax_cost_of_debt_pct=kd, tax_rate_pct=t, market_value_equity=m.market_cap_usd,
                       total_debt=(debt or 0.0) * fx)
    res["inputs"] = {
        "risk_free_pct": {"value": m.risk_free_pct, "source": m.risk_free_source, "as_of": m.risk_free_as_of},
        "beta": {"value": m.beta, "source": m.beta_source},
        "equity_risk_premium_pct": {"value": erp_pct, "source": "ASSUMPTION (default 5.0%, overridable)"},
        "pre_tax_cost_of_debt_pct": {"value": M._r(kd, 2), "source": kd_src} if kd is not None else None,
        "tax_rate_pct": {"value": M._r(t, 2), "source": f"{c.label(i)} effective rate or statutory assumption"},
        "market_value_equity_usd": {"value": M.money(m.market_cap_usd), "source": m.market_cap_source},
        "total_debt_usd": {"value": M.money((debt or 0.0) * fx), "source": f"book total_debt {c.label(i)} (XBRL)"},
    }
    res["source"] = "fundamentals engine CAPM WACC"
    res["limitations"] = ("current WACC applied to every year (historical betas, rates and market weights not "
                          "reconstructed); book debt proxies market value of debt")
    return res


def capital_efficiency_payload(st: Statements, years: int, m: MarketInputs, *, wacc_pct: Optional[float] = None,
                               erp_pct: float = DEFAULT_ERP_PCT, include_operating_leases: bool = False,
                               statutory_tax_rate_pct: float = M.DEFAULT_STATUTORY_TAX_RATE_PCT,
                               external_wacc: Optional[Dict[str, Any]] = None,
                               cost_of_debt_pct: Optional[float] = None) -> Dict[str, Any]:
    if (e := _no_annual(st)):
        return e
    c, idx = _window(st, years, 2, include_operating_leases=include_operating_leases,
                     statutory_tax_rate_pct=statutory_tax_rate_pct)
    out = header(st, [c.periods[i] for i in idx], "capital efficiency: ROIC vs WACC, DuPont, per-share")
    wb = wacc_block(st, c, m, wacc_pct=wacc_pct, erp_pct=erp_pct, external=external_wacc,
                    cost_of_debt_pct=cost_of_debt_pct)
    w = wb.get("wacc_pct")
    roic = M.roic_table(c, idx, w)
    out.update({
        "wacc": wb,
        "roic": roic,
        "margins_and_intensity": M.margins_table(c, idx),
        "dupont": M.dupont_table(c, idx),
        "roe_change_attribution": M.roe_change_attribution(c, idx[0], idx[-1]) if len(idx) > 1 else None,
        "per_share": M.per_share_table(c, idx),
        "per_share_decomposition": M.per_share_decomposition(c, idx[0], idx[-1]) if len(idx) > 1 else None,
        "operating_leverage": {c.label(i): M.operating_leverage(c, i) for i in idx},
        "driver_guide": {
            "operational_efficiency": "asset_turnover, sales_to_capital, operating_margin_pct trend",
            "pricing_power": "gross_margin_pct level and stability",
            "financial_leverage": "equity_multiplier and interest_burden (DuPont); debt in invested_capital",
            "share_repurchases": "share_of_eps_growth_from_share_count_pct, buybacks_to_sbc",
        },
        "definitions": _defs("nopat", "invested_capital", "roic_pct", "roic_ending_pct", "incremental_roic_pct",
                             "reinvestment", "reinvestment_rate_pct", "sales_to_capital", "effective_tax_rate_pct",
                             "roic_minus_wacc_pp", "economic_profit", "dupont3", "dupont5",
                             "roe_change_attribution", "per_share_decomposition", "net_share_change_pct",
                             "eps_computed", "gross_margin_pct", "capex_pct_revenue", "capex_to_da",
                             "da_pct_revenue", "operating_leverage"),
        "assumptions": [f"statutory tax rate {statutory_tax_rate_pct}% used only where the effective rate is not meaningful",
                        f"operating leases {'included in' if include_operating_leases else 'excluded from'} invested capital",
                        "all cash and short-term investments treated as non-operating (excess) cash"],
    })
    if m.block():
        out["market_inputs"] = m.block()
    out.update(inputs_block(st, c.periods[max(0, idx[0] - 1):], ["revenue", "gross_profit", "operating_income", "pretax_income",
                                            "income_tax", "net_income", "total_assets", "total_equity",
                                            "total_debt", "cash", "short_term_investments", "minority_interest",
                                            "operating_lease_liabilities", "capex", "depreciation_amortization",
                                            "acquisitions", "shares_diluted", "buybacks", "sbc", "interest_expense"]))
    return _finish(out, c)


# ── 4. DuPont (multi-ticker) ────────────────────────────────────────────────
def dupont_payload(st: Statements, years: int = 5) -> Dict[str, Any]:
    if (e := _no_annual(st)):
        return e
    c, idx = _window(st, years, 1)
    out = header(st, [c.periods[i] for i in idx], "DuPont decomposition")
    out["dupont"] = M.dupont_table(c, idx)
    out["roe_change_attribution"] = M.roe_change_attribution(c, idx[0], idx[-1]) if len(idx) > 1 else None
    out["definitions"] = _defs("roe_pct", "dupont3", "dupont5", "roe_change_attribution")
    out.update(inputs_block(st, c.periods[max(0, idx[0] - 1):], ["revenue", "operating_income", "pretax_income", "net_income",
                                            "total_assets", "total_equity", "buybacks"]))
    return _finish(out, c)


# ── 5. distress ─────────────────────────────────────────────────────────────
def distress_payload(st: Statements, years: int, m: MarketInputs, sic: Optional[str],
                     sic_description: Optional[str] = None) -> Dict[str, Any]:
    if (e := _no_annual(st)):
        return e
    c, idx = _window(st, years, 2)
    i = idx[-1]
    out = header(st, [c.periods[j] for j in idx], "financial distress assessment")
    fx = _fx(st, m)
    mve_local = None
    if m.market_cap_usd is not None and fx:
        mve_local = m.market_cap_usd / fx
    alt = M.altman(c, i, mve_local, sic)
    if alt.get("z") and m.market_cap_source:
        alt["z"]["market_value_equity_source"] = m.market_cap_source + (
            f"; converted to {st.currency} at {fx} USD per unit ({m.fx_source} {m.fx_as_of})" if st.currency != "USD" else "")
        alt["z"]["date_mismatch_note"] = (f"market value is as of {m.market_cap_as_of}; balance sheet as of "
                                          f"{c.periods[i].end}")
    z2_hist = {}
    for j in idx:
        a = M.altman(M.Ctx(st=st, periods=c.periods, unavailable=[], assumptions=c.assumptions), j, None, sic)
        if a.get("z_double_prime"):
            z2_hist[c.label(j)] = {"score": a["z_double_prime"]["score"], "zone": a["z_double_prime"]["zone"]}
    out.update({
        "sic": {"code": sic, "description": sic_description},
        "altman": alt,
        "altman_z_double_prime_history": z2_hist,
        "piotroski_f": M.piotroski(c, i),
        "piotroski_f_prior_year": M.piotroski(c, i - 1) if i >= 1 else None,
        "beneish_m": M.beneish(c, i),
        "coverage_and_liquidity": M.coverage_liquidity_table(c, idx),
        "debt_maturities": M.debt_maturities(c, i),
        "free_cash_flow": M.fcf_table(c, idx),
        "fcf_sustainability": M.fcf_sustainability_summary(c, idx),
        "definitions": _defs("altman_z", "altman_z2", "piotroski_f", "beneish_m", "interest_coverage",
                             "ebitda_interest_coverage", "current_ratio", "quick_ratio", "cash_ratio", "net_debt",
                             "debt_to_ebitda", "net_debt_to_ebitda", "debt_to_equity", "fcf_margin_pct",
                             "fcf_conversion", "fcf_after_sbc", "fcf_after_finance_leases", "payout_to_fcf_pct",
                             "capex_to_da"),
        "model_applicability_and_limitations": {
            "altman_z": "Estimated on 1946-1965 US public manufacturers; X4 uses market value (sensitive to "
                        "market sentiment); X5 (asset turnover) penalises asset-heavy firms. Not for financials.",
            "altman_z_double_prime": "Drops X5 and uses book equity, for non-manufacturers and emerging-market "
                                     "firms; zones differ from Z. Book equity is distorted by buybacks and goodwill.",
            "piotroski_f": "Designed for high book-to-market (value) stocks; binary signals ignore magnitude; "
                           "one-year changes are noisy around acquisitions and restructurings.",
            "beneish_m": "Detects earnings overstatement patterns from 1982-1992 samples; high-growth firms "
                         "(high SGI) can score above the threshold without manipulation.",
            "interest_coverage": "EBIT is GAAP operating income; one-off charges depress it.",
            "debt_maturities": "XBRL maturity tags cover long-term debt principal only (no leases, no "
                               "commercial paper); amounts are as of the latest 10-K, not updated by 10-Qs.",
            "fcf": "FCF = OCF - capex; excludes acquisitions and finance-lease principal unless shown separately.",
        },
    })
    if m.block():
        out["market_inputs"] = m.block()
    out.update(inputs_block(st, c.periods[max(0, idx[0] - 1):], [
        "revenue", "gross_profit", "operating_income", "interest_expense", "net_income", "operating_cash_flow",
        "capex", "total_assets", "current_assets", "current_liabilities", "total_liabilities", "retained_earnings",
        "total_equity", "total_debt", "ltd_noncurrent", "cash", "short_term_investments", "receivables",
        "shares_outstanding", "shares_diluted", "depreciation_amortization", "ebitda", "sbc", "dividends_paid",
        "buybacks", "debt_due_y1", "debt_due_y2", "debt_due_y3", "debt_due_y4", "debt_due_y5", "debt_due_after_y5"]))
    return _finish(out, c)


# ── 6. peers ────────────────────────────────────────────────────────────────
PEER_METRICS = {
    # name: (higher_is_better, description)
    "ev_to_ebitda": (False, "EV / EBITDA (TTM)"),
    "forward_pe": (False, "forward P/E (provider consensus; not SEC data)"),
    "fcf_yield_pct": (True, "FCF (TTM) / market cap"),
    "roic_pct": (True, "ROIC, latest fiscal year"),
    "gross_margin_pct": (True, "gross margin (TTM)"),
    "revenue_growth_pct": (True, "revenue growth, latest fiscal year vs prior"),
    "capex_intensity_pct": (False, "capex / revenue (TTM); lower = more capital-light (direction is an assumption)"),
}


def _flow(st: Statements, item: str) -> Optional[Dict[str, Any]]:
    t = ttm(st, item)
    if t is not None:
        return {"value": t["value"], "basis": "TTM " + " + ".join(t["periods"])}
    if st.annual:
        p = st.annual[-1]
        v = st.v(p.key, item)
        if v is not None:
            return {"value": v, "basis": p.label}
    return None


def _balance_sheet(st: Statements) -> Optional[FPeriod]:
    """Latest period (quarter or fiscal year) with a balance sheet; every balance
    used for EV comes from this one date."""
    cands = [p for p in (st.quarterly + st.annual) if st.v(p.key, "total_assets") is not None]
    return max(cands, key=lambda p: p.end) if cands else None


def _ev_balances(st: Statements, bp: FPeriod, notes: List[str]) -> Optional[Dict[str, float]]:
    """Debt, cash, short-term investments and NCI at one balance-sheet date.
    Debt and cash must be tagged; short-term investments that are tagged at a
    neighbouring date but not this one make EV unavailable (an unmapped tag,
    not zero)."""
    debt, cash = st.v(bp.key, "total_debt"), st.v(bp.key, "cash")
    if debt is None or cash is None:
        notes.append(f"EV not computed: {'total debt' if debt is None else 'cash'} not tagged at {bp.end}")
        return None
    out = {"total_debt": debt, "cash": cash}
    for k in ("short_term_investments", "minority_interest"):
        v = st.v(bp.key, k)
        if v is None:
            near = [p for p in (st.quarterly + st.annual) if p.key != bp.key and st.v(p.key, k) is not None
                    and abs((_date(p.end) - _date(bp.end)).days) <= 400]
            if k == "short_term_investments" and near:
                notes.append(f"EV not computed: short-term investments tagged at {near[-1].end} but not at {bp.end}")
                return None
            notes.append(f"{k} not tagged at {bp.end}; treated as 0 in EV")
            v = 0.0
        out[k] = v
    return out


def _date(s: str):
    from datetime import date
    return date.fromisoformat(s[:10])


def peer_row(st: Statements, m: MarketInputs) -> Dict[str, Any]:
    fx = _fx(st, m)
    row: Dict[str, Any] = {"ticker": st.ticker, "company": st.entity_name, "reporting_currency": st.currency,
                           "taxonomy": st.taxonomy,
                           "fiscal_year_end": st.annual[-1].end if st.annual else None, "basis": {}, "notes": []}
    if fx is None:
        row["notes"].append(f"no {st.currency}->USD rate: valuation multiples not computed")
    elif st.currency != "USD":
        row["notes"].append(f"{st.currency} financials converted at {fx:.6f} USD per {st.currency} "
                            f"({m.fx_source}, {m.fx_as_of}); flows translated at spot, not period-average rates")
    vals: Dict[str, Optional[float]] = {}
    flows = {k: _flow(st, k) for k in ("revenue", "gross_profit", "operating_income", "depreciation_amortization",
                                       "net_income", "operating_cash_flow", "capex", "sbc")}
    for k, f in flows.items():
        if f:
            row["basis"][k] = f["basis"]
    bp = _balance_sheet(st)
    if bp is not None:
        row["basis"]["balance_sheet"] = f"{bp.label} (as of {bp.end})"

    def fv(k):
        return flows[k]["value"] if flows.get(k) else None

    mc = m.market_cap_usd
    row["market_cap_usd"] = M.money(mc)
    row["market_cap_source"] = m.market_cap_source
    ev_parts = _ev_balances(st, bp, row["notes"]) if bp is not None else None
    if mc and fx and ev_parts is not None:
        ev = mc + (ev_parts["total_debt"] + ev_parts["minority_interest"] - ev_parts["cash"]
                   - ev_parts["short_term_investments"]) * fx
        row["enterprise_value_usd"] = M.money(ev)
        row["ev_components"] = {k: M.money(v) for k, v in ev_parts.items()}
        if fv("operating_income") is not None and fv("depreciation_amortization") is not None:
            ebitda = (fv("operating_income") + fv("depreciation_amortization")) * fx
            row["ebitda_usd"] = M.money(ebitda)
            vals["ev_to_ebitda"] = M.ratio(ev / ebitda) if ebitda > 0 else None
            if ebitda <= 0:
                row["notes"].append("EBITDA <= 0: EV/EBITDA not meaningful")
    if mc and fx and fv("net_income") is not None:
        ni = fv("net_income") * fx
        vals["pe_ttm"] = M.ratio(mc / ni) if ni > 0 else None
    vals["forward_pe"] = m.forward_pe
    if m.forward_pe is not None:
        row["forward_pe_source"] = m.forward_pe_source
    if mc and fx and fv("operating_cash_flow") is not None and fv("capex") is not None:
        fcf = (fv("operating_cash_flow") - fv("capex")) * fx
        row["fcf_usd"] = M.money(fcf)
        vals["fcf_yield_pct"] = M.pct(fcf / mc)
        if fv("sbc") is not None:
            vals["fcf_yield_after_sbc_pct"] = M.pct((fcf - fv("sbc") * fx) / mc)
    rev = fv("revenue")
    if rev:
        if fv("gross_profit") is not None:
            vals["gross_margin_pct"] = M.pct(fv("gross_profit") / rev)
        if fv("capex") is not None:
            vals["capex_intensity_pct"] = M.pct(fv("capex") / rev)
        if fv("sbc") is not None:
            vals["sbc_pct_revenue"] = M.pct(fv("sbc") / rev)
        if fv("operating_income") is not None:
            vals["operating_margin_pct"] = M.pct(fv("operating_income") / rev)
    c, idx = _window(st, 1, 2)
    if idx:
        i = idx[-1]
        vals["roic_pct"] = c.calc("roic_pct", i, lambda: M.pct(M.nopat(c, i) / M._avg_ic(c, i)))
        vals["revenue_growth_pct"] = c.calc("revenue_growth_pct", i, lambda: M.pct(M._growth(c.g(i, "revenue"), c.g(i - 1, "revenue"))))
        vals["operating_leverage"] = M.operating_leverage(c, i)
        vals["fcf_conversion"] = c.calc("fcf_conversion", i, lambda: M.ratio(M._div(c.g(i, "free_cash_flow"), c.g(i, "net_income"))))
        vals["net_share_change_pct"] = c.calc("net_share_change_pct", i, lambda: M.pct(M._growth(c.g(i, "shares_diluted"), c.g(i - 1, "shares_diluted"))))
        row["basis"]["roic_pct"] = row["basis"]["revenue_growth_pct"] = c.label(i)
        row["notes"].extend(c.assumption_notes())
        if c.unavailable:
            row["unavailable"] = sorted(set(c.unavailable))
    row["metrics"] = vals
    return row


def _ranks(values: Dict[str, float], higher_better: bool) -> Dict[str, float]:
    order = sorted(values, key=lambda t: values[t], reverse=higher_better)
    ranks: Dict[str, float] = {}
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def peer_ranking(rows: List[Dict[str, Any]], weights: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """Composite = weighted mean of per-metric ranks (1 = best).  Only metrics
    available for every ticker are used, so no ticker is ranked on fewer inputs."""
    tickers = [r["ticker"] for r in rows]
    weights = {k: float(v) for k, v in (weights or {}).items() if k in PEER_METRICS and v is not None and v >= 0}
    used, dropped = [], []
    per_metric: Dict[str, Dict[str, float]] = {}
    for k, (hib, _) in PEER_METRICS.items():
        vals = {r["ticker"]: r["metrics"].get(k) for r in rows}
        if any(v is None for v in vals.values()):
            dropped.append(f"{k} (missing for {', '.join(t for t, v in vals.items() if v is None)})")
            continue
        if weights and weights.get(k, 1.0) == 0:
            dropped.append(f"{k} (weight 0)")
            continue
        per_metric[k] = _ranks(vals, hib)
        used.append(k)
    if not used:
        return {"ranking": None, "unavailable": "no metric is available for every ticker", "dropped_metrics": dropped}

    def composite(metrics: Sequence[str]) -> Dict[str, float]:
        w = {k: weights.get(k, 1.0) for k in metrics}
        tot = sum(w.values()) or 1.0
        return {t: round(sum(per_metric[k][t] * w[k] for k in metrics) / tot, 3) for t in tickers}

    def order(scores: Dict[str, float]) -> List[str]:
        return sorted(scores, key=lambda t: (scores[t], t))

    base = composite(used)
    base_order = order(base)
    sens = {}
    for k in used:
        rest = [x for x in used if x != k]
        if rest:
            o = order(composite(rest))
            sens[f"without_{k}"] = {"order": o, "top_changes": o[0] != base_order[0]}
    groups = {"valuation_only": [k for k in used if k in ("ev_to_ebitda", "forward_pe", "fcf_yield_pct")],
              "quality_growth_only": [k for k in used if k in ("roic_pct", "gross_margin_pct", "revenue_growth_pct",
                                                               "capex_intensity_pct")]}
    for g, ks in groups.items():
        if ks:
            sens[g] = {"order": order(composite(ks)), "metrics": ks}
    return {
        "method": "rank each metric across peers (1 = best; ties share the average rank), composite = weighted "
                  "mean rank; equal weights unless given",
        "metric_directions": {k: ("higher is better" if PEER_METRICS[k][0] else "lower is better") + f": {PEER_METRICS[k][1]}"
                              for k in used},
        "weights": {k: weights.get(k, 1.0) for k in used},
        "per_metric_ranks": per_metric,
        "composite_mean_rank": base,
        "ranking": base_order,
        "sensitivity": sens,
        "dropped_metrics": dropped,
    }


def peer_normalisation_notes(rows: List[Dict[str, Any]]) -> List[str]:
    notes = [
        "EBITDA = GAAP/IFRS operating income + D&A from the cash-flow statement; not adjusted for stock-based "
        "compensation (SBC-adjusted FCF yield shown separately).",
        "TTM = sum of the latest four fiscal quarters when all are in XBRL; otherwise the latest fiscal year "
        "(see each row's basis). Fiscal years end in different months, so periods are not calendar-aligned.",
        "EV = market cap + total debt + noncontrolling interests - cash - short-term investments (latest balance "
        "sheet); operating leases excluded for every company.",
        "Forward P/E is the market-data provider's figure (not SEC data) and is stated with its source.",
        "ROIC = NOPAT / average invested capital (financing approach, all cash treated as excess).",
    ]
    fye = {r["ticker"]: r.get("fiscal_year_end") for r in rows}
    notes.append("Latest fiscal year ends: " + ", ".join(f"{t} {d}" for t, d in fye.items()))
    ifrs = [r["ticker"] for r in rows if r.get("taxonomy") == "ifrs-full"]
    if ifrs:
        notes.append(f"{', '.join(ifrs)} report under IFRS: operating-profit and lease presentation differ from US GAAP "
                     "(IFRS 16 puts all leases on balance sheet and moves lease costs below EBITDA, raising EBITDA).")
    return notes


def safe_float(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None
