"""SEC Financial Statement Data Sets -> point-in-time fundamentals.

Source: https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets
One ZIP per calendar quarter of *filing* dates (``2026q3.zip`` = filings
accepted Jul-Sep 2026), published a few days after the quarter ends.  Files:

* ``sub.txt``  one row per submission: adsh, cik, name, form, period, fy, fp,
               filed (YYYYMMDD), accepted (US Eastern datetime) ...
* ``num.txt``  one row per numeric fact: adsh, tag, version, ddate (period end,
               rounded to month end by SEC), qtrs (0 = instant), uom, segments,
               coreg, value

Every fact is stored exactly as filed in that submission, keyed by accession,
with ``available_at`` = EDGAR acceptance time (UTC).  A later 10-K that restates
a comparative creates a *new* row (its own adsh); nothing is overwritten.  So
``available_at <= as_of`` gives what an investor could have known on ``as_of``
-- no look-ahead.

Kept: 10-K/10-Q/20-F/40-F (and amendments), non-dimensional facts (empty
``segments`` and ``coreg``), standard us-gaap/ifrs-full/dei tags used by the
fundamentals engine (``fundamentals.xbrl.CATALOG``) plus a few extras, for the
CIKs of the refresh universe.  The ZIP is streamed (num.txt is ~0.9 GB
uncompressed); memory stays flat.

PIT use:
* ``pit_companyfacts(db, cik, as_of)`` -> companyfacts-shaped JSON restricted to
  filings accepted on or before ``as_of`` -> ``normalize_companyfacts`` -> the
  same ``Statements`` the fundamentals engine analyses today
  (``PITFundamentalsData`` implements the engine's ``FundamentalsData`` protocol).
* ``pit_values(db, ticker, as_of, tags)`` -> latest known value per tag (ML).
"""
from __future__ import annotations

import asyncio
import calendar
import hashlib
import io
import logging
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Set, Tuple

from sqlalchemy.orm import Session

from app.models.public_data import PitFundamentalFact
from app.services.public_data import store
from app.services.public_data.http import get_fetcher
from app.services.public_data.sec_common import et_to_utc, tickers_by_cik

logger = logging.getLogger(__name__)

BASE = "https://www.sec.gov/files/dera/data/financial-statement-data-sets"
SOURCE = "SEC Financial Statement Data Sets"
FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A", "10-KT", "10-KT/A", "10-QT", "10-QT/A", "20-F", "20-F/A", "40-F", "40-F/A"}
EXTRA_TAGS = {"us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
              "us-gaap:EarningsPerShareBasic", "us-gaap:EarningsPerShareDiluted",
              "dei:EntityCommonStockSharesOutstanding"}


def catalog_tags() -> Set[str]:
    from app.services.fundamentals.xbrl import CATALOG
    return {t for li in CATALOG for t in li.tags} | EXTRA_TAGS


def per_share_tags() -> Set[str]:
    from app.services.fundamentals.xbrl import CATALOG
    return {t for li in CATALOG if li.unit == "per_share" for t in li.tags} | {
        "us-gaap:EarningsPerShareBasic", "us-gaap:EarningsPerShareDiluted"}


def quarter_key(d: date) -> str:
    return f"{d.year}q{(d.month - 1) // 3 + 1}"


def recent_quarters(today: date, n: int = 2) -> List[str]:
    """Most recent *closed* quarters, newest first (the current quarter has no file yet)."""
    y, q = today.year, (today.month - 1) // 3 + 1
    out = []
    for _ in range(n):
        q -= 1
        if q == 0:
            y, q = y - 1, 4
        out.append(f"{y}q{q}")
    return out


def dataset_url(key: str) -> str:
    return f"{BASE}/{key}.zip"


def _iso(yyyymmdd: str) -> str:
    s = (yyyymmdd or "").strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else s


