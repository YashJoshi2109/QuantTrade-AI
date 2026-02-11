"""
OTP (One-Time Password) service for email verification.
Uses Redis when available, with an in-memory fallback for local dev.
Resend is used for email delivery.
"""
import random
import string
import time
from datetime import timedelta
from typing import Dict, Optional, Tuple

import logging

import httpx
import redis

from app.config import settings

# OTP config
OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
OTP_REDIS_PREFIX = "otp:"
OTP_RATE_LIMIT_PREFIX = "otp_limit:"
OTP_RATE_LIMIT_SECONDS = 60  # 1 OTP per minute per email

_redis_client: Optional[redis.Redis] = None

# In-memory fallback stores (used when Redis is unavailable)
_memory_otp_store: Dict[str, Tuple[str, float]] = {}
_memory_rate_limit: Dict[str, float] = {}

logger = logging.getLogger("otp_service")


def _get_redis() -> Optional[redis.Redis]:
    global _redis_client
    if _redis_client is None:
        try:
            redis_url = getattr(settings, "CELERY_BROKER_URL", "redis://localhost:6379/0")
            _redis_client = redis.from_url(redis_url, decode_responses=True)
        except Exception:
            _redis_client = None
    return _redis_client


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=OTP_LENGTH))


def store_otp(email: str, otp: str) -> bool:
    """
    Store OTP with expiry.

    Uses Redis when available; otherwise falls back to in-memory storage so
    local development still works even without Redis running.
    """
    key = email.lower()
    r = _get_redis()

    if r:
        try:
            redis_key = f"{OTP_REDIS_PREFIX}{key}"
            r.setex(redis_key, timedelta(minutes=OTP_EXPIRY_MINUTES), otp)
            return True
        except Exception:
            # Fall back to in-memory store
            pass

    expiry = time.time() + OTP_EXPIRY_MINUTES * 60
    _memory_otp_store[key] = (otp, expiry)
    return True


def verify_otp(email: str, otp: str) -> bool:
    """Verify OTP and delete from store if valid."""
    key = email.lower()
    r = _get_redis()

    if r:
        try:
            redis_key = f"{OTP_REDIS_PREFIX}{key}"
            stored = r.get(redis_key)
            if stored and stored == otp:
                r.delete(redis_key)
                return True
        except Exception:
            # Fall through to in-memory store
            pass

    # In-memory fallback
    data = _memory_otp_store.get(key)
    if not data:
        return False

    stored_otp, expiry = data
    if time.time() > expiry:
        # Expired
        _memory_otp_store.pop(key, None)
        return False

    if stored_otp == otp:
        _memory_otp_store.pop(key, None)
        return True

    return False


def check_rate_limit(email: str) -> bool:
    """Returns True if email can request new OTP (not rate limited)."""
    key = email.lower()
    r = _get_redis()

    if r:
        try:
            redis_key = f"{OTP_RATE_LIMIT_PREFIX}{key}"
            return r.get(redis_key) is None
        except Exception:
            # Fall back to in-memory
            pass

    # In-memory fallback
    last_ts = _memory_rate_limit.get(key)
    if last_ts is None:
        return True
    return (time.time() - last_ts) >= OTP_RATE_LIMIT_SECONDS


def set_rate_limit(email: str) -> None:
    """Set rate limit for email."""
    key = email.lower()
    r = _get_redis()

    if r:
        try:
            redis_key = f"{OTP_RATE_LIMIT_PREFIX}{key}"
            r.setex(redis_key, timedelta(seconds=OTP_RATE_LIMIT_SECONDS), "1")
            return
        except Exception:
            # Fall back to in-memory
            pass

    _memory_rate_limit[key] = time.time()


def send_otp_email(email: str, otp: str) -> bool:
    """
    Send OTP via Resend (HTTP API).

    Uses the RESEND_API_KEY from settings and sends via the official
    HTTPS endpoint so we don't depend on the Python SDK.
    """
    api_key = getattr(settings, "RESEND_API_KEY", None)
    if not api_key:
        return False

    try:
        from_email = getattr(
            settings,
            "RESEND_FROM_EMAIL",
            "QuantTrade <onboarding@resend.dev>",
        )
        payload = {
            "from": from_email,
            "to": [email],
            "subject": "QuantTrade AI - Your Verification Code",
            "html": f"""
            <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
                <h2 style="color: #0A0E1A;">QuantTrade AI</h2>
                <p>Your verification code is:</p>
                <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #00D9FF; background: #1A2332; padding: 16px; border-radius: 8px; text-align: center;">
                    {otp}
                </p>
                <p style="color: #8B93A7; font-size: 14px;">
                    This code expires in {OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.
                </p>
                <hr style="border: none; border-top: 1px solid #1A2332; margin: 24px 0;" />
                <p style="color: #8B93A7; font-size: 12px;">
                    If you didn't request this code, you can safely ignore this email.
                </p>
            </div>
            """,
        }

        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10.0,
        )
        response.raise_for_status()
        return True
    except Exception as exc:
        logger.exception("Failed to send OTP email via Resend: %s", exc)
        return False
