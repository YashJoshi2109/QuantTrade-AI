"""US Treasury par yield curve, FRED, BLS and Fama-French factors.

Series ids stored in ``macro_observations``:

* ``UST_1M`` ... ``UST_30Y``  Treasury daily par yield curve (percent).
  https://home.treasury.gov/resource-center/data-chart-center/interest-rates
  Published each business day around 18:00 ET -> ``available_at`` = date 18:00 ET.
* FRED ``DGS1MO DGS3MO DGS6MO DGS1 DGS2 DGS5 DGS10 DGS20 DGS30 DTB3`` (H.15,
  percent; FRED posts them the next business day -> available_at = date + 1
  business day, 18:00 ET), ``CPIAUCSL UNRATE`` (BLS via FRED, monthly),
  ``BAA10Y`` (Moody's Baa minus 10Y; Moody's copyright: internal use only,
  never displayed -- see sources.py).  With FRED_API_KEY the FRED API is used,
  otherwise the keyless fredgraph CSV.
* BLS ``BLS_CUUR0000SA0`` (CPI-U, NSA) and ``BLS_LNS14000000`` (unemployment
  rate, SA) from the BLS public API v2 (no key: 25 queries/day).
* ``FF5_MKT_RF FF5_SMB FF5_HML FF5_RMW FF5_CMA FF5_RF`` Fama-French 5 factors
  (2x3), daily, percent, Kenneth R. French Data Library (updated monthly with
  ~1 month lag -> available_at = end of the month after the observation).

Monthly macro releases (CPI, unemployment) have no release timestamp in these
feeds: available_at = the 15th of the following month for CPI and the 10th
for unemployment, 08:30 ET (both are released on or before those days; a
conservative PIT bound, never earlier than the real release).
"""
from __future__ import annotations

import csv
import io
import json
import logging
import math
import os
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.models.public_data import MacroObservation
from app.services.public_data import store
from app.services.public_data.http import FetchError, get_fetcher
from app.services.public_data.sec_common import ET, add_business_days, date_end_of_day_et

logger = logging.getLogger(__name__)

TREASURY_URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
                "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}"
                "&page&_format=csv")
FREDGRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"
FRED_API = "https://api.stlouisfed.org/fred/series/observations"
BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
FF5_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"

TREASURY_COLS = {"1 Mo": "UST_1M", "1.5 Month": "UST_1_5M", "2 Mo": "UST_2M", "3 Mo": "UST_3M", "4 Mo": "UST_4M",
                 "6 Mo": "UST_6M", "1 Yr": "UST_1Y", "2 Yr": "UST_2Y", "3 Yr": "UST_3Y", "5 Yr": "UST_5Y",
                 "7 Yr": "UST_7Y", "10 Yr": "UST_10Y", "20 Yr": "UST_20Y", "30 Yr": "UST_30Y"}
TENOR_YEARS = {"UST_1M": 1 / 12, "UST_1_5M": 1.5 / 12, "UST_2M": 2 / 12, "UST_3M": 0.25, "UST_4M": 4 / 12,
               "UST_6M": 0.5, "UST_1Y": 1, "UST_2Y": 2, "UST_3Y": 3, "UST_5Y": 5, "UST_7Y": 7, "UST_10Y": 10,
               "UST_20Y": 20, "UST_30Y": 30}
FRED_DAILY = ["DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS5", "DGS10", "DGS20", "DGS30", "DTB3", "BAA10Y"]
FRED_MONTHLY = {"CPIAUCSL": 15, "UNRATE": 10}
FRED_LABELS = {"DGS1MO": "1-month Treasury CMT", "DGS3MO": "3-month Treasury CMT", "DGS6MO": "6-month Treasury CMT",
               "DGS1": "1-year Treasury CMT", "DGS2": "2-year Treasury CMT", "DGS5": "5-year Treasury CMT",
               "DGS10": "10-year Treasury CMT", "DGS20": "20-year Treasury CMT", "DGS30": "30-year Treasury CMT",
               "DTB3": "3-month T-bill (secondary market)", "CPIAUCSL": "CPI-U, seasonally adjusted (index)",
               "UNRATE": "Unemployment rate (%)", "BAA10Y": "Moody's Baa corporate minus 10Y Treasury (%)"}
