"""Copilot tools for SEC filings (registered in copilot.tools.TOOL_SPECS).

  sec_filings_list         latest 10-K / 10-Q / 8-K filings (dates, accessions, 8-K items)
  sec_filing_passages      verbatim passages + citation objects for a query
  sec_filing_section_diff  added / removed / changed units of a section across the last N filings
  sec_disclosure_extract   one disclosure topic: XBRL values filed in the accession
                           + reconciliation checks + the narrative excerpt

All work is deterministic (no LLM): EDGAR documents -> parsed sections ->
BM25 / diff / regex.  Nothing is estimated; missing data is reported in
``unavailable``.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from app.services.copilot.filings_rag.facts import VERBATIM_NOTE
from app.services.copilot.filings_rag.parse import SECTION_KEYS
from app.services.copilot.models import Fact, compact_fact

logger = logging.getLogger(__name__)

TIMEOUT_S = float(os.getenv("COPILOT_FILINGS_TOOL_TIMEOUT_S", "60"))
VECTOR_TIMEOUT_S = 4.0
MAX_DIFF_FILINGS = 5

_T = {"type": "string", "description": "Ticker, e.g. NVDA"}
_SECTIONS = sorted(k for k in SECTION_KEYS)
_DIFF_SECTIONS = ["risk_factors", "mdna", "business", "market_risk", "legal_proceedings", "cybersecurity",
                  "financial_statements", "controls"]


def _topics() -> List[str]:
    from app.services.copilot.filings_rag.disclosures import TOPICS
    return list(TOPICS)


FILINGS_TOOL_SPECS: List[Dict[str, Any]] = [
    {"name": "sec_filings_list",
     "description": ("Latest SEC filings from EDGAR: form, filing date, period, accession, URL, 8-K items "
                     "(2.02 = earnings)."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T,
         "forms": {"type": "array", "items": {"type": "string", "enum": ["10-K", "10-Q", "8-K"]},
                   "description": "Default all three"},
         "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Per form (default 5)"},
         "earnings_only": {"type": "boolean", "description": "8-Ks with Item 2.02 only"}},
         "required": ["ticker"], "additionalProperties": False}},
    {"name": "sec_filing_passages",
     "description": ("Verbatim passages from a company's SEC filings with citations (form, filing date, "
                     "accession, section, page, URL). EX-99.1 = earnings press releases. Quote `excerpt` exactly."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T, "query": {"type": "string"},
         "forms": {"type": "array", "items": {"type": "string", "enum": ["10-K", "10-Q", "8-K", "EX-99.1"]},
                   "description": "Default 10-K"},
         "filings_back": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Latest N per form (default 1)"},
         "sections": {"type": "array", "items": {"type": "string", "enum": _SECTIONS}},
         "accession": {"type": "string"},
         "limit": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Default 5"}},
         "required": ["ticker", "query"], "additionalProperties": False}},
    {"name": "sec_filing_section_diff",
     "description": ("Diff one section across the last N 10-Ks (or 10-Qs): risk factors / paragraphs added, "
                     "removed, changed, with verbatim excerpts, inserted/deleted phrases, counts and citations."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T,
         "section": {"type": "string", "enum": _DIFF_SECTIONS},
         "form": {"type": "string", "enum": ["10-K", "10-Q"], "description": "Default 10-K"},
         "filings": {"type": "integer", "minimum": 2, "maximum": MAX_DIFF_FILINGS, "description": "Default 3"},
         "max_items": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Per change type (default 8)"}},
         "required": ["ticker", "section"], "additionalProperties": False}},
    {"name": "sec_disclosure_extract",
     "description": ("One disclosure from a filing: XBRL values as filed in that accession, reconciliation "
                     "checks (e.g. lease maturities vs filed total) and the verbatim narrative excerpt. "
                     "guidance reads the earnings 8-K EX-99.1 by default."),
     "input_schema": {"type": "object", "properties": {
         "ticker": _T,
         "topic": {"type": "string", "enum": [
             "customer_concentration", "geographic_revenue", "purchase_commitments",
             "remaining_performance_obligations", "deferred_revenue", "operating_leases", "finance_leases",
             "contractual_obligations", "capex_commitments", "revenue_recognition", "stock_based_compensation",
             "depreciation_useful_lives", "liquidity", "guidance"]},
         "form": {"type": "string", "enum": ["10-K", "10-Q", "8-K"], "description": "Default 10-K"},
         "filings_back": {"type": "integer", "minimum": 1, "maximum": 3, "description": "Default 1"},
         "limit": {"type": "integer", "minimum": 1, "maximum": 8, "description": "Passages (default 4)"}},
         "required": ["ticker", "topic"], "additionalProperties": False}},
]
FILINGS_TOOL_NAMES = {t["name"] for t in FILINGS_TOOL_SPECS}
FILINGS_TOOL_TIMEOUTS = {n: TIMEOUT_S for n in FILINGS_TOOL_NAMES}


def _vector_enabled() -> bool:
    v = os.getenv("COPILOT_FILINGS_VECTOR", "auto").lower()
    if v in ("0", "false", "off"):
        return False
    if v in ("1", "true", "on"):
        return True
    if os.getenv("APP_ENV", "").lower() == "test":
        return False
    try:
        from app.config import settings
        return bool(settings.QDRANT_API_KEY)
    except Exception:
        return False


async def _vector_hits(ticker: str, query: str, forms: List[str]) -> Optional[List[Tuple[str, str]]]:
    """(accession, text) hits from the shared Qdrant hybrid index, or None."""
    if not _vector_enabled():
        return None
    try:
        from app.services.copilot.retrieval import search_filings
        ft = [f for f in forms if f in ("10-K", "10-Q", "8-K")] or None
        hits = await asyncio.wait_for(search_filings(query, [ticker], filing_types=ft, limit=10), VECTOR_TIMEOUT_S)
        return [(h.accession or "", h.text) for h in hits if h.accession]
    except Exception as e:
        logger.info("filings vector leg skipped: %s", e)
        return None


def _payload(ticker: str, company: Optional[str], tool: str, refs, results: List[Fact],
             unavailable: List[str], **extra) -> Dict[str, Any]:
    d: Dict[str, Any] = {"ticker": ticker, "company": company, "tool": tool,
                         "filings_used": [r.short() for r in refs],
                         "results": [compact_fact(f) for f in results]}
    d.update({k: v for k, v in extra.items() if v is not None})
    if any(getattr(f, "kind", "") == "filing_excerpt" for f in results):
        d["excerpt_note"] = VERBATIM_NOTE
    if unavailable:
        d["unavailable"] = unavailable
    return d


def _int(v: Any, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def list_filings(svc, ticker: str, a: Dict[str, Any]):
    forms = [f for f in (a.get("forms") or ["10-K", "10-Q", "8-K"]) if f in ("10-K", "10-Q", "8-K")]
    n = _int(a.get("limit"), 5, 1, 20)
    refs = svc.filings(ticker, forms, n, earnings_only=bool(a.get("earnings_only")))
    if not refs:
        raise LookupError(f"no {', '.join(forms)} filings found for {ticker} in EDGAR submissions")
    from app.services.copilot.filings_rag.facts import FilingListFact
    facts = [FilingListFact.from_ref(r) for r in refs]
    missing = [f for f in forms if not any(r.form == f for r in refs)]
    return facts, _payload(ticker, refs[0].company, "sec_filings_list", [], facts,
                           [f"no {f} filings found in EDGAR submissions" for f in missing])


def passages(svc, ticker: str, a: Dict[str, Any], vector_hits=None):
    from app.services.copilot.filings_rag.retrieve import retrieve, select_docs
    forms = list(a.get("forms") or ["10-K"])
    sel = select_docs(svc, ticker, forms, _int(a.get("filings_back"), 1, 1, 5), a.get("accession"))
    if not sel.docs:
        raise LookupError("; ".join(sel.unavailable) or f"no filings available for {ticker}")
    sections = [s for s in (a.get("sections") or []) if s in SECTION_KEYS] or None
    hits = retrieve(svc, sel, a.get("query") or "", sections=sections, limit=_int(a.get("limit"), 5, 1, 10),
                    vector_hits=vector_hits)
    unavailable = list(sel.unavailable)
    if sections:
        for ld in sel.docs:
            miss = [k for k in sections if ld.section(k) is None and not (ld.exhibit and k == "exhibit")]
            if miss:
                unavailable.append(f"{', '.join(miss)} not found in {ld.form} filed {ld.ref.filing_date} "
                                   f"(sections found: {', '.join(ld.found_sections()) or 'none'})")
    if not hits:
        unavailable.append(f"no passage matched {a.get('query')!r} in the selected filings")
    method = "BM25 (k1=1.2, b=0.75) over section-bounded chunks" + (" fused (RRF) with the Qdrant hybrid index"
                                                                     if vector_hits else "")
    return hits, _payload(ticker, sel.refs[0].company if sel.refs else None, "sec_filing_passages", sel.refs,
                          hits, unavailable, method=method)


def section_diff(svc, ticker: str, a: Dict[str, Any]):
    from app.services.copilot.filings_rag.diff import diff_section
    section = a.get("section") or "risk_factors"
    form = a.get("form") or "10-K"
    n = _int(a.get("filings"), 3, 2, MAX_DIFF_FILINGS)
    refs = svc.filings(ticker, [form], n)
    if len(refs) < 2:
        raise LookupError(f"need at least 2 {form} filings for {ticker}; EDGAR submissions list {len(refs)}")
    docs, unavailable = [], []
    for r in refs:
        try:
            docs.append(svc.load(r))
        except LookupError as e:
            unavailable.append(str(e))
    summaries, units, miss = diff_section(svc, docs, section, max_items=_int(a.get("max_items"), 8, 1, 20))
    unavailable += miss
    if len(refs) < n:
        unavailable.append(f"only {len(refs)} {form} filings are available in EDGAR submissions (asked for {n})")
    if not summaries:
        raise LookupError("; ".join(unavailable) or f"could not compare {section} for {ticker}")
    return [*summaries, *units], _payload(ticker, refs[0].company, "sec_filing_section_diff", refs,
                                          [*summaries, *units], unavailable)


def disclosure(svc, ticker: str, a: Dict[str, Any]):
    from app.services.copilot.filings_rag.disclosures import TOPICS, narrative, run_checks, xbrl_values
    from app.services.copilot.filings_rag.retrieve import select_docs
    topic = TOPICS.get(a.get("topic") or "")
    if topic is None:
        raise LookupError(f"unknown disclosure topic {a.get('topic')!r}; topics: {', '.join(TOPICS)}")
    form = a.get("form") or ("8-K" if topic.key == "guidance" else "10-K")
    forms = ["EX-99.1"] if (form == "8-K" and topic.key == "guidance") else [form]
    sel = select_docs(svc, ticker, forms, _int(a.get("filings_back"), 1, 1, 3))
    if not sel.docs:
        raise LookupError("; ".join(sel.unavailable) or f"no {form} filings available for {ticker}")
    unavailable = list(sel.unavailable)
    values: List[Fact] = []
    checks: List[Fact] = []
    if topic.xbrl and form in ("10-K", "10-Q"):
        facts_json = svc.p.company_facts(svc.cik(ticker))
        if facts_json is None:
            unavailable.append("SEC XBRL companyfacts unavailable; XBRL values not included")
        else:
            for r in sel.refs:
                v = xbrl_values(facts_json, r, topic.xbrl)
                if not v:
                    unavailable.append(f"none of {', '.join(topic.xbrl[:6])}{'...' if len(topic.xbrl) > 6 else ''} "
                                       f"is tagged (non-dimensionally) in {r.form} accession {r.accession}")
                values += v
                checks += run_checks(topic, v)
    excerpts, notes = narrative(svc, sel, topic, _int(a.get("limit"), 4, 1, 8))
    unavailable += notes
    results = [*values, *checks, *excerpts]
    return results, _payload(ticker, sel.refs[0].company if sel.refs else None, "sec_disclosure_extract",
                             sel.refs, results, unavailable, topic=topic.title, limitation=topic.note)


async def run_filings_tool(executor, name: str, a: Dict[str, Any]):
    """Called from ToolExecutor._dispatch.  Returns (facts, payload)."""
    from app.services.copilot.filings_rag.store import get_service
    ticker = a.get("ticker") or ""
    pack = await executor._pack(ticker)
    if pack is None:
        raise LookupError(f"ticker {ticker!r} not found in our symbol universe")
    if pack.asset_type != "equity":
        raise LookupError(f"{pack.ticker} is an {pack.asset_type}; it has no SEC company filings")
    t = pack.ticker
    svc = get_service()
    if name == "sec_filings_list":
        return await asyncio.to_thread(list_filings, svc, t, a)
    if name == "sec_filing_passages":
        vh = await _vector_hits(t, a.get("query") or "", list(a.get("forms") or ["10-K"]))
        return await asyncio.to_thread(passages, svc, t, a, vh)
    if name == "sec_filing_section_diff":
        return await asyncio.to_thread(section_diff, svc, t, a)
    if name == "sec_disclosure_extract":
        return await asyncio.to_thread(disclosure, svc, t, a)
    raise LookupError(f"unhandled tool {name}")
