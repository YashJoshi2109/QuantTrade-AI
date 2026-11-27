"""EDGAR parsing: quarters must be 3-month values, labels must follow the fiscal calendar,
tag aliases must merge (capex → FCF), and EBITDA is derived when not tagged."""
import json

from app.services.sec_edgar_service import (
    PARSER_VERSION,
    _discover_periods,
    _extract_concept,
    parse_financials,
    stored_parser_version,
)


def _fact(start, end, val, form, fy, fp, filed):
    e = {"end": end, "val": val, "form": form, "fy": fy, "fp": fp, "filed": filed}
    if start:
        e["start"] = start
    return e


def _usd(*entries):
    return {"units": {"USD": list(entries)}}


# Mirrors NVDA's real FY2027 filings (values in $B for readability).
B = 1e9
FACTS = {
    "facts": {"us-gaap": {
        "Revenues": _usd(
            _fact("2025-01-27", "2026-01-25", 215.94 * B, "10-K", 2026, "FY", "2026-02-25"),
            _fact("2026-01-26", "2026-04-26", 81.61 * B, "10-Q", 2027, "Q1", "2026-05-28"),
            # Q2 10-Q reports the 3-month value AND the 6-month YTD with the same end date
            _fact("2026-04-27", "2026-07-26", 96.22 * B, "10-Q", 2027, "Q2", "2026-08-27"),
            _fact("2026-01-26", "2026-07-26", 177.84 * B, "10-Q", 2027, "Q2", "2026-08-27"),
        ),
        "OperatingIncomeLoss": _usd(
            _fact("2026-04-27", "2026-07-26", 60.0 * B, "10-Q", 2027, "Q2", "2026-08-27"),
            _fact("2025-01-27", "2026-01-25", 130.39 * B, "10-K", 2026, "FY", "2026-02-25"),
        ),
        "DepreciationDepletionAndAmortization": _usd(
            _fact("2025-01-27", "2026-01-25", 2.0 * B, "10-K", 2026, "FY", "2026-02-25"),
        ),
        # Cash flow is YTD-only in 10-Qs
        "NetCashProvidedByUsedInOperatingActivities": _usd(
            _fact("2025-01-27", "2026-01-25", 102.72 * B, "10-K", 2026, "FY", "2026-02-25"),
            _fact("2026-01-26", "2026-04-26", 50.34 * B, "10-Q", 2027, "Q1", "2026-05-28"),
            _fact("2026-01-26", "2026-07-26", 74.42 * B, "10-Q", 2027, "Q2", "2026-08-27"),
        ),
        # Old tag stops in 2020; recent capex lives under the newer tag
        "PaymentsToAcquirePropertyPlantAndEquipment": _usd(
            _fact("2019-01-28", "2019-04-28", 0.13 * B, "10-Q", 2020, "Q1", "2019-05-20"),
        ),
        "PaymentsToAcquireProductiveAssets": _usd(
            _fact("2025-01-27", "2026-01-25", 6.04 * B, "10-K", 2026, "FY", "2026-02-25"),
            _fact("2026-01-26", "2026-04-26", 1.76 * B, "10-Q", 2027, "Q1", "2026-05-28"),
            _fact("2026-01-26", "2026-07-26", 4.43 * B, "10-Q", 2027, "Q2", "2026-08-27"),
        ),
        "Assets": _usd(_fact(None, "2026-07-26", 250.0 * B, "10-Q", 2027, "Q2", "2026-08-27")),
        "EarningsPerShareDiluted": {"units": {"USD/shares": [
            _fact("2026-01-26", "2026-07-26", 3.10, "10-Q", 2027, "Q2", "2026-08-27"),  # YTD only
        ]}},
    }}
}


def _rows():
    return {r["period"]: r for r in parse_financials(FACTS, "0001045810", 1, "NVDA")}


def _v(row, field):
    raw = row[field]
    return None if raw is None else json.loads(raw)["value"]


def test_labels_follow_fiscal_calendar():
    labels = [p["period"] for p in _discover_periods(FACTS)]
    # Q2 FY2027 ended July 2026 — not calendar "2026-Q3"
    assert labels == ["2027-Q2", "2027-Q1", "2026-FY"]


