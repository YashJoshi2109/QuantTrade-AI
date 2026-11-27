"""SEC Form 13F data sets -> institutional ownership by ticker.

Source: https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets
One ZIP per 3-month *filing* window (``01jun2026-31aug2026_form13f.zip``),
containing SUBMISSION, COVERPAGE, INFOTABLE ... (TSV).  A window holds the
13F-HR reports for the calendar quarter that ended just before it (due 45
days after quarter end), plus late filings and amendments.

Lag, stated in every payload: holdings are as of the quarter end
(``period``), filed up to 45 days later, and the data set is published after
its window closes -- so the newest 13F picture is 2-5 months old.

Method:
* filings: original 13F-HR reports for the window's main period (amendments
  13F-HR/A and notices 13F-NT excluded); a filer with several originals keeps
  the latest.
* VALUE is in US dollars (SEC changed from $ thousands on 2023-01-03).
* only share positions (SSHPRNAMTTYPE = SH) and no options (PUTCALL empty);
  a filer's lines for one CUSIP (several discretion / manager lines) are summed.
* ticker -> CUSIP: there is no free official ticker-CUSIP map, so the CUSIP is
  the one most often reported under the issuer's SEC name (normalised: case,
  punctuation and corporate suffixes removed), with explicit overrides for
  multi-class issuers (``CUSIP_OVERRIDES``).  The method is returned with the data.
"""
from __future__ import annotations

import io
import logging
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Set, Tuple

from sqlalchemy.orm import Session

from app.models.public_data import InstitutionalHolding, InstitutionalOwnershipSummary
from app.services.public_data import store
from app.services.public_data.http import get_fetcher
from app.services.public_data.sec_common import date_end_of_day_et, norm_ticker, ticker_map

logger = logging.getLogger(__name__)

PAGE = "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets"
SOURCE = "SEC Form 13F data sets"
TOP_HOLDERS = 50
MIN_NAME_MATCHES = 5
CUSIP_OVERRIDES = {"GOOGL": "02079K305", "GOOG": "02079K107", "BRK-B": "084670702", "BRK-A": "084670108",
                   "FOXA": "35137L105", "FOX": "35137L204", "NWSA": "65249B109", "NWS": "65249B208"}
_SUFFIX = {"INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "NV", "SA",
           "AG", "LP", "THE", "COM", "NEW", "DEL", "DE", "CL", "A", "CLASS", "ORD", "SHS", "N", "V"}
_MON = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


def norm_name(s: str) -> str:
    s = re.sub(r"[^A-Z0-9 ]", " ", (s or "").upper().replace("&", " AND "))
    words = s.split()
    while words and words[-1] in _SUFFIX:
        words.pop()
    while words and words[0] == "THE":
        words.pop(0)
    return " ".join(words)


def _date(s: str) -> Optional[str]:
    """'30-JUN-2026' -> '2026-06-30'."""
    m = re.match(r"(\d{2})-([A-Z]{3})-(\d{4})", (s or "").upper())
    if not m:
        return None
    return f"{m.group(3)}-{_MON[m.group(2)]:02d}-{m.group(1)}"


def list_datasets() -> List[Dict[str, str]]:
    html = get_fetcher().get(PAGE, ttl_h=24, accept="text/html").decode("utf-8", errors="replace")
    out, seen = [], set()
    for path in re.findall(r'href="([^"]*form-13f-data-sets/([0-9a-z]+-[0-9a-z]+)_form13f\.zip)"', html):
        href, key = path
        if key in seen:
            continue
        seen.add(key)
        out.append({"key": key, "url": href if href.startswith("http") else f"https://www.sec.gov{href}"})
    return out          # page order: newest first


def _tsv(z: zipfile.ZipFile, name: str) -> Iterator[Dict[str, str]]:
    with z.open(name) as fh:
        rd = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
        head = rd.readline().rstrip("\n").split("\t")
        for line in rd:
            p = line.rstrip("\n").split("\t")
            if len(p) < len(head):
                p += [""] * (len(head) - len(p))
            yield dict(zip(head, p))


def _filings(z: zipfile.ZipFile) -> Tuple[Optional[str], Dict[str, Dict[str, Any]]]:
    cover = {r["ACCESSION_NUMBER"]: r for r in _tsv(z, "COVERPAGE.tsv")}
    subs = []
    for r in _tsv(z, "SUBMISSION.tsv"):
        if r["SUBMISSIONTYPE"] != "13F-HR":
            continue
        c = cover.get(r["ACCESSION_NUMBER"], {})
        if (c.get("ISAMENDMENT") or "").upper() == "Y":
            continue
        subs.append({"accession": r["ACCESSION_NUMBER"], "filed": _date(r["FILING_DATE"]),
                     "cik": r["CIK"].zfill(10), "period": _date(r["PERIODOFREPORT"]),
                     "name": (c.get("FILINGMANAGER_NAME") or "")[:200]})
    if not subs:
        return None, {}
    period = Counter(s["period"] for s in subs).most_common(1)[0][0]
    best: Dict[str, Dict[str, Any]] = {}
    for s in subs:
        if s["period"] != period or not s["filed"]:
            continue
        cur = best.get(s["cik"])
        if cur is None or (s["filed"], s["accession"]) > (cur["filed"], cur["accession"]):
            best[s["cik"]] = s
    return period, {s["accession"]: s for s in best.values()}


