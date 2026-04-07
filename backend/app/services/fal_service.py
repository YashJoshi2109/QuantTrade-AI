"""
fal.ai image generation service.
Wraps the fal.ai REST API with typed helpers for each use case:
  - generate_stock_visual()  → financial analysis illustration for a stock
  - generate_og_image()      → branded OG/social preview for any page
  - generate_game_asset()    → medieval character/building art for QLife
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("fal_service")

_FAL_BASE = "https://fal.run"
_MODEL_FAST = "fal-ai/flux/schnell"   # 4-step, ~1 s, good quality
_MODEL_HD   = "fal-ai/flux/dev"       # higher detail, ~5 s


def _key() -> Optional[str]:
    return getattr(settings, "FAL_API_KEY", None)


async def _generate(prompt: str, *, width: int = 1024, height: int = 576, steps: int = 4, model: str = _MODEL_FAST) -> Optional[str]:
    """Core async generator — returns public image URL or None on failure."""
    api_key = _key()
    if not api_key:
        logger.warning("FAL_API_KEY not set — skipping image generation")
        return None

    payload = {
        "prompt": prompt,
        "image_size": {"width": width, "height": height},
        "num_inference_steps": steps,
        "num_images": 1,
        "enable_safety_checker": True,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{_FAL_BASE}/{model}",
                json=payload,
                headers={
                    "Authorization": f"Key {api_key}",
                    "Content-Type": "application/json",
                },
            )
            if r.status_code not in (200, 201):
                logger.warning("fal.ai %s: %s", r.status_code, r.text[:300])
                return None
            data = r.json()
            images = data.get("images") or []
            if not images:
                return None
            return images[0].get("url")
    except Exception as exc:
        logger.error("fal.ai exception: %s", exc)
        return None


async def generate_stock_visual(symbol: str, company_name: str, sentiment: str = "neutral") -> Optional[str]:
    """
    Generate a dark-themed financial illustration for a stock research card.
    sentiment: "bullish" | "bearish" | "neutral"
    Returns public image URL or None.
    """
    sentiment_map = {
        "bullish": "upward trending green glowing stock chart, rising candlesticks, bull symbol, green accents",
        "bearish": "downward trending red glowing stock chart, falling candlesticks, bear symbol, red accents",
        "neutral": "stable stock chart with mixed candlesticks, blue and cyan accents",
    }
    chart_desc = sentiment_map.get(sentiment, sentiment_map["neutral"])

    prompt = (
        f"Professional financial data visualization, dark navy background (#0a0e1a), "
        f"{chart_desc}, glowing holographic display, "
        f"'{symbol}' ticker label, '{company_name}' text overlay, "
        f"Bloomberg terminal aesthetic, neon cyan and blue light, "
        f"ultra-detailed, cinematic lighting, 4K, no people, no text beyond ticker"
    )
    return await _generate(prompt, width=1200, height=630, steps=4)


async def generate_og_image(
    title: str,
    subtitle: str = "",
    page_type: str = "default",
) -> Optional[str]:
    """
    Generate a branded OG/social preview image.
    page_type: "stock" | "markets" | "game" | "default"
    Returns public image URL or None.
    """
    type_themes = {
        "stock":   "stock market data, candlestick charts, financial terminals, electric blue",
        "markets": "global financial markets, world map with data overlays, gold and cyan",
        "game":    "medieval fantasy kingdom, torchlit market square, gold coins, epic fantasy art",
        "default": "futuristic fintech platform, data streams, glowing interfaces, cyan and blue",
    }
    theme = type_themes.get(page_type, type_themes["default"])

    prompt = (
        f"Stunning social media preview image, {theme}, "
        f"dark background, bold modern typography space for '{title}', "
        f"'{subtitle}' subtitle, QuantTrade AI branding, "
        f"professional, high-contrast, 16:9 aspect ratio, no people, "
        f"cinematic depth of field, volumetric lighting"
    )
    return await _generate(prompt, width=1200, height=630, steps=4)


async def generate_game_asset(
    asset_type: str,
    name: str,
    style: str = "medieval",
) -> Optional[str]:
    """
    Generate a QLife game asset.
    asset_type: "character" | "building" | "scene" | "item"
    Returns public image URL or None.
    """
    asset_prompts = {
        "character": (
            f"Full-body portrait of a medieval {name} character, "
            f"fantasy RPG art style, detailed armor and clothing, "
            f"dark fantasy background, dramatic lighting, "
            f"digital painting, highly detailed, concept art"
        ),
        "building": (
            f"Isometric view of a medieval {name}, "
            f"fantasy village building, warm torchlight, "
            f"detailed stonework and wood, slight glow, "
            f"game asset style, dark atmospheric background"
        ),
        "scene": (
            f"Wide establishing shot of a medieval {name}, "
            f"fantasy world, moonlit atmosphere, "
            f"detailed environment art, cinematic composition, "
            f"dark fantasy painting style"
        ),
        "item": (
            f"Fantasy item illustration: {name}, "
            f"medieval style, glowing magical item, "
            f"dark background with dramatic lighting, "
            f"detailed game icon style, 2D illustration"
        ),
    }

    prompt = asset_prompts.get(asset_type, asset_prompts["building"])
    # Game art looks better at square aspect ratio for characters, landscape for scenes
    if asset_type in ("character", "item"):
        return await _generate(prompt, width=768, height=1024, steps=6, model=_MODEL_HD)
    return await _generate(prompt, width=1024, height=576, steps=6, model=_MODEL_HD)
