"""Ticker lifecycle: which tickers stopped trading (renamed / acquired /
delisted) or were reassigned to a different company (reused), and what to
show instead.

Single source of truth for retirements. It drives:

* the ``symbols`` lifecycle columns (``is_active``, ``delisted_at``,
  ``successor_symbol``, ``status_note``), written idempotently by
  ``apply_retirements`` (deploy: scripts/add_symbol_lifecycle_columns.py);
* exclusion from every list we build or scan (movers, heatmap, universe,
  screener, AI baskets, alert suggestions, calendars, Outlook, search);
* the Research "stopped trading" banner and the quote endpoint's
  ``inactive`` status (``lifecycle_payload``).

Rows are never deleted: watchlists, portfolios and history reference them.

Verified 2026-11-27 with SEC company_tickers.json + yfinance/Alpaca daily bars
(scripts/audit_ticker_universe.py, results in docs/TICKER_AUDIT.md).
``delisted_at`` is the last session the old company traded under the ticker;
``None`` when we could not verify the exact day.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, replace
from datetime import date
from typing import Callable, Iterable, List, Optional, Sequence, Set, TypeVar

logger = logging.getLogger(__name__)

RENAMED = "renamed"      # same company, new ticker
ACQUIRED = "acquired"    # bought / merged; holders got the successor (or cash)
DELISTED = "delisted"    # stopped trading, no listed successor
REUSED = "reused"        # ticker now belongs to a different company

INACTIVE_KINDS = frozenset({RENAMED, ACQUIRED, DELISTED})


@dataclass(frozen=True)
class Retirement:
    symbol: str
    kind: str
    former_name: str
    note: str
    successor: Optional[str] = None
    delisted_at: Optional[date] = None
    # REUSED only: who holds the ticker now.
    current_name: Optional[str] = None

    @property
    def inactive(self) -> bool:
        """True when nothing trades under the ticker any more."""
        return self.kind in INACTIVE_KINDS


def _r(symbol, kind, former_name, note, successor=None, delisted_at=None, current_name=None) -> Retirement:
    return Retirement(symbol, kind, former_name, note, successor,
                      date.fromisoformat(delisted_at) if delisted_at else None, current_name)


RETIREMENTS: dict[str, Retirement] = {r.symbol: r for r in (
    # ── renamed (same company, new ticker) ──
    _r("SQ", RENAMED, "Block Inc", "Block, Inc. changed its ticker from SQ to XYZ in Jan 2025.",
       "XYZ", "2025-01-17"),
    _r("MMC", RENAMED, "Marsh & McLennan Companies",
       "Marsh & McLennan changed its ticker from MMC to MRSH.", "MRSH"),
    _r("FB", RENAMED, "Meta Platforms Inc",
       "Meta Platforms (formerly Facebook) changed its ticker from FB to META in Jun 2022.", "META", "2022-06-08"),
    _r("ANTM", RENAMED, "Anthem Inc",
       "Anthem renamed itself Elevance Health and changed its ticker from ANTM to ELV in Jun 2022.",
       "ELV", "2022-06-27"),
    _r("PEAK", RENAMED, "Healthpeak Properties",
       "Healthpeak Properties changed its ticker from PEAK to DOC in Mar 2024.", "DOC", "2024-02-29"),
    _r("FI", RENAMED, "Fiserv Inc",
       "Fiserv moved its listing to Nasdaq and changed its ticker from FI back to FISV in Nov 2025.", "FISV"),
    _r("BK", RENAMED, "Bank of New York Mellon",
       "The Bank of New York Mellon (BNY) changed its ticker from BK to BNY.", "BNY"),
    _r("PSKY", RENAMED, "Paramount Skydance Corp",
       "Paramount Skydance Corp was renamed Skydance Corp in Oct 2026 and now trades as SKYD.", "SKYD"),
    # ── acquired / merged ──
    _r("PXD", ACQUIRED, "Pioneer Natural Resources",
       "Pioneer Natural Resources was acquired by Exxon Mobil (all-stock) in May 2024.", "XOM", "2024-05-02"),
    _r("HES", ACQUIRED, "Hess Corp", "Hess was acquired by Chevron (all-stock) in Jul 2025.", "CVX", "2025-07-17"),
    _r("MRO", ACQUIRED, "Marathon Oil",
       "Marathon Oil was acquired by ConocoPhillips (all-stock) in Nov 2024.", "COP", "2024-11-21"),
    _r("JNPR", ACQUIRED, "Juniper Networks",
       "Juniper Networks was acquired by Hewlett Packard Enterprise (cash) in Jul 2025.", "HPE", "2025-07-01"),
    _r("DFS", ACQUIRED, "Discover Financial Services",
       "Discover Financial was acquired by Capital One (all-stock) in May 2025.", "COF", "2025-05-16"),
    _r("SPLK", ACQUIRED, "Splunk Inc", "Splunk was acquired by Cisco (cash) in Mar 2024.", "CSCO", "2024-03-15"),
    _r("IPG", ACQUIRED, "Interpublic Group",
       "Interpublic Group was acquired by Omnicom (all-stock) in Nov 2025.", "OMC", "2025-11-25"),
    _r("CMA", ACQUIRED, "Comerica Inc", "Comerica was acquired by Fifth Third Bancorp (all-stock).", "FITB"),
    _r("CTLT", DELISTED, "Catalent Inc", "Catalent was taken private by Novo Holdings (cash) in Dec 2024.",
       None, "2024-12-17"),
    _r("X", DELISTED, "United States Steel", "U.S. Steel was acquired by Nippon Steel (cash) in Jun 2025.",
       None, "2025-06-17"),
    _r("WBA", DELISTED, "Walgreens Boots Alliance",
       "Walgreens Boots Alliance was taken private by Sycamore Partners in Aug 2025.", None, "2025-08-27"),
    _r("K", DELISTED, "Kellanova", "Kellanova was acquired by Mars (cash)."),
    _r("HOLX", DELISTED, "Hologic Inc", "Hologic was taken private by Blackstone and TPG (cash)."),
    _r("DAY", DELISTED, "Dayforce Inc", "Dayforce was taken private by Thoma Bravo (cash)."),
    _r("WBD", DELISTED, "Warner Bros. Discovery",
       "Warner Bros. Discovery no longer trades under WBD (no SEC ticker, no daily bars)."),
    _r("EA", DELISTED, "Electronic Arts",
       "Electronic Arts was taken private (cash) by a consortium led by PIF, Silver Lake and Affinity Partners.",
       None, "2026-08-04"),
    _r("AVB", DELISTED, "AvalonBay Communities",
       "AvalonBay Communities stopped trading after 2026-08-14 and is no longer in SEC's ticker map.",
       None, "2026-08-14"),
    _r("EQR", DELISTED, "Equity Residential",
       "Equity Residential stopped trading after 2026-08-17 and is no longer in SEC's ticker map.",
       None, "2026-08-17"),
    _r("CYBR", ACQUIRED, "CyberArk Software",
       "CyberArk was acquired by Palo Alto Networks (cash and stock).", "PANW"),
    _r("TWTR", DELISTED, "Twitter Inc", "Twitter was taken private by Elon Musk in Oct 2022.", None, "2022-10-27"),
    _r("GPS", RENAMED, "Gap Inc", "Gap Inc. changed its ticker from GPS to GAP in 2024.", "GAP"),
    _r("RE", RENAMED, "Everest Re Group", "Everest Re Group became Everest Group and changed its ticker to EG in 2023.",
       "EG"),
    _r("TOT", RENAMED, "Total SE", "Total SE became TotalEnergies and trades as TTE.", "TTE"),
    _r("RDS.A", RENAMED, "Royal Dutch Shell (A)",
       "Royal Dutch Shell unified its share classes as Shell plc (SHEL) in Jan 2022.", "SHEL", "2022-01-28"),
    _r("LUKOY", DELISTED, "Lukoil (ADR)", "Lukoil's ADR programme was terminated after the 2022 sanctions."),
    # ── reused: the ticker now belongs to someone else ──
    _r("PARA", REUSED, "Paramount Global",
       ("Paramount Global merged with Skydance in Aug 2025 (traded as PSKY); the company was renamed "
        "Skydance Corp in Oct 2026 and trades as SKYD."),
       "SKYD", "2025-08-06", current_name="Parabolic Technologies, Inc."),
    _r("SATS", REUSED, "EchoStar Corp",
       "EchoStar now trades as ECHO; SATS was reassigned to Strive, Inc. in Oct 2026.",
       "ECHO", current_name="Strive, Inc."),
    _r("ANSS", REUSED, "ANSYS Inc",
       "ANSYS was acquired by Synopsys (cash and stock) in Jul 2025; ANSS was later reassigned to an unrelated ETF.",
       "SNPS", "2025-07-16", current_name="Leverage Shares 1X Short Anthropic Daily ETF"),
)}


# Last session each old company traded under the ticker, from Alpaca SIP daily
# bars queried on the prod host on 2026-11-27 (the audit's local run had no
# Alpaca keys, so these banners said "stopped trading" with no date). TOT is
# deliberately absent: bars continue to 2026-10-26 at ~$24, i.e. the symbol is
# trading again under someone else; RE predates the SIP window (renamed EG 2023).
_VERIFIED_LAST_SESSION = {
    "GPS": "2024-08-21", "FI": "2025-11-10", "K": "2025-12-10", "MMC": "2026-01-13",
    "CMA": "2026-01-30", "DAY": "2026-02-03", "CYBR": "2026-02-10", "HOLX": "2026-04-06",
    "BK": "2026-05-20", "AVB": "2026-08-14", "EQR": "2026-08-17", "WBD": "2026-10-05",
}
for _sym, _d in _VERIFIED_LAST_SESSION.items():
    _r0 = RETIREMENTS.get(_sym)
    if _r0 is not None and _r0.delisted_at is None:
        RETIREMENTS[_sym] = replace(_r0, delisted_at=date.fromisoformat(_d))


def _norm(symbol: Optional[str]) -> str:
    return (symbol or "").strip().upper()


def retirement(symbol: Optional[str]) -> Optional[Retirement]:
    return RETIREMENTS.get(_norm(symbol))


def is_retired(symbol: Optional[str]) -> bool:
    """Nothing trades under the ticker any more (renamed / acquired / delisted)."""
    r = retirement(symbol)
    return bool(r and r.inactive)


def excluded_from_curated(symbol: Optional[str]) -> bool:
    """Curated code lists name the *former* company: drop retired and reused."""
    return retirement(symbol) is not None


T = TypeVar("T")


def filter_curated(items: Iterable[T], key: Callable[[T], str] = lambda x: x) -> List[T]:  # type: ignore[assignment]
    """Drop retired/reused tickers from a curated list (keeps order)."""
    return [it for it in items if not excluded_from_curated(key(it))]


# ── DB-backed inactive set (code list ∪ symbols.is_active = false) ──────────

_cache_lock = threading.Lock()
_cache: dict = {"at": 0.0, "set": frozenset()}
_CACHE_TTL_S = 600


def code_inactive_symbols() -> Set[str]:
    return {s for s, r in RETIREMENTS.items() if r.inactive}


def inactive_symbols(db=None) -> frozenset:
    """Every ticker to exclude from scans/lists. Never raises (falls back to code)."""
    now = time.monotonic()
    with _cache_lock:
        if now - _cache["at"] < _CACHE_TTL_S and _cache["set"]:
            return _cache["set"]
    out = set(code_inactive_symbols())
    try:
        from app.models.symbol import Symbol

        session, own = db, False
        if session is None:
            from app.db.database import SessionLocal

            if SessionLocal is not None:
                session, own = SessionLocal(), True
        if session is not None:
            try:
                out |= {s.upper() for (s,) in session.query(Symbol.symbol).filter(Symbol.is_active.is_(False)).all()}
            finally:
                if own:
                    session.close()
    except Exception as e:  # column not migrated yet / no DB: code list still applies
        logger.debug("inactive_symbols DB lookup failed: %s", e)
    frozen = frozenset(out)
    with _cache_lock:
        _cache.update(at=now, set=frozen)
    return frozen


def reset_cache() -> None:
    with _cache_lock:
        _cache.update(at=0.0, set=frozenset())


def drop_inactive(items: Sequence[T], key: Callable[[T], str] = lambda x: x, db=None) -> List[T]:  # type: ignore[assignment]
    """Remove inactive tickers from a scanned/listed result (DB + code)."""
    bad = inactive_symbols(db)
    return [it for it in items if _norm(key(it)) not in bad]


def active_filter(query, symbol_model):
    """SQLAlchemy filter: rows not marked inactive (NULL counts as active)."""
    from sqlalchemy import or_

    return query.filter(or_(symbol_model.is_active.is_(None), symbol_model.is_active.is_(True)))


# ── Payloads ──────────────────────────────────────────────────────────────

def lifecycle_payload(symbol: str, row=None) -> dict:
    """Lifecycle fields for API responses (identity + quote).

    ``lifecycle_status``: active | inactive | reused.  ``data_quality`` is
    ``limited`` for reused tickers (the new holder often has short history and
    unadjusted splits) and ``none`` for inactive ones.
    """
    sym = _norm(symbol)
    r = RETIREMENTS.get(sym)
    db_inactive = row is not None and getattr(row, "is_active", None) is False
    if r is None and not db_inactive:
        return {"lifecycle_status": "active", "is_active": True, "delisted_at": None,
                "successor_symbol": None, "status_note": None, "data_quality": "ok",
                "former_name": None, "current_name": None, "retirement_kind": None}
    if r is None:  # marked inactive in the DB only (audit --apply)
        d = getattr(row, "delisted_at", None)
        return {"lifecycle_status": "inactive", "is_active": False,
                "delisted_at": d.isoformat() if d else None,
                "successor_symbol": getattr(row, "successor_symbol", None),
                "status_note": getattr(row, "status_note", None), "data_quality": "none",
                "former_name": getattr(row, "name", None), "current_name": None,
                "retirement_kind": DELISTED}
    return {
        "lifecycle_status": "reused" if r.kind == REUSED else "inactive",
        "is_active": r.kind == REUSED,
        "delisted_at": r.delisted_at.isoformat() if r.delisted_at else None,
        "successor_symbol": r.successor,
        "status_note": r.note,
        "data_quality": "limited" if r.kind == REUSED else "none",
        "former_name": r.former_name,
        "current_name": r.current_name,
        "retirement_kind": r.kind,
    }


def apply_retirements(db, extra: Iterable[Retirement] = ()) -> dict:
    """Write lifecycle columns for every known retirement. Idempotent.

    Inactive kinds -> is_active=False with successor/date/note. Reused tickers
    stay active (a different company trades there) but get the note and the
    former company's successor. Missing rows are left alone (never created),
    and nothing is ever deleted.
    """
    from app.models.symbol import Symbol

    changed = unchanged = missing = 0
    for r in list(RETIREMENTS.values()) + list(extra):
        row = db.query(Symbol).filter(Symbol.symbol == r.symbol).first()
        if row is None:
            missing += 1
            continue
        want = {
            "is_active": not r.inactive,
            "delisted_at": r.delisted_at,
            "successor_symbol": r.successor,
            "status_note": r.note[:500],
        }
        if r.kind == REUSED and r.current_name and row.name != r.current_name:
            want["name"] = r.current_name
        diff = {k: v for k, v in want.items() if getattr(row, k, None) != v}
        if diff:
            for k, v in diff.items():
                setattr(row, k, v)
            changed += 1
        else:
            unchanged += 1
    db.commit()
    reset_cache()
    return {"changed": changed, "unchanged": unchanged, "missing": missing}


def inactive_quote_error(symbol: str, row=None):
    """HTTP 410 with a typed body for a ticker that no longer trades, else None.

    Quote endpoints raise it instead of serving nulls/zeros for SQ, PXD, ...
    ``detail.status == "inactive"`` and the successor let the UI link onward.
    """
    life = lifecycle_payload(symbol, row)
    if life["lifecycle_status"] != "inactive":
        return None
    from fastapi import HTTPException

    sym = _norm(symbol)
    when = f" on {life['delisted_at']}" if life["delisted_at"] else ""
    succ = f"; now {life['successor_symbol']}" if life["successor_symbol"] else ""
    return HTTPException(status_code=410, detail={
        "status": "inactive", "code": "inactive_symbol", "symbol": sym,
        "message": f"{sym} stopped trading{when}{succ}.",
        **{k: life[k] for k in ("delisted_at", "successor_symbol", "status_note", "former_name", "retirement_kind")},
    })
