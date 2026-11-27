"""FINRA short interest + Reg SHO short-sale volume (recorded NVDA responses)."""
import json
from datetime import date, datetime, timezone

from app.services.public_data import finra, sources

from .conftest import FIX


def test_parse_short_interest_publication_lag():
    rows = finra.parse_short_interest(json.loads((FIX / "finra_si_nvda.json").read_text()))
    r = next(x for x in rows if x["settlement_date"] == "2026-10-30")
    assert r["current_short"] == 279579505 and r["days_to_cover"] == 2.8
    # 7 business days after Fri 2026-10-30 = Tue 2026-11-10, 18:00 ET = 23:00 UTC
    assert r["available_at"] == datetime(2026, 11, 10, 23, 0, tzinfo=timezone.utc)


def test_parse_regsho():
    text = (FIX / "regsho_CNMSshvol20261125.txt").read_text()
    rows = finra.parse_regsho(text)
    nv = next(r for r in rows if r["symbol"] == "NVDA")
    assert nv["trade_date"] == "2026-11-25" and nv["short_volume"] == 62739216.368559
    assert nv["total_volume"] == 164628520.890395
    assert finra.parse_regsho("garbage") == []


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("FINRA_DATA_ENABLED", raising=False)
    assert sources.enabled("finra_si") is False
    d = sources.disabled_payload("finra_si")
    assert d["status"] == "disabled" and d["terms_url"] == "https://www.finra.org/terms-of-use"


def test_refresh_and_payload(fetcher, db, monkeypatch):
    monkeypatch.setenv("FINRA_DATA_ENABLED", "1")
    assert finra.refresh_short_interest(db, "NVDA", today=date(2026, 11, 27)) == 9
    finra.refresh_regsho(db, ["NVDA"], today=date(2026, 11, 25), days=2)
    p = finra.short_payload(db, "NVDA", as_of=datetime(2026, 11, 27, 23, tzinfo=timezone.utc))
    assert p["status"] == "ok"
    si = p["short_interest"]
    # 2026-11-13 settlement is public from 2026-11-24 (7 business days)
    assert si["settlement_date"] == "2026-11-13" and si["shares_short"] == 305326286
    days = {d["date"]: d for d in p["short_volume"]["days"]}
    assert set(days) == {"2026-11-24", "2026-11-25"}
    assert days["2026-11-25"]["short_ratio_pct"] == round(62739216.368559 / 164628520.890395 * 100, 2)
    early = finra.short_payload(db, "NVDA", as_of=datetime(2026, 11, 20, tzinfo=timezone.utc))
    assert early["short_interest"]["settlement_date"] == "2026-10-30"
    assert p["attribution"]["agency"] == "FINRA" and "terms_url" in p["attribution"]
