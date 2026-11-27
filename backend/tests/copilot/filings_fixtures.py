"""Synthetic EDGAR filings (Workiva-style iXBRL HTML) + a fake EDGAR provider.

Three 10-Ks (FY2023..FY2025) whose Item 1A differs in known ways, one 10-Q,
an earnings 8-K with an EX-99.1 press release, submissions JSON (the oldest
10-K only on an older submissions page) and companyfacts JSON.  No network.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

CIK = "0000000042"
TICKER = "NVDA"
COMPANY = "FIXTURE CORP"

ACC_K23, ACC_K24, ACC_K25 = "0000000042-23-000011", "0000000042-24-000012", "0000000042-25-000013"
ACC_Q1 = "0000000042-25-000021"
ACC_8K_EARN, ACC_8K_VOTE = "0000000042-25-000031", "0000000042-25-000032"

LOREM = ("We design and sell accelerated computing platforms to customers worldwide and we invest heavily in "
         "research and development to keep pace with demand across data center, gaming and automotive markets.")

R1 = ("Failure to meet the evolving needs of our industry may adversely impact our financial results.",
      "Our accelerated computing platforms experience rapid changes in technology, customer requirements, "
      "competitive products and industry standards. Our success depends on our ability to timely identify "
      "industry changes, adapt our strategies and develop new products that meet those needs, and to "
      "maintain the quality and reliability of the products we already ship to our customers.")
R1_EDIT = (R1[0], R1[1].replace("experience rapid changes", "experience very rapid changes"))
R2 = ("Our business depends on our ability to receive consistent wafer supply.",
      "We do not manufacture the silicon wafers used for our products and rely on third parties for "
      "fabrication, assembly and testing. A disruption at any of these suppliers could delay shipments, "
      "increase our costs and reduce our revenue for one or more quarters.")
R3_OLD = ("We depend on a limited number of customers for a significant share of revenue.",
          "A small number of direct customers account for a large portion of our revenue. Customer A "
          "accounted for 13% of total revenue in fiscal year 2023. The loss of any of these customers, or "
          "a reduction in their purchases, could materially reduce our revenue and harm our results.")
R3_NEW = (R3_OLD[0], R3_OLD[1].replace("13% of total revenue in fiscal year 2023",
                                       "19% of total revenue in fiscal year 2024"))
R4 = ("Our operations could be affected by the COVID-19 pandemic.",
      "The pandemic disrupted our supply chain and our offices in prior years. A resurgence could again "
      "affect our employees, suppliers and customers and could reduce demand for our products in a way "
      "that is difficult to predict.")
R5 = ("Export controls restrict our ability to sell data center products to China.",
      "The U.S. government imposed licensing requirements on exports of our data center products to China "
      "and other countries. These requirements have reduced our sales to affected customers and could "
      "further reduce our revenue if they are expanded to additional products or destinations.")
R6 = ("Energy constraints at data centers may limit demand for our products.",
      "Our customers need reliable access to electric power to deploy large clusters of our systems. "
      "Limited grid capacity or rising energy costs could delay their deployments and reduce or defer "
      "their purchases of our platforms.")

RISKS = {2023: [R1, R2, R3_OLD, R4], 2024: [R1, R2, R3_NEW, R5], 2025: [R1_EDIT, R2, R3_NEW, R5, R6]}
CUSTOMER_PCT = {2023: 13, 2024: 19, 2025: 19}


def _b(text: str) -> str:
    return f'<span style="color:#000000;font-family:Arial;font-size:10pt;font-weight:700">{text}</span>'


def _p(text: str, id_: str = "") -> str:
    ida = f' id="{id_}"' if id_ else ""
    return f'<div{ida} style="margin-top:6pt"><span style="font-size:10pt">{text}</span></div>'


def _break(label: str) -> str:
    return (f'<div style="text-align:center"><span>{label}</span></div>'
            '<div style="page-break-after:always"></div>')


def tenk_html(year: int) -> str:
    pct = CUSTOMER_PCT[year]
    risks = "".join(f"<div>{_b(h)}</div>{_p(b)}" for h, b in RISKS[year])
    toc = "".join(
        f'<tr><td><a href="#i_{k.lower()}">Item {k}.</a></td><td>{t}</td><td>{pg}</td></tr>'
        for k, t, pg in [("1", "Business", 1), ("1A", "Risk Factors", 2), ("7", "Management&#8217;s Discussion", 3),
                         ("7A", "Quantitative and Qualitative Disclosures About Market Risk", 3),
                         ("8", "Financial Statements and Supplementary Data", 4)])
    lease = "".join(f"<tr><td>{y}</td><td>$</td><td>{v}</td><td>{')' if v.startswith('(') else ''}</td></tr>" for y, v in [
        ("Fiscal Year 2026", "1,000"), ("2027", "900"), ("2028", "800"), ("2029", "700"), ("2030", "600"),
        ("Thereafter", "2,000"), ("Total", "6,000"), ("Less imputed interest", "(1,000"), ("Present value", "5,000")])
    return f"""<html><head><title>fx-{year}0126</title><style>.x{{color:red}}</style></head><body>
