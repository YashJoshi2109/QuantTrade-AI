"""/api/v1/datasets endpoints and the copilot tool registrations (recorded data, SQLite)."""
import asyncio
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import public_data as api
from app.services.copilot import public_data_tools as PT
from app.services.copilot import tools as tools_mod
from app.services.copilot.registry import FactRegistry
from app.services.public_data import sec_13f, sec_form4, sec_fsds


@pytest.fixture(autouse=True)
def _recorded_year(monkeypatch):
    """The recorded Treasury file is 2026's: pin "today" for on-demand curve refreshes."""
    from functools import partial

    from app.services.public_data import macro
    monkeypatch.setattr(macro, "refresh_treasury", partial(macro.refresh_treasury, today=date(2026, 11, 27)))


@pytest.fixture
def client(fetcher, Session, monkeypatch):
    monkeypatch.setattr(sec_form4, "LOOKBACK_DAYS", 365 * 50)       # recorded filings stay in range
    app = FastAPI()
    app.include_router(api.router, prefix="/api/v1")
    return TestClient(app)


def test_insiders_endpoint_syncs_then_serves(client):
    r = client.get("/api/v1/datasets/insiders/NVDA")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok" and j["syncing"] is False and j["transactions"]
    assert j["attribution"]["text"].startswith("Source: SEC, as of 2026-11-23")
    assert set(j["summary"]) == {"90", "180", "365"}
    assert client.get("/api/v1/datasets/insiders/bad$sym").status_code in (400, 404)


def test_short_interest_disabled_without_flag(client, monkeypatch):
    monkeypatch.delenv("FINRA_DATA_ENABLED", raising=False)
    j = client.get("/api/v1/datasets/short-interest/NVDA").json()
    assert j["status"] == "disabled" and "finra.org/terms-of-use" in j["terms_url"]


def test_short_interest_enabled(client, monkeypatch):
    monkeypatch.setenv("FINRA_DATA_ENABLED", "1")
    j = client.get("/api/v1/datasets/short-interest/NVDA?as_of=2026-11-27").json()
    assert j["status"] in ("ok", "not_loaded")        # as_of view never triggers a refresh
    j = client.get("/api/v1/datasets/short-interest/NVDA").json()
    assert j["status"] == "ok" and j["short_interest"]["shares_short"] > 0


def test_yield_curve_endpoint(client):
    j = client.get("/api/v1/datasets/macro/yield-curve").json()
    assert j["status"] == "ok" and j["points"] and j["attribution"]["agency"] == "US Treasury"
    rf = client.get("/api/v1/datasets/macro/risk-free?tenor_years=10").json()
    assert rf["status"] == "ok" and rf["value_pct"] > 0


def test_institutional_not_loaded_is_queued(client, Session):
    j = client.get("/api/v1/datasets/institutional/AAPL").json()
    assert j["status"] == "not_loaded" and "next scheduled 13F" in j["reason"]
    db = Session()
    try:
        from app.services.public_data import service
        assert "AAPL" in service.requested(db)
    finally:
        db.close()


def test_institutional_and_pit_after_load(client, Session):
    db = Session()
    try:
        for ds in reversed(sec_13f.list_datasets()[:2]):
            sec_13f.load_dataset(db, ds["key"], ds["url"], ["AAPL", "NVDA"])
        sec_fsds.load_quarter(db, "2026q3", {"0000320193", "0001045810"})
    finally:
        db.close()
    j = client.get("/api/v1/datasets/institutional/AAPL?top=3").json()
    assert j["status"] == "ok" and len(j["top_holders"]) == 3 and j["qoq"] is not None
    p = client.get("/api/v1/datasets/fundamentals-pit/NVDA?as_of=2026-09-01&tags=NetIncomeLoss&qtrs=1").json()
    assert p["status"] == "ok" and p["values"]["NetIncomeLoss"]["form"] == "10-Q"
    none = client.get("/api/v1/datasets/fundamentals-pit/NVDA?as_of=2026-08-01&tags=NetIncomeLoss&qtrs=1").json()
    assert none["status"] == "not_loaded"                  # NVDA's 10-Q was accepted 2026-08-26


def test_tools_registered_through_registry():
    names = {t["name"] for t in tools_mod.all_tool_specs()}
    assert PT.TOOL_NAMES <= names and PT.TOOL_NAMES <= set(tools_mod.PLUGIN_TOOLS)
    for n in PT.TOOL_NAMES:
        p = tools_mod.PLUGIN_TOOLS[n]
        assert p["timeout_s"] == PT.TIMEOUT_S and p["progress"]
        assert len(p["spec"]["description"]) < 220


class _Ex:          # the handlers only need the executor for nothing beyond identity here
    pass


def test_insider_tool_fact_is_grounded(fetcher, Session, monkeypatch):
    monkeypatch.setattr(sec_form4, "LOOKBACK_DAYS", 365 * 50)
    facts, payload = asyncio.run(PT.insider_activity(_Ex(), {"ticker": "nvda"}))
    assert facts[0].id == "pub:insiders:NVDA" and facts[0].as_of == "2026-11-23"
    reg = FactRegistry()
    reg.add_all(facts)
    s = payload["summary"]["365"]
    assert float(s["sell_value"]) in reg.numeric_values()
    assert facts[0].ui()["snippet"].startswith("Source: SEC")


def test_tool_errors_are_lookup_errors(fetcher, Session, monkeypatch):
    monkeypatch.delenv("FINRA_DATA_ENABLED", raising=False)
    with pytest.raises(LookupError, match="switched off"):
        asyncio.run(PT.short_interest(_Ex(), {"ticker": "NVDA"}))
    with pytest.raises(LookupError, match="not loaded"):
        asyncio.run(PT.pit_fundamentals(_Ex(), {"ticker": "NVDA", "as_of": "2020-01-01"}))
    with pytest.raises(LookupError):
        asyncio.run(PT.institutional_ownership(_Ex(), {"ticker": "NVDA"}))


def test_curve_tool(fetcher, Session):
    facts, payload = asyncio.run(PT.treasury_yield_curve(_Ex(), {}))
    assert facts[0].id.startswith("pub:curve:") and payload["spreads"]["10y_2y_bp"] is not None


def test_scheduled_jobs_run_offline(fetcher, Session, monkeypatch):
    from app.services.public_data import service
    monkeypatch.setenv("PUBLIC_DATA_MAX_UNIVERSE", "2")
    monkeypatch.setattr(service, "universe", lambda extra=(): ["NVDA", "AAPL"])
    res = service.job_fsds_daily(today=date(2026, 11, 27))
    assert res["2026q3"]["rows"] > 0 and "unavailable" in res["2026q2"]
    assert service.job_finra_daily()["skipped"].startswith("FINRA_DATA_ENABLED")
    assert "ff5" in service.job_ff_weekly()
    out = service.job_13f_daily()
    assert set(out) == {"01jun2026-31aug2026", "01mar2026-31may2026"}
