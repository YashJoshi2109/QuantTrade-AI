"""Copilot tools backed by the fundamentals engine (app.services.fundamentals).

Registered into ``app.services.copilot.tools`` (TOOL_SPECS / ToolExecutor).
Every number in a result is computed deterministically from SEC XBRL
companyfacts (with accession numbers and filing dates) or from a named market
data source (quote cache, fundamentals table, FRED); formulas, assumptions and
unavailable items are returned with the numbers.
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional, Tuple

from app.services.copilot.models import Fact, MacroFact
from app.services.fundamentals import analysis as A
from app.services.fundamentals.provider import live_data
from app.services.fundamentals.wacc import DEFAULT_ERP_PCT, wacc_provider

TOOL_TIMEOUT_S = 25.0      # companyfacts for several companies can take a few seconds each

_T = {"type": "string"}
_YEARS = {"type": "integer", "minimum": 2, "maximum": 10}     # fiscal years shown, default 5

TOOL_SPECS: List[Dict[str, Any]] = [
    {"name": "get_financial_history",
     "description": ("Normalised 1-10y annual or quarterly income statement, balance sheet, cash flow from SEC "
                     "XBRL, with filing accession per period and restatement notes."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "period": {"type": "string", "enum": ["annual", "quarterly"]},
         "years": {"type": "integer", "minimum": 1, "maximum": 10},
         "statement": {"type": "string", "enum": ["all", "income", "balance", "cashflow"]}},
         "required": ["ticker"], "additionalProperties": False}},
    {"name": "analyze_earnings_quality",
     "description": ("Forensic accounting (SEC XBRL): net income vs OCF, balance-sheet and cash-flow accrual "
                     "ratios, DSO/DIO/DPO/CCC, Beneish M, SBC, earnings-quality flags."),
     "input_schema": {"type": "object", "properties": {"ticker": _T, "years": _YEARS},
                      "required": ["ticker"], "additionalProperties": False}},
    {"name": "analyze_capital_efficiency",
     "description": ("ROIC vs WACC, incremental ROIC, reinvestment, DuPont with ROE-change attribution, margins, "
                     "capex/D&A intensity, buyback vs dilution split of EPS growth. CAPM WACC unless wacc_pct given."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "years": _YEARS,
         "wacc_pct": {"type": "number"}, "cost_of_debt_pct": {"type": "number"},
         "equity_risk_premium_pct": {"type": "number", "description": "default 5.0"},
         "include_operating_leases": {"type": "boolean"}},
         "required": ["ticker"], "additionalProperties": False}},
    {"name": "dupont_analysis",
     "description": "DuPont 3- and 5-step ROE decomposition (SEC XBRL) for 1-4 companies, with balance-sheet distortion flags.",
     "input_schema": {"type": "object", "properties": {
         "tickers": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4}, "years": _YEARS},
         "required": ["tickers"], "additionalProperties": False}},
    {"name": "assess_financial_distress",
     "description": ("Altman Z and Z'' (with applicability), Piotroski F (all 9 signals), Beneish M, interest "
                     "coverage, liquidity ratios, XBRL debt maturity schedule, FCF sustainability."),
     "input_schema": {"type": "object", "properties": {"ticker": _T, "years": _YEARS},
                      "required": ["ticker"], "additionalProperties": False}},
    {"name": "compare_peer_fundamentals",
     "description": ("Peer table (2-6): EV/EBITDA, P/E, forward P/E, FCF yield, ROIC, gross margin, revenue growth, "
                     "capex intensity, operating leverage, FCF conversion, dilution; normalisation notes, rank + sensitivity."),
     "input_schema": {"type": "object", "properties": {
         "tickers": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6},
         "weights": {"type": "object", "description": "metric weights, e.g. {\"roic_pct\": 2}",
                     "additionalProperties": {"type": "number"}}},
         "required": ["tickers"], "additionalProperties": False}},
]
TOOL_NAMES = {t["name"] for t in TOOL_SPECS}

_LABEL = {"history": "financial history", "quality": "earnings quality", "capital": "capital efficiency",
          "dupont": "DuPont", "distress": "distress assessment", "peer": "peer metrics", "peer_rank": "peer ranking"}


class FundamentalAnalysisFact(Fact):
    kind: Literal["fundamental_analysis"] = "fundamental_analysis"
    analysis: str
    data: Dict[str, Any]

    def label(self) -> str:
        span = ""
        ps = self.data.get("periods") or []
        if ps:
            span = f" {ps[0].get('period')}-{ps[-1].get('period')}"
        who = self.ticker or ",".join(self.data.get("tickers") or [])
        return f"{who} {_LABEL.get(self.analysis, self.analysis)}{span} (SEC XBRL)"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d["snippet"] = "Computed from SEC XBRL companyfacts" + (
            f"; {len(self.data.get('unavailable') or [])} item(s) unavailable" if self.data.get("unavailable") else "")
        return d


def _fact(analysis: str, ticker: Optional[str], payload: Dict[str, Any], key: Optional[str] = None) -> FundamentalAnalysisFact:
    ps = payload.get("periods") or []
    as_of = ps[-1].get("end") if ps else None
    fid = f"fa:{analysis}:{key or ticker}"
    return FundamentalAnalysisFact(id=fid, source=A.SOURCE, as_of=as_of, ticker=ticker, analysis=analysis,
                                   data=payload)


def _years(a: Dict[str, Any], default: int = 5, lo: int = 1) -> int:
    try:
        return max(lo, min(10, int(a.get("years") or default)))
    except (TypeError, ValueError):
        return default


PackFn = Callable[[str], Awaitable[Any]]


async def _load(t: str, pack: PackFn, data) -> Tuple[Any, Any]:
    p = await pack(t)
    if p is None:
        raise LookupError(f"ticker {t!r} not found in our symbol universe")
    if getattr(p, "asset_type", "equity") != "equity":
        raise LookupError(f"{p.ticker} is an {p.asset_type}; it has no SEC financial statements")
    st = await data.statements(p.ticker)
    if st is None:
        raise LookupError(f"no SEC XBRL companyfacts for {p.ticker} (CIK not found or EDGAR unavailable)")
    return p, st


async def _market(p, st, data, *, need_fx: bool = True) -> A.MarketInputs:
    m = A.MarketInputs()
    q, f = getattr(p, "quote", None), getattr(p, "fundamentals", None)
    if q is not None and q.price:
        m.price, m.price_source, m.price_as_of = q.price, f"{q.id}: {q.source}", q.quote_time or q.as_of
    if f is not None:
        if f.beta is not None:
            m.beta, m.beta_source = f.beta, f"{f.id}: {f.source} (provider beta)"
        if f.forward_pe is not None:
            m.forward_pe, m.forward_pe_source = f.forward_pe, f"{f.id}: {f.source}"
    A.resolve_market_cap(st, m, f.market_cap if f is not None else None,
                         f"{f.id}: {f.source}" if f is not None else None, f.as_of if f is not None else None)
    if need_fx and st.currency != "USD":
        try:
            fx = await data.fx_usd_per_unit(st.currency)
        except Exception as e:          # FX is optional: the tool says what it could not compute
            fx = None
            m.notes.append(f"FX lookup failed ({type(e).__name__})")
        if fx:
            m.fx_usd_per_unit, m.fx_source, m.fx_as_of = fx["rate"], fx["source"], fx.get("as_of")
        else:
            m.notes.append(f"no {st.currency}->USD rate available; USD-based multiples not computed")
    return m


async def _risk_free(sources, m: A.MarketInputs) -> Optional[MacroFact]:
    macro = getattr(sources, "macro", None)
    if macro is None:
        return None
    try:
        facts = await macro(["10Y_YIELD"])
    except Exception:
        facts = []
    f = next((x for x in facts or [] if x.value is not None), None)
    if f is not None:
        m.risk_free_pct, m.risk_free_source, m.risk_free_as_of = f.value, f"{f.id}: {f.source}", f.observation_date
    return f


async def dispatch(name: str, a: Dict[str, Any], *, pack: PackFn, sources) -> Tuple[List[Fact], Any]:
    data = getattr(sources, "fundamentals_data", None) or live_data()

    if name == "get_financial_history":
        p, st = await _load(a.get("ticker") or "", pack, data)
        period = a.get("period") if a.get("period") in ("annual", "quarterly") else "annual"
        statement = a.get("statement") if a.get("statement") in ("all", "income", "balance", "cashflow") else "all"
        payload = A.history_payload(st, period, _years(a, 5), statement)
        if payload.get("error"):
            raise LookupError(payload["error"])
        f = _fact("history", st.ticker, payload, key=f"{st.ticker}:{period}")
        return [f], payload

    if name == "analyze_earnings_quality":
        p, st = await _load(a.get("ticker") or "", pack, data)
        payload = A.earnings_quality_payload(st, _years(a, 5, 2))
        if payload.get("error"):
            raise LookupError(payload["error"])
        return [_fact("quality", st.ticker, payload)], payload

    if name == "analyze_capital_efficiency":
        p, st = await _load(a.get("ticker") or "", pack, data)
        m = await _market(p, st, data)
        extra: List[Fact] = []
        external = None
        wacc_override = A.safe_float(a.get("wacc_pct"))
        if wacc_override is None:
            prov = wacc_provider()
            if prov is not None:
                try:
                    external = await prov(st.ticker)
                except Exception:
                    external = None
            if external is None:
                rf = await _risk_free(sources, m)
                if rf is not None:
                    extra.append(rf)
        erp = A.safe_float(a.get("equity_risk_premium_pct"))
        payload = A.capital_efficiency_payload(
            st, _years(a, 5, 2), m, wacc_pct=wacc_override,
            erp_pct=erp if erp is not None else DEFAULT_ERP_PCT,
            include_operating_leases=bool(a.get("include_operating_leases")), external_wacc=external,
            cost_of_debt_pct=A.safe_float(a.get("cost_of_debt_pct")))
        if payload.get("error"):
            raise LookupError(payload["error"])
        return [_fact("capital", st.ticker, payload), *extra], payload

    if name == "dupont_analysis":
        tickers = list(dict.fromkeys(a.get("tickers") or []))[:4]
        if not tickers:
            raise LookupError("dupont_analysis needs at least one ticker")
        loaded = await asyncio.gather(*[_load(t, pack, data) for t in tickers], return_exceptions=True)
        facts, out = [], []
        for t, res in zip(tickers, loaded):
            if isinstance(res, Exception):
                out.append({"ticker": t, "error": str(res) if isinstance(res, LookupError) else f"unavailable ({type(res).__name__})"})
                continue
            _, st = res
            payload = A.dupont_payload(st, _years(a, 5, 2))
            out.append(payload)
            if not payload.get("error"):
                facts.append(_fact("dupont", st.ticker, payload))
        if not facts:
            raise LookupError("; ".join(o.get("error", "") for o in out))
        return facts, out

    if name == "assess_financial_distress":
        p, st = await _load(a.get("ticker") or "", pack, data)
        m = await _market(p, st, data)
        try:
            sub = await data.submissions(st.ticker) or {}
        except Exception:
            sub = {}
        payload = A.distress_payload(st, _years(a, 5, 2), m, sub.get("sic"), sub.get("sicDescription"))
        if not sub.get("sic"):
            payload.setdefault("unavailable", []).append("SIC code (SEC submissions) unavailable: Altman model "
                                                         "applicability not determined")
        if payload.get("error"):
            raise LookupError(payload["error"])
        return [_fact("distress", st.ticker, payload)], payload

    if name == "compare_peer_fundamentals":
        tickers = list(dict.fromkeys(a.get("tickers") or []))[:6]
        if len(tickers) < 2:
            raise LookupError("compare_peer_fundamentals needs 2-6 tickers")
        loaded = await asyncio.gather(*[_load(t, pack, data) for t in tickers], return_exceptions=True)
        rows, errors, facts = [], [], []
        for t, res in zip(tickers, loaded):
            if isinstance(res, Exception):
                errors.append({"ticker": t, "error": str(res) if isinstance(res, LookupError) else f"unavailable ({type(res).__name__})"})
                continue
            p, st = res
            m = await _market(p, st, data)
            row = A.peer_row(st, m)
            if m.notes:
                row["notes"].extend(m.notes)
            rows.append(row)
            facts.append(_fact("peer", st.ticker, {**row, "periods": [st.annual[-1].ref()] if st.annual else []}))
        if len(rows) < 2:
            raise LookupError("fewer than two peers have SEC XBRL data: " + "; ".join(e["error"] for e in errors))
        ranking = A.peer_ranking(rows, a.get("weights") if isinstance(a.get("weights"), dict) else None)
        key = "-".join(r["ticker"] for r in rows)
        rank_payload = {"tickers": [r["ticker"] for r in rows], **ranking,
                        "normalisation_notes": A.peer_normalisation_notes(rows)}
        facts.append(_fact("peer_rank", None, rank_payload, key=key))
        return facts, {"rows": rows, "ranking": rank_payload, "errors": errors or None}

    raise LookupError(f"unhandled tool {name}")
