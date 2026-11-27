"""SEC filings RAG: parsing, sectioning, verbatim excerpts, BM25 math, diffs,
XBRL disclosures and the copilot tool wiring.  No network: a fake EDGAR
provider serves synthetic Workiva-style filings (tests/copilot/filings_fixtures.py).
"""
import asyncio
import json
import math
import re

import pytest

from app.services.copilot.filings_rag import edgar
from app.services.copilot.filings_rag import tools as FT
from app.services.copilot.filings_rag.disclosures import TOPICS, run_checks, xbrl_values
from app.services.copilot.filings_rag.edgar import EdgarClient, _Throttle, filing_refs, parse_filing_index
from app.services.copilot.filings_rag.index import BM25Index, chunk_section
from app.services.copilot.filings_rag.parse import (render_html, render_text, sentence_spans, split_sections,
                                                    verify_excerpt)
from app.services.copilot.filings_rag.store import FilingsService

from . import filings_fixtures as F


@pytest.fixture
def fake():
    p = F.FakeEdgar()
    edgar.set_provider(p)
    yield p
    edgar.set_provider(None)


@pytest.fixture
def svc(fake):
    return FilingsService(fake)


def _ws(s: str) -> str:
    return " ".join(s.split())


def _visible_text(html: str) -> str:
    """Independent rendering (BeautifulSoup get_text) of the visible filing text."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    for t in soup.find_all(style=re.compile("display:none")):
        t.decompose()
    return _ws(soup.get_text(" "))


def _assert_verbatim(svc, facts):
    """Every excerpt is the exact slice of the parsed document and its words
    appear, in order, in an independent rendering of the raw filing."""
    n = 0
    for f in facts:
        if getattr(f, "kind", "") != "filing_excerpt":
            continue
        ref = next(r for r in svc.filings(F.TICKER, ["10-K", "10-Q", "8-K"], 10) if r.accession == f.accession)
        ld = svc.load(ref, f.document, exhibit=f.exhibit)
        assert verify_excerpt(ld.doc, f.char_start, f.char_end, f.excerpt), f.id
        raw = F.FakeEdgar().docs[(f.accession, f.document)].decode()
        for line in f.excerpt.split("\n"):
            if not re.search(r"\$\d|\(\d", line):          # table cells are joined differently
                assert _ws(line) in _visible_text(raw), line
        for s in f.matched_sentences or []:
            assert s in ld.doc.text
        n += 1
    return n


# ── parsing ──────────────────────────────────────────────────────────────────

def test_render_drops_hidden_xbrl_keeps_structure():
    doc = render_html(F.tenk_html(2025))
    assert "HIDDEN-XBRL-HEADER-TEXT" not in doc.text
    lines = [doc.line(i) for i in range(doc.n_lines)]
    i = lines.index("Item 1A. Risk Factors")
    assert doc.line_emph[i] and not doc.line_emph[i + 1]
    assert "Our business depends on our ability to receive consistent wafer supply." in lines
    # table cells: "$" + "1,000" and "(1,000" + ")" are one value
    assert "Fiscal Year 2026 $1,000" in lines and "Less imputed interest $(1,000)" in lines
    # anchors at headings, page breaks with printed page numbers
    assert (doc.line_starts[i], "i_1a") in doc.anchors
    assert doc.page_at(doc.line_starts[i]) == (3, "2")
    assert doc.page_at(0) == (1, "i")
    # page numbers are page furniture, never section content
    assert all(doc.line(j) in ("i", "1", "2", "3", "4") for j in doc.furniture)


def test_render_text_and_sentence_spans_are_verbatim():
    doc = render_text("Item 1. Business\n\nWe sell chips in the U.S. and abroad. Revenue rose 12%. Inc. is fine.\n")
    assert doc.n_lines == 2
    a, b = doc.line_starts[1], doc.line_end(1)
    spans = sentence_spans(doc.text, a, b)
    sents = [doc.text[x:y] for x, y in spans]
    assert sents == ["We sell chips in the U.S. and abroad.", "Revenue rose 12%.", "Inc. is fine."]


def test_split_sections_10k_skips_toc_and_finds_items():
    doc = render_html(F.tenk_html(2024))
    secs = {s.key: s for s in split_sections(doc, "10-K")}
    assert {"I-1", "I-1A", "II-7", "II-7A", "II-8", "II-9A"} <= set(secs)
    rf = secs["I-1A"]
    body = doc.text[rf.start:rf.end]
    assert body.startswith("Item 1A. Risk Factors") and "Export controls restrict" in body
    assert "Item 1B" not in body and rf.anchor == "i_1a" and rf.label == "Part I, Item 1A. Risk Factors"
    # the table-of-contents row "Item 1A. Risk Factors 2" is not the section
    assert rf.start > doc.text.index("Item 1A. Risk Factors 2")


def test_split_sections_10q_parts_and_8k_items():
    q = {s.key: s for s in split_sections(render_html(F.tenq_html()), "10-Q")}
    assert {"I-1", "I-2", "I-3", "II-1", "II-1A", "II-6"} <= set(q)
    assert q["I-2"].title.startswith("Management's Discussion")
    assert q["II-1A"].title == "Risk Factors"            # Part II Item 1A, not Part I Item 1
    e = {s.key: s for s in split_sections(render_html(F.eightk_html()), "8-K")}
    assert set(e) == {"2.02", "9.01"} and e["2.02"].title == "Results of Operations and Financial Condition"


def test_chunks_are_section_bounded_contiguous_spans():
    doc = render_html(F.tenk_html(2025))
    for sec in split_sections(doc, "10-K"):
        for c in chunk_section(doc, sec, max_words=40):
            assert sec.start <= c.start < c.end <= sec.end
            assert c.section is sec
            assert doc.text[c.start:c.end].split("\n")[-1] not in ("1", "2", "3", "4")   # no page numbers


# ── EDGAR access ─────────────────────────────────────────────────────────────

def test_filing_refs_merge_older_pages_and_filter(fake, svc):
    refs = svc.filings(F.TICKER, ["10-K"], 3)
    assert [r.accession for r in refs] == [F.ACC_K25, F.ACC_K24, F.ACC_K23]   # oldest from page 001
    assert ("older", f"CIK{F.CIK}-submissions-001.json") in fake.calls
    earn = svc.filings(F.TICKER, ["8-K"], 5, earnings_only=True)
    assert [r.accession for r in earn] == [F.ACC_8K_EARN]
    r = refs[0]
    assert r.doc_url() == "https://www.sec.gov/Archives/edgar/data/42/000000004225000013/fx-20250126.htm"
    sub, _ = F.submissions()
    assert all(x.form == "10-Q" for x in filing_refs(F.TICKER, F.CIK, sub, ["10-Q"]))


def test_parse_filing_index_exhibits():
    rows = parse_filing_index(F.EIGHTK_INDEX)
    assert [(r["document"], r["type"]) for r in rows] == [
        ("fx-20250528.htm", "8-K"), ("fx-ex991.htm", "EX-99.1"), ("logo.jpg", "GRAPHIC")]


def test_documents_downloaded_and_parsed_once(fake, svc):
    ref = svc.filings(F.TICKER, ["10-K"], 1)[0]
    a = svc.load(ref)
    b = svc.load(ref)
    assert a is b
    assert sum(1 for c in fake.calls if c[0] == "doc") == 1


def test_edgar_client_user_agent_disk_cache_and_throttle(tmp_path, monkeypatch):
    from app.services.copilot.sec_fetcher import USER_AGENT
    seen = []

    class Resp:
        status_code = 200

        def __init__(self, body):
            self.body = body

        def iter_content(self, n):
            yield self.body

    def fake_get(url, headers=None, timeout=None, stream=None):
        seen.append((url, headers))
        return Resp(json.dumps({"name": "X", "filings": {"recent": {}}}).encode())

    import requests
    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setenv("COPILOT_EDGAR_S3", "0")
    c = EdgarClient(cache_dir=tmp_path)
    assert c.submissions("42")["name"] == "X"
    assert c.submissions("42")["name"] == "X"            # second read: disk cache, no request
    assert len(seen) == 1 and seen[0][0] == "https://data.sec.gov/submissions/CIK0000000042.json"
    assert seen[0][1]["User-Agent"] == USER_AGENT
    # documents are immutable: cached forever
    assert c.document("42", F.ACC_K25, "a.htm") == c.document("42", F.ACC_K25, "a.htm")
    assert len(seen) == 2

    import time
    th = _Throttle(0.05)
    t0 = time.monotonic()
    for _ in range(4):
        th.wait()
    assert time.monotonic() - t0 >= 0.15 - 1e-3          # 4 requests need >= 3 intervals


# ── BM25 (textbook values) ───────────────────────────────────────────────────

def test_bm25_matches_hand_computed_okapi():
    docs = [["lease", "lease", "debt"], ["debt"], ["revenue", "growth"]]
    idx = BM25Index(docs)
    # N=3, df(lease)=1 -> idf = ln(1 + (3-1+0.5)/(1+0.5)) = ln(8/3); avgdl = 6/3 = 2
    idf = math.log(1 + 2.5 / 1.5)
    assert idx.idf("lease") == pytest.approx(math.log(8 / 3), abs=1e-12)
    # doc0: tf=2, |D|=3 -> 2*2.2 / (2 + 1.2*(0.25 + 0.75*3/2)) = 4.4 / 3.65
    assert idx.score(["lease"], 0) == pytest.approx(idf * 4.4 / 3.65, abs=1e-9)
    # debt: df=2 -> idf = ln(1 + 1.5/2.5) = ln(1.6); doc1: tf=1, |D|=1 -> 2.2 / (1 + 1.2*(0.25+0.375))
    assert idx.score(["debt"], 1) == pytest.approx(math.log(1.6) * 2.2 / 1.75, abs=1e-9)
    assert idx.score(["lease"], 1) == 0.0
    assert [i for i, _ in idx.search(["lease", "debt"])] == [0, 1]


# ── tools ────────────────────────────────────────────────────────────────────

def test_passages_verbatim_with_citations(svc):
    facts, payload = FT.passages(svc, F.TICKER, {"query": "customer accounted for percent of total revenue",
                                                "forms": ["10-K"], "filings_back": 1})
    top = facts[0]
    assert top.form == "10-K" and top.accession == F.ACC_K25 and top.filing_date == "2025-02-26"
    assert top.section in ("Part I, Item 1A. Risk Factors",
                           "Part II, Item 7. Management's Discussion and Analysis of Financial Condition "
                           "and Results of Operations")
    assert "19% of total revenue" in top.excerpt
    assert top.url.startswith("https://www.sec.gov/Archives/edgar/data/42/000000004225000013/fx-20250126.htm#i_")
    assert top.page and top.page_label
    assert payload["filings_used"][0]["accession"] == F.ACC_K25
    assert _assert_verbatim(svc, facts) == len(facts)


def test_passages_section_filter_and_unavailable(svc):
    facts, payload = FT.passages(svc, F.TICKER, {"query": "operating lease maturities", "sections": ["financial_statements"]})
    assert facts and all(f.section == "Part II, Item 8. Financial Statements and Supplementary Data" for f in facts)
    with pytest.raises(LookupError, match="no 10-K filings found for ZZZZ|no SEC CIK"):
        FT.passages(svc, "ZZZZ", {"query": "x"})


def test_risk_factor_diff_across_three_10ks(svc):
    facts, payload = FT.section_diff(svc, F.TICKER, {"section": "risk_factors", "filings": 3})
    summ = [f for f in facts if f.kind == "filing_diff"]
    units = [f for f in facts if f.kind == "filing_excerpt"]
    new, old = summ                                       # 2024->2025, 2023->2024
    assert (new.prior["accession"], new.current["accession"]) == (F.ACC_K24, F.ACC_K25)
    assert (new.added, new.removed, new.changed, new.minor_edits, new.unchanged) == (1, 0, 0, 1, 3)
    assert (old.added, old.removed, old.changed, old.minor_edits, old.unchanged) == (1, 1, 1, 0, 2)
    assert new.unit == "risk_factor" and new.units_current == 5 and new.units_prior == 4

    by = {(u.change, u.filing_date): u for u in units}
    assert by[("added", "2025-02-26")].excerpt.startswith(F.R6[0])
    assert by[("added", "2024-02-21")].excerpt.startswith(F.R5[0])
    assert by[("removed", "2023-02-24")].excerpt.startswith(F.R4[0])
    ch = by[("changed", "2024-02-21")]
    assert ch.excerpt.startswith(F.R3_NEW[0]) and "19% of total revenue" in ch.excerpt
    assert "13% of total revenue" in ch.prior_excerpt
    assert "19%" in ch.inserted_text and "13%" in ch.deleted_text
    assert ch.prior_citation["accession"] == F.ACC_K23 and ch.subheading == "Risks Related to Our Industry and Markets"
    assert 0 < ch.similarity < 1
    assert _assert_verbatim(svc, units) == len(units)


def test_diff_needs_two_filings(fake, svc):
    fake.sub["filings"]["recent"] = {k: v[-1:] for k, v in fake.sub["filings"]["recent"].items()}
    fake.sub["filings"]["files"] = []
    with pytest.raises(LookupError, match="need at least 2 10-K"):
        FT.section_diff(svc, F.TICKER, {"section": "risk_factors"})


def test_operating_leases_xbrl_from_accession_and_reconciliation(svc):
    facts, payload = FT.disclosure(svc, F.TICKER, {"topic": "operating_leases"})
    x = {(f.concept, f.period_end): f for f in facts if f.kind == "xbrl"}
    # only values filed in the latest 10-K's accession (the FY2024 10-K's 700M is excluded)
    assert all(f.accession == F.ACC_K25 for f in facts if f.kind == "xbrl")
    assert x[("LesseeOperatingLeaseLiabilityPaymentsDueNextTwelveMonths", "2025-01-26")].value == 1_000e6
    assert x[("OperatingLeaseLiability", "2024-01-28")].value == 4_000e6     # comparative, same accession
    calc = {f.name: f for f in facts if f.kind == "computed"}
    ladder = calc["operating lease payments by year (sum)"]
    # hand sum: 1,000 + 900 + 800 + 700 + 600 + 2,000 = 6,000 (millions) = filed total
    assert ladder.value == 6_000e6 and ladder.reported == 6_000e6 and ladder.difference == 0 and ladder.reconciles
    pv = calc["present value = undiscounted payments - imputed interest"]
    assert pv.value == 5_000e6 and pv.reconciles                               # 6,000 - 1,000
    split = calc["operating lease liability = current + noncurrent"]
    assert split.value == 800e6 + 4_200e6 and split.reconciles
    assert set(ladder.inputs) <= {f.id for f in facts}
    narr = [f for f in facts if f.kind == "filing_excerpt"]
    assert narr and "maturities of operating lease liabilities" in narr[0].excerpt
    assert "Total $6,000" in narr[0].excerpt and "Present value $5,000" in narr[0].excerpt
    assert _assert_verbatim(svc, narr)


def test_reconciliation_flags_mismatch():
    t = TOPICS["deferred_revenue"]
    from app.services.copilot.filings_rag.facts import XbrlValueFact

    def v(tag, val):
        return XbrlValueFact(id=f"xbrl:{tag}", source="s", ticker="X", concept=tag, value=val, unit="USD",
                             period_end="2025-06-30", accession="a")
    out = run_checks(t, [v("ContractWithCustomerLiabilityCurrent", 100.0), v("ContractWithCustomerLiabilityNoncurrent", 50.0),
                         v("ContractWithCustomerLiability", 160.0)])
    assert len(out) == 1 and out[0].value == 150.0 and out[0].difference == 10.0 and out[0].reconciles is False


def test_xbrl_values_none_when_not_tagged():
    ref = F.FakeEdgar()
    svc = FilingsService(ref)
    r = svc.filings(F.TICKER, ["10-K"], 1)[0]
    assert xbrl_values(F.company_facts(), r, ["RevenueRemainingPerformanceObligation"]) == []
    facts, payload = FT.disclosure(svc, F.TICKER, {"topic": "remaining_performance_obligations"})
    assert any("RevenueRemainingPerformanceObligation" in u for u in payload["unavailable"])


def test_customer_concentration_narrative_and_dimensional_note(svc):
    facts, payload = FT.disclosure(svc, F.TICKER, {"topic": "customer_concentration"})
    sents = [s for f in facts for s in (f.matched_sentences or [])]
    assert any("Customer A represented 19% of total revenue for fiscal year 2025" in s for s in sents)
    assert payload["limitation"].startswith("SEC companyfacts carries only non-dimensional")
    assert not any(f.kind == "xbrl" for f in facts)
    assert _assert_verbatim(svc, facts)


def test_guidance_from_earnings_release_exhibit(svc):
    facts, payload = FT.disclosure(svc, F.TICKER, {"topic": "guidance"})
    texts = [f.excerpt for f in facts]
    assert "Revenue is expected to be $45.0 billion, plus or minus 2%." in texts
    assert ("GAAP and non-GAAP gross margins are expected to be 71.8% and 72.0%, respectively, plus or minus "
            "50 basis points.") in texts
    assert not any("forward-looking" in t for t in texts)                    # safe-harbor boilerplate dropped
    f = facts[0]
    assert f.exhibit == "EX-99.1" and f.form == "EX-99.1" and f.accession == F.ACC_8K_EARN
    assert f.url.startswith("https://www.sec.gov/Archives/edgar/data/42/000000004225000031/fx-ex991.htm")
    assert f.subheading == "Outlook"
    assert _assert_verbatim(svc, facts) == len(facts)


def test_10q_risk_factor_update_and_8k_items(svc):
    facts, _ = FT.passages(svc, F.TICKER, {"query": "export licensing charge excess inventory purchase obligations",
                                          "forms": ["10-Q"], "sections": ["risk_factors"]})
    assert facts[0].section == "Part II, Item 1A. Risk Factors" and "$4.5 billion charge" in facts[0].excerpt
    facts, _ = FT.passages(svc, F.TICKER, {"query": "press release results", "forms": ["8-K"], "filings_back": 2,
                                          "sections": ["results_of_operations"]})
    assert facts and facts[0].section.startswith("Item 2.02.") and facts[0].accession == F.ACC_8K_EARN
    # the latest 8-K (a shareholder vote) has no Item 2.02: reported, not invented
    facts, payload = FT.passages(svc, F.TICKER, {"query": "press release results", "forms": ["8-K"],
                                                "sections": ["results_of_operations"]})
    assert facts == [] and any("results_of_operations not found in 8-K filed 2025-06-27" in u
                               for u in payload["unavailable"])


def test_list_filings(svc):
    facts, payload = FT.list_filings(svc, F.TICKER, {"forms": ["10-K", "8-K"], "limit": 2})
    assert [(f.form, f.filing_date) for f in facts] == [("8-K", "2025-06-27"), ("8-K", "2025-05-28"),
                                                       ("10-K", "2025-02-26"), ("10-K", "2024-02-21")]
    assert facts[1].items == "2.02,9.01"


# ── registry wiring ──────────────────────────────────────────────────────────

def test_tools_registered_with_schemas():
    from app.services.copilot.tools import PLUGIN_TOOLS, TOOL_NAMES, TOOL_TIMEOUTS, lc_tools
    names = {t["name"] for t in lc_tools()}
    assert FT.FILINGS_TOOL_NAMES <= names <= TOOL_NAMES | set(PLUGIN_TOOLS)
    for t in FT.FILINGS_TOOL_SPECS:
        assert t["input_schema"]["required"][0] == "ticker" and t["description"]
        assert TOOL_TIMEOUTS[t["name"]] >= 30
    topics = next(t for t in FT.FILINGS_TOOL_SPECS if t["name"] == "sec_disclosure_extract")
    assert set(topics["input_schema"]["properties"]["topic"]["enum"]) == set(TOPICS)


def test_executor_runs_filings_tool_and_registers_facts(fake):
    from app.services.copilot.models import TickerContextPack
    from app.services.copilot.registry import FactRegistry
    from app.services.copilot.tools import ToolExecutor
    reg = FactRegistry()
    ex = ToolExecutor(None, reg, None, {"NVDA": TickerContextPack(ticker="NVDA")}, None)
    content, facts, err = asyncio.run(ex.run("sec_filing_section_diff", {"ticker": "NVDA", "section": "risk_factors"}))
    assert not err, content
    assert content.startswith('<context source="tool:sec_filing_section_diff"')
    assert all(f.id in reg for f in facts)
    assert "char_start" not in content                   # offsets are not model-facing numbers
    # numbers quoted from the excerpts are groundable by the post-check
    assert 19.0 in reg.numeric_values() and 13.0 in reg.numeric_values()
    etf = TickerContextPack(ticker="SPY", asset_type="etf")
    ex2 = ToolExecutor(None, FactRegistry(), None, {"SPY": etf}, None)
    content, facts, err = asyncio.run(ex2.run("sec_filing_passages", {"ticker": "SPY", "query": "x"}))
    assert err and "no SEC company filings" in content


def test_engine_answer_cites_filing_excerpt(fake, fixture_db):
    from app.services.copilot.engine import CopilotEngine, CopilotRequest, LLMHandle
    from app.services.copilot.evalkit import FixtureSources, ScriptedLLM
    from app.services.copilot.memory import InMemoryStore
    svc = FilingsService(fake)
    facts, _ = FT.passages(svc, F.TICKER, {"query": "customer accounted for percent of total revenue"})
    cid = facts[0].id
    llm = ScriptedLLM([
        {"tool_calls": [{"name": "sec_filing_passages",
                         "args": {"ticker": "NVDA", "query": "customer accounted for percent of total revenue"}}]},
        {"text": f"NVIDIA's latest 10-K says Customer A accounted for 19% of total revenue [{cid}]."},
    ])
    eng = CopilotEngine(fixture_db, sources=FixtureSources(), llm_chain=[LLMHandle("scripted", "m", lambda: llm)],
                        memory_store=InMemoryStore(), use_pack_cache=False)

    async def go():
        return [ev async for ev in eng.run(CopilotRequest(message="NVDA customer concentration in the 10-K?", user_id=7))]
    events = asyncio.run(go())
    tool_done = [d for e, d in events if e == "tool" and d.get("status") == "done"]
    assert tool_done and tool_done[0]["name"] == "sec_filing_passages" and cid in tool_done[0]["fact_ids"]
    final = next(d for e, d in events if e == "done")
    text = json.dumps(final)
    assert cid in text and "(unverified)" not in text