<div style="display:none"><ix:header><ix:hidden>HIDDEN-XBRL-HEADER-TEXT</ix:hidden></ix:header></div>
<div>{_b("UNITED STATES SECURITIES AND EXCHANGE COMMISSION")}</div>
<div>{_b("FORM 10-K")}</div>
<div><span>For the fiscal year ended January {26 if year == 2025 else 28}, {year}</span></div>
<table>{toc}</table>
{_break("i")}
<div id="i_part1">{_b("PART I")}</div>
<div id="i_1">{_b("Item 1. Business")}</div>
{_p("Our Company. " + LOREM + " " + LOREM)}
{_break("1")}
<div id="i_1a">{_b("Item 1A. Risk Factors")}</div>
{_p("The following risk factors should be considered in addition to the other information in this report.")}
<div><span style="font-weight:700;font-style:italic">Risks Related to Our Industry and Markets</span></div>
{risks}
{_break("2")}
<div id="i_1b">{_b("Item 1B. Unresolved Staff Comments")}</div>
{_p("None.")}
<div id="i_part2">{_b("PART II")}</div>
<div id="i_7">{_b("Item 7. Management&#8217;s Discussion and Analysis of Financial Condition and Results of Operations")}</div>
{_p(f"Revenue for fiscal year {year} grew because of strong demand for our data center platforms. "
    f"Sales to Customer A represented {pct}% of total revenue for fiscal year {year}, and sales to "
    "Customer B represented 11% of total revenue, primarily attributable to the Compute &amp; Networking segment.")}
{_p("We expect capital expenditures in fiscal year " + str(year + 1) + " to increase as we invest in data center "
    "infrastructure, and we have commitments of $1.2 billion related to the construction of new facilities.")}
<table><tr><td>Revenue</td><td>$</td><td>60,922</td><td>$</td><td>26,974</td><td>126</td><td>%</td></tr></table>
{_break("3")}
<div id="i_7a">{_b("Item 7A. Quantitative and Qualitative Disclosures About Market Risk")}</div>
{_p("We are exposed to interest rate risk on our cash equivalents and marketable securities. A hypothetical "
    "100 basis point increase in interest rates would decrease the fair value of our debt investments by "
    "$93 million as of the end of the fiscal year. We are also exposed to foreign exchange rate risk.")}
<div id="i_8">{_b("Item 8. Financial Statements and Supplementary Data")}</div>
<div>{_b("Note 1 - Revenue Recognition")}</div>
{_p("We recognize revenue when control of the promised products is transferred to our customers, in an amount "
    "that reflects the consideration we expect to receive in exchange for those products. Revenue from "
    "software licenses is recognized when the license is made available to the customer.")}
<div>{_b("Note 3 - Leases")}</div>
{_p("Our operating lease obligations relate primarily to data centers and office space. The following table "
    "summarizes the maturities of operating lease liabilities as of the end of the fiscal year (in millions):")}
