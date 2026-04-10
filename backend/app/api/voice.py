import os
import io
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from elevenlabs.client import ElevenLabs

router = APIRouter()

# Initialize the ElevenLabs client. Will throw if key is missing/invalid when requested.
try:
    client = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY", ""))
except Exception as e:
    client = None
    print(f"ElevenLabs client initialization failed: {e}")

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
    text: str
    role: str = "narrator"
    emotion: Optional[str] = "Neutral"
    npc_id: Optional[str] = None

@router.post("/generate")
async def generate_voice(request: VoiceRequest):
    """
    Generate ElevenLabs voice audio for the given text and character role.
    """
    if not client:
        raise HTTPException(status_code=503, detail="Voice engine is not configured.")

    # Determine voice ID and settings based on role
    role_key = request.role.lower()
    voice_id = VOICE_REGISTRY.get(role_key, VOICE_REGISTRY["narrator"])
    settings = VOICE_SETTINGS.get(role_key, VOICE_SETTINGS["narrator"])

    # Truncate long text to avoid high latency
    text = request.text[:1200] if len(request.text) > 1200 else request.text

    try:
        from elevenlabs import VoiceSettings

        audio_generator = client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
            voice_settings=VoiceSettings(
                stability=settings["stability"],
                similarity_boost=settings["similarity_boost"],
                style=settings.get("style", 0.0),
                use_speaker_boost=settings.get("use_speaker_boost", True),
            ),
        )

        audio_bytes = b"".join([chunk for chunk in audio_generator])
        return Response(content=audio_bytes, media_type="audio/mpeg")
    
    except Exception as e:
        print(f"Voice generation error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate audio.")
