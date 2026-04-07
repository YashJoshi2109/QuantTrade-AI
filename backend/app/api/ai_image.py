"""
AI image generation endpoints — backed by fal.ai.
All routes require JWT authentication (or a public proxy for OG images).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.api.auth import require_auth, get_current_user
from app.models.user import User
from app.services.fal_service import (
    generate_stock_visual,
    generate_og_image,
    generate_game_asset,
)

router = APIRouter()


# ── Stock Visual ──────────────────────────────────────────────────────────────

class StockVisualRequest(BaseModel):
    symbol: str
    company_name: str
    sentiment: Optional[str] = "neutral"  # bullish | bearish | neutral


@router.post("/stock-visual")
async def stock_visual(req: StockVisualRequest, _user: User = Depends(require_auth)):
    """Generate a dark-themed financial illustration for a stock."""
    if not req.symbol or len(req.symbol) > 10:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    url = await generate_stock_visual(
        req.symbol.upper(),
        req.company_name,
        req.sentiment or "neutral",
    )
    if not url:
        raise HTTPException(status_code=503, detail="Image generation unavailable — check FAL_API_KEY")
    return {"url": url, "symbol": req.symbol.upper()}


# ── OG Image ─────────────────────────────────────────────────────────────────

class OgImageRequest(BaseModel):
    title: str
    subtitle: Optional[str] = ""
    page_type: Optional[str] = "default"  # stock | markets | game | default


@router.post("/og-image")
async def og_image(req: OgImageRequest):
    """Generate a branded OG/social-preview image. Public endpoint (no auth)."""
    url = await generate_og_image(req.title, req.subtitle or "", req.page_type or "default")
    if not url:
        raise HTTPException(status_code=503, detail="OG image generation unavailable")
    return {"url": url}


# ── Game Asset ────────────────────────────────────────────────────────────────

class GameAssetRequest(BaseModel):
    asset_type: str   # character | building | scene | item
    name: str
    style: Optional[str] = "medieval"


@router.post("/game-asset")
async def game_asset(req: GameAssetRequest, _user: User = Depends(require_auth)):
    """Generate a QLife medieval game asset image."""
    valid_types = ("character", "building", "scene", "item")
    if req.asset_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {valid_types}")
    url = await generate_game_asset(req.asset_type, req.name, req.style or "medieval")
    if not url:
        raise HTTPException(status_code=503, detail="Game asset generation unavailable")
    return {"url": url, "asset_type": req.asset_type, "name": req.name}
