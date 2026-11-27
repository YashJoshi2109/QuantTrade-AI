"""XBRL companyfacts normalisation: aliases, restatements, fiscal calendars,
units, duplicate frames, YTD-derived quarters (fixture JSON, no network)."""
import pytest

from app.services.fundamentals import analysis as A
from app.services.fundamentals.xbrl import ITEMS, normalize_companyfacts, ttm

from .helpers import CF, ROWS

K23, K24, K25 = "0000001-23-000010", "0000001-24-000010", "0000001-25-000010"
Q1, Q2, Q3 = "0000001-24-000020", "0000001-24-000030", "0000001-24-000040"


def nvda_like() -> CF:
    """Fiscal years end on the last Sunday of January (FY2025 ends 2025-01-26)."""
    cf = CF(cik=1045810, name="Jan FYE Corp")
    k = dict(form="10-K", fp="FY")
    # FY2023 10-K: FY2023 + comparative FY2022 (no own 10-K for FY2022 in this fixture)
    cf.add("Revenues", 1000, "2023-01-29", start="2022-01-31", accn=K23, fy=2023, filed="2023-03-01", **k)
    cf.add("Revenues", 800, "2022-01-30", start="2021-02-01", accn=K23, fy=2023, filed="2023-03-01", **k)
    cf.add("PaymentsToAcquirePropertyPlantAndEquipment", 40, "2023-01-29", start="2022-01-31", accn=K23, fy=2023,
           filed="2023-03-01", **k)
    # FY2024 10-K restates FY2023 revenue (1000 -> 1010) and switches the capex tag
    cf.add("Revenues", 1200, "2024-01-28", start="2023-01-30", accn=K24, fy=2024, filed="2024-02-21", **k)
    cf.add("Revenues", 1010, "2023-01-29", start="2022-01-31", accn=K24, fy=2024, filed="2024-02-21", **k)
    cf.add("PaymentsToAcquireProductiveAssets", 50, "2024-01-28", start="2023-01-30", accn=K24, fy=2024,
           filed="2024-02-21", **k)
    cf.add("PaymentsToAcquireProductiveAssets", 40, "2023-01-29", start="2022-01-31", accn=K24, fy=2024,
           filed="2024-02-21", **k)
    cf.add("NetCashProvidedByUsedInOperatingActivities", 400, "2024-01-28", start="2023-01-30", accn=K24,
           fy=2024, filed="2024-02-21", **k)
    cf.add("Assets", 2000, "2024-01-28", accn=K24, fy=2024, filed="2024-02-21", **k)
    # FY2025 quarters
    q = dict(form="10-Q")
    cf.add("Revenues", 300, "2024-04-28", start="2024-01-29", accn=Q1, fy=2025, fp="Q1", filed="2024-05-29", **q)
    cf.add("Revenues", 250, "2023-04-30", start="2023-01-30", accn=Q1, fy=2025, fp="Q1", filed="2024-05-29", **q)
    cf.add("NetCashProvidedByUsedInOperatingActivities", 100, "2024-04-28", start="2024-01-29", accn=Q1, fy=2025,
           fp="Q1", filed="2024-05-29", **q)
    cf.add("EarningsPerShareDiluted", 0.60, "2024-04-28", start="2024-01-29", accn=Q1, fy=2025, fp="Q1",
           filed="2024-05-29", unit="USD/shares", **q)
    cf.add("Assets", 2100, "2024-04-28", accn=Q1, fy=2025, fp="Q1", filed="2024-05-29", **q)
    cf.add("Revenues", 320, "2024-07-28", start="2024-04-29", accn=Q2, fy=2025, fp="Q2", filed="2024-08-28", **q)
    cf.add("Revenues", 620, "2024-07-28", start="2024-01-29", accn=Q2, fy=2025, fp="Q2", filed="2024-08-28", **q)
    cf.add("NetCashProvidedByUsedInOperatingActivities", 210, "2024-07-28", start="2024-01-29", accn=Q2, fy=2025,
           fp="Q2", filed="2024-08-28", **q)
    cf.add("Revenues", 350, "2024-10-27", start="2024-07-29", accn=Q3, fy=2025, fp="Q3", filed="2024-11-20", **q)
    cf.add("Revenues", 970, "2024-10-27", start="2024-01-29", accn=Q3, fy=2025, fp="Q3", filed="2024-11-20", **q)
    cf.add("NetCashProvidedByUsedInOperatingActivities", 330, "2024-10-27", start="2024-01-29", accn=Q3, fy=2025,
           fp="Q3", filed="2024-11-20", **q)
    cf.add("EarningsPerShareDiluted", 0.70, "2024-10-27", start="2024-07-29", accn=Q3, fy=2025, fp="Q3",
           filed="2024-11-20", unit="USD/shares", **q)
    # FY2025 10-K: FY2025, comparative FY2024 (duplicate frame, same value)
    cf.add("Revenues", 1400, "2025-01-26", start="2024-01-29", accn=K25, fy=2025, filed="2025-02-26", **k)
    cf.add("Revenues", 1200, "2024-01-28", start="2023-01-30", accn=K25, fy=2025, filed="2025-02-26",
           frame="CY2023", **k)
    cf.add("NetCashProvidedByUsedInOperatingActivities", 460, "2025-01-26", start="2024-01-29", accn=K25,
           fy=2025, filed="2025-02-26", **k)
    cf.add("EarningsPerShareDiluted", 2.90, "2025-01-26", start="2024-01-29", accn=K25, fy=2025,
           filed="2025-02-26", unit="USD/shares", **k)
    cf.add("Assets", 2500, "2025-01-26", accn=K25, fy=2025, filed="2025-02-26", **k)
    cf.add("Assets", 2000, "2024-01-28", accn=K25, fy=2025, filed="2025-02-26", **k)
    # a non-financial form is ignored
    cf.add("Revenues", 999999, "2025-01-26", start="2024-01-29", accn="x", fy=2025, fp="FY", form="8-K",
           filed="2025-02-20")
    cf.data["facts"]["dei"]["EntityCommonStockSharesOutstanding"] = {"units": {"shares": [
        {"end": "2025-03-01", "val": 24_400_000_000, "accn": K25, "fy": 2025, "fp": "FY", "form": "10-K",
         "filed": "2025-02-26"}]}}
    return cf


