"""Filing HTML -> normalized text + structure, and item sectioning.

``render_html`` walks the DOM (iteratively: malformed filings nest deeply) and
emits one *line* per block element (p, div, tr, li, h*, br ...). Within a line,
whitespace is collapsed and table cells are joined by one space; nothing else
is changed, so every excerpt cut from ``ParsedDoc.text`` is verbatim filing
text. Per line it records whether the text is emphasized (bold / italic: risk
factor and note headings), and it records HTML anchors (``id`` / ``a name``)
and page breaks (CSS page-break / ``<hr>``) as text offsets, for citations.

Hidden content (``display:none``, the iXBRL ``ix:header``, scripts/styles) is
dropped; inline iXBRL tags (ix:nonFraction ...) are kept, they wrap the numbers.

``split_sections`` finds "PART I" / "Item 1A." heading lines and keeps, per
item, the longest span; table-of-contents rows (a heading line directly
followed by the next heading) are not sections.
"""
from __future__ import annotations

import bisect
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

PARSER_VERSION = 1

_BLOCK = frozenset("""address article aside blockquote body center dd details dialog dir div dl dt fieldset
figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup html li main menu nav ol p pre section
summary table tbody thead tfoot tr ul title caption""".split())
_CELL = frozenset({"td", "th"})
_SKIP = frozenset({"script", "style", "head", "noscript", "template", "ix:header", "xbrli:xbrl",
                   "ix:hidden", "ix:references", "ix:resources"})
_BOLD = re.compile(r"font-weight\s*:\s*(?:bold|bolder|[6-9]00)", re.I)
_ITALIC = re.compile(r"font-style\s*:\s*(?:italic|oblique)", re.I)
_HIDDEN = re.compile(r"display\s*:\s*none", re.I)
_BREAK_BEFORE = re.compile(r"(?:page-)?break-before\s*:\s*(?:always|page)", re.I)
_BREAK_AFTER = re.compile(r"(?:page-)?break-after\s*:\s*(?:always|page)", re.I)
_WS = re.compile(r"[\s  -​  　﻿]+")
_SHORT_HEAD = re.compile(r"^(?:part\s+(?:iv|i{1,3})|item\s*\d{1,2}[a-d]?)\.?$", re.I)
_RUNNING_HEADER = re.compile(r"^(?:table of contents|index)$", re.I)
_PAGE_LABEL = re.compile(r"^(?:page\s+)?(?:[A-Z]{1,2}-)?\d{1,3}$|^[ivxlc]{1,6}$", re.I)


def normalize_line(raw: str) -> str:
    s = _WS.sub(" ", raw).strip()
    # table-cell joins: "$ 1,234" / "( 12 )" / "12 %" are one value in the filing
    s = re.sub(r"\(\s+(?=[\d$])", "(", s)
    s = re.sub(r"(?<=[\d%])\s+\)", ")", s)
    s = re.sub(r"(?<=\d)\s+%", "%", s)
    s = re.sub(r"\$\s+(?=[\d(])", "$", s)
    return s


@dataclass
class ParsedDoc:
    text: str
    line_starts: List[int]
    line_emph: List[bool]
    anchors: List[Tuple[int, str]] = field(default_factory=list)      # (offset, id), sorted
    page_starts: List[int] = field(default_factory=lambda: [0])       # offsets where pages start
    page_labels: List[Optional[str]] = field(default_factory=lambda: [None])
    furniture: List[int] = field(default_factory=list)                # page-number / running-header lines

    def is_furniture(self, i: int) -> bool:
        if not hasattr(self, "_furn"):
            self._furn = set(self.furniture)
        return i in self._furn

    # geometry ---------------------------------------------------------------
    @property
    def n_lines(self) -> int:
        return len(self.line_starts)

    def line_end(self, i: int) -> int:
        return (self.line_starts[i + 1] - 1) if i + 1 < len(self.line_starts) else len(self.text)

    def line(self, i: int) -> str:
        return self.text[self.line_starts[i]:self.line_end(i)]

    def line_at(self, off: int) -> int:
        return max(0, bisect.bisect_right(self.line_starts, off) - 1)

    def page_at(self, off: int) -> Tuple[int, Optional[str]]:
        """(physical page number, printed page label if one was detected)."""
        i = max(0, bisect.bisect_right(self.page_starts, off) - 1)
        return i + 1, self.page_labels[i] if i < len(self.page_labels) else None

    def anchor_near(self, off: int, window: int = 400) -> Optional[str]:
        """Closest anchor at or before ``off`` (within ``window`` chars)."""
        i = bisect.bisect_right(self.anchors, (off, "￿")) - 1
        if i >= 0 and off - self.anchors[i][0] <= window:
            return self.anchors[i][1]
        return None

    def to_dict(self) -> Dict:
        return {"v": PARSER_VERSION, "text": self.text, "line_starts": self.line_starts,
                "line_emph": [1 if e else 0 for e in self.line_emph], "anchors": self.anchors,
                "page_starts": self.page_starts, "page_labels": self.page_labels, "furniture": self.furniture}

    @classmethod
    def from_dict(cls, d: Dict) -> "ParsedDoc":
        return cls(text=d["text"], line_starts=list(d["line_starts"]), line_emph=[bool(x) for x in d["line_emph"]],
                   anchors=[(int(a), str(b)) for a, b in d.get("anchors", [])],
                   page_starts=list(d.get("page_starts") or [0]), page_labels=list(d.get("page_labels") or [None]),
                   furniture=list(d.get("furniture") or []))


