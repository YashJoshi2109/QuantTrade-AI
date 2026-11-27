"""Filing selection, loading (download -> parse -> sections -> chunks) and caching.

Parsed documents are cached in memory (LRU) and, with the live EDGAR client,
on disk next to the raw document (keyed by accession + file + parser version;
an accession's documents never change).
"""
from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote

from app.services.copilot.filings_rag import edgar
from app.services.copilot.filings_rag.edgar import EdgarProvider, FilingRef, filing_refs, merged_submissions
from app.services.copilot.filings_rag.facts import FilingExcerptFact, short_id
from app.services.copilot.filings_rag.index import Chunk, chunk_section, chunk_tokens
from app.services.copilot.filings_rag.parse import (PARSER_VERSION, ParsedDoc, Section, form_family, render,
                                                    split_sections)

logger = logging.getLogger(__name__)

MEM_DOCS = 16
EARNINGS_ITEM = "2.02"
FS_XREF_CHARS = 3000


class FilingUnavailable(LookupError):
    pass


@dataclass
class LoadedDoc:
    ref: FilingRef
    document: str
    exhibit: Optional[str]
    doc: ParsedDoc
    sections: List[Section]
    chunks: List[Chunk]
    _tokens: Optional[List[List[str]]] = field(default=None, repr=False)

    @property
    def form(self) -> str:
        return self.exhibit or self.ref.form

    def tokens(self) -> List[List[str]]:
        if self._tokens is None:
            self._tokens = [chunk_tokens(self.doc, c) for c in self.chunks]
        return self._tokens

    def section(self, key: Optional[str]) -> Optional[Section]:
        from app.services.copilot.filings_rag.parse import SECTION_KEYS
        want = SECTION_KEYS.get(key or "", {}).get(form_family(self.form))
        if want is None:
            return None
        return next((s for s in self.sections if (s.part, s.item) == want), None)

    def sections_for(self, key: Optional[str]) -> List[Section]:
        """Sections to search for a key.  10-K financial statements: when Item 8
        only cross-references the statements (NVIDIA, Apple ...), they are printed
        under Item 15, which is included too."""
        sec = self.section(key)
        out = [sec] if sec else []
        if key == "financial_statements" and form_family(self.form) == "10-K":
            if sec is None or (sec.end - sec.start) < FS_XREF_CHARS:
                out += [s for s in self.sections if (s.part, s.item) == ("IV", "15")]
        return out

    def url(self, anchor: Optional[str] = None) -> str:
        u = self.ref.doc_url(self.document)
        return f"{u}#{quote(anchor, safe='')}" if anchor else u

    def found_sections(self) -> List[str]:
        return [s.label for s in self.sections]


def _looks_injected(text: str) -> bool:
    from app.services.copilot.sources import looks_injected
    return looks_injected(text)


