"""SEC Form 4 parsing, per-ticker refresh and net-activity summary (recorded NVDA filings)."""
from datetime import date, datetime, timezone

from app.models.public_data import InsiderTransaction
from app.services.public_data import sec_form4

from .conftest import FIX

PURCHASE_XML = b"""<?xml version="1.0"?>
<ownershipDocument><documentType>4</documentType><periodOfReport>2026-11-20</periodOfReport>
<issuer><issuerCik>0001045810</issuerCik><issuerName>NVIDIA CORP</issuerName><issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerCik>0000000077</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>0</isOfficer></reportingOwnerRelationship></reportingOwner>
<aff10b5One>0</aff10b5One>
<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle>
<transactionDate><value>2026-11-20</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>150</value></transactionPricePerShare>
<transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
<ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction></nonDerivativeTable>
</ownershipDocument>"""


def test_parse_real_form4():
    doc = sec_form4.parse_form4((FIX / "form4_nvda_0001696841-26-000016.xml").read_bytes())
    assert doc["issuer_symbol"] == "NVDA" and doc["issuer_cik"] == "0001045810"
    assert doc["owner_name"] == "Teter Timothy S." and doc["is_officer"] and not doc["is_director"]
    assert doc["owner_title"] == "EVP, General Counsel and Sec" and doc["plan_10b5_1"] is True
    t0 = doc["transactions"][0]
    assert (t0["tx_code"], t0["shares"], t0["price"], t0["acquired_disposed"]) == ("S", 1434.0, 146.0298, "D")
    assert t0["tx_date"] == "2026-11-19" and t0["direct_indirect"] == "I" and t0["is_derivative"] is False


def test_refresh_ticker_loads_new_accessions_only(fetcher, db):
    res = sec_form4.refresh_ticker(db, "NVDA", today=date(2026, 11, 27))
    assert res["filings_checked"] == 2 and res["errors"] == 0 and res["rows_added"] > 2
    row = db.query(InsiderTransaction).filter_by(accession="0001696841-26-000016", line_no=0).one()
    # acceptanceDateTime from the submissions JSON (UTC)
    assert row.available_at.replace(tzinfo=timezone.utc) == datetime(2026, 11, 23, 21, 54, 28, tzinfo=timezone.utc)
    assert row.url.endswith("/000169684126000016/wk-form4_1795470863.xml")
    n = db.query(InsiderTransaction).count()
    xml_calls = sum(1 for c in fetcher.calls if c[1].endswith(".xml"))
    again = sec_form4.refresh_ticker(db, "NVDA", today=date(2026, 11, 27))
    assert again["rows_added"] == 0 and db.query(InsiderTransaction).count() == n
    assert sum(1 for c in fetcher.calls if c[1].endswith(".xml")) == xml_calls       # nothing re-downloaded


def test_net_activity_counts_open_market_only(fetcher, db):
    sec_form4.refresh_ticker(db, "NVDA", today=date(2026, 11, 27))
    doc = sec_form4.parse_form4(PURCHASE_XML)
    for i, tx in enumerate(doc["transactions"]):
        db.add(InsiderTransaction(ticker="NVDA", issuer_cik="0001045810", accession="0000000077-26-000001", line_no=i,
                                  filed_date="2026-11-21", available_at=datetime(2026, 11, 21, 21, tzinfo=timezone.utc),
                                  owner_name=doc["owner_name"], is_director=True, source="test",
                                  **{k: tx[k] for k in ("tx_date", "tx_code", "shares", "price", "acquired_disposed",
                                                        "shares_after", "direct_indirect", "is_derivative",
                                                        "security_title")}))
    db.commit()
    p = sec_form4.insider_payload(db, "NVDA", as_of=datetime(2026, 11, 27, tzinfo=timezone.utc))
    s = p["summary"]["90"]
    sells = [t for t in p["transactions"] if t["code"] == "S" and not t["derivative"]]
    sell_val = round(sum(t["shares"] * t["price"] for t in sells), 2)
    assert s["buy_transactions"] == 1 and s["buy_value"] == 150000.0
    assert s["sell_transactions"] == len(sells) and s["sell_value"] == sell_val
    assert s["net_value"] == round(150000.0 - sell_val, 2) and s["distinct_buyers"] == 1
    assert p["status"] == "ok" and p["attribution"]["text"].startswith("Source: SEC")
    # point in time: the purchase was not public before 2026-11-21
    early = sec_form4.insider_payload(db, "NVDA", as_of=datetime(2026, 11, 20, tzinfo=timezone.utc))
    assert early["summary"]["90"]["buy_transactions"] == 0