class _Builder:
    def __init__(self) -> None:
        self.lines: List[str] = []
        self.emph: List[bool] = []
        self.starts: List[int] = []
        self.offset = 0
        self.cur: List[Tuple[str, bool]] = []
        self.pending_anchors: List[str] = []
        self.anchors: List[Tuple[int, str]] = []
        self.break_lines: List[int] = []           # line index where a new page starts
        self.pending_break = False

    def text(self, s: str, emph: bool) -> None:
        if s:
            self.cur.append((s, emph))

    def anchor(self, name: str) -> None:
        self.pending_anchors.append(name)

    def page_break(self) -> None:
        self.newline()
        self.pending_break = True

    def newline(self) -> None:
        if not self.cur:
            return
        raw = "".join(s for s, _ in self.cur)
        line = normalize_line(raw)
        if line:
            total = sum(len(_WS.sub("", s)) for s, _ in self.cur)
            strong = sum(len(_WS.sub("", s)) for s, e in self.cur if e)
            if self.lines:
                self.offset += 1                     # the "\n" joining lines
            self.starts.append(self.offset)
            self.lines.append(line)
            self.emph.append(total > 0 and strong / total >= 0.9)
            for a in self.pending_anchors:
                self.anchors.append((self.offset, a))
            self.pending_anchors = []
            if self.pending_break:
                self.break_lines.append(len(self.lines) - 1)
                self.pending_break = False
            self.offset += len(line)
        self.cur = []

    def finish(self) -> ParsedDoc:
        self.newline()
        text = "\n".join(self.lines)
        breaks = sorted(set(b for b in self.break_lines if b > 0))
        page_first = [0] + breaks
        page_starts = [self.starts[i] if self.starts else 0 for i in page_first] if self.lines else [0]
        labels: List[Optional[str]] = []
        furniture = [i for i, ln in enumerate(self.lines) if _RUNNING_HEADER.match(ln)]
        # running page headers such as "PART II" / "Item 8" repeated at the top of every page
        short = {}
        for i, ln in enumerate(self.lines):
            if len(ln) <= 20 and _SHORT_HEAD.match(ln):
                short.setdefault(ln.lower(), []).append(i)
        furniture += [i for idx in short.values() if len(idx) >= 3 for i in idx]
        for k, first in enumerate(page_first):
            last = (page_first[k + 1] - 1) if k + 1 < len(page_first) else len(self.lines) - 1
            lab = None
            for j in (last, first):                  # printed number: page footer (or header)
                if 0 <= j < len(self.lines) and _PAGE_LABEL.match(self.lines[j]):
                    lab = self.lines[j]
                    furniture.append(j)
                    break
            labels.append(lab)
        return ParsedDoc(text=text, line_starts=self.starts, line_emph=self.emph,
                         anchors=sorted(set(self.anchors)), page_starts=page_starts, page_labels=labels,
                         furniture=sorted(set(furniture)))


