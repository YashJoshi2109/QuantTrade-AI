"""
Options API — Option chain, expirations, and Greeks via Public.com

Endpoints:
- GET /api/v1/options/{symbol}/expirations → Available expiration dates
- GET /api/v1/options/{symbol}/chain?expiration=2026-05-16 → Full option chain with Greeks
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime

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
    if expirations is None:
        raise HTTPException(
            status_code=503,
            detail="Option expirations unavailable. Ensure PUBLIC_API_SECRET_KEY is configured.",
        )

    return OptionExpirationsResponse(symbol=symbol, expirations=expirations)


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
        raise HTTPException(
            status_code=503,
            detail="Option chain unavailable. Ensure PUBLIC_API_SECRET_KEY is configured.",
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
        return round(float(val), 4)
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None
