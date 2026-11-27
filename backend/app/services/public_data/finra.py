"""FINRA equity short interest (bi-monthly) and Reg SHO daily short-sale volume.

Terms (checked 2026-11-27; see sources.py): FINRA's Terms of Use
(https://www.finra.org/terms-of-use) allow only non-commercial personal or
professional use, require FINRA's prior written consent to display or
redistribute, and forbid use with machine-learning programs.  API terms:
https://developer.finra.org/ ("API Terms of Service", "Specific Terms - Equity
Data").  Reg SHO short-sale volume is "free for non-commercial use"
(https://www.finra.org/finra-data/browse-catalog/short-sale-volume).
=> Everything here is OFF unless FINRA_DATA_ENABLED=1, and none of it is
written to ML feature tables.

Short interest: FINRA Query API, dataset otcMarket/consolidatedShortInterest
(exchange-listed and OTC, all FINRA members), published 7 business days after
each settlement date (mid-month and month-end).  ``available_at`` = settlement
date + 7 business days, 18:00 ET (FINRA's dissemination schedule; not the
exact minute of publication).

Short-sale volume: daily file https://cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt
(consolidated NMS; trades reported to FINRA TRFs/ADF/ORF only).  It is short
*volume* -- many short sales are market-maker hedges -- and is not short
interest; the payload says so.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.public_data import ShortInterest, ShortSaleVolume
from app.services.public_data import store
from app.services.public_data.http import FetchError, get_fetcher
from app.services.public_data.sec_common import add_business_days, date_end_of_day_et, norm_ticker

logger = logging.getLogger(__name__)

SI_URL = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
REGSHO_URL = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{d}.txt"
SI_SOURCE = "FINRA consolidated short interest"
SV_SOURCE = "FINRA Reg SHO daily short-sale volume (CNMS)"
PUBLICATION_LAG_BDAYS = 7


def fetch_short_interest(symbol: str, start: date, end: date) -> List[Dict[str, Any]]:
    body = {"limit": 200,
            "compareFilters": [{"compareType": "equal", "fieldName": "symbolCode", "fieldValue": symbol}],
            "dateRangeFilters": [{"fieldName": "settlementDate", "startDate": start.isoformat(),
                                  "endDate": end.isoformat()}]}
    raw = get_fetcher().get(SI_URL, ttl_h=12, method="POST", json_body=body, accept="application/json")
    data = json.loads(raw or b"[]")
    if isinstance(data, dict):            # error document
        raise FetchError(data.get("message") or "FINRA API error")
    return data


def parse_short_interest(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        sd = r.get("settlementDate")
        if not sd or not r.get("symbolCode"):
            continue
        pub = add_business_days(date.fromisoformat(sd), PUBLICATION_LAG_BDAYS)
        out.append({"symbol": r["symbolCode"].upper(), "settlement_date": sd,
                    "current_short": r.get("currentShortPositionQuantity"),
                    "previous_short": r.get("previousShortPositionQuantity"),
                    "change_pct": r.get("changePercent"), "avg_daily_volume": r.get("averageDailyVolumeQuantity"),
                    "days_to_cover": r.get("daysToCoverQuantity"), "market_class": r.get("marketClassCode"),
                    "available_at": date_end_of_day_et(pub.isoformat()), "source": SI_SOURCE})
    return out


def parse_regsho(text: str) -> List[Dict[str, Any]]:
    lines = text.splitlines()
    if not lines or not lines[0].startswith("Date|"):
        return []
    out = []
    for l in lines[1:]:
        p = l.split("|")
        if len(p) < 6 or not p[0].isdigit():
            continue
        d = f"{p[0][:4]}-{p[0][4:6]}-{p[0][6:8]}"
        try:
            out.append({"symbol": p[1].upper(), "trade_date": d, "short_volume": float(p[2]),
                        "short_exempt_volume": float(p[3]), "total_volume": float(p[4]), "markets": p[5][:32],
                        "available_at": date_end_of_day_et(d), "source": SV_SOURCE})
        except ValueError:
            continue
    return out


def refresh_short_interest(db: Session, symbol: str, *, today: Optional[date] = None, days: int = 400) -> int:
    s = norm_ticker(symbol).replace("-", ".")     # FINRA uses BRK.B
    end = today or date.today()
    rows = parse_short_interest(fetch_short_interest(s, end - timedelta(days=days), end))
    for r in rows:
        r["symbol"] = norm_ticker(r["symbol"])
    n = store.upsert(db, ShortInterest, rows, ("symbol", "settlement_date"))
    store.mark_load(db, "finra_si", norm_ticker(symbol), rows=n)
    return n


def refresh_regsho(db: Session, symbols: List[str], *, today: Optional[date] = None, days: int = 10) -> int:
    """Load the last ``days`` trading-day files, keeping only ``symbols``."""
    want = {norm_ticker(s).replace("-", ".") for s in symbols}
    end = today or date.today()
    total = 0
    d = end
    for _ in range(days + 6):
        if d.weekday() < 5:
            key = d.strftime("%Y%m%d")
            if store.load_row(db, "finra_regsho", key) is None or d >= end - timedelta(days=1):
                try:
                    text = get_fetcher().get(REGSHO_URL.format(d=key), ttl_h=None if d < end else 2,
                                             accept="text/plain").decode("utf-8", errors="replace")
                except FetchError as e:              # holiday / not yet published
                    logger.info("regsho %s unavailable: %s", key, e)
                    d -= timedelta(days=1)
                    continue
                rows = [r for r in parse_regsho(text) if r["symbol"] in want]
                for r in rows:
                    r["symbol"] = norm_ticker(r["symbol"])
                total += store.upsert(db, ShortSaleVolume, rows, ("symbol", "trade_date"))
                store.mark_load(db, "finra_regsho", key, rows=len(rows))
        d -= timedelta(days=1)
    return total


def short_payload(db: Session, symbol: str, *, as_of: Optional[datetime] = None) -> Dict[str, Any]:
    from app.services.public_data.sources import attribution
    t = norm_ticker(symbol)
    q = db.query(ShortInterest).filter(ShortInterest.symbol == t)
    v = db.query(ShortSaleVolume).filter(ShortSaleVolume.symbol == t)
    if as_of is not None:
        q = q.filter(ShortInterest.available_at <= as_of)
        v = v.filter(ShortSaleVolume.available_at <= as_of)
    si = q.order_by(ShortInterest.settlement_date.desc()).limit(12).all()
    sv = v.order_by(ShortSaleVolume.trade_date.desc()).limit(20).all()
    latest = si[0] if si else None
    sv_ratio = [{"date": r.trade_date, "short_volume": r.short_volume, "total_volume": r.total_volume,
                 "short_ratio_pct": round(r.short_volume / r.total_volume * 100, 2) if r.total_volume else None}
                for r in sv]
    avg_ratio = None
    vals = [x["short_ratio_pct"] for x in sv_ratio if x["short_ratio_pct"] is not None]
    if vals:
        avg_ratio = round(sum(vals) / len(vals), 2)
    return {
        "symbol": t, "status": "ok" if (si or sv) else "not_loaded",
        "short_interest": ({"settlement_date": latest.settlement_date, "shares_short": latest.current_short,
                            "previous_shares_short": latest.previous_short, "change_pct": latest.change_pct,
                            "avg_daily_volume": latest.avg_daily_volume, "days_to_cover": latest.days_to_cover,
                            "published_on_or_after": store.iso(latest.available_at)} if latest else None),
        "history": [{"settlement_date": r.settlement_date, "shares_short": r.current_short,
                     "days_to_cover": r.days_to_cover, "change_pct": r.change_pct} for r in reversed(si)],
        "short_volume": {"days": sv_ratio, "avg_short_ratio_pct": avg_ratio,
                         "latest_date": sv[0].trade_date if sv else None},
        "notes": ["Short interest is reported twice a month and published about 7 business days after the "
                  "settlement date.",
                  "Daily short-sale volume covers off-exchange trades reported to FINRA only and includes "
                  "market-maker hedging; it is not the same as short interest."],
        "attribution": attribution("finra_si", latest.settlement_date if latest else None,
                                   extra="short interest + Reg SHO short-sale volume"),
    }
