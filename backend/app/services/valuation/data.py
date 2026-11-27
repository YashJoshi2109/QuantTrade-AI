"""Live data adapters for the valuation engine (network lives only here).

  financials     SEC XBRL companyfacts (sec_edgar_service.get_company_facts) -> parse_companyfacts,
                 or an injected FundamentalsProvider (the fundamentals engine)
  prices         daily bars via DataFetcher (yfinance auto-adjusted closes; Alpaca / Alpha Vantage fallback)
  risk_free      FRED DGS10 via the copilot macro source; US Treasury daily par yield curve CSV fallback
  fx             FRED H.10 daily exchange rates (DEXTAUS, DEXJPUS, ...)
  geo_mix        latest 10-K / 20-F XBRL instance (dimensional revenue facts)
  filings        the copilot filing search (ticker-scoped)
Results are cached in-process (financials 6h, prices 1h, rates 1h).
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from app.services.valuation.financials import CompanyFinancials, FundamentalsProvider, parse_companyfacts
from app.services.valuation.provenance import DataUnavailable, Datum

logger = logging.getLogger(__name__)

_CACHE: Dict[Tuple[str, str], Tuple[float, Any]] = {}
TTL = {"fin": 6 * 3600, "px": 3600, "rf": 3600, "fx": 3600, "geo": 6 * 3600}
PRICE_SOURCE = "daily bars via DataFetcher (yfinance auto-adjusted closes; Alpaca / Alpha Vantage fallback)"

# reporting currency -> (FRED series, quote convention). "per_usd": units of ccy per 1 USD.
FX_SERIES = {"TWD": ("DEXTAUS", "per_usd"), "JPY": ("DEXJPUS", "per_usd"), "KRW": ("DEXKOUS", "per_usd"),
             "CNY": ("DEXCHUS", "per_usd"), "INR": ("DEXINUS", "per_usd"), "CAD": ("DEXCAUS", "per_usd"),
             "CHF": ("DEXSZUS", "per_usd"), "MXN": ("DEXMXUS", "per_usd"), "BRL": ("DEXBZUS", "per_usd"),
             "EUR": ("DEXUSEU", "usd_per"), "GBP": ("DEXUSUK", "usd_per"), "AUD": ("DEXUSAL", "usd_per")}


def _cached(kind: str, key: str):
    hit = _CACHE.get((kind, key))
    if hit and time.time() - hit[0] < TTL[kind]:
        return hit[1]
    return None


def _store(kind: str, key: str, val):
    _CACHE[(kind, key)] = (time.time(), val)
    return val


class ValuationData:
    def __init__(self, sources=None, fundamentals: Optional[FundamentalsProvider] = None):
        self.sources = sources
        self.fundamentals = fundamentals

    # ── fundamentals ────────────────────────────────────────────────────────
    async def financials(self, ticker: str) -> CompanyFinancials:
        t = ticker.upper()
        hit = _cached("fin", t)
        if hit is not None:
            return hit
        if self.fundamentals is not None:
            return _store("fin", t, await self.fundamentals.company_financials(t))

        def load():
            from app.services import sec_edgar_service as sec
            cik = sec.get_cik(t)
            if not cik:
                raise DataUnavailable(f"{t}: no SEC CIK (not an SEC registrant, or an ETF/fund)")
            facts = sec.get_company_facts(cik)
            if not facts:
                raise DataUnavailable(f"{t}: SEC XBRL companyfacts unavailable for CIK {cik}")
            return parse_companyfacts(facts, t, cik)

        return _store("fin", t, await asyncio.to_thread(load))

    # ── prices ──────────────────────────────────────────────────────────────
    async def prices(self, ticker: str, years: int = 5) -> pd.Series:
        t = ticker.upper()
        key = f"{t}:{years}"
        hit = _cached("px", key)
        if hit is not None:
            return hit

        def load():
            from app.services.data_fetcher import DataFetcher
            df = DataFetcher.fetch_historical_data(t, period=f"{max(int(years), 1)}y")
            if df is None or df.empty or "close" not in df:
                raise DataUnavailable(f"{t}: no daily price history from yfinance/Alpaca/Alpha Vantage")
            idx = pd.to_datetime(df["timestamp"], utc=True).dt.tz_localize(None).dt.normalize()
            s = pd.Series(df["close"].astype(float).to_numpy(), index=pd.DatetimeIndex(idx)).dropna()
            return s[~s.index.duplicated(keep="last")].sort_index()

        return _store("px", key, await asyncio.to_thread(load))

    # ── rates ───────────────────────────────────────────────────────────────
    async def risk_free(self) -> Datum:
        hit = _cached("rf", "10y")
        if hit is not None:
            return hit
        if self.sources is not None and hasattr(self.sources, "macro"):
            try:
                facts = await self.sources.macro(["10Y_YIELD"])
                f = next((x for x in facts if x.value is not None), None)
                if f is not None:
                    return _store("rf", "10y", Datum(value=float(f.value) / 100.0, source=f.source,
                                                     as_of=f.observation_date, tag=f"{f.series} ({f.id})", unit="fraction"))
            except Exception as e:                       # fall through to Treasury
                logger.warning("FRED 10Y failed: %s", e)
        d = await asyncio.to_thread(_treasury_10y)
        if d is None:
            raise DataUnavailable("10-year Treasury yield unavailable (FRED and the US Treasury yield-curve feed both failed); "
                                  "pass rf explicitly")
        return _store("rf", "10y", d)

    async def fx(self, currency: str) -> Optional[Datum]:
        """Units of ``currency`` per 1 USD."""
        c = currency.upper()
        if c == "USD":
            return None
        spec = FX_SERIES.get(c)
        if not spec:
            return None
        hit = _cached("fx", c)
        if hit is not None:
            return hit
        obs = await _fred_latest(spec[0])
        if obs is None:
            return None
        val = obs[1] if spec[1] == "per_usd" else 1.0 / obs[1]
        return _store("fx", c, Datum(value=val, source=f"FRED {spec[0]} (H.10 noon buying rate)", as_of=obs[0],
                                     tag=spec[0], unit=f"{c} per USD",
                                     formula=None if spec[1] == "per_usd" else f"1 / {spec[0]}"))

    # ── geographic mix ─────────────────────────────────────────────────────
    async def geo_mix(self, ticker: str, fin: CompanyFinancials) -> Optional[Dict[str, Any]]:
        t = ticker.upper()
        hit = _cached("geo", t)
        if hit is not None:
            return hit or None
        try:
            res = await asyncio.to_thread(_geo_from_sec, fin)
        except Exception as e:
            logger.warning("geo mix failed for %s: %s", t, e)
            res = None
        _store("geo", t, res or {})
        return res

    # ── filings ─────────────────────────────────────────────────────────────
    async def filings(self, ticker: str, query: str, filing_types=None, limit: int = 6) -> List[Any]:
        if self.sources is None or not hasattr(self.sources, "filings"):
            return []
        return list(await self.sources.filings(ticker, query, filing_types=filing_types, limit=limit))


async def _fred_latest(series: str) -> Optional[Tuple[str, float]]:
    import httpx
    from app.config import settings
    key = getattr(settings, "FRED_API_KEY", None)
    if not key:
        return None
    async with httpx.AsyncClient(timeout=6.0) as client:
        r = await client.get("https://api.stlouisfed.org/fred/series/observations", params={
            "series_id": series, "api_key": key, "file_type": "json", "sort_order": "desc", "limit": 10})
        r.raise_for_status()
        for o in r.json().get("observations", []):
            try:
                return o["date"], float(o["value"])
            except (TypeError, ValueError):
                continue
    return None


def parse_treasury_csv(text: str) -> Optional[Datum]:
    rows = list(csv.DictReader(io.StringIO(text)))
    best = None
    for row in rows:
        v = (row.get("10 Yr") or "").strip()
        d = (row.get("Date") or "").strip()
        if not v or not d:
            continue
        try:
            dt = datetime.strptime(d, "%m/%d/%Y").date()
            val = float(v)
        except ValueError:
            continue
        if best is None or dt > best[0]:
            best = (dt, val)
    if best is None:
        return None
    return Datum(value=best[1] / 100.0, source="US Treasury daily par yield curve (10 Yr)",
                 as_of=best[0].isoformat(), tag="daily_treasury_yield_curve:10 Yr", unit="fraction")


def _treasury_10y() -> Optional[Datum]:
    import requests
    now = datetime.now(timezone.utc)
    for year in (now.year, now.year - 1):
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
               f"{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv")
        try:
            resp = requests.get(url, timeout=8, headers={"User-Agent": "QuantTrade/1.0"})
            resp.raise_for_status()
            d = parse_treasury_csv(resp.text)
            if d is not None:
                return d
        except Exception as e:
            logger.warning("Treasury yield curve fetch failed (%s): %s", year, e)
    return None


def _geo_from_sec(fin: CompanyFinancials) -> Optional[Dict[str, Any]]:
    import requests
    from app.services import sec_edgar_service as sec
    from app.services.valuation import geo
    if not fin.cik or not fin.years:
        return None
    y = fin.latest
    acc = y.accession
    if not acc:
        return None
    cik_int = str(int(fin.cik))
    base = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc.replace('-', '')}"
    idx = requests.get(f"{base}/index.json", headers=sec.SEC_HEADERS, timeout=10)
    idx.raise_for_status()
    names = [it.get("name", "") for it in idx.json().get("directory", {}).get("item", [])]
    inst = next((n for n in names if n.endswith("_htm.xml")), None) or next(
        (n for n in names if n.endswith(".xml") and not any(s in n for s in ("_cal", "_def", "_lab", "_pre", "FilingSummary"))), None)
    if not inst:
        return None
    time.sleep(0.12)
    resp = requests.get(f"{base}/{inst}", headers=sec.SEC_HEADERS, timeout=20)
    resp.raise_for_status()
    parsed = geo.parse_instance(resp.content, y.period_end, fin.currency)
    if not parsed:
        return None
    out = geo.mix(parsed, fin.currency)
    out.update(source=f"SEC XBRL instance {inst}", accession=acc, period_end=y.period_end, fiscal_year=y.fiscal_year,
               form=y.form, url=f"{base}/{inst}")
    return out
