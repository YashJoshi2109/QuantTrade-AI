"""Public-dataset tests: a SQLite file DB and recorded responses (no network).

Fixtures in ./fixtures were recorded from the live publishers on 2026-11-27
and trimmed (SEC FSDS 2026q3, SEC 13F data sets Mar-May / Jun-Aug 2026, NVDA
EDGAR submissions + two Form 4 XMLs, FINRA short interest / Reg SHO files,
US Treasury 2026 par curve CSV, FRED fredgraph CSVs, BLS API JSON, Ken French
5-factor daily file).  Synthetic inputs are built inline in the tests.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.models.public_data import PUBLIC_DATA_TABLES
from app.services.public_data import http, sec_common, service

FIX = Path(__file__).parent / "fixtures"

ROUTES = {
    "company_tickers.json": FIX / "company_tickers.json",
    "financial-statement-data-sets/2026q3.zip": FIX / "fsds_2026q3_sample.zip",
    "submissions/CIK0001045810.json": FIX / "submissions_nvda.json",
    "000169684126000016/wk-form4_1795470863.xml": FIX / "form4_nvda_0001696841-26-000016.xml",
    "000119764726000013/wk-form4_1793999520.xml": FIX / "form4_nvda_0001197647-26-000013.xml",
    "sec-markets-data/form-13f-data-sets": FIX / "f13_page.html",
    "01jun2026-31aug2026_form13f.zip": FIX / "f13_01jun2026-31aug2026_sample.zip",
    "01mar2026-31may2026_form13f.zip": FIX / "f13_01mar2026-31may2026_sample.zip",
    "consolidatedShortInterest": FIX / "finra_si_nvda.json",
    "CNMSshvol20261125": FIX / "regsho_CNMSshvol20261125.txt",
    "CNMSshvol20261124": FIX / "regsho_CNMSshvol20261124.txt",
    "daily-treasury-rates.csv/2026": FIX / "treasury_2026.csv",
    "api.bls.gov": FIX / "bls_cpi_unrate.json",
    "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip": FIX / "ff5_daily.zip",
    **{f"fredgraph.csv?id={s}&": FIX / f"fred_{s}.csv" for s in ("DGS10", "DGS3MO", "BAA10Y", "CPIAUCSL", "UNRATE", "DTB3")},
}


@pytest.fixture
def fetcher():
    f = http.FixtureFetcher(dict(ROUTES))
    http.set_fetcher(f)
    sec_common.reset_ticker_map()
    yield f
    http.set_fetcher(None)
    sec_common.reset_ticker_map()


@pytest.fixture
def Session(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'pd.db'}", connect_args={"check_same_thread": False, "timeout": 10})
    Base.metadata.create_all(eng, tables=[m.__table__ for m in PUBLIC_DATA_TABLES])
    S = sessionmaker(bind=eng)
    service.set_session_factory(S)
    yield S
    service.set_session_factory(None)
    eng.dispose()


@pytest.fixture
def db(Session):
    s = Session()
    yield s
    s.close()
