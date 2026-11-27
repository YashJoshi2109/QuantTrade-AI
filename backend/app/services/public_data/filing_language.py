"""Filing language metrics, computed in-house from the filings RAG pipeline.

Per 10-K / 10-Q (latest few of each), for the whole document and for Item 1A
Risk Factors and MD&A:

* length         words, sentences
* readability    Gunning Fog = 0.4 x (words/sentence + 100 x complex/words),
                 complex = 3+ syllables; Flesch reading ease =
                 206.835 - 1.015 x words/sentence - 84.6 x syllables/word
                 (syllables by a vowel-group heuristic; documented approximation)
* tone counts    occurrences of QuantTrade's own short word lists
                 (``WORD_LISTS``: negative, positive, uncertainty, litigious).
                 The Loughran-McDonald dictionary is NOT used: it is free for
                 academic research only and needs a licence for commercial use
                 (https://sraf.nd.edu/loughranmcdonald-master-dictionary/).
                 These lists are much smaller, hand-picked for 10-K language,
                 and counts are comparable across a company's own filings, not
                 to published LM-based studies.
* similarity     cosine similarity of term-frequency vectors (stop words
                 removed) between this filing's section and the same section of
                 the previous filing of the same form ("Lazy Prices": low
                 similarity = the company changed its disclosure).

``available_at`` = filing date 18:00 ET.  The table is the ML feature table
(one row per accession x section x method_version).
"""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.public_data import FilingLanguageMetric
from app.services.public_data import store
from app.services.public_data.sec_common import date_end_of_day_et, norm_ticker

METHOD_VERSION = "qt-lang-1"
SECTIONS = ("full", "risk_factors", "mdna")
SOURCE = "QuantTrade text metrics of SEC EDGAR filings"

WORD_LISTS: Dict[str, frozenset] = {
    "negative": frozenset("""adverse adversely breach breaches closure closures concern concerns decline declined
        declines declining default defaults deficiency deficit delay delayed delays deteriorate deteriorated
        deterioration difficult difficulties disruption disruptions downturn failure failures impair impaired
        impairment impairments inability ineffective loss losses negative negatively penalties penalty
        recall recalls restatement restructuring shortage shortages slowdown terminate terminated termination
        unfavorable volatile volatility weak weakened weakness worse write-down write-downs writedown""".split()),
    "positive": frozenset("""achieve achieved advantage advantages benefit benefited benefits best confident
        efficiency efficient enhance enhanced excellent favorable gain gained gains grew growth improve
        improved improvement improvements increase increased innovation innovative leadership opportunities
        opportunity profitable progress record robust strength strengthen strong stronger success successful""".split()),
    "uncertainty": frozenset("""anticipate anticipated approximately assume assumed assumption assumptions
        believe believes could depend depends dependent estimate estimated estimates expect expected
        fluctuate fluctuations indefinite may might possible possibly predict probable risk risks
        uncertain uncertainties uncertainty unknown unpredictable variable whether""".split()),
    "litigious": frozenset("""allegation allegations alleged appeal arbitration attorney claim claimants claims
        complaint complaints court courts defendant defendants indemnification indemnify injunction
        judgment jurisdiction lawsuit lawsuits legal legislation litigation plaintiff plaintiffs proceeding
        proceedings regulation regulations regulatory settlement settlements statute subpoena testimony""".split()),
}
STOP = frozenset("""a about above after again all also an and any are as at be been before being below between both
    but by can could did do does doing during each few for from further had has have having he her here hers
    him his how i if in into is it its itself just may more most must no nor not of off on once only or other
    our ours out over own same she should so some such than that the their theirs them then there these they
    this those through to too under until up very was we were what when where which while who whom why will
    with would you your""".split())

_WORD = re.compile(r"[A-Za-z][A-Za-z'\-]*")
_SENT = re.compile(r"[.!?]+(?=\s+[A-Z(\"']|\s*$)")
_VOWELS = re.compile(r"[aeiouy]+")


def syllables(word: str) -> int:
    w = word.lower().strip("'-")
    if not w:
        return 0
    n = len(_VOWELS.findall(w))
    if w.endswith("e") and not w.endswith(("le", "ee")) and n > 1:
        n -= 1
    if w.endswith(("ed", "es")) and n > 1 and not w.endswith(("ted", "ded", "ses", "zes", "ces", "ges")):
        n -= 1
    return max(n, 1)


def text_metrics(text: str) -> Dict[str, Any]:
    words = _WORD.findall(text or "")
    nw = len(words)
    ns = max(len(_SENT.findall(text or "")), 1 if nw else 0)
    if nw == 0:
        return {"words": 0, "sentences": 0, "fog": None, "flesch": None,
                **{k: 0 for k in WORD_LISTS}}
    syl = [syllables(w) for w in words]
    complex_ = sum(1 for s in syl if s >= 3)
    wps = nw / ns
    lower = [w.lower() for w in words]
    counts = {k: sum(1 for w in lower if w in lst) for k, lst in WORD_LISTS.items()}
    return {"words": nw, "sentences": ns, "fog": round(0.4 * (wps + 100 * complex_ / nw), 2),
            "flesch": round(206.835 - 1.015 * wps - 84.6 * sum(syl) / nw, 2), **counts}