DISPLAY_RESTRICTED = {"BAA10Y"}
BLS_SERIES = {"CUUR0000SA0": ("BLS_CUUR0000SA0", 15), "LNS14000000": ("BLS_LNS14000000", 10)}
FF5_COLS = {"Mkt-RF": "FF5_MKT_RF", "SMB": "FF5_SMB", "HML": "FF5_HML", "RMW": "FF5_RMW", "CMA": "FF5_CMA",
            "RF": "FF5_RF"}


def _f(s: str) -> Optional[float]:
    s = (s or "").strip()
    if s in ("", ".", "N/A", "NA"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _monthly_available(obs: str, day: int) -> datetime:
    y, m = int(obs[:4]), int(obs[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return datetime(y, m, day, 8, 30, tzinfo=ET).astimezone(timezone.utc)


# ── parsers ────────────────────────────────────────────────────────────────

def parse_treasury_csv(text: str) -> List[Dict[str, Any]]:
    rd = csv.DictReader(io.StringIO(text))
    out = []
    for r in rd:
        d = r.get("Date") or ""
        try:
            iso = datetime.strptime(d, "%m/%d/%Y").date().isoformat()
        except ValueError:
            continue
        for col, sid in TREASURY_COLS.items():
            v = _f(r.get(col, ""))
            if v is not None:
                out.append({"series_id": sid, "obs_date": iso, "value": v,
                            "available_at": date_end_of_day_et(iso),
                            "source": "US Treasury daily par yield curve"})
    return out


def parse_fredgraph_csv(text: str, sid: str) -> List[Dict[str, Any]]:
    rd = csv.reader(io.StringIO(text))
    next(rd, None)
    out = []
    for row in rd:
        if len(row) < 2:
            continue
        v = _f(row[1])
        if v is None:
            continue
        out.append(_fred_row(sid, row[0][:10], v))
    return out


def _fred_row(sid: str, obs: str, v: float) -> Dict[str, Any]:
    if sid in FRED_MONTHLY:
        avail = _monthly_available(obs, FRED_MONTHLY[sid])
    else:
        avail = date_end_of_day_et(add_business_days(date.fromisoformat(obs), 1).isoformat())
    return {"series_id": sid, "obs_date": obs, "value": v, "available_at": avail,
            "source": f"FRED {sid}" + (" (Moody's; internal use only)" if sid in DISPLAY_RESTRICTED else "")}


def parse_bls_json(raw: bytes) -> List[Dict[str, Any]]:
    data = json.loads(raw)
    if data.get("status") != "REQUEST_SUCCEEDED":
        raise FetchError(f"BLS API: {data.get('status')} {data.get('message')}")
    out = []
    for s in (data.get("Results") or {}).get("series") or []:
        spec = BLS_SERIES.get(s.get("seriesID"))
        if not spec:
            continue
        sid, day = spec
        for o in s.get("data") or []:
            p = o.get("period") or ""
            if not p.startswith("M") or p == "M13":
                continue
            obs = f"{o['year']}-{p[1:]}-01"
            v = _f(o.get("value"))
            if v is None:
                continue
            out.append({"series_id": sid, "obs_date": obs, "value": v, "available_at": _monthly_available(obs, day),
                        "source": f"BLS {s['seriesID']}"})
    return out


def parse_ff5_zip(path_or_bytes) -> List[Dict[str, Any]]:
    z = zipfile.ZipFile(path_or_bytes if not isinstance(path_or_bytes, bytes) else io.BytesIO(path_or_bytes))
    text = z.read(z.namelist()[0]).decode("latin-1")
    lines = text.splitlines()
    hi = next((i for i, l in enumerate(lines) if l.replace(" ", "").startswith(",Mkt-RF")), None)
    if hi is None:
        raise FetchError("Fama-French file has no header")
    head = [h.strip() for h in lines[hi].split(",")]
    out = []
    for l in lines[hi + 1:]:
        p = [x.strip() for x in l.split(",")]
        if not p or len(p[0]) != 8 or not p[0].isdigit():
            if out:
                break             # daily block ended
            continue
        obs = f"{p[0][:4]}-{p[0][4:6]}-{p[0][6:8]}"
        y, m = int(p[0][:4]), int(p[0][4:6])
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        nny, nnm = (ny + 1, 1) if nm == 12 else (ny, nm + 1)
        avail = datetime(nny, nnm, 1, 0, 0, tzinfo=timezone.utc) - timedelta(seconds=1)
        for col, val in zip(head[1:], p[1:]):
            sid = FF5_COLS.get(col)
            v = _f(val)
            if sid and v is not None:
                out.append({"series_id": sid, "obs_date": obs, "value": v, "available_at": avail,
                            "source": "Kenneth R. French Data Library, F-F 5 factors (2x3) daily"})
    return out


# ── refresh ────────────────────────────────────────────────────────────────

def _save(db: Session, rows: List[Dict[str, Any]], dataset: str, key: str) -> int:
    n = 0
    by_series: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        by_series.setdefault(r["series_id"], []).append(r)
    for sid, rs in by_series.items():
        n += store.upsert(db, MacroObservation, rs, ("series_id", "obs_date"))
    store.mark_load(db, dataset, key, rows=n)
    return n


def refresh_treasury(db: Session, today: Optional[date] = None, years: int = 1) -> int:
    today = today or date.today()
    n = 0
    for y in range(today.year - years + 1, today.year + 1):
        text = get_fetcher().get(TREASURY_URL.format(year=y), ttl_h=None if y < today.year else 3,
                                 accept="text/csv").decode("utf-8", errors="replace")
        n += _save(db, parse_treasury_csv(text), "treasury", str(y))
    return n


def refresh_fred(db: Session, series: Optional[Sequence[str]] = None, start: str = "2015-01-01") -> int:
    from app.config import settings
    key = getattr(settings, "FRED_API_KEY", None)
    n = 0
    for sid in series or (FRED_DAILY + list(FRED_MONTHLY)):
        try:
            if key:
                url = f"{FRED_API}?series_id={sid}&file_type=json&observation_start={start}"
                obs = json.loads(get_fetcher().get(url, ttl_h=6, accept="application/json",
                                                   secrets={"api_key": key})).get("observations", [])
                rows = [_fred_row(sid, o["date"], v) for o in obs if (v := _f(o.get("value"))) is not None]
            else:
                text = get_fetcher().get(FREDGRAPH.format(sid=sid, start=start), ttl_h=6, accept="text/csv")
                rows = parse_fredgraph_csv(text.decode("utf-8", errors="replace"), sid)
        except FetchError as e:
            logger.info("FRED %s unavailable: %s", sid, e)
            continue
        n += _save(db, rows, "fred", sid)
    return n


def refresh_bls(db: Session, today: Optional[date] = None) -> int:
    today = today or date.today()
    body = {"seriesid": list(BLS_SERIES), "startyear": str(today.year - 2), "endyear": str(today.year)}
    key = os.getenv("BLS_API_KEY")
    raw = get_fetcher().get(BLS_URL, ttl_h=12, method="POST", json_body=body, accept="application/json",
                            secrets={"registrationkey": key} if key else None)
    return _save(db, parse_bls_json(raw), "bls", "cpi_unrate")


def refresh_ff(db: Session) -> int:
    path = get_fetcher().download(FF5_URL, ttl_h=24 * 7)
    return _save(db, parse_ff5_zip(path), "ff", "ff5_daily")


# ── reads ──────────────────────────────────────────────────────────────────

def _latest(db: Session, sid: str, as_of: Optional[datetime] = None) -> Optional[MacroObservation]:
    q = db.query(MacroObservation).filter(MacroObservation.series_id == sid)
    if as_of is not None:
        q = q.filter(MacroObservation.available_at <= as_of)
    return q.order_by(MacroObservation.obs_date.desc()).first()


def yield_curve(db: Session, as_of: Optional[datetime] = None, compare_days: Sequence[int] = (30, 365)
                ) -> Dict[str, Any]:
    from app.services.public_data.sources import attribution
    last = _latest(db, "UST_10Y", as_of)
    if last is None:
        return {"status": "not_loaded", "points": [], "attribution": attribution("treasury", None)}
    d = last.obs_date

    def curve(day: str) -> List[Dict[str, Any]]:
        rows = db.query(MacroObservation).filter(MacroObservation.obs_date == day,
                                                 MacroObservation.series_id.in_(list(TREASURY_COLS.values()))).all()
        pts = [{"tenor": r.series_id[4:].replace("_", "."), "years": TENOR_YEARS[r.series_id], "yield_pct": r.value}
               for r in rows]
        return sorted(pts, key=lambda p: p["years"])

    pts = curve(d)
    comps = []
    for days in compare_days:
        target = (date.fromisoformat(d) - timedelta(days=days)).isoformat()
        r = (db.query(MacroObservation).filter(MacroObservation.series_id == "UST_10Y",
                                               MacroObservation.obs_date <= target)
             .order_by(MacroObservation.obs_date.desc()).first())
        if r is not None:
            comps.append({"label": f"{days}d ago", "date": r.obs_date, "points": curve(r.obs_date)})
    by = {p["tenor"]: p["yield_pct"] for p in pts}
    spreads = {}
    if "10Y" in by and "2Y" in by:
        spreads["10y_2y_bp"] = round((by["10Y"] - by["2Y"]) * 100, 1)
    if "10Y" in by and "3M" in by:
        spreads["10y_3m_bp"] = round((by["10Y"] - by["3M"]) * 100, 1)
    return {"status": "ok", "date": d, "points": pts, "comparisons": comps, "spreads": spreads,
            "inverted_10y_3m": (spreads.get("10y_3m_bp") or 0) < 0 if "10y_3m_bp" in spreads else None,
            "attribution": attribution("treasury", d)}


def risk_free_pct(db: Session, tenor_years: float = 10.0, as_of: Optional[datetime] = None
                  ) -> Optional[Dict[str, Any]]:
    """Par yield at ``tenor_years`` (linear interpolation between curve points)."""
    last = _latest(db, "UST_10Y", as_of)
    if last is None:
        return None
    rows = db.query(MacroObservation).filter(MacroObservation.obs_date == last.obs_date,
                                             MacroObservation.series_id.in_(list(TREASURY_COLS.values()))).all()
    pts = sorted((TENOR_YEARS[r.series_id], r.value, r.series_id) for r in rows)
    if not pts:
        return None
    if tenor_years <= pts[0][0]:
        v, how = pts[0][1], pts[0][2]
    elif tenor_years >= pts[-1][0]:
        v, how = pts[-1][1], pts[-1][2]
    else:
        v, how = None, None
        for (x0, y0, s0), (x1, y1, s1) in zip(pts, pts[1:]):
            if x0 <= tenor_years <= x1:
                v = y0 if x1 == x0 else y0 + (y1 - y0) * (tenor_years - x0) / (x1 - x0)
                how = s0 if tenor_years == x0 else (s1 if tenor_years == x1 else f"interpolated {s0}-{s1}")
                break
    return {"value_pct": round(v, 4), "tenor_years": tenor_years, "date": last.obs_date, "series": how,
            "source": f"US Treasury daily par yield curve ({how}), {last.obs_date}"}


def series(db: Session, ids: Sequence[str], start: Optional[str] = None, as_of: Optional[datetime] = None,
           include_restricted: bool = False) -> Dict[str, Any]:
    out = {}
    for sid in ids:
        if sid in DISPLAY_RESTRICTED and not include_restricted:
            out[sid] = {"status": "restricted", "reason": "Moody's copyright: not displayed"}
            continue
        q = db.query(MacroObservation).filter(MacroObservation.series_id == sid)
        if start:
            q = q.filter(MacroObservation.obs_date >= start)
        if as_of is not None:
            q = q.filter(MacroObservation.available_at <= as_of)
        rows = q.order_by(MacroObservation.obs_date).all()
        out[sid] = {"label": FRED_LABELS.get(sid) or sid, "source": rows[-1].source if rows else None,
                    "observations": [{"date": r.obs_date, "value": r.value} for r in rows],
                    "latest": ({"date": rows[-1].obs_date, "value": rows[-1].value} if rows else None)}
    return out


def stored_rate_series(ids: Sequence[str], start: str, end: str) -> Optional[Tuple[str, Dict[str, float]]]:
    """First of ``ids`` with stored observations in [start, end] -> (series id, {date: value}).
    Used by the quant / valuation engines as a keyless risk-free source.  None
    when there is no database or no rows (never raises)."""
    try:
        from app.services.public_data.service import session_factory
        SessionLocal = session_factory()
        if SessionLocal is None:
            return None
        db = SessionLocal()
        try:
            for sid in ids:
                rows = (db.query(MacroObservation.obs_date, MacroObservation.value)
                        .filter(MacroObservation.series_id == sid, MacroObservation.obs_date >= start,
                                MacroObservation.obs_date <= end).order_by(MacroObservation.obs_date).all())
                if rows:
                    return sid, {d: v for d, v in rows if v is not None}
        finally:
            db.close()
    except Exception as e:                      # missing table / DB down: caller falls back
        logger.info("stored rate series unavailable: %s", e)
    return None


def factor_frame(db: Session, start: str, end: str, as_of: Optional[datetime] = None):
    """Daily FF5 factors (decimal returns) as a pandas DataFrame indexed by date."""
    import pandas as pd
    q = db.query(MacroObservation).filter(MacroObservation.series_id.in_(list(FF5_COLS.values())),
                                          MacroObservation.obs_date >= start, MacroObservation.obs_date <= end)
    if as_of is not None:
        q = q.filter(MacroObservation.available_at <= as_of)
    rows = q.all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame([(r.obs_date, r.series_id, r.value / 100.0) for r in rows], columns=["date", "sid", "v"])
    df = df.pivot_table(index="date", columns="sid", values="v")
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def factor_regression(returns, factors, model: str = "ff5") -> Dict[str, Any]:
    """OLS of daily excess returns on FF3 or FF5 factors (decimal).  Returns
    betas with Newey-West (5 lags) t-stats, R^2 and annualised alpha (252 days)."""
    import numpy as np
    import pandas as pd
    cols = ["FF5_MKT_RF", "FF5_SMB", "FF5_HML"] + (["FF5_RMW", "FF5_CMA"] if model == "ff5" else [])
    df = pd.concat([returns.rename("r"), factors], axis=1, join="inner").dropna(subset=["r", "FF5_RF", *cols])
    n = len(df)
    if n < 60:
        raise LookupError(f"only {n} overlapping trading days of returns and factors (need 60)")
    y = (df["r"] - df["FF5_RF"]).to_numpy()
    X = np.column_stack([np.ones(n), df[cols].to_numpy()])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    k = X.shape[1]
    xtx_inv = np.linalg.inv(X.T @ X)
    # Newey-West HAC covariance, 5 lags
    L = 5
    u = X * resid[:, None]
    S = u.T @ u
    for lag in range(1, L + 1):
        w = 1 - lag / (L + 1)
        g = u[lag:].T @ u[:-lag]
        S += w * (g + g.T)
    cov = xtx_inv @ S @ xtx_inv * n / (n - k)
    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - float((resid ** 2).sum()) / ss_tot if ss_tot > 0 else None
    names = ["alpha"] + [c.replace("FF5_", "").lower() for c in cols]
    coefs = {nm: {"coef": round(float(b), 6), "t_stat": round(float(b / s), 2) if s > 0 else None}
             for nm, b, s in zip(names, beta, se)}
    return {"model": model.upper(), "observations": n, "start": df.index[0].date().isoformat(),
            "end": df.index[-1].date().isoformat(), "coefficients": coefs,
            "alpha_annualised_pct": round(float(beta[0]) * 252 * 100, 2), "r_squared": round(r2, 4) if r2 is not None else None,
            "method": "OLS of daily excess return on Fama-French factors; Newey-West (5 lags) t-stats; "
                      "alpha annualised x252"}
