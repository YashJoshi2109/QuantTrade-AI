"""Instrument identity checks.

Tickers get reassigned. PARA was Paramount Global until the Skydance merger
(the company traded as PSKY, then SKYD after its Oct 2026 rename); SEC's ticker map now points PARA at an
unrelated filer (Parabolic Technologies). Our symbols table still said
"Paramount Global", so the Research page mixed one company's name with
another's filings. These helpers detect that disagreement so endpoints can
say so instead of silently showing a different company.
"""
from __future__ import annotations

import re
from typing import Optional

# Tickers whose previous holder was delisted / merged / renamed and that we know
# about. A hit always flags the ticker ("changed") and points at the successor;
# scripts/refresh_symbol_identity.py also uses it to rename stale symbols rows
# and to make sure the successor symbol exists.
KNOWN_TICKER_CHANGES: dict[str, dict[str, str]] = {
    # Chain per SEC submissions for CIK 0002041610: Paramount Global merged into
    # Paramount Skydance Corp (PSKY) on 2025-08-07, which was renamed Skydance
    # Corp (SKYD) on 2026-10-06. SEC's ticker map now gives PARA to Parabolic
    # Technologies and no longer lists PSKY.
    "PARA": {
        "former_name": "Paramount Global",
        "successor": "SKYD",
        "successor_name": "Skydance Corp",
        "note": ("Paramount Global merged with Skydance in Aug 2025 (traded as PSKY); "
                 "the company was renamed Skydance Corp in Oct 2026 and trades as SKYD."),
    },
    "PSKY": {
        "former_name": "Paramount Skydance Corp",
        "successor": "SKYD",
        "successor_name": "Skydance Corp",
        "note": "Paramount Skydance Corp was renamed Skydance Corp in Oct 2026 and now trades as SKYD.",
    },
    "SQ": {
        "former_name": "Block Inc",
        "successor": "XYZ",
        "successor_name": "Block Inc",
        "note": "Block, Inc. changed its ticker from SQ to XYZ in Jan 2025.",
    },
    "FB": {
        "former_name": "Meta Platforms Inc",
        "successor": "META",
        "successor_name": "Meta Platforms Inc",
        "note": "Meta Platforms (formerly Facebook) changed its ticker from FB to META in Jun 2022.",
    },
    "ANTM": {
        "former_name": "Anthem Inc",
        "successor": "ELV",
        "successor_name": "Elevance Health Inc",
        "note": "Anthem renamed itself Elevance Health and changed its ticker from ANTM to ELV in Jun 2022.",
    },
}


def _merge_lifecycle() -> None:
    """Every audited retirement (app.services.ticker_lifecycle) is also a known
    ticker change, so identity/copilot flag SQ, PXD, MMC, SATS... too. The
    hand-written entries above win where both exist."""
    from app.services.ticker_lifecycle import RETIREMENTS

    for sym, r in RETIREMENTS.items():
        if sym in KNOWN_TICKER_CHANGES:
            continue
        entry = {"former_name": r.former_name, "note": r.note}
        if r.successor:
            entry["successor"] = r.successor
        KNOWN_TICKER_CHANGES[sym] = entry


_merge_lifecycle()

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
    if joined_a == acro_b or joined_b == acro_a:
        return True
    # Brand built on the acronym: "GE Aerospace" vs "General Electric Co".
    return (len(acro_b) >= 2 and acro_b in ta) or (len(acro_a) >= 2 and acro_a in tb)


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
        out["successor_symbol"] = known.get("successor")
        out["identity_note"] = f"{known['note']} {t} now refers to {filer_name}."
    return out


def ticker_identity(ticker: str, listed_name: Optional[str], filer_name: Optional[str]) -> dict:
    """Single identity verdict for a ticker, shared by the Research API and copilot.

    status:
      ok       - nothing contradicts our listing
      changed  - a known delisting/merger/rename (KNOWN_TICKER_CHANGES)
      mismatch - our listed name disagrees with the current SEC filer for the ticker
    """
    t = (ticker or "").upper()
    base = {"ticker": t, "listed_name": listed_name, "filer_name": filer_name}
    known = KNOWN_TICKER_CHANGES.get(t)
    if known:
        return {**base, "status": "changed", "note": known["note"],
                "former_name": known["former_name"], "successor_symbol": known.get("successor")}
    chk = identity_check(t, listed_name, filer_name)
    if chk["identity_status"] == "mismatch":
        return {**base, "status": "mismatch", "note": chk["identity_note"],
                "former_name": chk.get("former_name"), "successor_symbol": chk.get("successor_symbol")}
    return {**base, "status": "ok", "note": None, "former_name": None, "successor_symbol": None}
