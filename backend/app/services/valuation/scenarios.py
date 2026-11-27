"""Multivariable scenario engine and bull / base / bear builder.

Pro forma P&L on the latest fiscal year (all shocks are fractions):
  v        = (1 - demand_decline) * (1 + revenue_change)                 volume factor
  fx_R     = 1 - foreign_revenue_share * s / (1 + s) * (1 - hedge_ratio)  s = reporting-ccy appreciation
  fx_C     = 1 - foreign_cost_share    * s / (1 + s) * (1 - hedge_ratio)
  revenue' = revenue * v * fx_R
  cogs_vol = cogs * ((1 - variable_cogs_share) + variable_cogs_share * v)
  cogs'    = cogs_vol * (1 + cogs_inflation) * fx_C
             + cogs_vol * tariff_exposed_cogs_share * tariff_rate * (1 - tariff_pass_through)
  gross'   = revenue' - cogs' + revenue' * gross_margin_change
  opex'    = (gross - EBIT) * (1 + opex_change)
  EBIT'    = gross' - opex'
  d_int    = total debt * floating_rate_debt_share * rate_shock
  EPS'     = (net income + ((EBIT' - EBIT) - d_int) * (1 - tax)) / diluted shares
Valuation: the DCF is re-run from revenue' with the operating margin shifted
by (EBIT'/revenue' - EBIT/revenue) in every year, WACC + rate_shock * (E/V +
D/V*(1-t)), minus the PV of extra capex (capex_change * base capex for
capex_shock_years years).
"""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Dict, List, Optional

import numpy as np

from app.services.valuation.dcf import DCFAssumptions, per_share, project, run_dcf
from app.services.valuation.provenance import AssumptionLog, DataUnavailable, pct, r

SHOCKS = {
    "reporting_currency_appreciation": "appreciation of the reporting currency (USD for US filers) vs all "
                                       "foreign currencies, e.g. 0.10 = +10%",
    "demand_decline": "fall in unit demand / volume, e.g. 0.05 = -5% volume",
    "revenue_change": "direct revenue change not driven by volume (e.g. export restrictions), e.g. -0.08",
    "tariff_rate": "incremental tariff on the exposed share of COGS, e.g. 0.25",
    "cogs_inflation": "increase in unit manufacturing cost, e.g. 0.03 = +3% COGS",
    "gross_margin_change": "direct gross-margin change in fraction points, e.g. -0.02 = -2pp",
    "opex_change": "change in operating expenses, e.g. 0.05",
    "capex_change": "change in annual capex vs the latest FY, e.g. 0.20 = +20%",
    "rate_shock": "parallel interest-rate shift as a fraction, e.g. 0.01 = +100bp",
}
# Structural parameters: documented defaults, always listed as assumptions.
STRUCTURAL_DEFAULTS = {
    "foreign_revenue_share": (None, "share of revenue outside the home country; from the 10-K/20-F XBRL "
                                    "geographic revenue disclosure when available"),
    "foreign_cost_share": (0.0, "ASSUMPTION: costs treated as reporting-currency denominated (no natural hedge)"),
    "hedge_ratio": (0.0, "ASSUMPTION: no FX hedging (gross translation impact)"),
    "variable_cogs_share": (1.0, "ASSUMPTION: COGS fully variable with volume; operating expenses fixed"),
    "tariff_exposed_cogs_share": (None, "share of COGS subject to the tariff; not disclosed in XBRL - must be "
                                        "supplied when tariff_rate is used"),
    "tariff_pass_through": (0.0, "ASSUMPTION: none of the tariff is passed on to customers"),
    "floating_rate_debt_share": (0.0, "ASSUMPTION: debt is fixed-rate, so a rate shock changes the discount "
                                      "rate but not near-term interest expense"),
    "capex_shock_years": (3, "ASSUMPTION: a capex change persists for 3 years before reverting"),
}


