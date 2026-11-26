"""Refresh ``symbols`` identity from SEC's ticker map (the source of truth for
which US filer holds a ticker today).

The symbols table is seeded once from static lists and never re-checked, so
when a ticker is reassigned (PARA: Paramount Global -> Parabolic Technologies
after the Skydance merger; the company traded as PSKY and, since its Oct 2026
rename to Skydance Corp, as SKYD) our name and the
cached EDGAR filings silently describe different companies.

``plan_refresh`` is pure (rows in, actions out) so it is unit-tested; the CLI
wrapper is ``scripts/refresh_symbol_identity.py`` (dry-run by default).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from app.services.instrument_identity import KNOWN_TICKER_CHANGES, names_match
from app.services.ticker_validation import classify_asset_type

logger = logging.getLogger(__name__)

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"


@dataclass
class SymbolRow:
    symbol: str
    name: Optional[str]
    asset_type: Optional[str] = None
    edgar_cik: Optional[str] = None
    edgar_name: Optional[str] = None


@dataclass
class Action:
    kind: str  # rename | add_successor | purge_edgar | flag_delisted
    symbol: str
    old: Optional[str] = None
    new: Optional[str] = None
    reason: str = ""

    def describe(self) -> str:
        if self.kind == "rename":
            return f"RENAME   {self.symbol}: {self.old!r} -> {self.new!r} ({self.reason})"
        if self.kind == "add_successor":
            return f"ADD      {self.symbol}: {self.new!r} ({self.reason})"
        if self.kind == "purge_edgar":
            return f"PURGE    {self.symbol}: cached EDGAR CIK {self.old} != SEC CIK {self.new} ({self.reason})"
        return f"DELISTED {self.symbol}: {self.old!r} ({self.reason})"


@dataclass
class Plan:
    actions: list[Action] = field(default_factory=list)
    checked: int = 0
    not_in_sec: int = 0

    def of(self, kind: str) -> list[Action]:
        return [a for a in self.actions if a.kind == kind]


def sec_key(symbol: str) -> str:
    """SEC's ticker map spells share classes with a dash (BRK-B)."""
    return (symbol or "").upper().replace(".", "-").strip()


def parse_sec_ticker_map(data: dict) -> dict[str, dict]:
    """company_tickers.json -> {TICKER: {"cik": 10-digit str, "title": str}}."""
    out: dict[str, dict] = {}
    for v in (data or {}).values():
        t = str(v.get("ticker") or "").upper()
        if t and t not in out:  # first entry wins (SEC lists the primary class first)
            out[t] = {"cik": str(v.get("cik_str")).zfill(10), "title": (v.get("title") or "").strip()}
    return out


def fetch_sec_ticker_map(path: Optional[str] = None, timeout: float = 20.0) -> dict[str, dict]:
    """Load the SEC map from a local JSON file, or download it."""
    if path:
        return parse_sec_ticker_map(json.loads(Path(path).read_text()))
    import requests
    from app.services.sec_edgar_service import SEC_HEADERS  # SEC requires a contact UA

    resp = requests.get(SEC_TICKERS_URL, headers=SEC_HEADERS, timeout=timeout)
    resp.raise_for_status()
    return parse_sec_ticker_map(resp.json())


def display_name(title: str) -> str:
    """SEC titles are often ALL CAPS ("PARABOLIC TECHNOLOGIES INC") and carry a
    state-of-incorporation suffix ("SLB LIMITED/NV", "FOO CORP /DE/"): tidy both."""
    title = re.sub(r"\s*/[A-Za-z]{2,3}/?\s*$", "", (title or "").strip())
    if not title or title.upper() != title or not any(c.isalpha() for c in title):
        return title
    lower_ok = {"INC", "THE", "AND", "CO", "LTD", "OF"}

    def word(w: str) -> str:
        # Short all-letter words are usually acronyms (IBM, AMD); keep them.
        if len(w) <= 3 and w.isalpha() and w not in lower_ok:
            return w
        return w.capitalize()

    return " ".join(word(w) for w in title.split())


