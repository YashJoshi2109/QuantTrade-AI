"""
Options API — Option chain, expirations, and Greeks via Public.com

Public.com (needs PUBLIC_API_SECRET_KEY) is the primary source and is the only
one with Greeks. When it is not configured or fails, both endpoints fall back
to yfinance (free, no key; bid/ask/last/volume/OI/IV only, Greeks are null).
The response `source` field says which one answered.

Endpoints:
- GET /api/v1/options/{symbol}/expirations → Available expiration dates
- GET /api/v1/options/{symbol}/chain?expiration=2026-05-16 → Full option chain with Greeks
"""
import asyncio
import logging
import math
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter()


class OptionExpirationsResponse(BaseModel):
    symbol: str
    expirations: List[str]
    source: str = "public.com"


class OptionContract(BaseModel):
    symbol: str
    strike: Optional[float] = None
    bid: Optional[float] = None
    ask: Optional[float] = None
    mid: Optional[float] = None
    last: Optional[float] = None
    volume: Optional[int] = None
    open_interest: Optional[int] = None
    implied_volatility: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    rho: Optional[float] = None


class OptionChainResponse(BaseModel):
    symbol: str
    expiration: str
    calls: List[Dict[str, Any]]
    puts: List[Dict[str, Any]]
    source: str = "public.com"
    fetched_at: str


@router.get("/options/{symbol}/expirations", response_model=OptionExpirationsResponse)
async def get_option_expirations(symbol: str):
    """
    Get available option expiration dates for a symbol.

    Example:
        GET /api/v1/options/AAPL/expirations
    """
    symbol = symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    from app.services.public_client import public_client

    expirations = await public_client.get_option_expirations(symbol)
    if expirations:
        return OptionExpirationsResponse(symbol=symbol, expirations=expirations)

    fallback = await asyncio.to_thread(_yf_expirations, symbol)
    if fallback:
        return OptionExpirationsResponse(symbol=symbol, expirations=fallback, source="yfinance")

    raise HTTPException(
        status_code=503,
        detail=(
            "Option expirations unavailable: Public.com is not configured "
            "(PUBLIC_API_SECRET_KEY) and the yfinance fallback returned no data."
        ),
    )


