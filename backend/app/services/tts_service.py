"""
ElevenLabs text-to-speech — the only place the app calls ElevenLabs.

Guarded by app.services.ai_guard:
  * max characters per request (AI_TTS_MAX_CHARS_PER_REQUEST, default 1000)
  * identical (voice, model, settings, text) → served from cache (in-process +
    Redis, 7 days), so replaying a line never re-bills
  * cache misses reserve the characters against the caller's TTS chars/day
    quota and the ElevenLabs / global daily budgets (AIQuotaError propagates)
"""
from __future__ import annotations

import base64
import logging
from typing import Any, Dict, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
_CACHE_TTL_S = 7 * 86400


class TTSUnavailable(Exception):
    pass


def _api_key() -> Optional[str]:
    return getattr(settings, "ELEVENLABS_API_KEY", None)


def synthesize(
    text: str,
    voice_id: str,
    *,
    model_id: Optional[str] = None,
    voice_settings: Optional[Dict[str, Any]] = None,
    output_format: str = "mp3_44100_128",
    timeout_s: float = 20.0,
) -> bytes:
    """Return MP3 bytes. Raises TTSUnavailable (not configured / upstream error)
    or ai_guard.AIQuotaError (quota / budget)."""
    from app.services import ai_guard

    api_key = _api_key()
    if not api_key:
        raise TTSUnavailable("ElevenLabs is not configured")
    text = (text or "").strip()
    if not text:
        raise ValueError("Text is required")
    text = text[: ai_guard.io_caps()["tts_max_chars"]]
    model_id = model_id or getattr(settings, "ELEVENLABS_MODEL_ID", None) or "eleven_multilingual_v2"
    voice_settings = voice_settings or {}

    key = "tts:" + ai_guard.cache_key(voice_id, model_id, voice_settings, output_format, text)
    hit = ai_guard.cache_get(key)
    if hit:
        return base64.b64decode(hit)

    res = ai_guard.reserve("elevenlabs", f"eleven:{model_id}", units=len(text), unit_kind="tts_chars")
    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(
                _TTS_URL.format(voice_id=voice_id),
                params={"output_format": output_format},
                json={"text": text, "model_id": model_id, "voice_settings": voice_settings},
                headers={"xi-api-key": api_key, "accept": "audio/mpeg", "content-type": "application/json"},
            )
    except Exception as exc:  # noqa: BLE001
        res.release()
        raise TTSUnavailable(f"ElevenLabs request failed: {type(exc).__name__}") from exc
    if resp.status_code != 200:
        res.release()
        logger.warning("ElevenLabs %s: %s", resp.status_code, resp.text[:200])
        raise TTSUnavailable("Voice generation failed")
    audio = resp.content
    res.commit(units=len(text))
    try:
        ai_guard.cache_set(key, base64.b64encode(audio).decode(), _CACHE_TTL_S)
    except Exception:  # noqa: BLE001
        pass
    return audio