@pytest.fixture
def st():
    return normalize_companyfacts(nvda_like().data, "NVDA")


def test_fiscal_year_labels_follow_company_calendar(st):
    assert [p.label for p in st.annual] == ["FY2022", "FY2023", "FY2024", "FY2025"]
    fy25 = st.annual[-1]
    assert (fy25.start, fy25.end, fy25.accn, fy25.form) == ("2024-01-29", "2025-01-26", K25, "10-K")
    assert st.annual[0].accn is None          # comparative-only year: no own filing
    assert st.v("2022-FY", "revenue") == 800


def test_restated_value_used_and_original_kept(st):
    x = st.x("2023-FY", "revenue")
    assert x.value == 1010 and x.accn == K24
    assert x.original_value == 1000 and x.original_accn == K23
    notes = A.inputs_block(st, st.annual, ["revenue"])["value_notes"]
    assert any("restated to 1,010" in n and "originally 1,000" in n for n in notes)


def test_duplicate_frames_collapse_to_first_filing(st):
    x = st.x("2024-FY", "revenue")
    assert x.value == 1200 and x.accn == K24 and x.original_value is None


def test_tag_alias_switch_keeps_every_period(st):
    assert st.x("2023-FY", "capex").tag == "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"
    assert st.x("2024-FY", "capex").tag == "us-gaap:PaymentsToAcquireProductiveAssets"
    assert st.v("2024-FY", "capex") == 50


def test_non_financial_forms_ignored(st):
    assert st.v("2025-FY", "revenue") == 1400


def test_quarters_direct_and_derived_from_ytd(st):
    assert [q.label for q in st.quarterly] == ["Q1 FY2025", "Q2 FY2025", "Q3 FY2025", "Q4 FY2025"]
    assert st.v("2025-Q1", "revenue") == 300 and st.x("2025-Q1", "revenue").derived is None
    # cash flow is YTD-only in 10-Qs: Q2 = 6M - 3M, Q3 = 9M - 6M, Q4 = FY - 9M
    assert st.v("2025-Q2", "operating_cash_flow") == 110
    assert "6M YTD" in st.x("2025-Q2", "operating_cash_flow").derived
    assert st.v("2025-Q3", "operating_cash_flow") == 120
    assert st.v("2025-Q4", "operating_cash_flow") == 130
    assert st.v("2025-Q4", "revenue") == 430                     # 1400 - 970
    assert st.x("2025-Q4", "revenue").derived.startswith("FY YTD")


