"""Interest-rate sensitivity for banks.

The bank's own disclosed net-interest-income sensitivity (earnings-at-risk
table in the 10-K/10-Q market-risk section) is the primary source: it already
embeds the bank's balance-sheet repricing and deposit-beta assumptions. The
table is parsed from filing text with a conservative parser; if the parse is
ambiguous nothing is computed and the excerpts are returned instead.

Derived (deterministic) on top of the disclosed figure:
  EPS impact          = disclosed change in NII * (1 - tax rate) / diluted shares
Context computed from XBRL:
  cost of deposits    = interest expense on deposits / average deposits
Only when the caller supplies the missing parameter (labelled as assumption):
  deposit cost change = deposit_beta * rate shift * deposits
  securities value    = -duration * rate shift * AFS fair value  (+ HTM fair value, not in OCI)
Credit losses have no deterministic rate link in the filings; reported as
unavailable with the latest provision for context.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from app.services.valuation.provenance import AssumptionLog, DataUnavailable, pct, r

NII_QUERY = ("net interest income sensitivity earnings-at-risk parallel shift +100 basis points -100 basis points "
             "instantaneous change in interest rates")

_SHOCK = re.compile(r"(?<![\w.])(?:(\+|-|−|–)\s*|\(\s*)?(\d{2,3})\s*\)?\s*(?:bps|bp|basis\s+points?)\b", re.I)
_NUM = re.compile(r"\(\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*\)|(-|−)?\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(%)?")
_UNIT = re.compile(r"\(\s*in\s+(billions|millions|thousands)", re.I)
_LABEL = re.compile(r"(net interest income|\bNII\b|earnings[- ]at[- ]risk)", re.I)
_MULT = {"billions": 1e9, "millions": 1e6, "thousands": 1e3}


def _shock_header(line: str) -> List[int]:
    out = []
    for m in _SHOCK.finditer(line):
        sign = m.group(1)
        v = int(m.group(2))
        neg = (sign in ("-", "−", "–")) or (m.group(0).lstrip().startswith("("))
        out.append(-v if neg else v)
    return out


def _numbers(s: str) -> List[Tuple[float, bool]]:
    vals = []
    for m in _NUM.finditer(s):
        if m.group(1):
            vals.append((-float(m.group(1).replace(",", "")), False))
        elif m.group(3):
            v = float(m.group(3).replace(",", ""))
            vals.append((-v if m.group(2) else v, bool(m.group(4))))
    return vals


def parse_nii_table(text: str) -> Optional[Dict[str, Any]]:
    """Find a header with >= 2 bp shocks, then the first following line
    labelled NII / earnings-at-risk with exactly as many numbers. Returns
    {shock_bp: value} or None when the table cannot be read unambiguously."""
    lines = [ln.strip() for ln in re.split(r"[\n\r]+", text or "") if ln.strip()]
    unit_m = _UNIT.search(text or "")
    mult = _MULT[unit_m.group(1).lower()] if unit_m else None
    for i, ln in enumerate(lines):
        shocks = _shock_header(ln)
        if len(shocks) < 2 or len(set(shocks)) != len(shocks):
            continue
        for row in lines[i + 1:i + 6]:
            if not _LABEL.search(row):
                continue
            body = _SHOCK.sub(" ", row)
            body = re.sub(r"\b(19|20)\d{2}\b", " ", body)        # years in labels
            nums = _numbers(_LABEL.split(body)[-1])
            if len(nums) != len(shocks):
                continue
            is_pct = all(p for _, p in nums)
            if not is_pct and mult is None:
                return None                                       # unknown unit -> refuse
            return {"shocks_bp": shocks, "values": [v for v, _ in nums],
                    "unit": "percent of NII" if is_pct else f"USD {unit_m.group(1).lower()}",
                    "multiplier": None if is_pct else mult, "header": ln, "row": row}
    return None


def rate_sensitivity(fin, chunks: List[Any], shock_bp: int, params: Dict[str, Any], tax_rate: float) -> Dict[str, Any]:
    y = fin.latest
    if y.get("deposits") is None and fin.balance.get("deposits") is None and y.get("net_interest_income") is None:
        raise DataUnavailable(f"{fin.ticker} reports no deposits or net interest income in XBRL; this tool covers "
                              "banks (use the scenario tool's rate_shock for non-banks)")
    log = AssumptionLog()
    shock = shock_bp / 10000.0
    out: Dict[str, Any] = {"shock_bp": shock_bp, "fiscal_year": y.fiscal_year}
    nii = y.datum("net_interest_income")
    sh = y.get("shares_diluted")
    out["net_interest_income_latest_fy"] = nii.to_dict() if nii else None

    parsed, used = None, None
    for c in chunks:
        res = parse_nii_table(getattr(c, "text", "") or "")
        if res and shock_bp in res["shocks_bp"] and -shock_bp in res["shocks_bp"]:
            parsed, used = res, c
            break
    if parsed:
        rows = {}
        for s in (shock_bp, -shock_bp):
            v = parsed["values"][parsed["shocks_bp"].index(s)]
            if parsed["multiplier"]:
                d_nii = v * parsed["multiplier"]
            elif nii is not None:
                d_nii = v / 100.0 * nii.value
            else:
                d_nii = None
            eps = d_nii * (1 - tax_rate) / sh if d_nii is not None and sh else None
            rows["up" if s > 0 else "down"] = {
                "shock_bp": s, "disclosed_value": v, "disclosed_unit": parsed["unit"],
                "nii_change": r(d_nii, 0), "nii_change_pct": pct(d_nii / nii.value) if d_nii is not None and nii else None,
                "eps_impact": r(eps, 4)}
        out["disclosed_nii_sensitivity"] = {
            **rows, "source_fact_id": getattr(used, "id", None), "filing_type": getattr(used, "filing_type", None),
            "filed_date": getattr(used, "filed_date", None), "accession": getattr(used, "accession", None),
            "section": getattr(used, "section", None), "table_header": parsed["header"], "table_row": parsed["row"],
            "formula": "EPS impact = change in NII x (1 - tax rate) / diluted shares; NII change as disclosed "
                       "(percent rows x latest FY NII)"}
        log.add("tax_rate", pct(tax_rate), "effective tax rate from XBRL (see base case)", "derived_default")
    else:
        out["disclosed_nii_sensitivity"] = None
        out["nii_unavailable_reason"] = (
            f"No NII sensitivity table with both +{shock_bp}bp and -{shock_bp}bp could be read unambiguously from "
            f"{len(chunks)} retrieved filing passage(s). Nothing was computed; the passages are attached so the "
            "disclosure can be quoted directly.")
        out["excerpts"] = [{"fact_id": getattr(c, "id", None), "filing_type": getattr(c, "filing_type", None),
                            "filed_date": getattr(c, "filed_date", None), "section": getattr(c, "section", None),
                            "text": (getattr(c, "text", "") or "")[:900]} for c in chunks[:3]]

    # deposit costs (XBRL)
    dep_now = fin.balance.get("deposits") or y.datum("deposits")
    dep_fy = y.get("deposits")
    prior = fin.years[-2] if len(fin.years) >= 2 else None
    int_dep = y.get("interest_expense_deposits")
    dep: Dict[str, Any] = {}
    if int_dep is not None and dep_fy:
        avg = (dep_fy + prior.get("deposits")) / 2 if prior and prior.get("deposits") else dep_fy
        dep["cost_of_deposits_pct"] = pct(int_dep / avg)
        dep["interest_expense_on_deposits"] = r(int_dep, 0)
        dep["average_deposits"] = r(avg, 0)
        dep["formula"] = "interest expense on deposits / average deposits (FY end, prior FY end)"
    if dep_now is not None:
        dep["deposits_latest"] = dep_now.to_dict()
    if params.get("deposit_beta") is not None and dep_now is not None:
        b = float(params["deposit_beta"])
        log.add("deposit_beta", b, "caller-supplied ASSUMPTION (share of the rate move passed to deposit rates)", "user_input")
        dep["deposit_cost_change_up"] = r(b * shock * dep_now.value, 0)
        dep["deposit_cost_change_down"] = r(-b * shock * dep_now.value, 0)
        dep["deposit_formula"] = "deposit_beta x rate shift x deposits (illustrative; the disclosed NII figure already includes the bank's own deposit assumptions)"
    else:
        dep["deposit_cost_change"] = None
        dep["deposit_note"] = ("Deposit repricing (deposit beta) is not disclosed in XBRL; pass deposit_beta to compute "
                               "an illustrative change. The disclosed NII sensitivity already embeds it.")
    out["deposits"] = dep

    afs = fin.balance.get("afs_securities") or y.datum("afs_securities")
    htm = fin.balance.get("htm_securities_fair_value") or y.datum("htm_securities_fair_value")
    sec: Dict[str, Any] = {"afs_fair_value": afs.to_dict() if afs else None,
                           "htm_fair_value": htm.to_dict() if htm else None}
    if params.get("securities_duration_years") is not None and (afs or htm):
        dur = float(params["securities_duration_years"])
        log.add("securities_duration_years", dur, "caller-supplied; cite the filing that discloses it", "user_input")
        if afs:
            sec["afs_value_change_up"] = r(-dur * shock * afs.value, 0)
            sec["afs_value_change_down"] = r(dur * shock * afs.value, 0)
        if htm:
            sec["htm_value_change_up"] = r(-dur * shock * htm.value, 0)
            sec["htm_value_change_down"] = r(dur * shock * htm.value, 0)
        sec["formula"] = ("value change = -duration x rate shift x fair value (first-order, no convexity); AFS hits "
                          "OCI/CET1 for non-opted-out banks, HTM changes are unrecognised")
    else:
        sec["note"] = ("Portfolio duration is not in XBRL; pass securities_duration_years (from the filing) to "
                       "compute the first-order fair-value change.")
    out["securities"] = sec
    prov = y.datum("provision_credit_losses")
    out["credit_losses"] = {"provision_latest_fy": prov.to_dict() if prov else None,
                            "rate_sensitivity": None,
                            "note": "Filings do not give a deterministic link from rates to credit losses; no estimate is made."}
    out["assumptions"] = log.to_list()
    return out
