import logging
from typing import Dict, Optional

import finviz
from fastapi import APIRouter, HTTPException

from app.services.ticker_validation import normalize_ticker

router = APIRouter()
logger = logging.getLogger(__name__)


_FILTER_FIELDS = (
    ("sec_", "Sector"),
    ("industry_", "Industry"),  # current Finviz markup
    ("ind_", "Industry"),       # older markup (what the finviz package expects)
    ("geo_", "Country"),
    ("exch_", "Exchange"),
)
_HEADER_LINK_SELECTORS = (
    "div.quote-header_categories a",  # current Finviz markup
    "div.quote-links a.tab-link",     # older markup
)


def _classify_quote_links(page) -> Dict[str, str]:
    """Map Finviz header links to Sector/Industry/Country by their href filter.

    The `finviz` package assigns these positionally and only recognises
    ``f=ind_`` for industry. Finviz now emits ``f=industry_``, so the industry
    link is dropped and values shift (Industry="USA", Country=""). The
    screener filter in each href says which field the link is.
    """
    out: Dict[str, str] = {}
    if page is None:
        return out
    for selector in _HEADER_LINK_SELECTORS:
        try:
            links = page.cssselect(selector)
        except Exception:
            continue
        for link in links:
            href = link.attrib.get("href", "")
            text = link.text_content().strip()
            if not text or "f=" not in href:
                continue
            filt = href.split("f=", 1)[1].split("&", 1)[0]
            for prefix, field in _FILTER_FIELDS:
                if filt.startswith(prefix):
                    out.setdefault(field, text)
                    break
        if out:
            break
    return out


def _fix_header_fields(data: Dict, page) -> Dict:
    """Defensively correct Sector/Industry/Country in a finviz.get_stock() dict."""
    mapped = _classify_quote_links(page)
    if mapped:
        for key in ("Sector", "Industry", "Country"):
            data[key] = mapped.get(key, "")
        if mapped.get("Exchange") and not data.get("Exchange"):
            data["Exchange"] = mapped["Exchange"]
    return data


def _get_cached_page(symbol: str) -> Optional[object]:
    try:
        from finviz import main_func
        return main_func.STOCK_PAGE.get(symbol)
    except Exception:
        return None


def _is_not_found(exc: Exception) -> bool:
    resp = getattr(exc, "response", None)
    status = getattr(resp, "status_code", None) or getattr(resp, "status", None)
    if status == 404:
        return True
    return "404" in str(exc) or "not found" in str(exc).lower()


@router.get("/finviz/{symbol}", tags=["finviz"])
def get_finviz_data(symbol: str) -> Dict:
    """
    Fetches stock data for a given symbol from Finviz and returns it as JSON.
    Unknown tickers return 404; upstream failures return 502.
    """
    sym = normalize_ticker(symbol)
    try:
        data = finviz.get_stock(sym)
    except Exception as e:
        if _is_not_found(e):
            raise HTTPException(status_code=404, detail=f"Unknown ticker: {sym}")
        logger.warning("Finviz fetch failed for %s: %s", sym, e)
        raise HTTPException(status_code=502, detail="Finviz upstream error")

    # An unknown ticker can also come back as an empty/placeholder page.
    if not data or not (data.get("Company") or data.get("Price")):
        raise HTTPException(status_code=404, detail=f"Unknown ticker: {sym}")

    return _fix_header_fields(dict(data), _get_cached_page(sym))