def map_cusips(z: zipfile.ZipFile, tickers: Sequence[str], accessions: Set[str]) -> Dict[str, Tuple[str, str]]:
    """ticker -> (CUSIP, method)."""
    tmap = ticker_map()
    want: Dict[str, List[str]] = defaultdict(list)
    out: Dict[str, Tuple[str, str]] = {}
    for t in tickers:
        if t in CUSIP_OVERRIDES:
            out[t] = (CUSIP_OVERRIDES[t], "override")
            continue
        hit = tmap.get(t)
        if hit and norm_name(hit[1]):
            want[norm_name(hit[1])].append(t)
    counts: Dict[str, Counter] = defaultdict(Counter)
    for r in _tsv(z, "INFOTABLE.tsv"):
        if r["ACCESSION_NUMBER"] not in accessions or r["PUTCALL"] or r["SSHPRNAMTTYPE"] != "SH":
            continue
        n = norm_name(r["NAMEOFISSUER"])
        if n in want:
            counts[n][r["CUSIP"].upper()] += 1
    for n, ts in want.items():
        if not counts[n]:
            continue
        cusip, c = counts[n].most_common(1)[0]
        if c >= MIN_NAME_MATCHES:
            for t in ts:
                out[t] = (cusip, "issuer_name_match")
    return out


