"""Treasury par curve, FRED, BLS, Fama-French parsing + reads + factor regression."""
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from app.services.public_data import macro

from .conftest import FIX


def test_treasury_csv(fetcher, db):
    n = macro.refresh_treasury(db, today=datetime(2026, 11, 27).date())
    assert n > 1000
    c = macro.yield_curve(db)
    assert c["status"] == "ok" and c["date"] == "2026-11-27"
    by = {p["tenor"]: p["yield_pct"] for p in c["points"]}
    assert by["10Y"] == 4.94 and by["2Y"] == 4.69 and by["3M"] == 4.35 and by["1.5M"] == 4.28
    assert c["spreads"] == {"10y_2y_bp": 25.0, "10y_3m_bp": 59.0} and c["inverted_10y_3m"] is False
    assert [x["label"] for x in c["comparisons"]] == ["30d ago"]          # 2026 file only: no 1y-ago curve
    assert c["attribution"]["text"] == "Source: US Treasury, as of 2026-11-27"
    # point in time: the 11/27 curve is published at 18:00 ET
    pit = macro.yield_curve(db, as_of=datetime(2026, 11, 27, 20, tzinfo=timezone.utc))
    assert pit["date"] == "2026-11-25"


def test_risk_free_interpolation(fetcher, db):
    macro.refresh_treasury(db, today=datetime(2026, 11, 27).date())
    rf = macro.risk_free_pct(db, 10)
    assert rf["value_pct"] == 4.94 and rf["series"] == "UST_10Y"
    rf8 = macro.risk_free_pct(db, 8.5)
    assert rf8["value_pct"] == round(4.82 + (4.94 - 4.82) * 1.5 / 3, 4) and "interpolated" in rf8["series"]


def test_fredgraph_and_restricted_series(fetcher, db):
    macro.refresh_fred(db, ["DGS10", "BAA10Y", "CPIAUCSL"], start="2026-01-01")
    s = macro.series(db, ["DGS10", "BAA10Y", "CPIAUCSL"])
    assert s["DGS10"]["latest"] == {"date": "2026-11-24", "value": 4.91}
    assert s["BAA10Y"]["status"] == "restricted"                     # Moody's: not displayed
    assert s["CPIAUCSL"]["latest"]["date"] == "2026-10-01"
    full = macro.series(db, ["BAA10Y"], include_restricted=True)
    assert full["BAA10Y"]["latest"]["value"] == 1.61


def test_monthly_release_lag_is_conservative():
    rows = macro.parse_fredgraph_csv("observation_date,CPIAUCSL\n2026-10-01,337.476\n", "CPIAUCSL")
    assert rows[0]["available_at"] == datetime(2026, 11, 15, 13, 30, tzinfo=timezone.utc)


def test_bls_json():
    rows = macro.parse_bls_json((FIX / "bls_cpi_unrate.json").read_bytes())
    cpi = {r["obs_date"]: r["value"] for r in rows if r["series_id"] == "BLS_CUUR0000SA0"}
    assert cpi["2026-10-01"] == 337.511
    assert any(r["series_id"] == "BLS_LNS14000000" for r in rows)


def test_ff5_zip():
    rows = macro.parse_ff5_zip(FIX / "ff5_daily.zip")
    last = [r for r in rows if r["obs_date"] == "2026-09-30"]
    assert {r["series_id"]: r["value"] for r in last} == {"FF5_MKT_RF": -0.26, "FF5_SMB": 0.10, "FF5_HML": -0.88,
                                                          "FF5_RMW": -0.35, "FF5_CMA": 0.19, "FF5_RF": 0.01}
    assert last[0]["available_at"] == datetime(2026, 10, 31, 23, 59, 59, tzinfo=timezone.utc)


def test_factor_regression_recovers_betas():
    rng = np.random.default_rng(7)
    idx = pd.bdate_range("2024-01-01", periods=500)
    f = pd.DataFrame(rng.normal(0, 0.01, (500, 5)), index=idx,
                     columns=["FF5_MKT_RF", "FF5_SMB", "FF5_HML", "FF5_RMW", "FF5_CMA"])
    f["FF5_RF"] = 0.0001
    true = np.array([1.3, -0.2, 0.5, 0.1, -0.3])
    r = f["FF5_RF"] + 0.0002 + f.iloc[:, :5].to_numpy() @ true + rng.normal(0, 0.002, 500)
    res = macro.factor_regression(pd.Series(r, index=idx), f, "ff5")
    c = res["coefficients"]
    assert abs(c["mkt_rf"]["coef"] - 1.3) < 0.05 and c["mkt_rf"]["t_stat"] > 10
    assert abs(c["hml"]["coef"] - 0.5) < 0.05 and res["observations"] == 500 and res["r_squared"] > 0.9
    ff3 = macro.factor_regression(pd.Series(r, index=idx), f, "ff3")
    assert set(ff3["coefficients"]) == {"alpha", "mkt_rf", "smb", "hml"}
    with pytest.raises(LookupError):
        macro.factor_regression(pd.Series(r[:10], index=idx[:10]), f, "ff5")