def test_per_share_items_never_derived_by_subtraction(st):
    assert st.v("2025-Q1", "eps_diluted") == 0.60
    assert st.v("2025-Q4", "eps_diluted") is None


def test_ttm_and_instants(st):
    t = ttm(st, "revenue")
    assert t["value"] == 1400 and t["periods"][0] == "Q1 FY2025"
    assert st.v("2025-Q1", "total_assets") == 2100
    assert st.v("2025-FY", "total_assets") == 2500


def test_cover_shares(st):
    assert st.cover_shares["value"] == 24_400_000_000 and st.cover_shares["as_of"] == "2025-03-01"


def test_ambiguous_cover_shares_not_used():
    cf = nvda_like()
    cf.data["facts"]["dei"]["EntityCommonStockSharesOutstanding"]["units"]["shares"].append(
        {"end": "2025-03-01", "val": 5_000_000, "accn": K25, "fy": 2025, "fp": "FY", "form": "10-K",
         "filed": "2025-02-26"})
    st = normalize_companyfacts(cf.data, "MULTI")
    assert st.cover_shares is None and any("share classes" in n for n in st.notes)


def test_53_week_year_and_amendment():
    cf = CF()
    cf.add("Revenues", 500, "2021-01-02", start="2019-12-29", accn="a1", fy=2020, fp="FY", form="10-K",
           filed="2021-02-20")        # 371-day fiscal year
    cf.add("Revenues", 505, "2021-01-02", start="2019-12-29", accn="a2", fy=2020, fp="FY", form="10-K/A",
           filed="2021-06-01")        # amendment restates it
    st = normalize_companyfacts(cf.data, "X")
    assert [p.label for p in st.annual] == ["FY2020"]
    x = st.x("2020-FY", "revenue")
    assert x.value == 505 and x.original_value == 500 and x.form == "10-K/A"


def test_ifrs_filer_in_local_currency():
    cf = CF(name="IFRS Foundry")
    for tag, val in (("Revenue", 2_894_308_000_000), ("ProfitLossAttributableToOwnersOfParent", 1_173_268_000_000)):
        cf.add(tag, val, "2024-12-31", start="2024-01-01", accn="f1", fy=2024, fp="FY", form="20-F",
               filed="2025-04-17", unit="TWD", ns="ifrs-full")
    cf.add("Assets", 6_691_938_000_000, "2024-12-31", accn="f1", fy=2024, fp="FY", form="20-F",
           filed="2025-04-17", unit="TWD", ns="ifrs-full")
    st = normalize_companyfacts(cf.data, "TSM")
    assert st.currency == "TWD" and st.taxonomy == "ifrs-full"
    assert st.v("2024-FY", "revenue") == 2_894_308_000_000
    assert st.x("2024-FY", "net_income").tag == "ifrs-full:ProfitLossAttributableToOwnersOfParent"


def annual_companyfacts(rows=ROWS) -> dict:
    """ROWS as real companyfacts: each fiscal year's 10-K reports its own year."""
    cf = CF(name="Test Co")
    for fy, row in rows.items():
        accn = f"0000000001-{fy % 100:02d}-000001"
        for key, val in row.items():
            li = ITEMS[key]
            ns, _, tag = li.tags[0].partition(":")
            unit = {"currency": "USD", "shares": "shares", "per_share": "USD/shares"}[li.unit]
            start = f"{fy}-01-01" if li.kind == "duration" else None
            cf.add(tag, val, f"{fy}-12-31", start=start, accn=accn, fy=fy, fp="FY", form="10-K",
                   filed=f"{fy + 1}-02-15", unit=unit, ns=ns)
    return cf.data


def test_end_to_end_companyfacts_to_metrics():
    """The XBRL path and the hand-computed metric values agree."""
    st = normalize_companyfacts(annual_companyfacts(), "TEST", "0000000001")
    assert st.v("2023-FY", "total_debt") == 280
    out = A.earnings_quality_payload(st, years=2)
    assert out["accruals"]["FY2023"]["bs_accrual_ratio_pct"] == 25.45
    assert out["working_capital"]["FY2023"]["dso_days"] == 38.0
    assert out["beneish_m"]["FY2023"]["m_score"] == pytest.approx(-2.011, abs=1e-3)
    assert out["periods"][-1]["accn"] == "0000000001-23-000001"
    assert out["periods"][-1]["url"].startswith("https://www.sec.gov/Archives/edgar/data/1/")
    assert out["line_items"]["revenue"]["FY2023"] == 1200


