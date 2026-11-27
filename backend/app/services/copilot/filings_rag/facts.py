"""Citable facts produced by the filings tools.

``FilingExcerptFact.excerpt`` is always ``doc.text[char_start:char_end]`` of
the filing document named in ``url`` (whitespace-normalized rendering);
``XbrlValueFact`` is one value exactly as filed in that accession's XBRL.
Offsets are excluded from the model payload / numeric grounding pool (they
are not financial numbers) but kept on the object and in the UI chip.
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from app.services.copilot.models import Fact

VERBATIM_NOTE = ("verbatim filing text (whitespace collapsed; table cells joined by a space)")


def short_id(*parts: Any) -> str:
    return hashlib.sha1("\x1f".join(str(p) for p in parts).encode()).hexdigest()[:10]


class FilingExcerptFact(Fact):
    kind: Literal["filing_excerpt"] = "filing_excerpt"
    company: Optional[str] = None
    form: str
    filing_date: Optional[str] = None
    report_date: Optional[str] = None          # period of report
    accession: str
    document: str                              # file name inside the accession
    exhibit: Optional[str] = None              # e.g. EX-99.1
    section: Optional[str] = None              # "Part I, Item 1A. Risk Factors"
    section_heading: Optional[str] = None      # heading as printed
    subheading: Optional[str] = None
    page: Optional[int] = None                 # physical page (HTML page breaks)
    page_label: Optional[str] = None           # printed page number when detected
    url: Optional[str] = None                  # deep link (#anchor when available)
    excerpt: str
    change: Optional[str] = None               # diff: added | removed | changed
    prior_excerpt: Optional[str] = None        # diff: same unit in the older filing
    prior_citation: Optional[Dict[str, Any]] = None
    similarity: Optional[float] = None
    inserted_text: Optional[List[str]] = None  # diff: verbatim phrases new in this filing
    deleted_text: Optional[List[str]] = None   # diff: verbatim phrases dropped from the prior filing
    matched_sentences: Optional[List[str]] = None
    score: Optional[float] = None
    truncated: bool = False
    suspicious: bool = False
    char_start: int = Field(0, exclude=True)
    char_end: int = Field(0, exclude=True)

    def label(self) -> str:
        sec = self.section or self.exhibit or "filing"
        return f"{self.ticker} {self.form} filed {self.filing_date} · {sec}"

    def citation(self, offsets: bool = True) -> Dict[str, Any]:
        d = {"id": self.id, "ticker": self.ticker, "form": self.form, "filing_date": self.filing_date,
             "report_date": self.report_date, "accession": self.accession, "document": self.document,
             "exhibit": self.exhibit, "section": self.section, "subheading": self.subheading,
             "page": self.page, "page_label": self.page_label, "url": self.url}
        if offsets:
            d.update(char_start=self.char_start, char_end=self.char_end)
        return d

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d.update(filing_type=self.form, filed_date=self.filing_date, accession=self.accession,
                 section=self.section, url=self.url, page=self.page_label or self.page,
                 snippet=self.excerpt[:600], change=self.change, char_start=self.char_start,
                 char_end=self.char_end, document=self.document, exhibit=self.exhibit)
        return d


class XbrlValueFact(Fact):
    kind: Literal["xbrl"] = "xbrl"
    concept: str                               # us-gaap tag
    label_text: Optional[str] = None
    value: float
    unit: str
    period_start: Optional[str] = None
    period_end: str
    fiscal_year: Optional[int] = None
    fiscal_period: Optional[str] = None
    form: Optional[str] = None
    accession: Optional[str] = None
    filed: Optional[str] = None

    def label(self) -> str:
        span = f"{self.period_start} to {self.period_end}" if self.period_start else f"at {self.period_end}"
        return f"{self.ticker} {self.concept} {span}"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        v = self.value
        shown = f"${v / 1e9:,.3f}B" if self.unit == "USD" and abs(v) >= 1e8 else f"{v:,} {self.unit}"
        d.update(filing_type=self.form, accession=self.accession, filed_date=self.filed,
                 snippet=f"{self.concept} = {shown} ({self.label().split(' ', 2)[-1]})")
        return d


class FilingDiffFact(Fact):
    """Counts for one older -> newer comparison of a section (the units are
    separate FilingExcerptFacts with ``change`` set)."""
    kind: Literal["filing_diff"] = "filing_diff"
    section: str
    form: str
    prior: Dict[str, Any]                      # filing_date, accession, url, words
    current: Dict[str, Any]
    unit: str                                  # risk_factor | paragraph
    units_prior: int
    units_current: int
    added: int
    removed: int
    changed: int
    minor_edits: int
    unchanged: int
    shown: Dict[str, int] = Field(default_factory=dict)
    method: str = ""

    def label(self) -> str:
        return (f"{self.ticker} {self.section}: {self.form} {self.prior.get('filing_date')} vs "
                f"{self.current.get('filing_date')}")


class FilingListFact(Fact):
    """One filing from the EDGAR submissions index."""
    kind: Literal["sec_filing"] = "sec_filing"
    company: Optional[str] = None
    form: str
    filing_date: str
    report_date: Optional[str] = None
    accession: str
    items: Optional[str] = None
    url: str
    index_url: Optional[str] = None

    @classmethod
    def from_ref(cls, r) -> "FilingListFact":
        return cls(id=f"secf:{r.accession}", source="SEC EDGAR submissions API", as_of=r.filing_date,
                   ticker=r.ticker, company=r.company or None, form=r.form, filing_date=r.filing_date,
                   report_date=r.report_date or None, accession=r.accession, items=r.items or None,
                   url=r.doc_url(), index_url=r.index_url)

    def label(self) -> str:
        return f"{self.ticker} {self.form} filed {self.filing_date}"

    def ui(self) -> Dict[str, Any]:
        d = super().ui()
        d.update(filing_type=self.form, filed_date=self.filing_date, accession=self.accession, url=self.url)
        return d


class ComputedFact(Fact):
    """A deterministic computation over cited XBRL values (formula + inputs)."""
    kind: Literal["computed"] = "computed"
    name: str
    formula: str
    inputs: List[str]                          # fact ids
    value: Optional[float] = None
    unit: str = "USD"
    reported: Optional[float] = None           # the filed total it is checked against
    difference: Optional[float] = None
    reconciles: Optional[bool] = None
    note: Optional[str] = None

    def label(self) -> str:
        return f"{self.ticker} {self.name} (computed)"
