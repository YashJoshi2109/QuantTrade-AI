"""
Cheap English-language gate for headlines (no model, no dependency).

Wire services (Business Wire, PR Newswire) republish the same release in many
languages; on 2026-11-25 roughly a quarter of the "other" bucket was German,
French, Spanish, Italian, Dutch, Slovak, Arabic and Chinese translations. The
classifiers are English models, so these items are noise: drop them at ingest.

Heuristic, tuned for precision on short headlines:
  1. mostly non-Latin script, or a run of 4+ CJK/Arabic/Cyrillic/... chars -> not English
  2. starts with a known translated-summary marker ("Resumen:", ...) -> not English
  3. contains accented Latin letters AND a foreign function word -> not English
  4. has >= 2 foreign function words and no English function word -> not English
  5. >6% accented letters and no English function word -> not English
Everything else is treated as English (all-caps tickers, numbers and proper
nouns must not be dropped).
"""
from __future__ import annotations

import re

_SUMMARY_MARKERS = re.compile(
    r"^\s*(?:resumen|riassunto|samenvatting|zusammenfassung|résumé|resumo|sammanfattning|"
    r"podsumowanie|özet|tiivistelmä|sammendrag|resum)\s*[:：]",
    re.IGNORECASE,
)

_ENGLISH = frozenset(
    "the a an and of to in on for with as at by from is are was be its it this that "
    "after over into amid than vs new says will has have how why what who".split()
)
_FOREIGN = frozenset(
    # de
    "der die das und mit für eine einen ein auf im zur zum den dem des ist wird bei von dass mehr werden sich nicht "
    # fr
    "le la les et pour avec une des du au aux sur dans est pour sa ses leur "
    # es / pt
    "el los las y para con una del al se por su sus em com uma não "
    # it
    "il gli e per con una della delle nel nella sul alla "
    # nl
    "het een en voor met van om te bij "
    # sk / cs / pl
    "na pre pri sa je ako oraz dla".split()
) - _ENGLISH

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
# 4+ consecutive CJK / Arabic / Cyrillic / Hebrew / Thai / Hangul / Devanagari chars
_NON_LATIN_RUN = re.compile(
    r"[\u0400-\u04FF\u0590-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]{4,}"
)
_ACCENTED = re.compile(r"[à-öø-ÿÀ-ÖØ-ßĀ-ž]")


def is_english(text: str) -> bool:
    if not text:
        return True
    letters = [ch for ch in text if ch.isalpha()]
    if letters:
        latin = sum(1 for ch in letters if ch < "ɐ")
        if latin / len(letters) < 0.6:
            return False
    if _NON_LATIN_RUN.search(text):
        return False
    if _SUMMARY_MARKERS.search(text):
        return False
    words = [w.lower() for w in _WORD.findall(text)]
    foreign = sum(1 for w in words if w in _FOREIGN)
    english = sum(1 for w in words if w in _ENGLISH)
    if foreign and _ACCENTED.search(text) and english <= foreign:
        return False
    if foreign >= 2 and english == 0:
        return False
    # Icelandic/Nordic/Central-European headlines with no function-word hits:
    # a high share of accented letters and no English function word.
    if letters and english == 0 and len(_ACCENTED.findall(text)) / len(letters) > 0.06:
        return False
    return True
