"""SEC Financial Statement Data Sets -> point-in-time facts (recorded 2026q3 sample)."""
import asyncio
from datetime import date, datetime, timezone

from app.models.public_data import PitFundamentalFact
from app.services.public_data import sec_fsds
from app.services.public_data.sec_common import et_to_utc

from .conftest import FIX

CIKS = {"0000320193", "0001045810", "0000789019", "0001318605"}


def test_recent_quarters_are_closed_quarters():
    assert sec_fsds.recent_quarters(date(2026, 11, 27), 2) == ["2026q3", "2026q2"]
    assert sec_fsds.recent_quarters(date(2026, 1, 5), 1) == ["2025q4"]


def test_parse_zip_keeps_non_dimensional_catalog_facts_with_acceptance_time():
    rows = list(sec_fsds.parse_zip(FIX / "fsds_2026q3_sample.zip", CIKS, sec_fsds.catalog_tags(), "2026q3"))
    assert rows and all(r["dataset"] == "2026q3" for r in rows)
    assert {r["cik"] for r in rows} == CIKS
    aapl = [r for r in rows if r["cik"] == "0000320193" and r["tag"] == "RevenueFromContractWithCustomerExcludingAssessedTax"
            and r["ddate"] == "2026-06-30" and r["qtrs"] == 1]
    assert len(aapl) == 1 and aapl[0]["value"] == 109417000000.0
    # accepted 2026-07-31 06:01 US Eastern (EDT) = 10:01 UTC
    assert aapl[0]["available_at"] == datetime(2026, 7, 31, 10, 1, tzinfo=timezone.utc)
    assert aapl[0]["filed"] == "2026-07-31" and aapl[0]["form"] == "10-Q" and aapl[0]["fp"] == "Q3"
    # the fixture contains one segmented row: never loaded
    assert len(rows) < sum(1 for _ in open_num())


def open_num():
    import io
    import zipfile
    z = zipfile.ZipFile(FIX / "fsds_2026q3_sample.zip")
    return io.TextIOWrapper(z.open("num.txt"), encoding="utf-8").readlines()[1:]


def test_et_to_utc_handles_standard_time():
    assert et_to_utc("2026-01-15 17:40:00.0") == datetime(2026, 1, 15, 22, 40, tzinfo=timezone.utc)


def test_load_quarter_is_idempotent(fetcher, db):
    first = sec_fsds.load_quarter(db, "2026q3", CIKS)
    assert first["rows"] > 50 and first["filings"] == 4
    n = db.query(PitFundamentalFact).count()
    again = sec_fsds.load_quarter(db, "2026q3", CIKS)
    assert again.get("skipped") is True and db.query(PitFundamentalFact).count() == n
    assert db.query(PitFundamentalFact).filter_by(cik="0001045810").first().ticker == "NVDA"


def test_pit_values_never_look_ahead(fetcher, db):
    sec_fsds.load_quarter(db, "2026q3", CIKS)
    # MSFT 10-K accepted 2026-07-29 16:08 ET
    assert sec_fsds.pit_values(db, "MSFT", "2026-07-28", ["NetIncomeLoss"]) == {}
    v = sec_fsds.pit_values(db, "MSFT", "2026-07-30", ["NetIncomeLoss"], qtrs=4)
    assert v["NetIncomeLoss"]["period_end"] == "2026-06-30" and v["NetIncomeLoss"]["form"] == "10-K"


def test_restatement_only_visible_after_it_is_filed(db):
    base = dict(cik="0000000042", ticker="ZZZ", tag="NetIncomeLoss", taxonomy="us-gaap", ddate="2025-12-31",
                qtrs=4, uom="USD", fy=2025, fp="FY", period="2025-12-31", source="test")
    db.add_all([
        PitFundamentalFact(adsh="0000000042-26-000001", value=100.0, form="10-K", filed="2026-02-20",
                           available_at=datetime(2026, 2, 20, 21, tzinfo=timezone.utc), **base),
        PitFundamentalFact(adsh="0000000042-26-000009", value=80.0, form="10-K/A", filed="2026-05-10",
                           available_at=datetime(2026, 5, 10, 21, tzinfo=timezone.utc), **base),
    ])
    db.commit()
    assert sec_fsds.pit_values(db, "ZZZ", "2026-03-01", ["NetIncomeLoss"])["NetIncomeLoss"]["value"] == 100.0
    assert sec_fsds.pit_values(db, "ZZZ", "2026-06-01", ["NetIncomeLoss"])["NetIncomeLoss"]["value"] == 80.0
    assert sec_fsds.pit_values(db, "ZZZ", "2026-02-19", ["NetIncomeLoss"]) == {}


def test_pit_statements_feed_the_fundamentals_engine(fetcher, db, Session):
    sec_fsds.load_quarter(db, "2026q3", CIKS)
    st = asyncio.run(sec_fsds.PITFundamentalsData(Session, "2026-08-01").statements("AAPL"))
    assert st is not None and st.ticker == "AAPL"
    q = [p for p in st.quarterly if p.end == "2026-06-30"]
    assert q, [p.end for p in st.quarterly]
    assert st.v(q[0].key, "revenue") == 109417000000.0
    assert any("point-in-time" in n for n in st.notes)
    # before Apple's 10-Q was accepted there is nothing for that quarter
    assert asyncio.run(sec_fsds.PITFundamentalsData(Session, "2026-07-30").statements("AAPL")) is None


def test_to_companyfacts_renames_eps_units():
    r = PitFundamentalFact(cik="1", adsh="a", tag="EarningsPerShareDiluted", taxonomy="us-gaap", ddate="2026-06-30",
                           qtrs=1, uom="USD", value=2.02, form="10-Q", fy=2026, fp="Q3", filed="2026-07-31")
    cf = sec_fsds.to_companyfacts([r], "1")
    ent = cf["facts"]["us-gaap"]["EarningsPerShareDiluted"]["units"]["USD/shares"][0]
    assert ent["start"] == "2026-04-01" and ent["end"] == "2026-06-30"
