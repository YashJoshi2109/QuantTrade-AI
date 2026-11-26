"""Bank balance sheets (JPM): cash and long-term debt use bank XBRL tags.

Fixture is trimmed from JPM's real companyfacts. Before the fallbacks, every
recent period had cash_and_equivalents / long_term_debt = None because JPM's
generic CashAndCashEquivalentsAtCarryingValue / LongTermDebt facts end in 2018 / 2014.
"""
import copy
import json
from pathlib import Path

from app.services.sec_edgar_service import parse_financials

FIXTURE = json.loads((Path(__file__).parent.parent / "fixtures" / "edgar_bank_jpm_min.json").read_text())


def _val(row, field):
    raw = row.get(field)
    return json.loads(raw)["value"] if raw else None


def _rows(facts):
    return {r["period"]: r for r in parse_financials(facts, "0000019617", 1, "JPM")}


def test_bank_cash_is_cash_due_from_banks_plus_interest_bearing_deposits():
    rows = _rows(FIXTURE)
    assert set(rows) >= {"2026-Q3", "2025-FY"}
    # 21.259B + 305.012B = 326.271B (equals JPM's reported cash-flow total)
    assert _val(rows["2026-Q3"], "cash_and_equivalents") == 21_259_000_000 + 305_012_000_000
    assert _val(rows["2025-FY"], "cash_and_equivalents") == 21_742_000_000 + 321_596_000_000


def test_bank_long_term_debt_falls_back_to_debt_including_current_maturities():
    rows = _rows(FIXTURE)
    assert _val(rows["2026-Q3"], "long_term_debt") == 460_160_000_000
    assert _val(rows["2025-FY"], "long_term_debt") == 435_206_000_000


def test_cash_falls_back_to_restricted_cash_total_when_deposits_tag_missing():
    facts = copy.deepcopy(FIXTURE)
    del facts["facts"]["us-gaap"]["InterestBearingDepositsInBanks"]
    rows = _rows(facts)
    assert _val(rows["2026-Q3"], "cash_and_equivalents") == 326_271_000_000


def test_primary_tags_still_win_when_they_report_the_period():
    facts = copy.deepcopy(FIXTURE)
    gaap = facts["facts"]["us-gaap"]
    gaap["CashAndCashEquivalentsAtCarryingValue"]["units"]["USD"].append(
        {"end": "2026-09-30", "val": 1_000, "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-11-03"})
    gaap["LongTermDebt"]["units"]["USD"].append(
        {"end": "2026-09-30", "val": 2_000, "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-11-03"})
    rows = _rows(facts)
    assert _val(rows["2026-Q3"], "cash_and_equivalents") == 1_000
    assert _val(rows["2026-Q3"], "long_term_debt") == 2_000


def test_repo_and_fed_funds_are_not_counted_as_debt():
    facts = copy.deepcopy(FIXTURE)
    gaap = facts["facts"]["us-gaap"]
    del gaap["LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"]
    gaap["FederalFundsPurchasedAndSecuritiesSoldUnderAgreementsToRepurchase"] = {"units": {"USD": [
        {"end": "2026-09-30", "val": 703_392_000_000, "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-11-03"}]}}
    rows = _rows(facts)
    assert _val(rows["2026-Q3"], "long_term_debt") is None