def plan_refresh(rows: Iterable[SymbolRow], sec_map: dict[str, dict],
                 existing: Optional[set[str]] = None) -> Plan:
    """``existing``: every symbol in the table (defaults to ``rows``); pass it when
    ``rows`` is a subset so successors already listed are not proposed again."""
    plan = Plan()
    rows = list(rows)
    checked_syms = {r.symbol.upper() for r in rows}
    present = {s.upper() for s in existing} if existing is not None else checked_syms

    for r in rows:
        sym = r.symbol.upper()
        if classify_asset_type(sym, r.asset_type) != "equity":
            continue
        plan.checked += 1
        sec = sec_map.get(sec_key(sym))
        known = KNOWN_TICKER_CHANGES.get(sym)

        if sec is None:
            plan.not_in_sec += 1
            if known:
                plan.actions.append(Action("flag_delisted", sym, old=r.name,
                                           reason=f"not in SEC ticker map; {known['note']}"))
            continue

        if r.edgar_cik and str(r.edgar_cik).zfill(10) != sec["cik"]:
            plan.actions.append(Action("purge_edgar", sym, old=str(r.edgar_cik).zfill(10), new=sec["cik"],
                                       reason="ticker now belongs to another filer; re-sync on next view"))

        if not names_match(r.name, sec["title"]):
            plan.actions.append(Action("rename", sym, old=r.name, new=display_name(sec["title"]),
                                       reason="SEC ticker map names a different company"))

    for old_sym, known in KNOWN_TICKER_CHANGES.items():
        succ = known.get("successor")
        if not succ or succ in present or old_sym not in checked_syms:
            continue
        sec = sec_map.get(sec_key(succ))
        name = known.get("successor_name") or (display_name(sec["title"]) if sec else None)
        if sec is None and not known.get("successor_name"):
            continue
        plan.actions.append(Action("add_successor", succ, new=name, reason=f"successor of {old_sym}"))
    return plan


def load_rows(db) -> list[SymbolRow]:
    from app.models.edgar import CompanyEDGAR
    from app.models.symbol import Symbol

    edgar = {sid: (cik, name) for sid, cik, name in
             db.query(CompanyEDGAR.symbol_id, CompanyEDGAR.cik, CompanyEDGAR.company_name).all()}
    out = []
    for sid, sym, name, asset_type in db.query(Symbol.id, Symbol.symbol, Symbol.name, Symbol.asset_type).all():
        cik, ename = edgar.get(sid, (None, None))
        out.append(SymbolRow(sym, name, asset_type, cik, ename))
    return out


def apply_plan(db, plan: Plan, purge_edgar: bool = True) -> dict:
    """Write the plan. flag_delisted is report-only (no status column to set)."""
    from app.models.edgar import CompanyEDGAR, FinancialStatement
    from app.models.symbol import Symbol

    done = {"rename": 0, "add_successor": 0, "purge_edgar": 0}
    for a in plan.actions:
        if a.kind == "rename":
            row = db.query(Symbol).filter(Symbol.symbol == a.symbol).first()
            if row is not None:
                row.name = a.new
                done["rename"] += 1
        elif a.kind == "add_successor":
            if db.query(Symbol.id).filter(Symbol.symbol == a.symbol).first() is None:
                db.add(Symbol(symbol=a.symbol, name=a.new, asset_type="Equity"))
                done["add_successor"] += 1
        elif a.kind == "purge_edgar" and purge_edgar:
            row = db.query(Symbol).filter(Symbol.symbol == a.symbol).first()
            if row is not None:
                db.query(FinancialStatement).filter(FinancialStatement.symbol_id == row.id).delete(
                    synchronize_session=False)
                db.query(CompanyEDGAR).filter(CompanyEDGAR.symbol_id == row.id).delete(synchronize_session=False)
                done["purge_edgar"] += 1
    db.commit()
    return done
