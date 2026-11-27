"""Synthetic SEC companyfacts payloads with round, hand-checkable numbers.

TESTCO: fiscal year ends 30 June; revenue grows exactly 10% a year from 100bn
(FY2020) to 161.051bn (FY2025); operating margin 25%; D&A 5% and capex 8% of
revenue; interest expense 2bn on 40bn of debt; tax 20% of pre-tax income;
non-cash working capital = 10% of revenue.
"""
from __future__ import annotations

from typing import Dict, List

B = 1e9
YEARS = [2020, 2021, 2022, 2023, 2024, 2025]
REVENUE = {fy: 100 * B * 1.1 ** i for i, fy in enumerate(YEARS)}


def _accn(fy: int) -> str:
    return f"0000000000-{fy % 100:02d}-000001"


def _dur(fy: int, val: float, form: str = "10-K", filed_fy: int = None, fp: str = "FY") -> dict:
    f = filed_fy or fy
    return {"start": f"{fy - 1}-07-01", "end": f"{fy}-06-30", "val": val, "accn": _accn(f), "fy": f, "fp": fp,
            "form": form, "filed": f"{f}-08-01"}


def _inst(fy: int, val: float, end: str = None, form: str = "10-K") -> dict:
    return {"end": end or f"{fy}-06-30", "val": val, "accn": _accn(fy), "fy": fy, "fp": "FY", "form": form,
            "filed": f"{fy}-08-01"}


def make_testco_facts() -> dict:
    g: Dict[str, Dict[str, List[dict]]] = {}

    def put(tag: str, entries: List[dict], unit: str = "USD"):
        g.setdefault(tag, {"units": {}})["units"].setdefault(unit, []).extend(entries)

    rev, ebit, interest, pretax, tax, ni, da, capex, ocf, sbc, eps, shd = ([] for _ in range(12))
    cash, sti, lti, debt, ca, cl, eq, assets = ([] for _ in range(8))
    for fy in YEARS:
        R = REVENUE[fy]
        e = 0.25 * R
        pt = e - 2 * B
        t = 0.2 * pt
        n = pt - t
        rev.append(_dur(fy, R))
        ebit.append(_dur(fy, e))
        interest.append(_dur(fy, 2 * B))
        pretax.append(_dur(fy, pt))
        tax.append(_dur(fy, t))
        ni.append(_dur(fy, n))
        da.append(_dur(fy, 0.05 * R))
        capex.append(_dur(fy, 0.08 * R))
        ocf.append(_dur(fy, n + 0.05 * R))
        sbc.append(_dur(fy, 1 * B))
        eps.append(_dur(fy, n / (10 * B)))
        shd.append(_dur(fy, 10 * B))
        cash.append(_inst(fy, 20 * B))
        sti.append(_inst(fy, 10 * B))
        lti.append(_inst(fy, 5 * B))
        debt.append(_inst(fy, 40 * B))
        ca.append(_inst(fy, 30 * B + 0.2 * R))
        cl.append(_inst(fy, 0.1 * R))
        eq.append(_inst(fy, 100 * B))
        assets.append(_inst(fy, 300 * B))
    # A 10-Q year-to-date (9 months) entry and a quarter must never be read as a fiscal year
    rev.append({"start": "2025-07-01", "end": "2026-03-31", "val": 999 * B, "accn": "0000000000-26-000002",
                "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01"})
    rev.append({"start": "2026-01-01", "end": "2026-03-31", "val": 45 * B, "accn": "0000000000-26-000002",
                "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01"})
    # The FY2025 10-K restates FY2024 revenue as a comparative (later filing wins)
    rev.append({**_dur(2024, 146.0 * B), "accn": _accn(2025), "fy": 2025, "filed": "2025-08-01"})
    put("RevenueFromContractWithCustomerExcludingAssessedTax", rev)
    put("Revenues", [_dur(2024, 1.0)])          # lower-priority alias tag never overrides the primary one
    put("OperatingIncomeLoss", ebit)
    put("InterestExpense", interest)
    put("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", pretax)
    put("IncomeTaxExpenseBenefit", tax)
    put("NetIncomeLoss", ni)
    put("DepreciationDepletionAndAmortization", da)
    put("PaymentsToAcquirePropertyPlantAndEquipment", capex)
    put("NetCashProvidedByUsedInOperatingActivities", ocf)
    put("ShareBasedCompensation", sbc)
    put("EarningsPerShareDiluted", eps, "USD/shares")
    put("WeightedAverageNumberOfDilutedSharesOutstanding", shd, "shares")
    put("CostOfRevenue", [_dur(fy, 0.6 * REVENUE[fy]) for fy in YEARS])
    put("CashAndCashEquivalentsAtCarryingValue", cash + [_inst(2026, 25 * B, "2026-03-31", "10-Q")])
    put("ShortTermInvestments", sti + [_inst(2026, 10 * B, "2026-03-31", "10-Q")])
    put("MarketableSecuritiesNoncurrent", lti + [_inst(2026, 5 * B, "2026-03-31", "10-Q")])
    put("LongTermDebt", debt + [_inst(2026, 40 * B, "2026-03-31", "10-Q")])
    put("AssetsCurrent", ca)
    put("LiabilitiesCurrent", cl)
    put("StockholdersEquity", eq + [_inst(2026, 110 * B, "2026-03-31", "10-Q")])
    put("Assets", assets + [_inst(2026, 320 * B, "2026-03-31", "10-Q")])
    dei = {"EntityCommonStockSharesOutstanding": {"units": {"shares": [
        {"end": "2026-04-15", "val": 9.9 * B, "accn": "0000000000-26-000002", "fy": 2026, "fp": "Q3",
         "form": "10-Q", "filed": "2026-05-01"},
        {"end": "2025-07-20", "val": 10 * B, "accn": _accn(2025), "fy": 2025, "fp": "FY", "form": "10-K",
         "filed": "2025-08-01"}]}}}
    return {"cik": 1, "entityName": "TestCo Inc.", "facts": {"us-gaap": g, "dei": dei}}


def make_ifrs_facts() -> dict:
    def d(fy, v):
        return {"start": f"{fy}-01-01", "end": f"{fy}-12-31", "val": v, "accn": f"0000000002-{fy % 100 + 1:02d}-1",
                "fy": fy, "fp": "FY", "form": "20-F", "filed": f"{fy + 1}-04-01"}
    return {"entityName": "Foundry Ltd", "facts": {"ifrs-full": {
        "Revenue": {"units": {"TWD": [d(2023, 2000 * B), d(2024, 2800 * B)]}},
        "ProfitLossFromOperatingActivities": {"units": {"TWD": [d(2023, 900 * B), d(2024, 1300 * B)]}},
        "ProfitLoss": {"units": {"TWD": [d(2023, 800 * B), d(2024, 1150 * B)]}},
    }, "dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": [
        {"end": "2024-12-31", "val": 25.9 * B, "accn": "0000000002-25-1", "fy": 2024, "fp": "FY", "form": "20-F",
         "filed": "2025-04-01"}]}}}}}