def test_quarter_uses_three_month_value_not_ytd():
    q2 = _rows()["2027-Q2"]
    assert round(_v(q2, "revenue") / B, 2) == 96.22  # not 177.84 (6-month YTD)


def test_ytd_only_cash_flow_is_differenced():
    rows = _rows()
    assert round(_v(rows["2027-Q2"], "operating_cash_flow") / B, 2) == 24.08  # 74.42 − 50.34
    assert round(_v(rows["2027-Q1"], "operating_cash_flow") / B, 2) == 50.34


def test_capex_tag_alias_gives_free_cash_flow():
    rows = _rows()
    assert round(_v(rows["2026-FY"], "free_cash_flow") / B, 2) == 96.68     # 102.72 − 6.04
    assert round(_v(rows["2027-Q2"], "capital_expenditures") / B, 2) == 2.67  # 4.43 − 1.76
    assert round(_v(rows["2027-Q2"], "free_cash_flow") / B, 2) == 21.41


def test_ebitda_derived_from_operating_income_plus_da():
    assert round(_v(_rows()["2026-FY"], "ebitda") / B, 2) == 132.39


def test_eps_never_derived_from_ytd():
    assert _rows()["2027-Q2"]["eps_diluted"] is None


def test_instant_balance_values():
    assert round(_v(_rows()["2027-Q2"], "total_assets") / B, 2) == 250.0


def test_tag_merge_prefers_first_alias():
    facts = {"facts": {"us-gaap": {
        "Revenues": _usd(_fact("2026-01-26", "2026-04-26", 10.0, "10-Q", 2027, "Q1", "2026-05-01")),
        "RevenueFromContractWithCustomerExcludingAssessedTax": _usd(
            _fact("2026-01-26", "2026-04-26", 99.0, "10-Q", 2027, "Q1", "2026-05-02"),
            _fact("2025-01-26", "2025-04-26", 7.0, "10-Q", 2026, "Q1", "2025-05-02"),
        ),
    }}}
    vals = {(e["start"], e["end"]): e["val"] for e in _extract_concept(
        facts, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"])}
    assert vals[("2026-01-26", "2026-04-26")] == 10.0
    assert vals[("2025-01-26", "2025-04-26")] == 7.0


def test_parser_version_stamp():
    class Row:
        revenue = json.dumps({"value": 1, "unit": "USD", "pv": PARSER_VERSION})
    class Old:
        revenue = json.dumps({"value": 1, "unit": "USD"})
    assert stored_parser_version(Row()) == PARSER_VERSION
    assert stored_parser_version(Old()) == 0


def test_net_income_falls_back_to_profitloss_when_netincomeloss_stops():
    """AEIS tags NetIncomeLoss through Q2 2025, then only ProfitLoss: later
    quarters showed net income "—". NetIncomeLoss still wins where it exists."""
    M = 1e6
    facts = {"facts": {"us-gaap": {
        "Revenues": _usd(
            _fact("2025-04-01", "2025-06-30", 441.0 * M, "10-Q", 2025, "Q2", "2025-08-05"),
            _fact("2026-07-01", "2026-09-30", 696.4 * M, "10-Q", 2026, "Q3", "2026-11-02"),
        ),
        "NetIncomeLoss": _usd(
            _fact("2025-04-01", "2025-06-30", 25.2 * M, "10-Q", 2025, "Q2", "2025-08-05"),
        ),
        "ProfitLoss": _usd(
            _fact("2025-04-01", "2025-06-30", 99.0 * M, "10-Q", 2025, "Q2", "2025-08-05"),
            _fact("2026-07-01", "2026-09-30", 115.6 * M, "10-Q", 2026, "Q3", "2026-11-02"),
        ),
    }}}
    rows = {r["period"]: r for r in parse_financials(facts, "0000927003", 1, "AEIS")}

    def ni(p):
        return json.loads(rows[p]["net_income"])["value"]

    assert ni("2026-Q3") == 115.6 * M
    assert ni("2025-Q2") == 25.2 * M  # NetIncomeLoss preferred over ProfitLoss