<table>{lease}</table>
<div>{_b("Note 12 - Segment Information")}</div>
{_p("Revenue by geographic area is based on the billing location of the customer. Revenue from customers in "
    "the United States was $26,966 million and revenue from Taiwan was $13,405 million in fiscal year " + str(year) + ".")}
<div>{_b("Note 13 - Commitments and Contingencies")}</div>
{_p("As of the end of the fiscal year, we had outstanding inventory purchase and long-term supply and capacity "
    "obligations totaling $30.8 billion, of which a majority is expected to be paid within one year.")}
{_break("4")}
<div id="i_9a">{_b("Item 9A. Controls and Procedures")}</div>
{_p("Our management, with the participation of our chief executive officer and chief financial officer, "
    "evaluated the effectiveness of our disclosure controls and procedures and concluded they were effective "
    "as of the end of the period covered by this report at a reasonable assurance level.")}
</body></html>"""


def tenq_html() -> str:
    return f"""<html><body>
<div>{_b("FORM 10-Q")}</div>
<table><tr><td>PART I. FINANCIAL INFORMATION</td></tr>
<tr><td>Item 1. Financial Statements</td><td>3</td></tr><tr><td>Item 2. Management&#8217;s Discussion</td><td>10</td></tr>
<tr><td>PART II. OTHER INFORMATION</td></tr><tr><td>Item 1A. Risk Factors</td><td>20</td></tr></table>
<div>{_b("PART I. FINANCIAL INFORMATION")}</div>
<div>{_b("Item 1. Financial Statements")}</div>
{_p("Revenue Recognition. We recognize revenue when control of the promised products is transferred to our "
    "customers. There were no material changes to our revenue recognition policies during the first quarter "
    "of fiscal year 2026 compared with those described in our annual report.")}
<div>{_b("Item 2. Management&#8217;s Discussion and Analysis of Financial Condition and Results of Operations")}</div>
{_p("Liquidity and Capital Resources. As of April 27, 2025, we had $53.7 billion in cash, cash equivalents and "
    "marketable securities. We believe these balances will be sufficient to meet our operating requirements "
    "for at least the next twelve months, including planned capital expenditures.")}
<div>{_b("Item 3. Quantitative and Qualitative Disclosures About Market Risk")}</div>
{_p("There have been no material changes in our market risk exposure from the disclosures in our annual report "
    "on Form 10-K for the fiscal year ended January 26, 2025, including interest rate and foreign exchange risk.")}
<div>{_b("PART II. OTHER INFORMATION")}</div>
<div>{_b("Item 1. Legal Proceedings")}</div>
{_p("Please see Note 13 of the Notes to Condensed Consolidated Financial Statements for a discussion of our "
    "legal proceedings; we are subject to legal matters arising in the ordinary course of business from time to time.")}
<div>{_b("Item 1A. Risk Factors")}</div>
{_p("Other than the risk factor below, there have been no material changes to our risk factors from those "
    "disclosed in our annual report. New export licensing requirements took effect during the quarter and "
    "resulted in a $4.5 billion charge associated with excess inventory and purchase obligations.")}
<div>{_b("Item 6. Exhibits")}</div>
{_p("The exhibits listed in the accompanying index are filed or incorporated by reference as part of this "
    "report, including certifications of the chief executive officer and chief financial officer pursuant to "
    "the Securities Exchange Act of 1934 as amended.")}
</body></html>"""


def eightk_html() -> str:
    return f"""<html><body><div>{_b("FORM 8-K")}</div>
<div>{_b("Item 2.02 Results of Operations and Financial Condition.")}</div>
{_p("On May 28, 2025, Fixture Corp issued a press release announcing its results for the quarter ended "
    "April 27, 2025. The press release is furnished as Exhibit 99.1 to this report and the information in "
    "this Item, including the exhibit, shall not be deemed filed for purposes of Section 18 of the Exchange Act.")}