def test_ifrs_debt_da_sga_and_investments_are_summed_from_components():
    cf = CF(name="IFRS Foundry")
    kw = dict(accn="f1", fy=2024, fp="FY", form="20-F", filed="2025-04-17", unit="TWD", ns="ifrs-full")
    for tag, val in (("Revenue", 1000), ("DepreciationExpense", 300), ("AmortisationExpense", 10),
                     ("SalesAndMarketingExpense", 5), ("GeneralAndAdministrativeExpense", 15)):
        cf.add(tag, val, "2024-12-31", start="2024-01-01", **kw)
    for tag, val in (("Assets", 5000), ("LongtermBorrowings", 30), ("NoncurrentPortionOfNoncurrentBondsIssued", 900),
                     ("CurrentPortionOfLongtermBorrowings", 10),
                     ("CurrentBondsIssuedAndCurrentPortionOfNoncurrentBondsIssued", 50),
                     ("CurrentFinancialAssetsAtFairValueThroughOtherComprehensiveIncome", 190),
                     ("CurrentFinancialAssetsAtAmortisedCost", 100), ("Equity", 4000), ("NoncontrollingInterests", 40)):
        cf.add(tag, val, "2024-12-31", **kw)
    st = normalize_companyfacts(cf.data, "TSM")
    k = "2024-FY"
    assert st.v(k, "depreciation_amortization") == 310
    assert st.v(k, "sga_expense") == 20
    assert st.v(k, "ltd_noncurrent") == 930 and st.v(k, "ltd_current") == 60
    assert st.v(k, "total_debt") == 990
    assert st.v(k, "short_term_investments") == 290
    assert st.v(k, "total_equity") == 3960          # Equity incl. NCI - NCI
    assert st.x(k, "total_debt").derived == "ltd_noncurrent + ltd_current"


def test_stale_cover_share_count_is_not_used():
    cf = CF()
    cf.add("Revenues", 10, "2024-12-31", start="2024-01-01", accn="k", fy=2024, fp="FY", form="10-K",
           filed="2025-02-01")
    cf.data["facts"]["dei"]["EntityCommonStockSharesOutstanding"] = {"units": {"shares": [
        {"end": "2010-01-27", "val": 469_280_842, "accn": "old", "fy": 2010, "fp": "Q1", "form": "10-Q",
         "filed": "2010-02-03"}]}}
    st = normalize_companyfacts(cf.data, "V")
    assert st.cover_shares is None and any("reports shares by class" in n for n in st.notes)


def test_gap_in_a_persistent_balance_is_unavailable_not_zero():
    from app.services.fundamentals import metrics as M
    rows = {fy: dict(r) for fy, r in ROWS.items()}
    rows[2021]["short_term_investments"] = 40      # tagged FY2021 and FY2022 but not FY2023
    rows[2023] = {k: v for k, v in rows[2023].items() if k != "short_term_investments"}
    st = normalize_companyfacts(annual_companyfacts(rows), "GAP")
    c = M.Ctx(st=st, periods=st.annual)
    assert M.accruals_table(c, [2])["FY2023"]["noa"] is None
    assert any("tagged for FY2021, FY2022 but not this year" in u for u in c.unavailable)
    # an item that is legitimately absent some years is treated as 0, with a note
    assert M.roic_table(c, [1])["FY2022"]["reinvestment"] is not None
    assert any(n.startswith("acquisitions not tagged for FY2022") for n in c.assumption_notes())


def test_peer_ev_uses_one_balance_sheet_date():
    rows = {fy: dict(r) for fy, r in ROWS.items()}
    rows[2023] = {k: v for k, v in rows[2023].items() if k != "short_term_investments"}
    st = normalize_companyfacts(annual_companyfacts(rows), "EV")
    m = A.MarketInputs(market_cap_usd=2000.0, market_cap_source="fund:EV")
    row = A.peer_row(st, m)
    assert "enterprise_value_usd" not in row
    assert any("short-term investments tagged at 2022-12-31 but not at 2023-12-31" in n for n in row["notes"])
