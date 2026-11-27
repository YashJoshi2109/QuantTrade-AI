"""Data access for the fundamentals engine.

``FundamentalsData`` is the interface the analysis layer needs; tests use an
in-memory implementation with fixture companyfacts (no network).

``LiveFundamentalsData`` reads SEC companyfacts / submissions through
``app.services.sec_edgar_service`` (S3-cached, SEC rate limits respected) and
FX rates from FRED.  Normalised statements are cached in-process.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional, Protocol, Tuple

from app.services.fundamentals.xbrl import Statements, normalize_companyfacts

logger = logging.getLogger(__name__)

CACHE_TTL_S = 6 * 3600

# FRED H.10 daily FX series: (series id, quoted as "per USD" (True) or "USD per unit" (False))
FRED_FX = {
    "TWD": ("DEXTAUS", True), "JPY": ("DEXJPUS", True), "KRW": ("DEXKOUS", True), "CNY": ("DEXCHUS", True),
    "CAD": ("DEXCAUS", True), "CHF": ("DEXSZUS", True), "INR": ("DEXINUS", True), "HKD": ("DEXHKUS", True),
    "EUR": ("DEXUSEU", False), "GBP": ("DEXUSUK", False), "AUD": ("DEXUSAL", False),
}


class FundamentalsData(Protocol):
    async def statements(self, ticker: str) -> Optional[Statements]: ...

    async def submissions(self, ticker: str) -> Optional[Dict[str, Any]]: ...

    async def fx_usd_per_unit(self, currency: str) -> Optional[Dict[str, Any]]: ...


class LiveFundamentalsData:
    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[float, Any]] = {}

    def _get(self, key: str):
        hit = self._cache.get(key)
        if hit and time.time() - hit[0] < CACHE_TTL_S:
            return hit[1]
        return None

    def _put(self, key: str, val: Any) -> None:
        self._cache[key] = (time.time(), val)

    async def statements(self, ticker: str) -> Optional[Statements]:
        key = f"st:{ticker.upper()}"
        hit = self._get(key)
        if hit is not None:
            return hit

        def load() -> Optional[Statements]:
            from app.services import sec_edgar_service as sec
            cik = sec.get_cik(ticker)
            if not cik:
                return None
            facts = sec.get_company_facts(cik)
            if not facts:
                return None
            st = normalize_companyfacts(facts, ticker, cik)
            st.notes.append(f"companyfacts retrieved {facts.get('_cached_at') or 'now'}")
            return st

        st = await asyncio.to_thread(load)
        if st is not None:
            self._put(key, st)
        return st

    async def submissions(self, ticker: str) -> Optional[Dict[str, Any]]:
        key = f"sub:{ticker.upper()}"
        hit = self._get(key)
        if hit is not None:
            return hit

        def load():
            from app.services import sec_edgar_service as sec
            cik = sec.get_cik(ticker)
            if not cik:
                return None
            sub = sec.get_submissions(cik)
            if not sub:
                return None
            return {k: sub.get(k) for k in ("cik", "name", "sic", "sicDescription", "fiscalYearEnd", "category")}

        sub = await asyncio.to_thread(load)
        if sub is not None:
            self._put(key, sub)
        return sub

    async def fx_usd_per_unit(self, currency: str) -> Optional[Dict[str, Any]]:
        currency = currency.upper()
        if currency == "USD":
            return {"rate": 1.0, "as_of": None, "source": "identity"}
        spec = FRED_FX.get(currency)
        if spec is None:
            return None
        key = f"fx:{currency}"
        hit = self._get(key)
        if hit is not None:
            return hit
        import httpx
        from app.config import settings
        api_key = getattr(settings, "FRED_API_KEY", None)
        if not api_key:
            return None
        series, per_usd = spec
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get("https://api.stlouisfed.org/fred/series/observations", params={
                "series_id": series, "api_key": api_key, "file_type": "json", "sort_order": "desc", "limit": 10})
            r.raise_for_status()
            obs = [o for o in r.json().get("observations", []) if o.get("value") not in (".", None, "")]
        if not obs:
            return None
        raw = float(obs[0]["value"])
        rate = 1 / raw if per_usd else raw
        out = {"rate": rate, "quoted": raw, "quote_convention": f"{currency} per USD" if per_usd else f"USD per {currency}",
               "as_of": obs[0]["date"], "source": f"FRED {series}"}
        self._put(key, out)
        return out


_live: Optional[LiveFundamentalsData] = None


def live_data() -> LiveFundamentalsData:
    global _live
    if _live is None:
        _live = LiveFundamentalsData()
    return _live
