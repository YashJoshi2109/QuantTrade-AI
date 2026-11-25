"""
ElevenLabs voice generation for game characters.

Requires an authenticated, verified user; characters are capped per request and
per day, identical lines are cached, and spend is bounded by the ElevenLabs and
global AI budgets (app.services.tts_service → app.services.ai_guard).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.ai_quota import require_media_quota
from app.services import ai_guard
from app.services.ai_guard import GuardContext
from app.services.tts_service import TTSUnavailable, synthesize

router = APIRouter()

# Voice Registry — deep, natural-sounding voices that don't sound AI-generated
# Using ElevenLabs voices known for warm, human-like quality
VOICE_REGISTRY = {
    "player_hero": "pNInz6obbf5AWCG1snPk",  # Adam — deep, confident male
    "narrator": "ErXwobaYiN019PkySvjV",      # Antoni — warm, authoritative narrator
    "merchant": "VR6AewLTigWG4xSOukaG",      # Fin — smooth, persuasive trader
    "sage": "onwK4e9ZLuTAKqWW03F9",          # Daniel — deep British male, wise
    "villager": "MF3mGyEYCl7XYWbV9V6O",      # Elli — friendly villager
    "elder": "2EiwWnXFnvU5JabPnv8n",         # Clyde — deep, aged, gravelly
}

# Per-role voice settings for natural, non-AI sound
VOICE_SETTINGS = {
    "narrator":    {"stability": 0.62, "similarity_boost": 0.60, "style": 0.15, "use_speaker_boost": True},
    "merchant":    {"stability": 0.55, "similarity_boost": 0.65, "style": 0.20, "use_speaker_boost": True},
    "sage":        {"stability": 0.70, "similarity_boost": 0.55, "style": 0.10, "use_speaker_boost": False},
    "player_hero": {"stability": 0.58, "similarity_boost": 0.70, "style": 0.25, "use_speaker_boost": True},
    "villager":    {"stability": 0.50, "similarity_boost": 0.65, "style": 0.20, "use_speaker_boost": True},
    "elder":       {"stability": 0.75, "similarity_boost": 0.50, "style": 0.05, "use_speaker_boost": False},
}


class VoiceRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    role: str = "narrator"
    emotion: Optional[str] = "Neutral"
    npc_id: Optional[str] = None


@router.post("/generate")
def generate_voice(request: VoiceRequest, ctx: GuardContext = Depends(require_media_quota("voice"))):
    """Generate ElevenLabs voice audio for the given text and character role."""
    role_key = request.role.lower()
    voice_id = VOICE_REGISTRY.get(role_key, VOICE_REGISTRY["narrator"])
    settings = VOICE_SETTINGS.get(role_key, VOICE_SETTINGS["narrator"])
    try:
        with ai_guard.use_context(ctx):
            audio = synthesize(
                request.text,
                voice_id,
                model_id="eleven_multilingual_v2",
                voice_settings=settings,
            )
    except TTSUnavailable:
        raise HTTPException(status_code=503, detail="Voice engine is not available.")
    return Response(content=audio, media_type="audio/mpeg")