def render_html(html: bytes | str) -> ParsedDoc:
    from bs4 import BeautifulSoup
    from bs4.element import Comment, Declaration, Doctype, NavigableString, ProcessingInstruction, Tag
    if isinstance(html, bytes):
        html = html.decode("utf-8", errors="replace")
    # html.parser (pure Python): lxml has segfaulted on very large iXBRL documents
    soup = BeautifulSoup(html, "html.parser")
    b = _Builder()
    stack: List[Tuple[object, bool, str]] = [(soup, False, "enter")]
    skip_strings = (Comment, Declaration, Doctype, ProcessingInstruction)
    while stack:
        node, emph, phase = stack.pop()
        if phase == "exit":
            name = node.name.lower()
            if name in _CELL:
                b.text(" ", emph)
            elif name in _BLOCK:
                b.newline()
            if _BREAK_AFTER.search(node.get("style") or ""):
                b.page_break()
            continue
        if isinstance(node, NavigableString):
            if not isinstance(node, skip_strings):
                b.text(str(node), emph)
            continue
        if not isinstance(node, Tag):
            continue
        name = (node.name or "").lower()
        if name in _SKIP:
            continue
        style = node.get("style") or ""
        if style and _HIDDEN.search(style):
            continue
        for attr in ("id", "name") if name == "a" else ("id",):
            v = node.get(attr)
            if v:
                b.anchor(str(v))
        if style and _BREAK_BEFORE.search(style):
            b.page_break()
        if name == "br":
            b.newline()
            continue
        if name == "hr":
            b.page_break()
            continue
        e = emph or name in ("b", "strong", "i", "em") or bool(style and (_BOLD.search(style) or _ITALIC.search(style)))
        if name in _BLOCK:
            b.newline()
        stack.append((node, e, "exit"))
        for child in reversed(node.contents):
            stack.append((child, e, "enter"))
    return b.finish()


def render_text(raw: bytes | str) -> ParsedDoc:
    """Plain-text filings (older EDGAR .txt): one line per non-empty line."""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    b = _Builder()
    for ln in raw.splitlines():
        if "\f" in ln:
            b.page_break()
        b.text(ln, False)
        b.newline()
    return b.finish()


def render(raw: bytes, name: str) -> ParsedDoc:
    head = raw[:2048].lower()
    if name.lower().endswith((".htm", ".html", ".xhtml")) or b"<html" in head or b"<div" in head:
        return render_html(raw)
    return render_text(raw)


# ── sectioning ──────────────────────────────────────────────────────────────

ITEM_RE = re.compile(r"^item\s*(\d\.\d{2}|\d{1,2}(?:\s?[a-d](?![a-z]))?)(?![\d])\s*[.:\-–—]?\s*(.*)$", re.I)
PART_RE = re.compile(r"^part\s+(iv|i{1,3})\b\s*[.:\-–—]?\s*(.*)$", re.I)
MAX_HEADING_CHARS = 250
STUB_BODY_CHARS = 400
STUB_LINES = 4

TENK_TITLES = {
    "1": "Business", "1A": "Risk Factors", "1B": "Unresolved Staff Comments", "1C": "Cybersecurity",
    "2": "Properties", "3": "Legal Proceedings", "4": "Mine Safety Disclosures",
    "5": "Market for Registrant's Common Equity, Related Stockholder Matters and Issuer Purchases of Equity Securities",
    "6": "[Reserved]", "7": "Management's Discussion and Analysis of Financial Condition and Results of Operations",
    "7A": "Quantitative and Qualitative Disclosures About Market Risk",
    "8": "Financial Statements and Supplementary Data",
    "9": "Changes in and Disagreements with Accountants on Accounting and Financial Disclosure",
    "9A": "Controls and Procedures", "9B": "Other Information",
    "9C": "Disclosure Regarding Foreign Jurisdictions that Prevent Inspections",
    "10": "Directors, Executive Officers and Corporate Governance", "11": "Executive Compensation",
    "12": "Security Ownership of Certain Beneficial Owners and Management and Related Stockholder Matters",
    "13": "Certain Relationships and Related Transactions, and Director Independence",
    "14": "Principal Accountant Fees and Services", "15": "Exhibits and Financial Statement Schedules",
    "16": "Form 10-K Summary",
}
TENK_PART = {**{k: "I" for k in ("1", "1A", "1B", "1C", "2", "3", "4")},
             **{k: "II" for k in ("5", "6", "7", "7A", "8", "9", "9A", "9B", "9C")},
             **{k: "III" for k in ("10", "11", "12", "13", "14")}, "15": "IV", "16": "IV"}
TENQ_TITLES = {
    ("I", "1"): "Financial Statements", ("I", "2"): "Management's Discussion and Analysis of Financial Condition and Results of Operations",
    ("I", "3"): "Quantitative and Qualitative Disclosures About Market Risk", ("I", "4"): "Controls and Procedures",
    ("II", "1"): "Legal Proceedings", ("II", "1A"): "Risk Factors",
    ("II", "2"): "Unregistered Sales of Equity Securities and Use of Proceeds", ("II", "3"): "Defaults Upon Senior Securities",
    ("II", "4"): "Mine Safety Disclosures", ("II", "5"): "Other Information", ("II", "6"): "Exhibits",
}
EIGHTK_TITLES = {
    "1.01": "Entry into a Material Definitive Agreement", "2.02": "Results of Operations and Financial Condition",
    "2.03": "Creation of a Direct Financial Obligation", "2.05": "Costs Associated with Exit or Disposal Activities",
    "5.02": "Departure/Election of Directors or Officers; Compensatory Arrangements", "5.07": "Submission of Matters to a Vote of Security Holders",
    "7.01": "Regulation FD Disclosure", "8.01": "Other Events", "9.01": "Financial Statements and Exhibits",
}