def parse_zip(path: Path, ciks: Optional[Set[str]] = None, tags: Optional[Set[str]] = None,
              dataset: Optional[str] = None) -> Iterator[Dict[str, Any]]:
    """Yield fact rows (dicts for PitFundamentalFact) from one FSDS ZIP."""
    with zipfile.ZipFile(path) as z:
        subs: Dict[str, Dict[str, Any]] = {}
        with z.open("sub.txt") as fh:
            rd = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
            head = rd.readline().rstrip("\n").split("\t")
            ix = {k: i for i, k in enumerate(head)}
            for line in rd:
                p = line.rstrip("\n").split("\t")
                if len(p) < len(head):
                    continue
                cik = p[ix["cik"]].zfill(10)
                form = p[ix["form"]]
                if form not in FORMS or (ciks is not None and cik not in ciks):
                    continue
                acc = et_to_utc(p[ix["accepted"]])
                filed = _iso(p[ix["filed"]])
                if acc is None:
                    continue
                fy = p[ix["fy"]]
                subs[p[ix["adsh"]]] = {"cik": cik, "form": form, "fy": int(fy) if fy.isdigit() else None,
                                       "fp": p[ix["fp"]] or None, "period": _iso(p[ix["period"]]),
                                       "filed": filed, "available_at": acc}
        if not subs:
            return
        with z.open("num.txt") as fh:
            rd = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
            head = rd.readline().rstrip("\n").split("\t")
            ix = {k: i for i, k in enumerate(head)}
            iseg, icor = ix.get("segments"), ix.get("coreg")
            for line in rd:
                p = line.rstrip("\n").split("\t")
                if len(p) < len(head) - 1:
                    continue
                s = subs.get(p[ix["adsh"]])
                if s is None:
                    continue
                if (iseg is not None and p[iseg]) or (icor is not None and icor < len(p) and p[icor]):
                    continue
                version = p[ix["version"]]
                taxonomy = version.split("/", 1)[0] if "/" in version else "custom"
                qtag = f"{taxonomy}:{p[ix['tag']]}"
                if tags is not None and qtag not in tags:
                    continue
                try:
                    value = float(p[ix["value"]]) if p[ix["value"]] else None
                    qtrs = int(p[ix["qtrs"]])
                except ValueError:
                    continue
                yield {"cik": s["cik"], "adsh": p[ix["adsh"]], "tag": p[ix["tag"]], "taxonomy": taxonomy,
                       "ddate": _iso(p[ix["ddate"]]), "qtrs": qtrs, "uom": p[ix["uom"]][:32], "value": value,
                       "form": s["form"], "fy": s["fy"], "fp": s["fp"], "period": s["period"],
                       "filed": s["filed"], "available_at": s["available_at"], "dataset": dataset,
                       "source": f"{SOURCE} {dataset or ''}".strip()}


def load_quarter(db: Session, key: str, ciks: Set[str], *, force: bool = False) -> Dict[str, Any]:
    """Download (cached) and load one quarterly ZIP for ``ciks``.  Idempotent:
    skipped when this quarter was already loaded for the same CIK set, unless
    ``force`` (a closed quarter's file does not change)."""
    prev = store.load_row(db, "sec_fsds", key)
    want = hashlib.sha1(",".join(sorted(ciks)).encode()).hexdigest()
    if prev is not None and prev.status == "done" and not force and prev.source_last_modified == want:
        return {"dataset": key, "skipped": True, "rows": prev.rows}
    path = get_fetcher().download(dataset_url(key), ttl_h=None)
    by_cik = tickers_by_cik()
    rows = []
    for r in parse_zip(path, ciks, catalog_tags(), key):
        r["ticker"] = by_cik.get(r["cik"])
        rows.append(r)
    n = store.upsert(db, PitFundamentalFact, rows, ("adsh", "tag", "ddate", "qtrs", "uom"))
    _release(path)
    store.mark_load(db, "sec_fsds", key, rows=n, note=f"ciks={len(ciks)}", source_last_modified=want)
    return {"dataset": key, "rows": n, "filings": len({r["adsh"] for r in rows})}


def _release(path: Path) -> None:
    rel = getattr(get_fetcher(), "release", None)
    if rel is not None:
        rel(path)


# ── point-in-time reads ─────────────────────────────────────────────────────

def _as_dt(as_of) -> datetime:
    if isinstance(as_of, datetime):
        return as_of if as_of.tzinfo else as_of.replace(tzinfo=timezone.utc)
    if isinstance(as_of, date):
        return datetime(as_of.year, as_of.month, as_of.day, 23, 59, 59, tzinfo=timezone.utc)
    s = str(as_of)
    if len(s) == 10:
        return datetime.fromisoformat(s + "T23:59:59+00:00")
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _month_start(ddate: str, qtrs: int) -> Optional[str]:
    """Start of a ``qtrs``-quarter duration ending at month-end ``ddate``."""
    if qtrs <= 0:
        return None
    y, m = int(ddate[:4]), int(ddate[5:7])
    m -= qtrs * 3
    while m <= 0:
        m += 12
        y -= 1
    last = calendar.monthrange(y, m)[1]
    d = date(y, m, last)
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return nxt.isoformat()