class FilingsService:
    def __init__(self, provider: EdgarProvider):
        self.p = provider
        self._mem: "OrderedDict[Tuple[str, str], LoadedDoc]" = OrderedDict()
        self._lock = threading.Lock()
        self._doc_locks: Dict[Tuple[str, str], threading.Lock] = {}

    # selection --------------------------------------------------------------
    def cik(self, ticker: str) -> str:
        cik = self.p.cik(ticker)
        if not cik:
            raise FilingUnavailable(f"no SEC CIK found for {ticker} (not an SEC registrant, or EDGAR's "
                                    "ticker map is unavailable)")
        return str(cik).zfill(10)

    def filings(self, ticker: str, forms: Sequence[str], per_form: int, *, earnings_only: bool = False,
                include_amendments: bool = False) -> List[FilingRef]:
        """Latest ``per_form`` filings of each form, newest first."""
        cik = self.cik(ticker)
        sub = merged_submissions(self.p, cik, list(forms), per_form * (4 if earnings_only else 1))
        refs = filing_refs(ticker, cik, sub, list(forms), include_amendments=include_amendments)
        out: List[FilingRef] = []
        for f in forms:
            rows = [r for r in refs if r.form.replace("/A", "") == f]
            if earnings_only and f == "8-K":
                rows = [r for r in rows if EARNINGS_ITEM in (r.items or "").split(",")]
            out += rows[:per_form]
        out.sort(key=lambda r: (r.filing_date, r.accession), reverse=True)
        return out

    def exhibits(self, ref: FilingRef, prefix: str = "EX-99") -> List[Dict[str, str]]:
        rows = self.p.filing_index(ref.cik, ref.accession)
        return [r for r in rows if r.get("type", "").upper().startswith(prefix)]

    # loading ----------------------------------------------------------------
    def load(self, ref: FilingRef, document: Optional[str] = None, exhibit: Optional[str] = None) -> LoadedDoc:
        name = document or ref.primary_doc
        key = (ref.accession, name)
        with self._lock:
            hit = self._mem.get(key)
            if hit is not None:
                self._mem.move_to_end(key)
                return hit
            lock = self._doc_locks.setdefault(key, threading.Lock())
        with lock:                                     # one download/parse per document
            with self._lock:
                hit = self._mem.get(key)
            if hit is not None:
                return hit
            if name.lower().endswith(".pdf"):
                raise FilingUnavailable(f"{exhibit or ref.form} {name} (accession {ref.accession}) is a PDF; "
                                        "text extraction from PDF exhibits is not supported")
            doc = self._parsed(ref, name)
            sections = split_sections(doc, exhibit or ref.form,
                                      exhibit_title=f"Exhibit {exhibit[3:]}" if exhibit else None)
            chunks = [c for s in sections for c in chunk_section(doc, s)]
            ld = LoadedDoc(ref, name, exhibit, doc, sections, chunks)
            with self._lock:
                self._mem[key] = ld
                while len(self._mem) > MEM_DOCS:
                    self._mem.popitem(last=False)
            return ld

    def _parsed(self, ref: FilingRef, name: str) -> ParsedDoc:
        cache_key = f"parsed_v{PARSER_VERSION}_{ref.accession}_{name}.json"
        reader = getattr(self.p, "_read", None)
        writer = getattr(self.p, "_write", None)
        if reader is not None:
            raw = reader(cache_key, None)
            if raw is not None:
                try:
                    return ParsedDoc.from_dict(json.loads(raw))
                except Exception:
                    pass
        raw_doc = self.p.document(ref.cik, ref.accession, name)
        doc = render(raw_doc, name)
        if not doc.text.strip():
            raise FilingUnavailable(f"{ref.form} {name} (accession {ref.accession}) has no extractable text")
        if writer is not None:
            writer(cache_key, json.dumps(doc.to_dict()).encode())
        return doc

    def load_with_exhibits(self, ref: FilingRef, prefix: str = "EX-99") -> List[LoadedDoc]:
        out = []
        for r in self.exhibits(ref, prefix):
            try:
                out.append(self.load(ref, r["document"], exhibit=r["type"].upper()))
            except LookupError as e:
                logger.info("exhibit skipped: %s", e)
        return out

    # facts ------------------------------------------------------------------
    def excerpt(self, ld: LoadedDoc, start: int, end: int, *, section: Optional[Section] = None,
                chunk: Optional[Chunk] = None, **extra) -> FilingExcerptFact:
        doc = ld.doc
        if section is None:
            section = chunk.section if chunk else next(
                (s for s in ld.sections if s.start <= start < s.end + 1), None)
        page, label = doc.page_at(start)
        anchor = (chunk.anchor if chunk else None) or doc.anchor_near(start) or (section.anchor if section else None)
        sub = extra.pop("subheading", None) or (chunk.subheading if chunk else None)
        text = doc.text[start:end]
        r = ld.ref
        return FilingExcerptFact(
            id=f"secx:{short_id(r.accession, ld.document, start, end)}",
            source=f"SEC EDGAR {ld.form} filed {r.filing_date}, accession {r.accession}, {ld.document}",
            as_of=r.filing_date, ticker=r.ticker, company=r.company or None, form=ld.form,
            filing_date=r.filing_date, report_date=r.report_date or None, accession=r.accession,
            document=ld.document, exhibit=ld.exhibit, section=section.label if section else None,
            section_heading=section.heading if section else None, subheading=sub, page=page,
            page_label=label, url=ld.url(anchor), excerpt=text, suspicious=_looks_injected(text),
            char_start=start, char_end=end, **extra)


_SVC: Optional[FilingsService] = None
_SVC_FOR: Optional[int] = None
_SVC_LOCK = threading.Lock()


def get_service() -> FilingsService:
    """Process-wide service bound to the current EDGAR provider."""
    global _SVC, _SVC_FOR
    p = edgar.get_provider()
    with _SVC_LOCK:
        if _SVC is None or _SVC_FOR != id(p):
            _SVC, _SVC_FOR = FilingsService(p), id(p)
        return _SVC