# user-facing section keys -> (part, item) per form family
SECTION_KEYS: Dict[str, Dict[str, Tuple[str, str]]] = {
    "business": {"10-K": ("I", "1")},
    "risk_factors": {"10-K": ("I", "1A"), "10-Q": ("II", "1A")},
    "cybersecurity": {"10-K": ("I", "1C")},
    "properties": {"10-K": ("I", "2")},
    "legal_proceedings": {"10-K": ("I", "3"), "10-Q": ("II", "1")},
    "mdna": {"10-K": ("II", "7"), "10-Q": ("I", "2")},
    "market_risk": {"10-K": ("II", "7A"), "10-Q": ("I", "3")},
    "financial_statements": {"10-K": ("II", "8"), "10-Q": ("I", "1")},
    "controls": {"10-K": ("II", "9A"), "10-Q": ("I", "4")},
    "results_of_operations": {"8-K": ("", "2.02")},
    "regulation_fd": {"8-K": ("", "7.01")},
    "other_events": {"8-K": ("", "8.01")},
    "exhibit": {"EX": ("", "EX")},
}


def form_family(form: str) -> str:
    f = (form or "").upper().replace("/A", "")
    if f.startswith("EX-"):
        return "EX"
    if f in ("10-K", "10-KT", "20-F", "40-F"):
        return "10-K"
    if f in ("10-Q", "10-QT"):
        return "10-Q"
    if f in ("8-K", "6-K"):
        return "8-K"
    return f


@dataclass
class Section:
    part: str
    item: str
    title: str
    heading: str                 # heading line as printed in the filing
    start: int                   # char offsets into ParsedDoc.text
    end: int
    start_line: int
    end_line: int                # exclusive
    anchor: Optional[str] = None

    @property
    def key(self) -> str:
        return f"{self.part}-{self.item}" if self.part else self.item

    @property
    def label(self) -> str:
        if self.item == "EX":
            return self.title
        p = f"Part {self.part}, " if self.part else ""
        return f"{p}Item {self.item}. {self.title}"

    def section_key(self, form: str) -> Optional[str]:
        fam = form_family(form)
        for k, m in SECTION_KEYS.items():
            if m.get(fam) == (self.part, self.item):
                return k
        return None


def _roman_ord(p: str) -> int:
    return {"I": 1, "II": 2, "III": 3, "IV": 4}.get(p, 0)


def _item_ord(item: str) -> float:
    m = re.match(r"(\d+)(?:\.(\d+))?([A-D]?)", item)
    if not m:
        return 0.0
    return int(m.group(1)) + (int(m.group(2)) / 100 if m.group(2) else 0) + (" ABCD".index(m.group(3) or " ") / 10)