def _base_pl(fin, tax_rate: float) -> Dict[str, Any]:
    y = fin.latest
    rev = fin.require("revenue").value
    ebit = fin.require("operating_income").value
    cogs = y.get("cost_of_revenue")
    gp = y.get("gross_profit")
    if cogs is None and gp is not None:
        cogs = rev - gp
    if cogs is None:
        raise DataUnavailable(f"{fin.ticker}: cost of revenue / gross profit not reported for FY{y.fiscal_year}; "
                              "COGS-based shocks cannot be computed")
    gp = rev - cogs if gp is None else gp
    ni = fin.require("net_income").value
    sh = y.get("shares_diluted")
    if not sh:
        raise DataUnavailable(f"{fin.ticker}: diluted share count not reported for FY{y.fiscal_year}")
    return {"fiscal_year": y.fiscal_year, "period_end": y.period_end, "revenue": rev, "cogs": cogs,
            "gross_profit": gp, "opex": gp - ebit, "ebit": ebit, "net_income": ni, "shares_diluted": sh,
            "eps_computed": ni / sh, "eps_reported": y.get("eps_diluted"), "tax_rate": tax_rate,
            "capex": y.get("capex"), "total_debt": y.get("total_debt") or 0.0}


def pro_forma(base: Dict[str, Any], shocks: Dict[str, float], st: Dict[str, float]) -> Dict[str, float]:
    g = lambda k: float(shocks.get(k) or 0.0)
    s = g("reporting_currency_appreciation")
    hedge = st["hedge_ratio"]
    fr = st.get("foreign_revenue_share") or 0.0
    v = (1 - g("demand_decline")) * (1 + g("revenue_change"))
    fx_r = 1 - fr * s / (1 + s) * (1 - hedge)
    fx_c = 1 - st["foreign_cost_share"] * s / (1 + s) * (1 - hedge)
    rev = base["revenue"] * v * fx_r
    vc = st["variable_cogs_share"]
    cogs_vol = base["cogs"] * ((1 - vc) + vc * v)
    tariff = cogs_vol * (st.get("tariff_exposed_cogs_share") or 0.0) * g("tariff_rate") * (1 - st["tariff_pass_through"])
    cogs = cogs_vol * (1 + g("cogs_inflation")) * fx_c + tariff
    gross = rev - cogs + rev * g("gross_margin_change")
    opex = base["opex"] * (1 + g("opex_change"))
    ebit = gross - opex
    d_int = base["total_debt"] * st["floating_rate_debt_share"] * g("rate_shock")
    ni = base["net_income"] + ((ebit - base["ebit"]) - d_int) * (1 - base["tax_rate"])
    eps = ni / base["shares_diluted"]
    capex = base["capex"] * (1 + g("capex_change")) if base.get("capex") is not None else None
    return {"revenue": rev, "gross_profit": gross, "gross_margin": gross / rev if rev else None, "ebit": ebit,
            "operating_margin": ebit / rev if rev else None, "net_income": ni, "eps": eps, "capex": capex,
            "tariff_cost": tariff, "interest_change": d_int}


def _valuation(case, shocks: Dict[str, float], pf: Dict[str, float], st: Dict[str, float]) -> Optional[float]:
    a: DCFAssumptions = case.assumptions
    base_m = case.assumptions.operating_margin_start
    dm = (pf["operating_margin"] or 0.0) - base_m
    w = case.wacc
    rate = float(shocks.get("rate_shock") or 0.0)
    we = w.get("weight_equity") if w.get("weight_equity") is not None else 1.0
    wd = w.get("weight_debt") or 0.0
    a2 = replace(a, operating_margin_start=base_m + dm, target_operating_margin=a.target_operating_margin + dm,
                 wacc=a.wacc + rate * (we + wd * (1 - w["marginal_tax_rate"])))
    if a2.terminal_method == "gordon" and a2.terminal_growth >= a2.wacc:
        return None
    ev = float(project(pf["revenue"], a2)["enterprise_value"][0])
    capex_chg = float(shocks.get("capex_change") or 0.0)
    base_capex = case.base_year.get("capex")
    if capex_chg and base_capex:
        yrs = int(st["capex_shock_years"])
        ev -= sum(base_capex * capex_chg / (1 + a2.wacc) ** t for t in range(1, yrs + 1))
    return float(per_share(ev, case.bridge))