@router.get("/options/{symbol}/chain", response_model=OptionChainResponse)
async def get_option_chain(
    symbol: str,
    expiration: str = Query(..., description="Expiration date (YYYY-MM-DD)"),
):
    """
    Get full option chain with Greeks for a specific expiration.

    Example:
        GET /api/v1/options/AAPL/chain?expiration=2026-05-16
    """
    symbol = symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    from app.services.public_client import public_client

    chain = await public_client.get_option_chain(symbol, expiration)
    if chain is None:
        fallback = await asyncio.to_thread(_yf_chain, symbol, expiration)
        if fallback is not None:
            calls, puts = fallback
            return OptionChainResponse(
                symbol=symbol,
                expiration=expiration,
                calls=calls,
                puts=puts,
                source="yfinance",
                fetched_at=datetime.utcnow().isoformat(),
            )
        raise HTTPException(
            status_code=503,
            detail=(
                "Option chain unavailable: Public.com is not configured "
                "(PUBLIC_API_SECRET_KEY) and the yfinance fallback returned no data."
            ),
        )

    # Parse chain into calls and puts
    calls = []
    puts = []

    # Handle both dict and SDK object responses
    chain_data = chain if isinstance(chain, dict) else getattr(chain, "__dict__", {})

    for item in chain_data.get("options", chain_data.get("contracts", [])):
        item_dict = item if isinstance(item, dict) else getattr(item, "__dict__", {})

        contract = {
            "symbol": item_dict.get("symbol", ""),
            "strike": _safe_float(item_dict.get("strikePrice") or item_dict.get("strike")),
            "bid": _safe_float(item_dict.get("bid")),
            "ask": _safe_float(item_dict.get("ask")),
            "mid": _safe_float(item_dict.get("midPrice") or item_dict.get("mid")),
            "last": _safe_float(item_dict.get("last")),
            "volume": _safe_int(item_dict.get("volume")),
            "open_interest": _safe_int(item_dict.get("openInterest")),
        }

        # Greeks (may be nested or inline)
        greeks = item_dict.get("greeks", item_dict.get("optionDetails", {}))
        if isinstance(greeks, dict):
            contract["implied_volatility"] = _safe_float(greeks.get("impliedVolatility") or greeks.get("iv"))
            contract["delta"] = _safe_float(greeks.get("delta"))
            contract["gamma"] = _safe_float(greeks.get("gamma"))
            contract["theta"] = _safe_float(greeks.get("theta"))
            contract["vega"] = _safe_float(greeks.get("vega"))
            contract["rho"] = _safe_float(greeks.get("rho"))
        else:
            # Greeks might be inline on the item itself
            contract["implied_volatility"] = _safe_float(item_dict.get("impliedVolatility"))
            contract["delta"] = _safe_float(item_dict.get("delta"))
            contract["gamma"] = _safe_float(item_dict.get("gamma"))
            contract["theta"] = _safe_float(item_dict.get("theta"))
            contract["vega"] = _safe_float(item_dict.get("vega"))
            contract["rho"] = _safe_float(item_dict.get("rho"))

        # Determine call vs put
        option_type = (
            item_dict.get("type", "")
            or item_dict.get("optionType", "")
            or item_dict.get("side", "")
        ).upper()

        if "PUT" in option_type or "P" == option_type:
            puts.append(contract)
        else:
            calls.append(contract)

    # Sort by strike price
    calls.sort(key=lambda x: x.get("strike") or 0)
    puts.sort(key=lambda x: x.get("strike") or 0)

    if not calls and not puts:
        # Public.com answered but with no contracts: try the free source before
        # handing the UI an empty chain.
        fallback = await asyncio.to_thread(_yf_chain, symbol, expiration)
        if fallback is not None:
            calls, puts = fallback
            return OptionChainResponse(
                symbol=symbol,
                expiration=expiration,
                calls=calls,
                puts=puts,
                source="yfinance",
                fetched_at=datetime.utcnow().isoformat(),
            )

    return OptionChainResponse(
        symbol=symbol,
        expiration=expiration,
        calls=calls,
        puts=puts,
        fetched_at=datetime.utcnow().isoformat(),
    )


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
    except (ValueError, TypeError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, 4)


def _safe_int(val) -> Optional[int]:
    f = _safe_float(val)
    return None if f is None else int(f)


# ── yfinance fallback (free, no API key) ───────────────────────────────────

def _yf_expirations(symbol: str) -> Optional[List[str]]:
    try:
        import yfinance as yf

        exps = list(yf.Ticker(symbol).options or [])
        return exps or None
    except Exception as exc:  # network / parsing failures
        logger.warning("yfinance option expirations failed for %s: %s", symbol, exc)
        return None


def yf_rows_to_contracts(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Map yfinance option_chain() DataFrame records to the API contract shape."""
    out: List[Dict[str, Any]] = []
    for row in rows:
        bid = _safe_float(row.get("bid"))
        ask = _safe_float(row.get("ask"))
        mid = round((bid + ask) / 2, 4) if bid and ask else None
        iv = _safe_float(row.get("impliedVolatility"))
        out.append({
            "symbol": str(row.get("contractSymbol") or ""),
            "strike": _safe_float(row.get("strike")),
            "bid": bid,
            "ask": ask,
            "mid": mid,
            "last": _safe_float(row.get("lastPrice")),
            "volume": _safe_int(row.get("volume")),
            "open_interest": _safe_int(row.get("openInterest")),
            # yfinance reports ~1e-5 when it has no IV; treat that as missing.
            "implied_volatility": iv if iv and iv > 0.0001 else None,
            "delta": None,
            "gamma": None,
            "theta": None,
            "vega": None,
            "rho": None,
        })
    out.sort(key=lambda x: x.get("strike") or 0)
    return out


def _yf_chain(symbol: str, expiration: str):
    try:
        import yfinance as yf

        chain = yf.Ticker(symbol).option_chain(expiration)
        calls = yf_rows_to_contracts(chain.calls.to_dict("records"))
        puts = yf_rows_to_contracts(chain.puts.to_dict("records"))
        if not calls and not puts:
            return None
        return calls, puts
    except Exception as exc:
        logger.warning("yfinance option chain failed for %s %s: %s", symbol, expiration, exc)
        return None
