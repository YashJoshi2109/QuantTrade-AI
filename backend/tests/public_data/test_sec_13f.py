"""SEC 13F data sets -> institutional ownership (recorded samples of two windows)."""
from app.models.public_data import InstitutionalHolding, InstitutionalOwnershipSummary
from app.services.public_data import sec_13f

TICKERS = ["NVDA", "AAPL", "MSFT", "TSLA", "GOOGL"]


def test_norm_name_strips_suffixes_only():
    assert sec_13f.norm_name("NVIDIA CORPORATION COM") == "NVIDIA"
    assert sec_13f.norm_name("Apple Inc.") == "APPLE"
    assert sec_13f.norm_name("TESLA, INC.") == "TESLA"
    assert sec_13f.norm_name("APPLE HOSPITALITY REIT INC") == "APPLE HOSPITALITY REIT"


def test_list_datasets_newest_first(fetcher):
    ds = sec_13f.list_datasets()
    assert ds[0]["key"] == "01jun2026-31aug2026"
    assert ds[1]["key"] == "01mar2026-31may2026"
    assert ds[0]["url"].startswith("https://www.sec.gov/files/") and ds[0]["url"].endswith("_form13f.zip")


def test_drop_inconsistent_value_share_lines():
    lst = [("a", 100, 15000), ("b", 200, 30000), ("c", 50, 7400), ("d", 10, 1500), ("e", 70, 10500),
           ("bad", 7_000_000_000, 35_000_000)]
    keep, dropped = sec_13f.drop_inconsistent(lst)
    assert dropped == 1 and "bad" not in {x[0] for x in keep}


def _load_both(db):
    for ds in reversed(sec_13f.list_datasets()[:2]):
        sec_13f.load_dataset(db, ds["key"], ds["url"], TICKERS)


def test_load_and_ownership_qoq(fetcher, db):
    _load_both(db)
    s = db.query(InstitutionalOwnershipSummary).filter_by(ticker="NVDA").order_by(InstitutionalOwnershipSummary.period).all()
    assert [x.period for x in s] == ["2026-03-31", "2026-06-30"]
    assert s[-1].cusip == "67066G104" and s[-1].cusip_method == "issuer_name_match"
    g = db.query(InstitutionalOwnershipSummary).filter_by(ticker="GOOGL").first()
    assert g is None or g.cusip_method == "override"
    p = sec_13f.ownership_payload(db, "NVDA", top=5)
    assert p["status"] == "ok" and p["period"] == "2026-06-30" and p["previous"]["period"] == "2026-03-31"
    assert p["qoq"]["holders_change"] == p["holders"] - p["previous"]["holders"]
    names = [h["filer"] for h in p["top_holders"]]
    assert "BlackRock, Inc." in names
    # the recorded CalSTRS line (7.0bn shares for $35m) is a filer error and is excluded
    assert not any("CALIFORNIA STATE TEACHERS" in (h.filer_name or "")
                   for h in db.query(InstitutionalHolding).filter_by(ticker="NVDA"))
    assert any("45 days" in n for n in p["notes"])
    assert p["attribution"]["text"].startswith("Source: SEC (13F period 2026-06-30")
    br = next(h for h in p["top_holders"] if h["filer"] == "BlackRock, Inc.")
    assert br["prev_shares"] is not None and br["change_shares"] == br["shares"] - br["prev_shares"]


def test_reload_is_skipped(fetcher, db):
    ds = sec_13f.list_datasets()[0]
    sec_13f.load_dataset(db, ds["key"], ds["url"], TICKERS)
    assert sec_13f.load_dataset(db, ds["key"], ds["url"], TICKERS).get("skipped") is True


def test_not_loaded_is_honest(db):
    p = sec_13f.ownership_payload(db, "ZZZZ")
    assert p["status"] == "not_loaded" and p["attribution"]["agency"] == "SEC"