<div>{_b("Item 9.01 Financial Statements and Exhibits.")}</div>
{_p("(d) Exhibits. Exhibit 99.1 Press release dated May 28, 2025 announcing results for the first quarter of "
    "fiscal 2026, furnished herewith and not filed for purposes of the Exchange Act as described in Item 2.02 above.")}
</body></html>"""


def ex991_html() -> str:
    return f"""<html><body>
<div>{_b("Fixture Corp Announces Financial Results for First Quarter Fiscal 2026")}</div>
{_p("Record quarterly revenue of $44.1 billion, up 69% from a year ago. Data Center revenue of $39.1 billion, "
    "up 73% from a year ago.")}
<div>{_b("Outlook")}</div>
{_p("Fixture&#8217;s outlook for the second quarter of fiscal 2026 is as follows:")}
{_p("Revenue is expected to be $45.0 billion, plus or minus 2%.")}
{_p("GAAP and non-GAAP gross margins are expected to be 71.8% and 72.0%, respectively, plus or minus 50 basis points.")}
<div>{_b("Forward-Looking Statements")}</div>
{_p("Certain statements in this press release including, but not limited to, statements as to expected revenue "
    "and gross margins are forward-looking statements that are subject to risks and uncertainties that could "
    "cause results to be materially different than expectations.")}
</body></html>"""


def vote_8k_html() -> str:
    return f"""<html><body><div>{_b("FORM 8-K")}</div>
<div>{_b("Item 5.07 Submission of Matters to a Vote of Security Holders.")}</div>
{_p("At the annual meeting of stockholders held on June 25, 2025, stockholders elected each of the director "
    "nominees and approved, on an advisory basis, the compensation of the named executive officers.")}