def _row(name, base, pf, vps, base_vps, shocks):
    d_eps = pf["eps"] - base["eps_computed"]
    return {"scenario": name, "shocks": {k: v for k, v in shocks.items() if v},
            "revenue": r(pf["revenue"], 0), "revenue_change_pct": pct(pf["revenue"] / base["revenue"] - 1),
            "gross_margin_pct": pct(pf["gross_margin"]), "gross_margin_change_pp": pct(pf["gross_margin"] - base["gross_profit"] / base["revenue"]),
            "operating_income": r(pf["ebit"], 0), "operating_income_change": r(pf["ebit"] - base["ebit"], 0),
            "operating_margin_pct": pct(pf["operating_margin"]),
            "eps": r(pf["eps"], 4), "eps_change": r(d_eps, 4), "eps_change_pct": pct(d_eps / base["eps_computed"])
            if base["eps_computed"] else None,
            "capex": r(pf["capex"], 0) if pf.get("capex") is not None else None,
            "value_per_share": r(vps, 2) if vps is not None else None,
            "value_change_pct": pct(vps / base_vps - 1) if vps is not None and base_vps else None}


def structural(params: Dict[str, Any], log: AssumptionLog, geo: Optional[Dict[str, Any]]) -> Dict[str, float]:
    st: Dict[str, float] = {}
    for k, (default, why) in STRUCTURAL_DEFAULTS.items():
        if params.get(k) is not None:
            st[k] = float(params[k])
            log.add(k, st[k], "caller-supplied", "user_input")
        elif k == "foreign_revenue_share" and geo and geo.get("foreign_share") is not None:
            st[k] = float(geo["foreign_share"])
            log.add(k, pct(st[k]), f"disclosed: {geo.get('formula')} ({geo.get('source')}, accession "
                                   f"{geo.get('accession')}, FY ending {geo.get('period_end')})", "derived_default")
        else:
            st[k] = default
            if default is not None:
                log.add(k, default, why)
    return st


