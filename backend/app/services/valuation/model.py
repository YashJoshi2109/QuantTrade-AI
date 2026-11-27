"""Base case: turns verified inputs (XBRL financials, quote, rates, beta) into
DCF assumptions, logging every default it derives or assumes.

Derived defaults (kind="derived_default", formula shown in the output):
  base revenue / margin   latest fiscal year (10-K / 20-F), not TTM
  tax rate                sum(income tax) / sum(pre-tax income), last 3 FY with positive pre-tax income
  stage-1 growth          historical revenue CAGR over up to 5 fiscal years, bounded to [-5%, 25%]
  sales-to-capital        sum(change in revenue) / sum(reinvestment), up to 5 FY;
                          reinvestment = capex - D&A + change in non-cash working capital
  D&A % revenue           latest FY
Assumptions (kind="assumption"): ERP, terminal growth, terminal ROIC, marginal tax rate.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from app.services.valuation import wacc as W
from app.services.valuation.dcf import DCFAssumptions, EquityBridge
from app.services.valuation.financials import AnnualFinancials, CompanyFinancials
from app.services.valuation.provenance import AssumptionLog, DataUnavailable, Datum, pct, r

GROWTH_BOUNDS = (-0.05, 0.25)
S2C_BOUNDS = (0.2, 10.0)
TAX_BOUNDS = (0.05, 0.40)
TERMINAL_GROWTH_CAP = 0.03
TERMINAL_GROWTH_RATIONALE = ("ASSUMPTION. Default terminal growth = min(current 10Y Treasury yield, 3.0%). "
                             "A firm cannot outgrow the economy forever; the risk-free rate is the usual "
                             "ceiling for nominal perpetual growth (Damodaran), and 3.0% is close to "
                             "long-run US nominal GDP growth net of a maturity discount. It is always "
                             "kept below WACC.")
TERMINAL_ROIC_RATIONALE = ("ASSUMPTION. Terminal ROIC = WACC (no excess returns in perpetuity), so terminal "
                           "growth adds no value; terminal reinvestment rate = g / ROIC.")


@dataclass
class MarketInputs:
    price: Optional[Datum]                 # quote price in quote currency (USD)
    rf: Datum                              # 10Y Treasury, fraction
    beta: Optional[W.BetaResult] = None
    fx_reporting_per_quote: Optional[Datum] = None   # e.g. TWD per USD
    shares_per_adr: Optional[float] = None


@dataclass
class BaseCase:
    fin: CompanyFinancials
    market: MarketInputs
    assumptions: DCFAssumptions
    bridge: EquityBridge
    revenue0: float
    base_year: AnnualFinancials
    wacc: Dict[str, Any]
    log: AssumptionLog
    history: Dict[str, Any]
    inputs: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def inputs_payload(self) -> Dict[str, Any]:
        return self.inputs


# ── history helpers ─────────────────────────────────────────────────────────
def cagr(first: float, last: float, years: int) -> Optional[float]:
    if years <= 0 or first is None or last is None or first <= 0 or last <= 0:
        return None
    return (last / first) ** (1.0 / years) - 1.0


def revenue_history(fin: CompanyFinancials, window: int = 5) -> Dict[str, Any]:
    s = fin.series("revenue")
    growth = [(fy, v / pv - 1.0) for (pfy, pv), (fy, v) in zip(s, s[1:]) if pv and pv > 0]
    out: Dict[str, Any] = {"annual_growth_pct": [{"fiscal_year": fy, "growth_pct": pct(g)} for fy, g in growth]}
    for n in (3, 5, 10):
        if len(s) > n:
            out[f"cagr_{n}y_pct"] = pct(cagr(s[-n - 1][1], s[-1][1], n))
    m = [(y.fiscal_year, y.get("operating_income") / y.get("revenue")) for y in fin.years
         if y.get("operating_income") is not None and y.get("revenue")]
    if m:
        vals = sorted(v for _, v in m)
        out["operating_margin_pct"] = [{"fiscal_year": fy, "margin_pct": pct(v)} for fy, v in m]
        out["operating_margin_min_pct"] = pct(vals[0])
        out["operating_margin_max_pct"] = pct(vals[-1])
        out["operating_margin_median_pct"] = pct(vals[len(vals) // 2] if len(vals) % 2 else
                                                 (vals[len(vals) // 2 - 1] + vals[len(vals) // 2]) / 2)
    if growth:
        gv = sorted(g for _, g in growth[-window:])
        out["growth_min_pct"], out["growth_max_pct"] = pct(gv[0]), pct(gv[-1])
    return out


def effective_tax_rate(fin: CompanyFinancials, n: int = 3) -> Tuple[Optional[float], List[int]]:
    rows = [(y.fiscal_year, y.get("income_tax"), y.get("pretax_income")) for y in fin.years
            if y.get("income_tax") is not None and y.get("pretax_income") is not None and y.get("pretax_income") > 0][-n:]
    if not rows:
        return None, []
    return sum(t for _, t, _ in rows) / sum(p for _, _, p in rows), [fy for fy, _, _ in rows]


def _nwc(y: AnnualFinancials) -> Optional[float]:
    ca, cl = y.get("current_assets"), y.get("current_liabilities")
    if ca is None or cl is None:
        return None
    cash = y.get("cash_and_sti") or 0.0
    debt_cur = sum(y.get(k) or 0.0 for k in ("ltd_current", "commercial_paper", "short_term_borrowings"))
    return (ca - cash) - (cl - debt_cur)


def sales_to_capital(fin: CompanyFinancials, window: int = 5) -> Dict[str, Any]:
    ys = fin.years[-(window + 1):]
    d_rev = d_inv = 0.0
    used, nwc_missing = [], False
    for prev, cur in zip(ys, ys[1:]):
        rv, pv = cur.get("revenue"), prev.get("revenue")
        capex, da = cur.get("capex"), cur.get("d_and_a")
        if None in (rv, pv, capex, da):
            continue
        n1, n0 = _nwc(cur), _nwc(prev)
        dnwc = (n1 - n0) if n1 is not None and n0 is not None else 0.0
        nwc_missing |= n1 is None or n0 is None
        d_rev += rv - pv
        d_inv += capex - da + dnwc
        used.append(cur.fiscal_year)
    res: Dict[str, Any] = {"fiscal_years": used, "sum_revenue_change": r(d_rev, 0), "sum_reinvestment": r(d_inv, 0),
                           "formula": "sum(change in revenue) / sum(capex - D&A + change in non-cash working capital)"}
    if nwc_missing:
        res["note"] = "working-capital data missing for some years; those years use net capex only"
    if used and d_rev > 0 and d_inv > 0:
        res["value"] = d_rev / d_inv
        res["method"] = "incremental"
        return res
    # fall back to the level ratio: revenue / invested capital
    y = fin.latest
    eq, debt, cash = y.get("stockholders_equity"), y.get("total_debt") or 0.0, y.get("cash_and_sti") or 0.0
    if y.get("revenue") and eq is not None and eq + debt - cash > 0:
        res.update(value=y.get("revenue") / (eq + debt - cash), method="level",
                   formula="revenue / (equity + debt - cash) (incremental reinvestment was not positive)")
        return res
    res.update(value=None, method="unavailable")
    return res


def _datum_in(d: Optional[Datum]) -> Optional[Dict[str, Any]]:
    return d.to_dict() if d is not None else None


# ── builder ──────────────────────────────────────────────────────────────────
def build_base_case(fin: CompanyFinancials, market: MarketInputs, p: Optional[Dict[str, Any]] = None) -> BaseCase:
    p = dict(p or {})
    log = AssumptionLog()
    warnings: List[str] = list(fin.notes)
    y = fin.latest
    rev = fin.require("revenue")
    ebit = fin.require("operating_income")
    if rev.value <= 0:
        raise DataUnavailable(f"{fin.ticker}: latest fiscal-year revenue is not positive")
    margin0 = ebit.value / rev.value
    inputs: Dict[str, Dict[str, Any]] = {"revenue_base_year": rev.to_dict(), "operating_income_base_year": ebit.to_dict()}

    # tax rate
    if p.get("tax_rate") is not None:
        tax = float(p["tax_rate"])
        log.add("tax_rate", pct(tax), "caller-supplied", "user_input")
    else:
        eff, yrs = effective_tax_rate(fin)
        if eff is None:
            tax = W.DEFAULT_MARGINAL_TAX
            log.add("tax_rate", pct(tax), "effective tax rate not computable from XBRL; using the 21% US statutory rate")
        elif not (TAX_BOUNDS[0] <= eff <= TAX_BOUNDS[1]):
            tax = W.DEFAULT_MARGINAL_TAX
            log.add("tax_rate", pct(tax), f"effective rate sum(income tax)/sum(pre-tax income) for FY{yrs} = "
                    f"{pct(eff)}% is outside [{pct(TAX_BOUNDS[0])}%, {pct(TAX_BOUNDS[1])}%] (one-off items such as "
                    "valuation-allowance releases); using the 21% US statutory rate instead")
            warnings.append(f"effective tax rate {pct(eff)}% looks distorted; 21% statutory rate used for NOPAT")
        else:
            tax = eff
            log.add("tax_rate", pct(tax), f"effective rate = sum(income tax)/sum(pre-tax income) for FY{yrs}",
                    "derived_default")
    marginal = float(p.get("marginal_tax_rate") if p.get("marginal_tax_rate") is not None else W.DEFAULT_MARGINAL_TAX)
    log.add("marginal_tax_rate", pct(marginal), W.MARGINAL_TAX_RATIONALE,
            "user_input" if p.get("marginal_tax_rate") is not None else "assumption")

    hist = revenue_history(fin)
    # stage-1 growth
    s = fin.series("revenue")
    if p.get("stage1_growth") is not None:
        g1 = float(p["stage1_growth"])
        log.add("stage1_growth", pct(g1), "caller-supplied", "user_input")
    else:
        n = min(5, len(s) - 1)
        raw = cagr(s[-n - 1][1], s[-1][1], n) if n >= 1 else None
        if raw is None:
            raise DataUnavailable(f"{fin.ticker}: not enough positive annual revenue history for a growth default; "
                                  "pass stage1_growth explicitly")
        g1 = min(max(raw, GROWTH_BOUNDS[0]), GROWTH_BOUNDS[1])
        log.add("stage1_growth", pct(g1), f"historical {n}-year revenue CAGR FY{s[-n - 1][0]}-FY{s[-1][0]} = {pct(raw)}%"
                + (f", bounded to [{pct(GROWTH_BOUNDS[0])}%, {pct(GROWTH_BOUNDS[1])}%]" if g1 != raw else ""),
                "derived_default")

    rf = market.rf
    inputs["risk_free_rate"] = rf.to_dict()
    if p.get("terminal_growth") is not None:
        g_t = float(p["terminal_growth"])
        log.add("terminal_growth", pct(g_t), "caller-supplied", "user_input")
    else:
        g_t = min(rf.value, TERMINAL_GROWTH_CAP)
        log.add("terminal_growth", pct(g_t), TERMINAL_GROWTH_RATIONALE)

    if p.get("target_operating_margin") is not None:
        m_t = float(p["target_operating_margin"])
        log.add("target_operating_margin", pct(m_t), "caller-supplied", "user_input")
    else:
        m_t = margin0
        log.add("target_operating_margin", pct(m_t), f"latest FY{y.fiscal_year} operating margin held constant "
                "(operating income / revenue)", "derived_default")

    stc = sales_to_capital(fin)
    if p.get("sales_to_capital") is not None:
        s2c = float(p["sales_to_capital"])
        log.add("sales_to_capital", r(s2c, 3), "caller-supplied", "user_input")
    elif stc.get("value") is not None:
        s2c = min(max(stc["value"], S2C_BOUNDS[0]), S2C_BOUNDS[1])
        log.add("sales_to_capital", r(s2c, 3), stc["formula"] + f" over FY{stc['fiscal_years']}"
                + (f" = {r(stc['value'], 3)}, bounded to {S2C_BOUNDS}" if s2c != stc["value"] else ""), "derived_default")
    else:
        s2c = 2.0
        log.add("sales_to_capital", s2c, "ASSUMPTION: reinvestment history not computable from XBRL; 2.0 is a "
                "generic placeholder - override with sales_to_capital")
        warnings.append("sales-to-capital is an assumption, not derived from filings")

    da = y.get("d_and_a")
    da_pct = da / rev.value if da is not None else None

    # equity bridge (latest balance sheet in any filing)
    b = fin.balance
    notes = []
    debt_d = b.get("total_debt")
    if debt_d is None:
        notes.append(f"no debt concept reported at {fin.balance_date}; debt taken as 0")
    cash_d = b.get("cash_and_sti")
    if cash_d is None:
        notes.append(f"no cash concept reported at {fin.balance_date}; cash taken as 0")
    include_lti = p.get("include_long_term_investments", True)
    lti_d = b.get("long_term_investments") if include_lti else None
    mi_d = b.get("minority_interest")
    for k, d in (("total_debt", debt_d), ("cash_and_short_term_investments", cash_d),
                 ("long_term_marketable_securities", lti_d), ("minority_interest", mi_d)):
        if d is not None:
            inputs[k] = d.to_dict()
    shares = fin.shares_outstanding
    if shares is None:
        sd = y.datum("shares_diluted")
        if sd is None:
            raise DataUnavailable(f"{fin.ticker}: shares outstanding not reported (cover page or diluted weighted average)")
        shares = Datum(**{**sd.__dict__, "formula": "FY weighted-average diluted shares (cover-page count unavailable)"})
        warnings.append("cover-page shares outstanding unavailable; using FY weighted-average diluted shares")
    inputs["shares_outstanding"] = shares.to_dict()
    if shares.formula and "share classes" in shares.formula:
        warnings.append("multiple share classes summed; per-share value assumes equal economic rights per share")

    price_rep = None
    if market.price is not None:
        inputs["price"] = market.price.to_dict()
        if fin.currency == "USD":
            price_rep = market.price.value
        elif market.fx_reporting_per_quote is not None and market.shares_per_adr:
            price_rep = market.price.value * market.fx_reporting_per_quote.value / market.shares_per_adr
            inputs["fx_rate"] = market.fx_reporting_per_quote.to_dict()
            log.add("shares_per_adr", market.shares_per_adr, "caller-supplied ADR ratio", "user_input")
            notes.append(f"price converted to {fin.currency} per ordinary share: USD ADR price x FX / shares per ADR")
        else:
            warnings.append(f"reports in {fin.currency}; comparison with the USD quote needs an FX rate and "
                            "shares_per_adr (ADR ratio), so market comparison is unavailable")
    bridge = EquityBridge(total_debt=debt_d.value if debt_d else 0.0, cash_and_sti=cash_d.value if cash_d else 0.0,
                          long_term_investments=lti_d.value if lti_d else 0.0,
                          minority_interest=mi_d.value if mi_d else 0.0,
                          shares_outstanding=shares.value, price=price_rep, notes=notes)

    # WACC
    erp = float(p["erp"]) if p.get("erp") is not None else W.DEFAULT_ERP
    log.add("erp", pct(erp), "caller-supplied" if p.get("erp") is not None else W.ERP_RATIONALE,
            "user_input" if p.get("erp") is not None else "assumption")
    if p.get("beta") is not None:
        beta = float(p["beta"])
        log.add("beta", beta, "caller-supplied", "user_input")
    elif market.beta is not None:
        beta = market.beta.blume_adjusted if p.get("beta_adjustment") == "blume" else market.beta.beta
    else:
        raise DataUnavailable(f"{fin.ticker}: beta regression unavailable (no price history) - pass beta explicitly")
    prior = fin.years[-2] if len(fin.years) >= 2 else None
    kd = W.cost_of_debt(y.datum("interest_expense"), y.datum("total_debt"),
                        prior.datum("total_debt") if prior else None, rf.value, log,
                        spread=p.get("debt_spread"), interest_expense_debt=y.datum("interest_expense_debt"),
                        finance_lease_interest=y.datum("finance_lease_interest"),
                        operating_income=y.datum("operating_income"))
    for k in ("interest_expense", "interest_expense_debt", "finance_lease_interest"):
        if y.datum(k) is not None:
            inputs[k] = y.datum(k).to_dict()
    mcap = price_rep * shares.value if price_rep else None
    if mcap is None:
        if p.get("wacc") is None:
            hint = (f" Reports in {fin.currency}: the USD quote needs an FX rate (FRED) and shares_per_adr "
                    "(ordinary shares per ADS, stated on the 20-F cover)." if fin.currency != "USD" else "")
            raise DataUnavailable(f"{fin.ticker}: market value of equity unavailable for WACC weights "
                                  f"(no usable quote).{hint} Or pass wacc explicitly")
        w = {"wacc": float(p["wacc"]), "cost_of_equity": rf.value + beta * erp, "after_tax_cost_of_debt": None,
             "weight_equity": None, "weight_debt": None, "risk_free": rf.value, "beta": beta, "erp": erp,
             "pre_tax_cost_of_debt": kd.get("pre_tax"), "marginal_tax_rate": marginal, "equity_value": None,
             "debt_value": bridge.total_debt}
    else:
        w = W.compute_wacc(rf=rf, beta=beta, erp=erp, market_cap=mcap, total_debt=bridge.total_debt,
                           kd_pre_tax=kd.get("pre_tax"), marginal_tax=marginal)
    w["cost_of_debt_detail"] = kd
    wacc_used = w["wacc"]
    if p.get("wacc") is not None:
        wacc_used = float(p["wacc"])
        log.add("wacc", pct(wacc_used), "caller-supplied override of the derived WACC", "user_input")
    if fin.currency != "USD":
        warnings.append(f"WACC uses the US 10Y Treasury and SPY beta while cash flows are in {fin.currency}; "
                        "pass rf/wacc for a local-currency discount rate")

    roic_t = p.get("terminal_roic")
    if roic_t is not None:
        log.add("terminal_roic", pct(float(roic_t)), "caller-supplied", "user_input")
    else:
        log.add("terminal_roic", "= WACC", TERMINAL_ROIC_RATIONALE)
    exit_mult = p.get("exit_ev_ebitda")
    method = p.get("terminal_method") or "gordon"
    if method == "exit_multiple" and exit_mult is None:
        raise DataUnavailable("terminal_method=exit_multiple needs exit_ev_ebitda")
    if exit_mult is not None:
        log.add("exit_ev_ebitda", float(exit_mult), "caller-supplied", "user_input")
    a = DCFAssumptions(stage1_growth=g1, terminal_growth=g_t, operating_margin_start=margin0,
                       target_operating_margin=m_t, tax_rate=tax,
                       sales_to_capital=s2c, wacc=wacc_used,
                       stage1_years=int(p.get("stage1_years") or 5), fade_years=int(p["fade_years"]) if p.get("fade_years") is not None else 5,
                       margin_convergence_years=p.get("margin_convergence_years"), terminal_method=method,
                       terminal_roic=float(roic_t) if roic_t is not None else None,
                       exit_ev_ebitda=float(exit_mult) if exit_mult is not None else None,
                       da_pct_revenue=da_pct, mid_year=bool(p.get("mid_year", False)))
    if a.terminal_growth >= a.wacc:
        raise DataUnavailable(f"terminal growth {pct(a.terminal_growth)}% is not below WACC {pct(a.wacc)}%; "
                              "lower terminal_growth or check the discount rate")
    history = {**hist, "sales_to_capital": stc,
               "effective_tax_rate_pct": pct(effective_tax_rate(fin)[0]),
               "da_pct_revenue": pct(da_pct)}
    return BaseCase(fin=fin, market=market, assumptions=a, bridge=bridge, revenue0=rev.value, base_year=y,
                    wacc=w, log=log, history=history, inputs=inputs, warnings=warnings)
