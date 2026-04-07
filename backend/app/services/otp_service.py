"""
OTP (One-Time Password) service for email verification.
Uses Redis when available, with an in-memory fallback for local dev.
Email delivery via Brevo.
"""
import random
import string
import time
from datetime import timedelta
from typing import Dict, Optional, Tuple

import logging

import redis

from app.config import settings

# OTP config
OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
OTP_REDIS_PREFIX = "otp:"
OTP_RATE_LIMIT_PREFIX = "otp_limit:"
OTP_RATE_LIMIT_SECONDS = 30  # 1 OTP per 30 seconds per email

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


def get_rate_limit_remaining_seconds(email: str) -> int:
    """
    Return seconds remaining before the next OTP request is allowed.
    Returns 0 when the email is not currently rate limited.
    """
    key = email.lower()
    r = _get_redis()

    if r:
        try:
            redis_key = f"{OTP_RATE_LIMIT_PREFIX}{key}"
            ttl = r.ttl(redis_key)
            # Redis returns:
            #  -2 key does not exist, -1 no expire, >=0 remaining seconds
            if ttl is None or ttl <= 0:
                return 0
            return int(ttl)
        except Exception:
            pass

    last_ts = _memory_rate_limit.get(key)
    if last_ts is None:
        return 0
    remaining = int(OTP_RATE_LIMIT_SECONDS - (time.time() - last_ts))
    return remaining if remaining > 0 else 0


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


def send_otp_email(email: str, otp: str) -> tuple[bool, str]:
    """
    Send OTP via Brevo.
    Returns (success, error_detail) — error_detail is safe to show in API responses.
    """
    from app.services.email_service import send_email_sync

    html = f"""
    <div style="font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 440px; margin: 0 auto; background: #060B12; padding: 40px 20px;">
        <div style="background: #0D1828; border: 1px solid rgba(0,212,255,0.2); border-radius: 16px; overflow: hidden;">
            <div style="background: linear-gradient(135deg,#060B12,#0a1628); padding: 28px 32px; border-bottom: 1px solid rgba(0,212,255,0.15);">
                <span style="color:#00D4FF; font-size:18px; font-weight:700; letter-spacing:-0.5px;">⚡ QuantTrade AI</span>
            </div>
            <div style="padding: 32px;">
                <p style="color:#94A3B8; font-size:15px; margin:0 0 20px;">Your verification code is:</p>
                <p style="font-size:36px; font-weight:bold; letter-spacing:8px; color:#00D9FF; background:#0a1628; border:1px solid rgba(0,212,255,0.25); padding:20px; border-radius:12px; text-align:center; margin:0 0 20px; font-family:'Courier New',monospace;">
                    {otp}
                </p>
                <p style="color:#64748B; font-size:13px; margin:0 0 8px;">
                    Expires in <strong style="color:#94A3B8">{OTP_EXPIRY_MINUTES} minutes</strong>. Do not share it with anyone.
                </p>
                <p style="color:#475569; font-size:12px; margin:0;">
                    If you didn't request this, you can safely ignore this email.
                </p>
            </div>
        </div>
    </div>
    """
    ok, err = send_email_sync(email, "QuantTrade AI — Your Verification Code", html)
    if ok:
        return True, ""
    # Local dev: Brevo not configured or failing — log OTP to terminal and allow flow to continue
    if getattr(settings, "DEBUG", False) and getattr(settings, "EMAIL_DEV_LOG_OTP", False):
        logger.warning(
            "[EMAIL_DEV_LOG_OTP] OTP for %s: %s (mail error was: %s)",
            email,
            otp,
            err[:200] if err else "unknown",
        )
        return True, ""
    return False, err
