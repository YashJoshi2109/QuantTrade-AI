"""Specific disclosures: XBRL values filed in the accession + the narrative excerpt.

For each topic:
  * XBRL: every us-gaap value of the topic's concepts whose ``accn`` is the
    filing's accession (i.e. exactly as filed in that 10-K / 10-Q), current
    period first, plus the comparative period; full provenance per value.
  * checks: deterministic reconciliations between those values (e.g. sum of
    the lease maturity ladder vs the filed undiscounted total), each with its
    formula, inputs, difference and whether it reconciles (|diff| <= 0.5%).
  * narrative: BM25 over the topic's sections, boosted by the topic's regex
    patterns; only passages that contain a pattern match are returned, with
    the matching sentences quoted verbatim.

Limitation stated in every result where it applies: the SEC companyfacts API
carries only non-dimensional facts, so values reported by axis (revenue by
geography, concentration by customer) are not in it; for those topics the
numbers come from the narrative excerpts only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services.copilot.filings_rag.facts import ComputedFact, FilingExcerptFact, XbrlValueFact, short_id
from app.services.copilot.filings_rag.parse import sentence_spans
from app.services.copilot.filings_rag.retrieve import Selection, retrieve
from app.services.copilot.filings_rag.store import FilingRef, FilingsService, LoadedDoc

RECONCILE_TOL = 0.005
DIMENSIONAL_NOTE = ("SEC companyfacts carries only non-dimensional XBRL facts; this breakdown is tagged by "
                    "axis/member, so its figures come from the quoted filing text only.")

_LADDER_OP = ["LesseeOperatingLeaseLiabilityPaymentsRemainderOfFiscalYear",
              "LesseeOperatingLeaseLiabilityPaymentsDueNextTwelveMonths",
              "LesseeOperatingLeaseLiabilityPaymentsDueYearTwo", "LesseeOperatingLeaseLiabilityPaymentsDueYearThree",
              "LesseeOperatingLeaseLiabilityPaymentsDueYearFour", "LesseeOperatingLeaseLiabilityPaymentsDueYearFive",
              "LesseeOperatingLeaseLiabilityPaymentsDueAfterYearFive"]
_LADDER_FIN = ["FinanceLeaseLiabilityPaymentsRemainderOfFiscalYear", "FinanceLeaseLiabilityPaymentsDueNextTwelveMonths",
               "FinanceLeaseLiabilityPaymentsDueYearTwo", "FinanceLeaseLiabilityPaymentsDueYearThree",
               "FinanceLeaseLiabilityPaymentsDueYearFour", "FinanceLeaseLiabilityPaymentsDueYearFive",
               "FinanceLeaseLiabilityPaymentsDueAfterYearFive"]
_LADDER_DEBT = ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
                "LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear",
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree",
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive",
                "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"]
_LADDER_PURCH = ["PurchaseObligationDueInNextTwelveMonths", "PurchaseObligationDueInSecondYear",
                 "PurchaseObligationDueInThirdYear", "PurchaseObligationDueInFourthYear",
                 "PurchaseObligationDueInFifthYear", "PurchaseObligationDueAfterFifthYear"]
_LADDER_UPO = ["UnrecordedUnconditionalPurchaseObligationDueWithinOneYear",
               "UnrecordedUnconditionalPurchaseObligationDueWithinTwoYears",
               "UnrecordedUnconditionalPurchaseObligationDueWithinThreeYears",
               "UnrecordedUnconditionalPurchaseObligationDueWithinFourYears",
               "UnrecordedUnconditionalPurchaseObligationDueWithinFiveYears",
               "UnrecordedUnconditionalPurchaseObligationDueAfterFiveYears"]


@dataclass(frozen=True)
class Check:
    name: str
    plus: Tuple[str, ...]
    minus: Tuple[str, ...] = ()
    against: Optional[str] = None            # filed total the result is compared with
    min_parts: int = 2


@dataclass(frozen=True)
class Topic:
    key: str
    title: str
    query: str
    patterns: str
    sections: Dict[str, Tuple[str, ...]]
    xbrl: Tuple[str, ...] = ()
    checks: Tuple[Check, ...] = ()
    note: Optional[str] = None
    sentences_only: bool = False             # guidance: return sentences, not chunks

    def regex(self) -> re.Pattern:
        return re.compile(self.patterns, re.I)


_FS = ("financial_statements", "mdna")
TOPICS: Dict[str, Topic] = {t.key: t for t in [
    Topic("customer_concentration", "Customer concentration",
          "customer accounted for percent of total revenue concentration direct customer indirect customer distributor",
          r"(?:customer|distributor|partner|reseller)s?\b[^.\n]{0,220}?\d{1,3}(?:\.\d+)?\s?%"
          r"|\d{1,3}(?:\.\d+)?\s?%\s+of\s+(?:our\s+)?(?:total\s+|net\s+)*(?:revenue|sales)"
          r"|concentration of (?:credit )?risk|(?:significant|major|largest) customers?",
          {"10-K": ("risk_factors", "mdna", "financial_statements", "business"),
           "10-Q": ("financial_statements", "mdna", "risk_factors")},
          note=DIMENSIONAL_NOTE),
    Topic("geographic_revenue", "Revenue by geography",
          "revenue by geographic area region country united states taiwan china singapore europe international",
          r"\b(?:United States|U\.S\.|China|Taiwan|Singapore|Europe|EMEA|Asia[- ]Pacific|Americas|Japan|"
          r"international|foreign|other countries|geographic)\b[^.\n]{0,200}?(?:\$\s?\d|\d{1,3}(?:\.\d+)?\s?%|revenue)",
          {"10-K": ("financial_statements", "mdna", "business"), "10-Q": ("financial_statements", "mdna")},
          xbrl=("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"), note=DIMENSIONAL_NOTE),
    Topic("purchase_commitments", "Inventory and purchase commitments",
          "purchase obligations commitments inventory supply capacity agreements non-cancelable prepaid supply",
          r"purchase (?:obligations?|commitments?)|(?:inventory|supply|capacity|manufacturing)[^.\n]{0,100}?"
          r"(?:commitments?|obligations?|agreements?)|non-?cancel(?:l)?able",
          {"10-K": ("financial_statements", "mdna", "risk_factors"), "10-Q": ("financial_statements", "mdna")},
          xbrl=("PurchaseObligation", *_LADDER_PURCH, "UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount",
                *_LADDER_UPO, "InventoryNet"),
          checks=(Check("purchase obligations by year (sum)", tuple(_LADDER_PURCH), against="PurchaseObligation"),
                  Check("unconditional purchase obligations by year (sum)", tuple(_LADDER_UPO),
                        against="UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount"))),
    Topic("remaining_performance_obligations", "Remaining performance obligations",
          "remaining performance obligations revenue expected to be recognized next 12 months contracted not recognized",
          r"remaining performance obligations?|(?:expected|expect) to recogni[sz]e[^.\n]{0,120}?(?:months|years)",
          {"10-K": _FS, "10-Q": _FS},
          xbrl=("RevenueRemainingPerformanceObligation",)),
    Topic("deferred_revenue", "Deferred revenue / contract liabilities",
          "deferred revenue unearned revenue contract liabilities recognized",
          r"(?:deferred|unearned) revenue|contract liabilit(?:y|ies)",
          {"10-K": _FS, "10-Q": _FS},
          xbrl=("ContractWithCustomerLiability", "ContractWithCustomerLiabilityCurrent",
                "ContractWithCustomerLiabilityNoncurrent", "ContractWithCustomerLiabilityRevenueRecognized",
                "DeferredRevenue", "DeferredRevenueCurrent", "DeferredRevenueNoncurrent"),
          checks=(Check("contract liabilities = current + noncurrent",
                        ("ContractWithCustomerLiabilityCurrent", "ContractWithCustomerLiabilityNoncurrent"),
                        against="ContractWithCustomerLiability"),
                  Check("deferred revenue = current + noncurrent", ("DeferredRevenueCurrent", "DeferredRevenueNoncurrent"),
                        against="DeferredRevenue"))),
    Topic("operating_leases", "Operating lease liabilities and maturities",
          "operating lease liabilities maturities undiscounted lease payments imputed interest weighted average discount rate",
          r"operating leases?|lease liabilit(?:y|ies)|lease payments",
          {"10-K": _FS, "10-Q": _FS},
          xbrl=("OperatingLeaseLiability", "OperatingLeaseLiabilityCurrent", "OperatingLeaseLiabilityNoncurrent",
                *_LADDER_OP, "LesseeOperatingLeaseLiabilityPaymentsDue",
                "LesseeOperatingLeaseLiabilityUndiscountedExcessAmount", "OperatingLeaseRightOfUseAsset",
                "OperatingLeasePayments", "OperatingLeaseCost", "OperatingLeaseWeightedAverageDiscountRatePercent",
                "OperatingLeaseWeightedAverageRemainingLeaseTerm1"),
          checks=(Check("operating lease payments by year (sum)", tuple(_LADDER_OP),
                        against="LesseeOperatingLeaseLiabilityPaymentsDue"),
                  Check("present value = undiscounted payments - imputed interest",
                        ("LesseeOperatingLeaseLiabilityPaymentsDue",),
                        ("LesseeOperatingLeaseLiabilityUndiscountedExcessAmount",),
                        against="OperatingLeaseLiability", min_parts=1),
                  Check("operating lease liability = current + noncurrent",
                        ("OperatingLeaseLiabilityCurrent", "OperatingLeaseLiabilityNoncurrent"),
                        against="OperatingLeaseLiability"))),
    Topic("finance_leases", "Finance (capital) leases",
          "finance leases capital leases principal repayments of finance leases property and equipment acquired under finance leases",
          r"finance leases?|capital leases?",
          {"10-K": _FS, "10-Q": _FS},
          xbrl=("FinanceLeaseLiability", "FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent",
                *_LADDER_FIN, "FinanceLeaseLiabilityPaymentsDue", "FinanceLeaseLiabilityUndiscountedExcessAmount",
                "FinanceLeasePrincipalPayments", "FinanceLeaseRightOfUseAsset", "FinanceLeaseInterestExpense",
                "FinanceLeaseRightOfUseAssetAmortization"),
          checks=(Check("finance lease payments by year (sum)", tuple(_LADDER_FIN), against="FinanceLeaseLiabilityPaymentsDue"),
                  Check("finance lease present value = undiscounted payments - imputed interest",
                        ("FinanceLeaseLiabilityPaymentsDue",), ("FinanceLeaseLiabilityUndiscountedExcessAmount",),
                        against="FinanceLeaseLiability", min_parts=1))),
    Topic("contractual_obligations", "Contractual obligations and cash requirements",
          "contractual obligations material cash requirements debt principal interest payments leases purchase commitments",
          r"contractual obligations?|(?:material )?cash requirements|payments due by period|debt maturit",
          {"10-K": ("mdna", "financial_statements"), "10-Q": ("mdna", "financial_statements")},
          xbrl=("LongTermDebt", *_LADDER_DEBT, "PurchaseObligation", "LesseeOperatingLeaseLiabilityPaymentsDue",
                "FinanceLeaseLiabilityPaymentsDue"),
          checks=(Check("long-term debt principal maturities (sum)", tuple(_LADDER_DEBT)),)),
    Topic("capex_commitments", "Capital expenditures and commitments",
          "capital expenditures property and equipment data centers construction commitments expect to increase infrastructure",
          r"capital expenditures?|(?:construction|data cent(?:er|re)s?|leases? not yet commenced)[^.\n]{0,120}?"
          r"(?:commitments?|obligations?)|property and equipment",
          {"10-K": ("mdna", "financial_statements", "business"), "10-Q": ("mdna", "financial_statements")},
          xbrl=("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
                "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets", "PropertyPlantAndEquipmentNet",
                "PropertyPlantAndEquipmentGross", "LesseeOperatingLeaseLeaseNotYetCommencedPaymentsDue")),
    Topic("revenue_recognition", "Revenue recognition policy",
          "revenue recognition policy performance obligations recognized when control transfers principal agent",
          r"revenue recognition|recogni[sz]e[sd]? revenue|performance obligations?|transfer of control",
          {"10-K": ("financial_statements", "mdna"), "10-Q": ("financial_statements", "mdna")}),
    Topic("stock_based_compensation", "Stock-based compensation",
          "stock-based compensation expense share-based awards restricted stock units unrecognized compensation",
          r"stock-based compensation|share-based compensation|restricted stock units?",
          {"10-K": _FS, "10-Q": _FS},
          xbrl=("ShareBasedCompensation", "AllocatedShareBasedCompensationExpense",
                "EmployeeServiceShareBasedCompensationNonvestedAwardsTotalCompensationCostNotYetRecognized")),
    Topic("depreciation_useful_lives", "Depreciation and useful lives",
          "estimated useful lives servers network equipment depreciation change in accounting estimate",
          r"useful li(?:fe|ves)|depreciation|change in (?:accounting )?estimate",
          {"10-K": _FS, "10-Q": _FS},
          xbrl=("DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "Depreciation",
                "DepreciationAmortizationAndAccretionNet")),
    Topic("liquidity", "Liquidity and capital resources",
          "liquidity capital resources cash cash equivalents marketable securities sufficient to meet",
          r"liquidity|capital resources|cash,? cash equivalents|sufficient to (?:meet|fund)",
          {"10-K": ("mdna",), "10-Q": ("mdna",)},
          xbrl=("CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
                "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
                "NetCashProvidedByUsedInOperatingActivities")),
    Topic("guidance", "Management guidance / outlook",
          "outlook guidance expects expected to be next quarter fiscal year revenue gross margin plus or minus",
          r"\b(?:outlook|guidance|expects?|expected to be|anticipates?|forecast(?:s|ed)?|plus or minus|projects?|"
          r"we see|targets?)\b",
          {"EX": ("exhibit",), "8-K": ("results_of_operations",), "10-K": ("mdna",), "10-Q": ("mdna",)},
          sentences_only=True),
]}

_BOILER = re.compile(r"forward-looking statements?|safe harbor|risks and uncertainties|undue reliance|"
                     r"Private Securities Litigation Reform Act|no obligation to update", re.I)
_HAS_NUM = re.compile(r"\d")


# ── XBRL ────────────────────────────────────────────────────────────────────

def xbrl_values(facts_json: Optional[Dict[str, Any]], ref: FilingRef, tags: Sequence[str],
                periods: int = 2) -> List[XbrlValueFact]:
    """Values of ``tags`` filed in ``ref``'s accession: latest period first, then
    the comparative period(s).  Exact as filed (no derivation)."""
    if not facts_json or not tags:
        return []
    usg = facts_json.get("facts", {}).get("us-gaap", {})
    out: List[XbrlValueFact] = []
    for tag in tags:
        node = usg.get(tag)
        if not node:
            continue
        rows = []
        for unit, entries in (node.get("units") or {}).items():
            for e in entries:
                if e.get("accn") == ref.accession and e.get("val") is not None and e.get("end"):
                    rows.append((unit, e))
        if not rows:
            continue
        ends = sorted({e["end"] for _, e in rows}, reverse=True)[:periods]
        seen = set()
        for unit, e in sorted(rows, key=lambda r: (r[1]["end"], r[1].get("start") or ""), reverse=True):
            if e["end"] not in ends:
                continue
            k = (unit, e.get("start"), e["end"])
            if k in seen:
                continue
            seen.add(k)
            out.append(XbrlValueFact(
                id=f"xbrl:{short_id(ref.ticker, tag, unit, e.get('start'), e['end'], ref.accession)}",
                source=f"SEC XBRL companyfacts us-gaap:{tag}, {e.get('form') or ref.form} accession {ref.accession}",
                as_of=e["end"], ticker=ref.ticker, concept=tag, label_text=node.get("label"),
                value=float(e["val"]), unit=unit, period_start=e.get("start"), period_end=e["end"],
                fiscal_year=e.get("fy"), fiscal_period=e.get("fp"), form=e.get("form") or ref.form,
                accession=ref.accession, filed=e.get("filed")))
    return out


def run_checks(topic: Topic, values: List[XbrlValueFact]) -> List[ComputedFact]:
    """Reconciliations over instant USD values at the latest period end."""
    inst = [v for v in values if v.period_start is None and v.unit == "USD"]
    out: List[ComputedFact] = []
    for chk in topic.checks:
        ends = sorted({v.period_end for v in inst if v.concept in chk.plus}, reverse=True)
        if not ends:
            continue
        end = ends[0]
        at = {v.concept: v for v in inst if v.period_end == end}
        plus = [at[t] for t in chk.plus if t in at]
        minus = [at[t] for t in chk.minus if t in at]
        if len(plus) < chk.min_parts or len(minus) < len(chk.minus):
            continue
        value = sum(v.value for v in plus) - sum(v.value for v in minus)
        reported = at.get(chk.against) if chk.against else None
        diff = (reported.value - value) if reported is not None else None
        missing = [t for t in chk.plus if t not in at and not t.endswith("RemainderOfFiscalYear")]
        notes = [f"period end {end}"]
        if missing:
            notes.append(f"not reported in this filing: {', '.join(missing)}")
        if chk.against and reported is None:
            notes.append(f"filed total {chk.against} not reported in this filing; nothing to reconcile against")
        formula = " + ".join(v.concept for v in plus) + "".join(f" - {v.concept}" for v in minus)
        out.append(ComputedFact(
            id=f"calc:{short_id(topic.key, chk.name, end, *(v.id for v in plus + minus))}",
            source="computed from SEC XBRL values filed in this accession", as_of=end,
            ticker=plus[0].ticker, name=chk.name,
            formula=formula + (f" compared with filed {chk.against}" if reported is not None else ""),
            inputs=[v.id for v in plus + minus] + ([reported.id] if reported is not None else []), value=value,
            reported=reported.value if reported is not None else None, difference=diff,
            reconciles=(abs(diff) <= RECONCILE_TOL * max(abs(reported.value), 1.0)) if reported is not None else None,
            note="; ".join(notes)))
    return out


# ── narrative ───────────────────────────────────────────────────────────────

def _pattern_sentences(ld: LoadedDoc, start: int, end: int, rx: re.Pattern, limit: int = 4) -> List[str]:
    out = []
    for a, b in sentence_spans(ld.doc.text, start, end):
        s = ld.doc.text[a:b]
        if rx.search(s) and not _BOILER.search(s):
            out.append(s if len(s) <= 700 else s[:700].rsplit(" ", 1)[0])
            if len(out) >= limit:
                break
    return out


def narrative(svc: FilingsService, sel: Selection, topic: Topic, limit: int) -> Tuple[List[FilingExcerptFact], List[str]]:
    rx = topic.regex()
    notes: List[str] = []
    secs = sorted({k for v in topic.sections.values() for k in v})
    found_any = any(ld.sections_for(k) for ld in sel.docs for k in secs) or any(ld.exhibit for ld in sel.docs)
    sections = secs if found_any else None
    if not found_any and sel.docs:
        notes.append("preferred sections were not detected in the document; searched the whole document")
    if topic.sentences_only:
        return guidance_sentences(svc, sel, topic, sections, limit * 3), notes
    hits = retrieve(svc, sel, topic.query, sections=sections, limit=limit * 3, pattern=rx)
    out = []
    for h in hits:
        ld = next(d for d in sel.docs if d.ref.accession == h.accession and d.document == h.document)
        sents = _pattern_sentences(ld, h.char_start, h.char_end, rx)
        if not sents:
            continue
        h.matched_sentences = sents
        out.append(h)
        if len(out) >= limit:
            break
    if not out:
        notes.append(f"no passage matching the {topic.title.lower()} patterns was found in the selected filings")
    return out, notes


def guidance_sentences(svc: FilingsService, sel: Selection, topic: Topic, sections: Optional[Sequence[str]],
                       limit: int) -> List[FilingExcerptFact]:
    rx = topic.regex()
    scored = []
    for ld in sel.docs:
        allowed = ld.sections if (ld.exhibit or not sections) else [s for k in sections for s in ld.sections_for(k)]
        for sec in allowed:
            for c in (c for c in ld.chunks if c.section is sec):
                outlook = bool(c.subheading and re.search(r"outlook|guidance|looking ahead", c.subheading, re.I))
                for a, b in sentence_spans(ld.doc.text, c.start, c.end):
                    s = ld.doc.text[a:b]
                    if not rx.search(s) or _BOILER.search(s) or len(s.split()) < 5:
                        continue
                    score = (2 if outlook else 0) + (1 if _HAS_NUM.search(s) else 0)
                    scored.append((score, ld, c, a, b))
    scored.sort(key=lambda x: x[3])                                   # document order
    scored.sort(key=lambda x: x[1].ref.filing_date, reverse=True)    # newest filing first
    scored.sort(key=lambda x: -x[0])                                  # outlook + numeric first (stable)
    best = scored[:limit]
    best.sort(key=lambda x: x[3])
    best.sort(key=lambda x: x[1].ref.filing_date, reverse=True)
    seen = set()
    out = []
    for score, ld, c, a, b in best:
        if (ld.ref.accession, a) in seen:
            continue
        seen.add((ld.ref.accession, a))
        out.append(svc.excerpt(ld, a, b, chunk=c, score=float(score)))
    return out
