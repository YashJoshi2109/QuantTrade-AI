"""Cross-filing diff of one section (e.g. Item 1A across the last N 10-Ks).

Units
  * risk_factor: an emphasized (bold/italic) heading line plus the body lines
    under it.  An emphasized line followed directly by another one is a
    category header ("Risks Related to Our Industry") and labels the units
    below it.  Used for Risk Factors when the section has >= 3 such headings.
  * paragraph: every prose line of >= 12 words (table rows, which are mostly
    numbers, are skipped).  Used for MD&A etc. and as the fallback.

Matching (older -> newer), deterministic:
  1. identical normalized heading (risk factors) or identical text (paragraphs)
  2. greedy best Jaccard similarity of token sets >= MATCH_JACCARD
  3. unmatched new units = added, unmatched old units = removed
A matched pair is ``unchanged`` when the token sequences are equal, a
``minor_edit`` when difflib ratio >= MINOR_RATIO and no number changed, and
``changed`` otherwise.  Inserted / deleted phrases are verbatim spans of the
respective filing (difflib opcodes over tokens mapped back to char offsets).
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from app.services.copilot.filings_rag.facts import FilingDiffFact, FilingExcerptFact
from app.services.copilot.filings_rag.parse import Section, sentence_spans
from app.services.copilot.filings_rag.store import FilingsService, LoadedDoc

MATCH_JACCARD = 0.45
MINOR_RATIO = 0.97
HEADING_MAX_WORDS = 120
PARA_MIN_WORDS = 12
EXCERPT_CHARS = 700
PHRASES = 6
PHRASE_CHARS = 300

_TOK = re.compile(r"[A-Za-z0-9$]+(?:[.,'’][A-Za-z0-9]+)*%?")
_NUMTOK = re.compile(r"\d")
_QUOTES = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"'})


@dataclass
class Unit:
    start: int
    end: int
    heading: Optional[str] = None
    category: Optional[str] = None
    toks: List[str] = field(default_factory=list)          # normalized tokens
    spans: List[Tuple[int, int]] = field(default_factory=list)
    lines: List[int] = field(default_factory=list)

    @property
    def key(self) -> str:
        return " ".join(_norm_tokens(self.heading)) if self.heading else " ".join(self.toks)


def _norm_tokens(text: Optional[str]) -> List[str]:
    return [m.group(0).lower().translate(_QUOTES) for m in _TOK.finditer((text or "").translate(_QUOTES))]


def _tokenize(text: str, start: int, end: int) -> Tuple[List[str], List[Tuple[int, int]]]:
    toks, spans = [], []
    for m in _TOK.finditer(text, start, end):
        toks.append(m.group(0).lower().translate(_QUOTES))
        spans.append((m.start(), m.end()))
    return toks, spans


def _numeric_share(text: str) -> float:
    toks = text.split()
    return sum(1 for t in toks if _NUMTOK.search(t)) / max(1, len(toks))


def section_units(ld: LoadedDoc, sec: Section, mode: str = "auto") -> Tuple[List[Unit], str]:
    doc = ld.doc
    # skip the item heading line and page furniture (page numbers, running headers)
    lines = [i for i in range(sec.start_line + 1, sec.end_line) if not doc.is_furniture(i)]
    units: List[Unit] = []
    if mode in ("auto", "risk_factor"):
        category = None
        cur: Optional[Unit] = None
        cur_has_body = False
        for i in lines:
            t = doc.line(i)
            a, b = doc.line_starts[i], doc.line_end(i)
            if doc.line_emph[i] and len(t.split()) <= HEADING_MAX_WORDS:
                if cur is not None and not cur_has_body:
                    category = cur.heading                     # heading followed by heading: category
                    units.pop()
                cur = Unit(a, b, heading=t, category=category, lines=[i])
                units.append(cur)
                cur_has_body = False
            elif cur is not None:
                cur.end = b
                cur.lines.append(i)
                cur_has_body = True
        if cur is not None and not cur_has_body:
            units.pop()
        if len(units) >= 3 or mode == "risk_factor":
            for u in units:                                    # furniture lines inside a span are not tokens
                for i in u.lines:
                    t, sp = _tokenize(doc.text, doc.line_starts[i], doc.line_end(i))
                    u.toks += t
                    u.spans += sp
            return units, "risk_factor"
        units = []
    for i in lines:
        t = doc.line(i)
        if len(t.split()) < PARA_MIN_WORDS or _numeric_share(t) > 0.3:
            continue
        a, b = doc.line_starts[i], doc.line_end(i)
        u = Unit(a, b)
        u.toks, u.spans = _tokenize(doc.text, a, b)
        units.append(u)
    return units, "paragraph"


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def match_units(old: List[Unit], new: List[Unit]) -> List[Tuple[int, int]]:
    """One-to-one (old_index, new_index) pairs."""
    pairs: List[Tuple[int, int]] = []
    used_o, used_n = set(), set()
    by_key: Dict[str, List[int]] = {}
    for i, u in enumerate(old):
        by_key.setdefault(u.key, []).append(i)
    for j, u in enumerate(new):
        cands = [i for i in by_key.get(u.key, []) if i not in used_o]
        if cands and u.key:
            pairs.append((cands[0], j))
            used_o.add(cands[0])
            used_n.add(j)
    rest_o = [i for i in range(len(old)) if i not in used_o]
    rest_n = [j for j in range(len(new)) if j not in used_n]
    sets_o = {i: set(old[i].toks) for i in rest_o}
    sets_n = {j: set(new[j].toks) for j in rest_n}
    cands = []
    for j in rest_n:
        for i in rest_o:
            s = _jaccard(sets_o[i], sets_n[j])
            if s >= MATCH_JACCARD:
                cands.append((-s, i, j))
    cands.sort()
    for _, i, j in cands:
        if i in used_o or j in used_n:
            continue
        pairs.append((i, j))
        used_o.add(i)
        used_n.add(j)
    return sorted(pairs, key=lambda p: p[1])


def _phrases(text: str, spans: List[Tuple[int, int]], ranges: List[Tuple[int, int]]) -> List[str]:
    out = []
    for lo, hi in ranges:
        if hi <= lo:
            continue
        a, b = spans[lo][0], spans[hi - 1][1]
        if hi - lo < 2 and not _NUMTOK.search(text[a:b]):
            continue                                            # single word edits are noise
        if b - a > PHRASE_CHARS:
            b = a + PHRASE_CHARS
            cut = text.rfind(" ", a, b)
            b = cut if cut > a else b
        out.append(text[a:b])
        if len(out) >= PHRASES:
            break
    return out


@dataclass
class PairDiff:
    added: List[int]
    removed: List[int]
    changed: List[Tuple[int, int, float, List[str], List[str], bool]]   # old, new, ratio, ins, dels, numbers
    minor: int
    unchanged: int


def diff_units(old_ld: LoadedDoc, old: List[Unit], new_ld: LoadedDoc, new: List[Unit]) -> PairDiff:
    pairs = match_units(old, new)
    mo = {i for i, _ in pairs}
    mn = {j for _, j in pairs}
    changed, minor, unchanged = [], 0, 0
    for i, j in pairs:
        a, b = old[i], new[j]
        if a.toks == b.toks:
            unchanged += 1
            continue
        sm = difflib.SequenceMatcher(None, a.toks, b.toks, autojunk=False)
        ratio = sm.ratio()
        nums_changed = {t for t in a.toks if _NUMTOK.search(t)} != {t for t in b.toks if _NUMTOK.search(t)}
        if ratio >= MINOR_RATIO and not nums_changed:
            minor += 1
            continue
        ins, dels = [], []
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op in ("insert", "replace"):
                ins.append((j1, j2))
            if op in ("delete", "replace"):
                dels.append((i1, i2))
        changed.append((i, j, round(ratio, 4), _phrases(new_ld.doc.text, b.spans, ins),
                        _phrases(old_ld.doc.text, a.spans, dels), nums_changed))
    changed.sort(key=lambda c: (c[2], c[1]))                    # most rewritten first
    return PairDiff(added=[j for j in range(len(new)) if j not in mn],
                    removed=[i for i in range(len(old)) if i not in mo],
                    changed=changed, minor=minor, unchanged=unchanged)


def _clip_end(ld: LoadedDoc, u: Unit, limit: int = EXCERPT_CHARS) -> Tuple[int, bool]:
    """End offset of a verbatim excerpt of the unit, cut at a sentence end."""
    if u.end - u.start <= limit:
        return u.end, False
    best = None
    for a, b in sentence_spans(ld.doc.text, u.start, u.end):
        if b - u.start > limit:
            break
        best = b
    if best is None or best - u.start < limit // 3:
        cut = ld.doc.text.rfind(" ", u.start, u.start + limit)
        best = cut if cut > u.start else u.start + limit
    return best, True


def _words(ld: LoadedDoc, sec: Section) -> int:
    return len(ld.doc.text[sec.start:sec.end].split())


def diff_section(svc: FilingsService, docs: List[LoadedDoc], section_key: str, max_items: int = 8,
                 mode: str = "auto") -> Tuple[List[FilingDiffFact], List[FilingExcerptFact], List[str]]:
    """``docs`` newest first.  Compares each consecutive pair (older -> newer)."""
    summaries: List[FilingDiffFact] = []
    units_out: List[FilingExcerptFact] = []
    unavailable: List[str] = []
    secs = []
    for ld in docs:
        sec = ld.section(section_key)
        if sec is None:
            unavailable.append(f"{section_key} section not found in {ld.form} filed {ld.ref.filing_date} "
                               f"(accession {ld.ref.accession}); sections found: {ld.found_sections() or 'none'}")
        secs.append(sec)
    for k in range(len(docs) - 1):
        new_ld, old_ld = docs[k], docs[k + 1]
        new_sec, old_sec = secs[k], secs[k + 1]
        if new_sec is None or old_sec is None:
            continue
        m = "risk_factor" if (mode == "auto" and section_key == "risk_factors") else ("paragraph" if mode == "auto" else mode)
        old_u, mode_o = section_units(old_ld, old_sec, m if m != "risk_factor" else "auto")
        new_u, mode_n = section_units(new_ld, new_sec, m if m != "risk_factor" else "auto")
        if mode_o != mode_n:                                    # compare like with like
            old_u, mode_o = section_units(old_ld, old_sec, "paragraph")
            new_u, mode_n = section_units(new_ld, new_sec, "paragraph")
        pd = diff_units(old_ld, old_u, new_ld, new_u)
        prior = {"filing_date": old_ld.ref.filing_date, "report_date": old_ld.ref.report_date,
                 "accession": old_ld.ref.accession, "url": old_ld.url(old_sec.anchor), "words": _words(old_ld, old_sec),
                 "section": old_sec.label}
        cur = {"filing_date": new_ld.ref.filing_date, "report_date": new_ld.ref.report_date,
               "accession": new_ld.ref.accession, "url": new_ld.url(new_sec.anchor), "words": _words(new_ld, new_sec),
               "section": new_sec.label}
        shown = {"added": min(max_items, len(pd.added)), "removed": min(max_items, len(pd.removed)),
                 "changed": min(max_items, len(pd.changed))}
        summaries.append(FilingDiffFact(
            id=f"secdiff:{new_ld.ref.ticker}:{section_key}:{old_ld.ref.accession}:{new_ld.ref.accession}",
            source=f"SEC EDGAR {new_ld.form} {old_ld.ref.filing_date} vs {new_ld.ref.filing_date} (computed diff)",
            as_of=new_ld.ref.filing_date, ticker=new_ld.ref.ticker, section=new_sec.label, form=new_ld.form,
            prior=prior, current=cur, unit=mode_n, units_prior=len(old_u), units_current=len(new_u),
            added=len(pd.added), removed=len(pd.removed), changed=len(pd.changed), minor_edits=pd.minor,
            unchanged=pd.unchanged, shown=shown,
            method=(f"units={mode_n}; match: same heading/text, else token-set Jaccard >= {MATCH_JACCARD}; "
                    f"minor edit: difflib ratio >= {MINOR_RATIO} with no number changed")))
        for j in pd.added[:max_items]:
            u = new_u[j]
            end, trunc = _clip_end(new_ld, u)
            units_out.append(svc.excerpt(new_ld, u.start, end, section=new_sec, change="added", truncated=trunc,
                                         subheading=u.category))
        for i in pd.removed[:max_items]:
            u = old_u[i]
            end, trunc = _clip_end(old_ld, u)
            units_out.append(svc.excerpt(old_ld, u.start, end, section=old_sec, change="removed", truncated=trunc,
                                         subheading=u.category))
        for i, j, ratio, ins, dels, _nums in pd.changed[:max_items]:
            a, b = old_u[i], new_u[j]
            end_b, trunc_b = _clip_end(new_ld, b)
            end_a, _ = _clip_end(old_ld, a)
            prior_fact = svc.excerpt(old_ld, a.start, end_a, section=old_sec)
            units_out.append(svc.excerpt(new_ld, b.start, end_b, section=new_sec, change="changed",
                                         truncated=trunc_b, prior_excerpt=prior_fact.excerpt,
                                         prior_citation=prior_fact.citation(offsets=False), similarity=ratio,
                                         inserted_text=ins or None, deleted_text=dels or None,
                                         subheading=b.category))
    return summaries, units_out, unavailable
