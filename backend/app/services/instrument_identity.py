"""Instrument identity checks.

Tickers get reassigned. PARA was Paramount Global until the Skydance merger
(the company now trades as PSKY); SEC's ticker map now points PARA at an
unrelated filer (Parabolic Technologies). Our symbols table still said
"Paramount Global", so the Research page mixed one company's name with
another's filings. These helpers detect that disagreement so endpoints can
say so instead of silently showing a different company.
"""
from __future__ import annotations

import re
from typing import Optional

# Tickers whose previous holder was delisted / merged and that we know about.
# Used only to annotate a detected mismatch with a pointer to the successor.
KNOWN_TICKER_CHANGES: dict[str, dict[str, str]] = {
    "PARA": {
        "former_name": "Paramount Global",
        "successor": "PSKY",
        "note": "Paramount Global merged with Skydance in Aug 2025 and now trades as PSKY.",
    },
}

_STOP_WORDS = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
    "plc", "llc", "lp", "holdings", "holding", "group", "the", "class", "sa", "nv",
    "ag", "se", "de", "of", "and", "common", "stock", "shares", "ordinary", "new",
    "a", "b", "c",
}


def _tokens(name: Optional[str]) -> list[str]:
    words = re.findall(r"[a-z0-9]+", (name or "").lower())
    return [w for w in words if w not in _STOP_WORDS]


def names_match(a: Optional[str], b: Optional[str]) -> bool:
    """Loose same-company check between two display names.

    True when either name is missing (nothing to contradict), when the two share a
    significant word, or when one is the acronym of the other (IBM vs International
    Business Machines). "Paramount Global" vs "Parabolic Technologies" -> False.
    """
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return True
    if set(ta) & set(tb):
        return True
    joined_a, joined_b = "".join(ta), "".join(tb)
    if joined_a == joined_b:
        return True
    acro_a = "".join(w[0] for w in ta)
    acro_b = "".join(w[0] for w in tb)
    return joined_a == acro_b or joined_b == acro_a


def identity_check(ticker: str, listed_name: Optional[str], filer_name: Optional[str]) -> dict:
    """Compare our listed name with the authoritative filer name for a ticker."""
    t = (ticker or "").upper()
    if names_match(listed_name, filer_name):
        return {"identity_status": "ok"}
    out = {
        "identity_status": "mismatch",
        "listed_name": listed_name,
        "identity_note": (
            f"{t} now refers to {filer_name}; our listing still says {listed_name}. "
            "The ticker was likely reassigned after a delisting or merger."
        ),
    }
    known = KNOWN_TICKER_CHANGES.get(t)
    if known:
        out["former_name"] = known["former_name"]
        out["successor_symbol"] = known["successor"]
        out["identity_note"] = f"{known['note']} {t} now refers to {filer_name}."
    return out
