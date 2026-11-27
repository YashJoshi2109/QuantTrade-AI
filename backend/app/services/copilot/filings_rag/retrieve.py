"""Passage retrieval over selected filings (BM25, optionally fused with Qdrant)."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

from app.services.copilot import bm25
from app.services.copilot.filings_rag.facts import FilingExcerptFact
from app.services.copilot.filings_rag.index import BM25Index, locate, rrf
from app.services.copilot.filings_rag.parse import sentence_spans
from app.services.copilot.filings_rag.store import FilingRef, FilingsService, LoadedDoc

logger = logging.getLogger(__name__)

MAX_SENTENCES = 3


@dataclass
class Selection:
    docs: List[LoadedDoc] = field(default_factory=list)
    refs: List[FilingRef] = field(default_factory=list)
    unavailable: List[str] = field(default_factory=list)


def select_docs(svc: FilingsService, ticker: str, forms: Sequence[str], filings_back: int,
                accession: Optional[str] = None) -> Selection:
    """Load the latest ``filings_back`` filings of each form.  ``EX-99.1`` means
    the EX-99.x exhibits of the latest earnings 8-Ks (Item 2.02)."""
    sel = Selection()
    base_forms = [f for f in forms if f in ("10-K", "10-Q", "8-K")]
    want_ex = any(f.upper().startswith("EX-99") for f in forms)
    refs: List[FilingRef] = []
    if base_forms:
        refs += svc.filings(ticker, base_forms, filings_back if not accession else 50)
    ex_refs: List[FilingRef] = []
    if want_ex:
        ex_refs = svc.filings(ticker, ["8-K"], filings_back if not accession else 50, earnings_only=True)
    if accession:
        refs = [r for r in refs if r.accession == accession]
        ex_refs = [r for r in ex_refs if r.accession == accession]
        if not refs and not ex_refs:
            sel.unavailable.append(f"accession {accession} is not among {ticker}'s recent {', '.join(forms)} filings")
    for f in base_forms:
        if not any(r.form == f for r in refs) and not accession:
            sel.unavailable.append(f"no {f} filings found for {ticker} in EDGAR submissions")
    if want_ex and not ex_refs and not accession:
        sel.unavailable.append(f"no earnings 8-K (Item 2.02) found for {ticker} in EDGAR submissions")
    for r in refs:
        try:
            sel.docs.append(svc.load(r))
            sel.refs.append(r)
        except LookupError as e:
            sel.unavailable.append(str(e))
    for r in ex_refs:
        exs = svc.load_with_exhibits(r)
        if not exs:
            sel.unavailable.append(f"8-K filed {r.filing_date} (accession {r.accession}) has no parseable EX-99 exhibit")
        sel.docs += exs
        if exs and r not in sel.refs:
            sel.refs.append(r)
    return sel


def _query_sentences(ld: LoadedDoc, start: int, end: int, q: set) -> List[str]:
    scored = []
    for a, b in sentence_spans(ld.doc.text, start, end):
        toks = set(bm25.tokenize(ld.doc.text[a:b]))
        hit = len(toks & q)
        if hit:
            scored.append((-hit, a, b))
    scored.sort()
    best = sorted(scored[:MAX_SENTENCES], key=lambda x: x[1])
    return [ld.doc.text[a:b] for _, a, b in best]


def retrieve(svc: FilingsService, sel: Selection, query: str, *, sections: Optional[Sequence[str]] = None,
             limit: int = 5, vector_hits: Optional[Sequence[Tuple[str, str]]] = None,
             pattern: Optional[re.Pattern] = None) -> List[FilingExcerptFact]:
    """Top passages across the selected documents.

    ``vector_hits`` = [(accession, text)] from the Qdrant hybrid index, in rank
    order; each is mapped back onto the local chunk containing it."""
    flat: List[Tuple[LoadedDoc, int]] = []
    toks: List[List[str]] = []
    for ld in sel.docs:
        allowed_secs = None
        if sections:
            allowed_secs = {id(s) for k in sections for s in ld.sections_for(k)}
            if ld.exhibit and "exhibit" in sections:
                allowed_secs |= {id(s) for s in ld.sections}
        for i, c in enumerate(ld.chunks):
            if allowed_secs is not None and id(c.section) not in allowed_secs:
                continue
            flat.append((ld, i))
            toks.append(ld.tokens()[i])
    if not flat:
        return []
    q = bm25.tokenize(query)
    idx = BM25Index(toks)
    scores = [idx.score(q, i) for i in range(len(flat))]
    if pattern is not None:
        for i, (ld, ci) in enumerate(flat):
            c = ld.chunks[ci]
            hits = len(pattern.findall(ld.doc.text, c.start, c.end))
            if hits:
                scores[i] += 1.5 * min(hits, 3)
            elif scores[i]:
                scores[i] *= 0.5
    bm = [i for i in sorted(range(len(flat)), key=lambda i: (-scores[i], i)) if scores[i] > 0][:50]
    ranking = bm
    if vector_hits:
        vec: List[int] = []
        flat_pos = {(id(ld), ci): i for i, (ld, ci) in enumerate(flat)}
        flat_text = {}                       # "\n" -> " " keeps offsets identical
        for acc, text in vector_hits:
            for ld in sel.docs:
                if ld.ref.accession != acc:
                    continue
                t = flat_text.setdefault(id(ld), ld.doc.text.replace("\n", " "))
                pos = locate(t, text)
                if pos < 0:
                    continue
                ci = next((k for k, c in enumerate(ld.chunks) if c.start <= pos < c.end), None)
                i = flat_pos.get((id(ld), ci))
                if i is not None and i not in vec:
                    vec.append(i)
                break
        if vec:
            ranking = [i for i, _ in rrf([bm, vec])]
    out: List[FilingExcerptFact] = []
    qset = set(q)
    for i in ranking[:limit]:
        ld, ci = flat[i]
        c = ld.chunks[ci]
        out.append(svc.excerpt(ld, c.start, c.end, chunk=c, score=round(scores[i], 4),
                               matched_sentences=_query_sentences(ld, c.start, c.end, qset) or None))
    return out
