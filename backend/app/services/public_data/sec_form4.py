"""SEC Form 4 insider transactions (EDGAR ownership XML).

Per issuer: the EDGAR submissions JSON lists every Form 4 / 4/A filed about
the company (the issuer is a co-registrant).  Each filing's ownership XML
(``primaryDocument`` without its ``xslF345X0n/`` rendering prefix) is fetched
once and cached forever (an accession never changes).  ``available_at`` is
the EDGAR acceptance datetime from the submissions JSON.

Transaction codes (SEC Form 4 instructions, General Instruction 8):
P open-market or private purchase, S open-market or private sale, A grant/award,
M option exercise, F tax withholding, G gift, D disposition to issuer, C conversion,
X exercise of in/at-the-money derivative ... "Net insider activity" counts only
P and S on non-derivative securities (discretionary trades); awards, exercises
and tax withholding are shown but not netted.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from defusedxml import ElementTree as ET
from sqlalchemy.orm import Session

from app.models.public_data import InsiderTransaction
from app.services.public_data import store
from app.services.public_data.http import FetchError, get_fetcher
from app.services.public_data.sec_common import cik_for, iso_utc, norm_ticker

logger = logging.getLogger(__name__)

SOURCE = "SEC EDGAR Form 4"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
MAX_FILINGS = 80              # newest Form 4s per refresh (first load)
LOOKBACK_DAYS = 400
CODE_LABELS = {"P": "Purchase", "S": "Sale", "A": "Award", "M": "Option exercise", "F": "Tax withholding",
               "G": "Gift", "D": "Disposed to issuer", "C": "Conversion", "X": "Option exercise",
               "J": "Other", "K": "Equity swap", "I": "Discretionary", "W": "Will/inheritance",
               "L": "Small acquisition", "Z": "Voting trust", "E": "Expiration", "H": "Expiration", "O": "Exercise (OTM)",
               "U": "Tender"}


def _txt(el, path: str) -> Optional[str]:
    if el is None:
        return None
    node = el.find(path)
    if node is None:
        return None
    v = node.find("value")
    s = (v.text if v is not None else node.text) or ""
    s = s.strip()
    return s or None


def _num(s: Optional[str]) -> Optional[float]:
    try:
        return float(s) if s not in (None, "") else None
    except ValueError:
        return None


def _flag(s: Optional[str]) -> bool:
    return (s or "").strip().lower() in ("1", "true")


def parse_form4(xml: bytes) -> Dict[str, Any]:
    root = ET.fromstring(xml)
    owners = root.findall("reportingOwner")
    names, ciks, titles = [], [], []
    rel = {"director": False, "officer": False, "ten": False}
    for o in owners:
        names.append(_txt(o, "reportingOwnerId/rptOwnerName") or "")
        ciks.append(_txt(o, "reportingOwnerId/rptOwnerCik") or "")
        r = o.find("reportingOwnerRelationship")
        rel["director"] |= _flag(_txt(r, "isDirector"))
        rel["officer"] |= _flag(_txt(r, "isOfficer"))
        rel["ten"] |= _flag(_txt(r, "isTenPercentOwner"))
        t = _txt(r, "officerTitle") or (_txt(r, "otherText"))
        if t:
            titles.append(t)
    plan = _txt(root, "aff10b5One")
    out = {"document_type": _txt(root, "documentType"), "period": _txt(root, "periodOfReport"),
           "issuer_cik": (_txt(root, "issuer/issuerCik") or "").zfill(10),
           "issuer_symbol": _txt(root, "issuer/issuerTradingSymbol"),
           "owner_name": "; ".join(n for n in names if n)[:200], "owner_cik": (ciks[0] if ciks else "")[:10],
           "owner_title": "; ".join(dict.fromkeys(titles))[:200] or None,
           "is_director": rel["director"], "is_officer": rel["officer"], "is_ten_pct": rel["ten"],
           "plan_10b5_1": _flag(plan) if plan is not None else None, "transactions": []}
    for table, deriv in (("nonDerivativeTable", False), ("derivativeTable", True)):
        t = root.find(table)
        if t is None:
            continue
        for tx in t:
            if not tx.tag.endswith("Transaction"):
                continue
            out["transactions"].append({
                "security_title": (_txt(tx, "securityTitle") or "")[:200],
                "tx_date": (_txt(tx, "transactionDate") or "")[:10] or None,
                "tx_code": _txt(tx, "transactionCoding/transactionCode"),
                "shares": _num(_txt(tx, "transactionAmounts/transactionShares")),
                "price": _num(_txt(tx, "transactionAmounts/transactionPricePerShare")),
                "acquired_disposed": _txt(tx, "transactionAmounts/transactionAcquiredDisposedCode"),
                "shares_after": _num(_txt(tx, "postTransactionAmounts/sharesOwnedFollowingTransaction")),
                "direct_indirect": _txt(tx, "ownershipNature/directOrIndirectOwnership"),
                "is_derivative": deriv,
            })
    return out


def _submissions(cik: str) -> Dict[str, Any]:
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    return json.loads(get_fetcher().get(url, ttl_h=6, accept="application/json"))


def form4_refs(sub: Dict[str, Any], since: date, limit: int) -> List[Dict[str, str]]:
    r = (sub.get("filings") or {}).get("recent") or {}
    n = len(r.get("accessionNumber") or [])
    out = []
    for i in range(n):
        form = r["form"][i]
        if form not in ("4", "4/A"):
            continue
        filed = r["filingDate"][i]
        if filed < since.isoformat():
            continue
        doc = r["primaryDocument"][i]
        out.append({"accession": r["accessionNumber"][i], "form": form, "filed": filed,
                    "accepted": (r.get("acceptanceDateTime") or [""] * n)[i], "xml": doc.rsplit("/", 1)[-1]})
    out.sort(key=lambda x: (x["filed"], x["accession"]), reverse=True)
    return out[:limit]


def refresh_ticker(db: Session, ticker: str, *, limit: int = MAX_FILINGS, today: Optional[date] = None) -> Dict[str, Any]:
    t = norm_ticker(ticker)
    cik = cik_for(t)
    if not cik:
        raise LookupError(f"{t} has no SEC CIK (not an SEC registrant)")
    since = (today or date.today()) - timedelta(days=LOOKBACK_DAYS)
    refs = form4_refs(_submissions(cik), since, limit)
    have = {a for (a,) in db.query(InsiderTransaction.accession).filter(InsiderTransaction.ticker == t).distinct()}
    rows, errors = [], 0
    for ref in refs:
        if ref["accession"] in have:
            continue
        url = f"{ARCHIVES}/{int(cik)}/{ref['accession'].replace('-', '')}/{ref['xml']}"
        try:
            doc = parse_form4(get_fetcher().get(url, ttl_h=None, accept="application/xml"))
        except (FetchError, ET.ParseError, Exception) as e:          # one bad filing never stops the rest
            errors += 1
            logger.info("form4 %s skipped: %s", ref["accession"], e)
            continue
        avail = iso_utc(ref["accepted"]) or datetime.fromisoformat(ref["filed"] + "T22:00:00+00:00")
        txs = doc["transactions"] or [{"security_title": None, "tx_date": doc["period"], "tx_code": None,
                                       "shares": None, "price": None, "acquired_disposed": None,
                                       "shares_after": None, "direct_indirect": None, "is_derivative": False}]
        for i, tx in enumerate(txs):
            rows.append({"ticker": t, "issuer_cik": cik, "accession": ref["accession"], "line_no": i,
                         "form": ref["form"], "filed_date": ref["filed"], "available_at": avail,
                         "owner_cik": doc["owner_cik"], "owner_name": doc["owner_name"],
                         "owner_title": doc["owner_title"], "is_director": doc["is_director"],
                         "is_officer": doc["is_officer"], "is_ten_pct": doc["is_ten_pct"],
                         "plan_10b5_1": doc["plan_10b5_1"], "url": url[:300], "source": SOURCE, **tx})
    n = store.upsert(db, InsiderTransaction, rows, ("accession", "line_no"))
    store.mark_load(db, "form4", t, rows=n, note=f"filings={len(refs)} errors={errors}")
    return {"ticker": t, "filings_checked": len(refs), "rows_added": n, "errors": errors}


def _tx_dict(r: InsiderTransaction) -> Dict[str, Any]:
    value = (r.shares or 0) * (r.price or 0) if r.shares is not None and r.price is not None else None
    return {"date": r.tx_date, "filed": r.filed_date, "insider": r.owner_name, "title": r.owner_title,
            "relationship": ", ".join(x for x, f in (("Director", r.is_director), ("Officer", r.is_officer),
                                                       ("10% owner", r.is_ten_pct)) if f) or None,
            "code": r.tx_code, "type": CODE_LABELS.get(r.tx_code or "", r.tx_code),
            "derivative": bool(r.is_derivative), "security": r.security_title, "shares": r.shares,
            "price": r.price, "value": round(value, 2) if value is not None else None,
            "acquired_disposed": r.acquired_disposed, "shares_after": r.shares_after,
            "plan_10b5_1": r.plan_10b5_1, "accession": r.accession, "url": r.url,
            "available_at": store.iso(r.available_at)}


def summarize(rows: List[InsiderTransaction], days: int, today: Optional[date] = None) -> Dict[str, Any]:
    """Open-market (code P / S, non-derivative) buys vs sells over ``days``."""
    cutoff = ((today or date.today()) - timedelta(days=days)).isoformat()
    buys = sells = 0
    buy_val = sell_val = buy_sh = sell_sh = 0.0
    buyers, sellers = set(), set()
    plan_sells = 0
    for r in rows:
        if r.is_derivative or not r.tx_date or r.tx_date < cutoff or r.tx_code not in ("P", "S"):
            continue
        v = (r.shares or 0) * (r.price or 0)
        if r.tx_code == "P":
            buys += 1
            buy_val += v
            buy_sh += r.shares or 0
            buyers.add(r.owner_name)
        else:
            sells += 1
            sell_val += v
            sell_sh += r.shares or 0
            sellers.add(r.owner_name)
            plan_sells += 1 if r.plan_10b5_1 else 0
    return {"days": days, "buy_transactions": buys, "sell_transactions": sells,
            "buy_value": round(buy_val, 2), "sell_value": round(sell_val, 2),
            "net_value": round(buy_val - sell_val, 2), "buy_shares": buy_sh, "sell_shares": sell_sh,
            "net_shares": buy_sh - sell_sh, "distinct_buyers": len(buyers), "distinct_sellers": len(sellers),
            "sells_under_10b5_1_plan": plan_sells}


def insider_payload(db: Session, ticker: str, *, days: int = 180, limit: int = 40,
                    as_of: Optional[datetime] = None) -> Dict[str, Any]:
    from app.services.public_data.sources import attribution
    t = norm_ticker(ticker)
    q = db.query(InsiderTransaction).filter(InsiderTransaction.ticker == t)
    if as_of is not None:
        q = q.filter(InsiderTransaction.available_at <= as_of)
    rows = q.order_by(InsiderTransaction.tx_date.desc(), InsiderTransaction.accession.desc(),
                      InsiderTransaction.line_no).all()
    load = store.load_row(db, "form4", t)
    latest = max((r.filed_date for r in rows if r.filed_date), default=None)
    today = as_of.date() if as_of else None
    real = [r for r in rows if r.tx_code]
    return {"ticker": t, "status": "ok" if real else ("empty" if load else "not_loaded"),
            "summary": {str(d): summarize(real, d, today) for d in sorted({90, days, 365})},
            "transactions": [_tx_dict(r) for r in real[:limit]],
            "latest_filing": latest, "refreshed_at": store.iso(load.loaded_at) if load else None,
            "notes": ["Net activity counts open-market purchases (P) and sales (S) of non-derivative shares only; "
                      "awards, option exercises and tax withholding are listed but not netted.",
                      "Form 4 is due within 2 business days of the trade."],
            "attribution": attribution("sec_form4", latest)}
