"""Geographic revenue mix from the latest annual filing's XBRL instance.

companyfacts carries no dimensional facts, so the split is read from the
10-K / 20-F instance document: revenue facts whose context has exactly one
explicit member on the geographic axis (srt/us-gaap StatementGeographicalAxis
or ifrs-full GeographicalAreasAxis) for the fiscal-year duration.

  foreign share = 1 - home-country revenue / total revenue   (home member present)
                = non-home member revenue / total revenue     (e.g. us-gaap:NonUsMember)
Otherwise the members are returned but the share is None (not determinable).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any, Dict, Optional

GEO_AXES = {"StatementGeographicalAxis", "GeographicalAreasAxis"}
REVENUE_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue", "RevenueFromContractsWithCustomers"]
HOME_COUNTRY = {"USD": "US", "TWD": "TW", "JPY": "JP", "KRW": "KR", "CNY": "CN", "GBP": "GB", "CAD": "CA",
                "INR": "IN", "CHF": "CH", "AUD": "AU", "BRL": "BR", "MXN": "MX"}
_NON_HOME = re.compile(r"(NonUs|NonUS|Foreign|International|OutsideUnitedStates|OutsideOfUnitedStates)", re.I)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _days(s: str, e: str) -> int:
    return (datetime.strptime(e, "%Y-%m-%d") - datetime.strptime(s, "%Y-%m-%d")).days


def _is_home(member: str, home: str) -> bool:
    prefix, _, name = member.partition(":")
    if prefix.lower() == "country":
        return name.upper() == home
    if home == "US":
        return bool(re.fullmatch(r"(srt:|us-gaap:)?(UnitedStates|US|Domestic)(Member)?", member, re.I)) or \
            name in ("UNITEDSTATES", "UnitedStatesMember", "DomesticMember")
    return False


def parse_instance(xml_bytes: bytes, period_end: str, currency: str) -> Optional[Dict[str, Any]]:
    root = ET.fromstring(xml_bytes)
    contexts: Dict[str, Dict[str, Any]] = {}
    for ctx in root.iter():
        if _local(ctx.tag) != "context":
            continue
        cid = ctx.get("id")
        start = end = None
        members = []
        for el in ctx.iter():
            ln = _local(el.tag)
            if ln == "startDate":
                start = (el.text or "").strip()
            elif ln == "endDate":
                end = (el.text or "").strip()
            elif ln == "explicitMember":
                members.append(((el.get("dimension") or "").split(":")[-1], (el.text or "").strip()))
            elif ln == "typedMember":
                members.append(("typed", "typed"))
        contexts[cid] = {"start": start, "end": end, "members": members}

    def annual(c):
        return c["start"] and c["end"] == period_end and 340 <= _days(c["start"], c["end"]) <= 390

    by_tag: Dict[str, Dict[str, Any]] = {}
    for el in root:
        ln = _local(el.tag)
        if ln not in REVENUE_TAGS:
            continue
        c = contexts.get(el.get("contextRef"))
        if not c or not annual(c):
            continue
        try:
            val = float((el.text or "").strip())
        except ValueError:
            continue
        unit = (el.get("unitRef") or "").upper()
        if currency.upper() not in unit:
            continue
        slot = by_tag.setdefault(ln, {"total": None, "members": {}})
        if not c["members"]:
            slot["total"] = val
        elif len(c["members"]) == 1 and c["members"][0][0] in GEO_AXES:
            slot["members"][c["members"][0][1]] = val
    for tag in REVENUE_TAGS:
        slot = by_tag.get(tag)
        if slot and slot["members"] and slot["total"]:
            return {"tag": tag, "total": slot["total"], "members": slot["members"]}
    return None


def mix(parsed: Dict[str, Any], currency: str) -> Dict[str, Any]:
    home = HOME_COUNTRY.get(currency.upper())
    total = parsed["total"]
    members = parsed["members"]
    rows = sorted(({"member": m, "revenue": v, "share_pct": round(v / total * 100, 2)} for m, v in members.items()),
                  key=lambda x: -x["revenue"])
    out: Dict[str, Any] = {"tag": parsed["tag"], "total_revenue": total, "members": rows, "home_country": home,
                           "foreign_share": None}
    home_m = [m for m in members if home and _is_home(m, home)]
    non_home = [m for m in members if _NON_HOME.search(m.split(":")[-1])]
    if home_m:
        out["foreign_share"] = 1.0 - members[home_m[0]] / total
        out["formula"] = f"1 - {home_m[0]} revenue / total revenue"
    elif non_home and home == "US":
        out["foreign_share"] = members[non_home[0]] / total
        out["formula"] = f"{non_home[0]} revenue / total revenue"
    else:
        out["note"] = (f"no {home or 'home-country'} member on the geographic axis; foreign share not determinable "
                       "(regional members may mix home and foreign revenue)")
    return out
