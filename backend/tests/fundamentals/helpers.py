"""Fixture builders for the fundamentals-engine tests (no network)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.services.fundamentals.xbrl import FPeriod, Statements, XValue, _derive

# Three fiscal years of a hypothetical company (values in USD).  Every metric
# test below is checked against hand-computed values from these numbers.
ROWS: Dict[int, Dict[str, float]] = {
    2021: dict(revenue=800, cost_of_revenue=480, gross_profit=320, sga_expense=100, operating_income=120,
               net_income=80, operating_cash_flow=100, total_assets=900, current_assets=400,
               current_liabilities=200, cash=100, receivables=80, inventory=90, accounts_payable=60,
               ppe_net=300, total_liabilities=500, total_equity=400, ltd_noncurrent=200, debt_current_total=20,
               retained_earnings=250, depreciation=30, shares_diluted=100, shares_outstanding=100),
    2022: dict(revenue=1000, cost_of_revenue=600, gross_profit=400, sga_expense=120, operating_income=150,
               interest_expense=10, pretax_income=140, income_tax=28, net_income=112, operating_cash_flow=130,
               investing_cash_flow=-50, capex=40, depreciation_amortization=30, depreciation=25, sbc=10,
               buybacks=20, dividends_paid=10, total_assets=1000, current_assets=500, current_liabilities=250,
               cash=150, short_term_investments=50, receivables=100, inventory=100, accounts_payable=80,
               ppe_net=320, total_liabilities=550, total_equity=450, ltd_noncurrent=200, debt_current_total=30,
               retained_earnings=300, shares_diluted=98, shares_outstanding=97),
    2023: dict(revenue=1200, cost_of_revenue=696, gross_profit=504, sga_expense=132, operating_income=216,
               interest_expense=12, pretax_income=200, income_tax=40, net_income=160, operating_cash_flow=150,
               investing_cash_flow=-60, capex=50, depreciation_amortization=36, depreciation=30, sbc=12,
               buybacks=30, dividends_paid=12, total_assets=1200, current_assets=600, current_liabilities=300,
               cash=180, short_term_investments=60, receivables=150, inventory=130, accounts_payable=90,
               ppe_net=360, total_liabilities=620, total_equity=580, ltd_noncurrent=250, debt_current_total=30,
               retained_earnings=400, shares_diluted=95, shares_outstanding=94,
               debt_due_y1=30, debt_due_y2=50, debt_due_y3=60, debt_due_y4=40, debt_due_y5=50,
               debt_due_after_y5=50),
}


def make_statements(rows: Optional[Dict[int, Dict[str, float]]] = None, ticker: str = "TEST",
                    currency: str = "USD") -> Statements:
    rows = rows or ROWS
    st = Statements(ticker=ticker, cik="0000000001", entity_name="Test Co", currency=currency, taxonomy="us-gaap")
    for fy in sorted(rows):
        p = FPeriod(f"{fy}-FY", f"FY{fy}", fy, None, f"{fy - 1}-01-01", f"{fy - 1}-12-31",
                    accn=f"0000000001-{fy % 100:02d}-000001", form="10-K", filed=f"{fy}-02-15")
        st.annual.append(p)
        vals = {k: XValue(float(v), f"us-gaap:{k}", p.accn, "10-K", p.filed) for k, v in rows[fy].items()}
        _derive(vals)
        st.values[p.key] = vals
    return st


class CF:
    """Builder for a companyfacts JSON document."""

    def __init__(self, cik: int = 1, name: str = "Test Co"):
        self.data: Dict[str, Any] = {"cik": cik, "entityName": name, "facts": {"us-gaap": {}, "dei": {}}}

    def add(self, tag: str, val: float, end: str, *, start: Optional[str] = None, accn: str, fy: int, fp: str,
            form: str, filed: str, unit: str = "USD", ns: str = "us-gaap", frame: Optional[str] = None) -> "CF":
        units = self.data["facts"].setdefault(ns, {}).setdefault(tag, {"units": {}})["units"]
        e = {"end": end, "val": val, "accn": accn, "fy": fy, "fp": fp, "form": form, "filed": filed}
        if start:
            e["start"] = start
        if frame:
            e["frame"] = frame
        units.setdefault(unit, []).append(e)
        return self


def entries(cf: CF, tag: str, ns: str = "us-gaap", unit: str = "USD") -> List[Dict[str, Any]]:
    return cf.data["facts"][ns][tag]["units"][unit]