def tf_vector(text: str) -> Counter:
    return Counter(w for w in (x.lower() for x in _WORD.findall(text or "")) if w not in STOP and len(w) > 2)


def cosine(a: Counter, b: Counter) -> Optional[float]:
    if not a or not b:
        return None
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return round(dot / (na * nb), 4) if na and nb else None


def _section_text(ld, key: str) -> Optional[str]:
    if key == "full":
        return ld.doc.text
    sec = ld.section(key)
    if sec is None:
        return None
    return ld.doc.text[sec.start:sec.end]


def compute_ticker(db: Session, ticker: str, *, per_form: int = 3, forms: Sequence[str] = ("10-K", "10-Q"),
                   svc=None) -> Dict[str, Any]:
    """Compute and store metrics for the latest ``per_form`` filings of each form."""
    from app.services.copilot.filings_rag.store import get_service
    svc = svc or get_service()
    t = norm_ticker(ticker)
    refs = svc.filings(t, list(forms), per_form + 1)
    have = {(a, s) for a, s in db.query(FilingLanguageMetric.accession, FilingLanguageMetric.section)
            .filter(FilingLanguageMetric.ticker == t, FilingLanguageMetric.method_version == METHOD_VERSION)}
    rows, errors = [], []
    for form in forms:
        fr = [r for r in refs if r.form.replace("/A", "") == form and not r.form.endswith("/A")]
        loaded: Dict[str, Any] = {}

        def load(ref):
            if ref.accession not in loaded:
                try:
                    loaded[ref.accession] = svc.load(ref)
                except LookupError as e:
                    errors.append(f"{ref.form} {ref.accession}: {e}")
                    loaded[ref.accession] = None
            return loaded[ref.accession]

        for i, ref in enumerate(fr[:per_form]):
            if all((ref.accession, s) in have for s in SECTIONS):
                continue
            ld = load(ref)
            if ld is None:
                continue
            prev_ref = fr[i + 1] if i + 1 < len(fr) else None
            prev_ld = load(prev_ref) if prev_ref is not None else None
            for s in SECTIONS:
                txt = _section_text(ld, s)
                if txt is None:
                    continue
                m = text_metrics(txt)
                sim = None
                if prev_ld is not None and s != "full":
                    ptxt = _section_text(prev_ld, s)
                    sim = cosine(tf_vector(txt), tf_vector(ptxt)) if ptxt else None
                elif prev_ld is not None:
                    sim = cosine(tf_vector(txt), tf_vector(prev_ld.doc.text))
                rows.append({"ticker": t, "cik": ref.cik, "accession": ref.accession, "form": ref.form,
                             "filed_date": ref.filing_date, "report_date": ref.report_date or None, "section": s,
                             **m, "similarity_prev": sim,
                             "prev_accession": prev_ref.accession if (prev_ref is not None and sim is not None) else None,
                             "method_version": METHOD_VERSION, "available_at": date_end_of_day_et(ref.filing_date),
                             "source": f"{SOURCE}: {ref.form} filed {ref.filing_date}, accession {ref.accession}"})
    n = store.upsert(db, FilingLanguageMetric, rows, ("accession", "section", "method_version"))
    store.mark_load(db, "filing_lang", t, rows=n, note="; ".join(errors)[:1500] or None)
    return {"ticker": t, "rows": n, "errors": errors}


def language_payload(db: Session, ticker: str, *, limit: int = 8, as_of=None) -> Dict[str, Any]:
    from app.services.public_data.sources import attribution
    t = norm_ticker(ticker)
    q = db.query(FilingLanguageMetric).filter(FilingLanguageMetric.ticker == t,
                                              FilingLanguageMetric.method_version == METHOD_VERSION)
    if as_of is not None:
        q = q.filter(FilingLanguageMetric.available_at <= as_of)
    rows = q.order_by(FilingLanguageMetric.filed_date.desc()).all()
    filings: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        f = filings.setdefault(r.accession, {"accession": r.accession, "form": r.form, "filed": r.filed_date,
                                             "report_date": r.report_date, "sections": {}})
        per_k = (lambda c: round(c / r.words * 1000, 2) if r.words else None)
        f["sections"][r.section] = {
            "words": r.words, "sentences": r.sentences, "fog": r.fog, "flesch": r.flesch,
            "negative": r.negative, "positive": r.positive, "uncertainty": r.uncertainty, "litigious": r.litigious,
            "negative_per_1k": per_k(r.negative), "uncertainty_per_1k": per_k(r.uncertainty),
            "similarity_prev": r.similarity_prev, "prev_accession": r.prev_accession}
    lst = sorted(filings.values(), key=lambda f: (f["filed"] or "", f["accession"]), reverse=True)[:limit]
    latest = lst[0]["filed"] if lst else None
    return {"ticker": t, "status": "ok" if lst else "not_loaded", "method_version": METHOD_VERSION,
            "filings": lst,
            "notes": ["Tone counts use QuantTrade's own short word lists (not the Loughran-McDonald dictionary).",
                      "similarity_prev = cosine similarity with the same section of the previous filing of the "
                      "same form (1 = unchanged wording)."],
            "attribution": attribution("filing_lang", latest)}