</body></html>"""


EIGHTK_INDEX = """<html><body><table class="tableFile" summary="Document Format Files">
<tr><th scope="col">Seq</th><th scope="col">Description</th><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Size</th></tr>
<tr><td scope="row">1</td><td scope="row">8-K</td><td scope="row"><a href="/ix?doc=/Archives/edgar/data/42/000000004225000031/fx-20250528.htm">fx-20250528.htm</a></td><td scope="row">8-K</td><td scope="row">31000</td></tr>
<tr><td scope="row">2</td><td scope="row">PRESS RELEASE</td><td scope="row"><a href="/Archives/edgar/data/42/000000004225000031/fx-ex991.htm">fx-ex991.htm</a></td><td scope="row">EX-99.1</td><td scope="row">91000</td></tr>
<tr><td scope="row">3</td><td scope="row">GRAPHIC</td><td scope="row"><a href="/Archives/edgar/data/42/000000004225000031/logo.jpg">logo.jpg</a></td><td scope="row">GRAPHIC</td><td scope="row">5000</td></tr>
</table></body></html>"""


def _cols(rows: List[Tuple[str, str, str, str, str, str]]) -> Dict[str, list]:
    keys = ("accessionNumber", "form", "filingDate", "reportDate", "primaryDocument", "items")
    return {k: [r[i] for r in rows] for i, k in enumerate(keys)}


def submissions() -> Tuple[dict, Dict[str, dict]]:
    recent = [
        ("0000000042-25-000099", "4", "2025-07-01", "", "xslF345X05/form4.xml", ""),
        (ACC_8K_VOTE, "8-K", "2025-06-27", "2025-06-25", "fx-20250625.htm", "5.07"),
        (ACC_8K_EARN, "8-K", "2025-05-28", "2025-05-28", "fx-20250528.htm", "2.02,9.01"),
        (ACC_Q1, "10-Q", "2025-05-28", "2025-04-27", "fx-20250427.htm", ""),
        (ACC_K25, "10-K", "2025-02-26", "2025-01-26", "fx-20250126.htm", ""),
        (ACC_K24, "10-K", "2024-02-21", "2024-01-28", "fx-20240128.htm", ""),
    ]
    older = [(ACC_K23, "10-K", "2023-02-24", "2023-01-29", "fx-20230129.htm", "")]
    name = f"CIK{CIK}-submissions-001.json"
    sub = {"cik": CIK.lstrip("0"), "name": COMPANY, "tickers": [TICKER],
           "filings": {"recent": _cols(recent), "files": [{"name": name, "filingCount": 1}]}}
    return sub, {name: _cols(older)}


def _fact(val, end, accn, form="10-K", fy=2025, start=None, fp="FY", filed="2025-02-26"):
    d = {"val": val, "end": end, "accn": accn, "form": form, "fy": fy, "fp": fp, "filed": filed}
    if start:
        d["start"] = start
    return d


def company_facts() -> dict:
    E25, E24 = "2025-01-26", "2024-01-28"
    usd = {
        "LesseeOperatingLeaseLiabilityPaymentsDueNextTwelveMonths": [_fact(1_000e6, E25, ACC_K25), _fact(700e6, E24, ACC_K24, fy=2024)],
        "LesseeOperatingLeaseLiabilityPaymentsDueYearTwo": [_fact(900e6, E25, ACC_K25)],
        "LesseeOperatingLeaseLiabilityPaymentsDueYearThree": [_fact(800e6, E25, ACC_K25)],
        "LesseeOperatingLeaseLiabilityPaymentsDueYearFour": [_fact(700e6, E25, ACC_K25)],
        "LesseeOperatingLeaseLiabilityPaymentsDueYearFive": [_fact(600e6, E25, ACC_K25)],
        "LesseeOperatingLeaseLiabilityPaymentsDueAfterYearFive": [_fact(2_000e6, E25, ACC_K25)],
        "LesseeOperatingLeaseLiabilityPaymentsDue": [_fact(6_000e6, E25, ACC_K25)],
        "LesseeOperatingLeaseLiabilityUndiscountedExcessAmount": [_fact(1_000e6, E25, ACC_K25)],
        "OperatingLeaseLiability": [_fact(5_000e6, E25, ACC_K25), _fact(4_000e6, E24, ACC_K25),
                                    _fact(4_000e6, E24, ACC_K24, fy=2024, filed="2024-02-21")],
        "OperatingLeaseLiabilityCurrent": [_fact(800e6, E25, ACC_K25)],
        "OperatingLeaseLiabilityNoncurrent": [_fact(4_200e6, E25, ACC_K25)],
        "OperatingLeaseCost": [_fact(1_100e6, E25, ACC_K25, start="2024-01-29")],
    }
    return {"cik": 42, "entityName": COMPANY, "facts": {"us-gaap": {
        tag: {"label": tag, "units": {"USD": rows}} for tag, rows in usd.items()}}}


class FakeEdgar:
    def __init__(self):
        self.sub, self.older = submissions()
        self.docs = {
            (ACC_K23, "fx-20230129.htm"): tenk_html(2023).encode(),
            (ACC_K24, "fx-20240128.htm"): tenk_html(2024).encode(),
            (ACC_K25, "fx-20250126.htm"): tenk_html(2025).encode(),
            (ACC_Q1, "fx-20250427.htm"): tenq_html().encode(),
            (ACC_8K_EARN, "fx-20250528.htm"): eightk_html().encode(),
            (ACC_8K_EARN, "fx-ex991.htm"): ex991_html().encode(),
            (ACC_8K_VOTE, "fx-20250625.htm"): vote_8k_html().encode(),
        }
        self.calls: List[tuple] = []

    def cik(self, ticker):
        return CIK if ticker.upper() == TICKER else None

    def submissions(self, cik):
        self.calls.append(("submissions", cik))
        return self.sub

    def older_submissions(self, name):
        self.calls.append(("older", name))
        return self.older[name]

    def company_facts(self, cik):
        self.calls.append(("companyfacts", cik))
        return company_facts()

    def filing_index(self, cik, accession):
        self.calls.append(("index", accession))
        from app.services.copilot.filings_rag.edgar import parse_filing_index
        return parse_filing_index(EIGHTK_INDEX) if accession == ACC_8K_EARN else []

    def document(self, cik, accession, name):
        self.calls.append(("doc", accession, name))
        return self.docs[(accession, name)]
