"""Normalise SEC XBRL companyfacts into annual and quarterly statement series.

Input is the JSON of ``https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json``.
Every fact entry there looks like::

    {"start": "2023-01-30", "end": "2024-01-28", "val": 60922000000,
     "accn": "0001045810-24-000029", "fy": 2024, "fp": "FY", "form": "10-K",
     "filed": "2024-02-21", "frame": "CY2023"}

Rules (each is tested in tests/fundamentals/test_xbrl.py):

* Tag aliases: each line item lists tags in priority order (us-gaap and
  ifrs-full).  The first tag that reports a given period wins *for that
  period*, so a company switching tags (NVDA capex moved from
  PaymentsToAcquirePropertyPlantAndEquipment to PaymentsToAcquireProductiveAssets)
  does not lose periods.
* Restatements: the same period is repeated as a comparative in later
  filings.  The value from the most recent filing is used (comparable
  "as restated" series); when it differs from the original filing, both
  values and both accession numbers are kept and reported.
* Duplicate frames: identical (start, end, value) copies from several filings
  collapse to one value; the citation is the earliest filing that reported it.
* Fiscal years: labels follow the company's own fiscal calendar, taken from the
  filing that first reported the period as its current period (NVDA FY2025
  ends 2025-01-26).  52/53-week years are recognised by duration (340-390 days).
* Units: monetary items use the filer's reporting currency (USD, or e.g. TWD
  for an IFRS 20-F filer); per-share items "<CCY>/shares"; counts "shares".
* Quarters: a 3-month value is used when filed; otherwise it is derived from
  year-to-date values (Q2 = 6M - Q1 YTD, Q4 = FY - 9M YTD) and marked
  ``derived``.  Per-share and share-count items are never derived by
  subtraction.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

ANNUAL_FORMS = {"10-K", "10-K/A", "10-KT", "10-KT/A", "20-F", "20-F/A", "40-F", "40-F/A"}
QUARTERLY_FORMS = {"10-Q", "10-Q/A", "10-QT", "10-QT/A"}
ALL_FORMS = ANNUAL_FORMS | QUARTERLY_FORMS
ANNUAL_DAYS = (340, 390)
QUARTER_DAYS = (75, 105)
START_TOLERANCE_DAYS = 7


@dataclass(frozen=True)
class LineItem:
    key: str
    label: str
    statement: str            # income | balance | cashflow
    kind: str                 # duration | instant
    unit: str                 # currency | shares | per_share
    tags: Tuple[str, ...]


def _li(key, label, statement, kind, unit, *tags) -> LineItem:
    return LineItem(key, label, statement, kind, unit, tuple(tags))


# Priority-ordered aliases.  Keep additions conservative: a tag listed here must
# mean the same thing as the line item for every filer.
CATALOG: Tuple[LineItem, ...] = (
    # ── income statement ───────────────────────────────────────────────────
    _li("revenue", "Revenue", "income", "duration", "currency",
        "us-gaap:RevenuesNetOfInterestExpense", "us-gaap:Revenues",
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
        "us-gaap:SalesRevenueNet", "us-gaap:SalesRevenueGoodsNet",
        "ifrs-full:Revenue", "ifrs-full:RevenueFromContractsWithCustomers"),
    _li("cost_of_revenue", "Cost of revenue", "income", "duration", "currency",
        "us-gaap:CostOfRevenue", "us-gaap:CostOfGoodsAndServicesSold", "us-gaap:CostOfGoodsSold",
        "ifrs-full:CostOfSales"),
    _li("gross_profit", "Gross profit", "income", "duration", "currency",
        "us-gaap:GrossProfit", "ifrs-full:GrossProfit"),
    _li("rd_expense", "Research and development", "income", "duration", "currency",
        "us-gaap:ResearchAndDevelopmentExpense",
        "us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
        "ifrs-full:ResearchAndDevelopmentExpense"),
    _li("sga_expense", "Selling, general and administrative", "income", "duration", "currency",
        "us-gaap:SellingGeneralAndAdministrativeExpense",
        "ifrs-full:SellingGeneralAndAdministrativeExpense"),
    _li("selling_marketing", "Sales and marketing", "income", "duration", "currency",
        "us-gaap:SellingAndMarketingExpense", "ifrs-full:SalesAndMarketingExpense"),
    _li("general_admin", "General and administrative", "income", "duration", "currency",
        "us-gaap:GeneralAndAdministrativeExpense", "ifrs-full:GeneralAndAdministrativeExpense"),
    _li("operating_income", "Operating income (EBIT proxy)", "income", "duration", "currency",
        "us-gaap:OperatingIncomeLoss", "ifrs-full:ProfitLossFromOperatingActivities"),
    _li("interest_expense", "Interest expense", "income", "duration", "currency",
        "us-gaap:InterestExpense", "us-gaap:InterestExpenseNonoperating", "us-gaap:InterestExpenseDebt",
        "us-gaap:InterestAndDebtExpense", "ifrs-full:InterestExpense", "ifrs-full:FinanceCosts"),
    _li("pretax_income", "Income before income taxes", "income", "duration", "currency",
        "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
        "ifrs-full:ProfitLossBeforeTax"),
    _li("income_tax", "Income tax expense", "income", "duration", "currency",
        "us-gaap:IncomeTaxExpenseBenefit", "ifrs-full:IncomeTaxExpenseContinuingOperations"),
    _li("net_income", "Net income (to parent)", "income", "duration", "currency",
        "us-gaap:NetIncomeLoss", "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic",
        "us-gaap:ProfitLoss", "ifrs-full:ProfitLossAttributableToOwnersOfParent", "ifrs-full:ProfitLoss"),
    _li("income_continuing_ops", "Income from continuing operations", "income", "duration", "currency",
        "us-gaap:IncomeLossFromContinuingOperations", "ifrs-full:ProfitLossFromContinuingOperations"),
    _li("eps_diluted", "Diluted EPS", "income", "duration", "per_share",
        "us-gaap:EarningsPerShareDiluted", "ifrs-full:DilutedEarningsLossPerShare"),
    _li("shares_diluted", "Weighted-average diluted shares", "income", "duration", "shares",
        "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
        "ifrs-full:AdjustedWeightedAverageShares"),
    _li("shares_basic", "Weighted-average basic shares", "income", "duration", "shares",
        "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic", "ifrs-full:WeightedAverageShares"),
    # ── cash-flow statement ────────────────────────────────────────────────
    _li("operating_cash_flow", "Cash from operations", "cashflow", "duration", "currency",
        "us-gaap:NetCashProvidedByUsedInOperatingActivities",
        "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
        "ifrs-full:CashFlowsFromUsedInOperatingActivities"),
    _li("investing_cash_flow", "Cash from investing", "cashflow", "duration", "currency",
        "us-gaap:NetCashProvidedByUsedInInvestingActivities",
        "us-gaap:NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
        "ifrs-full:CashFlowsFromUsedInInvestingActivities"),
    _li("financing_cash_flow", "Cash from financing", "cashflow", "duration", "currency",
        "us-gaap:NetCashProvidedByUsedInFinancingActivities",
        "us-gaap:NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
        "ifrs-full:CashFlowsFromUsedInFinancingActivities"),
    _li("capex", "Capital expenditures", "cashflow", "duration", "currency",
        "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", "us-gaap:PaymentsToAcquireProductiveAssets",
        "us-gaap:PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
        "ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
        "ifrs-full:PurchaseOfPropertyPlantAndEquipment"),
    _li("depreciation_amortization", "Depreciation and amortization", "cashflow", "duration", "currency",
        "us-gaap:DepreciationDepletionAndAmortization", "us-gaap:DepreciationAmortizationAndAccretionNet",
        "us-gaap:DepreciationAndAmortization",
        "ifrs-full:AdjustmentsForDepreciationAndAmortisationExpense",
        "ifrs-full:DepreciationAndAmortisationExpense"),
    _li("depreciation", "Depreciation", "cashflow", "duration", "currency",
        "us-gaap:Depreciation", "us-gaap:DepreciationNonproduction", "ifrs-full:DepreciationExpense"),
    _li("amortization_intangibles", "Amortization of intangible assets", "cashflow", "duration", "currency",
        "us-gaap:AmortizationOfIntangibleAssets", "ifrs-full:AmortisationExpense"),
    _li("sbc", "Stock-based compensation", "cashflow", "duration", "currency",
        "us-gaap:ShareBasedCompensation", "us-gaap:AllocatedShareBasedCompensationExpense",
        "ifrs-full:AdjustmentsForSharebasedPayments"),
    _li("buybacks", "Share repurchases", "cashflow", "duration", "currency",
        "us-gaap:PaymentsForRepurchaseOfCommonStock", "us-gaap:PaymentsForRepurchaseOfEquity",
        "ifrs-full:PaymentsToAcquireOrRedeemEntitysShares"),
    _li("dividends_paid", "Dividends paid", "cashflow", "duration", "currency",
        "us-gaap:PaymentsOfDividends", "us-gaap:PaymentsOfDividendsCommonStock",
        "ifrs-full:DividendsPaidClassifiedAsFinancingActivities", "ifrs-full:DividendsPaid"),
    _li("acquisitions", "Acquisitions, net of cash acquired", "cashflow", "duration", "currency",
        "us-gaap:PaymentsToAcquireBusinessesNetOfCashAcquired"),
    _li("finance_lease_principal", "Finance lease principal payments", "cashflow", "duration", "currency",
        "us-gaap:FinanceLeasePrincipalPayments", "us-gaap:RepaymentsOfLongTermCapitalLeaseObligations"),
    _li("interest_paid", "Interest paid", "cashflow", "duration", "currency",
        "us-gaap:InterestPaidNet", "us-gaap:InterestPaid"),
    # ── balance sheet ──────────────────────────────────────────────────────
    _li("cash", "Cash and cash equivalents", "balance", "instant", "currency",
        "us-gaap:CashAndCashEquivalentsAtCarryingValue", "ifrs-full:CashAndCashEquivalents",
        # last resort (includes restricted cash; the tag is reported with the value)
        "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"),
    _li("cash_and_sti", "Cash, cash equivalents and short-term investments", "balance", "instant", "currency",
        "us-gaap:CashCashEquivalentsAndShortTermInvestments"),
    _li("short_term_investments", "Short-term investments / marketable securities", "balance", "instant", "currency",
        "us-gaap:ShortTermInvestments", "us-gaap:MarketableSecuritiesCurrent",
        "us-gaap:AvailableForSaleSecuritiesDebtSecuritiesCurrent", "us-gaap:DebtSecuritiesCurrent"),
    # IFRS current financial assets (time deposits / bonds held as investments)
    _li("ifrs_fin_assets_fvoci_current", "Current financial assets at FVOCI", "balance", "instant", "currency",
        "ifrs-full:CurrentFinancialAssetsAtFairValueThroughOtherComprehensiveIncome"),
    _li("ifrs_fin_assets_amortised_current", "Current financial assets at amortised cost", "balance", "instant",
        "currency", "ifrs-full:CurrentFinancialAssetsAtAmortisedCost"),
    _li("ifrs_fin_assets_fvtpl_current", "Current financial assets at FVTPL", "balance", "instant", "currency",
        "ifrs-full:CurrentFinancialAssetsAtFairValueThroughProfitOrLoss"),
    _li("receivables", "Accounts receivable, net", "balance", "instant", "currency",
        "us-gaap:AccountsReceivableNetCurrent", "us-gaap:ReceivablesNetCurrent",
        "ifrs-full:CurrentTradeReceivables", "ifrs-full:TradeAndOtherCurrentReceivables"),
    _li("inventory", "Inventory", "balance", "instant", "currency",
        "us-gaap:InventoryNet", "ifrs-full:Inventories"),
    _li("current_assets", "Total current assets", "balance", "instant", "currency",
        "us-gaap:AssetsCurrent", "ifrs-full:CurrentAssets"),
    _li("ppe_net", "Property, plant and equipment, net", "balance", "instant", "currency",
        "us-gaap:PropertyPlantAndEquipmentNet", "ifrs-full:PropertyPlantAndEquipment",
        "us-gaap:PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"),
    _li("goodwill", "Goodwill", "balance", "instant", "currency", "us-gaap:Goodwill", "ifrs-full:Goodwill"),
    _li("total_assets", "Total assets", "balance", "instant", "currency", "us-gaap:Assets", "ifrs-full:Assets"),
    _li("accounts_payable", "Accounts payable", "balance", "instant", "currency",
        "us-gaap:AccountsPayableCurrent", "us-gaap:AccountsPayableTradeCurrent",
        "ifrs-full:TradeAndOtherCurrentPayablesToTradeSuppliers", "ifrs-full:TradeAndOtherCurrentPayables"),
    _li("income_taxes_payable", "Income taxes payable", "balance", "instant", "currency",
        "us-gaap:AccruedIncomeTaxesCurrent", "us-gaap:TaxesPayableCurrent"),
    _li("current_liabilities", "Total current liabilities", "balance", "instant", "currency",
        "us-gaap:LiabilitiesCurrent", "ifrs-full:CurrentLiabilities"),
    _li("commercial_paper", "Commercial paper", "balance", "instant", "currency", "us-gaap:CommercialPaper"),
    _li("short_term_borrowings", "Short-term borrowings", "balance", "instant", "currency",
        "us-gaap:ShortTermBorrowings", "ifrs-full:ShorttermBorrowings"),
    _li("ltd_current", "Current portion of long-term debt", "balance", "instant", "currency",
        "us-gaap:LongTermDebtCurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent",
        "ifrs-full:CurrentPortionOfLongtermBorrowings"),
    _li("debt_current_total", "Debt, current (total)", "balance", "instant", "currency", "us-gaap:DebtCurrent"),
    _li("ltd_noncurrent", "Long-term debt, non-current", "balance", "instant", "currency",
        "us-gaap:LongTermDebtNoncurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligations"),
    # IFRS debt is reported as bonds + borrowings (summed in _derive)
    _li("ifrs_borrowings_noncurrent", "Long-term borrowings (IFRS)", "balance", "instant", "currency",
        "ifrs-full:LongtermBorrowings"),
    _li("ifrs_bonds_noncurrent", "Bonds issued, non-current (IFRS)", "balance", "instant", "currency",
        "ifrs-full:NoncurrentPortionOfNoncurrentBondsIssued"),
    _li("ifrs_bonds_current", "Bonds issued, current (IFRS)", "balance", "instant", "currency",
        "ifrs-full:CurrentBondsIssuedAndCurrentPortionOfNoncurrentBondsIssued"),
    _li("ltd_total", "Long-term debt incl. current portion", "balance", "instant", "currency",
        "us-gaap:LongTermDebt"),
    _li("operating_lease_liabilities", "Operating lease liabilities", "balance", "instant", "currency",
        "us-gaap:OperatingLeaseLiability"),
    _li("operating_lease_liabilities_current", "Operating lease liabilities, current", "balance", "instant",
        "currency", "us-gaap:OperatingLeaseLiabilityCurrent", "ifrs-full:CurrentLeaseLiabilities"),
    _li("operating_lease_liabilities_noncurrent", "Operating lease liabilities, non-current", "balance",
        "instant", "currency", "us-gaap:OperatingLeaseLiabilityNoncurrent", "ifrs-full:NoncurrentLeaseLiabilities"),
    _li("total_liabilities", "Total liabilities", "balance", "instant", "currency",
        "us-gaap:Liabilities", "ifrs-full:Liabilities"),
    _li("total_equity", "Shareholders' equity (parent)", "balance", "instant", "currency",
        "us-gaap:StockholdersEquity", "ifrs-full:EquityAttributableToOwnersOfParent"),
    _li("equity_incl_nci", "Total equity incl. noncontrolling interests", "balance", "instant", "currency",
        "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "ifrs-full:Equity"),
    _li("minority_interest", "Noncontrolling interests", "balance", "instant", "currency",
        "us-gaap:MinorityInterest", "ifrs-full:NoncontrollingInterests"),
    _li("liabilities_and_equity", "Total liabilities and equity", "balance", "instant", "currency",
        "us-gaap:LiabilitiesAndStockholdersEquity", "ifrs-full:EquityAndLiabilities"),
    _li("retained_earnings", "Retained earnings (accumulated deficit)", "balance", "instant", "currency",
        "us-gaap:RetainedEarningsAccumulatedDeficit", "ifrs-full:RetainedEarnings"),
    _li("shares_outstanding", "Common shares outstanding (balance-sheet date)", "balance", "instant", "shares",
        "us-gaap:CommonStockSharesOutstanding"),
    # debt maturity schedule (instant, as of the fiscal year end)
    _li("debt_due_y1", "Debt principal due in next 12 months", "balance", "instant", "currency",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextRollingTwelveMonths"),
    _li("debt_due_y2", "Debt principal due in year two", "balance", "instant", "currency",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearTwo"),
    _li("debt_due_y3", "Debt principal due in year three", "balance", "instant", "currency",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearThree"),
    _li("debt_due_y4", "Debt principal due in year four", "balance", "instant", "currency",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearFour"),
    _li("debt_due_y5", "Debt principal due in year five", "balance", "instant", "currency",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingYearFive"),
    _li("debt_due_after_y5", "Debt principal due after year five", "balance", "instant", "currency",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive",
        "us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInRollingAfterYearFive"),
)
ITEMS: Dict[str, LineItem] = {li.key: li for li in CATALOG}
DERIVED_ITEMS = ("gross_profit", "cost_of_revenue", "total_liabilities", "total_debt", "free_cash_flow",
                 "ebitda", "operating_lease_liabilities", "sga_expense", "depreciation_amortization",
                 "short_term_investments", "total_equity", "ltd_noncurrent", "ltd_current")
DERIVED_LABELS = {"total_debt": "Total debt (excl. operating leases)", "free_cash_flow": "Free cash flow",
                  "ebitda": "EBITDA (operating income + D&A)"}

# Tags used to discover reporting periods (a period exists if any of these
# reports it).
_ANCHOR_ITEMS = ("revenue", "net_income", "operating_cash_flow")


# ── data classes ───────────────────────────────────────────────────────────
@dataclass
class XValue:
    value: float
    tag: str
    accn: Optional[str]
    form: Optional[str]
    filed: Optional[str]
    original_value: Optional[float] = None     # set when a later filing restated the value
    original_accn: Optional[str] = None
    derived: Optional[str] = None              # formula when computed from other values

    def provenance(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"tag": self.tag, "accn": self.accn, "form": self.form, "filed": self.filed}
        if self.original_value is not None:
            d.update(restated_from=self.original_value, original_accn=self.original_accn)
        if self.derived:
            d["derived"] = self.derived
        return {k: v for k, v in d.items() if v is not None}


@dataclass
class FPeriod:
    key: str                         # "2024-FY" | "2024-Q3"
    label: str                       # "FY2024" | "Q3 FY2024"
    fiscal_year: int
    fiscal_quarter: Optional[int]
    start: Optional[str]
    end: str
    accn: Optional[str] = None       # filing that first reported this as its current period
    form: Optional[str] = None
    filed: Optional[str] = None

    def ref(self) -> Dict[str, Any]:
        return {k: v for k, v in {"period": self.label, "start": self.start, "end": self.end, "form": self.form,
                                  "accn": self.accn, "filed": self.filed}.items() if v is not None}


@dataclass
class Statements:
    ticker: str
    cik: Optional[str]
    entity_name: Optional[str]
    currency: str
    taxonomy: str
    annual: List[FPeriod] = field(default_factory=list)       # oldest -> newest
    quarterly: List[FPeriod] = field(default_factory=list)    # oldest -> newest
    values: Dict[str, Dict[str, XValue]] = field(default_factory=dict)   # period key -> item -> value
    cover_shares: Optional[Dict[str, Any]] = None             # dei EntityCommonStockSharesOutstanding
    notes: List[str] = field(default_factory=list)

    def v(self, period_key: str, item: str) -> Optional[float]:
        x = self.values.get(period_key, {}).get(item)
        return x.value if x is not None else None

    def x(self, period_key: str, item: str) -> Optional[XValue]:
        return self.values.get(period_key, {}).get(item)

    def row(self, period_key: str) -> Dict[str, float]:
        return {k: x.value for k, x in self.values.get(period_key, {}).items()}

    def last_annual(self, n: int) -> List[FPeriod]:
        return self.annual[-n:] if n > 0 else []

    def last_quarters(self, n: int) -> List[FPeriod]:
        return self.quarterly[-n:] if n > 0 else []

    def sec_filing_url(self, accn: Optional[str]) -> Optional[str]:
        if not accn or not self.cik:
            return None
        return f"https://www.sec.gov/Archives/edgar/data/{int(self.cik)}/{accn.replace('-', '')}/"


# ── helpers ────────────────────────────────────────────────────────────────
def _d(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _days(e: Dict[str, Any]) -> Optional[int]:
    s, t = _d(e.get("start")), _d(e.get("end"))
    return (t - s).days if s and t else None


def _in(e: Dict[str, Any], bounds: Tuple[int, int]) -> bool:
    n = _days(e)
    return n is not None and bounds[0] <= n <= bounds[1]


def _near(a: Optional[str], b: Optional[str], tol: int = START_TOLERANCE_DAYS) -> bool:
    da, db = _d(a), _d(b)
    return da is not None and db is not None and abs((da - db).days) <= tol


def _num(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _tol(unit: str, v: float) -> float:
    return 0.005 if unit == "per_share" else max(0.5, abs(v) * 1e-9)


class _Facts:
    """Index over the companyfacts JSON, restricted to 10-K/10-Q/20-F/40-F entries."""

    def __init__(self, data: Dict[str, Any]):
        self.facts = (data or {}).get("facts") or {}
        self.taxonomy = self._taxonomy()
        self.currency = self._currency()
        self._cache: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}

    def _units(self, ns: str, tag: str) -> Dict[str, List[Dict[str, Any]]]:
        return ((self.facts.get(ns) or {}).get(tag) or {}).get("units") or {}

    def _taxonomy(self) -> str:
        def n(ns):
            return sum(len(v) for v in self._units(ns, "Assets").values())
        return "ifrs-full" if n("ifrs-full") > n("us-gaap") else "us-gaap"

    def _currency(self) -> str:
        counts: Dict[str, int] = {}
        for ns in ("us-gaap", "ifrs-full"):
            for tag in ("Assets", "Revenues", "Revenue", "NetIncomeLoss", "ProfitLoss"):
                for unit, ents in self._units(ns, tag).items():
                    if len(unit) == 3 and unit.isupper():
                        counts[unit] = counts.get(unit, 0) + len(ents)
        if not counts:
            return "USD"
        return max(counts, key=lambda u: (counts[u], u == "USD"))

    def unit_name(self, unit_kind: str) -> str:
        return {"currency": self.currency, "shares": "shares", "per_share": f"{self.currency}/shares"}[unit_kind]

    def entries(self, qtag: str, unit_kind: str) -> List[Dict[str, Any]]:
        key = (qtag, unit_kind)
        if key not in self._cache:
            ns, _, tag = qtag.partition(":")
            raw = self._units(ns, tag).get(self.unit_name(unit_kind)) or []
            out = []
            for e in raw:
                if (e.get("form") or "") not in ALL_FORMS or _num(e.get("val")) is None or not e.get("end"):
                    continue
                out.append(e)
            self._cache[key] = out
        return self._cache[key]


def _choose(cands: List[Dict[str, Any]], tag: str, unit: str, notes: List[str], where: str) -> XValue:
    """Collapse the copies of one fact (original + comparatives + amendments)."""
    ordered = sorted(cands, key=lambda e: (e.get("filed") or "", e.get("accn") or ""))
    orig, latest = ordered[0], ordered[-1]
    same_day = [e for e in ordered if (e.get("filed") or "") == (latest.get("filed") or "")]
    if len({float(e["val"]) for e in same_day}) > 1:
        notes.append(f"{tag} {where}: filing {latest.get('accn')} reports conflicting values "
                     f"{sorted({float(e['val']) for e in same_day})}; used {float(latest['val'])}")
    lv, ov = float(latest["val"]), float(orig["val"])
    if abs(lv - ov) <= _tol(unit, ov):
        return XValue(ov, tag, orig.get("accn"), orig.get("form"), orig.get("filed"))
    return XValue(lv, tag, latest.get("accn"), latest.get("form"), latest.get("filed"),
                  original_value=ov, original_accn=orig.get("accn"))


# ── period discovery ───────────────────────────────────────────────────────
def _filing_index(fx: _Facts) -> Dict[str, Dict[str, Any]]:
    """accn -> {form, filed, fy, fp, end (its current period end), start (fiscal-YTD start)}."""
    idx: Dict[str, Dict[str, Any]] = {}
    for item in _ANCHOR_ITEMS:
        for tag in ITEMS[item].tags:
            for e in fx.entries(tag, "currency"):
                form = e.get("form") or ""
                if form in ANNUAL_FORMS:
                    if not _in(e, ANNUAL_DAYS):
                        continue
                elif not _in(e, (QUARTER_DAYS[0], 300)):
                    continue
                accn = e.get("accn")
                if not accn:
                    continue
                cur = idx.get(accn)
                end = e["end"]
                if cur is None:
                    idx[accn] = {"form": form, "filed": e.get("filed"), "fy": e.get("fy"), "fp": e.get("fp"),
                                 "end": end, "start": e.get("start"), "dur": _days(e)}
                    continue
                if end > cur["end"] or (end == cur["end"] and (_days(e) or 0) > (cur["dur"] or 0)):
                    cur.update(end=end, start=e.get("start"), dur=_days(e))
    return idx


def _discover(fx: _Facts, notes: List[str]) -> Tuple[List[FPeriod], List[FPeriod], Dict[int, str]]:
    idx = _filing_index(fx)
    own_annual: Dict[str, Dict[str, Any]] = {}
    own_q: Dict[str, Dict[str, Any]] = {}
    for accn, f in idx.items():
        fp = f.get("fp") or ""
        rec = {**f, "accn": accn}
        if f["form"] in ANNUAL_FORMS and fp == "FY":
            tgt = own_annual
        elif f["form"] in QUARTERLY_FORMS and fp in ("Q1", "Q2", "Q3"):
            tgt = own_q
        else:
            continue
        prev = tgt.get(f["end"])
        if prev is None or (f.get("filed") or "") < (prev.get("filed") or ""):
            tgt[f["end"]] = rec

    annual: Dict[int, FPeriod] = {}
    offsets: Dict[int, int] = {}
    for end, r in sorted(own_annual.items()):
        fy = r.get("fy")
        if fy is None:
            continue
        fy = int(fy)
        shifted = (_d(end) - timedelta(days=7)).year
        offsets[fy - shifted] = offsets.get(fy - shifted, 0) + 1
        if fy in annual:
            notes.append(f"two annual periods labelled FY{fy} ({annual[fy].end}, {end}); kept the later one")
        annual[fy] = FPeriod(f"{fy}-FY", f"FY{fy}", fy, None, r.get("start"), end,
                             r["accn"], r["form"], r.get("filed"))
    # Older years that only appear as comparatives in later 10-Ks.
    offset = max(offsets, key=offsets.get) if offsets else 0
    known_ends = {p.end for p in annual.values()}
    for item in _ANCHOR_ITEMS:
        for tag in ITEMS[item].tags:
            for e in fx.entries(tag, "currency"):
                if (e.get("form") or "") not in ANNUAL_FORMS or not _in(e, ANNUAL_DAYS):
                    continue
                if any(_near(e["end"], k, 3) for k in known_ends):
                    continue
                fy = (_d(e["end"]) - timedelta(days=7)).year + offset
                if fy in annual:
                    continue
                annual[fy] = FPeriod(f"{fy}-FY", f"FY{fy}", fy, None, e.get("start"), e["end"])
                known_ends.add(e["end"])

    fy_start: Dict[int, str] = {fy: p.start for fy, p in annual.items() if p.start}
    quarters: Dict[Tuple[int, int], FPeriod] = {}
    q_starts: Dict[int, List[str]] = {}
    for end, r in sorted(own_q.items()):
        if r.get("fy") is None:
            continue
        fy, fq = int(r["fy"]), int(r["fp"][1])
        # the longest anchor duration ending at a 10-Q's current period end is its
        # fiscal year-to-date span, so its start is the fiscal-year start
        if r.get("start"):
            q_starts.setdefault(fy, []).append(r["start"])
        quarters[(fy, fq)] = FPeriod(f"{fy}-Q{fq}", f"Q{fq} FY{fy}", fy, fq, None, end,
                                     r["accn"], r["form"], r.get("filed"))
    for fy, starts in q_starts.items():
        fy_start.setdefault(fy, min(starts))
    for fy, a in annual.items():
        if (fy, 3) in quarters:
            quarters[(fy, 4)] = FPeriod(f"{fy}-Q4", f"Q4 FY{fy}", fy, 4, quarters[(fy, 3)].end, a.end,
                                        a.accn, a.form, a.filed)
    # quarter start = previous quarter end (Q1: fiscal-year start)
    for (fy, fq), q in quarters.items():
        if fq == 1:
            q.start = fy_start.get(fy)
        elif (fy, fq - 1) in quarters and q.start is None:
            q.start = quarters[(fy, fq - 1)].end
    return (sorted(annual.values(), key=lambda p: p.end),
            sorted(quarters.values(), key=lambda p: p.end), fy_start)


# ── value extraction ───────────────────────────────────────────────────────
def _annual_value(fx: _Facts, li: LineItem, p: FPeriod, notes: List[str]) -> Optional[XValue]:
    for tag in li.tags:
        ents = fx.entries(tag, li.unit)
        if li.kind == "instant":
            c = [e for e in ents if e["end"] == p.end and not e.get("start")]
        else:
            c = [e for e in ents if e["end"] == p.end and _in(e, ANNUAL_DAYS)
                 and (p.start is None or _near(e.get("start"), p.start))]
        if c:
            return _choose(c, tag, li.unit, notes, p.label)
    return None


def _cumulative(fx: _Facts, li: LineItem, start: str, end: str, notes: List[str], where: str) -> Optional[XValue]:
    for tag in li.tags:
        c = [e for e in fx.entries(tag, li.unit) if e["end"] == end and _near(e.get("start"), start)]
        if c:
            return _choose(c, tag, li.unit, notes, where)
    return None


def _quarter_value(fx: _Facts, li: LineItem, q: FPeriod, quarters: Dict[Tuple[int, int], FPeriod],
                   fy_start: Dict[int, str], annual_vals: Dict[int, Optional[XValue]],
                   cache: Dict[Tuple[int, int], Optional[XValue]], notes: List[str]) -> Optional[XValue]:
    k = (q.fiscal_year, q.fiscal_quarter)
    if k in cache:
        return cache[k]
    cache[k] = None
    out: Optional[XValue] = None
    if li.kind == "instant":
        for tag in li.tags:
            c = [e for e in fx.entries(tag, li.unit) if e["end"] == q.end and not e.get("start")]
            if c:
                out = _choose(c, tag, li.unit, notes, q.label)
                break
        cache[k] = out
        return out
    for tag in li.tags:
        c = [e for e in fx.entries(tag, li.unit) if e["end"] == q.end and _in(e, QUARTER_DAYS)]
        if c:
            out = _choose(c, tag, li.unit, notes, q.label)
            break
    if out is None and li.unit == "currency":
        fy, fq = k
        s = fy_start.get(fy)
        cur = annual_vals.get(fy) if fq == 4 else (_cumulative(fx, li, s, q.end, notes, q.label) if s else None)
        if cur is not None:
            if fq == 1:
                out = cur
            else:
                prev_q = quarters.get((fy, fq - 1))
                prev = None
                if prev_q is not None and s:
                    prev = _cumulative(fx, li, s, prev_q.end, notes, prev_q.label)
                if prev is not None:
                    span = {2: "6M", 3: "9M", 4: "FY"}[fq]
                    pspan = {2: "3M", 3: "6M", 4: "9M"}[fq]
                    out = XValue(cur.value - prev.value, cur.tag, cur.accn, cur.form, cur.filed,
                                 derived=f"{span} YTD ({cur.accn}) - {pspan} YTD ({prev.accn})")
                elif fq == 4:
                    parts = [_quarter_value(fx, li, quarters[(fy, i)], quarters, fy_start, annual_vals, cache, notes)
                             if (fy, i) in quarters else None for i in (1, 2, 3)]
                    if all(x is not None for x in parts):
                        out = XValue(cur.value - sum(x.value for x in parts), cur.tag, cur.accn, cur.form,
                                     cur.filed, derived="FY - (Q1 + Q2 + Q3)")
    cache[k] = out
    return out


def _derive(row: Dict[str, XValue]) -> None:
    """Values computed from other line items in the same period (each labelled)."""
    def mk(v: float, src: XValue, formula: str) -> XValue:
        return XValue(v, "derived", src.accn, src.form, src.filed, derived=formula)

    g = row.get

    def total(keys):
        parts = [(k, g(k)) for k in keys if g(k) is not None]
        return parts if parts else None

    if g("sga_expense") is None and g("selling_marketing") and g("general_admin"):
        row["sga_expense"] = mk(g("selling_marketing").value + g("general_admin").value, g("selling_marketing"),
                                "selling_marketing + general_admin")
    if g("depreciation_amortization") is None and g("depreciation"):
        if g("amortization_intangibles"):
            row["depreciation_amortization"] = mk(g("depreciation").value + g("amortization_intangibles").value,
                                                  g("depreciation"), "depreciation + amortization_intangibles")
        else:
            row["depreciation_amortization"] = mk(g("depreciation").value, g("depreciation"),
                                                  "depreciation only (no amortization tag reported)")
    if g("short_term_investments") is None:
        if g("cash_and_sti") and g("cash"):
            row["short_term_investments"] = mk(g("cash_and_sti").value - g("cash").value, g("cash_and_sti"),
                                               "cash_and_sti - cash")
        else:
            parts = total(("ifrs_fin_assets_fvoci_current", "ifrs_fin_assets_amortised_current",
                           "ifrs_fin_assets_fvtpl_current"))
            if parts:
                row["short_term_investments"] = mk(sum(x.value for _, x in parts), parts[0][1],
                                                   " + ".join(k for k, _ in parts))
    if g("total_equity") is None and g("equity_incl_nci"):
        if g("minority_interest"):
            row["total_equity"] = mk(g("equity_incl_nci").value - g("minority_interest").value, g("equity_incl_nci"),
                                     "equity_incl_nci - minority_interest")
        else:
            row["total_equity"] = mk(g("equity_incl_nci").value, g("equity_incl_nci"),
                                     "equity_incl_nci (no noncontrolling interest tagged)")
    if g("ltd_noncurrent") is None:
        parts = total(("ifrs_borrowings_noncurrent", "ifrs_bonds_noncurrent"))
        if parts:
            row["ltd_noncurrent"] = mk(sum(x.value for _, x in parts), parts[0][1], " + ".join(k for k, _ in parts))
    if g("ifrs_bonds_current") is not None:
        base = g("ltd_current")
        row["ltd_current"] = mk((base.value if base else 0.0) + g("ifrs_bonds_current").value, g("ifrs_bonds_current"),
                                ("ltd_current + " if base else "") + "ifrs_bonds_current")
    if g("gross_profit") is None and g("revenue") and g("cost_of_revenue"):
        row["gross_profit"] = mk(g("revenue").value - g("cost_of_revenue").value, g("revenue"),
                                 "revenue - cost_of_revenue")
    if g("cost_of_revenue") is None and g("revenue") and g("gross_profit"):
        row["cost_of_revenue"] = mk(g("revenue").value - g("gross_profit").value, g("revenue"),
                                    "revenue - gross_profit")
    if g("total_liabilities") is None and g("liabilities_and_equity"):
        eq = g("equity_incl_nci") or g("total_equity")
        if eq is not None:
            name = "equity_incl_nci" if g("equity_incl_nci") else "total_equity"
            row["total_liabilities"] = mk(g("liabilities_and_equity").value - eq.value, g("liabilities_and_equity"),
                                          f"liabilities_and_equity - {name}")
    if g("operating_lease_liabilities") is None and g("operating_lease_liabilities_current") \
            and g("operating_lease_liabilities_noncurrent"):
        row["operating_lease_liabilities"] = mk(
            g("operating_lease_liabilities_current").value + g("operating_lease_liabilities_noncurrent").value,
            g("operating_lease_liabilities_noncurrent"),
            "operating_lease_liabilities_current + operating_lease_liabilities_noncurrent")
    debt = total_debt(row)
    if debt is not None:
        row["total_debt"] = debt
    if g("operating_cash_flow") and g("capex"):
        row["free_cash_flow"] = mk(g("operating_cash_flow").value - g("capex").value, g("operating_cash_flow"),
                                   "operating_cash_flow - capex")
    if g("operating_income") and g("depreciation_amortization"):
        row["ebitda"] = mk(g("operating_income").value + g("depreciation_amortization").value,
                           g("operating_income"), "operating_income + depreciation_amortization")


def total_debt(row: Dict[str, XValue]) -> Optional[XValue]:
    """Total debt = current debt + non-current debt (excludes operating leases).

    current     = DebtCurrent if tagged, else LongTermDebtCurrent + CommercialPaper + ShortTermBorrowings
    non-current = LongTermDebtNoncurrent; if only LongTermDebt (which includes the
                  current portion) is tagged, LongTermDebt + CommercialPaper + ShortTermBorrowings.
    Components that are not tagged are absent, not zero; when no debt tag at all
    is reported the result is None (unknown), never 0.
    """
    g = row.get
    parts: List[Tuple[str, XValue]] = []
    if g("ltd_noncurrent") is not None:
        parts.append(("ltd_noncurrent", g("ltd_noncurrent")))
        if g("debt_current_total") is not None:
            parts.append(("debt_current_total", g("debt_current_total")))
        else:
            parts += [(k, g(k)) for k in ("ltd_current", "commercial_paper", "short_term_borrowings") if g(k) is not None]
    elif g("ltd_total") is not None:
        parts.append(("ltd_total", g("ltd_total")))
        parts += [(k, g(k)) for k in ("commercial_paper", "short_term_borrowings") if g(k) is not None]
    else:
        if g("debt_current_total") is not None:
            parts.append(("debt_current_total", g("debt_current_total")))
        else:
            parts += [(k, g(k)) for k in ("ltd_current", "commercial_paper", "short_term_borrowings") if g(k) is not None]
    if not parts:
        return None
    src = parts[0][1]
    return XValue(sum(x.value for _, x in parts), "derived", src.accn, src.form, src.filed,
                  derived=" + ".join(k for k, _ in parts))


def _cover_shares(data: Dict[str, Any], notes: List[str]) -> Optional[Dict[str, Any]]:
    ents = (((data.get("facts") or {}).get("dei") or {}).get("EntityCommonStockSharesOutstanding") or {}) \
        .get("units", {}).get("shares") or []
    ents = [e for e in ents if _num(e.get("val")) and e.get("end")]
    if not ents:
        return None
    latest_accn = max(ents, key=lambda e: (e.get("filed") or "", e["end"])).get("accn")
    same = [e for e in ents if e.get("accn") == latest_accn]
    end = max(e["end"] for e in same)
    vals = {float(e["val"]) for e in same if e["end"] == end}
    if len(vals) != 1:
        notes.append(f"dei:EntityCommonStockSharesOutstanding in {latest_accn} has {len(vals)} values "
                     f"(multiple share classes); cover-page share count not used")
        return None
    e = next(x for x in same if x["end"] == end)
    return {"value": float(e["val"]), "as_of": end, "accn": e.get("accn"), "form": e.get("form"),
            "filed": e.get("filed"), "tag": "dei:EntityCommonStockSharesOutstanding"}


def normalize_companyfacts(data: Dict[str, Any], ticker: str, cik: Optional[str] = None) -> Statements:
    notes: List[str] = []
    fx = _Facts(data)
    annual, quarters_list, fy_start = _discover(fx, notes)
    st = Statements(ticker=ticker.upper(), cik=cik or (str(data.get("cik")).zfill(10) if data.get("cik") else None),
                    entity_name=data.get("entityName"), currency=fx.currency, taxonomy=fx.taxonomy,
                    annual=annual, quarterly=quarters_list, notes=notes)
    quarters = {(q.fiscal_year, q.fiscal_quarter): q for q in quarters_list}
    for li in CATALOG:
        annual_vals: Dict[int, Optional[XValue]] = {}
        for p in annual:
            x = _annual_value(fx, li, p, notes)
            annual_vals[p.fiscal_year] = x
            if x is not None:
                st.values.setdefault(p.key, {})[li.key] = x
        cache: Dict[Tuple[int, int], Optional[XValue]] = {}
        for q in quarters_list:
            x = _quarter_value(fx, li, q, quarters, fy_start, annual_vals, cache, notes)
            if x is not None:
                st.values.setdefault(q.key, {})[li.key] = x
    for key, row in st.values.items():
        _derive(row)
    st.cover_shares = _cover_shares(data, notes)
    if st.cover_shares and st.annual:
        age = (_d(st.annual[-1].end) - _d(st.cover_shares["as_of"])).days
        if age > 200:
            notes.append(f"latest non-dimensional cover-page share count is as of {st.cover_shares['as_of']} "
                         "(the filer now reports shares by class); not used")
            st.cover_shares = None
    return st


def item_label(key: str) -> str:
    if key in ITEMS:
        return ITEMS[key].label
    return DERIVED_LABELS.get(key, key.replace("_", " "))


def ttm(st: Statements, item: str) -> Optional[Dict[str, Any]]:
    """Trailing twelve months = sum of the latest four consecutive fiscal quarters
    (flow items only).  Returns None unless all four quarters are present."""
    qs = st.last_quarters(4)
    if len(qs) < 4:
        return None
    # consecutive: (fy, fq) sequence without gaps
    seq = [(q.fiscal_year * 4 + (q.fiscal_quarter or 0)) for q in qs]
    if any(b - a != 1 for a, b in zip(seq, seq[1:])):
        return None
    vals = [st.v(q.key, item) for q in qs]
    if any(v is None for v in vals):
        return None
    return {"value": sum(vals), "periods": [q.label for q in qs], "end": qs[-1].end}


def iter_items(keys: Optional[Iterable[str]] = None) -> List[str]:
    base = [li.key for li in CATALOG] + [k for k in DERIVED_ITEMS if k not in ITEMS]
    if keys is None:
        return base
    return [k for k in keys if k in base]
