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

# Voice Registry mapping character/role to specific stable Voice IDs
# You can customize these with actual ElevenLabs Voice IDs retrieved from their dashboard.
VOICE_REGISTRY = {
    "player_hero": "pNInz6obbf5AWCG1snPk", # Adam (deep, confident)
    "narrator": "ErXwobaYiN019PkySvjV",    # Antoni (well-spoken, narrating)
    "merchant": "VR6AewLTigWG4xSOukaG",    # Fin (smooth, persuasive)
    "sage": "EXAVITQu4vr4xnSDxMaL",        # Bella (soft, wise)
    "villager": "MF3mGyEYCl7XYWbV9V6O",    # Elli
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

    # Determine voice ID based on role or fallback to narrator
    voice_id = VOICE_REGISTRY.get(request.role.lower(), VOICE_REGISTRY["narrator"])

    try:
        audio_generator = client.text_to_speech.convert(
            text=request.text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        
        audio_bytes = b"".join([chunk for chunk in audio_generator])
        return Response(content=audio_bytes, media_type="audio/mpeg")
    
    except Exception as e:
        print(f"Voice generation error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate audio.")
