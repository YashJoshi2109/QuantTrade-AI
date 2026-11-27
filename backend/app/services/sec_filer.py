"""What kind of SEC filer a ticker is, from its EDGAR submissions history.

The Research page picks its SEC panel from this:

* ``domestic`` - files 10-K / 10-Q (US-GAAP XBRL statements we parse).
* ``foreign``  - foreign private issuer, files 20-F / 40-F annual and 6-K
  current reports (often IFRS, which the statement parser does not read).
* ``fund``     - ETF / mutual fund / unit trust: N-CSR, N-PORT, 485BPOS ...
* ``unknown``  - no periodic reports seen (shell, very new filer, or the
  submissions feed was unavailable). The UI treats it like ``domestic``
  and simply shows what EDGAR has, never a "not applicable" verdict.
"""
from __future__ import annotations

import time
from typing import Iterable, Optional

DOMESTIC_FORMS = frozenset({"10-K", "10-K/A", "10-Q", "10-Q/A", "10-KT", "10-KT/A", "10-QT", "10-QT/A"})
FOREIGN_FORMS = frozenset({"20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A", "20FR12B", "40FR12B"})
FUND_FORMS = frozenset({
    "N-CSR", "N-CSR/A", "N-CSRS", "N-CSRS/A", "NPORT-P", "NPORT-P/A", "N-PORT", "N-CEN", "N-CEN/A",
    "485BPOS", "485APOS", "485BXT", "497", "497K", "N-1A", "N-1A/A", "N-2", "N-2/A",
    "24F-2NT", "N-30D", "N-MFP2", "N-MFP3", "N-8F",
})

FILER_TYPES = ("domestic", "foreign", "fund", "unknown")


def classify_forms(forms: Iterable[str]) -> str:
    """Classify a filer from its forms, newest first.

    The newest periodic or fund form decides, so a company that moved from
    20-F to 10-K reporting (or the reverse) gets its current regime. 8-K and
    other event filings are ignored: both domestic and foreign issuers file them.
    """
    for raw in forms:
        form = (raw or "").strip().upper()
        if form in DOMESTIC_FORMS:
            return "domestic"
        if form in FOREIGN_FORMS:
            return "foreign"
        if form in FUND_FORMS:
            return "fund"
    return "unknown"


def classify_submissions(submissions: Optional[dict]) -> str:
    """Classify from an EDGAR ``submissions/CIK##########.json`` payload."""
    if not submissions:
        return "unknown"
    recent = ((submissions.get("filings") or {}).get("recent") or {})
    kind = classify_forms(recent.get("form") or [])
    if kind != "unknown":
        return kind
    # No periodic report in the recent window: investment companies still say so.
    entity = str(submissions.get("entityType") or "").strip().lower()
    if entity in ("investment company", "investment-company", "fund"):
        return "fund"
    return "unknown"


# CIK -> (filer_type, monotonic ts). Filer regime changes at most yearly.
_CACHE: dict[str, tuple[str, float]] = {}
_TTL_S = 24 * 3600.0
_UNKNOWN_TTL_S = 600.0  # retry soon when the submissions feed was down


def filer_type_for_cik(cik: Optional[str], fetch_submissions) -> str:
    """Cached ``classify_submissions`` for a CIK; ``fetch_submissions(cik)`` loads the feed."""
    if not cik:
        return "unknown"
    hit = _CACHE.get(cik)
    now = time.monotonic()
    if hit is not None:
        kind, ts = hit
        if now - ts < (_TTL_S if kind != "unknown" else _UNKNOWN_TTL_S):
            return kind
    try:
        kind = classify_submissions(fetch_submissions(cik))
    except Exception:
        kind = "unknown"
    _CACHE[cik] = (kind, now)
    return kind


def clear_cache() -> None:
    _CACHE.clear()
