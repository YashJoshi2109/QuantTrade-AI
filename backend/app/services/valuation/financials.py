"""Annual financial inputs for valuation, parsed from SEC XBRL companyfacts.

Interface for the fundamentals engine
-------------------------------------
Valuation code depends only on ``CompanyFinancials`` (below) and the
``FundamentalsProvider`` protocol. When the shared fundamentals engine lands,
it can implement ``FundamentalsProvider.company_financials`` and be injected
into ``ValuationData``; until then ``parse_companyfacts`` reads the XBRL JSON
directly (the same payload ``sec_edgar_service.get_company_facts`` returns).

Every value is a ``Datum`` with the XBRL tag, accession number, form and
filing date it came from. Annual (fiscal-year) values only come from annual
forms (10-K / 20-F / 40-F and amendments) with a 340-390 day duration, so a
year-to-date 10-Q figure can never be mistaken for a full year.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Protocol, Sequence, Tuple

from app.services.valuation.provenance import DataUnavailable, Datum

SOURCE = "SEC XBRL companyfacts"
ANNUAL_FORMS = {"10-K", "10-K/A", "10-KT", "20-F", "20-F/A", "40-F", "40-F/A"}
_ANNUAL_DAYS = (340, 390)

# name -> (unit kind, {taxonomy: [tags in priority order]})
#   unit kind: "ccy" (reporting currency), "ccy/shares" (per share), "shares"
DURATION_CONCEPTS: Dict[str, Tuple[str, Dict[str, List[str]]]] = {
    "revenue": ("ccy", {
        "us-gaap": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
                    "RevenuesNetOfInterestExpense", "SalesRevenueNet",
                    "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"],
        "ifrs-full": ["Revenue", "RevenueFromContractsWithCustomers"]}),
    "cost_of_revenue": ("ccy", {
        "us-gaap": ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
        "ifrs-full": ["CostOfSales"]}),
    "gross_profit": ("ccy", {"us-gaap": ["GrossProfit"], "ifrs-full": ["GrossProfit"]}),
    "operating_income": ("ccy", {
        "us-gaap": ["OperatingIncomeLoss"],
        "ifrs-full": ["ProfitLossFromOperatingActivities"]}),
    "pretax_income": ("ccy", {
        "us-gaap": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
        "ifrs-full": ["ProfitLossBeforeTax"]}),
    "income_tax": ("ccy", {
        "us-gaap": ["IncomeTaxExpenseBenefit"],
        "ifrs-full": ["IncomeTaxExpenseContinuingOperations"]}),
    "net_income": ("ccy", {
        "us-gaap": ["NetIncomeLoss", "ProfitLoss"],
        "ifrs-full": ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"]}),
    "interest_expense": ("ccy", {
        "us-gaap": ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt",
                    "InterestAndDebtExpense"],
        "ifrs-full": ["InterestExpense", "FinanceCosts"]}),
    # debt-only interest (cost of debt): InterestExpense / InterestExpenseNonoperating
    # can include finance-lease interest, which is excluded when tagged separately
    "interest_expense_debt": ("ccy", {"us-gaap": ["InterestExpenseDebt"]}),
    "finance_lease_interest": ("ccy", {"us-gaap": ["FinanceLeaseInterestExpense"],
                                       "ifrs-full": ["InterestExpenseOnLeaseLiabilities"]}),
    "d_and_a": ("ccy", {
        "us-gaap": ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
                    "DepreciationAmortizationAndAccretionNet", "Depreciation"],
        "ifrs-full": ["DepreciationAndAmortisationExpense", "AdjustmentsForDepreciationAndAmortisationExpense",
                      "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
                      "DepreciationExpense"]}),
    "capex": ("ccy", {
        "us-gaap": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
                    "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets"],
        "ifrs-full": ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
                      "PurchaseOfPropertyPlantAndEquipment"]}),
    "operating_cash_flow": ("ccy", {
        "us-gaap": ["NetCashProvidedByUsedInOperatingActivities"],
        "ifrs-full": ["CashFlowsFromUsedInOperatingActivities"]}),
    "sbc": ("ccy", {
        "us-gaap": ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
        "ifrs-full": ["AdjustmentsForSharebasedPayments"]}),
    "eps_diluted": ("ccy/shares", {
        "us-gaap": ["EarningsPerShareDiluted"],
        "ifrs-full": ["DilutedEarningsLossPerShare"]}),
    "shares_diluted": ("shares", {
        "us-gaap": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
        "ifrs-full": ["WeightedAverageNumberOfSharesOutstandingDiluted",
                      "AdjustedWeightedAverageShares"]}),
    # banks
    "net_interest_income": ("ccy", {
        "us-gaap": ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss"]}),
    "interest_expense_deposits": ("ccy", {"us-gaap": ["InterestExpenseDeposits"]}),
    "provision_credit_losses": ("ccy", {
        "us-gaap": ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses",
                    "ProvisionForCreditLosses"]}),
}

INSTANT_CONCEPTS: Dict[str, Dict[str, List[str]]] = {
    "ltd_total": {"us-gaap": ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
                              "DebtLongtermAndShorttermCombinedAmount"],
                  "ifrs-full": ["Borrowings"]},
    "ltd_noncurrent": {"us-gaap": ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
                       "ifrs-full": ["LongtermBorrowings", "NoncurrentPortionOfNoncurrentLoansReceived"]},
    "bonds_noncurrent": {"ifrs-full": ["NoncurrentPortionOfNoncurrentBondsIssued"]},
    "ltd_current": {"us-gaap": ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
                    # IFRS: "current portion of long-term borrowings" includes current bonds when both are tagged
                    "ifrs-full": ["CurrentPortionOfLongtermBorrowings",
                                  "CurrentBondsIssuedAndCurrentPortionOfNoncurrentBondsIssued"]},
    "commercial_paper": {"us-gaap": ["CommercialPaper"]},
    "short_term_borrowings": {"us-gaap": ["ShortTermBorrowings", "OtherShortTermBorrowings"],
                              "ifrs-full": ["ShorttermBorrowings"]},
    "cash_and_sti": {"us-gaap": ["CashCashEquivalentsAndShortTermInvestments"]},
    "cash": {"us-gaap": ["CashAndCashEquivalentsAtCarryingValue", "Cash"],
             "ifrs-full": ["CashAndCashEquivalents"]},
    "short_term_investments": {"us-gaap": ["ShortTermInvestments", "MarketableSecuritiesCurrent",
                                           "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "DebtSecuritiesCurrent"],
                               "ifrs-full": ["CurrentInvestments", "OtherCurrentFinancialAssets"]},
    "long_term_investments": {"us-gaap": ["MarketableSecuritiesNoncurrent",
                                          "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent"]},
    "minority_interest": {"us-gaap": ["MinorityInterest"], "ifrs-full": ["NoncontrollingInterests"]},
    "stockholders_equity": {"us-gaap": ["StockholdersEquity", "StockholdersEquityAttributableToParent"],
                            "ifrs-full": ["EquityAttributableToOwnersOfParent", "Equity"]},
    "total_assets": {"us-gaap": ["Assets"], "ifrs-full": ["Assets"]},
    "current_assets": {"us-gaap": ["AssetsCurrent"], "ifrs-full": ["CurrentAssets"]},
    "current_liabilities": {"us-gaap": ["LiabilitiesCurrent"], "ifrs-full": ["CurrentLiabilities"]},
    # banks
    "deposits": {"us-gaap": ["Deposits"], "ifrs-full": ["Deposits", "DepositsFromCustomers"]},
    "afs_securities": {"us-gaap": ["AvailableForSaleSecuritiesDebtSecurities", "AvailableForSaleSecurities"]},
    "htm_securities_fair_value": {"us-gaap": ["HeldToMaturitySecuritiesFairValue"]},
}


def _days(e: dict) -> Optional[int]:
    s, t = e.get("start"), e.get("end")
    if not s or not t:
        return None
    try:
        return (datetime.strptime(t, "%Y-%m-%d") - datetime.strptime(s, "%Y-%m-%d")).days
    except ValueError:
        return None


def _base_form(e: dict) -> str:
    return (e.get("form") or "").upper()


@dataclass
class AnnualFinancials:
    fiscal_year: int
    period_end: str
    values: Dict[str, Datum] = field(default_factory=dict)
    form: Optional[str] = None
    accession: Optional[str] = None
    filed: Optional[str] = None

    def get(self, name: str) -> Optional[float]:
        d = self.values.get(name)
        return None if d is None else d.value

    def datum(self, name: str) -> Optional[Datum]:
        return self.values.get(name)


@dataclass
class CompanyFinancials:
    ticker: str
    cik: Optional[str]
    entity_name: Optional[str]
    taxonomy: str                         # "us-gaap" | "ifrs-full"
    currency: str                         # reporting currency, e.g. USD / TWD
    years: List[AnnualFinancials]         # ascending by period end
    balance: Dict[str, Datum] = field(default_factory=dict)   # latest balance sheet (any form)
    balance_date: Optional[str] = None
    shares_outstanding: Optional[Datum] = None
    notes: List[str] = field(default_factory=list)

    @property
    def latest(self) -> AnnualFinancials:
        if not self.years:
            raise DataUnavailable(f"{self.ticker}: no annual (10-K/20-F) periods in XBRL companyfacts")
        return self.years[-1]

    def series(self, name: str, n: Optional[int] = None) -> List[Tuple[int, float]]:
        out = [(y.fiscal_year, y.get(name)) for y in self.years if y.get(name) is not None]
        return out[-n:] if n else out

    def require(self, name: str, year: Optional[AnnualFinancials] = None) -> Datum:
        y = year or self.latest
        d = y.datum(name)
        if d is None:
            raise DataUnavailable(f"{self.ticker}: {name.replace('_', ' ')} not reported in XBRL for FY{y.fiscal_year} "
                                  f"(period ending {y.period_end})")
        return d


class FundamentalsProvider(Protocol):
    """What the fundamentals engine must provide to plug into valuation."""

    async def company_financials(self, ticker: str) -> CompanyFinancials: ...


# ── parsing ──────────────────────────────────────────────────────────────────
def _taxonomy_and_currency(facts: dict) -> Tuple[str, str]:
    f = facts.get("facts", {})
    for tax in ("us-gaap", "ifrs-full"):
        node = f.get(tax) or {}
        for tag in DURATION_CONCEPTS["revenue"][1].get(tax, []) + DURATION_CONCEPTS["net_income"][1].get(tax, []):
            units = (node.get(tag) or {}).get("units") or {}
            ccy = [u for u in units if "/" not in u and u != "shares" and u.isalpha() and len(u) == 3]
            if ccy:
                # the unit with the most entries is the reporting currency
                ccy.sort(key=lambda u: -len(units[u]))
                return tax, ccy[0]
    raise DataUnavailable("no revenue or net income concept in XBRL companyfacts (us-gaap or ifrs-full)")


def _entries(facts: dict, tax: str, tag: str, unit: str) -> List[dict]:
    return (((facts.get("facts", {}).get(tax) or {}).get(tag) or {}).get("units") or {}).get(unit, []) or []


def _unit(kind: str, ccy: str) -> str:
    return {"ccy": ccy, "ccy/shares": f"{ccy}/shares", "shares": "shares"}[kind]


def _pick(cands: Iterable[Tuple[int, dict]]) -> Optional[Tuple[int, dict]]:
    """Highest-priority tag (lowest index) wins; within a tag the latest filing
    (a restatement supersedes the original)."""
    best = None
    for prio, e in cands:
        if best is None or prio < best[0] or (prio == best[0] and e.get("filed", "") > best[1].get("filed", "")):
            best = (prio, e)
    return best


def _datum(tag: str, e: dict, unit: str) -> Datum:
    return Datum(value=float(e["val"]), source=SOURCE, as_of=e.get("end"), tag=tag,
                 accession=e.get("accn"), form=e.get("form"), filed=e.get("filed"), unit=unit)


def _annual_value(facts, tax, tags, unit, end) -> Optional[Datum]:
    cands = []
    for prio, tag in enumerate(tags):
        for e in _entries(facts, tax, tag, unit):
            if e.get("end") != end or _base_form(e) not in ANNUAL_FORMS:
                continue
            d = _days(e)
            if d is None or not (_ANNUAL_DAYS[0] <= d <= _ANNUAL_DAYS[1]):
                continue
            cands.append((prio, {**e, "_tag": tag}))
    best = _pick(cands)
    return None if best is None else _datum(best[1]["_tag"], best[1], unit)


def _instant_value(facts, tax, tags, unit, end) -> Optional[Datum]:
    cands = []
    for prio, tag in enumerate(tags):
        for e in _entries(facts, tax, tag, unit):
            if e.get("end") == end and not e.get("start"):
                cands.append((prio, {**e, "_tag": tag}))
    best = _pick(cands)
    return None if best is None else _datum(best[1]["_tag"], best[1], unit)


def _annual_periods(facts: dict, tax: str, ccy: str) -> List[Tuple[int, str]]:
    """(fiscal_year, period_end) for every annual period, ascending.

    The fiscal-year label uses SEC's own ``fy`` from the earliest filing that
    reports the period (that filing is the one *for* the period). Comparative
    periods first seen in a company's first XBRL filing carry that filing's fy,
    so the label is applied as a per-company offset from the period end year."""
    first: Dict[str, dict] = {}
    for concept in ("revenue", "net_income"):
        for tag in DURATION_CONCEPTS[concept][1].get(tax, []):
            for e in _entries(facts, tax, tag, ccy):
                d = _days(e)
                if _base_form(e) not in ANNUAL_FORMS or d is None or not (_ANNUAL_DAYS[0] <= d <= _ANNUAL_DAYS[1]):
                    continue
                end = e["end"]
                if end not in first or e.get("filed", "") < first[end].get("filed", ""):
                    first[end] = e
    if not first:
        return []

    def end_year(end: str) -> int:   # 52/53-week years ending in the first days of January
        return (datetime.strptime(end, "%Y-%m-%d") - timedelta(days=14)).year

    ends = sorted(first)
    offsets = [int(first[e]["fy"]) - end_year(e) for e in ends[-3:] if first[e].get("fy")]
    offset = Counter(offsets).most_common(1)[0][0] if offsets else 0
    return [(end_year(e) + offset, e) for e in ends]


def _latest_balance_date(facts: dict, tax: str, ccy: str) -> Optional[str]:
    ends = []
    for name in ("total_assets", "stockholders_equity"):
        for tag in INSTANT_CONCEPTS[name].get(tax, []):
            ends += [e["end"] for e in _entries(facts, tax, tag, ccy) if e.get("end") and not e.get("start")]
    return max(ends) if ends else None


def _sum_datums(parts: Sequence[Tuple[str, Datum]], name: str, as_of: str, ccy: str) -> Datum:
    first = parts[0][1]
    return Datum(value=sum(d.value for _, d in parts), source=SOURCE, as_of=as_of,
                 tag=" + ".join(d.tag or "" for _, d in parts), accession=first.accession, form=first.form,
                 filed=first.filed, unit=ccy, formula=f"{name} = " + " + ".join(n for n, _ in parts))


def balance_items(facts: dict, tax: str, ccy: str, end: str) -> Dict[str, Datum]:
    """Debt, cash & investments, minority interest and bank items at one
    balance-sheet date. Composite items carry the formula used."""
    v = {k: _instant_value(facts, tax, tags.get(tax, []), ccy, end) for k, tags in INSTANT_CONCEPTS.items()}
    out: Dict[str, Datum] = {}
    # total debt = long-term debt incl. current maturities + commercial paper + short-term borrowings
    parts: List[Tuple[str, Datum]] = []
    if v["ltd_total"] is not None:
        parts.append(("long-term debt incl. current", v["ltd_total"]))
        combined = v["ltd_total"].tag == "DebtLongtermAndShorttermCombinedAmount" or v["ltd_total"].tag == "Borrowings"
    else:
        combined = False
        if v["bonds_noncurrent"] is not None:
            parts.append(("bonds issued, noncurrent", v["bonds_noncurrent"]))
        if v["ltd_noncurrent"] is not None:
            parts.append(("long-term debt, noncurrent", v["ltd_noncurrent"]))
        if v["ltd_current"] is not None:
            parts.append(("current maturities of long-term debt", v["ltd_current"]))
    if not combined:
        if v["commercial_paper"] is not None:
            parts.append(("commercial paper", v["commercial_paper"]))
        if v["short_term_borrowings"] is not None:
            parts.append(("short-term borrowings", v["short_term_borrowings"]))
    if parts:
        out["total_debt"] = _sum_datums(parts, "total debt (book; operating leases excluded)", end, ccy)
    # cash & short-term investments
    cparts: List[Tuple[str, Datum]] = []
    if v["cash_and_sti"] is not None:
        cparts.append(("cash, equivalents and short-term investments", v["cash_and_sti"]))
    else:
        if v["cash"] is not None:
            cparts.append(("cash and equivalents", v["cash"]))
        if v["short_term_investments"] is not None:
            cparts.append(("short-term investments", v["short_term_investments"]))
    if cparts:
        out["cash_and_sti"] = _sum_datums(cparts, "cash and short-term investments", end, ccy)
    for k in ("long_term_investments", "minority_interest", "stockholders_equity", "total_assets",
              "current_assets", "current_liabilities", "ltd_current", "commercial_paper",
              "short_term_borrowings", "deposits", "afs_securities", "htm_securities_fair_value"):
        if v[k] is not None:
            out[k] = v[k]
    return out


def _shares_outstanding(facts: dict) -> Optional[Datum]:
    ent = (((facts.get("facts", {}).get("dei") or {}).get("EntityCommonStockSharesOutstanding") or {})
           .get("units") or {}).get("shares", [])
    if not ent:
        return None
    latest = max(ent, key=lambda e: (e.get("filed", ""), e.get("end", "")))
    same = [e for e in ent if e.get("accn") == latest.get("accn") and e.get("end") == latest.get("end")]
    vals = sorted({float(e["val"]) for e in same})
    d = Datum(value=sum(vals), source=f"{SOURCE} (cover page)", as_of=latest.get("end"),
              tag="dei:EntityCommonStockSharesOutstanding", accession=latest.get("accn"),
              form=latest.get("form"), filed=latest.get("filed"), unit="shares")
    if len(vals) > 1:
        d.formula = f"sum of {len(vals)} share classes reported on the cover page"
    return d


def parse_companyfacts(facts: dict, ticker: str, cik: Optional[str] = None, max_years: int = 11) -> CompanyFinancials:
    """Pure parser: companyfacts JSON -> CompanyFinancials (no network)."""
    tax, ccy = _taxonomy_and_currency(facts)
    periods = _annual_periods(facts, tax, ccy)[-max_years:]
    years: List[AnnualFinancials] = []
    for fy, end in periods:
        y = AnnualFinancials(fiscal_year=fy, period_end=end)
        for name, (kind, tags) in DURATION_CONCEPTS.items():
            d = _annual_value(facts, tax, tags.get(tax, []), _unit(kind, ccy), end)
            if d is not None:
                y.values[name] = d
        for name, d in balance_items(facts, tax, ccy, end).items():
            y.values[name] = d
        if y.get("gross_profit") is None and y.get("revenue") is not None and y.get("cost_of_revenue") is not None:
            y.values["gross_profit"] = Datum(
                value=y.get("revenue") - y.get("cost_of_revenue"), source=SOURCE, as_of=end,
                accession=y.values["revenue"].accession, form=y.values["revenue"].form,
                filed=y.values["revenue"].filed, unit=ccy, formula="revenue - cost of revenue")
        rev = y.values.get("revenue") or y.values.get("net_income")
        if rev is not None:
            y.form, y.accession, y.filed = rev.form, rev.accession, rev.filed
        years.append(y)

    bdate = _latest_balance_date(facts, tax, ccy)
    balance = balance_items(facts, tax, ccy, bdate) if bdate else {}
    notes = []
    if tax != "us-gaap":
        notes.append(f"Company reports under IFRS ({tax}) in {ccy}.")
    return CompanyFinancials(ticker=ticker.upper(), cik=cik, entity_name=facts.get("entityName"),
                             taxonomy=tax, currency=ccy, years=years, balance=balance,
                             balance_date=bdate, shares_outstanding=_shares_outstanding(facts), notes=notes)
