"""Section-bounded chunks and an in-memory Okapi BM25 index over them.

Chunks never cross a section boundary and are contiguous spans of
``ParsedDoc.text``: ``excerpt == doc.text[start:end]`` by construction.  Each
chunk carries its section, nearest sub-heading (emphasized line, e.g. the risk
factor title or "Note 12 - Leases"), printed/physical page and HTML anchor.

Scoring is textbook Okapi BM25 (Robertson & Zaragoza 2009):

    idf(t)    = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
    score(D)  = sum_t idf(t) * tf(t,D) * (k1 + 1) / (tf(t,D) + k1 * (1 - b + b * |D| / avgdl))

with k1 = 1.2, b = 0.75 and the copilot's shared tokenizer (``bm25.tokenize``).
When the Qdrant filing index is configured, its hybrid hits for the same
accessions are mapped back onto these chunks and fused with reciprocal-rank
fusion (k = 60); the excerpt is still the local verbatim span.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from app.services.copilot import bm25
from app.services.copilot.filings_rag.parse import ParsedDoc, Section, sentence_spans

K1 = 1.2
B = 0.75
CHUNK_WORDS = 220
SUBHEADING_MAX_WORDS = 40


@dataclass
class Chunk:
    start: int
    end: int
    section: Section
    subheading: Optional[str] = None
    page: Optional[int] = None
    page_label: Optional[str] = None
    anchor: Optional[str] = None


def _subheading(doc: ParsedDoc, section: Section, line: int) -> Optional[str]:
    """Closest emphasized short line at or above ``line`` inside the section."""
    for i in range(line, section.start_line, -1):
        if doc.line_emph[i]:
            t = doc.line(i)
            if len(t.split()) <= SUBHEADING_MAX_WORDS:
                return t
    return None


def chunk_section(doc: ParsedDoc, section: Section, max_words: int = CHUNK_WORDS) -> List[Chunk]:
    """Pack whole lines into chunks of <= max_words; an over-long line is cut at
    sentence boundaries.  A sub-heading line starts a new chunk."""
    spans: List[Tuple[int, int, int]] = []          # (start, end, first line)
    cur_s = cur_e = None
    cur_line = 0
    words = 0

    def flush():
        nonlocal cur_s, cur_e, words
        if cur_s is not None and cur_e > cur_s:
            spans.append((cur_s, cur_e, cur_line))
        cur_s = cur_e = None
        words = 0

    for i in range(section.start_line, section.end_line):
        if doc.is_furniture(i):
            flush()                                  # page number / running header: never inside a chunk
            continue
        a, b = doc.line_starts[i], doc.line_end(i)
        w = len(doc.text[a:b].split())
        heading = doc.line_emph[i] and w <= SUBHEADING_MAX_WORDS
        if heading and cur_s is not None and words > 30:
            flush()
        if w > max_words:
            flush()
            sa = sb = None
            sw = 0
            for x, y in sentence_spans(doc.text, a, b):
                n = len(doc.text[x:y].split())
                if sa is not None and sw + n > max_words:
                    spans.append((sa, sb, i))
                    sa, sw = None, 0
                if sa is None:
                    sa = x
                sb, sw = y, sw + n
            if sa is not None:
                spans.append((sa, sb, i))
            continue
        if cur_s is not None and words + w > max_words:
            flush()
        if cur_s is None:
            cur_s, cur_line = a, i
        cur_e = b
        words += w
    flush()

    out = []
    for s, e, ln in spans:
        page, label = doc.page_at(s)
        out.append(Chunk(s, e, section, _subheading(doc, section, ln), page, label,
                         doc.anchor_near(s) or section.anchor))
    return out


class BM25Index:
    def __init__(self, docs: Sequence[Sequence[str]], k1: float = K1, b: float = B):
        self.k1, self.b = k1, b
        self.tf = [Counter(d) for d in docs]
        self.len = [len(d) for d in docs]
        self.N = len(docs)
        self.avgdl = (sum(self.len) / self.N) if self.N else 0.0
        df: Counter = Counter()
        for c in self.tf:
            df.update(c.keys())
        self.df = df

    def idf(self, term: str) -> float:
        n = self.df.get(term, 0)
        return math.log(1 + (self.N - n + 0.5) / (n + 0.5))

    def score(self, query: Sequence[str], i: int) -> float:
        tf, dl = self.tf[i], self.len[i]
        if not dl or not self.avgdl:
            return 0.0
        s = 0.0
        for t in set(query):
            f = tf.get(t, 0)
            if f:
                s += self.idf(t) * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
        return s

    def search(self, query: Sequence[str], top: int = 10, allowed: Optional[set] = None) -> List[Tuple[int, float]]:
        res = [(i, self.score(query, i)) for i in range(self.N) if allowed is None or i in allowed]
        res = [r for r in res if r[1] > 0]
        res.sort(key=lambda r: (-r[1], r[0]))
        return res[:top]


def chunk_tokens(doc: ParsedDoc, c: Chunk) -> List[str]:
    # the sub-heading / section title count as context words for ranking only
    ctx = " ".join(x for x in (c.section.title, c.subheading) if x)
    return bm25.tokenize(ctx + " " + doc.text[c.start:c.end])


def rrf(rankings: Sequence[Sequence[int]], k: int = 60) -> List[Tuple[int, float]]:
    score: Dict[int, float] = {}
    for lst in rankings:
        for rank, i in enumerate(lst):
            score[i] = score.get(i, 0.0) + 1.0 / (k + rank + 1)
    return sorted(score.items(), key=lambda x: (-x[1], x[0]))


_NORM = re.compile(r"\s+")


def locate(doc_text: str, snippet: str, min_chars: int = 60) -> int:
    """Offset of a (whitespace-insensitive) snippet in the document, or -1."""
    probe = _NORM.sub(" ", snippet or "").strip()[:min_chars]
    if len(probe) < 20:
        return -1
    return doc_text.find(probe)
