"""Copilot tools for the valuation engine (app.services.valuation).

Registered into the copilot tool registry (tools.TOOL_SPECS) as
``valuation_*``. Each tool returns one ``ValuationFact`` whose payload holds
the computed result, the inputs with provenance (XBRL tag + accession, quote
time, FRED/Treasury observation date) and an explicit assumptions list, so
the answer can cite every number with ``[val:...]`` ids. Nothing here is
estimated by the LLM: missing inputs raise LookupError with the reason.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
from typing import Any, Dict, List, Literal, Optional, Tuple

import pandas as pd
from pydantic import Field

from app.services.copilot.models import Fact, compact_fact
from app.services.valuation import banks, dcf as D, montecarlo, reverse_dcf as RD, scenarios as SC
from app.services.valuation import wacc as W
from app.services.valuation.data import PRICE_SOURCE, ValuationData
from app.services.valuation.model import (TAX_BOUNDS, BaseCase, MarketInputs, build_base_case, cagr,
                                          effective_tax_rate)
from app.services.valuation.provenance import DataUnavailable, Datum, pct, r

TOOL_TIMEOUT_S = 40.0
ENGINE_SOURCE = "QuantTrade valuation engine (deterministic; inputs: SEC XBRL, canonical quote, FRED/Treasury, daily bars)"


class ValuationFact(Fact):
    kind: Literal["valuation"] = "valuation"
    tool: str
    title: str
    result: Dict[str, Any] = Field(default_factory=dict)
    inputs: Dict[str, Any] = Field(default_factory=dict)
    assumptions: List[Dict[str, Any]] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    headline: Optional[str] = None
    # base-year filing the computation is anchored on (SEC companyfacts "accn"),
    # so the Sources list cites the real accession number
    filing_type: Optional[str] = None
    filed_date: Optional[str] = None
    accession: Optional[str] = None
    period: Optional[str] = None

    def label(self) -> str:
        return f"{self.ticker} {self.title}"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        if self.headline:
            d["snippet"] = self.headline
        return d


# ── schemas ─────────────────────────────────────────────────────────────────
_T = {"type": "string", "description": "Ticker symbol, e.g. MSFT"}
ASSUMPTION_KEYS = {
    "stage1_growth": float, "stage1_years": int, "fade_years": int, "terminal_growth": float,
    "target_operating_margin": float, "sales_to_capital": float, "tax_rate": float, "erp": float, "beta": float,
    "rf": float, "wacc": float, "terminal_method": str, "exit_ev_ebitda": float, "terminal_roic": float,
    "mid_year": bool, "shares_per_adr": float, "beta_frequency": str, "beta_years": int,
    "margin_convergence_years": int, "debt_spread": float, "marginal_tax_rate": float,
    "include_long_term_investments": bool, "beta_adjustment": str}
_ASSUMPTIONS = {"type": "object", "description": (
    "Optional overrides, rates as fractions (0.05=5%): stage1_growth, stage1_years(5), fade_years(5), "
    "terminal_growth, target_operating_margin, sales_to_capital, tax_rate, erp(0.05), beta, rf, wacc, "
    "terminal_method(gordon|exit_multiple), exit_ev_ebitda, terminal_roic, mid_year, shares_per_adr (foreign ADRs), "
    "beta_frequency(weekly|daily|monthly), beta_years(5). Unset values default from filings; the result lists "
    "every assumption.")}
_ASSUMPTIONS_REF = {"type": "object", "description": "Same optional overrides as valuation_dcf.assumptions."}
_SHOCKS = {"type": "object", "description": "Shocks as fractions: " + ", ".join(SC.SHOCKS) +
           " (e.g. reporting_currency_appreciation 0.10 = USD +10%, rate_shock 0.01 = +100bp)."}
_STRUCTURE = {"type": "object", "description": (
    "Structural inputs (fractions): foreign_revenue_share (default: XBRL geographic disclosure), "
    "tariff_exposed_cogs_share (required with tariff_rate), tariff_pass_through(0), foreign_cost_share(0), "
    "hedge_ratio(0), variable_cogs_share(1), floating_rate_debt_share(0), capex_shock_years(3).")}


def _spec(name: str, desc: str, props: Dict[str, Any], required=("ticker",)) -> Dict[str, Any]:
    return {"name": name, "description": desc,
            "input_schema": {"type": "object", "properties": {"ticker": _T, **props}, "required": list(required),
                             "additionalProperties": False}}


VALUATION_TOOL_SPECS: List[Dict[str, Any]] = [
    _spec("valuation_wacc",
          "WACC from data: 10Y Treasury (dated), OLS beta vs SPY (5y weekly, with SE/R^2), ERP assumption, "
          "cost of debt = interest expense / avg debt (XBRL) after tax, market-value weights.",
          {"assumptions": _ASSUMPTIONS_REF}),
    _spec("valuation_dcf",
          "3-stage FCFF DCF on SEC XBRL financials: WACC derivation, year-by-year table, terminal value, "
          "sensitivity matrices (WACC x terminal growth, WACC x revenue growth), vs current price/market cap.",
          {"assumptions": _ASSUMPTIONS}),
    _spec("valuation_reverse_dcf",
          "Reverse DCF: solve the revenue growth, operating margin or sales-to-capital the current price implies "
          "over 10 years; implied path checked vs own history and optional peers.",
          {"solve_for": {"type": "string", "enum": ["stage1_growth", "target_operating_margin", "sales_to_capital"]},
           "peers": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
           "assumptions": _ASSUMPTIONS_REF}),
    _spec("valuation_monte_carlo",
          "Monte Carlo DCF that really runs N seeded simulations (default 10,000) over revenue growth, margin, "
          "WACC, terminal growth: median, p5/p95, P(value < price), seed and distributions.",
          {"n_simulations": {"type": "integer", "minimum": 100, "maximum": 200000}, "seed": {"type": "integer"},
           "distributions": {"type": "object", "description": (
               "per-variable overrides keyed stage1_growth|target_operating_margin|wacc|terminal_growth: "
               "{dist: normal|uniform|triangular|fixed, mean, sd, min, max, mode, value} as fractions")},
           "assumptions": _ASSUMPTIONS_REF}),
    _spec("valuation_scenarios",
          "Scenario engine on the latest FY: FX via disclosed geographic revenue mix, tariffs/cost via COGS, "
          "demand, revenue, margin, opex, capex and rate shocks -> individual and combined EPS and DCF value "
          "impacts. `shocks` = individual+combined; `scenarios` = named cases; `use_default_shocks` = shocks "
          "named without a size (documented default sizes, reported as assumptions). With none of these, a "
          "documented default set runs (USD +10%, demand -5%, COGS +3%, rates +100bp), labelled as assumptions.",
          {"shocks": _SHOCKS,
           "use_default_shocks": {"type": "array", "items": {"type": "string", "enum": sorted(SC.SHOCKS)},
                                  "description": "shock names to run at their documented default size"},
           "scenarios": {"type": "array", "maxItems": 5, "items": {"type": "object", "properties": {
               "name": {"type": "string"}, "rationale": {"type": "string"}, "shocks": _SHOCKS},
               "required": ["name", "shocks"]}},
           "structure": _STRUCTURE, "assumptions": _ASSUMPTIONS_REF}),
    _spec("valuation_bull_bear",
          "Bull/base/bear DCF cases from the company's best/worst historical growth and margins, P/E "
          "compression at historical fiscal-year-end P/E, and largest historical drawdowns.",
          {"overrides": {"type": "object", "description": (
              "{bull|base|bear: {stage1_growth, target_operating_margin, wacc_delta, terminal_growth}} fractions")},
           "assumptions": _ASSUMPTIONS_REF}),
    _spec("valuation_rate_sensitivity",
          "Bank rate sensitivity: disclosed NII sensitivity (+/- shock) from filings with EPS impact, cost of "
          "deposits and AFS/HTM fair values (XBRL); states what is unavailable.",
          {"shock_bp": {"type": "integer", "enum": [25, 50, 100, 200]},
           "deposit_beta": {"type": "number", "description": "assumption, 0-1"},
           "securities_duration_years": {"type": "number", "description": "as disclosed"}}),
]
VALUATION_TOOL_NAMES = {t["name"] for t in VALUATION_TOOL_SPECS}
# tools built on the FCFF DCF: refused for banks (see banks.fcff_not_applicable)
FCFF_TOOLS = {"valuation_dcf", "valuation_reverse_dcf", "valuation_monte_carlo", "valuation_scenarios",
              "valuation_bull_bear"}
_SHORT = {"valuation_wacc": "wacc", "valuation_dcf": "dcf", "valuation_reverse_dcf": "rdcf",
          "valuation_monte_carlo": "mc", "valuation_scenarios": "scen", "valuation_bull_bear": "bbb",
          "valuation_rate_sensitivity": "rates"}
_TITLE = {"valuation_wacc": "WACC derivation", "valuation_dcf": "3-stage DCF", "valuation_reverse_dcf": "reverse DCF",
          "valuation_monte_carlo": "Monte Carlo DCF", "valuation_scenarios": "scenario analysis",
          "valuation_bull_bear": "bull/base/bear cases", "valuation_rate_sensitivity": "interest-rate sensitivity"}


def _fact_id(name: str, ticker: str, args: Dict[str, Any]) -> str:
    extra = {k: v for k, v in args.items() if k != "ticker" and v not in (None, {}, [])}
    fid = f"val:{_SHORT[name]}:{ticker}"
    if extra:
        fid += ":" + hashlib.sha1(json.dumps(extra, sort_keys=True, default=str).encode()).hexdigest()[:6]
    return fid


# ── input assembly ─────────────────────────────────────────────────────────
def _price_datum(quote) -> Optional[Datum]:
    if quote is None or quote.price is None:
        return None
    return Datum(value=float(quote.price), source=quote.source, as_of=quote.quote_time or quote.session_date or quote.as_of,
                 tag=quote.id, unit="USD", formula=(f"regular-session price; session {quote.market_session}"
                                                   if quote.market_session else None))


async def _market(data: ValuationData, ticker: str, fin, quote, p: Dict[str, Any], need_beta: bool = True
                  ) -> Tuple[MarketInputs, Dict[str, Any], Optional[Any]]:
    extra: Dict[str, Any] = {}
    years = int(p.get("beta_years") or 5)
    freq = p.get("beta_frequency") or "weekly"

    async def rf():
        if p.get("rf") is not None:
            return Datum(value=float(p["rf"]), source="caller-supplied", formula="user input")
        return await data.risk_free()

    async def px(t):
        try:
            return await data.prices(t, max(years + 1, 6))
        except DataUnavailable as e:
            extra.setdefault("price_history_errors", []).append(str(e))
            return None

    tasks = [rf(), px(ticker), px("SPY") if need_beta and p.get("beta") is None else _none(),
             data.fx(fin.currency) if fin.currency != "USD" else _none()]
    rf_d, s_px, m_px, fx_d = await asyncio.gather(*tasks)
    beta = None
    if need_beta and p.get("beta") is None:
        if s_px is None or m_px is None:
            raise DataUnavailable(f"{ticker}: daily price history unavailable for the beta regression "
                                  f"({'; '.join(extra.get('price_history_errors', []))}); pass beta explicitly")
        beta = W.regress_beta(s_px, m_px, frequency=freq, years=years, benchmark="SPY", source=PRICE_SOURCE)
    return (MarketInputs(price=_price_datum(quote), rf=rf_d, beta=beta, fx_reporting_per_quote=fx_d,
                         shares_per_adr=p.get("shares_per_adr")), extra, s_px)


async def _none():
    return None


async def build_case(data: ValuationData, ticker: str, quote, p: Dict[str, Any]) -> Tuple[BaseCase, Optional[Any]]:
    fin = await data.financials(ticker)
    market, extra, s_px = await _market(data, ticker, fin, quote, p)
    case = build_base_case(fin, market, p)
    if market.beta is not None:
        case.inputs["beta_regression"] = market.beta.to_dict()
    return case, s_px


def _wacc_block(case: BaseCase) -> Dict[str, Any]:
    w = W.wacc_payload(case.wacc) if case.wacc.get("weight_equity") is not None else {
        "wacc_pct": pct(case.assumptions.wacc), "note": "WACC supplied by caller (no market value of equity)"}
    w["wacc_used_pct"] = pct(case.assumptions.wacc)
    w["cost_of_debt"] = {k: (pct(v) if k in ("pre_tax", "spread", "implied_pre_tax") and isinstance(v, float) else
                             (r(v, 0) if isinstance(v, float) else v))
                         for k, v in (case.wacc.get("cost_of_debt_detail") or {}).items()}
    if case.market.beta is not None:
        w["beta_regression"] = case.market.beta.to_dict()
    w["risk_free"] = case.market.rf.to_dict()
    return w


def _base_meta(case: BaseCase) -> Dict[str, Any]:
    y = case.base_year
    return {"company": case.fin.entity_name, "reporting_currency": case.fin.currency, "taxonomy": case.fin.taxonomy,
            "base_fiscal_year": y.fiscal_year, "base_period_end": y.period_end, "base_form": y.form,
            "base_accession": y.accession, "balance_sheet_date": case.fin.balance_date}


def _grids(case: BaseCase) -> Dict[str, Any]:
    a = case.assumptions
    waccs = D.default_grid(a.wacc, 0.01)
    tgs = D.default_grid(a.terminal_growth, 0.005)
    gs = D.default_grid(a.stage1_growth, 0.025)
    return {"wacc_x_terminal_growth": D.sensitivity(case.revenue0, a, case.bridge, "wacc", waccs, "terminal_growth", tgs),
            "wacc_x_revenue_growth": D.sensitivity(case.revenue0, a, case.bridge, "wacc", waccs, "stage1_growth", gs)}


def _clean_assumptions(raw: Any) -> Dict[str, Any]:
    if not raw:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("assumptions must be an object")
    out: Dict[str, Any] = {}
    for k, v in raw.items():
        typ = ASSUMPTION_KEYS.get(k)
        if typ is None:
            raise ValueError(f"unknown assumption {k!r}; allowed: {sorted(ASSUMPTION_KEYS)}")
        if v is None:
            continue
        if typ is bool:
            out[k] = bool(v)
        elif typ is str:
            out[k] = str(v)
        else:
            try:
                out[k] = typ(v)
            except (TypeError, ValueError):
                raise ValueError(f"assumption {k} must be a number") from None
            if typ is float and not math.isfinite(out[k]):
                raise ValueError(f"assumption {k} must be finite")
    if out.get("terminal_method") not in (None, "gordon", "exit_multiple"):
        raise ValueError("terminal_method must be gordon or exit_multiple")
    if out.get("beta_frequency") not in (None, "weekly", "daily", "monthly"):
        raise ValueError("beta_frequency must be weekly, daily or monthly")
    return out


# ── dispatch ───────────────────────────────────────────────────────────────
async def run_valuation_tool(executor, name: str, args: Dict[str, Any]):
    ticker = args.get("ticker") or ""
    pack = await executor._pack(ticker)
    if pack is None:
        raise LookupError(f"ticker {ticker!r} not found in our symbol universe")
    t = pack.ticker
    if pack.asset_type != "equity":
        raise LookupError(f"{t} is an {pack.asset_type}; valuation tools need an operating company's SEC filings")
    data = getattr(executor.sources, "valuation_data", None) or ValuationData(executor.sources)
    try:
        p = _clean_assumptions(args.get("assumptions"))
    except ValueError as e:
        raise LookupError(f"{name}: invalid input - {e}") from None
    try:
        fact = await _run(name, data, pack, p, args)
    except DataUnavailable as e:
        raise LookupError(f"{name}: data unavailable - {e}") from None
    except ValueError as e:
        raise LookupError(f"{name}: invalid input - {e}") from None
    fact.id = _fact_id(name, t, args)
    facts: List[Fact] = [fact] + ([pack.quote] if pack.quote is not None else [])
    return facts, compact_fact(fact)


async def _run(name: str, data: ValuationData, pack, p: Dict[str, Any], args: Dict[str, Any]) -> ValuationFact:
    t = pack.ticker
    quote = pack.quote
    title = _TITLE[name]
    def mk(result, case=None, headline=None, assumptions=None, warnings=None, inputs=None, year=None):
        y = year if year is not None else (case.base_year if case else None)
        return ValuationFact(
            id="", source=ENGINE_SOURCE, as_of=(quote.session_date or quote.as_of) if quote else None, ticker=t,
            tool=name, title=title, result=result,
            inputs=inputs if inputs is not None else (case.inputs if case else {}),
            assumptions=(case.log.to_list() if case else []) + (assumptions or []),
            warnings=(case.warnings if case else []) + (warnings or []), headline=headline,
            filing_type=getattr(y, "form", None), filed_date=getattr(y, "filed", None),
            accession=getattr(y, "accession", None),
            period=(f"FY{y.fiscal_year} (ended {y.period_end})" if y is not None else None))

    if name == "valuation_rate_sensitivity":
        fin = await data.financials(t)
        shock = int(args.get("shock_bp") or 100)
        chunks = await data.filings(t, banks.NII_QUERY, filing_types=["10-K", "10-Q"], limit=6)
        eff, _ = effective_tax_rate(fin)
        tax = eff if eff is not None and TAX_BOUNDS[0] <= eff <= TAX_BOUNDS[1] else W.DEFAULT_MARGINAL_TAX
        res = banks.rate_sensitivity(fin, chunks, shock, args, tax)
        res["meta"] = {"company": fin.entity_name, "fiscal_year": fin.latest.fiscal_year, "period_end": fin.latest.period_end,
                       "accession": fin.latest.accession, "tax_rate_pct": pct(tax),
                       "diluted_shares": fin.latest.get("shares_diluted")}
        head = None
        dn = res.get("disclosed_nii_sensitivity")
        if dn:
            head = (f"+{shock}bp: NII change {dn['up']['nii_change']} (EPS {dn['up']['eps_impact']}); "
                    f"-{shock}bp: NII change {dn['down']['nii_change']} (EPS {dn['down']['eps_impact']})")
        return mk(res, headline=head, assumptions=res.pop("assumptions"), inputs={}, year=fin.latest)

    if name in FCFF_TOOLS:
        prof = banks.bank_profile(await data.financials(t))
        if prof is not None:
            raise LookupError(banks.fcff_not_applicable(t, name, prof))

    case, s_px = await build_case(data, t, quote, p)
    meta = _base_meta(case)
    a = case.assumptions

    if name == "valuation_wacc":
        w = _wacc_block(case)
        res = {"meta": meta, "wacc": w}
        bank_warn = None
        if banks.bank_profile(case.fin) is not None:
            bank_warn = [f"{t} is a bank: WACC (and the debt weight) is not meaningful for valuing it; use the "
                         "cost of equity (CAPM) in an excess-return model instead"]
        return mk(res, case, headline=f"WACC {w['wacc_pct']}% (Ke {w.get('cost_of_equity_pct')}%, beta {w.get('beta_used')})",
                  warnings=bank_warn)

    if name == "valuation_dcf":
        d = D.run_dcf(case.revenue0, a, case.bridge, case.base_year.fiscal_year)
        res = {"meta": meta, "wacc": _wacc_block(case), "assumptions_used": a.to_dict(), **d,
               "sensitivity": _grids(case), "history": case.history}
        vm = d.get("vs_market") or {}
        head = f"DCF value {d['value_per_share']} per share" + (
            f" vs price {vm['price']} ({vm['upside_downside_pct']:+}%)" if vm else "")
        return mk(res, case, headline=head)

    if name == "valuation_reverse_dcf":
        solve_for = args.get("solve_for") or "stage1_growth"
        if "stage1_years" not in p and "fade_years" not in p:
            p2 = {**p, "stage1_years": 10, "fade_years": 0}
            case = build_base_case(case.fin, case.market, p2)
            if case.market.beta is not None:
                case.inputs["beta_regression"] = case.market.beta.to_dict()
            case.log.add("horizon", "10 explicit years, then terminal", "reverse-DCF default: solve over a 10-year horizon")
            a = case.assumptions
        peers = await _peer_bounds(data, args.get("peers") or [])
        res = RD.reverse_dcf(case.revenue0, a, case.bridge, solve_for, case.base_year.fiscal_year, case.history, peers)
        res = {"meta": meta, "wacc": _wacc_block(case), "assumptions_used": a.to_dict(), **res, "history": case.history}
        sol = res.get("solution")
        head = (f"Price implies {solve_for} = {sol['value_pct'] if sol.get('value_pct') is not None else sol['value']}"
                f"{'%' if sol.get('value_pct') is not None else ''}") if sol else "No solution in range"
        return mk(res, case, headline=head)

    if name == "valuation_monte_carlo":
        n = int(args.get("n_simulations") or montecarlo.DEFAULT_N)
        seed = args.get("seed")
        seed = montecarlo.DEFAULT_SEED if seed is None else int(seed)
        sim = await asyncio.to_thread(montecarlo.simulate, case.revenue0, a, case.bridge, n=n, seed=seed,
                                      distributions=args.get("distributions"), price=case.bridge.price)
        point = D.run_dcf(case.revenue0, a, case.bridge, case.base_year.fiscal_year)
        res = {"meta": meta, "wacc": _wacc_block(case), "assumptions_used": a.to_dict(), "simulation": sim,
               "point_estimate_value_per_share": point["value_per_share"]}
        v = sim["value_per_share"]
        head = (f"{sim['n_valid']} simulations (seed {seed}): median {v['median']}, p5 {v['p5']}, p95 {v['p95']}"
                + (f", P(value < price) {sim['prob_value_below_price_pct']}%" if "prob_value_below_price_pct" in sim else ""))
        return mk(res, case, headline=head, assumptions=[{
            "name": "monte_carlo_distributions", "value": sim["distributions"], "kind": "assumption",
            "rationale": "default spreads around the base case (growth sd 5pp, margin sd 3pp, WACC sd 1pp, terminal "
                         "growth sd 0.5pp, independent) unless overridden"}])

    if name == "valuation_scenarios":
        named = args.get("scenarios") or None
        structure = args.get("structure") or {}
        if not isinstance(structure, dict):
            raise ValueError("structure must be an object")
        bad = set(structure) - set(SC.STRUCTURAL_DEFAULTS)
        if bad:
            raise ValueError(f"unknown structure keys {sorted(bad)}; allowed: {sorted(SC.STRUCTURAL_DEFAULTS)}")
        shocks, defaulted, skipped = _resolve_shocks(args.get("shocks"), args.get("use_default_shocks"), named,
                                                     structure)
        need_geo = any((sc or {}).get("reporting_currency_appreciation") for sc in
                       [shocks or {}] + [s.get("shocks") or {} for s in (named or [])])
        geo = (await data.geo_mix(t, case.fin)
               if need_geo and structure.get("foreign_revenue_share") is None else None)
        if (shocks.get("reporting_currency_appreciation") and "reporting_currency_appreciation" in defaulted
                and structure.get("foreign_revenue_share") is None and not (geo or {}).get("foreign_share")):
            # a defaulted FX shock with no disclosed geographic mix is dropped, not failed
            shocks.pop("reporting_currency_appreciation")
            defaulted.pop("reporting_currency_appreciation")
            skipped.append("reporting_currency_appreciation: no geographic revenue split in the latest annual XBRL "
                           "filing, so the FX shock was not computed (pass structure.foreign_revenue_share)")
        if not shocks and not named:
            raise ValueError("no computable shock: " + "; ".join(skipped) if skipped else "pass shocks and/or scenarios")
        sp = {k: structure.get(k) for k in SC.STRUCTURAL_DEFAULTS}
        res = SC.run_scenarios(case, shocks or None, named, sp, geo)
        if geo:
            res["geographic_revenue_mix"] = geo
        extra_assumptions = res.pop("assumptions")
        if defaulted:
            res["default_shocks_applied"] = {k: v for k, (v, _) in defaulted.items()}
            extra_assumptions = [{"name": f"shock_size:{k}", "value": v, "kind": "assumption",
                                  "rationale": f"ASSUMPTION (documented default; the question gave no size): {why}"}
                                 for k, (v, why) in defaulted.items()] + extra_assumptions
        if skipped:
            res["shocks_not_computed"] = skipped
        res = {"meta": meta, "wacc": _wacc_block(case), **res}
        head = None
        if res.get("combined"):
            c = res["combined"]
            head = f"Combined EPS change {c['eps_change']} ({c['eps_change_pct']}%) vs FY{meta['base_fiscal_year']} EPS"
        elif res.get("scenarios"):
            head = "; ".join(f"{x['scenario']}: EPS {x['eps_change_pct']}%, DCF value {x['value_change_pct']}%"
                             for x in res["scenarios"])
        return mk(res, case, headline=head, assumptions=extra_assumptions, warnings=skipped or None)

    if name == "valuation_bull_bear":
        dd = SC.drawdown_periods(s_px) if s_px is not None else None
        pe = _pe_history(case, s_px) if s_px is not None else None
        res = SC.bull_base_bear(case, args.get("overrides"), dd, pe)
        res = {"meta": meta, "wacc": _wacc_block(case), **res, "history": case.history}
        if dd:
            res["historical_stress"]["source"] = PRICE_SOURCE
        head = "; ".join(f"{c['case']} {c['value_per_share']}" for c in res["cases"])
        return mk(res, case, headline=head)

    raise LookupError(f"unhandled tool {name}")


def _resolve_shocks(raw_shocks: Any, use_default: Any, named: Any, structure: Dict[str, Any]
                    ) -> Tuple[Dict[str, float], Dict[str, Tuple[float, str]], List[str]]:
    """Explicit shocks + documented defaults for shocks named without a size;
    the default scenario set when nothing at all is given. Returns
    (shocks, {defaulted key: (size, rationale)}, [not computed: reason])."""
    if raw_shocks is not None and not isinstance(raw_shocks, dict):
        raise ValueError("shocks must be an object of fractions")
    shocks: Dict[str, float] = {}
    for k, v in (raw_shocks or {}).items():
        if k not in SC.SHOCKS:
            raise ValueError(f"unknown shock {k!r}; allowed: {sorted(SC.SHOCKS)}")
        try:
            shocks[k] = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"shock {k} must be a number (fraction)") from None
    want = list(use_default or [])
    if not isinstance(want, list):
        raise ValueError("use_default_shocks must be a list of shock names")
    if not shocks and not named and not want:
        want = list(SC.DEFAULT_SCENARIO_SET)
    defaulted: Dict[str, Tuple[float, str]] = {}
    skipped: List[str] = []
    for k in want:
        if k not in SC.DEFAULT_SHOCK_SIZES:
            raise ValueError(f"unknown shock {k!r}; allowed: {sorted(SC.DEFAULT_SHOCK_SIZES)}")
        if k in shocks:
            continue
        if k == "tariff_rate" and structure.get("tariff_exposed_cogs_share") is None:
            skipped.append("tariff_rate: the share of COGS subject to the tariff is not disclosed in XBRL, so the "
                           "tariff shock was not computed (pass structure.tariff_exposed_cogs_share)")
            continue
        size, why = SC.DEFAULT_SHOCK_SIZES[k]
        shocks[k] = size
        defaulted[k] = (size, why)
    return shocks, defaulted, skipped


def _pe_history(case: BaseCase, prices) -> List[Dict[str, Any]]:
    out = []
    latest_sh = case.base_year.get("shares_diluted")
    for y in case.fin.years[-6:]:
        eps = y.get("eps_diluted")
        if eps is None or eps <= 0:
            continue
        sh = y.get("shares_diluted")
        if latest_sh and sh and (latest_sh / sh > 1.5 or latest_sh / sh < 0.67):
            out.append({"fiscal_year": y.fiscal_year, "pe": None,
                        "note": "share count changed >50% vs latest FY (likely split); EPS basis not comparable"})
            continue
        s = prices[prices.index <= y.period_end]
        if s.empty or prices.index.min() > pd.Timestamp(y.period_end):
            continue
        close = float(s.iloc[-1])
        out.append({"fiscal_year": y.fiscal_year, "period_end": y.period_end, "close": r(close, 2),
                    "close_date": s.index[-1].date().isoformat(), "eps_diluted": eps, "pe": r(close / eps, 2)})
    if out:
        out.append({"note": "closes are split- and dividend-adjusted (yfinance), which slightly understates "
                            "historical P/E for dividend payers"})
    return out


async def _peer_bounds(data: ValuationData, peers: List[str]) -> List[Dict[str, Any]]:
    async def one(tk: str):
        try:
            fin = await data.financials(tk)
        except Exception as e:
            return {"ticker": tk.upper(), "error": str(e)[:160]}
        y = fin.latest
        s = fin.series("revenue")
        g = cagr(s[-6][1], s[-1][1], 5) if len(s) >= 6 else None
        m = y.get("operating_income") / y.get("revenue") if y.get("operating_income") is not None and y.get("revenue") else None
        return {"ticker": fin.ticker, "fiscal_year": y.fiscal_year, "accession": y.accession,
                "operating_margin_pct": pct(m), "revenue_cagr_5y_pct": pct(g)}

    return list(await asyncio.gather(*[one(tk) for tk in peers[:4]])) if peers else []