def run_scenarios(case, shocks: Optional[Dict[str, float]], named: Optional[List[Dict[str, Any]]],
                  params: Dict[str, Any], geo: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    log = AssumptionLog()
    st = structural(params, log, geo)
    all_shocks = dict(shocks or {})
    for sc in named or []:
        all_shocks.update({k: v for k, v in (sc.get("shocks") or {}).items() if v})
    for k in all_shocks:
        if k not in SHOCKS:
            raise ValueError(f"unknown shock {k!r}; allowed: {sorted(SHOCKS)}")
    if all_shocks.get("reporting_currency_appreciation") and st.get("foreign_revenue_share") is None:
        raise DataUnavailable("FX shock needs the foreign revenue share: no geographic revenue split was found in "
                              "the latest annual XBRL filing; pass foreign_revenue_share with its source")
    if all_shocks.get("tariff_rate") and st.get("tariff_exposed_cogs_share") is None:
        raise DataUnavailable("tariff shock needs tariff_exposed_cogs_share (share of COGS subject to the tariff); "
                              "it is not in XBRL, so it must be supplied as an explicit assumption")
    base = _base_pl(case.fin, case.assumptions.tax_rate)
    base_vps = float(per_share(project(case.revenue0, case.assumptions)["enterprise_value"][0], case.bridge))
    out: Dict[str, Any] = {
        "base": {"fiscal_year": base["fiscal_year"], "period_end": base["period_end"],
                 "revenue": r(base["revenue"], 0), "cost_of_revenue": r(base["cogs"], 0),
                 "gross_profit": r(base["gross_profit"], 0), "operating_expenses": r(base["opex"], 0),
                 "operating_income": r(base["ebit"], 0), "net_income": r(base["net_income"], 0),
                 "diluted_shares": r(base["shares_diluted"], 0), "eps_computed": r(base["eps_computed"], 4),
                 "eps_reported": base["eps_reported"], "tax_rate_pct": pct(base["tax_rate"]),
                 "dcf_value_per_share": r(base_vps, 2)},
        "shock_definitions": {k: SHOCKS[k] for k in all_shocks},
        "formula": __doc__.split("Pro forma P&L on the latest fiscal year (all shocks are fractions):")[1].strip(),
    }
    if shocks:
        rows, d_sum, v_sum = [], 0.0, 0.0
        for k, v in shocks.items():
            if not v:
                continue
            one = {k: v}
            pf = pro_forma(base, one, st)
            vps = _valuation(case, one, pf, st)
            rows.append(_row(k, base, pf, vps, base_vps, one))
            d_sum += pf["eps"] - base["eps_computed"]
            v_sum += (vps - base_vps) if vps is not None else 0.0
        pf = pro_forma(base, shocks, st)
        vps = _valuation(case, shocks, pf, st)
        comb = _row("combined", base, pf, vps, base_vps, shocks)
        comb["sum_of_individual_eps_changes"] = r(d_sum, 4)
        comb["interaction_eps"] = r((pf["eps"] - base["eps_computed"]) - d_sum, 4)
        out["individual"] = rows
        out["combined"] = comb
        ranked = sorted(rows, key=lambda x: x["eps_change"])
        out["largest_downside"] = ranked[0]["scenario"] if ranked and ranked[0]["eps_change"] < 0 else None
    if named:
        out["scenarios"] = []
        for sc in named:
            sh = {k: v for k, v in (sc.get("shocks") or {}).items() if v}
            pf = pro_forma(base, sh, st)
            vps = _valuation(case, sh, pf, st)
            row = _row(sc.get("name") or "scenario", base, pf, vps, base_vps, sh)
            if sc.get("rationale"):
                row["rationale"] = sc["rationale"]
            out["scenarios"].append(row)
    out["assumptions"] = log.to_list()
    return out


# ── bull / base / bear ──────────────────────────────────────────────────────
def bull_base_bear(case, overrides: Optional[Dict[str, Dict[str, float]]], drawdowns: Optional[Dict[str, Any]],
                   pe_history: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Cases from the company's own history (each value says where it came from):
      bull: stage-1 growth = best annual revenue growth of the last 5 FY, margin = best FY operating margin,
            WACC - 0.5pp
      base: the base-case DCF (historical CAGR, latest margin)
      bear: stage-1 growth = worst annual revenue growth of the last 5 FY, margin = worst FY operating margin,
            WACC + 1pp
    plus valuation compression: latest diluted EPS x min / median / max historical fiscal-year-end P/E."""
    a: DCFAssumptions = case.assumptions
    h = case.history
    gmin, gmax = h.get("growth_min_pct"), h.get("growth_max_pct")
    mmin, mmax = h.get("operating_margin_min_pct"), h.get("operating_margin_max_pct")
    if gmin is None or mmin is None:
        raise DataUnavailable("not enough annual history for bull/bear cases")
    defs = {
        "bull": {"stage1_growth": min(gmax / 100, 0.80), "target_operating_margin": mmax / 100, "wacc_delta": -0.005,
                 "why": f"best annual revenue growth {gmax}% and best operating margin {mmax}% in the history; WACC -0.5pp (assumption)"},
        "base": {"stage1_growth": a.stage1_growth, "target_operating_margin": a.target_operating_margin, "wacc_delta": 0.0,
                 "why": "base-case DCF assumptions"},
        "bear": {"stage1_growth": max(gmin / 100, -0.30), "target_operating_margin": mmin / 100, "wacc_delta": 0.01,
                 "why": f"worst annual revenue growth {gmin}% and worst operating margin {mmin}% in the history; WACC +1pp (assumption)"},
    }
    cases = []
    for name, d in defs.items():
        o = (overrides or {}).get(name) or {}
        g = float(o.get("stage1_growth", d["stage1_growth"]))
        m = float(o.get("target_operating_margin", d["target_operating_margin"]))
        wd = float(o.get("wacc_delta", d["wacc_delta"]))
        tg = float(o.get("terminal_growth", a.terminal_growth))
        a2 = replace(a, stage1_growth=g, target_operating_margin=m, wacc=a.wacc + wd, terminal_growth=tg)
        if a2.terminal_growth >= a2.wacc:
            raise DataUnavailable(f"{name}: terminal growth must be below WACC")
        res = run_dcf(case.revenue0, a2, case.bridge, case.base_year.fiscal_year)
        cases.append({"case": name, "stage1_growth_pct": pct(g), "target_operating_margin_pct": pct(m),
                      "wacc_pct": pct(a2.wacc), "terminal_growth_pct": pct(tg),
                      "justification": "caller override" if o else d["why"],
                      "value_per_share": res["value_per_share"],
                      "upside_downside_pct": (res.get("vs_market") or {}).get("upside_downside_pct"),
                      "enterprise_value": res["enterprise_value"]})
    out: Dict[str, Any] = {"cases": cases, "method": bull_base_bear.__doc__.strip()}
    eps = case.base_year.get("eps_diluted")
    if pe_history:
        pes = sorted(x["pe"] for x in pe_history if x.get("pe") and x["pe"] > 0)
        if pes and eps and eps > 0:
            med = pes[len(pes) // 2] if len(pes) % 2 else (pes[len(pes) // 2 - 1] + pes[len(pes) // 2]) / 2
            out["multiple_compression"] = {
                "eps_diluted_latest_fy": eps, "pe_history": pe_history,
                "value_at_min_pe": r(eps * pes[0], 2), "value_at_median_pe": r(eps * med, 2),
                "value_at_max_pe": r(eps * pes[-1], 2),
                "formula": "value = latest FY diluted EPS x P/E; P/E = close on fiscal-year-end date / that FY's diluted EPS"}
        elif pes:
            out["multiple_compression"] = {"note": "latest diluted EPS not positive; P/E compression not meaningful",
                                           "pe_history": pe_history}
    if drawdowns:
        out["historical_stress"] = drawdowns
    if case.bridge.price:
        out["price"] = r(case.bridge.price, 2)
    return out


def drawdown_periods(prices, top: int = 3) -> Dict[str, Any]:
    """Peak-to-trough drawdowns from daily closes (non-overlapping, largest first)."""
    s = prices.dropna().sort_index()
    if s.empty:
        raise DataUnavailable("no price history for drawdowns")
    vals = s.to_numpy(float)
    peak = np.maximum.accumulate(vals)
    dd = vals / peak - 1.0
    periods = []
    i, n = 0, len(vals)
    while i < n:
        if dd[i] < 0:
            j = i
            while j < n and dd[j] < 0:
                j += 1
            seg = slice(i, j)
            t = i + int(np.argmin(dd[seg]))
            pk = i - 1 if i > 0 else i
            periods.append({"peak_date": s.index[pk].date().isoformat(), "peak_close": r(vals[pk], 2),
                            "trough_date": s.index[t].date().isoformat(), "trough_close": r(vals[t], 2),
                            "drawdown_pct": pct(dd[t]),
                            "recovered_date": s.index[j].date().isoformat() if j < n else None})
            i = j
        else:
            i += 1
    periods.sort(key=lambda p: p["drawdown_pct"])
    return {"window_start": s.index[0].date().isoformat(), "window_end": s.index[-1].date().isoformat(),
            "max_drawdown_pct": periods[0]["drawdown_pct"] if periods else 0.0,
            "worst_periods": periods[:top], "formula": "drawdown = close / running peak close - 1"}