def split_sections(doc: ParsedDoc, form: str, exhibit_title: Optional[str] = None) -> List[Section]:
    """Item sections of a filing document, in document order.

    Exhibits (EX-99.1 earnings releases ...) are a single section."""
    fam = form_family(form)
    n = doc.n_lines
    if fam == "EX" or exhibit_title:
        return [Section("", "EX", exhibit_title or form, doc.line(0) if n else "", 0, len(doc.text), 0, n,
                        doc.anchor_near(0))] if n else []
    heads: List[Tuple[int, str, str, str]] = []        # (line, part, item, heading text)
    part = "I"
    saw_part_line = False
    prev_ord = -1.0
    for i in range(n):
        ln = doc.line(i)
        if len(ln) > MAX_HEADING_CHARS or doc.is_furniture(i):
            continue
        pm = PART_RE.match(ln)
        if pm and fam != "8-K":
            part = pm.group(1).upper()
            saw_part_line = True
            prev_ord = -1.0
            continue
        m = ITEM_RE.match(ln)
        if not m:
            continue
        item = m.group(1).upper().replace(" ", "")
        if fam == "8-K":
            if "." not in item:
                continue
            heads.append((i, "", item, ln))
            continue
        if "." in item:
            continue
        if fam == "10-K":
            if item not in TENK_TITLES:
                continue
            heads.append((i, TENK_PART[item], item, ln))
            continue
        # 10-Q: Part I items 1-4, Part II items 1-6
        o = _item_ord(item)
        if not saw_part_line and o < prev_ord:
            part = "II" if part == "I" else "I"       # numbering restarted: next part (or body after TOC)
        prev_ord = o
        if (part, item) not in TENQ_TITLES:
            if ("II", item) in TENQ_TITLES and part == "I" and item in ("1A", "5", "6"):
                part = "II"                            # 1A / 5 / 6 only exist in Part II
            else:
                continue
        heads.append((i, part, item, ln))

    # a repeated heading of the same item (e.g. "Item 8 (continued)") does not end the section
    heads = [h for k, h in enumerate(heads) if k == 0 or (h[1], h[2]) != (heads[k - 1][1], heads[k - 1][2])]
    cands: Dict[Tuple[str, str], List[Tuple[bool, Section]]] = {}
    for k, (i, p, item, ln) in enumerate(heads):
        j = heads[k + 1][0] if k + 1 < len(heads) else n
        start, end = doc.line_starts[i], doc.line_end(j - 1)
        body = end - doc.line_end(i)
        if j <= i + 1 or body <= 0:
            continue                                   # heading directly followed by a heading: TOC row
        if fam == "10-K":
            title = TENK_TITLES[item]
        elif fam == "10-Q":
            title = TENQ_TITLES[(p, item)]
        else:
            title = EIGHTK_TITLES.get(item, "")
        anchor = next((a for off, a in doc.anchors if off == start), None) or doc.anchor_near(start, 200)
        stub = body < STUB_BODY_CHARS and (j - i) <= STUB_LINES
        cands.setdefault((p, item), []).append((stub, Section(p, item, title, ln, start, end, i, j, anchor)))
    spans: Dict[Tuple[str, str], Section] = {}
    # the body starts at Part I, Item 1: candidates before it are the TOC / cover page
    first = [sec for stub, sec in cands.get(("I", "1"), []) if not stub]
    body_start = max(first, key=lambda s: s.end - s.start).start if first else 0
    for key, cs in cands.items():
        if key != ("I", "1") and any(sec.start >= body_start for _, sec in cs):
            cs = [(stub, sec) for stub, sec in cs if sec.start >= body_start]
        full = [sec for stub, sec in cs if not stub]
        # longest real section; if every candidate is a stub (TOC row with title/page lines, or a
        # genuinely short "None." item), the LAST one: the body follows the table of contents
        spans[key] = max(full, key=lambda s: s.end - s.start) if full else cs[-1][1]
    out = sorted(spans.values(), key=lambda s: s.start)
    if not out and n:
        out = [Section("", "", "Full document", doc.line(0), 0, len(doc.text), 0, n, None)]
    return out


# ── sentence spans (verbatim) ───────────────────────────────────────────────

_SENT_END = re.compile(r"(?<=[.!?])[\"\u201d)]?\s+(?=[A-Z0-9(\"\u201c\u2022$])|\n")
_ABBREV = re.compile(r"(?:\b(?:U\.S|Inc|Corp|Co|Ltd|No|Nos|vs|approx|e\.g|i\.e|Mr|Ms|Dr|Jr|St|Fig|etc)\.|\b[A-Z]\.)$")
_CLOSERS = "\"\u201d)"


def sentence_spans(text: str, start: int, end: int) -> List[Tuple[int, int]]:
    """Sentence (start, end) offsets inside text[start:end]; never crosses a line."""
    out: List[Tuple[int, int]] = []
    s = start
    for m in _SENT_END.finditer(text, start, end):
        g = m.group(0)
        if g == "\n":
            cut = m.start()
        else:
            if _ABBREV.search(text[max(s, m.start() - 8):m.start()]):
                continue
            cut = m.start() + (len(g) - len(g.lstrip(_CLOSERS)))   # keep a closing quote / paren
        if cut > s:
            out.append(_trim(text, s, cut))
        s = m.end()
    if s < end:
        out.append(_trim(text, s, end))
    return [(a, b) for a, b in out if b > a]


def _trim(text: str, a: int, b: int) -> Tuple[int, int]:
    while a < b and text[a].isspace():
        a += 1
    while b > a and text[b - 1].isspace():
        b -= 1
    return a, b


def verify_excerpt(doc: ParsedDoc, start: int, end: int, excerpt: str) -> bool:
    return 0 <= start <= end <= len(doc.text) and doc.text[start:end] == excerpt