def facts_query(db: Session, cik: str, as_of):
    return (db.query(PitFundamentalFact)
            .filter(PitFundamentalFact.cik == str(cik).zfill(10),
                    PitFundamentalFact.available_at <= _as_dt(as_of)))


def to_companyfacts(rows: Iterable[PitFundamentalFact], cik: str, name: Optional[str] = None) -> Dict[str, Any]:
    """Rows -> the companyfacts JSON layout ``normalize_companyfacts`` reads.
    FSDS reports EPS in "USD"; companyfacts uses "USD/shares": renamed for per-share tags."""
    ps = per_share_tags()
    facts: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        if r.value is None:
            continue
        uom = r.uom
        if f"{r.taxonomy}:{r.tag}" in ps and "/" not in uom:
            uom = f"{uom}/shares"
        ent = {"end": r.ddate, "val": r.value, "accn": r.adsh, "fy": r.fy, "fp": r.fp, "form": r.form,
               "filed": r.filed}
        st = _month_start(r.ddate, r.qtrs)
        if st:
            ent["start"] = st
        facts.setdefault(r.taxonomy, {}).setdefault(r.tag, {"units": {}})["units"].setdefault(uom, []).append(ent)
    return {"cik": int(cik), "entityName": name, "facts": facts,
            "_source": f"{SOURCE} (point-in-time)"}


def pit_companyfacts(db: Session, cik: str, as_of) -> Optional[Dict[str, Any]]:
    rows = facts_query(db, cik, as_of).all()
    if not rows:
        return None
    return to_companyfacts(rows, cik)


def pit_values(db: Session, ticker: str, as_of, tags: Sequence[str], *, qtrs: Optional[int] = None
               ) -> Dict[str, Dict[str, Any]]:
    """Latest value per tag known on ``as_of``: the newest period end, and for it
    the most recently accepted filing (restatements win only once public)."""
    q = (db.query(PitFundamentalFact)
         .filter(PitFundamentalFact.ticker == ticker.upper(), PitFundamentalFact.tag.in_(list(tags)),
                 PitFundamentalFact.available_at <= _as_dt(as_of)))
    if qtrs is not None:
        q = q.filter(PitFundamentalFact.qtrs == qtrs)
    best: Dict[str, PitFundamentalFact] = {}
    for r in q.all():
        cur = best.get(r.tag)
        if cur is None or (r.ddate, store.aware(r.available_at)) > (cur.ddate, store.aware(cur.available_at)):
            best[r.tag] = r
    return {t: {"value": r.value, "period_end": r.ddate, "qtrs": r.qtrs, "uom": r.uom, "accession": r.adsh,
                "form": r.form, "filed": r.filed, "available_at": store.iso(r.available_at)}
            for t, r in best.items()}


class PITFundamentalsData:
    """``FundamentalsData`` (fundamentals engine protocol) as of a past date,
    built only from filings accepted on or before ``as_of``.  Use it in
    backtests/ML: ``A.history_payload(await PITFundamentalsData(SessionLocal, '2024-06-30').statements('NVDA'), ...)``."""

    def __init__(self, session_factory, as_of):
        self.session_factory = session_factory
        self.as_of = as_of

    def _statements(self, ticker: str):
        from app.services.fundamentals.xbrl import normalize_companyfacts
        from app.services.public_data.sec_common import cik_for
        db = self.session_factory()
        try:
            r = db.query(PitFundamentalFact.cik).filter(PitFundamentalFact.ticker == ticker.upper()).first()
            cik = r[0] if r else cik_for(ticker)
            if not cik:
                return None
            data = pit_companyfacts(db, cik, self.as_of)
        finally:
            db.close()
        if not data:
            return None
        st = normalize_companyfacts(data, ticker, cik)
        st.notes.append(f"point-in-time: SEC Financial Statement Data Sets, filings accepted on or before {self.as_of}")
        return st

    async def statements(self, ticker: str):
        return await asyncio.to_thread(self._statements, ticker)

    async def submissions(self, ticker: str):
        return None

    async def fx_usd_per_unit(self, currency: str):
        return {"rate": 1.0, "as_of": None, "source": "identity"} if currency.upper() == "USD" else None