def drop_inconsistent(lst: List[Tuple[str, float, float]], band: float = 5.0
                      ) -> Tuple[List[Tuple[str, float, float]], int]:
    """Drop filer positions whose implied price (value / shares) is more than
    ``band`` x away from the median implied price for that CUSIP: such lines are
    filer errors (e.g. shares reported in place of value), and one of them can
    exceed a company's whole share count."""
    prices = sorted(v / s for _, s, v in lst if s > 0 and v > 0)
    if len(prices) < 5:
        return lst, 0
    med = prices[len(prices) // 2]
    keep = [x for x in lst if x[1] > 0 and x[2] > 0 and 1 / band <= (x[2] / x[1]) / med <= band]
    return keep, len(lst) - len(keep)


def parse_dataset(path: Path, tickers: Sequence[str], dataset: str) -> Dict[str, Any]:
    tickers = [norm_ticker(t) for t in tickers]
    with zipfile.ZipFile(path) as z:
        period, filings = _filings(z)
        if not period:
            return {"period": None, "summaries": [], "holdings": [], "cusips": {}}
        acc = set(filings)
        cusips = map_cusips(z, tickers, acc)
        by_cusip: Dict[str, List[str]] = defaultdict(list)
        for t, (c, _) in cusips.items():
            by_cusip[c].append(t)
        agg: Dict[Tuple[str, str], List[float]] = defaultdict(lambda: [0.0, 0.0])
        for r in _tsv(z, "INFOTABLE.tsv"):
            c = r["CUSIP"].upper()
            if c not in by_cusip or r["ACCESSION_NUMBER"] not in acc or r["PUTCALL"] or r["SSHPRNAMTTYPE"] != "SH":
                continue
            try:
                sh, val = float(r["SSHPRNAMT"] or 0), float(r["VALUE"] or 0)
            except ValueError:
                continue
            a = agg[(c, r["ACCESSION_NUMBER"])]
            a[0] += sh
            a[1] += val
    per_cusip: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
    for (c, accn), (sh, val) in agg.items():
        per_cusip[c].append((accn, sh, val))
    summaries, holdings = [], []
    for c, lst in per_cusip.items():
        lst, _dropped = drop_inconsistent(lst)
        if not lst:
            continue
        last_filed = max(filings[a]["filed"] for a, _, _ in lst)
        lst.sort(key=lambda x: x[1], reverse=True)
        for t in by_cusip[c]:
            summaries.append({"ticker": t, "cusip": c, "cusip_method": cusips[t][1], "period": period,
                              "holders": len(lst), "total_shares": sum(x[1] for x in lst),
                              "total_value_usd": sum(x[2] for x in lst), "dataset": dataset,
                              "available_at": date_end_of_day_et(last_filed), "source": f"{SOURCE} {dataset}"})
            for accn, sh, val in lst[:TOP_HOLDERS]:
                f = filings[accn]
                holdings.append({"ticker": t, "cusip": c, "period": period, "filer_cik": f["cik"],
                                 "filer_name": f["name"], "shares": sh, "value_usd": val, "accession": accn,
                                 "filed_date": f["filed"], "available_at": date_end_of_day_et(f["filed"]),
                                 "source": f"{SOURCE} {dataset}"})
    return {"period": period, "summaries": summaries, "holdings": holdings, "cusips": cusips}


def load_dataset(db: Session, key: str, url: str, tickers: Sequence[str], *, force: bool = False) -> Dict[str, Any]:
    import hashlib
    want = hashlib.sha1(",".join(sorted(norm_ticker(t) for t in tickers)).encode()).hexdigest()
    prev = store.load_row(db, "sec_13f", key)
    if prev is not None and prev.status == "done" and prev.source_last_modified == want and not force:
        return {"dataset": key, "skipped": True}
    path = get_fetcher().download(url, ttl_h=None)
    res = parse_dataset(path, tickers, key)
    rel = getattr(get_fetcher(), "release", None)
    if rel is not None:
        rel(path)
    n = store.upsert(db, InstitutionalOwnershipSummary, res["summaries"], ("ticker", "period"))
    m = store.upsert(db, InstitutionalHolding, res["holdings"], ("ticker", "period", "filer_cik"))
    unmapped = sorted(set(norm_ticker(t) for t in tickers) - set(res["cusips"]))
    store.mark_load(db, "sec_13f", key, rows=n + m, source_last_modified=want,
                    note=f"period={res['period']} unmapped={','.join(unmapped)[:1500]}")
    return {"dataset": key, "period": res["period"], "summaries": n, "holdings": m, "unmapped": unmapped}


def ownership_payload(db: Session, ticker: str, *, top: int = 15, as_of: Optional[datetime] = None) -> Dict[str, Any]:
    from app.services.public_data.sources import attribution
    t = norm_ticker(ticker)
    q = db.query(InstitutionalOwnershipSummary).filter(InstitutionalOwnershipSummary.ticker == t)
    if as_of is not None:
        q = q.filter(InstitutionalOwnershipSummary.available_at <= as_of)
    sums = q.order_by(InstitutionalOwnershipSummary.period.desc()).limit(2).all()
    lag = ("13F holdings are as of the quarter end and are filed up to 45 days later; the SEC data set is "
           "published after its 3-month filing window, so this is a lagging picture, not current positioning.")
    if not sums:
        return {"ticker": t, "status": "not_loaded", "notes": [lag], "attribution": attribution("sec_13f", None)}
    cur, prev = sums[0], (sums[1] if len(sums) > 1 else None)
    hq = db.query(InstitutionalHolding).filter_by(ticker=t, period=cur.period)
    rows = hq.order_by(InstitutionalHolding.shares.desc()).limit(top).all()
    prev_by = {}
    if prev is not None:
        prev_by = {h.filer_cik: h for h in db.query(InstitutionalHolding).filter_by(ticker=t, period=prev.period)}

    def pct(a, b):
        return round((a - b) / b * 100, 2) if a is not None and b else None

    holders = []
    for h in rows:
        p = prev_by.get(h.filer_cik)
        holders.append({"filer": h.filer_name, "filer_cik": h.filer_cik, "shares": h.shares, "value_usd": h.value_usd,
                        "filed": h.filed_date, "accession": h.accession,
                        "prev_shares": p.shares if p else None,
                        "change_shares": (h.shares - p.shares) if p else None,
                        "change_pct": pct(h.shares, p.shares) if p else None,
                        "status": "held" if p else ("new_or_outside_prev_top" if prev is not None else None)})
    return {
        "ticker": t, "status": "ok", "period": cur.period, "cusip": cur.cusip, "cusip_method": cur.cusip_method,
        "holders": cur.holders, "total_shares": cur.total_shares, "total_value_usd": cur.total_value_usd,
        "previous": ({"period": prev.period, "holders": prev.holders, "total_shares": prev.total_shares,
                      "total_value_usd": prev.total_value_usd} if prev else None),
        "qoq": ({"holders_change": cur.holders - prev.holders if cur.holders is not None and prev.holders is not None else None,
                 "shares_change_pct": pct(cur.total_shares, prev.total_shares)} if prev else None),
        "top_holders": holders, "available_at": store.iso(cur.available_at),
        "notes": [lag, "Original 13F-HR reports only (amendments excluded); share positions only, options excluded; "
                       "positions whose value/shares is more than 5x off the median price are treated as filer "
                       "errors and excluded.",
                  "Previous-quarter comparison is only available for filers in that quarter's stored top "
                  f"{TOP_HOLDERS}." if prev else "No previous quarter loaded yet."],
        "attribution": attribution("sec_13f", cur.period, extra=f"13F period {cur.period}, data set {cur.dataset}"),
    }
