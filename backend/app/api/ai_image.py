"""
AI image generation endpoints — backed by fal.ai, guarded by app.services.ai_guard.

  POST /generate       authenticated + verified + images/day quota (Next.js /api/fal proxies here)
  POST /stock-visual   same guard
  POST /game-asset     same guard
  GET  /og, POST /og-image
                       PUBLIC (social-preview crawlers).  Results are cached
                       persistently per (type, title, subtitle, template version)
                       so each image is generated at most once; misses are
                       rate limited per IP and capped globally per day
                       (AI_OG_IMAGES_PER_DAY).  When capped or unavailable the
                       response is {"url": null, "fallback": true} and the
                       caller serves a static image — never an error loop.
"""
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.ai_quota import client_ip, require_media_quota
from app.services import ai_guard
from app.services.ai_guard import AIQuotaError, GuardContext
from app.services.fal_service import (
    ALLOWED_MODELS,
    MAX_PROMPT_CHARS,
    generate_game_asset,
    generate_image,
    generate_og_image,
    generate_stock_visual,
)

router = APIRouter()


# ── Free-form generation (Next.js /api/fal proxy) ────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_CHARS)
    model: Optional[str] = None
    width: int = 1024
    height: int = 576
    steps: int = 4


@router.post("/generate")
async def generate(req: GenerateRequest, ctx: GuardContext = Depends(require_media_quota("image_generation"))):
    model = req.model or ALLOWED_MODELS[0]
    if model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail="Unsupported model")
    ai_guard.set_context(ctx)
    url = await generate_image(req.prompt, model=model, width=req.width, height=req.height, steps=req.steps)
    if not url:
        raise HTTPException(status_code=502, detail="Image generation failed")
    return {"url": url}


# ── Stock Visual ──────────────────────────────────────────────────────────────

class StockVisualRequest(BaseModel):
    symbol: str
    company_name: str = Field(max_length=120)
    sentiment: Optional[str] = "neutral"  # bullish | bearish | neutral


@router.post("/stock-visual")
async def stock_visual(req: StockVisualRequest, ctx: GuardContext = Depends(require_media_quota("stock_visual"))):
    """Generate a dark-themed financial illustration for a stock."""
    if not req.symbol or len(req.symbol) > 10:
        raise HTTPException(status_code=400, detail="Invalid symbol")
    ai_guard.set_context(ctx)
    url = await generate_stock_visual(
        req.symbol.upper(),
        req.company_name,
        req.sentiment if req.sentiment in ("bullish", "bearish", "neutral") else "neutral",
    )
    if not url:
        raise HTTPException(status_code=503, detail="Image generation unavailable")
    return {"url": url, "symbol": req.symbol.upper()}


# ── OG Image (public) ─────────────────────────────────────────────────────────

OG_TEMPLATE_VERSION = 1
_OG_IP_PER_MIN = 10
_og_hits: Dict[str, Deque[float]] = defaultdict(deque)
_og_lock = threading.Lock()


def _og_ip_allowed(ip: str) -> bool:
    now = time.monotonic()
    with _og_lock:
        q = _og_hits[ip]
        while q and q[0] <= now - 60:
            q.popleft()
        if len(q) >= _OG_IP_PER_MIN:
            return False
        q.append(now)
        if len(_og_hits) > 50_000:
            for k in [k for k, v in _og_hits.items() if not v or v[-1] <= now - 60]:
                _og_hits.pop(k, None)
    return True


async def _og(request: Request, title: str, subtitle: str, page_type: str) -> dict:
    title = (title or "QuantTrade AI").strip()[:80]
    subtitle = (subtitle or "").strip()[:120]
    page_type = page_type if page_type in ("stock", "markets", "game", "default") else "default"
    key = "og:" + ai_guard.cache_key(OG_TEMPLATE_VERSION, page_type, title, subtitle)
    import asyncio
    cached = await asyncio.to_thread(ai_guard.cache_get, key, persistent=True)
    if cached:
        return {"url": cached, "cached": True}
    if not _og_ip_allowed(client_ip(request)):
        return {"url": None, "fallback": True, "reason": "rate_limited"}
    try:
        with ai_guard.system_context("og_image"):
            url = await generate_og_image(title, subtitle, page_type)
    except AIQuotaError:
        return {"url": None, "fallback": True, "reason": "daily_cap"}
    if not url:
        return {"url": None, "fallback": True, "reason": "unavailable"}
    await asyncio.to_thread(ai_guard.cache_set, key, url, 365 * 86400, persistent=True)
    return {"url": url, "cached": False}


class OgImageRequest(BaseModel):
    title: str
    subtitle: Optional[str] = ""
    page_type: Optional[str] = "default"  # stock | markets | game | default


@router.post("/og-image")
async def og_image(req: OgImageRequest, request: Request):
    """Branded OG/social-preview image. Public; cached forever per input; capped."""
    return await _og(request, req.title, req.subtitle or "", req.page_type or "default")


@router.get("/og")
async def og_image_get(
    request: Request,
    title: str = Query("QuantTrade AI", max_length=200),
    subtitle: str = Query("", max_length=300),
    type: str = Query("default", max_length=20),
):
    return await _og(request, title, subtitle, type)


# ── Game Asset ────────────────────────────────────────────────────────────────

class GameAssetRequest(BaseModel):
    asset_type: str   # character | building | scene | item
    name: str = Field(max_length=120)
    style: Optional[str] = "medieval"


@router.post("/game-asset")
async def game_asset(req: GameAssetRequest, ctx: GuardContext = Depends(require_media_quota("game_asset"))):
    """Generate a QLife medieval game asset image."""
    valid_types = ("character", "building", "scene", "item")
    if req.asset_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {valid_types}")
    ai_guard.set_context(ctx)
    url = await generate_game_asset(req.asset_type, req.name, req.style or "medieval")
    if not url:
        raise HTTPException(status_code=503, detail="Game asset generation unavailable")
    return {"url": url, "asset_type": req.asset_type, "name": req.name}
